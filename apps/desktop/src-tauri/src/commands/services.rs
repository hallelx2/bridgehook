use crate::db;
use crate::models::Service;
use crate::services as svc;
use crate::state::AppState;

#[tauri::command]
pub async fn add_service(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    name: String,
    port: u16,
    path: String,
) -> Result<Service, String> {
    // 1. Generate a unique secret for this service
    let secret = uuid::Uuid::new_v4().to_string();

    // 2. Create a channel on the relay
    let client = reqwest::Client::new();
    let channel_id = svc::create_channel(&client).await?;

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
