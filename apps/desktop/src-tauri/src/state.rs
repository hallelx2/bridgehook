use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;

/// Shared application state managed by Tauri
#[derive(Clone)]
pub struct AppState {
    /// Active bridge tasks keyed by service ID
    pub bridges: Arc<RwLock<HashMap<String, JoinHandle<()>>>>,
    /// SQLite database connection (rusqlite for Rust-side writes)
    pub db: Arc<Mutex<Connection>>,
    /// Timestamp of the last received webhook event (for tray icon status)
    pub last_event_time: Arc<RwLock<Option<Instant>>>,
}
