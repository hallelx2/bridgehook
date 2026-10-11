//! Device pairing for `bridgehook login`: the relay issues a code, the user
//! approves it in the dashboard (on any device, a phone included), and this
//! install polls until it receives a device token.
//!
//! Polling follows the extension (`apps/extension/pairing.js`): 202 waits
//! the interval, 429 waits `Retry-After`, 5xx and network errors back off
//! (the relay keeps an approved code when minting fails), 410 and other 4xx
//! stop.

use crate::relay::{DeviceMinted, DeviceStart, ExchangePoll, RelayClient};
use std::future::Future;
use std::time::Duration;
use tokio::time::Instant;

const MAX_WAIT: Duration = Duration::from_secs(60);

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum PairError {
    #[error("the pairing code expired or was already used; run `bridgehook login` again")]
    Expired,
    #[error("pairing timed out; run `bridgehook login` again")]
    TimedOut,
    #[error("pairing failed ({0}): {1}")]
    Failed(u16, String),
}

/// Polls `exchange` until the code is approved, refused or expired.
pub async fn poll_until_paired<F, Fut>(
    mut exchange: F,
    interval: Duration,
    deadline: Instant,
) -> Result<DeviceMinted, PairError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = ExchangePoll>,
{
    let mut wait = interval;
    let mut failures: u32 = 0;
    loop {
        let now = Instant::now();
        if now >= deadline {
            return Err(PairError::TimedOut);
        }
        tokio::time::sleep(wait.min(deadline - now)).await;
        if Instant::now() >= deadline {
            return Err(PairError::TimedOut);
        }
        wait = interval;
        match exchange().await {
            ExchangePoll::Minted(m) => return Ok(m),
            ExchangePoll::Pending => failures = 0,
            ExchangePoll::Expired => return Err(PairError::Expired),
            ExchangePoll::RetryAfter(d) => wait = d.min(MAX_WAIT),
            ExchangePoll::Transient(_) => {
                failures += 1;
                wait = (interval * 2u32.saturating_pow(failures)).min(MAX_WAIT);
            }
            ExchangePoll::Failed(status, message) => {
                return Err(PairError::Failed(status, message))
            }
        }
    }
}

/// Starts pairing, hands the code to `show` (to print it), then waits for
/// approval.
pub async fn pair(
    relay: &RelayClient,
    label_hint: &str,
    show: impl FnOnce(&DeviceStart),
) -> anyhow::Result<DeviceMinted> {
    let start = relay.device_start("cli", label_hint).await?;
    show(&start);
    let interval = Duration::from_secs(start.poll_interval.clamp(2, 30));
    let deadline = Instant::now() + Duration::from_secs(start.expires_in.max(60));
    let code = start.device_code.clone();
    Ok(poll_until_paired(|| relay.device_exchange(&code), interval, deadline).await?)
}

/// "bridgehook CLI on <hostname>", the label shown when approving.
pub fn label_hint() -> String {
    let host = std::env::var("HOSTNAME")
        .ok()
        .filter(|h| !h.is_empty())
        .or_else(|| {
            std::fs::read_to_string("/etc/hostname")
                .ok()
                .map(|h| h.trim().to_string())
        })
        .or_else(|| std::env::var("COMPUTERNAME").ok())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "this machine".into());
    format!("bridgehook CLI on {host}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    fn minted() -> DeviceMinted {
        DeviceMinted {
            token: "dvc_x".into(),
            device_id: "dev_x".into(),
            user_id: "usr_x".into(),
            label: "cli".into(),
        }
    }

    async fn run(
        script: Vec<ExchangePoll>,
        deadline_secs: u64,
    ) -> (Result<DeviceMinted, PairError>, Duration) {
        let script = Mutex::new(VecDeque::from(script));
        let started = Instant::now();
        let r = poll_until_paired(
            || {
                let next = script
                    .lock()
                    .unwrap()
                    .pop_front()
                    .unwrap_or(ExchangePoll::Pending);
                async move { next }
            },
            Duration::from_secs(5),
            Instant::now() + Duration::from_secs(deadline_secs),
        )
        .await;
        (r, started.elapsed())
    }

    #[tokio::test(start_paused = true)]
    async fn waits_through_pending_then_returns_the_device() {
        let (r, took) = run(
            vec![
                ExchangePoll::Pending,
                ExchangePoll::Pending,
                ExchangePoll::Minted(minted()),
            ],
            900,
        )
        .await;
        assert_eq!(r.unwrap().token, "dvc_x");
        assert_eq!(took, Duration::from_secs(15));
    }

    #[tokio::test(start_paused = true)]
    async fn honours_retry_after_and_backs_off_on_server_errors() {
        let (r, took) = run(
            vec![
                ExchangePoll::RetryAfter(Duration::from_secs(30)),
                ExchangePoll::Transient("503".into()),
                ExchangePoll::Transient("503".into()),
                ExchangePoll::Minted(minted()),
            ],
            900,
        )
        .await;
        assert!(r.is_ok());
        // 5 (first wait) + 30 (Retry-After) + 10 + 20 (backoff) = 65
        assert_eq!(took, Duration::from_secs(65));
    }

    #[tokio::test(start_paused = true)]
    async fn stops_on_expired_or_other_client_errors() {
        assert_eq!(
            run(vec![ExchangePoll::Expired], 900).await.0.unwrap_err(),
            PairError::Expired
        );
        assert_eq!(
            run(
                vec![ExchangePoll::Failed(402, "Device quota reached".into())],
                900
            )
            .await
            .0
            .unwrap_err(),
            PairError::Failed(402, "Device quota reached".into())
        );
    }

    #[tokio::test(start_paused = true)]
    async fn times_out_at_the_deadline() {
        let (r, took) = run(vec![], 12).await;
        assert_eq!(r.unwrap_err(), PairError::TimedOut);
        assert!(took <= Duration::from_secs(12));
    }
}
