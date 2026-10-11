//! Ordered delivery of a channel's queue: a port of `QueueDrainer`
//! (`apps/web/src/lib/drain.ts`), which the extension and the dashboard tab
//! run, so every executor delivers the same way:
//!
//! - drain the queue (`?pending=1`) oldest first, page by page, so webhooks
//!   that arrived while nothing ran go out in order;
//! - claim each event before forwarding and refresh the claim while the
//!   target works, so exactly one executor forwards it; a claim held
//!   elsewhere stops the pass there (order beats throughput);
//! - target down: stop at that event and retry later, never counting it
//!   against the event; probe before claiming while it is down;
//! - target up but this event keeps failing: after [`MAX_ATTEMPTS`] record
//!   status 0 and move on, so one payload cannot block the queue; a timeout
//!   is recorded at once (the handler may still be running);
//! - an answer that reached us is reported until the relay takes it, never
//!   by calling the target again.

use crate::forward::ForwardOutcome;
use crate::relay::{ForwardResult, PendingPage, QueuedEvent};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::future::Future;
use std::time::Duration;

pub const MAX_ATTEMPTS: u32 = 3;
pub const CLAIM_HEARTBEAT: Duration = Duration::from_secs(20);
pub const REPORT_ATTEMPTS: u32 = 3;

/// What the drainer needs from the relay and the target. Implemented by the
/// CLI over [`crate::relay::RelayClient`] and [`crate::forward::Target`], and
/// by fakes in tests.
pub trait DrainDeps: Send + Sync {
    fn fetch_pending(
        &self,
        after: Option<String>,
    ) -> impl Future<Output = anyhow::Result<PendingPage>> + Send;
    fn claim(&self, event_id: &str) -> impl Future<Output = anyhow::Result<bool>> + Send;
    fn probe(&self) -> impl Future<Output = Result<(), String>> + Send;
    fn forward(&self, event: &QueuedEvent) -> impl Future<Output = ForwardOutcome> + Send;
    fn report(
        &self,
        event: &QueuedEvent,
        result: &ForwardResult,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    fn sleep(&self, d: Duration) -> impl Future<Output = ()> + Send {
        tokio::time::sleep(d)
    }
}

/// How a pass ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PassResult {
    /// Nothing left for this executor.
    Idle,
    /// Stopped on a target or relay problem; try again soon.
    Retry,
    /// Another executor holds the oldest event; look again once its claim
    /// could be stale.
    Blocked,
}

/// Something worth telling the user about.
#[derive(Debug, Clone, PartialEq)]
pub enum DrainEvent {
    Delivered {
        event: QueuedEvent,
        result: ForwardResult,
    },
    Skipped {
        event: QueuedEvent,
        message: String,
    },
    TargetDown(String),
    TargetUp,
}

#[derive(Debug, Clone)]
struct Unreported {
    result: ForwardResult,
    skipped: Option<String>,
}

enum Step {
    Next,
    Retry,
    Blocked,
}

#[derive(Default)]
pub struct Drainer {
    handled: HashSet<String>,
    attempts: HashMap<String, u32>,
    unreported: HashMap<String, Unreported>,
    target_down: bool,
}

