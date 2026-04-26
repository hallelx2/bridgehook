use crate::models::{Service, WebhookEvent};
use rusqlite::{params, Connection, Result};
use std::path::Path;

/// Initialize the SQLite database, creating tables if they don't exist.
pub fn init_db(app_data_dir: &Path) -> Connection {
    let db_path = app_data_dir.join("bridgehook.db");
    let conn = Connection::open(db_path).expect("failed to open database");

    // Enable WAL mode for concurrent read/write safety
    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .expect("failed to set WAL mode");

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS services (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            port        INTEGER NOT NULL,
            path        TEXT NOT NULL,
            channel_id  TEXT NOT NULL,
            secret      TEXT NOT NULL,
            active      BOOLEAN DEFAULT 1,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events (
            id                TEXT PRIMARY KEY,
            service_id        TEXT NOT NULL REFERENCES services(id),
            method            TEXT NOT NULL,
            path              TEXT NOT NULL,
            request_headers   TEXT NOT NULL,
            request_body      TEXT,
            response_status   INTEGER,
            response_headers  TEXT,
            response_body     TEXT,
            latency_ms        INTEGER,
            error             TEXT,
            received_at       TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_events_service
            ON events(service_id, received_at DESC);

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )
    .expect("failed to create tables");

    // Lightweight column-level migrations. SQLite doesn't support IF NOT EXISTS
    // on ALTER TABLE — we swallow duplicate-column errors.
    run_migrations(&conn);

    conn
}

fn run_migrations(conn: &Connection) {
    let migrations: &[&str] = &[
        "ALTER TABLE services ADD COLUMN path_rewrite TEXT",
        "ALTER TABLE services ADD COLUMN injected_headers TEXT",
        "ALTER TABLE services ADD COLUMN timeout_ms INTEGER",
        "ALTER TABLE services ADD COLUMN retry_count INTEGER DEFAULT 0",
        "ALTER TABLE services ADD COLUMN retry_delay_ms INTEGER DEFAULT 1000",
        "ALTER TABLE services ADD COLUMN environments TEXT",
        "ALTER TABLE services ADD COLUMN active_environment TEXT",
        "ALTER TABLE services ADD COLUMN signing_provider TEXT",
        "ALTER TABLE services ADD COLUMN signing_secret TEXT",
        "ALTER TABLE services ADD COLUMN mock_response TEXT",
        "ALTER TABLE services ADD COLUMN notify_on_event INTEGER DEFAULT 0",
        "ALTER TABLE services ADD COLUMN private_key_pkcs8 BLOB",
    ];
    for sql in migrations {
        if let Err(e) = conn.execute(sql, []) {
            // ignore duplicate-column errors (column already exists)
            let msg = e.to_string();
            if !msg.contains("duplicate column") {
                log::warn!("Migration failed ({}): {}", sql, msg);
            }
        }
    }
}

// ── Settings key/value store ──────────────────────────────────────────

pub fn settings_get(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))?;
    match rows.next() {
        Some(Ok(v)) => Ok(Some(v)),
        Some(Err(e)) => Err(e),
        None => Ok(None),
    }
}

