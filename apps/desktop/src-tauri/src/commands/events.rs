use crate::db;
use crate::models::{ReplayResult, WebhookEvent};
use crate::services as svc;
use crate::state::AppState;

#[tauri::command]
pub async fn get_events(
    state: tauri::State<'_, AppState>,
    service_id: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<WebhookEvent>, String> {
    let conn = state.db.lock().await;
    db::get_events(
        &conn,
        service_id.as_deref(),
        limit.unwrap_or(100),
        offset.unwrap_or(0),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_event(
    state: tauri::State<'_, AppState>,
    event_id: String,
) -> Result<Option<WebhookEvent>, String> {
    let conn = state.db.lock().await;
    db::get_event(&conn, &event_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn replay_event(
    state: tauri::State<'_, AppState>,
    event_id: String,
) -> Result<ReplayResult, String> {
    // Look up the original event
    let conn = state.db.lock().await;
    let event = db::get_event(&conn, &event_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Event not found".to_string())?;

    // Look up the service to get the port
    let service = db::get_service(&conn, &event.service_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Service not found".to_string())?;
    drop(conn);

    // Re-send the request to localhost
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let (status, headers, body, latency_ms) = svc::forward_to_localhost(
        &client,
        &service,
        &event.method,
        &event.path,
        &event.request_headers,
        event.request_body.as_deref(),
    )
    .await?;

    Ok(ReplayResult {
        status,
        headers,
        body,
        latency_ms,
    })
}
