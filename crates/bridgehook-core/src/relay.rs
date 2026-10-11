//! The relay API, typed. Account calls use the device token
//! (`Authorization: Bearer dvc_…`); executor calls on a channel are signed
//! with the channel's key ([`ChannelKey`]).

use crate::keys::ChannelKey;
use anyhow::Result;
use reqwest::{Client, Method, RequestBuilder, Response, StatusCode};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::Duration;

/// A relay answer that was not a success, with its status and message.
#[derive(Debug, thiserror::Error)]
pub enum RelayError {
    #[error("{message}")]
    Quota { message: String },
    #[error("not signed in to this relay (HTTP 401); run `bridgehook login`")]
    Unauthorized,
    #[error("relay answered {status}: {message}")]
    Status { status: u16, message: String },
    #[error("could not reach the relay: {0}")]
    Network(#[from] reqwest::Error),
}

#[derive(Debug, Clone, Deserialize)]
pub struct Me {
    pub user: MeUser,
    pub plan: String,
    #[serde(rename = "eventsPerDay")]
    pub events_per_day: Option<u64>,
    #[serde(rename = "eventsToday", default)]
    pub events_today: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MeUser {
    pub id: String,
    pub email: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelInfo {
    pub id: String,
    pub port: u16,
    pub webhook_url: String,
    #[serde(default)]
    pub allowed_paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedChannel {
    pub channel_id: String,
    pub port: u16,
    pub webhook_url: String,
}

/// One webhook waiting in a channel's delivery queue.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueuedEvent {
    pub id: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub path: String,
    /// JSON object of the request headers, as stored by the relay.
    #[serde(default)]
    pub request_headers: Option<String>,
    #[serde(default)]
    pub request_body: Option<String>,
    #[serde(default)]
    pub channel_id: Option<String>,
}

fn default_method() -> String {
    "POST".into()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPage {
    #[serde(default)]
    pub events: Vec<QueuedEvent>,
    #[serde(default)]
    pub next_cursor: Option<String>,
}

/// The local server's answer, as reported back to the relay.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ForwardResult {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: String,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStart {
    pub device_code: String,
    pub verification_url: String,
    #[serde(default = "default_poll")]
    pub poll_interval: u64,
    #[serde(default = "default_expires")]
    pub expires_in: u64,
}
fn default_poll() -> u64 {
    5
}
fn default_expires() -> u64 {
    900
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceMinted {
    pub token: String,
    pub device_id: String,
    pub user_id: String,
    #[serde(default)]
    pub label: String,
}

/// What one exchange poll answered.
#[derive(Debug)]
pub enum ExchangePoll {
    Minted(DeviceMinted),
    Pending,
    Expired,
    /// 429: wait this long, then poll again.
    RetryAfter(Duration),
    /// 5xx or a network error: back off and poll again.
    Transient(String),
    /// Any other 4xx: stop with the relay's message.
    Failed(u16, String),
}

pub const MAX_STORED_BODY_BYTES: usize = 1_048_576;
const MAX_STORED_HEADER_BYTES: usize = 16 * 1024;

#[derive(Clone)]
pub struct RelayClient {
    base: String,
    http: Client,
    token: Option<String>,
}

impl RelayClient {
    pub fn new(base: &str, token: Option<String>) -> Result<Self> {
        let http = Client::builder()
            .user_agent(concat!("bridgehook-cli/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(15))
            .build()?;
        Ok(Self {
            base: base.trim_end_matches('/').to_string(),
            http,
            token,
        })
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    pub fn token(&self) -> Option<&str> {
        self.token.as_deref()
    }

    pub fn http(&self) -> &Client {
        &self.http
    }

    fn authed(&self, method: Method, path: &str) -> RequestBuilder {
        let mut req = self.http.request(method, format!("{}{}", self.base, path));
        if let Some(t) = &self.token {
            req = req.bearer_auth(t);
        }
        req.timeout(Duration::from_secs(30))
    }

    fn signed(
        &self,
        key: &ChannelKey,
        method: Method,
        path_and_query: &str,
        body: Option<String>,
    ) -> RequestBuilder {
        let pathname = path_and_query.split('?').next().unwrap_or(path_and_query);
        let body_str = body.clone().unwrap_or_default();
        let (ts, sig) = key.sign_request(method.as_str(), pathname, &body_str);
        let mut req = self
            .http
            .request(method, format!("{}{}", self.base, path_and_query))
            .header("X-BH-Timestamp", ts)
            .header("X-BH-Signature", sig)
            .timeout(Duration::from_secs(30));
        if let Some(b) = body {
            req = req.header("Content-Type", "application/json").body(b);
        }
        req
    }

    pub async fn me(&self) -> Result<Me, RelayError> {
        json_or_error(self.authed(Method::GET, "/api/me").send().await?).await
    }

    pub async fn list_channels(&self) -> Result<Vec<ChannelInfo>, RelayError> {
        #[derive(Deserialize)]
        struct List {
            channels: Vec<ChannelInfo>,
        }
        let list: List =
            json_or_error(self.authed(Method::GET, "/api/me/channels").send().await?).await?;
        Ok(list.channels)
    }

    pub async fn create_channel(
        &self,
        public_key: &str,
        port: u16,
        allowed_paths: &[String],
    ) -> Result<CreatedChannel, RelayError> {
        let body = serde_json::json!({ "publicKey": public_key, "port": port, "allowedPaths": allowed_paths });
        json_or_error(
            self.authed(Method::POST, "/api/channels")
                .json(&body)
                .send()
                .await?,
        )
        .await
    }

    /// Puts a new public key on a channel this account owns (adopting a
    /// channel whose private key this machine does not have).
    pub async fn rotate_key(&self, channel_id: &str, public_key: &str) -> Result<(), RelayError> {
        let body = serde_json::json!({ "publicKey": public_key });
        let res = self
            .authed(
                Method::POST,
                &format!("/api/me/channels/{channel_id}/rotate-key"),
            )
            .json(&body)
            .send()
            .await?;
        ok_or_error(res).await
    }

    /// The public URL of a channel, from the channel's own endpoint (answers
    /// without sign-in, so it works on a self-hosted relay too). `None` when
    /// the channel is gone or expired.
    pub async fn channel_webhook_url(
        &self,
        channel_id: &str,
    ) -> Result<Option<String>, RelayError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Info {
            webhook_url: String,
        }
        let res = self
            .http
            .get(format!("{}/hook/{channel_id}", self.base))
            .header("Accept", "application/json")
            .timeout(Duration::from_secs(30))
            .send()
            .await?;
        match res.status().as_u16() {
            404 | 410 => Ok(None),
            _ => Ok(Some(json_or_error::<Info>(res).await?.webhook_url)),
        }
    }

    /// Revokes a device. With a device token, only that device's own id is
    /// accepted, which is how `bridgehook logout` ends its token.
    pub async fn revoke_device(&self, device_id: &str) -> Result<(), RelayError> {
        ok_or_error(
            self.authed(Method::DELETE, &format!("/api/me/devices/{device_id}"))
                .send()
                .await?,
        )
        .await
    }

    pub async fn device_start(
        &self,
        kind: &str,
        label_hint: &str,
    ) -> Result<DeviceStart, RelayError> {
        let body = serde_json::json!({ "kind": kind, "labelHint": label_hint });
        let res = self
            .http
            .post(format!("{}/auth/device/start", self.base))
            .json(&body)
            .timeout(Duration::from_secs(30))
            .send()
            .await?;
        json_or_error(res).await
    }

    pub async fn device_exchange(&self, code: &str) -> ExchangePoll {
        let res = self
            .http
            .post(format!("{}/auth/device/exchange", self.base))
            .json(&serde_json::json!({ "code": code }))
            .timeout(Duration::from_secs(30))
            .send()
            .await;
        let res = match res {
            Ok(r) => r,
            Err(e) => return ExchangePoll::Transient(e.to_string()),
        };
        let status = res.status();
        match status.as_u16() {
            200 => match res.json::<DeviceMinted>().await {
                Ok(m) => ExchangePoll::Minted(m),
                Err(e) => ExchangePoll::Failed(200, format!("unexpected answer: {e}")),
            },
            202 => ExchangePoll::Pending,
            410 => ExchangePoll::Expired,
            429 => {
                let secs = res
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(60);
                ExchangePoll::RetryAfter(Duration::from_secs(secs.clamp(1, 60)))
            }
            s if s >= 500 => ExchangePoll::Transient(format!("relay answered {s}")),
            s => ExchangePoll::Failed(s, error_text(res).await),
        }
    }

    pub async fn fetch_pending(
        &self,
        channel_id: &str,
        key: &ChannelKey,
        after: Option<&str>,
    ) -> Result<PendingPage, RelayError> {
        let mut path = format!("/api/channels/{channel_id}/events?pending=1&limit=100");
        if let Some(a) = after {
            path.push_str("&after=");
            path.push_str(&url::form_urlencoded::byte_serialize(a.as_bytes()).collect::<String>());
        }
        json_or_error(self.signed(key, Method::GET, &path, None).send().await?).await
    }

    /// True when this executor holds the claim (new, or one it already held).
    pub async fn claim(
        &self,
        channel_id: &str,
        key: &ChannelKey,
        event_id: &str,
        client_id: &str,
    ) -> Result<bool, RelayError> {
        let body = serde_json::json!({ "eventId": event_id, "clientId": client_id }).to_string();
        let res = self
            .signed(
                key,
                Method::POST,
                &format!("/hook/{channel_id}/claim"),
                Some(body),
            )
            .send()
            .await?;
        match res.status() {
            s if s.is_success() => Ok(true),
            StatusCode::CONFLICT => {
                let v: serde_json::Value = res.json().await.unwrap_or_default();
                Ok(v.get("claimerId").and_then(|c| c.as_str()) == Some(client_id))
            }
            StatusCode::NOT_FOUND => Ok(false),
            _ => Err(status_error(res).await),
        }
    }

    /// Stores the local server's answer. Retries once with a trimmed answer
    /// when the relay refuses the size, so the event is not delivered again.
    pub async fn report(
        &self,
        channel_id: &str,
        key: &ChannelKey,
        event_id: &str,
        result: &ForwardResult,
        device_id: Option<&str>,
    ) -> Result<(), RelayError> {
        let post = |r: &ForwardResult| {
            let mut body = serde_json::json!({
                "eventId": event_id,
                "status": r.status,
                "headers": r.headers,
                "body": r.body,
                "latencyMs": r.latency_ms,
            });
            if let Some(d) = device_id {
                body["deviceId"] = d.into();
            }
            self.signed(
                key,
                Method::POST,
                &format!("/hook/{channel_id}/response"),
                Some(body.to_string()),
            )
            .send()
        };
        let mut res = post(result).await?;
        if matches!(res.status().as_u16(), 413 | 431) {
            res = post(&fit_response(result)).await?;
        }
        ok_or_error(res).await
    }
}

/// Trims an answer to what the relay stores (1 MiB body, 16 KiB headers).
pub fn fit_response(r: &ForwardResult) -> ForwardResult {
    let mut out = r.clone();
    let bytes = r.body.as_bytes();
    if bytes.len() > MAX_STORED_BODY_BYTES - 2048 {
        let note = format!(
            "\n\n[BridgeHook: response body truncated from {} bytes]",
            bytes.len()
        );
        let mut cut = MAX_STORED_BODY_BYTES - 2048 - note.len();
        while cut > 0 && !r.body.is_char_boundary(cut) {
            cut -= 1;
        }
        out.body = format!("{}{}", &r.body[..cut], note);
    }
    let mut size = 0;
    out.headers = BTreeMap::new();
    for (k, v) in &r.headers {
        size += k.len() + v.len() + 4;
        if size > MAX_STORED_HEADER_BYTES {
            break;
        }
        out.headers.insert(k.clone(), v.clone());
    }
    out
}

async fn error_text(res: Response) -> String {
    let text = res.text().await.unwrap_or_default();
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
        .unwrap_or(text)
}

async fn status_error(res: Response) -> RelayError {
    let status = res.status().as_u16();
    if status == 401 {
        return RelayError::Unauthorized;
    }
    let text = res.text().await.unwrap_or_default();
    let parsed = serde_json::from_str::<serde_json::Value>(&text).ok();
    let message = parsed
        .as_ref()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
        .unwrap_or(text);
    if status == 402
        && parsed
            .as_ref()
            .and_then(|v| v.get("code"))
            .and_then(|c| c.as_str())
            == Some("quota")
    {
        return RelayError::Quota { message };
    }
    RelayError::Status { status, message }
}

async fn json_or_error<T: for<'de> Deserialize<'de>>(res: Response) -> Result<T, RelayError> {
    if !res.status().is_success() {
        return Err(status_error(res).await);
    }
    Ok(res.json::<T>().await?)
}

async fn ok_or_error(res: Response) -> Result<(), RelayError> {
    if !res.status().is_success() {
        return Err(status_error(res).await);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_response_trims_body_on_a_char_boundary_and_caps_headers() {
        let big = "é".repeat(MAX_STORED_BODY_BYTES); // 2 bytes each
        let mut headers = BTreeMap::new();
        for i in 0..2000 {
            headers.insert(format!("x-header-{i:04}"), "v".repeat(20));
        }
        let r = ForwardResult {
            status: 200,
            headers,
            body: big,
            latency_ms: 5,
        };
        let fitted = fit_response(&r);
        assert!(fitted.body.len() <= MAX_STORED_BODY_BYTES);
        assert!(fitted.body.ends_with("truncated from 2097152 bytes]"));
        let header_bytes: usize = fitted
            .headers
            .iter()
            .map(|(k, v)| k.len() + v.len() + 4)
            .sum();
        assert!(header_bytes <= MAX_STORED_HEADER_BYTES);
        assert!(!fitted.headers.is_empty());
    }

    #[test]
    fn queued_event_parses_relay_rows() {
        let page: PendingPage = serde_json::from_str(
			r#"{"events":[{"id":"e1","channelId":"c1","method":"POST","path":"/webhook","requestHeaders":"{\"x\":\"1\"}","requestBody":"{}","receivedAt":1}],"nextCursor":"abc"}"#,
		)
		.unwrap();
        assert_eq!(page.events[0].id, "e1");
        assert_eq!(
            page.events[0].request_headers.as_deref(),
            Some("{\"x\":\"1\"}")
        );
        assert_eq!(page.next_cursor.as_deref(), Some("abc"));
    }
}
