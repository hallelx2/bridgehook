# bridgehook CLI

A stable public webhook URL that forwards to a local port. Webhooks sent while nothing is forwarding wait on the relay, and the next `bridgehook forward` delivers them in order.

```sh
bridgehook login              # pair this machine (approve the code in the browser)
bridgehook forward 3000       # prints https://<id>.bridgehook.dev, forwards to localhost:3000
bridgehook forward http://api:8080 --path /stripe   # any URL; accept only /stripe/*
bridgehook whoami
bridgehook logout             # revokes this machine's token on the relay
```

Running `forward` again for the same target reuses its channel, so the URL you registered with Stripe or GitHub stays the same. If your account already has a channel on that port (made by the extension, say), the CLI adopts it and its key moves to this machine; `--new` makes a separate URL instead.

| Flag / variable | |
|---|---|
| `--json` | one JSON object per line (`ready`, `delivered`, `skipped`, `target_down`, `target_up`, …) for scripts and agents |
| `--relay`, `BRIDGEHOOK_RELAY` | another relay (self-hosted); defaults to the one you signed in to |
| `BRIDGEHOOK_TOKEN` | a device token, instead of the saved one (CI, containers) |
| `--config-dir`, `BRIDGEHOOK_CONFIG_DIR` | where the token, channel keys and channel list live (default `~/.config/bridgehook`, `%APPDATA%\bridgehook`) |

Ctrl-C finishes the webhook in hand and stops; a second Ctrl-C quits at once.

## How delivery works

The protocol lives in `crates/bridgehook-core`, a port of the extension's `QueueDrainer`: the queue is read oldest first, each webhook is claimed before it is forwarded (so the extension and the CLI never both deliver it), a server that is down holds the queue without using up retries, and a webhook that fails three times while the server is up is recorded and skipped. The live stream (`/api/me/stream`) only wakes the drain, so a live webhook never overtakes a queued one. Requests are signed with the channel's P-256 key.

## Checks

```sh
pnpm test:cli          # unit tests + clippy
pnpm e2e:cli:local     # the binary against a throwaway local relay (wrangler dev)
pnpm e2e:cli           # the binary against production, with the QA account from .env
```
