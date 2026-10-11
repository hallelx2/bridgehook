//! `bridgehook`: a stable public webhook URL that forwards to localhost.
//!
//! Webhooks that arrive while nothing is forwarding wait on the relay and
//! are delivered in order when `bridgehook forward` runs again.

mod forward;
mod output;

use anyhow::{Context, Result};
use bridgehook_core::auth;
use bridgehook_core::config::{self, Paths, StoredToken};
use bridgehook_core::relay::{RelayClient, RelayError};
use bridgehook_core::DEFAULT_RELAY_URL;
use clap::{Parser, Subcommand};
use output::Out;
use serde_json::json;
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "bridgehook", version, about, propagate_version = true)]
struct Cli {
    /// Relay to use (defaults to the relay you signed in to, else the hosted one).
    #[arg(long, env = "BRIDGEHOOK_RELAY", global = true)]
    relay: Option<String>,

    /// Print one JSON object per line instead of readable text.
    #[arg(long, global = true)]
    json: bool,

    /// Where the token, keys and channel list are kept.
    #[arg(
        long,
        env = "BRIDGEHOOK_CONFIG_DIR",
        global = true,
        hide_env_values = true
    )]
    config_dir: Option<PathBuf>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Pair this machine with your BridgeHook account.
    Login {
        /// Pair again even if this machine is already signed in.
        #[arg(long)]
        force: bool,
        /// Print the approval link instead of opening a browser.
        #[arg(long)]
        no_browser: bool,
    },
    /// Revoke this machine's token and forget it.
    Logout,
    /// Show the account this machine is signed in to.
    Whoami,
    /// Forward webhooks to a local port or URL (e.g. 3000, http://api:8080).
    Forward(forward::ForwardArgs),
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    let out = Out::new(cli.json);
    let code = match run(cli, out).await {
        Ok(code) => code,
        Err(e) => {
            out.error(&format!("{e:#}"));
            1
        }
    };
    std::process::exit(code);
}

/// The relay, token and paths every command works from.
pub struct Session {
    pub paths: Paths,
    pub relay_url: String,
    pub stored: Option<StoredToken>,
    /// The token in use: `BRIDGEHOOK_TOKEN`, else the stored one for this relay.
    pub token: Option<String>,
}

impl Session {
    fn open(cli: &Cli, out: Out) -> Result<Self> {
        let paths = match &cli.config_dir {
            Some(dir) => Paths::at(dir),
            None => Paths::discover()?,
        };
        let stored = config::load_token(&paths)?;
        let relay_url = cli
            .relay
            .clone()
            .or_else(|| stored.as_ref().map(|t| t.relay.clone()))
            .unwrap_or_else(|| DEFAULT_RELAY_URL.to_string())
            .trim_end_matches('/')
            .to_string();
        let env_token = std::env::var("BRIDGEHOOK_TOKEN")
            .ok()
            .filter(|t| !t.trim().is_empty());
        let stored_token = match &stored {
            Some(t) if t.relay == relay_url => Some(t.token.clone()),
            Some(t) => {
                out.note(&format!(
                    "{} signed in to {}, not {relay_url}; continuing signed out",
                    out.yellow("note:"),
                    t.relay
                ));
                None
            }
            None => None,
        };
        Ok(Self {
            paths,
            relay_url,
            token: env_token.or(stored_token),
            stored,
        })
    }

    pub fn client(&self) -> Result<RelayClient> {
        RelayClient::new(&self.relay_url, self.token.clone())
    }

    /// The stored device id, when the token in use is the stored one.
    pub fn device_id(&self) -> Option<&str> {
        match (&self.stored, &self.token) {
            (Some(s), Some(t)) if &s.token == t && s.relay == self.relay_url => Some(&s.device_id),
            _ => None,
        }
    }
}

async fn run(cli: Cli, out: Out) -> Result<i32> {
    let session = Session::open(&cli, out)?;
    match cli.command {
        Command::Login { force, no_browser } => login(&session, out, force, no_browser).await,
        Command::Logout => logout(&session, out).await,
        Command::Whoami => whoami(&session, out).await,
        Command::Forward(args) => forward::run(&session, out, args).await,
    }
}

