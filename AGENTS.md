# AGENTS

TradeLix PoC dashboard. Consumes the FastAPI Python backend via `/api`.

## Before deploying or making breaking changes

Read **[`../alpaca-ai-trading-agents-hackathon-lablab.ai/pendiente-alpacorp.md`](../alpaca-ai-trading-agents-hackathon-lablab.ai/pendiente-alpacorp.md)** — open P1 items in the backend (tick brackets, position-aware risk, fill lifecycle). UI changes that depend on those features should reference this file. Update it if API contracts or status change.
Uses Lightweight Charts v5 (`addSeries(AreaSeries, …)`).

Layout is a **Progressive Disclosure Cockpit** ([docs/to-do-better-ui.md](docs/to-do-better-ui.md)):
ticker alarms (Armed / Kill), header actions including **Options**, then A pipeline /
B chart + market state / C decision rail / D blotter tabs. Configuration lives only
in the Options drawer. Run pipeline is explicit. Do not poll `/decision`.

All user-facing and agent-facing copy in this app stays in English.
