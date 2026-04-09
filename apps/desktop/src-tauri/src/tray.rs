use crate::db;
use crate::models::Service;
use crate::services;
use crate::state::AppState;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

/// Icon state for the system tray
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TrayStatus {
    Connected,
    Idle,
    Disconnected,
}

/// Create the system tray icon with a right-click context menu.
pub fn create_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let menu = build_tray_menu(app, &[])?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().unwrap())
        .tooltip("BridgeHook")
        .menu(&menu)
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref().to_string();
            match id.as_str() {
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
                            let conn = state.db.lock().await;
                            let all_services = db::get_services(&conn).unwrap_or_default();
                            drop(conn);
                            for service in &all_services {
                                if service.active {
                                    services::stop_bridge(&service.id, &state).await;
                                    let conn = state.db.lock().await;
                                    let _ =
                                        db::update_service_active(&conn, &service.id, false);
                                    drop(conn);
                                }
                            }
                        }
                    });
                }
                "copy_urls" => {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Some(state) = app.try_state::<AppState>() {
                            let conn = state.db.lock().await;
                            let all_services = db::get_services(&conn).unwrap_or_default();
                            drop(conn);
                            let urls: Vec<String> = all_services
                                .iter()
                                .filter(|s| s.active)
                                .map(|s| {
                                    format!(
                                        "{}: https://relay.bridgehook.dev/hook/{}",
                                        s.name, s.channel_id
                                    )
                                })
                                .collect();

                            use tauri_plugin_clipboard_manager::ClipboardExt;
                            let _ = app.clipboard().write_text(urls.join("\n"));
                        }
                    });
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {
                    // Handle service toggle (e.g., "service_<id>")
                    if let Some(service_id) = id.strip_prefix("service_") {
                        let app = app.clone();
                        let service_id = service_id.to_string();
                        tauri::async_runtime::spawn(async move {
                            if let Some(state) = app.try_state::<AppState>() {
                                let conn = state.db.lock().await;
                                if let Ok(Some(service)) =
                                    db::get_service(&conn, &service_id)
                                {
                                    if service.active {
                                        services::stop_bridge(&service_id, &state).await;
                                        let _ = db::update_service_active(
                                            &conn,
                                            &service_id,
                                            false,
                                        );
                                    } else {
                                        let _ = db::update_service_active(
                                            &conn,
                                            &service_id,
                                            true,
                                        );
                                        let mut updated = service.clone();
                                        updated.active = true;
                                        drop(conn);
                                        services::start_bridge(&app, &updated, &state).await;
                                    }
                                }
                            }
                        });
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Build the tray context menu with service list and actions.
pub fn build_tray_menu(
    app: &AppHandle,
    services_list: &[Service],
) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let menu = Menu::new(app)?;

    // Service items with status indicators
    if services_list.is_empty() {
        let item = MenuItem::with_id(app, "no_services", "No services configured", false, None::<&str>)?;
        menu.append(&item)?;
    } else {
        for service in services_list {
            let dot = if service.active { "\u{25CF}" } else { "\u{25CB}" }; // ● or ○
            let label = format!("{} {}  :{}", dot, service.name, service.port);
            let item =
                MenuItem::with_id(app, &format!("service_{}", service.id), label, true, None::<&str>)?;
            menu.append(&item)?;
        }
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;

    let open = MenuItem::with_id(app, "open_dashboard", "Open Dashboard", true, None::<&str>)?;
    menu.append(&open)?;

    let pause = MenuItem::with_id(app, "pause_all", "Pause All", true, None::<&str>)?;
    menu.append(&pause)?;

    let copy = MenuItem::with_id(app, "copy_urls", "Copy URLs", true, None::<&str>)?;
    menu.append(&copy)?;

    menu.append(&PredefinedMenuItem::separator(app)?)?;

    let quit = MenuItem::with_id(app, "quit", "Quit BridgeHook", true, None::<&str>)?;
    menu.append(&quit)?;

    Ok(menu)
}
