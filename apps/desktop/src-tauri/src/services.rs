use crate::bridge;
use crate::models::{CreateChannelResponse, Service};
use crate::state::AppState;

const RELAY_BASE_URL: &str = "https://relay.bridgehook.dev";

/// Create a new channel on the relay server.
/// Returns the channel ID assigned by the relay.
pub async fn create_channel(client: &reqwest::Client) -> Result<String, String> {
    let url = format!("{}/channels/new", RELAY_BASE_URL);
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to relay: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Relay returned status {} when creating channel",
            response.status()
        ));
    }

    let body: CreateChannelResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse relay response: {}", e))?;

    Ok(body.channel_id)
}

/// Start a bridge task for a service. The task runs in the background,
/// connecting to the relay SSE stream and forwarding webhooks to localhost.
pub async fn start_bridge(
    app_handle: &tauri::AppHandle,
    service: &Service,
    state: &AppState,
) {
    let app_handle = app_handle.clone();
    let service = service.clone();
    let db = state.db.clone();
    let service_id = service.id.clone();
    let service_name = service.name.clone();

    let handle = tokio::spawn(async move {
        bridge::run_bridge(app_handle, service, db).await;
    });

    state
        .bridges
        .write()
        .await
        .insert(service_id.clone(), handle);

    log::info!("Started bridge for service '{}'", service_name);
}

/// Stop a running bridge task for a service.
pub async fn stop_bridge(service_id: &str, state: &AppState) {
    if let Some(handle) = state.bridges.write().await.remove(service_id) {
        handle.abort();
        log::info!("Stopped bridge for service {}", service_id);
    }
}

/// Forward a single request to localhost (used for replay).
pub async fn forward_to_localhost(
    client: &reqwest::Client,
    service: &Service,
    method: &str,
    path: &str,
    headers_json: &str,
    body: Option<&str>,
) -> Result<(u16, std::collections::HashMap<String, String>, String, i64), String> {
    let start = std::time::Instant::now();
    let local_url = format!("http://localhost:{}{}", service.port, path);

    let headers: std::collections::HashMap<String, String> =
        serde_json::from_str(headers_json).unwrap_or_default();

    let mut header_map = reqwest::header::HeaderMap::new();
    let skip = ["host", "content-length", "transfer-encoding", "connection"];
    for (key, value) in &headers {
        if skip.contains(&key.to_lowercase().as_str()) {
            continue;
        }
        if let (Ok(name), Ok(val)) = (
            reqwest::header::HeaderName::from_bytes(key.as_bytes()),
            reqwest::header::HeaderValue::from_str(value),
        ) {
            header_map.insert(name, val);
        }
    }

    let response = client
        .request(
            method.parse().unwrap_or(reqwest::Method::POST),
            &local_url,
        )
        .headers(header_map)
        .body(body.unwrap_or("").to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let latency_ms = start.elapsed().as_millis() as i64;
    let status = response.status().as_u16();
    let resp_headers: std::collections::HashMap<String, String> = response
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.to_string(), v.to_string())))
        .collect();
    let resp_body = response.text().await.unwrap_or_default();

    Ok((status, resp_headers, resp_body, latency_ms))
}
