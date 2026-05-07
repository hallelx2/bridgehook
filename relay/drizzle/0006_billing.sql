-- Subscriptions: one row per user, mirrored from Stripe via webhook.
-- users.plan is denormalized from subscriptions.status for fast lookup;
-- the webhook handler keeps them in sync.

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id              text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  status               varchar(24) NOT NULL,        -- trialing | active | past_due | canceled | incomplete
  provider             varchar(16) NOT NULL,        -- 'stripe' | 'paystack'
  customer_id          text NOT NULL,
  subscription_id      text NOT NULL,
  current_period_end   timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_subscription_id ON subscriptions (subscription_id);
