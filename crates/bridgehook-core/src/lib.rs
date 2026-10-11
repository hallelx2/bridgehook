//! BridgeHook protocol client, shared by the CLI (and later the desktop app).
//!
//! - [`config`]: where tokens, channel keys and the executor id live.
//! - [`keys`]: per-channel ECDSA P-256 keys and request signing.
//! - [`relay`]: the typed, signed relay API.
//! - [`auth`]: device-code pairing (`bridgehook login`).
//! - [`drain`]: ordered delivery of a channel's queue to a local target.
//! - [`forward`]: sending one webhook to the local target.
//! - [`stream`]: the `/api/me/stream` wake-up signal.
//!
//! No terminal or UI code lives here.

pub mod auth;
pub mod config;
pub mod drain;
pub mod forward;
pub mod keys;
pub mod relay;
pub mod stream;

/// The hosted relay. Self-hosters pass their own with `--relay`.
pub const DEFAULT_RELAY_URL: &str = "https://relay.bridgehook.dev";
