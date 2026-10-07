use crate::db;
use crate::models::{PortProbe, Service};
use crate::services as svc;
use crate::state::AppState;
use crate::tray;
use std::time::Duration;

#[tauri::command]
pub async fn add_service(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    name: String,
    port: u16,
    path: String,
) -> Result<Service, String> {
    // 1. Create a channel on the relay (generates a per-channel ECDSA keypair).
    let client = reqwest::Client::new();
    let created = svc::create_channel(&client, port, &path).await?;

    // 2. The `secret` column on Service is legacy bookkeeping; the real
    //    auth credential lives in `private_key_pkcs8` (set below).
    let secret = uuid::Uuid::new_v4().to_string();

    // 3. Build the service record. `private_key_pkcs8` holds the bytes the
    //    bridge will use to sign every relay request from now on.
    let service = Service {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        port,
        path,
        channel_id: created.channel_id,
        secret,
        active: true,
        created_at: chrono::Utc::now().to_rfc3339(),
        path_rewrite: None,
        injected_headers: None,
        timeout_ms: None,
        retry_count: 0,
        retry_delay_ms: 1000,
        environments: None,
        active_environment: None,
        signing_provider: None,
        signing_secret: None,
        mock_response: None,
        notify_on_event: false,
        private_key_pkcs8: Some(created.private_key_pkcs8),
    };

    // 4. Store in SQLite
    {
        let conn = state.db.lock().await;
        db::insert_service(&conn, &service).map_err(|e| e.to_string())?;
    }

    // 5. Start the bridge
    svc::start_bridge(&app_handle, &service, &state).await;

    log::info!(
        "Added service '{}' → localhost:{}{} (channel: {})",
        service.name,
        service.port,
        service.path,
        service.channel_id
    );

    tray::refresh_tray(&app_handle).await;
    Ok(service)
}

#[tauri::command]
pub async fn remove_service(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    service_id: String,
) -> Result<(), String> {
    // Stop the bridge first
    svc::stop_bridge(&service_id, &state).await;

    // Delete from DB
    {
        let conn = state.db.lock().await;
        db::delete_service(&conn, &service_id).map_err(|e| e.to_string())?;
    }

    log::info!("Removed service {}", service_id);
    tray::refresh_tray(&app_handle).await;
    Ok(())
}

#[tauri::command]
pub async fn toggle_service(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    service_id: String,
) -> Result<bool, String> {
    let conn = state.db.lock().await;
    let service = db::get_service(&conn, &service_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Service not found".to_string())?;

    let new_active = if service.active {
        // Pause
        svc::stop_bridge(&service_id, &state).await;
        db::update_service_active(&conn, &service_id, false).map_err(|e| e.to_string())?;
        drop(conn);
        log::info!("Paused service '{}'", service.name);
        false
    } else {
        // Resume
        db::update_service_active(&conn, &service_id, true).map_err(|e| e.to_string())?;
        let mut updated = service.clone();
        updated.active = true;
        drop(conn);
        svc::start_bridge(&app_handle, &updated, &state).await;
        log::info!("Resumed service '{}'", service.name);
        true
    };
    tray::refresh_tray(&app_handle).await;
    Ok(new_active)
}

#[tauri::command]
pub async fn list_services(state: tauri::State<'_, AppState>) -> Result<Vec<Service>, String> {
    let conn = state.db.lock().await;
    db::get_services(&conn).map_err(|e| e.to_string())
}

/// Import a service from the browser extension by taking over its channel.
/// User pastes the webhook URL from the extension, Tauri extracts the channelId
/// and starts bridging the same channel. Same URL keeps working.
#[tauri::command]
pub async fn import_from_extension(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    webhook_url: String,
    name: String,
    port: u16,
    path: String,
) -> Result<Service, String> {
    let channel_id = channel_id_from_webhook_url(&webhook_url).ok_or_else(|| {
        "Invalid webhook URL — expected https://relay.bridgehook.dev/<channelId>".to_string()
    })?;

    // Imported from extension: we don't have the extension's private key, so
    // this service has no signing credential. The bridge will fail-fast with
    // an auth error until the user re-creates the channel locally.
    let service = Service {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        port,
        path,
        channel_id: channel_id.clone(),
        secret: uuid::Uuid::new_v4().to_string(),
        active: true,
        created_at: chrono::Utc::now().to_rfc3339(),
        path_rewrite: None,
        injected_headers: None,
        timeout_ms: None,
        retry_count: 0,
        retry_delay_ms: 1000,
        environments: None,
        active_environment: None,
        signing_provider: None,
        signing_secret: None,
        mock_response: None,
        notify_on_event: false,
        private_key_pkcs8: None,
    };

    {
        let conn = state.db.lock().await;
        db::insert_service(&conn, &service).map_err(|e| e.to_string())?;
    }

    svc::start_bridge(&app_handle, &service, &state).await;

    log::info!(
        "Imported service '{}' from extension (channel: {})",
        service.name,
        channel_id
    );

    tray::refresh_tray(&app_handle).await;
    Ok(service)
}

const COMMON_PORTS: &[u16] = &[3000, 3001, 4000, 5000, 5173, 8000, 8080, 8888];

/// Probe a single port to check if a server is running
async fn probe_port(client: &reqwest::Client, port: u16) -> PortProbe {
    let url = format!("http://localhost:{}/", port);
    match client
        .head(&url)
        .timeout(Duration::from_millis(1500))
        .send()
        .await
    {
        Ok(resp) => {
            let server = resp
                .headers()
                .get("server")
                .or_else(|| resp.headers().get("x-powered-by"))
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
            PortProbe {
                port,
                alive: true,
                status: resp.status().as_u16(),
                server,
            }
        }
        Err(_) => PortProbe {
            port,
            alive: false,
            status: 0,
            server: None,
        },
    }
}

#[tauri::command]
pub async fn scan_ports() -> Result<Vec<PortProbe>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(2000))
        .build()
        .map_err(|e| e.to_string())?;

    let mut handles = Vec::new();
    for &port in COMMON_PORTS {
        let c = client.clone();
        handles.push(tokio::spawn(async move { probe_port(&c, port).await }));
    }

    let mut results = Vec::new();
    for handle in handles {
        if let Ok(probe) = handle.await {
            if probe.alive {
                results.push(probe);
            }
        }
    }

    Ok(results)
}

