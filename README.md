# TradeLix PoC Web

Vite/React dashboard for the hackathon **paper-only** FastAPI backend. It shows the agent graph, Japanese candles, decision + gate, positions, and invocations.

The browser always calls **`/api`** on the same origin:

- Docker/nginx: `/api` → container `tradelix-backend:8000` (shared `tradelix` network)
- `bun run dev`: Vite proxy `/api` → `http://127.0.0.1:8000`

Backend (separate repo): [alpaca-ai-trading-agents-hackathon-lablab.ai](https://github.com/Alpaca-AI-Trading-Hackhaton-lablab-ai/alpaca-ai-trading-agents-hackathon-lablab.ai) (local sibling: `../alpaca-ai-trading-agents-hackathon-lablab.ai`).

## What this repo has

| Piece | Role |
|---|---|
| `src/components/TradingDashboard.tsx` | Shell: ticker, header, cards, settings persist |
| `src/components/AgentGraph.tsx` | Pipeline graph + SSE (`/pipeline/stream`) + node inspector |
| `src/components/PriceChart.tsx` | Lightweight Charts v5 candles from `GET /bars` |
| `src/api/market-client.ts` | Typed client for `/pipeline`, `/settings`, `/control`, `/logs`, `/execute` |
| `docs/to-do-better-ui.md` | Spec for a future UI pass (Options drawer / cockpit). Not implemented yet. |

**Stack:** Bun + Vite 7 + React 19 + TanStack Query + Tailwind CSS v4 + shadcn/ui (local) + Lightweight Charts v5.

The UI can call dry-run and Execute; the **backend** still gates and stays paper-only. Do not point it at live trading.

## Prerequisites

- Docker + Compose (primary way to run)
- Optional: [Bun](https://bun.sh) **1.4+** only for `bun run dev`
- Backend stack must be up first (creates the `tradelix` network + `tradelix-backend`)

## Configure

```bash
cd tradelix-poc-web
cp -n .env.example .env
```

`.env` defaults are enough (`VITE_API_URL=/api`). Do **not** put Alpaca/Groq keys here — they belong in the backend `.env` or `PUT /settings`.

## Deploy (single EC2)

Same box as the backend: one `t3.small`, both Compose stacks, `tradelix` network.
Push this repo’s `main` and the backend `main` before pulling on the instance.
Contract: [`../alpaca-ai-trading-agents-hackathon-lablab.ai/pendiente-alpacorp.md`](../alpaca-ai-trading-agents-hackathon-lablab.ai/pendiente-alpacorp.md).

Live at **http://alpacorp.ribartra.org/**. Same `nginx.conf` and Compose file locally
and on the box: gzip (581 KB → 179 KB), `/assets/` `immutable`, `index.html` `no-cache`,
SSE excluded from `gzip_types`. The container always listens on `:80`. Host port is
`WEB_PORT` (default **3200**). On the box, `WEB_PORT=80` in `.env` so the domain needs
no port. `t3.small` rather than `t3.medium` because the AWS account is on the Free Plan.

## Run with Docker (recommended)

From the **backend** repo first:

```bash
cd ../alpaca-ai-trading-agents-hackathon-lablab.ai
cp -n .env.example .env          # fill paper Alpaca / Groq / Tavily
docker compose up --build -d     # creates network `tradelix`
```

Then this repo:

```bash
cd ../tradelix-poc-web
docker compose up --build -d
```

Open **http://127.0.0.1:3200**. Check the proxy:

```bash
curl http://127.0.0.1:3200/api/
curl http://127.0.0.1:3200/api/settings
```

Do not also run `bun run dev` on port 3200.

| Process | Port |
|---|---|
| FastAPI (`tradelix-backend`) | 8000 |
| Dashboard (nginx) | 3200 |
| Postgres (backend Compose) | 5433 |
| Redis (backend Compose) | 6380 |

If the graph or chart is empty: `curl http://127.0.0.1:8000/` then click **Run pipeline** (the UI does not auto-stream).

Stop: `docker compose down` here, then in the backend repo.

## Host Vite (optional)

Needs a backend on **8000** (Compose API or host uvicorn — not both).

```bash
bun install
bun run dev                     # http://127.0.0.1:3200
```

## Other scripts

```bash
bun run build          # production bundle
bun run preview        # serve the bundle on :3200
bun run test           # vitest
bun run check-types    # tsc --noEmit
bun run check          # biome
```

## UI notes

- shadcn/ui: `components.json`, alias `@/*`, tokens in `src/styles.css`. Add a component with `bunx shadcn@latest add button`.
- Tailwind v4: no `tailwind.config.*`; the plugin is in `vite.config.ts`.
- Planned layout (do not implement unless asked): [docs/to-do-better-ui.md](docs/to-do-better-ui.md).

## Contributors

- [@Baneado85](https://github.com/Baneado85)
- [@ribartra](https://github.com/ribartra)

