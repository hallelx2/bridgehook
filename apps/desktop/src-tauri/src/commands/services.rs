use crate::db;
use crate::models::{PortProbe, Service};
use crate::services as svc;
use crate::state::AppState;
use std::time::Duration;

#[tauri::command]
pub async fn add_service(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    name: String,
    port: u16,
    path: String,
) -> Result<Service, String> {
    // 1. Create a channel on the relay
    let client = reqwest::Client::new();
    let channel_id = svc::create_channel(&client, port, &path).await?;

    // 2. Generate a local secret for this service record
    let secret = uuid::Uuid::new_v4().to_string();

    // 3. Build the service record
    let service = Service {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        port,
        path,
        channel_id,
        secret,
        active: true,
        created_at: chrono::Utc::now().to_rfc3339(),
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

    Ok(service)
}

#[tauri::command]
pub async fn remove_service(
    state: tauri::State<'_, AppState>,
    service_id: String,
) -> Result<(), String> {
    // Stop the bridge first
    svc::stop_bridge(&service_id, &state).await;

    // Delete from DB
    let conn = state.db.lock().await;
    db::delete_service(&conn, &service_id).map_err(|e| e.to_string())?;

    log::info!("Removed service {}", service_id);
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

    if service.active {
        // Pause: stop bridge and mark inactive
        svc::stop_bridge(&service_id, &state).await;
        db::update_service_active(&conn, &service_id, false).map_err(|e| e.to_string())?;
        drop(conn);
        log::info!("Paused service '{}'", service.name);
        Ok(false)
    } else {
        // Resume: mark active and start bridge
        db::update_service_active(&conn, &service_id, true).map_err(|e| e.to_string())?;
        let mut updated = service.clone();
        updated.active = true;
        drop(conn);
        svc::start_bridge(&app_handle, &updated, &state).await;
        log::info!("Resumed service '{}'", service.name);
        Ok(true)
    }
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
    // Extract channel ID from URL like: https://relay.../hook/f1586acae33f
    let channel_id = webhook_url
        .split("/hook/")
        .nth(1)
        .map(|s| s.trim_end_matches('/').to_string())
        .ok_or_else(|| "Invalid webhook URL — expected .../hook/<channelId>".to_string())?;

    if channel_id.is_empty() || !channel_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Invalid channel ID in URL".to_string());
    }

    let service = Service {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        port,
        path,
        channel_id: channel_id.clone(),
        secret: uuid::Uuid::new_v4().to_string(),
        active: true,
        created_at: chrono::Utc::now().to_rfc3339(),
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
