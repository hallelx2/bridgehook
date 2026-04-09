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
        ",
    )
    .expect("failed to create tables");

    conn
}

// ── Service CRUD ──────────────────────────────────────────────────────

pub fn insert_service(conn: &Connection, service: &Service) -> Result<()> {
    conn.execute(
        "INSERT INTO services (id, name, port, path, channel_id, secret, active, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            service.id,
            service.name,
            service.port,
            service.path,
            service.channel_id,
            service.secret,
            service.active,
            service.created_at,
        ],
    )?;
    Ok(())
}

pub fn get_services(conn: &Connection) -> Result<Vec<Service>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, port, path, channel_id, secret, active, created_at
         FROM services ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Service {
            id: row.get(0)?,
            name: row.get(1)?,
            port: row.get(2)?,
            path: row.get(3)?,
            channel_id: row.get(4)?,
            secret: row.get(5)?,
            active: row.get(6)?,
            created_at: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn get_service(conn: &Connection, service_id: &str) -> Result<Option<Service>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, port, path, channel_id, secret, active, created_at
         FROM services WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![service_id], |row| {
        Ok(Service {
            id: row.get(0)?,
            name: row.get(1)?,
            port: row.get(2)?,
            path: row.get(3)?,
            channel_id: row.get(4)?,
            secret: row.get(5)?,
            active: row.get(6)?,
            created_at: row.get(7)?,
        })
    })?;
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