pub fn settings_set(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Delete events older than `cutoff_iso` (RFC3339 timestamp).
/// Returns the number of rows deleted.
pub fn delete_events_older_than(conn: &Connection, cutoff_iso: &str) -> Result<usize> {
    conn.execute(
        "DELETE FROM events WHERE received_at < ?1",
        params![cutoff_iso],
    )
}

/// Delete events for a specific service.
pub fn delete_events_for_service(conn: &Connection, service_id: &str) -> Result<usize> {
    conn.execute(
        "DELETE FROM events WHERE service_id = ?1",
        params![service_id],
    )
}

/// Clear ALL events across all services.
pub fn clear_all_events(conn: &Connection) -> Result<usize> {
    conn.execute("DELETE FROM events", [])
}

// ── Service CRUD ──────────────────────────────────────────────────────

const SERVICE_COLUMNS: &str = "id, name, port, path, channel_id, secret, active, created_at, \
     path_rewrite, injected_headers, timeout_ms, retry_count, retry_delay_ms, \
     environments, active_environment, signing_provider, signing_secret, \
     mock_response, notify_on_event, private_key_pkcs8";

fn row_to_service(row: &rusqlite::Row) -> rusqlite::Result<Service> {
    Ok(Service {
        id: row.get(0)?,
        name: row.get(1)?,
        port: row.get(2)?,
        path: row.get(3)?,
        channel_id: row.get(4)?,
        secret: row.get(5)?,
        active: row.get(6)?,
        created_at: row.get(7)?,
        path_rewrite: row.get(8).ok(),
        injected_headers: row.get(9).ok(),
        timeout_ms: row.get::<_, Option<i64>>(10).ok().flatten().map(|v| v as u32),
        retry_count: row.get::<_, Option<i64>>(11).ok().flatten().unwrap_or(0) as u32,
        retry_delay_ms: row.get::<_, Option<i64>>(12).ok().flatten().unwrap_or(1000) as u32,
        environments: row.get(13).ok(),
        active_environment: row.get(14).ok(),
        signing_provider: row.get(15).ok(),
        signing_secret: row.get(16).ok(),
        mock_response: row.get(17).ok(),
        notify_on_event: row
            .get::<_, Option<i64>>(18)
            .ok()
            .flatten()
            .map(|v| v != 0)
            .unwrap_or(false),
        private_key_pkcs8: row.get::<_, Option<Vec<u8>>>(19).ok().flatten(),
    })
}

pub fn insert_service(conn: &Connection, service: &Service) -> Result<()> {
    conn.execute(
        "INSERT INTO services
         (id, name, port, path, channel_id, secret, active, created_at,
          path_rewrite, injected_headers, timeout_ms, retry_count, retry_delay_ms,
          environments, active_environment, signing_provider, signing_secret,
          mock_response, notify_on_event, private_key_pkcs8)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                 ?9, ?10, ?11, ?12, ?13,
                 ?14, ?15, ?16, ?17,
                 ?18, ?19, ?20)",
        params![
            service.id,
            service.name,
            service.port,
            service.path,
            service.channel_id,
            service.secret,
            service.active,
            service.created_at,
            service.path_rewrite,
            service.injected_headers,
            service.timeout_ms,
            service.retry_count,
            service.retry_delay_ms,
            service.environments,
            service.active_environment,
            service.signing_provider,
            service.signing_secret,
            service.mock_response,
            service.notify_on_event as i64,
            service.private_key_pkcs8,
        ],
    )?;
    Ok(())
}

pub fn update_service_config(conn: &Connection, service: &Service) -> Result<()> {
    conn.execute(
        "UPDATE services SET
            name = ?2, port = ?3, path = ?4,
            path_rewrite = ?5, injected_headers = ?6, timeout_ms = ?7,
            retry_count = ?8, retry_delay_ms = ?9,
            environments = ?10, active_environment = ?11,
            signing_provider = ?12, signing_secret = ?13,
            mock_response = ?14, notify_on_event = ?15
         WHERE id = ?1",
        params![
            service.id,
            service.name,
            service.port,
            service.path,
            service.path_rewrite,
            service.injected_headers,
            service.timeout_ms,
            service.retry_count,
            service.retry_delay_ms,
            service.environments,
            service.active_environment,
            service.signing_provider,
            service.signing_secret,
            service.mock_response,
            service.notify_on_event as i64,
        ],
    )?;
    Ok(())
}

pub fn get_services(conn: &Connection) -> Result<Vec<Service>> {
    let sql = format!(
        "SELECT {} FROM services ORDER BY created_at ASC",
        SERVICE_COLUMNS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_service)?;
    rows.collect()
}

