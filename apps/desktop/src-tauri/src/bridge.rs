use crate::db;
use crate::models::{
    BridgeStatus, SendResponsePayload, Service, SseMessage, WebhookEvent, WebhookEventPayload,
};
use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

const RELAY_BASE_URL: &str = "https://relay.bridgehook.dev";
const MAX_BACKOFF_SECS: u64 = 60;

/// Main bridge loop — runs for the lifetime of a service. Handles reconnection
/// with exponential backoff if the SSE connection drops.
pub async fn run_bridge(
    app_handle: tauri::AppHandle,
    service: Service,
    db: Arc<Mutex<Connection>>,
) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("failed to build HTTP client");

    let relay_url = format!("{}/hook/{}/events", RELAY_BASE_URL, service.channel_id);
    let mut backoff_secs: u64 = 1;

    loop {
        log::info!(
            "Connecting bridge for service '{}' to {}",
            service.name,
            relay_url
        );

        // Emit connected status
        let _ = app_handle.emit(
            "bridge-status",
            BridgeStatus {
                service_id: service.id.clone(),
                connected: true,
                error: None,
            },
        );

        match connect_and_process(&app_handle, &service, &client, &relay_url, &db).await {
            Ok(()) => {
                log::info!("SSE stream ended for service '{}'", service.name);
                backoff_secs = 1; // Reset backoff on clean disconnect
            }
            Err(e) => {
                log::error!("Bridge error for '{}': {}", service.name, e);
                let _ = app_handle.emit(
                    "bridge-status",
                    BridgeStatus {
                        service_id: service.id.clone(),
                        connected: false,
                        error: Some(e.to_string()),
                    },
                );
            }
        }

        // Exponential backoff before reconnect
        log::info!(
            "Reconnecting bridge for '{}' in {}s...",
            service.name,
            backoff_secs
        );
        tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
        backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
    }
}

/// Connect to the relay SSE stream and process incoming webhook events.
async fn connect_and_process(
    app_handle: &tauri::AppHandle,
    service: &Service,
    client: &reqwest::Client,
    relay_url: &str,
    db: &Arc<Mutex<Connection>>,
) -> Result<(), String> {
    let sse_client =
        eventsource_client::ClientBuilder::for_url(relay_url)
            .map_err(|e| e.to_string())?
            .build();

    use eventsource_client::Client as SseClient;
    let mut stream = sse_client.stream();

    while let Some(event) = stream.next().await {
        match event {
            Ok(eventsource_client::SSE::Connected(_)) => {
                log::info!("SSE transport connected for service '{}'", service.name);
            }
            Ok(eventsource_client::SSE::Event(ev)) => {
                match serde_json::from_str::<SseMessage>(&ev.data) {
                    Ok(msg) => {
                        if msg.msg_type == "connected" {
                            log::info!("SSE connected for service '{}'", service.name);
                            continue;
                        }
                        if msg.msg_type == "webhook" {
                            handle_webhook(app_handle, service, client, db, msg).await;
                        }
                    }
                    Err(e) => {
                        log::warn!("Failed to parse SSE message: {} — data: {}", e, ev.data);
                    }
                }
            }
            Ok(eventsource_client::SSE::Comment(_)) => {
                // Heartbeat / keep-alive, ignore
            }
            Err(e) => {
                return Err(format!("SSE stream error: {}", e));
            }
        }
    }

    Ok(())
}

/// Handle a single webhook event: forward to localhost, send response back to
/// the relay, store in SQLite, and emit to the frontend.
async fn handle_webhook(
    app_handle: &tauri::AppHandle,
    service: &Service,
    client: &reqwest::Client,
    db: &Arc<Mutex<Connection>>,
    msg: SseMessage,
) {
    let start = Instant::now();
    let event_id = match &msg.id {
        Some(id) => id.clone(),
        None => {
            log::warn!("SSE webhook message missing event ID, skipping");
            return;
        }
    };
    let method = msg.method.unwrap_or_else(|| "POST".to_string());
    let event_path = msg.path.unwrap_or_else(|| service.path.clone());
    let headers = msg.headers.unwrap_or_default();
    let body = msg.body.unwrap_or_default();
    let received_at = chrono::Utc::now().to_rfc3339();

    // Forward to localhost
    let local_url = format!("http://localhost:{}{}", service.port, event_path);
    log::info!(
        "[{}] Forwarding {} {} → {}",
        service.name,
        method,
        event_path,
        local_url
    );

    let result = client
        .request(
            method.parse().unwrap_or(reqwest::Method::POST),
            &local_url,
        )
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
            let relay_response_url = format!(
                "{}/hook/{}/response",
                RELAY_BASE_URL, service.channel_id
            );
            if let Err(e) = client
                .post(&relay_response_url)
                .json(&SendResponsePayload {
                    event_id: event_id.clone(),
                    status,
                    headers: resp_headers.clone(),
                    body: resp_body.clone(),
                })
                .send()
                .await
            {
                log::error!("Failed to send response to relay: {}", e);
            }

            // Notify on error status
            if status >= 400 {
                send_error_notification(app_handle, service, &method, &event_path, status);
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
            send_error_notification(
                app_handle,
                service,
                &method,
                &event_path,
                0,
            );

            (None, None, None, Some(error_msg))
        }
    };

    // Update last event time for tray icon status
    if let Some(state) = app_handle.try_state::<crate::state::AppState>() {
        let mut last_time = state.last_event_time.write().await;
        *last_time = Some(Instant::now());
    }

    // Store in SQLite
    let stored_event = WebhookEvent {
        id: event_id.clone(),
        service_id: service.id.clone(),
        method: method.clone(),
        path: event_path.clone(),
        request_headers: serde_json::to_string(&headers).unwrap_or_default(),
        request_body: Some(body),
        response_status,
        response_headers,
        response_body: response_body.clone(),
        latency_ms: Some(latency_ms),
        error: error.clone(),
        received_at: received_at.clone(),
    };

    let conn = db.lock().await;
    if let Err(e) = db::insert_event(&conn, &stored_event) {
        log::error!("Failed to store event in DB: {}", e);
    }
    drop(conn);

    // Emit to frontend
    let _ = app_handle.emit(
        "webhook-event",
        WebhookEventPayload {
            id: event_id,
            service_id: service.id.clone(),
            service_name: service.name.clone(),
            method,
            path: event_path,
            request_headers: headers,
            request_body: stored_event.request_body,
            response_status,
            response_body,
            latency_ms: Some(latency_ms),
            error,
            received_at,
        },
    );
}

/// Convert a HashMap of headers to a reqwest HeaderMap.
/// Skips headers that reqwest should set itself (host, content-length, etc.).
fn to_header_map(headers: &HashMap<String, String>) -> HeaderMap {
    let skip_headers = [
        "host",
        "content-length",
        "transfer-encoding",
        "connection",
    ];
    let mut map = HeaderMap::new();
    for (key, value) in headers {
        let key_lower = key.to_lowercase();
        if skip_headers.contains(&key_lower.as_str()) {
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

/// Extract response headers into a HashMap.
fn extract_headers(response: &reqwest::Response) -> HashMap<String, String> {
    let mut headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(v) = value.to_str() {
            headers.insert(key.to_string(), v.to_string());
        }
    }
    headers
}

/// Send a native notification for error responses or connection failures.
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
        format!(
            "{} — connection failed\n{} {}",
            service.name, method, path
        )
    };

    let _ = app_handle
        .notification()
        .builder()
        .title("BridgeHook")
        .body(body)
        .show();
}
