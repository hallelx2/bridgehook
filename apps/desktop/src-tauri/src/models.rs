use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A configured webhook service (stored in SQLite)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Service {
    pub id: String,
    pub name: String,
    pub port: u16,
    pub path: String,
    pub channel_id: String,
    pub secret: String,
    pub active: bool,
    pub created_at: String,
}

/// A stored webhook event with request + response (stored in SQLite)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookEvent {
    pub id: String,
    pub service_id: String,
    pub method: String,
    pub path: String,
    pub request_headers: String,
    pub request_body: Option<String>,
    pub response_status: Option<i32>,
    pub response_headers: Option<String>,
    pub response_body: Option<String>,
    pub latency_ms: Option<i64>,
    pub error: Option<String>,
    pub received_at: String,
}

/// SSE message received from the relay server
#[derive(Debug, Clone, Deserialize)]
pub struct SseMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub id: Option<String>,
    pub method: Option<String>,
    pub path: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
}

/// Payload sent to relay to deliver the localhost response
#[derive(Debug, Serialize)]
pub struct SendResponsePayload {
    #[serde(rename = "eventId")]
    pub event_id: String,
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Response from the relay when creating a channel
#[derive(Debug, Deserialize)]
pub struct CreateChannelResponse {
    #[serde(rename = "channelId")]
    pub channel_id: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
}

/// Bridge status emitted to the frontend
#[derive(Debug, Clone, Serialize)]
pub struct BridgeStatus {
    pub service_id: String,
    pub connected: bool,
    pub error: Option<String>,
}

/// Webhook event payload emitted to the frontend in real-time
#[derive(Debug, Clone, Serialize)]
pub struct WebhookEventPayload {
    pub id: String,
    pub service_id: String,
    pub service_name: String,
    pub method: String,
    pub path: String,
    pub request_headers: HashMap<String, String>,
    pub request_body: Option<String>,
    pub response_status: Option<i32>,
    pub response_body: Option<String>,
    pub latency_ms: Option<i64>,
    pub error: Option<String>,
    pub received_at: String,
}

/// Result of replaying an event
#[derive(Debug, Serialize)]
pub struct ReplayResult {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub latency_ms: i64,
}
