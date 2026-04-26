use crate::db;
use crate::models::Service;
use crate::services;
use crate::state::AppState;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

const TRAY_ID: &str = "bridgehook-tray";

/// Create the tray icon with menu items that reflect current services.
pub fn create_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let menu = build_tray_menu(app, &[])?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().cloned().unwrap())
        .tooltip("BridgeHook — 0 services")
        .menu(&menu)
        .on_menu_event(move |app, event| handle_menu(app, event.id().as_ref()))
        .build(app)?;

    // Initial refresh once the database is available.
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        refresh_tray(&app_clone).await;
    });

    Ok(())
}

fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "open_dashboard" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        "pause_all" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(state) = app.try_state::<AppState>() {
                    let all = {
                        let conn = state.db.lock().await;
                        db::get_services(&conn).unwrap_or_default()
                    };
                    for service in &all {
                        if service.active {
                            services::stop_bridge(&service.id, &state).await;
                            let conn = state.db.lock().await;
                            let _ = db::update_service_active(&conn, &service.id, false);
                        }
                    }
                    refresh_tray(&app).await;
                }
            });
        }
        "start_all" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(state) = app.try_state::<AppState>() {
                    let all = {
                        let conn = state.db.lock().await;
                        db::get_services(&conn).unwrap_or_default()
                    };
                    for service in &all {
                        if !service.active {
                            let conn = state.db.lock().await;
                            let _ = db::update_service_active(&conn, &service.id, true);
                            drop(conn);
                            let mut updated = service.clone();
                            updated.active = true;
                            services::start_bridge(&app, &updated, &state).await;
                        }
                    }
                    refresh_tray(&app).await;
                }
            });
        }
        "copy_urls" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(state) = app.try_state::<AppState>() {
                    let all = {
                        let conn = state.db.lock().await;
                        db::get_services(&conn).unwrap_or_default()
                    };
                    let urls: Vec<String> = all
                        .iter()
                        .filter(|s| s.active)
                        .map(|s| {
                            format!(
                                "{}: https://bridgehook-relay.halleluyaholudele.workers.dev/hook/{}",
                                s.name, s.channel_id
                            )
                        })
                        .collect();
                    let _ = app.clipboard().write_text(urls.join("\n"));
                }
            });
        }
        "quit" => {
            app.exit(0);
        }
        other => {
            // Per-service toggle via "service_<id>"
            if let Some(service_id) = other.strip_prefix("service_") {
                let app = app.clone();
                let service_id = service_id.to_string();
                tauri::async_runtime::spawn(async move {
                    if let Some(state) = app.try_state::<AppState>() {
                        let conn = state.db.lock().await;
                        if let Ok(Some(service)) = db::get_service(&conn, &service_id) {
                            if service.active {
                                services::stop_bridge(&service_id, &state).await;
                                let _ = db::update_service_active(&conn, &service_id, false);
                            } else {
                                let _ = db::update_service_active(&conn, &service_id, true);
                                let mut updated = service.clone();
                                updated.active = true;
                                drop(conn);
                                services::start_bridge(&app, &updated, &state).await;
                            }
                        }
                    }
                    refresh_tray(&app).await;
                });
            }
        }
    }
}

/// Rebuild the tray menu and update the tooltip to reflect current service state.
/// Call this whenever services change (add, remove, toggle).
pub async fn refresh_tray(app: &AppHandle) {
    let state = match app.try_state::<AppState>() {
        Some(s) => s,
        None => return,
    };
    let services_list = {
        let conn = state.db.lock().await;
        db::get_services(&conn).unwrap_or_default()
    };
    let active_count = services_list.iter().filter(|s| s.active).count();
    let total = services_list.len();
    let tooltip = if total == 0 {
        "BridgeHook — no services".to_string()
    } else {
        format!("BridgeHook — {}/{} active", active_count, total)
    };

    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let _ = tray.set_tooltip(Some(&tooltip));
    if let Ok(menu) = build_tray_menu(app, &services_list) {
        let _ = tray.set_menu(Some(menu));
    }
}

/// Build the tray context menu.
pub fn build_tray_menu(
    app: &AppHandle,
    services_list: &[Service],
) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let menu = Menu::new(app)?;

    if services_list.is_empty() {
        menu.append(&MenuItem::with_id(
            app,
            "no_services",
            "No services configured",
            false,
            None::<&str>,
        )?)?;
    } else {
        for service in services_list {
            let dot = if service.active { "\u{25CF}" } else { "\u{25CB}" }; // ● / ○
            let label = format!("{} {}  :{}", dot, service.name, service.port);
            menu.append(&MenuItem::with_id(
                app,
                format!("service_{}", service.id),
                label,
                true,
                None::<&str>,
            )?)?;
        }
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        "open_dashboard",
        "Open dashboard",
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "start_all",
        "Start all",
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "pause_all",
        "Pause all",
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "copy_urls",
        "Copy webhook URLs",
        true,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        "quit",
        "Quit BridgeHook",
        true,
        None::<&str>,
    )?)?;

    Ok(menu)
}
