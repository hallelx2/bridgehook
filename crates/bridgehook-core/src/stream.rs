//! The account's live event stream (`GET /api/me/stream`, Server-Sent
//! Events). It is only a wake-up signal: a `webhook` frame for a channel
//! wakes that channel's drain, which then reads the queue in order, so a
//! live webhook never overtakes older queued ones. Polling stays as the
//! catch-up when the stream is down.

use crate::relay::RelayClient;
use futures_util::StreamExt;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Longest gap between bytes before the stream counts as dead (the relay's
/// heartbeat is every 20 s).
pub const READ_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub channel_id: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
}

/// Splits SSE text into the JSON payloads of its `data:` lines, one per
/// event. Returns the payloads and the unconsumed remainder.
pub fn parse_sse(buffer: &str) -> (Vec<String>, String) {
    let normalized = buffer.replace("\r\n", "\n");
    let mut out = Vec::new();
    let mut rest = normalized.as_str();
    while let Some(end) = rest.find("\n\n") {
        let block = &rest[..end];
        rest = &rest[end + 2..];
        let data: Vec<&str> = block
            .lines()
            .filter_map(|l| l.strip_prefix("data:"))
            .map(|l| l.strip_prefix(' ').unwrap_or(l))
            .collect();
        if !data.is_empty() {
            out.push(data.join("\n"));
        }
    }
    (out, rest.to_string())
}

/// Runs the stream until `stop` is set, reconnecting with backoff (1 s up to
/// 30 s). `connected` reflects whether frames are flowing right now.
pub async fn run(
    relay: RelayClient,
    connected: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    mut on_frame: impl FnMut(Frame) + Send,
) {
    let mut backoff = Duration::from_secs(1);
    while !stop.load(Ordering::Relaxed) {
        let mut req = relay
            .http()
            .get(format!("{}/api/me/stream", relay.base()))
            .header("Accept", "text/event-stream");
        if let Some(t) = relay.token() {
            req = req.bearer_auth(t);
        }
        match req.send().await {
            Ok(res) if res.status().is_success() => {
                backoff = Duration::from_secs(1);
                let mut body = res.bytes_stream();
                let mut buffer = String::new();
                // The relay sends a heartbeat every 20 s; silence past
                // READ_TIMEOUT means a dead connection (sleep, NAT expiry),
                // so reconnect rather than trust it.
                while let Ok(Some(chunk)) = tokio::time::timeout(READ_TIMEOUT, body.next()).await {
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    let Ok(bytes) = chunk else { break };
                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                    let (payloads, rest) = parse_sse(&buffer);
                    buffer = rest;
                    for p in payloads {
                        if let Ok(frame) = serde_json::from_str::<Frame>(&p) {
                            if frame.kind == "connected" {
                                connected.store(true, Ordering::Relaxed);
                            }
                            on_frame(frame);
                        }
                    }
                }
            }
            _ => {}
        }
        connected.store(false, Ordering::Relaxed);
        if stop.load(Ordering::Relaxed) {
            break;
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(30));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_complete_events_and_keeps_the_partial_one() {
        let input = ": heartbeat\n\ndata: {\"type\":\"connected\"}\n\ndata: {\"type\":\"webhook\",\"id\":\"e1\",\"channelId\":\"c1\"}\r\n\r\ndata: {\"type\":\"web";
        let (payloads, rest) = parse_sse(input);
        assert_eq!(payloads.len(), 2);
        let f: Frame = serde_json::from_str(&payloads[1]).unwrap();
        assert_eq!(f.kind, "webhook");
        assert_eq!(f.channel_id.as_deref(), Some("c1"));
        assert_eq!(rest, "data: {\"type\":\"web");
    }
}
