"""Export a BridgeHook Postgres (Neon) database into D1-ready SQL.

For relays created before BridgeHook moved to Cloudflare D1. Reads in a
read-only transaction and writes INSERT statements to a 0600 file; prints only
table names and row counts, never values (password hashes, session tokens).
Timestamps become integer milliseconds and booleans 0/1, matching the D1 schema.

Usage:
    DATABASE_URL=postgresql://... python3 relay/scripts/neon-to-d1.py out.sql
    cd relay
    npx wrangler d1 migrations apply bridgehook --remote
    npx wrangler d1 execute bridgehook --remote --file ../out.sql
"""

import json
import os
import subprocess
import sys

OUT = sys.argv[1]
TABLES = [  # parents before children (foreign keys)
    ("user", ["id", "name", "email", "email_verified", "image", "created_at", "updated_at", "plan", "trial_ends_at"]),
    ("session", ["id", "token", "user_id", "expires_at", "ip_address", "user_agent", "created_at", "updated_at"]),
    ("account", ["id", "account_id", "provider_id", "user_id", "access_token", "refresh_token",
                 "access_token_expires_at", "refresh_token_expires_at", "scope", "id_token", "password",
                 "created_at", "updated_at"]),
    ("verification", ["id", "identifier", "value", "expires_at", "created_at", "updated_at"]),
    ("devices", ["id", "user_id", "kind", "label", "token_hash", "os", "user_agent", "last_seen_at",
                 "revoked_at", "created_at"]),
    ("device_codes", ["code", "kind", "label_hint", "status", "approved_user_id", "expires_at", "created_at"]),
    ("channels", ["id", "public_key", "port", "allowed_paths", "user_id", "device_id", "label",
                  "created_at", "expires_at"]),
    ("events", ["id", "channel_id", "method", "path", "request_headers", "request_body", "response_status",
                "response_headers", "response_body", "latency_ms", "error", "received_at", "replay_of",
                "replayed_by_user_id", "device_id", "kind", "claimed_by_device_id", "claimed_at"]),
    ("subscriptions", ["user_id", "status", "provider", "customer_id", "subscription_id",
                       "current_period_end", "cancel_at_period_end", "created_at", "updated_at"]),
]
TS = {"created_at", "updated_at", "trial_ends_at", "expires_at", "access_token_expires_at",
      "refresh_token_expires_at", "last_seen_at", "revoked_at", "received_at", "claimed_at",
      "current_period_end"}
BOOL = {"email_verified", "cancel_at_period_end"}

url = os.environ.get("DATABASE_URL")
if not url:
    sys.exit("set DATABASE_URL to the Postgres connection string")


def select_expr(col):
    if col in TS:
        return f"(extract(epoch from \"{col}\") * 1000)::bigint"
    if col in BOOL:
        return f"(case when \"{col}\" then 1 else 0 end)"
    return f"\"{col}\""


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(int(v))
    return "'" + str(v).replace("'", "''") + "'"


lines = ["PRAGMA defer_foreign_keys = true;"]
for table, cols in TABLES:
    select_list = ", ".join(select_expr(c) + ' as "' + c + '"' for c in cols)
    q = "select coalesce(json_agg(t), '[]') from (select " + select_list + ' from "' + table + '") t'
    r = subprocess.run(["psql", url, "-At", "-c", "set default_transaction_read_only = on;", "-c", q],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"{table}: export failed")
    out_lines = r.stdout.strip().splitlines()
    rows = json.loads("\n".join(out_lines[1:]))  # first line is psql's "SET"
    for row in rows:
        vals = ", ".join(lit(row[c]) for c in cols)
        lines.append(f"INSERT INTO `{table}` ({', '.join(f'`{c}`' for c in cols)}) VALUES ({vals});")
    print(f"{table}: {len(rows)} rows")

fd = os.open(OUT, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.write("\n".join(lines) + "\n")
print("written", OUT)