impl Drainer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn target_down(&self) -> bool {
        self.target_down
    }

    /// One pass over the queue. `notify` receives user-facing events.
    pub async fn pass<D: DrainDeps>(
        &mut self,
        deps: &D,
        notify: &mut (dyn FnMut(DrainEvent) + Send),
    ) -> anyhow::Result<PassResult> {
        let mut after: Option<String> = None;
        let mut open = 0usize;
        loop {
            let page = deps.fetch_pending(after.clone()).await?;
            for evt in page.events {
                if !self.handled.contains(&evt.id) {
                    open += 1;
                }
                match self.step(deps, evt, notify).await? {
                    Step::Next => {}
                    Step::Retry => return Ok(PassResult::Retry),
                    Step::Blocked => return Ok(PassResult::Blocked),
                }
            }
            match page.next_cursor {
                Some(c) => after = Some(c),
                None => break,
            }
        }
        // Nothing was waiting: whatever the target's last state, no webhook
        // is held up by it.
        if open == 0 {
            self.set_target_up(notify);
        }
        Ok(PassResult::Idle)
    }

    async fn step<D: DrainDeps>(
        &mut self,
        deps: &D,
        evt: QueuedEvent,
        notify: &mut (dyn FnMut(DrainEvent) + Send),
    ) -> anyhow::Result<Step> {
        if self.handled.contains(&evt.id) {
            return Ok(Step::Next);
        }

        // Answered earlier but the relay never took the report: send that
        // answer again, never the webhook.
        if let Some(owed) = self.unreported.get(&evt.id).cloned() {
            return Ok(if self.settle(deps, &evt, owed, notify).await {
                Step::Next
            } else {
                Step::Retry
            });
        }

        if self.target_down || self.attempts.contains_key(&evt.id) {
            if let Err(message) = deps.probe().await {
                self.set_target_down(message, notify);
                return Ok(Step::Retry);
            }
        }

        // Another executor holds it: stop so nothing newer overtakes it.
        if !deps.claim(&evt.id).await? {
            return Ok(Step::Blocked);
        }

        // Forward while keeping the claim fresh.
        let mut lost = false;
        let outcome = {
            let fwd = deps.forward(&evt);
            tokio::pin!(fwd);
            let mut beat = tokio::time::interval_at(
                tokio::time::Instant::now() + CLAIM_HEARTBEAT,
                CLAIM_HEARTBEAT,
            );
            loop {
                tokio::select! {
                    o = &mut fwd => break o,
                    _ = beat.tick() => {
                        if let Ok(false) = deps.claim(&evt.id).await {
                            lost = true;
                        }
                    }
                }
            }
        };

        if lost {
            // The claim went stale and another executor took the event; its
            // answer is the one the relay keeps.
            self.handled.insert(evt.id.clone());
            self.attempts.remove(&evt.id);
            return Ok(Step::Next);
        }

        let step = match outcome {
            ForwardOutcome::Response(result) => {
                self.attempts.remove(&evt.id);
                self.set_target_up(notify);
                let ok = self
                    .settle(
                        deps,
                        &evt,
                        Unreported {
                            result,
                            skipped: None,
                        },
                        notify,
                    )
                    .await;
                if ok {
                    Step::Next
                } else {
                    Step::Retry
                }
            }
            ForwardOutcome::Down(message) => {
                self.set_target_down(message, notify);
                Step::Retry
            }
            ForwardOutcome::Timeout {
                message,
                latency_ms,
            } => {
                self.attempts.remove(&evt.id);
                let ok = self
                    .settle(deps, &evt, terminal(message, latency_ms), notify)
                    .await;
                if ok {
                    Step::Next
                } else {
                    Step::Retry
                }
            }
            ForwardOutcome::Failed {
                message,
                latency_ms,
            } => {
                let tries = self.attempts.get(&evt.id).copied().unwrap_or(0) + 1;
                if tries < MAX_ATTEMPTS {
                    self.attempts.insert(evt.id.clone(), tries);
                    Step::Retry
                } else {
                    self.attempts.remove(&evt.id);
                    let message = format!(
						"Forwarding failed {MAX_ATTEMPTS} times while your local server was up. Last error: {message}"
					);
                    let ok = self
                        .settle(deps, &evt, terminal(message, latency_ms), notify)
                        .await;
                    if ok {
                        Step::Next
                    } else {
                        Step::Retry
                    }
                }
            }
        };
        Ok(step)
    }

    /// Report an answer; on success the event is done, otherwise it is owed.
    async fn settle<D: DrainDeps>(
        &mut self,
        deps: &D,
        evt: &QueuedEvent,
        answer: Unreported,
        notify: &mut (dyn FnMut(DrainEvent) + Send),
    ) -> bool {
        for i in 0..REPORT_ATTEMPTS {
            if deps.report(evt, &answer.result).await.is_ok() {
                self.unreported.remove(&evt.id);
                self.handled.insert(evt.id.clone());
                match answer.skipped {
                    Some(message) => notify(DrainEvent::Skipped {
                        event: evt.clone(),
                        message,
                    }),
                    None => notify(DrainEvent::Delivered {
                        event: evt.clone(),
                        result: answer.result,
                    }),
                }
                return true;
            }
            if i < REPORT_ATTEMPTS - 1 {
                deps.sleep(Duration::from_millis(500 * 3u64.pow(i))).await;
            }
        }
        self.unreported.insert(evt.id.clone(), answer);
        false
    }

    fn set_target_down(&mut self, message: String, notify: &mut (dyn FnMut(DrainEvent) + Send)) {
        if !self.target_down {
            self.target_down = true;
            notify(DrainEvent::TargetDown(message));
        }
    }

    fn set_target_up(&mut self, notify: &mut (dyn FnMut(DrainEvent) + Send)) {
        if self.target_down {
            self.target_down = false;
            notify(DrainEvent::TargetUp);
        }
    }
}

