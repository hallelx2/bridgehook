mod bridge;
mod commands;
mod crypto;
mod db;
mod models;
mod services;
mod state;
mod tray;

use state::AppState;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::{Mutex, RwLock};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_data_dir)?;

            let conn = db::init_db(&app_data_dir);
            let app_state = AppState {
                bridges: Arc::new(RwLock::new(std::collections::HashMap::new())),
                db: Arc::new(Mutex::new(conn)),
                last_event_time: Arc::new(RwLock::new(None)),
            };

            app.manage(app_state.clone());

            // Set up the system tray
            let _ = tray::create_tray(app.handle());

            // Auto-start active services + apply retention policy
            let app_handle = app.handle().clone();
            let state_clone = app_state.clone();
            tauri::async_runtime::spawn(async move {
                // Apply retention if configured. Default: keep everything.
                let retention_days: Option<u32> = {
                    let conn = state_clone.db.lock().await;
                    db::settings_get(&conn, "retention_days")
                        .ok()
                        .flatten()
                        .and_then(|s| s.parse::<u32>().ok())
                };
                if let Some(days) = retention_days {
                    if days > 0 {
                        let cutoff = chrono::Utc::now() - chrono::Duration::days(days as i64);
                        let conn = state_clone.db.lock().await;
                        match db::delete_events_older_than(&conn, &cutoff.to_rfc3339()) {
                            Ok(n) if n > 0 => log::info!(
                                "Retention: deleted {} events older than {} days",
                                n,
                                days
                            ),
                            _ => {}
                        }
                    }
                }

                let active_services = {
                    let conn = state_clone.db.lock().await;
                    db::get_services(&conn).unwrap_or_default()
                };
                for service in active_services {
                    if service.active {
                        services::start_bridge(&app_handle, &service, &state_clone).await;
                    }
                }
                tray::refresh_tray(&app_handle).await;
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Close to tray instead of quitting
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::services::add_service,
            commands::services::remove_service,
            commands::services::toggle_service,
            commands::services::list_services,
            commands::services::scan_ports,
            commands::services::auto_detect,
            commands::services::import_from_extension,
            commands::services::update_service,
            commands::events::get_events,
            commands::events::get_event,
            commands::events::replay_event,
            commands::events::replay_event_with_edits,
            commands::events::send_manual_request,
            commands::events::clear_events_for_service,
            commands::events::clear_all_events,
            commands::events::apply_event_retention,
            commands::events::get_setting,
            commands::events::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
