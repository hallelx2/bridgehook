use crate::crypto;
use crate::db;
use crate::models::{
    BridgeStatus, SendResponsePayload, Service, WebhookEvent, WebhookEventPayload,
};
use crate::services::{self as svc};
use hmac::{Hmac, Mac};
use rusqlite::Connection;
use serde::Deserialize;
use sha2::Sha256;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

const RELAY_BASE_URL: &str = "https://bridgehook-relay.halleluyaholudele.workers.dev";
const POLL_INTERVAL_MS: u64 = 2000;
const ERROR_BACKOFF_MS: u64 = 10000;
const MAX_CONSECUTIVE_ERRORS: u32 = 3;
/// Max events to buffer when localhost is unreachable (oldest drops).
const MAX_QUEUE: usize = 64;

/// Event row returned from the relay's polling API
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RelayEvent {
    id: String,
    #[allow(dead_code)]
    channel_id: String,
    method: String,
    path: String,
    request_headers: String,
    request_body: Option<String>,
    response_status: Option<i32>,
    #[allow(dead_code)]
    response_headers: Option<String>,
    #[allow(dead_code)]
    response_body: Option<String>,
    #[allow(dead_code)]
    latency_ms: Option<i32>,
    error: Option<String>,
    received_at: String,
}

/// Canned response a service may be configured to return instead of
/// forwarding to localhost. Useful when the handler isn't implemented yet.
#[derive(Debug, Deserialize)]
struct MockResponse {
    #[serde(default = "default_mock_status")]
    status: u16,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: String,
}

fn default_mock_status() -> u16 {
    200
}

pub async fn run_bridge(
    app_handle: tauri::AppHandle,
    service: Service,
    db: Arc<Mutex<Connection>>,
) {
    // Without a signing key the bridge can't authenticate to the relay —
    // every poll would 401. Surface a clear error to the UI and exit.
    let pkcs8 = match service.private_key_pkcs8.as_deref() {
        Some(bytes) => bytes.to_vec(),
        None => {
            log::error!(
                "[{}] No signing key on this service — channel cannot be authenticated. \
                 Remove and re-add the service.",
                service.name
            );
            let _ = app_handle.emit(
                "bridge-status",
                BridgeStatus {
                    service_id: service.id.clone(),
                    connected: false,
                    error: Some(
                        "No signing key — remove and re-add this service".to_string(),
                    ),
                },
            );
            return;
        }
    };

    let timeout_ms = service.timeout_ms.unwrap_or(30_000) as u64;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .expect("failed to build HTTP client");

    let poll_url = format!(
        "{}/api/channels/{}/events?limit=50",
        RELAY_BASE_URL, service.channel_id
    );

    let mut forwarded: HashSet<String> = HashSet::new();
    let mut consecutive_errors: u32 = 0;
    // Replay queue: events that failed because localhost was down.
    let mut queue: VecDeque<RelayEvent> = VecDeque::new();
    let mut was_connected: Option<bool> = None;

    if let Ok(existing) = fetch_events(&client, &pkcs8, &poll_url).await {
        for evt in &existing {
            forwarded.insert(evt.id.clone());
        }
        log::info!(
            "[{}] Marked {} existing events as already forwarded",
            service.name,
            forwarded.len()
        );
    }

    log::info!(
        "[{}] Bridge started → localhost:{}{} (queue cap={})",
        service.name,
        service.port,
        service.path,
        MAX_QUEUE
    );

    loop {
        match fetch_events(&client, &pkcs8, &poll_url).await {
            Ok(events) => {
                if consecutive_errors > 0 {
                    log::info!("[{}] Reconnected to relay", service.name);
                }
                consecutive_errors = 0;

                let _ = app_handle.emit(
                    "bridge-status",
                    BridgeStatus {
                        service_id: service.id.clone(),
                        connected: true,
                        error: None,
                    },
                );

                let unforwarded: Vec<RelayEvent> = events
                    .into_iter()
                    .filter(|e| {
                        e.response_status.is_none()
                            && e.error.is_none()
                            && !forwarded.contains(&e.id)
                    })
                    .collect();

                for evt in unforwarded {
                    forwarded.insert(evt.id.clone());
                    match handle_event(&app_handle, &service, &client, &pkcs8, &db, &evt).await {
                        HandleOutcome::Ok => {}
                        HandleOutcome::Requeue => {
                            if queue.len() >= MAX_QUEUE {
                                queue.pop_front();
                            }
                            queue.push_back(evt);
                            log::warn!(
                                "[{}] localhost down — queued event (size={})",
                                service.name,
                                queue.len()
                            );
                        }
                    }
                }

                // Try to drain the queue when localhost looks alive again
                if !queue.is_empty() {
                    while let Some(evt) = queue.pop_front() {
                        match handle_event(&app_handle, &service, &client, &pkcs8, &db, &evt).await {
                            HandleOutcome::Ok => {
                                log::info!(
                                    "[{}] Drained queued event {} (remaining={})",
                                    service.name,
                                    evt.id,
                                    queue.len()
                                );
                            }
                            HandleOutcome::Requeue => {
                                queue.push_front(evt);
                                break;
                            }
                        }
                    }
                }

                was_connected = Some(true);
            }
            Err(e) => {
                consecutive_errors += 1;
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                    let _ = app_handle.emit(
                        "bridge-status",
                        BridgeStatus {
                            service_id: service.id.clone(),
                            connected: false,
                            error: Some(format!("Connection failed: {}", e)),
                        },
                    );
                    if was_connected != Some(false) {
                        was_connected = Some(false);
                    }
                }
                log::error!(
                    "[{}] Poll error (attempt {}): {}",
                    service.name,
                    consecutive_errors,
                    e
                );
            }
        }

        let delay = if consecutive_errors > MAX_CONSECUTIVE_ERRORS {
            ERROR_BACKOFF_MS
        } else {
            POLL_INTERVAL_MS
        };
        tokio::time::sleep(Duration::from_millis(delay)).await;
    }
}

