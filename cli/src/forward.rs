//! `bridgehook forward <port|url>`: keep one channel per target, print its
//! public URL, and deliver its queue to the target in order.
//!
//! The live stream only wakes the drain; the drain always reads the queue
//! oldest first, so a live webhook never overtakes one that waited while
//! this machine was offline. Without the stream (signed out, or the stream
//! is down) the queue is polled.

use crate::output::{clock, Out};
use crate::Session;
use anyhow::{bail, Result};
use bridgehook_core::config::{self, ChannelMap};
use bridgehook_core::drain::{DrainDeps, DrainEvent, Drainer, PassResult};
use bridgehook_core::forward::{event_path, ForwardOutcome, Target};
use bridgehook_core::keys::ChannelKey;
use bridgehook_core::relay::{ForwardResult, PendingPage, QueuedEvent, RelayClient, RelayError};
use bridgehook_core::stream;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;

const POLL_WITHOUT_STREAM: Duration = Duration::from_secs(2);
const POLL_WITH_STREAM: Duration = Duration::from_secs(30);
const BLOCKED_WAIT: Duration = Duration::from_secs(10);
const QUOTA_WAIT: Duration = Duration::from_secs(60);
const RETRY_MIN: Duration = Duration::from_secs(2);
const RETRY_MAX: Duration = Duration::from_secs(15);

#[derive(clap::Args)]
pub struct ForwardArgs {
    /// Local port (3000) or URL (http://api:8080/base).
    target: String,
    /// Only accept webhooks under this path (repeatable). Default: any path.
    #[arg(long = "path", value_name = "PATH")]
    paths: Vec<String>,
    /// Make a new channel (and a new URL) instead of reusing this target's.
    #[arg(long)]
    new: bool,
}

/// The channel this run forwards for.
struct Channel {
    id: String,
    key: ChannelKey,
    webhook_url: String,
    how: &'static str,
}

