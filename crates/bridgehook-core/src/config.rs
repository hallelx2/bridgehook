//! On-disk state: `~/.config/bridgehook/` (XDG; `%APPDATA%\bridgehook` on
//! Windows), or `$BRIDGEHOOK_CONFIG_DIR`.
//!
//! ```text
//! token.json        device token from `bridgehook login` (0600)
//! executor-id       this install's claim owner id
//! channels.json     forward target → channel id, per relay
//! keys/<id>.pk8     the channel's P-256 private key, PKCS#8 DER (0600)
//! ```
//!
//! Secrets are written to a temporary file with mode 0600 and renamed into
//! place, so a crash never leaves a half-written or world-readable file.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Paths {
    pub dir: PathBuf,
}

impl Paths {
    /// `$BRIDGEHOOK_CONFIG_DIR`, else the platform config dir + `bridgehook`.
    pub fn discover() -> Result<Self> {
        if let Some(dir) = std::env::var_os("BRIDGEHOOK_CONFIG_DIR") {
            return Ok(Self {
                dir: PathBuf::from(dir),
            });
        }
        let base = dirs::config_dir().context("no config directory on this system")?;
        Ok(Self {
            dir: base.join("bridgehook"),
        })
    }

    pub fn at(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    pub fn token_file(&self) -> PathBuf {
        self.dir.join("token.json")
    }
    pub fn executor_file(&self) -> PathBuf {
        self.dir.join("executor-id")
    }
    pub fn channels_file(&self) -> PathBuf {
        self.dir.join("channels.json")
    }
    pub fn key_file(&self, channel_id: &str) -> PathBuf {
        self.dir.join("keys").join(format!("{channel_id}.pk8"))
    }
}

/// Writes `bytes` to `path` readable by the owner only, atomically.
pub fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("path has no parent")?;
    create_private_dir(parent)?;
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    {
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts
            .open(&tmp)
            .with_context(|| format!("writing {}", tmp.display()))?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path).with_context(|| format!("saving {}", path.display()))?;
    Ok(())
}

fn create_private_dir(dir: &Path) -> Result<()> {
    fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// The device token `bridgehook login` stores.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredToken {
    pub token: String,
    pub device_id: String,
    pub user_id: String,
    #[serde(default)]
    pub label: String,
    /// The relay the token belongs to.
    pub relay: String,
}

pub fn load_token(paths: &Paths) -> Result<Option<StoredToken>> {
    let path = paths.token_file();
    match fs::read(&path) {
        Ok(bytes) => Ok(Some(
            serde_json::from_slice(&bytes)
                .with_context(|| format!("reading {}", path.display()))?,
        )),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).with_context(|| format!("reading {}", path.display())),
    }
}

pub fn save_token(paths: &Paths, token: &StoredToken) -> Result<()> {
    write_private(&paths.token_file(), &serde_json::to_vec_pretty(token)?)
}

pub fn remove_token(paths: &Paths) -> Result<bool> {
    match fs::remove_file(paths.token_file()) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}

/// This install's id, used as the claim owner so exactly one executor
/// forwards each webhook. Created on first use.
pub fn executor_id(paths: &Paths) -> Result<String> {
    let path = paths.executor_file();
    if let Ok(existing) = fs::read_to_string(&path) {
        let id = existing.trim().to_string();
        if !id.is_empty() {
            return Ok(id);
        }
    }
    let mut raw = [0u8; 16];
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut raw);
    let id = format!("cli_{}", hex::encode(raw));
    write_private(&path, id.as_bytes())?;
    Ok(id)
}

/// Forward targets this install created or adopted, keyed by relay then
/// target ("3000", "http://api:8080").
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct ChannelMap(pub BTreeMap<String, BTreeMap<String, String>>);

impl ChannelMap {
    pub fn load(paths: &Paths) -> Result<Self> {
        match fs::read(paths.channels_file()) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.into()),
        }
    }
    pub fn save(&self, paths: &Paths) -> Result<()> {
        write_private(&paths.channels_file(), &serde_json::to_vec_pretty(self)?)
    }
    pub fn get(&self, relay: &str, target: &str) -> Option<&str> {
        self.0.get(relay)?.get(target).map(String::as_str)
    }
    pub fn set(&mut self, relay: &str, target: &str, channel_id: &str) {
        self.0
            .entry(relay.to_string())
            .or_default()
            .insert(target.to_string(), channel_id.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let mut raw = [0u8; 8];
        rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut raw);
        std::env::temp_dir().join(format!("bh-config-test-{}", hex::encode(raw)))
    }

    #[test]
    fn token_round_trips_and_is_private() {
        let paths = Paths::at(temp_dir());
        assert_eq!(load_token(&paths).unwrap(), None);
        let token = StoredToken {
            token: "dvc_abc".into(),
            device_id: "dev_1".into(),
            user_id: "usr_1".into(),
            label: "cli".into(),
            relay: "https://relay.example".into(),
        };
        save_token(&paths, &token).unwrap();
        assert_eq!(load_token(&paths).unwrap(), Some(token));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(paths.token_file())
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
            let dir_mode = fs::metadata(&paths.dir).unwrap().permissions().mode();
            assert_eq!(dir_mode & 0o777, 0o700);
        }
        assert!(remove_token(&paths).unwrap());
        assert!(!remove_token(&paths).unwrap());
    }

    #[test]
    fn executor_id_is_stable() {
        let paths = Paths::at(temp_dir());
        let a = executor_id(&paths).unwrap();
        let b = executor_id(&paths).unwrap();
        assert_eq!(a, b);
        assert!(a.starts_with("cli_") && a.len() == 36);
    }

    #[test]
    fn channel_map_is_per_relay() {
        let paths = Paths::at(temp_dir());
        let mut map = ChannelMap::load(&paths).unwrap();
        map.set("https://a", "3000", "ch1");
        map.set("https://b", "3000", "ch2");
        map.save(&paths).unwrap();
        let back = ChannelMap::load(&paths).unwrap();
        assert_eq!(back.get("https://a", "3000"), Some("ch1"));
        assert_eq!(back.get("https://b", "3000"), Some("ch2"));
        assert_eq!(back.get("https://a", "4000"), None);
    }
}
