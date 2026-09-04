# AGENTS

TradeLix PoC dashboard. Consumes the FastAPI Python backend via `/api`.

## Before deploying or making breaking changes

Read **[`../alpaca-ai-trading-agents-hackathon-lablab.ai/pendiente-alpacorp.md`](../alpaca-ai-trading-agents-hackathon-lablab.ai/pendiente-alpacorp.md)** — P1 is done (tick brackets, position-aware risk, fill listener). Remaining work is P2. Research that file with a lighter model + web search, then implement with a capable model.

**Edit and `git push` to `main`** when the backlog or deploy contract changes: this file,
and in the backend repo `pendiente-alpacorp.md`, `AGENTS.md`, and `CLAUDE.md`. Local-only
edits do not count.

**Deploy target:** one Amazon EC2 **`t3.small`** running **both** backend Compose
(`tradelix-backend:8000`) and this frontend Compose (`/api` → backend). Push
both `main` branches, then pull on that single box. Do not split the stack across two
instances. The type is `t3.small`, not the originally planned `t3.medium`: the AWS
account is on the Free Plan and rejects non-free-tier instance types.

**One nginx, one compose, both environments.** `nginx.conf` (gzip, `/assets/` immutable,
SSE not gzipped) is the same locally and on the box — the container always listens on
`:80`. Only the host port differs: Compose uses `WEB_PORT` default **3200** (local
`http://127.0.0.1:3200`). On the box set `WEB_PORT=80` in this project's `.env` so
`http://alpacorp.ribartra.org/` needs no port. Do not fork nginx or the image. An
existing `docker-compose.override.yml` on the box is equivalent and gitignored.

This repo is **private**, so the instance cannot clone it — it is uploaded as a
`git archive` tarball. That is a fetch concern, not a code fork.

Uses Lightweight Charts v5 (`addSeries(AreaSeries, …)`).

Layout is a **Progressive Disclosure Cockpit** ([docs/to-do-better-ui.md](docs/to-do-better-ui.md)):
ticker alarms (Armed / Kill), header actions including **Options**, then A pipeline /
B chart + market state / C decision rail / D blotter tabs. Configuration lives only
in the Options drawer. Run pipeline is explicit. Do not poll `/decision`.

All user-facing and agent-facing copy in this app stays in English.