pub async fn run(session: &Session, out: Out, args: ForwardArgs) -> Result<i32> {
    let target = Target::parse(&args.target)?;
    for p in &args.paths {
        if !p.starts_with('/') {
            bail!("--path must start with / (got `{p}`)");
        }
    }
    let relay = session.client()?;
    let channel = resolve_channel(session, &relay, &target, &args, out).await?;
    let executor = config::executor_id(&session.paths)?;

    out.emit(
		json!({
			"event": "ready",
			"channelId": channel.id,
			"webhookUrl": channel.webhook_url,
			"target": target.display(),
			"channel": channel.how,
		}),
		|| {
			format!(
				"\n  {}  {}\n  {}  {}\n\n{}",
				out.dim("Webhook URL"),
				out.bold(&channel.webhook_url),
				out.dim("Forwarding "),
				target.display(),
				out.dim("Webhooks sent while this is not running wait on the relay and arrive in order next time. Ctrl-C to stop.\n"),
			)
		},
	);

    let deps = ChannelDeps {
        relay: relay.clone(),
        key: channel.key,
        channel_id: channel.id.clone(),
        executor,
        device_id: session.device_id().map(str::to_string),
        target: target.clone(),
    };

    // Ctrl-C: finish the webhook in hand, then stop. A second Ctrl-C quits.
    let stop = Arc::new(AtomicBool::new(false));
    let wake = Arc::new(Notify::new());
    {
        let stop = stop.clone();
        let wake = wake.clone();
        tokio::spawn(async move {
            if tokio::signal::ctrl_c().await.is_ok() {
                stop.store(true, Ordering::SeqCst);
                wake.notify_one();
                if !out.json {
                    eprintln!("\nStopping after the current webhook; Ctrl-C again to quit now.");
                }
                if tokio::signal::ctrl_c().await.is_ok() {
                    std::process::exit(130);
                }
            }
        });
    }

    // The live stream needs a signed-in token; signed out, the queue is polled.
    let connected = Arc::new(AtomicBool::new(false));
    if session.token.is_some() {
        let (relay, connected, stop, wake) =
            (relay.clone(), connected.clone(), stop.clone(), wake.clone());
        let ours = channel.id.clone();
        tokio::spawn(async move {
            stream::run(relay, connected, stop, move |frame| {
                if frame.kind == "webhook" && frame.channel_id.as_deref() == Some(ours.as_str()) {
                    wake.notify_one();
                }
            })
            .await;
        });
    }

    let mut drainer = Drainer::new();
    let mut notify = |e: DrainEvent| report_event(out, &e);
    let mut retry = RETRY_MIN;
    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let wait = match drainer.pass(&deps, &mut notify).await {
			Ok(PassResult::Idle) => {
				retry = RETRY_MIN;
				if connected.load(Ordering::Relaxed) { POLL_WITH_STREAM } else { POLL_WITHOUT_STREAM }
			}
			Ok(PassResult::Blocked) => {
				retry = RETRY_MIN;
				BLOCKED_WAIT
			}
			Ok(PassResult::Retry) => next_retry(&mut retry),
			Err(e) => match e.downcast_ref::<RelayError>() {
				Some(RelayError::Unauthorized) => bail!(
					"the relay no longer accepts this machine's key for {}: another client (the extension or another CLI) took the channel. Run `bridgehook forward {}` again to take it back.",
					channel.webhook_url,
					args.target
				),
				Some(RelayError::Status { status: 404 | 410, .. }) => bail!(
					"channel {} was deleted or expired. Run `bridgehook forward {}` again for a new URL.",
					channel.id,
					args.target
				),
				Some(RelayError::Quota { message }) => {
					out.emit(json!({ "event": "quota", "message": message }), || {
						format!("{} {message}", out.yellow("quota:"))
					});
					QUOTA_WAIT
				}
				_ => {
					let w = next_retry(&mut retry);
					out.emit(json!({ "event": "relay_error", "message": format!("{e:#}"), "retryInMs": w.as_millis() as u64 }), || {
						format!("{} {e:#} (retrying in {}s)", out.yellow("relay:"), w.as_secs())
					});
					w
				}
			},
		};
        // Wait for the stream to wake us, the timer, or Ctrl-C (which also
        // notifies). A target that is down is not helped by early wake-ups.
        let woken = wake.notified();
        if drainer.target_down() {
            tokio::time::sleep(wait).await;
        } else {
            tokio::select! {
                _ = woken => {}
                _ = tokio::time::sleep(wait) => {}
            }
        }
    }
    out.emit(json!({ "event": "stopped" }), || "Stopped.".into());
    Ok(0)
}

fn next_retry(retry: &mut Duration) -> Duration {
    let w = *retry;
    *retry = (*retry * 2).min(RETRY_MAX);
    w
}

fn report_event(out: Out, e: &DrainEvent) {
    match e {
        DrainEvent::Delivered { event, result } => {
            let path = event_path(event);
            out.emit(
                json!({
                    "event": "delivered",
                    "id": event.id,
                    "method": event.method,
                    "path": path,
                    "status": result.status,
                    "latencyMs": result.latency_ms,
                }),
                || {
                    let status = result.status.to_string();
                    let status = if result.status < 400 {
                        out.green(&status)
                    } else {
                        out.red(&status)
                    };
                    format!(
                        "{}  {} {:<6} {} {} {}",
                        out.dim(&clock()),
                        out.green("→"),
                        event.method,
                        path,
                        status,
                        out.dim(&format!("{} ms", result.latency_ms))
                    )
                },
            );
        }
        DrainEvent::Skipped { event, message } => {
            let path = event_path(event);
            out.emit(
				json!({ "event": "skipped", "id": event.id, "method": event.method, "path": path, "message": message }),
				|| format!("{}  {} {:<6} {} {}", out.dim(&clock()), out.red("✗"), event.method, path, message),
			);
        }
        DrainEvent::TargetDown(message) => {
            out.emit(
                json!({ "event": "target_down", "message": message }),
                || {
                    format!(
                        "{}  {} {message} Webhooks wait until it is back.",
                        out.dim(&clock()),
                        out.yellow("!")
                    )
                },
            );
        }
        DrainEvent::TargetUp => {
            out.emit(json!({ "event": "target_up" }), || {
                format!(
                    "{}  {} Local server is back; delivering.",
                    out.dim(&clock()),
                    out.green("✓")
                )
            });
        }
    }
}

