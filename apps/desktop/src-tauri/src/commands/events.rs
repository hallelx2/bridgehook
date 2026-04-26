use crate::db;
use crate::models::{ReplayResult, WebhookEvent};
use crate::services as svc;
use crate::state::AppState;
use std::collections::HashMap;

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

    let client = build_replay_client(&service).map_err(|e| e.to_string())?;

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

/// Replay with user-edited headers and body.
#[tauri::command]
pub async fn replay_event_with_edits(
    state: tauri::State<'_, AppState>,
    event_id: String,
    headers: HashMap<String, String>,
    body: String,
) -> Result<ReplayResult, String> {
    let conn = state.db.lock().await;
    let event = db::get_event(&conn, &event_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Event not found".to_string())?;
    let service = db::get_service(&conn, &event.service_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Service not found".to_string())?;
    drop(conn);

    let client = build_replay_client(&service).map_err(|e| e.to_string())?;
    let headers_json = serde_json::to_string(&headers).unwrap_or_else(|_| "{}".to_string());

    let (status, headers, body, latency_ms) = svc::forward_to_localhost(
        &client,
        &service,
        &event.method,
        &event.path,
        &headers_json,
        if body.is_empty() { None } else { Some(&body) },
    )
    .await?;

    Ok(ReplayResult {
        status,
        headers,
        body,
        latency_ms,
    })
}

/// Manually send a webhook-like request to a service's localhost (without going through the relay).
/// Lets users test their handler from the Desktop app.
#[tauri::command]
pub async fn send_manual_request(
    state: tauri::State<'_, AppState>,
    service_id: String,
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: String,
) -> Result<ReplayResult, String> {
    let conn = state.db.lock().await;
    let service = db::get_service(&conn, &service_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Service not found".to_string())?;
    drop(conn);

    let client = build_replay_client(&service).map_err(|e| e.to_string())?;
    let headers_json = serde_json::to_string(&headers).unwrap_or_else(|_| "{}".to_string());

    let (status, headers, body, latency_ms) = svc::forward_to_localhost(
        &client,
        &service,
        &method,
        &path,
        &headers_json,
        if body.is_empty() { None } else { Some(&body) },
    )
    .await?;

    Ok(ReplayResult {
        status,
        headers,
        body,
        latency_ms,
    })
}

#[tauri::command]
pub async fn clear_events_for_service(
    state: tauri::State<'_, AppState>,
    service_id: String,
) -> Result<usize, String> {
    let conn = state.db.lock().await;
    db::delete_events_for_service(&conn, &service_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_all_events(state: tauri::State<'_, AppState>) -> Result<usize, String> {
    let conn = state.db.lock().await;
    db::clear_all_events(&conn).map_err(|e| e.to_string())
}

/// Delete events older than N days. Returns rows deleted.
#[tauri::command]
pub async fn apply_event_retention(
    state: tauri::State<'_, AppState>,
    days: u32,
) -> Result<usize, String> {
    let cutoff = chrono::Utc::now() - chrono::Duration::days(days as i64);
    let cutoff_iso = cutoff.to_rfc3339();
    let conn = state.db.lock().await;
    db::delete_events_older_than(&conn, &cutoff_iso).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_setting(
    state: tauri::State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    let conn = state.db.lock().await;
    db::settings_get(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_setting(
    state: tauri::State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn = state.db.lock().await;
    db::settings_set(&conn, &key, &value).map_err(|e| e.to_string())
}

fn build_replay_client(service: &crate::models::Service) -> Result<reqwest::Client, String> {
    let timeout_ms = service.timeout_ms.unwrap_or(30_000) as u64;
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| e.to_string())
}
