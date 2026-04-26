//! Per-channel ECDSA P-256 signing for relay auth.
//!
//! The desktop client mirrors the web/extension auth model:
//!   • A keypair is generated when a channel is created.
//!   • The public key (uncompressed raw, 130 hex chars) is registered with
//!     the relay.
//!   • The private key is persisted as PKCS#8 DER bytes inside our SQLite
//!     `services` table (column `private_key_pkcs8 BLOB`). The desktop
//!     threat model treats the SQLite file as the trust boundary; nothing
//!     outside that file can authenticate to the channel.
//!   • Every authenticated request to the relay is signed:
//!         sig = ECDSA_P256_SHA256(key, "METHOD\nPATH\nTIMESTAMP\nSHA256(body)")
//!     and shipped as `X-BH-Timestamp` + `X-BH-Signature` (hex) headers.
//!     The relay verifies and rejects requests outside a 60s window.

use p256::{
    ecdsa::{signature::Signer, Signature, SigningKey, VerifyingKey},
    pkcs8::{DecodePrivateKey, EncodePrivateKey},
    SecretKey,
};
use rand_core::OsRng;
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

/// Bundle returned from `generate_keypair`.
pub struct GeneratedKey {
    /// Hex-encoded raw uncompressed public key (130 chars). Send this to the relay.
    pub public_key_hex: String,
    /// PKCS#8 DER-encoded private key. Persist this in SQLite; never log it.
    pub pkcs8: Vec<u8>,
}

/// Generate a fresh ECDSA P-256 keypair using the OS RNG.
pub fn generate_keypair() -> Result<GeneratedKey, String> {
    let secret_key = SecretKey::random(&mut OsRng);
    let signing_key = SigningKey::from(&secret_key);
    let verifying_key = VerifyingKey::from(&signing_key);

    // Uncompressed encoding: 0x04 || X (32) || Y (32) = 65 bytes → 130 hex chars
    let encoded = verifying_key.to_encoded_point(false);
    let public_key_hex = hex::encode(encoded.as_bytes());

    let pkcs8_doc = secret_key
        .to_pkcs8_der()
        .map_err(|e| format!("Failed to serialize private key: {}", e))?;
    let pkcs8 = pkcs8_doc.as_bytes().to_vec();

    Ok(GeneratedKey {
        public_key_hex,
        pkcs8,
    })
}

/// Sign a canonical request string with a stored PKCS#8 private key.
/// Returns the signature as 128 hex chars (fixed-size r||s, 64 bytes).
pub fn sign_canonical(pkcs8: &[u8], canonical: &str) -> Result<String, String> {
    let secret_key = SecretKey::from_pkcs8_der(pkcs8)
        .map_err(|e| format!("Failed to load private key: {}", e))?;
    let signing_key = SigningKey::from(&secret_key);
    let signature: Signature = signing_key.sign(canonical.as_bytes());
    Ok(hex::encode(signature.to_bytes()))
}

/// Build the canonical request string the relay expects:
///     METHOD\nPATH\nTIMESTAMP_MS\nSHA256(body_hex)
fn canonical(method: &str, path: &str, timestamp_ms: u128, body: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(body.as_bytes());
    let body_hash = hex::encode(hasher.finalize());
    format!(
        "{}\n{}\n{}\n{}",
        method.to_uppercase(),
        path,
        timestamp_ms,
        body_hash
    )
}

fn current_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Path component of `url`, falling back to `/` if parsing fails.
/// The relay's verifier signs over the pathname only (no host, no query).
/// Manual extraction to avoid pulling in the `url` crate.
fn path_only(url: &str) -> String {
    // Find scheme://
    let after_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    // First '/' after the host marks the start of the path
    let path_and_rest = match after_scheme.find('/') {
        Some(idx) => &after_scheme[idx..],
        None => "/",
    };
    // Strip query string and fragment
    let path = path_and_rest
        .split_once('?')
        .map(|(p, _)| p)
        .unwrap_or(path_and_rest);
    let path = path.split_once('#').map(|(p, _)| p).unwrap_or(path);
    if path.is_empty() {
        "/".to_string()
    } else {
        path.to_string()
    }
}

/// Build the (timestamp, signature) header pair for a request.
pub fn build_signature_headers(
    pkcs8: &[u8],
    method: &str,
    url: &str,
    body: &str,
) -> Result<(String, String), String> {
    let ts = current_timestamp_ms();
    let canon = canonical(method, &path_only(url), ts, body);
    let sig = sign_canonical(pkcs8, &canon)?;
    Ok((ts.to_string(), sig))
}

/// Convenience: send an authenticated GET. Returns the response.
pub async fn signed_get(
    client: &reqwest::Client,
    pkcs8: &[u8],
    url: &str,
) -> Result<reqwest::Response, String> {
    let (ts, sig) = build_signature_headers(pkcs8, "GET", url, "")?;
    client
        .get(url)
        .header("X-BH-Timestamp", ts)
        .header("X-BH-Signature", sig)
        .send()
        .await
        .map_err(|e| format!("Signed GET failed: {}", e))
}

/// Convenience: send an authenticated POST with a JSON-serializable body.
pub async fn signed_post_json<T: serde::Serialize>(
    client: &reqwest::Client,
    pkcs8: &[u8],
    url: &str,
    body: &T,
) -> Result<reqwest::Response, String> {
    let body_str =
        serde_json::to_string(body).map_err(|e| format!("Failed to serialize body: {}", e))?;
    let (ts, sig) = build_signature_headers(pkcs8, "POST", url, &body_str)?;
    client
        .post(url)
        .header("Content-Type", "application/json")
        .header("X-BH-Timestamp", ts)
        .header("X-BH-Signature", sig)
        .body(body_str)
        .send()
        .await
        .map_err(|e| format!("Signed POST failed: {}", e))
}