pub fn get_service(conn: &Connection, service_id: &str) -> Result<Option<Service>> {
    let sql = format!("SELECT {} FROM services WHERE id = ?1", SERVICE_COLUMNS);
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![service_id], row_to_service)?;
    match rows.next() {
        Some(Ok(service)) => Ok(Some(service)),
        Some(Err(e)) => Err(e),
        None => Ok(None),
    }
}

pub fn update_service_active(conn: &Connection, service_id: &str, active: bool) -> Result<()> {
    conn.execute(
        "UPDATE services SET active = ?1 WHERE id = ?2",
        params![active, service_id],
    )?;
    Ok(())
}

pub fn delete_service(conn: &Connection, service_id: &str) -> Result<()> {
    // Delete associated events first
    conn.execute(
        "DELETE FROM events WHERE service_id = ?1",
        params![service_id],
    )?;
    conn.execute("DELETE FROM services WHERE id = ?1", params![service_id])?;
    Ok(())
}

// ── Event CRUD ────────────────────────────────────────────────────────

pub fn insert_event(conn: &Connection, event: &WebhookEvent) -> Result<()> {
    conn.execute(
        "INSERT INTO events (id, service_id, method, path, request_headers, request_body,
         response_status, response_headers, response_body, latency_ms, error, received_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            event.id,
            event.service_id,
            event.method,
            event.path,
            event.request_headers,
            event.request_body,
            event.response_status,
            event.response_headers,
            event.response_body,
            event.latency_ms,
            event.error,
            event.received_at,
        ],
    )?;
    Ok(())
}

pub fn get_events(
    conn: &Connection,
    service_id: Option<&str>,
    limit: u32,
    offset: u32,
) -> Result<Vec<WebhookEvent>> {
    let (sql, params_vec): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match service_id {
        Some(sid) => (
            "SELECT id, service_id, method, path, request_headers, request_body,
                    response_status, response_headers, response_body, latency_ms, error, received_at
             FROM events WHERE service_id = ?1
             ORDER BY received_at DESC LIMIT ?2 OFFSET ?3"
                .to_string(),
            vec![
                Box::new(sid.to_string()),
                Box::new(limit),
                Box::new(offset),
            ],
        ),
        None => (
            "SELECT id, service_id, method, path, request_headers, request_body,
                    response_status, response_headers, response_body, latency_ms, error, received_at
             FROM events
             ORDER BY received_at DESC LIMIT ?1 OFFSET ?2"
                .to_string(),
            vec![Box::new(limit), Box::new(offset)],
        ),
    };

    let mut stmt = conn.prepare(&sql)?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let rows = stmt.query_map(params_refs.as_slice(), |row| {
        Ok(WebhookEvent {
            id: row.get(0)?,
            service_id: row.get(1)?,
            method: row.get(2)?,
            path: row.get(3)?,
            request_headers: row.get(4)?,
            request_body: row.get(5)?,
            response_status: row.get(6)?,
            response_headers: row.get(7)?,
            response_body: row.get(8)?,
            latency_ms: row.get(9)?,
            error: row.get(10)?,
            received_at: row.get(11)?,
        })
    })?;
    rows.collect()
}

pub fn get_event(conn: &Connection, event_id: &str) -> Result<Option<WebhookEvent>> {
    let mut stmt = conn.prepare(
        "SELECT id, service_id, method, path, request_headers, request_body,
                response_status, response_headers, response_body, latency_ms, error, received_at
         FROM events WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![event_id], |row| {
        Ok(WebhookEvent {
            id: row.get(0)?,
            service_id: row.get(1)?,
            method: row.get(2)?,
            path: row.get(3)?,
            request_headers: row.get(4)?,
            request_body: row.get(5)?,
            response_status: row.get(6)?,
            response_headers: row.get(7)?,
            response_body: row.get(8)?,
            latency_ms: row.get(9)?,
            error: row.get(10)?,
            received_at: row.get(11)?,
        })
    })?;
    match rows.next() {
        Some(Ok(event)) => Ok(Some(event)),
        Some(Err(e)) => Err(e),
        None => Ok(None),
    }
}