fn terminal(message: String, latency_ms: u64) -> Unreported {
    Unreported {
        result: ForwardResult {
            status: 0,
            headers: BTreeMap::new(),
            body: format!("BridgeHook: {message}"),
            latency_ms,
        },
        skipped: Some(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn ev(id: &str) -> QueuedEvent {
        QueuedEvent {
            id: id.into(),
            method: "POST".into(),
            path: "/webhook".into(),
            request_headers: None,
            request_body: Some(format!("{{\"id\":\"{id}\"}}")),
            channel_id: Some("ch".into()),
        }
    }

    fn ok(status: u16) -> ForwardOutcome {
        ForwardOutcome::Response(ForwardResult {
            status,
            headers: BTreeMap::new(),
            body: "ok".into(),
            latency_ms: 3,
        })
    }

    /// A scripted relay and target. The queue holds events not yet reported.
    #[derive(Default)]
    struct Fake {
        queue: Mutex<Vec<QueuedEvent>>,
        page_size: usize,
        outcomes: Mutex<HashMap<String, Vec<ForwardOutcome>>>,
        claims_refused: Mutex<HashSet<String>>,
        claim_refresh_fails: Mutex<bool>,
        report_failures: Mutex<u32>,
        probe_down: Mutex<bool>,
        forwarded: Mutex<Vec<String>>,
        reported: Mutex<Vec<(String, u16)>>,
        /// Delay the forward of one event (id, duration).
        forward_delay: Mutex<Option<(String, Duration)>>,
    }

    impl Fake {
        fn with(ids: &[&str]) -> Self {
            Self {
                queue: Mutex::new(ids.iter().map(|i| ev(i)).collect()),
                page_size: 100,
                ..Default::default()
            }
        }
        fn script(&self, id: &str, outcomes: Vec<ForwardOutcome>) {
            self.outcomes.lock().unwrap().insert(id.into(), outcomes);
        }
    }

    impl DrainDeps for Fake {
        async fn fetch_pending(&self, after: Option<String>) -> anyhow::Result<PendingPage> {
            // Keyset paging like the relay's (receivedAt, id) cursor: events
            // settled mid-pass leave the queue without shifting later pages.
            // Test ids sort in queue order.
            let q: Vec<QueuedEvent> = self
                .queue
                .lock()
                .unwrap()
                .iter()
                .filter(|e| after.as_ref().is_none_or(|a| e.id.as_str() > a.as_str()))
                .cloned()
                .collect();
            let page: Vec<QueuedEvent> = q.iter().take(self.page_size).cloned().collect();
            let next = if q.len() > page.len() {
                page.last().map(|e| e.id.clone())
            } else {
                None
            };
            Ok(PendingPage {
                events: page,
                next_cursor: next,
            })
        }
        async fn claim(&self, event_id: &str) -> anyhow::Result<bool> {
            if self
                .forwarded
                .lock()
                .unwrap()
                .contains(&event_id.to_string())
                && *self.claim_refresh_fails.lock().unwrap()
            {
                return Ok(false);
            }
            Ok(!self.claims_refused.lock().unwrap().contains(event_id))
        }
        async fn probe(&self) -> Result<(), String> {
            if *self.probe_down.lock().unwrap() {
                Err("down".into())
            } else {
                Ok(())
            }
        }
        async fn forward(&self, event: &QueuedEvent) -> ForwardOutcome {
            self.forwarded.lock().unwrap().push(event.id.clone());
            let delay = self.forward_delay.lock().unwrap().clone();
            if let Some((id, d)) = delay {
                if id == event.id {
                    tokio::time::sleep(d).await;
                }
            }
            let mut o = self.outcomes.lock().unwrap();
            match o.get_mut(&event.id) {
                Some(list) if !list.is_empty() => list.remove(0),
                _ => ok(200),
            }
        }
        async fn report(&self, event: &QueuedEvent, result: &ForwardResult) -> anyhow::Result<()> {
            {
                let mut f = self.report_failures.lock().unwrap();
                if *f > 0 {
                    *f -= 1;
                    anyhow::bail!("relay down");
                }
            }
            self.reported
                .lock()
                .unwrap()
                .push((event.id.clone(), result.status));
            self.queue.lock().unwrap().retain(|e| e.id != event.id);
            Ok(())
        }
        async fn sleep(&self, _d: Duration) {}
    }

    async fn run(d: &mut Drainer, fake: &Fake) -> (PassResult, Vec<DrainEvent>) {
        let mut seen = Vec::new();
        let r = d.pass(fake, &mut |e| seen.push(e)).await.unwrap();
        (r, seen)
    }

    #[tokio::test]
    async fn delivers_the_queue_in_order_across_pages() {
        let mut fake = Fake::with(&["a", "b", "c", "d", "e"]);
        fake.page_size = 2;
        let mut d = Drainer::new();
        let (r, _) = run(&mut d, &fake).await;
        assert_eq!(r, PassResult::Idle);
        assert_eq!(
            *fake.forwarded.lock().unwrap(),
            vec!["a", "b", "c", "d", "e"]
        );
        assert_eq!(fake.reported.lock().unwrap().len(), 5);
    }

    #[tokio::test]
    async fn target_down_stops_without_counting_and_resumes_in_order() {
        let fake = Fake::with(&["a", "b"]);
        fake.script("a", vec![ForwardOutcome::Down("refused".into())]);
        let mut d = Drainer::new();
        let (r, seen) = run(&mut d, &fake).await;
        assert_eq!(r, PassResult::Retry);
        assert_eq!(seen, vec![DrainEvent::TargetDown("refused".into())]);
        assert_eq!(*fake.forwarded.lock().unwrap(), vec!["a"]);
        // Still down: the probe stops the pass before claiming anything.
        *fake.probe_down.lock().unwrap() = true;
        assert_eq!(run(&mut d, &fake).await.0, PassResult::Retry);
        assert_eq!(fake.forwarded.lock().unwrap().len(), 1);
        // Back up: both go out, oldest first.
        *fake.probe_down.lock().unwrap() = false;
        let (r, seen) = run(&mut d, &fake).await;
        assert_eq!(r, PassResult::Idle);
        assert_eq!(*fake.forwarded.lock().unwrap(), vec!["a", "a", "b"]);
        assert!(seen.contains(&DrainEvent::TargetUp));
    }

    #[tokio::test]
    async fn a_failing_event_is_recorded_after_three_tries_and_the_queue_moves_on() {
        let fake = Fake::with(&["bad", "next"]);
        let fail = || ForwardOutcome::Failed {
            message: "reset".into(),
            latency_ms: 1,
        };
        fake.script("bad", vec![fail(), fail(), fail()]);
        let mut d = Drainer::new();
        assert_eq!(run(&mut d, &fake).await.0, PassResult::Retry);
        assert_eq!(run(&mut d, &fake).await.0, PassResult::Retry);
        let (r, seen) = run(&mut d, &fake).await;
        assert_eq!(r, PassResult::Idle);
        assert_eq!(
            *fake.reported.lock().unwrap(),
            vec![("bad".to_string(), 0), ("next".to_string(), 200)]
        );
        assert!(
            matches!(&seen[0], DrainEvent::Skipped { message, .. } if message.contains("failed 3 times"))
        );
    }

    #[tokio::test]
    async fn a_timeout_is_recorded_once_and_never_sent_again() {
        let fake = Fake::with(&["slow", "next"]);
        fake.script(
            "slow",
            vec![ForwardOutcome::Timeout {
                message: "300 s".into(),
                latency_ms: 300_000,
            }],
        );
        let mut d = Drainer::new();
        assert_eq!(run(&mut d, &fake).await.0, PassResult::Idle);
        assert_eq!(*fake.forwarded.lock().unwrap(), vec!["slow", "next"]);
        assert_eq!(fake.reported.lock().unwrap()[0], ("slow".to_string(), 0));
    }

    #[tokio::test]
    async fn a_claim_held_elsewhere_blocks_newer_events() {
        let fake = Fake::with(&["held", "newer"]);
        fake.claims_refused.lock().unwrap().insert("held".into());
        let mut d = Drainer::new();
        assert_eq!(run(&mut d, &fake).await.0, PassResult::Blocked);
        assert!(fake.forwarded.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn an_unstored_answer_is_reported_again_without_forwarding_again() {
        let fake = Fake::with(&["a"]);
        *fake.report_failures.lock().unwrap() = REPORT_ATTEMPTS;
        let mut d = Drainer::new();
        assert_eq!(run(&mut d, &fake).await.0, PassResult::Retry);
        assert_eq!(fake.forwarded.lock().unwrap().len(), 1);
        let (r, seen) = run(&mut d, &fake).await;
        assert_eq!(r, PassResult::Idle);
        assert_eq!(fake.forwarded.lock().unwrap().len(), 1);
        assert!(matches!(&seen[0], DrainEvent::Delivered { .. }));
    }

    #[tokio::test(start_paused = true)]
    async fn a_claim_lost_during_a_long_forward_hands_the_event_over() {
        let fake = Fake::with(&["long", "next"]);
        *fake.forward_delay.lock().unwrap() = Some(("long".into(), Duration::from_secs(45)));
        *fake.claim_refresh_fails.lock().unwrap() = true;
        let mut d = Drainer::new();
        let (r, _) = run(&mut d, &fake).await;
        assert_eq!(r, PassResult::Idle);
        // "long" was handed over (not reported by us); "next" was delivered.
        assert_eq!(
            *fake.reported.lock().unwrap(),
            vec![("next".to_string(), 200)]
        );
    }
}
