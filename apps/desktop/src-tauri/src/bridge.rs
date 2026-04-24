use crate::db;
use crate::models::{
    BridgeStatus, SendResponsePayload, Service, WebhookEvent, WebhookEventPayload,
};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use rusqlite::Connection;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

const RELAY_BASE_URL: &str = "https://bridgehook-relay.halleluyaholudele.workers.dev";
const POLL_INTERVAL_MS: u64 = 2000;
const ERROR_BACKOFF_MS: u64 = 10000;
const MAX_CONSECUTIVE_ERRORS: u32 = 3;

/// Event row returned from the relay's polling API
#[derive(Debug, Deserialize)]
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

/// Main bridge loop — polls the relay every 2s for new events,
/// forwards unprocessed ones to localhost, sends responses back.
/// Same proven approach as the browser extension.
pub async fn run_bridge(
    app_handle: tauri::AppHandle,
    service: Service,
    db: Arc<Mutex<Connection>>,
) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("failed to build HTTP client");

    let poll_url = format!(
        "{}/api/channels/{}/events?limit=50",
        RELAY_BASE_URL, service.channel_id
    );

    let mut forwarded: HashSet<String> = HashSet::new();
    let mut consecutive_errors: u32 = 0;

    // Mark existing events as already forwarded (avoid replaying on restart)
    if let Ok(existing) = fetch_events(&client, &poll_url).await {
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
        "[{}] Bridge started (polling) → localhost:{}{}",
        service.name,
        service.port,
        service.path
    );

    loop {
        match fetch_events(&client, &poll_url).await {
            Ok(events) => {
                if consecutive_errors > 0 {
                    log::info!("[{}] Reconnected to relay", service.name);
                }
                consecutive_errors = 0;

                // Emit connected
                let _ = app_handle.emit(
                    "bridge-status",
                    BridgeStatus {
                        service_id: service.id.clone(),
                        connected: true,
                        error: None,
                    },
                );

                // Find unforwarded events
                let unforwarded: Vec<&RelayEvent> = events
                    .iter()
                    .filter(|e| {
                        e.response_status.is_none()
                            && e.error.is_none()
                            && !forwarded.contains(&e.id)
                    })
                    .collect();

                for evt in unforwarded {
                    forwarded.insert(evt.id.clone());
                    handle_event(&app_handle, &service, &client, &db, evt).await;
                }
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

/// Fetch events from the relay's polling endpoint.
async fn fetch_events(client: &reqwest::Client, url: &str) -> Result<Vec<RelayEvent>, String> {
    let response = client
        .get(url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Failed to poll relay: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Relay returned status {}", response.status()));
    }

    response
        .json::<Vec<RelayEvent>>()
        .await
        .map_err(|e| format!("Failed to parse events: {}", e))
}

/// Handle a single event: forward to localhost, send response back, store, emit.
async fn handle_event(
    app_handle: &tauri::AppHandle,
    service: &Service,
    client: &reqwest::Client,
    db: &Arc<Mutex<Connection>>,
    evt: &RelayEvent,
) {
    let start = Instant::now();

    // Strip /hook/channelId prefix from path
    let event_path = evt
        .path
        .strip_prefix(&format!("/hook/{}", service.channel_id))
        .unwrap_or(&evt.path);
    let event_path = if event_path.is_empty() { "/" } else { event_path };

    let headers: HashMap<String, String> =
        serde_json::from_str(&evt.request_headers).unwrap_or_default();
    let body = evt.request_body.clone().unwrap_or_default();
    let method = &evt.method;

    // Forward to localhost
    let local_url = format!("http://localhost:{}{}", service.port, event_path);
    log::info!("[{}] {} {} → {}", service.name, method, event_path, local_url);

    let result = client
        .request(method.parse().unwrap_or(reqwest::Method::POST), &local_url)
        .headers(to_header_map(&headers))
        .body(body.clone())
        .send()
        .await;

    let latency_ms = start.elapsed().as_millis() as i64;

    let (response_status, response_headers, response_body, error) = match result {
        Ok(response) => {
            let status = response.status().as_u16();
            let resp_headers = extract_headers(&response);
            let resp_body = response.text().await.unwrap_or_default();

            // Send response back to relay
            let relay_url = format!("{}/hook/{}/response", RELAY_BASE_URL, service.channel_id);
            if let Err(e) = client
                .post(&relay_url)
                .json(&SendResponsePayload {
                    event_id: evt.id.clone(),
                    status,
                    headers: resp_headers.clone(),
                    body: resp_body.clone(),
                })
                .send()
                .await
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
            )
        }
        Err(e) => {
            let error_msg = if e.is_connect() {
                format!("Connection refused — is localhost:{} running?", service.port)
            } else if e.is_timeout() {
                "Request timed out (30s)".to_string()
            } else {
                e.to_string()
            };
            log::error!("[{}] Forward failed: {}", service.name, error_msg);
            send_error_notification(app_handle, service, method, event_path, 0);
            (None, None, None, Some(error_msg))
        }
    };

    // Update last event time
    if let Some(state) = app_handle.try_state::<crate::state::AppState>() {
        let mut last_time = state.last_event_time.write().await;
        *last_time = Some(Instant::now());
    }

    // Store in SQLite
    let stored = WebhookEvent {
        id: evt.id.clone(),
        service_id: service.id.clone(),
        method: method.clone(),
        path: event_path.to_string(),
        request_headers: evt.request_headers.clone(),
        request_body: Some(body),
        response_status,
        response_headers,
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

    // Emit to frontend
    let _ = app_handle.emit(
        "webhook-event",
        WebhookEventPayload {
            id: evt.id.clone(),
            service_id: service.id.clone(),
            service_name: service.name.clone(),
            method: method.clone(),
            path: event_path.to_string(),
            request_headers: headers,
            request_body: stored.request_body,
            response_status,
            response_body,
            latency_ms: Some(latency_ms),
            error,
            received_at: evt.received_at.clone(),
        },
    );
}

fn to_header_map(headers: &HashMap<String, String>) -> HeaderMap {
    let skip = ["host", "content-length", "transfer-encoding", "connection"];
    let mut map = HeaderMap::new();
    for (key, value) in headers {
        if skip.contains(&key.to_lowercase().as_str()) {
            continue;
        }
        if let (Ok(name), Ok(val)) = (
            HeaderName::from_bytes(key.as_bytes()),
            HeaderValue::from_str(value),
        ) {
            map.insert(name, val);
        }
    }
    map
}

fn extract_headers(response: &reqwest::Response) -> HashMap<String, String> {
    response
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.to_string(), v.to_string())))
        .collect()
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