async fn login(session: &Session, out: Out, force: bool, no_browser: bool) -> Result<i32> {
    if !force {
        if let (Some(stored), Some(_)) = (&session.stored, &session.token) {
            if stored.relay == session.relay_url {
                match session.client()?.me().await {
                    Ok(me) => {
                        out.emit(
							json!({ "event": "signed_in", "email": me.user.email, "relay": session.relay_url, "deviceId": stored.device_id }),
							|| format!("Already signed in as {} ({}). Use --force to pair again.", out.bold(&me.user.email), session.relay_url),
						);
                        return Ok(0);
                    }
                    Err(RelayError::Unauthorized) => {
                        out.note("The saved token was revoked; pairing again.");
                    }
                    Err(e) => return Err(e.into()),
                }
            }
        }
    }

    let relay = RelayClient::new(&session.relay_url, None)?;
    let minted = auth::pair(&relay, &auth::label_hint(), |start| {
		let opened = !no_browser && !out.json && open_browser(&start.verification_url);
		out.emit(
			json!({ "event": "pairing", "code": start.device_code, "url": start.verification_url, "expiresIn": start.expires_in }),
			|| {
				let how = if opened { "Approve in the browser window that just opened, or open" } else { "Open" };
				format!(
					"{how}:\n\n  {}\n\nand check the code matches: {}\n\n{}",
					out.bold(&start.verification_url),
					out.bold(&start.device_code),
					out.dim("Waiting for approval…")
				)
			},
		);
	})
	.await?;

    let token = StoredToken {
        token: minted.token,
        device_id: minted.device_id.clone(),
        user_id: minted.user_id,
        label: minted.label.clone(),
        relay: session.relay_url.clone(),
    };
    config::save_token(&session.paths, &token)?;
    let email = RelayClient::new(&session.relay_url, Some(token.token.clone()))?
        .me()
        .await
        .map(|m| m.user.email)
        .ok();
    out.emit(
		json!({ "event": "signed_in", "email": email, "relay": session.relay_url, "deviceId": minted.device_id, "label": minted.label }),
		|| match &email {
			Some(e) => format!("{} Signed in as {} on this machine ({}).", out.green("✓"), out.bold(e), minted.label),
			None => format!("{} Signed in ({}).", out.green("✓"), minted.label),
		},
	);
    Ok(0)
}

async fn logout(session: &Session, out: Out) -> Result<i32> {
    let Some(stored) = &session.stored else {
        out.emit(json!({ "event": "signed_out", "revoked": false }), || {
            "Not signed in.".into()
        });
        return Ok(0);
    };
    let relay = RelayClient::new(&stored.relay, Some(stored.token.clone()))?;
    let revoked = match relay.revoke_device(&stored.device_id).await {
        Ok(()) => true,
        // Already revoked (from the dashboard, say): nothing left to end.
        Err(RelayError::Unauthorized) => true,
        Err(e) => {
            out.note(&format!(
				"{} could not revoke the token on {} ({e}); it is removed from this machine. Revoke it from the dashboard's Devices page.",
				out.yellow("warning:"),
				stored.relay
			));
            false
        }
    };
    config::remove_token(&session.paths).context("removing the saved token")?;
    out.emit(
        json!({ "event": "signed_out", "revoked": revoked, "relay": stored.relay }),
        || format!("{} Signed out of {}.", out.green("✓"), stored.relay),
    );
    Ok(if revoked { 0 } else { 1 })
}

async fn whoami(session: &Session, out: Out) -> Result<i32> {
    if session.token.is_none() {
        out.emit(
            json!({ "event": "whoami", "signedIn": false, "relay": session.relay_url }),
            || {
                format!(
                    "Not signed in to {}. Run `bridgehook login`.",
                    session.relay_url
                )
            },
        );
        return Ok(1);
    }
    let me = session.client()?.me().await?;
    let label = session
        .stored
        .as_ref()
        .filter(|_| session.device_id().is_some())
        .map(|s| s.label.clone());
    out.emit(
        json!({
            "event": "whoami",
            "signedIn": true,
            "email": me.user.email,
            "plan": me.plan,
            "eventsToday": me.events_today,
            "eventsPerDay": me.events_per_day,
            "relay": session.relay_url,
            "deviceId": session.device_id(),
            "device": label,
        }),
        || {
            let cap = me
                .events_per_day
                .map(|n| n.to_string())
                .unwrap_or_else(|| "unlimited".into());
            let mut s = format!(
                "{}\n  plan     {}\n  today    {} of {cap} webhooks\n  relay    {}",
                out.bold(&me.user.email),
                me.plan,
                me.events_today,
                session.relay_url
            );
            if let Some(l) = &label {
                s.push_str(&format!("\n  device   {l}"));
            }
            s
        },
    );
    Ok(0)
}

/// Best effort: opens the approval page in the default browser.
fn open_browser(url: &str) -> bool {
    use std::process::{Command, Stdio};
    let mut cmd = if cfg!(target_os = "macos") {
        let mut c = Command::new("open");
        c.arg(url);
        c
    } else if cfg!(target_os = "windows") {
        let mut c = Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", url]);
        c
    } else {
        if std::env::var_os("DISPLAY").is_none() && std::env::var_os("WAYLAND_DISPLAY").is_none() {
            return false;
        }
        let mut c = Command::new("xdg-open");
        c.arg(url);
        c
    };
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .is_ok()
}
