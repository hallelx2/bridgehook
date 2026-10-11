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
use bridgehook_core::relay::{
    ChannelInfo, ForwardResult, PendingPage, QueuedEvent, RelayClient, RelayError,
};
use bridgehook_core::stream;
use serde_json::json;
use std::collections::BTreeSet;
use std::io::{BufRead, IsTerminal, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;

const POLL_WITHOUT_STREAM: Duration = Duration::from_secs(2);
const POLL_WITH_STREAM: Duration = Duration::from_secs(30);
const BLOCKED_WAIT: Duration = Duration::from_secs(10);
const QUOTA_WAIT: Duration = Duration::from_secs(60);
const RETRY_MIN: Duration = Duration::from_secs(2);
/// Relay trouble backs off further than a local server that is down, which
/// should be picked up within seconds of coming back.
const RETRY_MAX_RELAY: Duration = Duration::from_secs(15);
const RETRY_MAX_TARGET: Duration = Duration::from_secs(5);

#[derive(clap::Args)]
pub struct ForwardArgs {
    /// Local port (3000) or URL (http://api:8080/base).
    target: String,
    /// Only accept webhooks under this path (repeatable). Applied to a reused
    /// channel too; without it, a reused channel keeps its paths.
    #[arg(long = "path", value_name = "PATH", conflicts_with = "any_path")]
    paths: Vec<String>,
    /// Accept webhooks on any path (clears a previous --path).
    #[arg(long)]
    any_path: bool,
    /// Make a new channel (and a new URL) instead of reusing this target's.
    #[arg(long, conflicts_with = "adopt")]
    new: bool,
    /// Take over your account's channel on this port without asking, even if
    /// another device (the extension, another machine) forwards it now.
    #[arg(long)]
    adopt: bool,
}

/// The channel this run forwards for.
struct Channel {
    id: String,
    key: ChannelKey,
    webhook_url: String,
    allowed_paths: Option<Vec<String>>,
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
    apply_paths(session, &relay, &channel, &args, out).await?;
    let executor = config::executor_id(&session.paths)?;

    // Ctrl-C (or SIGTERM from `docker stop` / systemd): finish the webhook in
    // hand, then stop; a second one quits at once. The handlers are
    // registered here, before `ready` is printed, so a signal right after it
    // cannot reach the default handler and kill the process mid-delivery.
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = Arc::new(Notify::new());
    let mut signals = StopSignals::register()?;
    {
        let (stop, stopped) = (stop.clone(), stopped.clone());
        tokio::spawn(async move {
            signals.next().await;
            stop.store(true, Ordering::SeqCst);
            stopped.notify_one();
            if !out.json {
                eprintln!("\nStopping after the current webhook; Ctrl-C again to quit now.");
            }
            signals.next().await;
            std::process::exit(130);
        });
    }

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

    // The live stream needs a signed-in token; signed out, the queue is polled.
    let wake = Arc::new(Notify::new());
    let connected = Arc::new(AtomicBool::new(false));
    if session.token.is_some() {
        tokio::spawn(report_stream_state(out, connected.clone(), stop.clone()));
        let (relay, connected, stop, wake) =
            (relay.clone(), connected.clone(), stop.clone(), wake.clone());
        let ours = channel.id.clone();
        tokio::spawn(async move {
            stream::run(relay, connected, stop, move |frame| {
                let mine = frame.channel_id.as_deref() == Some(ours.as_str());
                out.debug(|| {
                    format!(
                        "stream frame {} channel={} id={}{}",
                        frame.kind,
                        frame.channel_id.as_deref().unwrap_or("-"),
                        frame.id.as_deref().unwrap_or("-"),
                        if frame.kind == "webhook" && mine {
                            " (wake)"
                        } else {
                            ""
                        }
                    )
                });
                if frame.kind == "webhook" && mine {
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
        let started = std::time::Instant::now();
        let result = drainer.pass(&deps, &mut notify).await;
        out.debug(|| match &result {
            Ok(r) => format!("pass {r:?} in {} ms", started.elapsed().as_millis()),
            Err(e) => format!("pass failed in {} ms: {e:#}", started.elapsed().as_millis()),
        });
        let wait = match result {
            Ok(PassResult::Idle) => {
                retry = RETRY_MIN;
                if connected.load(Ordering::Relaxed) {
                    POLL_WITH_STREAM
                } else {
                    POLL_WITHOUT_STREAM
                }
            }
            Ok(PassResult::Blocked) => {
                retry = RETRY_MIN;
                BLOCKED_WAIT
            }
            Ok(PassResult::Retry) => next_retry(
                &mut retry,
                if drainer.target_down() { RETRY_MAX_TARGET } else { RETRY_MAX_RELAY },
            ),
            Err(e) => match e.downcast_ref::<RelayError>() {
                Some(RelayError::Unauthorized) => bail!(
                    "the relay no longer accepts this machine's key for {}: another client (the extension or another CLI) took the channel. Run `bridgehook forward {} --adopt` to take it back.",
                    channel.webhook_url,
                    args.target
                ),
                Some(RelayError::ChannelGone) => bail!(
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
                    let w = next_retry(&mut retry, RETRY_MAX_RELAY);
                    out.emit(
                        json!({ "event": "relay_error", "message": format!("{e:#}"), "retryInMs": w.as_millis() as u64 }),
                        || format!("{} {e:#} (retrying in {}s)", out.yellow("relay:"), w.as_secs()),
                    );
                    w
                }
            },
        };
        if stop.load(Ordering::SeqCst) {
            break;
        }
        // Wait for the timer or Ctrl-C, or for the stream to report a
        // webhook (useless while the local server is down).
        out.debug(|| format!("waiting up to {} ms", wait.as_millis()));
        let woke = if drainer.target_down() {
            tokio::select! {
                _ = stopped.notified() => "stop",
                _ = tokio::time::sleep(wait) => "timer",
            }
        } else {
            tokio::select! {
                _ = stopped.notified() => "stop",
                _ = wake.notified() => "stream",
                _ = tokio::time::sleep(wait) => "timer",
            }
        };
        out.debug(|| format!("woken by {woke}"));
    }
    out.emit(json!({ "event": "stopped" }), || "Stopped.".into());
    Ok(0)
}

/// SIGINT and SIGTERM on Unix, Ctrl-C and Ctrl-Break on Windows, registered
/// when created.
struct StopSignals {
    #[cfg(unix)]
    int: tokio::signal::unix::Signal,
    #[cfg(unix)]
    term: tokio::signal::unix::Signal,
    #[cfg(windows)]
    c: tokio::signal::windows::CtrlC,
    #[cfg(windows)]
    brk: tokio::signal::windows::CtrlBreak,
}

impl StopSignals {
    fn register() -> Result<Self> {
        #[cfg(unix)]
        {
            use tokio::signal::unix::{signal, SignalKind};
            Ok(Self {
                int: signal(SignalKind::interrupt())?,
                term: signal(SignalKind::terminate())?,
            })
        }
        #[cfg(windows)]
        {
            Ok(Self {
                c: tokio::signal::windows::ctrl_c()?,
                brk: tokio::signal::windows::ctrl_break()?,
            })
        }
    }

    async fn next(&mut self) {
        #[cfg(unix)]
        tokio::select! {
            _ = self.int.recv() => {}
            _ = self.term.recv() => {}
        }
        #[cfg(windows)]
        tokio::select! {
            _ = self.c.recv() => {}
            _ = self.brk.recv() => {}
        }
    }
}

fn next_retry(retry: &mut Duration, max: Duration) -> Duration {
    let w = (*retry).min(max);
    *retry = (*retry * 2).min(max);
    w
}

/// Reports when the live stream connects or drops (polling takes over).
async fn report_stream_state(out: Out, connected: Arc<AtomicBool>, stop: Arc<AtomicBool>) {
    let mut last = false;
    while !stop.load(Ordering::Relaxed) {
        let now = connected.load(Ordering::Relaxed);
        if now != last {
            last = now;
            out.emit(json!({ "event": "stream", "connected": now }), || {
                if now {
                    format!("{}  {} live", out.dim(&clock()), out.green("●"))
                } else {
                    format!(
                        "{}  {} live updates lost; checking every {} s until they are back",
                        out.dim(&clock()),
                        out.yellow("○"),
                        POLL_WITHOUT_STREAM.as_secs()
                    )
                }
            });
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
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

/// The paths a channel should accept after this run, when the flags change
/// them: `--path` sets them, `--any-path` clears them, neither keeps them.
fn wanted_paths(args: &ForwardArgs) -> Option<Vec<String>> {
    if args.any_path {
        Some(Vec::new())
    } else if !args.paths.is_empty() {
        Some(args.paths.clone())
    } else {
        None
    }
}

/// Brings a reused or adopted channel's allowed paths in line with the flags.
async fn apply_paths(
    session: &Session,
    relay: &RelayClient,
    channel: &Channel,
    args: &ForwardArgs,
    out: Out,
) -> Result<()> {
    let Some(wanted) = wanted_paths(args) else {
        return Ok(());
    };
    if channel.how == "created" {
        return Ok(());
    }
    let same = |have: &[String]| {
        have.iter().collect::<BTreeSet<_>>() == wanted.iter().collect::<BTreeSet<_>>()
    };
    if channel.allowed_paths.as_deref().is_some_and(same) {
        return Ok(());
    }
    if session.token.is_none() {
        bail!(
            "changing which paths a channel accepts needs you signed in (`bridgehook login`), or use --new for a channel made with these paths"
        );
    }
    relay.set_allowed_paths(&channel.id, &wanted).await?;
    out.note(&format!(
        "{} this URL now accepts {}.",
        out.dim("paths:"),
        if wanted.is_empty() {
            "any path".to_string()
        } else {
            wanted.join(", ")
        }
    ));
    Ok(())
}

/// Reuse this target's channel when this machine has its key; else adopt the
/// account's channel on the same port (moving its key here, after asking);
/// else create one.
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
                let found = match &listed {
                    Some(list) => list
                        .iter()
                        .find(|c| c.id == id)
                        .map(|c| (c.webhook_url.clone(), Some(c.allowed_paths.clone()))),
                    None => relay.channel_webhook_url(&id).await?.map(|u| (u, None)),
                };
                if let Some((webhook_url, allowed_paths)) = found {
                    return Ok(Channel {
                        id,
                        key,
                        webhook_url,
                        allowed_paths,
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
                        confirm_takeover(session, existing, args, out)?;
                        let key = ChannelKey::generate();
                        relay
                            .rotate_key(&existing.id, &key.public_key_hex())
                            .await?;
                        key.save(&session.paths, &existing.id)?;
                        key
                    }
                };
                map.set(&session.relay_url, &target_key, &existing.id);
                map.save(&session.paths)?;
                return Ok(Channel {
                    id: existing.id.clone(),
                    key,
                    webhook_url: existing.webhook_url.clone(),
                    allowed_paths: Some(existing.allowed_paths.clone()),
                    how: "adopted",
                });
            }
        }
    }

    let key = ChannelKey::generate();
    let paths = wanted_paths(args).unwrap_or_default();
    let created = match relay
        .create_channel(&key.public_key_hex(), target.port(), &paths)
        .await
    {
        Ok(c) => c,
        Err(RelayError::Unauthorized) => {
            bail!(
                "{} needs you signed in. Run `bridgehook login` first.",
                session.relay_url
            )
        }
        Err(e) => return Err(e.into()),
    };
    key.save(&session.paths, &created.channel_id)?;
    map.set(&session.relay_url, &target_key, &created.channel_id);
    map.save(&session.paths)?;
    Ok(Channel {
        id: created.channel_id,
        key,
        webhook_url: created.webhook_url,
        allowed_paths: Some(paths),
        how: "created",
    })
}

/// Taking over a channel moves its key here, so whatever forwards it now
/// (usually the extension) stops. Ask first, unless this device made it or
/// `--adopt` says so; a script without `--adopt` gets an error, not a guess.
fn confirm_takeover(
    session: &Session,
    existing: &ChannelInfo,
    args: &ForwardArgs,
    out: Out,
) -> Result<()> {
    let ours = existing
        .device
        .as_ref()
        .is_some_and(|d| Some(d.id.as_str()) == session.device_id());
    if args.adopt || ours {
        return Ok(());
    }
    let owner = existing
        .device
        .as_ref()
        .and_then(|d| d.label.clone().or_else(|| d.kind.clone()))
        .unwrap_or_else(|| "another client".into());
    let what = format!(
        "Your account already has {} on port {}, made by {owner}. Taking it over keeps that URL, and {owner} stops forwarding it.",
        existing.webhook_url, existing.port
    );
    let interactive =
        !out.json && std::io::stdin().is_terminal() && std::io::stderr().is_terminal();
    if !interactive {
        bail!("{what} Pass --adopt to take it over, or --new for a separate URL.");
    }
    eprint!("{what}\nTake it over? [Y/n] (n makes a separate URL with --new) ");
    let _ = std::io::stderr().flush();
    let mut answer = String::new();
    std::io::stdin().lock().read_line(&mut answer)?;
    match answer.trim().to_ascii_lowercase().as_str() {
        "" | "y" | "yes" => Ok(()),
        _ => bail!(
            "not taken over. Run `bridgehook forward {} --new` for a separate URL.",
            args.target
        ),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn args(paths: &[&str], any: bool) -> ForwardArgs {
        ForwardArgs {
            target: "3000".into(),
            paths: paths.iter().map(|s| s.to_string()).collect(),
            any_path: any,
            new: false,
            adopt: false,
        }
    }

    #[test]
    fn path_flags_set_clear_or_keep() {
        assert_eq!(
            wanted_paths(&args(&["/a", "/b"], false)),
            Some(vec!["/a".into(), "/b".into()])
        );
        assert_eq!(wanted_paths(&args(&[], true)), Some(vec![]));
        assert_eq!(wanted_paths(&args(&[], false)), None);
    }

    #[test]
    fn retry_backoff_caps_per_cause() {
        let mut r = RETRY_MIN;
        let waits: Vec<u64> = (0..5)
            .map(|_| next_retry(&mut r, RETRY_MAX_TARGET).as_secs())
            .collect();
        assert_eq!(waits, vec![2, 4, 5, 5, 5]);
    }
}
