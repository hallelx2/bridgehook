//! Per-channel ECDSA P-256 keys and request signing.
//!
//! The relay verifies signed executor requests (claim, response, the pending
//! queue, signed DELETE) with WebCrypto ECDSA P-256 / SHA-256 over:
//!
//! ```text
//! METHOD \n PATHNAME \n TIMESTAMP_MS \n hex(sha256(body))
//! ```
//!
//! sent as `X-BH-Timestamp` and `X-BH-Signature` (hex of the 64-byte r‖s
//! signature). The public key is the uncompressed SEC1 point, hex (130
//! chars), the same encoding as the extension and the desktop app.

use crate::config::{write_private, Paths};
use anyhow::{Context, Result};
use p256::ecdsa::{signature::Signer, Signature, SigningKey, VerifyingKey};
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey};
use p256::SecretKey;
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
pub struct ChannelKey {
    signing: SigningKey,
}

impl ChannelKey {
    pub fn generate() -> Self {
        Self {
            signing: SigningKey::random(&mut rand_core::OsRng),
        }
    }

    pub fn from_pkcs8(der: &[u8]) -> Result<Self> {
        let secret = SecretKey::from_pkcs8_der(der).context("reading channel key")?;
        Ok(Self {
            signing: SigningKey::from(&secret),
        })
    }

    pub fn to_pkcs8(&self) -> Result<Vec<u8>> {
        let secret = SecretKey::from(self.signing.as_nonzero_scalar());
        Ok(secret
            .to_pkcs8_der()
            .context("encoding channel key")?
            .as_bytes()
            .to_vec())
    }

    /// Uncompressed SEC1 public key, hex (130 chars), as the relay expects.
    pub fn public_key_hex(&self) -> String {
        let verifying = VerifyingKey::from(&self.signing);
        hex::encode(verifying.to_encoded_point(false).as_bytes())
    }

    /// Signature headers for one request: `(X-BH-Timestamp, X-BH-Signature)`.
    pub fn sign_request(&self, method: &str, pathname: &str, body: &str) -> (String, String) {
        self.sign_request_at(method, pathname, body, now_ms())
    }

    pub fn sign_request_at(
        &self,
        method: &str,
        pathname: &str,
        body: &str,
        timestamp_ms: u128,
    ) -> (String, String) {
        let canon = canonical(method, pathname, timestamp_ms, body);
        let signature: Signature = self.signing.sign(canon.as_bytes());
        (timestamp_ms.to_string(), hex::encode(signature.to_bytes()))
    }

    pub fn save(&self, paths: &Paths, channel_id: &str) -> Result<()> {
        write_private(&paths.key_file(channel_id), &self.to_pkcs8()?)
    }

    pub fn load(paths: &Paths, channel_id: &str) -> Result<Option<Self>> {
        match std::fs::read(paths.key_file(channel_id)) {
            Ok(der) => Ok(Some(Self::from_pkcs8(&der)?)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
}

pub fn canonical(method: &str, pathname: &str, timestamp_ms: u128, body: &str) -> String {
    let body_hash = hex::encode(Sha256::digest(body.as_bytes()));
    format!(
        "{}\n{}\n{}\n{}",
        method.to_uppercase(),
        pathname,
        timestamp_ms,
        body_hash
    )
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::signature::Verifier;
    use p256::EncodedPoint;

    #[test]
    fn public_key_is_uncompressed_sec1_hex() {
        let key = ChannelKey::generate();
        let hex_key = key.public_key_hex();
        assert_eq!(hex_key.len(), 130);
        assert!(hex_key.starts_with("04"));
    }

    #[test]
    fn canonical_matches_the_relay_format() {
        // sha256("") = e3b0c442…b855, the body hash the relay computes for GET.
        assert_eq!(
			canonical("get", "/api/channels/abc/events", 1700000000000, ""),
			"GET\n/api/channels/abc/events\n1700000000000\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
		);
    }

    #[test]
    fn signature_verifies_against_the_published_key() {
        let key = ChannelKey::generate();
        let (ts, sig_hex) =
            key.sign_request_at("POST", "/hook/abc/claim", r#"{"eventId":"e1"}"#, 42);
        assert_eq!(ts, "42");
        let sig = Signature::from_slice(&hex::decode(&sig_hex).unwrap()).unwrap();
        assert_eq!(sig_hex.len(), 128);
        let point = EncodedPoint::from_bytes(hex::decode(key.public_key_hex()).unwrap()).unwrap();
        let verifying = VerifyingKey::from_encoded_point(&point).unwrap();
        let canon = canonical("POST", "/hook/abc/claim", 42, r#"{"eventId":"e1"}"#);
        assert!(verifying.verify(canon.as_bytes(), &sig).is_ok());
        // A different body does not verify.
        let other = canonical("POST", "/hook/abc/claim", 42, r#"{"eventId":"e2"}"#);
        assert!(verifying.verify(other.as_bytes(), &sig).is_err());
    }

    #[test]
    fn pkcs8_round_trip_keeps_the_key() {
        let key = ChannelKey::generate();
        let back = ChannelKey::from_pkcs8(&key.to_pkcs8().unwrap()).unwrap();
        assert_eq!(key.public_key_hex(), back.public_key_hex());
    }
}
