//! Sending one queued webhook to the local target and reading its answer.
//!
//! The target is `http://localhost:<port>` or any URL (`http://api:3000` in
//! a container). The relay's own headers (Cloudflare, forwarding, hop-by-hop)
//! are dropped; everything the sender set is passed through.

use crate::relay::{ForwardResult, QueuedEvent};
use reqwest::{Client, Method};
use std::collections::BTreeMap;
use std::time::{Duration, Instant};
use url::Url;

/// How long a local handler may take before the webhook is recorded as
/// timed out (it is not sent again: the handler may still be running).
pub const FORWARD_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// What happened when the CLI tried the local target.
#[derive(Debug, Clone, PartialEq)]
pub enum ForwardOutcome {
    Response(ForwardResult),
    /// Nothing listening: wait and retry, never counted against the event.
    Down(String),
    /// Reached the target but the request failed (reset, bad response).
    Failed {
        message: String,
        latency_ms: u64,
    },
    /// The handler did not answer within [`FORWARD_TIMEOUT`].
    Timeout {
        message: String,
        latency_ms: u64,
    },
}

const SKIP_HEADERS: &[&str] = &[
    "host",
    "cf-ray",
    "cf-connecting-ip",
    "cf-ipcountry",
    "cf-visitor",
    "x-real-ip",
    "x-forwarded-proto",
    "x-forwarded-for",
    "connection",
    "accept-encoding",
    "transfer-encoding",
    "content-length",
];

#[derive(Clone, Debug)]
pub struct Target {
    base: Url,
    http: Client,
}

impl Target {
    /// `3000` → `http://localhost:3000`; a URL is used as given.
    pub fn parse(spec: &str) -> anyhow::Result<Self> {
        let base = if let Ok(port) = spec.parse::<u16>() {
            Url::parse(&format!("http://localhost:{port}"))?
        } else {
            let url = Url::parse(spec).map_err(|_| {
                anyhow::anyhow!(
                    "`{spec}` is neither a port nor a URL (e.g. 3000 or http://api:3000)"
                )
            })?;
            anyhow::ensure!(
                matches!(url.scheme(), "http" | "https"),
                "target must be http or https: {spec}"
            );
            url
        };
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self { base, http })
    }

    /// The port the relay records for this target's channel.
    pub fn port(&self) -> u16 {
        self.base.port_or_known_default().unwrap_or(80)
    }

    pub fn display(&self) -> String {
        self.base.as_str().trim_end_matches('/').to_string()
    }

    /// The URL a webhook for `event_path` is sent to.
    pub fn url_for(&self, event_path: &str) -> String {
        let base = self.base.as_str().trim_end_matches('/');
        let path = if event_path.is_empty() {
            "/"
        } else {
            event_path
        };
        if path.starts_with('/') {
            format!("{base}{path}")
        } else {
            format!("{base}/{path}")
        }
    }

    /// Is anything listening? Any HTTP answer counts; a refused or failed
    /// connection does not.
    pub async fn probe(&self) -> Result<(), String> {
        match self
            .http
            .head(self.base.as_str())
            .timeout(Duration::from_secs(5))
            .send()
            .await
        {
            Ok(_) => Ok(()),
            Err(e) if e.is_connect() || e.is_timeout() => Err(self.down_message()),
            Err(_) => Ok(()),
        }
    }

    fn down_message(&self) -> String {
        format!("Connection refused: is {} running?", self.display())
    }

    pub async fn forward(&self, event: &QueuedEvent) -> ForwardOutcome {
        let start = Instant::now();
        let path = event_path(event);
        let method = Method::from_bytes(event.method.as_bytes()).unwrap_or(Method::POST);
        let mut req = self
            .http
            .request(method, self.url_for(&path))
            .timeout(FORWARD_TIMEOUT);
        for (k, v) in request_headers(event) {
            req = req.header(k, v);
        }
        if let Some(body) = &event.request_body {
            req = req.body(body.clone());
        }
        let elapsed = || start.elapsed().as_millis() as u64;
        match req.send().await {
            Ok(res) => {
                let status = res.status().as_u16();
                let mut headers = BTreeMap::new();
                for (k, v) in res.headers() {
                    if let Ok(v) = v.to_str() {
                        headers.insert(k.as_str().to_string(), v.to_string());
                    }
                }
                match res.text().await {
                    Ok(body) => ForwardOutcome::Response(ForwardResult {
                        status,
                        headers,
                        body,
                        latency_ms: elapsed(),
                    }),
                    Err(e) if e.is_timeout() => ForwardOutcome::Timeout {
                        message: self.timeout_message(),
                        latency_ms: elapsed(),
                    },
                    Err(e) => ForwardOutcome::Failed {
                        message: e.to_string(),
                        latency_ms: elapsed(),
                    },
                }
            }
            Err(e) if e.is_connect() => ForwardOutcome::Down(self.down_message()),
            Err(e) if e.is_timeout() => ForwardOutcome::Timeout {
                message: self.timeout_message(),
                latency_ms: elapsed(),
            },
            Err(e) => ForwardOutcome::Failed {
                message: e.to_string(),
                latency_ms: elapsed(),
            },
        }
    }

    fn timeout_message(&self) -> String {
        format!(
            "{} did not respond within {} seconds",
            self.display(),
            FORWARD_TIMEOUT.as_secs()
        )
    }
}

