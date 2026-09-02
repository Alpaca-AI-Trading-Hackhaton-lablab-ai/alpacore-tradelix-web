# AGENTS

TradeLix PoC dashboard. Consumes the FastAPI Python backend via `/api`.
Uses Lightweight Charts v5 (`addSeries(AreaSeries, …)`).

Layout is a **Progressive Disclosure Cockpit** ([docs/to-do-better-ui.md](docs/to-do-better-ui.md)):
ticker alarms (Armed / Kill), header actions including **Options**, then A pipeline /
B chart + market state / C decision rail / D blotter tabs. Configuration lives only
in the Options drawer. Run pipeline is explicit. Do not poll `/decision`.

All user-facing and agent-facing copy in this app stays in English.
