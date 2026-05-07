export const DEFAULT_PORT = 3000;

/**
 * Legacy: TTL applied to anonymous channels (no user_id).
 * Kept for backwards compatibility with the cron cleanup.
 * New code paths should use {@link TTL_HOURS} below.
 */
export const CHANNEL_EXPIRY_HOURS = 24;

/**
 * Per-tier channel TTL (hours).
 * - `anonymous`: legacy anon channels (drain post-deploy)
 * - `trial`: active trial users (perpetual; events retained per RETENTION_DAYS_TRIAL)
 * - `paid`: paying subscribers (perpetual)
 * - `selfHost`: self-hosted instances (perpetual; quotas off)
 *
 * `null` = perpetual (no `expires_at` set on the channel row).
 * Retention is enforced on events via a separate cron query.
 */
export const TTL_HOURS = {
	anonymous: 24,
	trial: null,
	paid: null,
	selfHost: null,
} as const;

/** Length of the free trial when a new user signs up (hosted mode). */
export const TRIAL_DAYS = 7;

/** Event retention windows (days). null = unlimited. */
export const RETENTION_DAYS = {
	anonymous: 1,
	trial: 7,
	paid: 30,
	selfHost: null,
} as const;

export const MAX_BUFFERED_EVENTS = 100;

export const MAX_BODY_SIZE_BYTES = 1_048_576; // 1MB

export const MAX_SSE_CONNECTIONS_PER_CHANNEL = 5;

export const RATE_LIMIT_REQUESTS_PER_MINUTE = 60;

export const COMMON_DEV_PORTS = [3000, 3001, 4000, 5000, 5173, 8000, 8080];