/// The path the target receives. Rows written before the relay stored the
/// forward path still carry `/hook/<channelId>`; strip exactly that.
pub fn event_path(event: &QueuedEvent) -> String {
    let raw = event.path.as_str();
    if let Some(ch) = &event.channel_id {
        let legacy = format!("/hook/{ch}");
        if raw == legacy {
            return "/".into();
        }
        if let Some(rest) = raw.strip_prefix(&format!("{legacy}/")) {
            return format!("/{rest}");
        }
    }
    if raw.is_empty() {
        "/".into()
    } else {
        raw.to_string()
    }
}

/// The sender's headers, minus the relay's and hop-by-hop ones.
pub fn request_headers(event: &QueuedEvent) -> Vec<(String, String)> {
    let parsed: BTreeMap<String, serde_json::Value> = event
        .request_headers
        .as_deref()
        .and_then(|h| serde_json::from_str(h).ok())
        .unwrap_or_default();
    parsed
        .into_iter()
        .filter(|(k, _)| !SKIP_HEADERS.contains(&k.to_ascii_lowercase().as_str()))
        .filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_string())))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(path: &str, channel: Option<&str>) -> QueuedEvent {
        QueuedEvent {
			id: "e1".into(),
			method: "POST".into(),
			path: path.into(),
			request_headers: Some(
				r#"{"content-type":"application/json","stripe-signature":"t=1,v1=abc","cf-connecting-ip":"1.2.3.4","host":"x.bridgehook.dev","content-length":"2"}"#.into(),
			),
			request_body: Some("{}".into()),
			channel_id: channel.map(str::to_string),
		}
    }

    #[test]
    fn targets_from_port_or_url() {
        let t = Target::parse("3000").unwrap();
        assert_eq!(t.url_for("/webhook"), "http://localhost:3000/webhook");
        assert_eq!(t.port(), 3000);
        let u = Target::parse("http://api:8080/v1").unwrap();
        assert_eq!(u.url_for("/stripe"), "http://api:8080/v1/stripe");
        assert_eq!(u.port(), 8080);
        assert!(Target::parse("ftp://x").is_err());
        assert!(Target::parse("not a target").is_err());
    }

    #[test]
    fn strips_only_the_legacy_channel_prefix() {
        assert_eq!(event_path(&ev("/hook/abc/stripe", Some("abc"))), "/stripe");
        assert_eq!(event_path(&ev("/hook/abc", Some("abc"))), "/");
        assert_eq!(
            event_path(&ev("/hook/other/x", Some("abc"))),
            "/hook/other/x"
        );
        assert_eq!(event_path(&ev("", None)), "/");
    }

    #[test]
    fn drops_relay_and_hop_headers() {
        let mut h = request_headers(&ev("/x", None));
        h.sort();
        assert_eq!(
            h,
            vec![
                ("content-type".to_string(), "application/json".to_string()),
                ("stripe-signature".to_string(), "t=1,v1=abc".to_string()),
            ]
        );
    }
}