/// Auto-detect just scans ports — does NOT auto-create bridges.
/// User clicks "Bridge" on each detected port to create a service.
#[tauri::command]
pub async fn auto_detect() -> Result<Vec<PortProbe>, String> {
    scan_ports().await
}

/// Update the configuration of an existing service. Restarts the bridge if running.
#[tauri::command]
pub async fn update_service(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    service: Service,
) -> Result<Service, String> {
    {
        let conn = state.db.lock().await;
        db::update_service_config(&conn, &service).map_err(|e| e.to_string())?;
    }
    // If the service is active, restart the bridge so new config applies.
    if service.active {
        svc::stop_bridge(&service.id, &state).await;
        svc::start_bridge(&app_handle, &service, &state).await;
    }
    tray::refresh_tray(&app_handle).await;
    Ok(service)
}

/// Channel id from a webhook URL, in any form the relay has handed out:
/// `https://<id>.bridgehook.dev[/path]` (current), `https://<relay>/<id>`, or
/// the legacy `https://<relay>/hook/<id>`. Mirrors `classifyHost` and
/// `parseChannelPath` in the relay.
fn channel_id_from_webhook_url(url: &str) -> Option<String> {
    let after_scheme = url.trim().split_once("://").map(|(_, rest)| rest)?;
    let (host, path) = after_scheme.split_once('/').unwrap_or((after_scheme, ""));
    let host = host.split(':').next().unwrap_or("").to_ascii_lowercase();

    // On bridgehook.dev only a channel host or the relay host carries a
    // channel: app., docs. and other first-party hosts never do.
    if let Some(label) = host.strip_suffix(".bridgehook.dev") {
        if label != "relay" {
            let ok = !label.contains('.') && is_channel_id(label) && !is_reserved_label(label);
            return ok.then(|| label.to_string());
        }
    }

    let path = path.split(['?', '#']).next().unwrap_or("");
    let mut segments = path.split('/').filter(|s| !s.is_empty());
    let first = segments.next()?;
    let id = if first == "hook" { segments.next()? } else { first };
    if segments.next().is_some() {
        return None;
    }
    let valid = is_channel_id(id) && !matches!(id, "api" | "auth" | "hook" | "health");
    valid.then(|| id.to_string())
}

fn is_channel_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 24 && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

fn is_reserved_label(s: &str) -> bool {
    matches!(
        s,
        "relay" | "app" | "docs" | "www" | "api" | "admin" | "status" | "blog" | "mail" | "support" | "help"
    )
}

#[cfg(test)]
mod tests {
    use super::channel_id_from_webhook_url as parse;

    #[test]
    fn parses_every_url_shape() {
        assert_eq!(parse("https://34565sdfq344s.bridgehook.dev").as_deref(), Some("34565sdfq344s"));
        assert_eq!(parse("https://34565sdfq344s.bridgehook.dev/stripe/webhook?x=1").as_deref(), Some("34565sdfq344s"));
        assert_eq!(parse("https://relay.bridgehook.dev/2324radf23r").as_deref(), Some("2324radf23r"));
        assert_eq!(parse("https://relay.bridgehook.dev/2324radf23r/").as_deref(), Some("2324radf23r"));
        assert_eq!(parse("https://x.workers.dev/hook/abc123").as_deref(), Some("abc123"));
    }

    #[test]
    fn rejects_non_channel_urls() {
        for u in [
            "https://relay.bridgehook.dev/",
            "https://relay.bridgehook.dev/api/channels",
            "https://relay.bridgehook.dev/hook/abc/claim",
            "https://relay.bridgehook.dev/ABC",
            "https://app.bridgehook.dev/",
            "https://app.bridgehook.dev/hook/abc123",
            "https://docs.bridgehook.dev/abc123",
            "https://a.b.bridgehook.dev/",
            "not a url",
        ] {
            assert_eq!(parse(u), None, "{u}");
        }
    }
}
