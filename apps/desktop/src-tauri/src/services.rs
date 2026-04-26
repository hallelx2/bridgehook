use crate::bridge;
use crate::crypto;
use crate::models::{CreateChannelResponse, Service};
use crate::state::AppState;
use serde::Deserialize;
use std::collections::HashMap;

const RELAY_BASE_URL: &str = "https://bridgehook-relay.halleluyaholudele.workers.dev";

/// Result of creating a new channel: the relay-assigned id plus the
/// PKCS#8-serialized private key the caller MUST persist for the bridge
/// to authenticate later requests.
pub struct CreatedChannel {
    pub channel_id: String,
    pub private_key_pkcs8: Vec<u8>,
}

/// One entry in a service's `environments` JSON array.
#[derive(Debug, Deserialize)]
pub struct Environment {
    pub name: String,
    pub port: u16,
    #[serde(default)]
    pub path_rewrite: Option<String>,
}

/// Resolve the effective target (port, base path) for a service, taking
/// the active environment override into account.
pub fn effective_target(service: &Service) -> (u16, Option<String>) {
    if let (Some(active), Some(envs_json)) =
        (service.active_environment.as_ref(), service.environments.as_ref())
    {
        if let Ok(envs) = serde_json::from_str::<Vec<Environment>>(envs_json) {
            if let Some(env) = envs.iter().find(|e| &e.name == active) {
                return (env.port, env.path_rewrite.clone());
            }
        }
    }
    (service.port, service.path_rewrite.clone())
}

/// Create a new channel on the relay server using ECDSA P-256 auth.
///
/// Generates a fresh keypair, sends the public key to the relay, and
/// returns both the relay-assigned channel id AND the PKCS#8 private key
/// bytes — the caller persists those to SQLite (`Service.private_key_pkcs8`)
/// so the bridge can sign every subsequent authenticated request.
pub async fn create_channel(
    client: &reqwest::Client,
    port: u16,
    path: &str,
) -> Result<CreatedChannel, String> {
    let key = crypto::generate_keypair()?;

    let url = format!("{}/api/channels", RELAY_BASE_URL);
    let response = client
        .post(&url)
        .json(&serde_json::json!({
            "publicKey": key.public_key_hex,
            "port": port,
            "allowedPaths": [path],
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to relay: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let detail = response
            .text()
            .await
            .unwrap_or_else(|_| String::new());
        return Err(format!(
            "Relay returned status {} when creating channel{}",
            status,
            if detail.is_empty() { String::new() } else { format!(": {}", detail) }
        ));
    }

    let body: CreateChannelResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse relay response: {}", e))?;

    Ok(CreatedChannel {
        channel_id: body.channel_id,
        private_key_pkcs8: key.pkcs8,
    })
}

/// Start a bridge task for a service.
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

/// Forward a single request to localhost, applying per-service config.
/// Handles path rewriting, environment override, header injection, and retries.
pub async fn forward_to_localhost(
    client: &reqwest::Client,
    service: &Service,
    method: &str,
    path: &str,
    headers_json: &str,
    body: Option<&str>,
) -> Result<(u16, HashMap<String, String>, String, i64), String> {
    let (port, rewrite) = effective_target(service);

    // Apply path rewrite. If configured, replace the incoming path entirely.
    let effective_path: &str = rewrite.as_deref().unwrap_or(path);

    let mut headers: HashMap<String, String> =
        serde_json::from_str(headers_json).unwrap_or_default();

    // Merge in injected headers (override existing keys by design).
    if let Some(extra_json) = service.injected_headers.as_deref() {
        if let Ok(extra) = serde_json::from_str::<HashMap<String, String>>(extra_json) {
            for (k, v) in extra {
                headers.insert(k, v);
            }
        }
    }

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

    let local_url = format!("http://localhost:{}{}", port, effective_path);
    let mut last_err: Option<String> = None;
    let max_attempts = service.retry_count.saturating_add(1).max(1);

    for attempt in 0..max_attempts {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(
                service.retry_delay_ms as u64,
            ))
            .await;
        }

        let start = std::time::Instant::now();
        let result = client
            .request(
                method.parse().unwrap_or(reqwest::Method::POST),
                &local_url,
            )
            .headers(header_map.clone())
            .body(body.unwrap_or("").to_string())
            .send()
            .await;

        match result {
            Ok(response) => {
                let latency_ms = start.elapsed().as_millis() as i64;
                let status = response.status().as_u16();
                let resp_headers: HashMap<String, String> = response
                    .headers()
                    .iter()
                    .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.to_string(), v.to_string())))
                    .collect();
                let resp_body = response.text().await.unwrap_or_default();
                // Retry only on 5xx errors
                if status >= 500 && attempt < max_attempts - 1 {
                    last_err = Some(format!("upstream {}", status));
                    continue;
                }
                return Ok((status, resp_headers, resp_body, latency_ms));
            }
            Err(e) => {
                last_err = Some(e.to_string());
                if attempt < max_attempts - 1 {
                    continue;
                }
            }
        }
    }

    Err(last_err.unwrap_or_else(|| "unknown forward error".to_string()))
}