async fn fetch_events(
    client: &reqwest::Client,
    pkcs8: &[u8],
    url: &str,
) -> Result<Vec<RelayEvent>, String> {
    let response = crypto::signed_get(client, pkcs8, url).await?;

    if !response.status().is_success() {
        return Err(format!("Relay returned status {}", response.status()));
    }

    response
        .json::<Vec<RelayEvent>>()
        .await
        .map_err(|e| format!("Failed to parse events: {}", e))
}

enum HandleOutcome {
    Ok,
    /// Localhost is unreachable — keep the event and retry later.
    Requeue,
}

async fn handle_event(
    app_handle: &tauri::AppHandle,
    service: &Service,
    client: &reqwest::Client,
    pkcs8: &[u8],
    db: &Arc<Mutex<Connection>>,
    evt: &RelayEvent,
) -> HandleOutcome {
    let start = Instant::now();

    // Strip /hook/channelId prefix from the relay-supplied path.
    let event_path = evt
        .path
        .strip_prefix(&format!("/hook/{}", service.channel_id))
        .unwrap_or(&evt.path);
    let event_path = if event_path.is_empty() { "/" } else { event_path };

    let headers: HashMap<String, String> =
        serde_json::from_str(&evt.request_headers).unwrap_or_default();
    let body = evt.request_body.clone().unwrap_or_default();
    let method = &evt.method;

    // Verify signature if configured. This doesn't block delivery —
    // we surface it as a header on the stored event so users can see.
    let signature_status = verify_signature(service, &headers, &body);

    // Mock response path: return canned response, skip localhost entirely.
    let (response_status, response_headers, response_body, error, mock_used) =
        if let Some(mock_json) = service.mock_response.as_deref() {
            match serde_json::from_str::<MockResponse>(mock_json) {
                Ok(mock) => {
                    let relay_url =
                        format!("{}/hook/{}/response", RELAY_BASE_URL, service.channel_id);
                    let payload = SendResponsePayload {
                        event_id: evt.id.clone(),
                        status: mock.status,
                        headers: mock.headers.clone(),
                        body: mock.body.clone(),
                    };
                    if let Err(e) =
                        crypto::signed_post_json(client, pkcs8, &relay_url, &payload).await
                    {
                        log::error!(
                            "[{}] Failed to send mock response to relay: {}",
                            service.name,
                            e
                        );
                    }
                    (
                        Some(mock.status as i32),
                        Some(serde_json::to_string(&mock.headers).unwrap_or_default()),
                        Some(mock.body),
                        None,
                        true,
                    )
                }
                Err(e) => {
                    log::error!("[{}] invalid mock_response JSON: {}", service.name, e);
                    (None, None, None, Some(format!("mock invalid: {}", e)), true)
                }
            }
        } else {
            // Real forward. Apply path rewrite/env/injected headers via forward_to_localhost.
            match svc::forward_to_localhost(
                client,
                service,
                method,
                event_path,
                &evt.request_headers,
                Some(&body),
            )
            .await
            {
                Ok((status, resp_headers, resp_body, _latency)) => {
                    let relay_url =
                        format!("{}/hook/{}/response", RELAY_BASE_URL, service.channel_id);
                    let payload = SendResponsePayload {
                        event_id: evt.id.clone(),
                        status,
                        headers: resp_headers.clone(),
                        body: resp_body.clone(),
                    };
                    if let Err(e) =
                        crypto::signed_post_json(client, pkcs8, &relay_url, &payload).await
                    {
                        log::error!("[{}] Failed to send response to relay: {}", service.name, e);
                    }
                    if status >= 400 {
                        send_error_notification(app_handle, service, method, event_path, status);
                    }
                    (
                        Some(status as i32),
                        Some(serde_json::to_string(&resp_headers).unwrap_or_default()),
                        Some(resp_body),
                        None,
                        false,
                    )
                }
                Err(e) => {
                    let is_connection_error = e.contains("Connection refused")
                        || e.contains("error sending request")
                        || e.contains("dns error")
                        || e.contains("connect");
                    if is_connection_error {
                        return HandleOutcome::Requeue;
                    }
                    send_error_notification(app_handle, service, method, event_path, 0);
                    (None, None, None, Some(e), false)
                }
            }
        };

    let latency_ms = start.elapsed().as_millis() as i64;

    // Update last event time
    if let Some(state) = app_handle.try_state::<crate::state::AppState>() {
        let mut last_time = state.last_event_time.write().await;
        *last_time = Some(Instant::now());
    }

    // Fire a "webhook received" notification if the user opted in for this service
    if service.notify_on_event && !mock_used {
        send_event_notification(app_handle, service, method, event_path, response_status);
    }

    // Inject signature verification status into stored headers (as a virtual header)
    let mut stored_headers = headers.clone();
    if let Some(status) = signature_status.clone() {
        stored_headers.insert("x-bridgehook-signature".to_string(), status);
    }
    let stored_headers_json =
        serde_json::to_string(&stored_headers).unwrap_or_else(|_| evt.request_headers.clone());

    let stored = WebhookEvent {
        id: evt.id.clone(),
        service_id: service.id.clone(),
        method: method.clone(),
        path: event_path.to_string(),
        request_headers: stored_headers_json,
        request_body: Some(body.clone()),
        response_status,
        response_headers: response_headers.clone(),
        response_body: response_body.clone(),
        latency_ms: Some(latency_ms),
        error: error.clone(),
        received_at: evt.received_at.clone(),
    };

    let conn = db.lock().await;
    if let Err(e) = db::insert_event(&conn, &stored) {
        log::error!("[{}] Failed to store event: {}", service.name, e);
    }
    drop(conn);

    let _ = app_handle.emit(
        "webhook-event",
        WebhookEventPayload {
            id: evt.id.clone(),
            service_id: service.id.clone(),
            service_name: service.name.clone(),
            method: method.clone(),
            path: event_path.to_string(),
            request_headers: stored_headers,
            request_body: Some(body),
            response_status,
            response_body,
            latency_ms: Some(latency_ms),
            error,
            received_at: evt.received_at.clone(),
        },
    );

    HandleOutcome::Ok
}