/// Reuse this target's channel when this machine has its key; else adopt the
/// account's channel on the same port (moving its key here); else create one.
async fn resolve_channel(
    session: &Session,
    relay: &RelayClient,
    target: &Target,
    args: &ForwardArgs,
    out: Out,
) -> Result<Channel> {
    let mut map = ChannelMap::load(&session.paths)?;
    let target_key = target.display();
    let signed_in = session.token.is_some();
    let listed = if signed_in && !args.new {
        Some(relay.list_channels().await?)
    } else {
        None
    };

    if !args.new {
        if let Some(id) = map.get(&session.relay_url, &target_key).map(str::to_string) {
            if let Some(key) = ChannelKey::load(&session.paths, &id)? {
                let url = match &listed {
                    Some(list) => list
                        .iter()
                        .find(|c| c.id == id)
                        .map(|c| c.webhook_url.clone()),
                    None => relay.channel_webhook_url(&id).await?,
                };
                if let Some(webhook_url) = url {
                    return Ok(Channel {
                        id,
                        key,
                        webhook_url,
                        how: "reused",
                    });
                }
                out.note(&format!(
                    "{} channel {id} is gone; making a new one.",
                    out.yellow("note:")
                ));
            }
        }

        if let Some(list) = &listed {
            let port = target.port();
            if let Some(existing) = list.iter().find(|c| c.port == port) {
                let key = match ChannelKey::load(&session.paths, &existing.id)? {
                    Some(k) => k,
                    None => {
                        let key = ChannelKey::generate();
                        relay
                            .rotate_key(&existing.id, &key.public_key_hex())
                            .await?;
                        key.save(&session.paths, &existing.id)?;
                        out.note(&format!(
							"{} took over your channel for port {port}: its URL stays the same, and the extension or CLI that forwarded it before stops until it takes it back. Use --new for a separate URL.",
							out.yellow("note:")
						));
                        key
                    }
                };
                map.set(&session.relay_url, &target_key, &existing.id);
                map.save(&session.paths)?;
                return Ok(Channel {
                    id: existing.id.clone(),
                    key,
                    webhook_url: existing.webhook_url.clone(),
                    how: "adopted",
                });
            }
        }
    }

    let key = ChannelKey::generate();
    let created = match relay
        .create_channel(&key.public_key_hex(), target.port(), &args.paths)
        .await
    {
        Ok(c) => c,
        Err(RelayError::Unauthorized) => bail!(
            "{} needs you signed in. Run `bridgehook login` first.",
            session.relay_url
        ),
        Err(e) => return Err(e.into()),
    };
    key.save(&session.paths, &created.channel_id)?;
    map.set(&session.relay_url, &target_key, &created.channel_id);
    map.save(&session.paths)?;
    Ok(Channel {
        id: created.channel_id,
        key,
        webhook_url: created.webhook_url,
        how: "created",
    })
}

/// The drain's view of one channel on the relay and the local target.
struct ChannelDeps {
    relay: RelayClient,
    key: ChannelKey,
    channel_id: String,
    executor: String,
    device_id: Option<String>,
    target: Target,
}

impl DrainDeps for ChannelDeps {
    async fn fetch_pending(&self, after: Option<String>) -> Result<PendingPage> {
        Ok(self
            .relay
            .fetch_pending(&self.channel_id, &self.key, after.as_deref())
            .await?)
    }

    async fn claim(&self, event_id: &str) -> Result<bool> {
        Ok(self
            .relay
            .claim(&self.channel_id, &self.key, event_id, &self.executor)
            .await?)
    }

    async fn probe(&self) -> Result<(), String> {
        self.target.probe().await
    }

    async fn forward(&self, event: &QueuedEvent) -> ForwardOutcome {
        self.target.forward(event).await
    }

    async fn report(&self, event: &QueuedEvent, result: &ForwardResult) -> Result<()> {
        Ok(self
            .relay
            .report(
                &self.channel_id,
                &self.key,
                &event.id,
                result,
                self.device_id.as_deref(),
            )
            .await?)
    }
}
