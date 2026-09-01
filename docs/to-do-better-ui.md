# To-do: better UI — Progressive Disclosure Cockpit

Implementation spec for a future coder agent. **This file is the task.** Do not invent a second settings page, a dock manager, or a backend rewrite.

App: [`tradelix-poc-web`](../) (Vite/React, port 3200, proxy `/api` → FastAPI 8000).
Shell today: [`src/components/TradingDashboard.tsx`](../src/components/TradingDashboard.tsx).
Pipeline canvas: [`src/components/AgentGraph.tsx`](../src/components/AgentGraph.tsx).
Chart: [`src/components/PriceChart.tsx`](../src/components/PriceChart.tsx).

## Goal

1. Leave **configuration as Options** — one labeled drawer, not cards on the main path.
2. Redistribute the dashboard into a **Progressive Disclosure Cockpit (PDC)**.
3. Keep existing HTTP/SSE contracts. Paper-only. No ticks or raw OHLCV to the LLM.
4. All copy stays in English (UI labels, docs, comments you add).

## Pattern name

**Progressive Disclosure Cockpit (PDC)** — two established ideas, one name for this PoC:

1. **Workbench (NN/g / Nielsen).** Level 1 stays on the bench (daily tools + alarms). Level 2 lives in **one labeled Options drawer**, one click away. Do not use a mystery kebab (`⋯` / “More”). Configuration is infrequent; it is not a card in the foveal path.
   - [Progressive disclosure (UX Tigers / Nielsen, 2026)](https://www.uxtigers.com/post/progressive-disclosure)
   - [SaaS disclosure layers](https://pixxen.com/blog/progressive-disclosure-saas/)
2. **Trading cockpit (Lazarev / Hedge UI).** Tri-pane terminal: analysis in the center, operational graph on one side, decision/stats on the other, blotter **below**. Sensible presets beat a full Bloomberg dock.
   - [Crypto dashboard patterns](https://www.lazarev.agency/articles/crypto-dashboard-design)
   - [Resizable / dockable panes](https://www.hedgeui.com/blog/resizable-dockable-panel-layouts-react)

v1 layout is a **fixed CSS grid**. Optional later: `react-resizable-panels`. Do **not** adopt FlexLayout, IgrDockManager, or react-grid-layout in this pass.

```
Ticker (alarms) ─────────────────────────────────────────
Header (actions) ──────── Options ──► [drawer]
┌────────────┬────────────────────────┬─────────────┐
│ A Pipeline │ B Chart + market state │ C Decision  │
│ graph      │ PriceChart             │ action/gate │
│ Run/Stop   │ RSI / SMA / signal     │ sent/risk   │
│ inspector  │                        │ account     │
└────────────┴────────────────────────┴─────────────┘
D Blotter tabs: Positions | Execution | Invocations | Decision Log
```

## Why the current layout fails

[`TradingDashboard.tsx`](../src/components/TradingDashboard.tsx) is one `lg:grid-cols-3` stack. After the ticker/header the user hits, in order:

1. Full-width AgentGraph (Deep + models + indicators mixed with Run)
2. Full-width **API keys** card
3. Price + Market State
4. Sentiment / Risk / Account as three peer cards
5. Decision + gate
6. Order Execution
7. Positions
8. Decision Log
9. Invocations

Config and audit compete with the chart and the gate. [`AgentGraph.tsx`](../src/components/AgentGraph.tsx) mixes **run** (`Run pipeline`) with **options** (Deep research button, `LlmControls`, `IndicatorToggles` inside the node inspector).

## Options vs bench

| Zone | Always visible (bench) | Leaves the bench → Options |
|---|---|---|
| Ticker | symbol, last, equity, buying power, paper badge, Armed, Kill | — |
| Header | symbol select, Refresh, Dry-run, Execute, **Options** | decorative title noise |
| **Options drawer** (right sheet) | — | API keys, Groq models, Deep research, chart indicators, decision-snapshot indicators, persist via `PUT /settings` |
| A Pipeline (~1 col) | graph + Run/Stop + node inspector (output / ReAct only) | Deep button, model `<select>`s, indicator toggles |
| B Chart (~2 col) | `PriceChart` + compact Market State (RSI / SMA / signal) | — |
| C Decision rail | Decision action + gate verdict/checks + sentiment + risk + account | separate Sentiment / Risk / Account cards |
| D Blotter | **one** card with tabs | three stacked full-width tables |

**Label the trigger `Options`.** Not “Settings…”, not a gear-only icon without text, not a kebab. Information scent: the user must know keys, models, and indicators live there.

Armed / Kill stay on the **ticker**. They are alarms (Nielsen: keep alarms in plain sight), not configuration.

## Current-file map

| File | Role after PDC |
|---|---|
| [`src/components/TradingDashboard.tsx`](../src/components/TradingDashboard.tsx) | Shell: ticker, header, grid zones, query/mutation owners. Stays the composition root. |
| [`src/components/AgentGraph.tsx`](../src/components/AgentGraph.tsx) | Zone A only. Drop Deep button and inspector config chrome. Inspector shows node output / ReAct / “not configurable” copy. |
| [`src/components/PriceChart.tsx`](../src/components/PriceChart.tsx) | Zone B. Unchanged contract (`symbol`, `bars`). |
| **New** `src/components/OptionsDrawer.tsx` | Level-2 sheet. Keys + models + Deep + both indicator lists. Calls `saveSettings`. |
| **New** `src/components/Blotter.tsx` (or inline tabs in the shell) | Zone D. Tabs: Positions / Execution / Invocations / Decision Log. |
| [`src/api/market-client.ts`](../src/api/market-client.ts) | Keep. No new endpoints. |
| [`src/styles.css`](../src/styles.css) | Keep Binance-like dark tokens. Grid/drawer only; no theme rewrite. |

Suggested split is a suggestion. The shell may stay fat if the agent prefers fewer files — **do not** explode into a widget registry.

## Options drawer (level 2)

Right-side sheet (dialog or aside). Focus trap + Esc + overlay click to close. `aria-labelledby` = “Options”.

Sections, in this order:

1. **API keys** — move the existing `KeyField` block (Groq, Tavily, Alpaca key, Alpaca secret). Copy stays: saved keys override `.env`; blank keeps current source; values are never shown after save. Sources render as `db | env | missing` badges only.
2. **Models** — sentiment + decision Groq allowlist (`GET /models`). Same `LlmControls` behavior, relocated.
3. **Deep research** — one toggle that sets both `deepSentiment` and `deepDecision` (current header-button semantics), plus the per-agent deep checkboxes if they already exist.
4. **Indicators** — chart/compute list (`settings.indicators` → `/bars` + technical/features) and decision-snapshot list (`settings.decisionIndicators`).
5. **Save** — `PUT /settings` for keys and agents. Existing persist-on-change for agents in the dashboard may remain, but the drawer must be able to save keys explicitly.

Do not add a `/settings` route. Do not navigate away from the cockpit.

## Zone layout (v1 CSS)

Replace `main` `lg:grid-cols-3` + many `lg:col-span-3` cards with something equivalent to:

```
main (max-w-6xl or full-bleed, your call — prefer slightly wider than today)
  cockpit: grid-cols-1 lg:grid-cols-4  (or 12-col: 3 / 6 / 3)
    A  col-span-1   AgentGraph (drop lg:col-span-3)
    B  col-span-2   Price + compact market state
    C  col-span-1   Decision rail (stacked compact blocks)
  D  col-span-full  blotter tabs
```

Narrow viewports: stack A → B → C → D. Do not hide Options; put the button in the header wrap.

Market State today is a sibling card to Price. In PDC it sits **inside B** under or beside the chart (compact `dl`, not a third column of its own).

Decision rail (C) is one card or a tight stack: action + size + rationale, gate verdict + checks, then sentiment / risk / account as small rows — not three equal `Card`s competing with Price.

## APIs (do not change)

- `GET/PUT /settings` — public view never includes secret values (`db|env|missing`).
- `GET /bars` — `BarsOut` (candles + overlays). Chart only.
- `GET /pipeline` and `GET /pipeline/stream` — user-triggered. No auto-SSE on mount.
- `GET /sentiment|/options|/risk|/market-state|/decision` — **410**. Do not poll them. Seed market/decision/risk from the last pipeline run (already the case).
- `GET /control`, `POST /control/arm`, `POST /control/kill`.
- `GET /logs`, `GET /audit`, `POST /execute`, dry-run preview helpers.

SSE pipeline stays **synchronous** on the server. No gRPC, no Turbo, no LangGraph, no DeepSeek Harness in this PoC.

## Invariants

- Paper only. Never live. `ALPACA_PAPER_TRADE` is env, not a UI toggle.
- LLM proposes; gate / risk / execution stay deterministic. Inspector must not offer models on gate/risk/execution nodes.
- No ticks, raw option chains, or candle arrays in prompts. The chart is for humans; agents get a compact snapshot.
- Secrets: never echo key values from `GET /settings`.
- Do not adopt `alc-web` as a rewrite target. This is the hackathon PoC dashboard.

## Acceptance checklist

- [ ] Header has a control labeled **Options** that opens one drawer.
- [ ] API keys card is gone from the main grid.
- [ ] AgentGraph has no Deep button and no model/indicator controls in the inspector.
- [ ] Models, Deep, and both indicator lists live only in Options (and persist via `/settings`).
- [ ] Chart + compact market state share zone B; decision + gate + sentiment/risk/account share zone C.
- [ ] Positions, Order Execution, Invocations, and Decision Log are **tabs** in one blotter, not four stacked full-width cards.
- [ ] Ticker still shows paper badge, Armed, Kill.
- [ ] Run pipeline is still explicit (button). No fetch-on-mount of `/pipeline/stream`.
- [ ] `/decision` is not called. Keys still redact. Dark tokens unchanged.
- [ ] Desktop (~1280+) shows A | B | C without horizontal page scroll; mobile stacks.
- [ ] Verify in the browser: open Options, save a blank key (source unchanged), run pipeline, switch blotter tabs, arm/kill still on the ticker.

## Do not

- Do not implement FlexLayout, IgrDockManager, react-grid-layout, or a widget registry.
- Do not add a second settings route or a settings page.
- Do not hide Armed/Kill inside Options.
- Do not call `/execute` from a new hidden path; keep the existing header Execute (paper + gate).
- Do not send OHLCV or chart images to Groq.
- Do not change FastAPI response models, Redis, or Postgres for this UI pass.
- Do not enable live trading.
- Do not “fix” AGENTS.md’s older “dry-run only / no `/execute`” line by removing Execute — the header already has it; leave that product decision alone unless a human asks.

## Implementation order (for the implementing agent)

1. Extract `OptionsDrawer` and move API keys + models + Deep + indicators into it. Wire the header **Options** button. Leave the grid as-is until this compiles and `/settings` still works.
2. Strip config chrome from `AgentGraph` (Deep button, `LlmControls`, `IndicatorToggles`). Inspector = output / ReAct / locked copy.
3. Re-grid the cockpit: A / B / C as specified. Nest Market State into B; collapse Sentiment/Risk/Account into C.
4. Fold the four tables into blotter tabs.
5. Browser-verify the acceptance list. Hunt regressions: persist-on-change of agents, bars query key still follows indicator Options, pipeline SSE still paints nodes.

## Out of scope (later)

- `react-resizable-panels` and saved layout presets.
- Replacing the local Decision Log with `GET /audit` only.
- News panel.
- Static publish / container for the web app.
