# AGENTS

TradeLix PoC dashboard. Consumes the FastAPI Python backend via `/api`.

## Before deploying or making breaking changes

Read **[`../alpaca-ai-trading-agents-hackathon-lablab.ai/pendiente-alpacorp.md`](../alpaca-ai-trading-agents-hackathon-lablab.ai/pendiente-alpacorp.md)** — open P1 items in the backend (tick brackets, position-aware risk, fill lifecycle). Research that file with a lighter model + web search, then implement with a capable model.

**Edit and `git push` to `main`** when the backlog or deploy contract changes: this file,
and in the backend repo `pendiente-alpacorp.md`, `AGENTS.md`, and `CLAUDE.md`. Local-only
edits do not count.

**Deploy target:** one Amazon EC2 **`t3.medium`** running **both** backend Compose
(`tradelix-backend:8000`) and this frontend Compose (`:3200`, `/api` → backend). Push
both `main` branches, then pull on that single box. Do not split the stack across two
instances.

Uses Lightweight Charts v5 (`addSeries(AreaSeries, …)`).

Layout is a **Progressive Disclosure Cockpit** ([docs/to-do-better-ui.md](docs/to-do-better-ui.md)):
ticker alarms (Armed / Kill), header actions including **Options**, then A pipeline /
B chart + market state / C decision rail / D blotter tabs. Configuration lives only
in the Options drawer. Run pipeline is explicit. Do not poll `/decision`.

All user-facing and agent-facing copy in this app stays in English.