/// Verify an incoming signature against the configured provider + secret.
/// Returns "valid", "invalid", "missing", or None when not configured.
fn verify_signature(
    service: &Service,
    headers: &HashMap<String, String>,
    body: &str,
) -> Option<String> {
    let provider = service.signing_provider.as_deref()?;
    let secret = service.signing_secret.as_deref()?;
    if secret.is_empty() {
        return None;
    }

    let lower: HashMap<String, &String> =
        headers.iter().map(|(k, v)| (k.to_lowercase(), v)).collect();

    match provider {
        "github" => {
            let header = lower.get("x-hub-signature-256").map(|s| s.as_str())?;
            // Format: sha256=<hex>
            let expected = match header.strip_prefix("sha256=") {
                Some(h) => h,
                None => return Some("invalid".into()),
            };
            let mut mac = match Hmac::<Sha256>::new_from_slice(secret.as_bytes()) {
                Ok(m) => m,
                Err(_) => return Some("invalid".into()),
            };
            mac.update(body.as_bytes());
            let computed = hex::encode(mac.finalize().into_bytes());
            if constant_time_eq(computed.as_bytes(), expected.as_bytes()) {
                Some("valid".into())
            } else {
                Some("invalid".into())
            }
        }
        "stripe" => {
            // Format: t=<unix>,v1=<hex>
            let header = lower.get("stripe-signature").map(|s| s.as_str());
            let header = match header {
                Some(h) => h,
                None => return Some("missing".into()),
            };
            let mut t: Option<&str> = None;
            let mut v1: Option<&str> = None;
            for part in header.split(',') {
                let mut kv = part.splitn(2, '=');
                let k = kv.next().unwrap_or("");
                let v = kv.next().unwrap_or("");
                match k {
                    "t" => t = Some(v),
                    "v1" => v1 = Some(v),
                    _ => {}
                }
            }
            let (Some(t), Some(v1)) = (t, v1) else {
                return Some("invalid".into());
            };
            let signed_payload = format!("{}.{}", t, body);
            let mut mac = match Hmac::<Sha256>::new_from_slice(secret.as_bytes()) {
                Ok(m) => m,
                Err(_) => return Some("invalid".into()),
            };
            mac.update(signed_payload.as_bytes());
            let computed = hex::encode(mac.finalize().into_bytes());
            if constant_time_eq(computed.as_bytes(), v1.as_bytes()) {
                Some("valid".into())
            } else {
                Some("invalid".into())
            }
        }
        "slack" => {
            // v0:{timestamp}:{body} signed with HMAC-SHA256, header "X-Slack-Signature: v0=<hex>"
            let sig_header = lower.get("x-slack-signature").map(|s| s.as_str());
            let ts_header = lower.get("x-slack-request-timestamp").map(|s| s.as_str());
            let (Some(sig), Some(ts)) = (sig_header, ts_header) else {
                return Some("missing".into());
            };
            let expected = match sig.strip_prefix("v0=") {
                Some(h) => h,
                None => return Some("invalid".into()),
            };
            let signed = format!("v0:{}:{}", ts, body);
            let mut mac = match Hmac::<Sha256>::new_from_slice(secret.as_bytes()) {
                Ok(m) => m,
                Err(_) => return Some("invalid".into()),
            };
            mac.update(signed.as_bytes());
            let computed = hex::encode(mac.finalize().into_bytes());
            if constant_time_eq(computed.as_bytes(), expected.as_bytes()) {
                Some("valid".into())
            } else {
                Some("invalid".into())
            }
        }
        _ => None,
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn send_error_notification(
    app_handle: &tauri::AppHandle,
    service: &Service,
    method: &str,
    path: &str,
    status: u16,
) {
    use tauri_plugin_notification::NotificationExt;
    let body = if status > 0 {
        format!("{} returned {}\n{} {}", service.name, status, method, path)
    } else {
        format!("{} — connection failed\n{} {}", service.name, method, path)
    };
    let _ = app_handle
        .notification()
        .builder()
        .title("BridgeHook")
        .body(body)
        .show();
}

fn send_event_notification(
    app_handle: &tauri::AppHandle,
    service: &Service,
    method: &str,
    path: &str,
    status: Option<i32>,
) {
    use tauri_plugin_notification::NotificationExt;
    let status_str = match status {
        Some(s) => format!(" → {}", s),
        None => String::new(),
    };
    let _ = app_handle
        .notification()
        .builder()
        .title(format!("{} · {}", service.name, method))
        .body(format!("{}{}", path, status_str))
        .show();
}
