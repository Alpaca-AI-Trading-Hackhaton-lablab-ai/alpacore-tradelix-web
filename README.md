# TradeLix PoC Web

Frontend Vite/React para el backend Python del hackathon. Usa Tailwind CSS v4 y shadcn/ui local.

## Stack

Bun + Vite + React 19 + TanStack Query + Tailwind 4 + Lightweight Charts v5

## UI

shadcn/ui esta configurado con `components.json`, alias `@/*` y tokens CSS en `src/styles.css`.
Para agregar componentes:

```bash
bunx shadcn@latest add button
```

Tailwind v4 no usa `tailwind.config.*` en este proyecto; el plugin vive en `vite.config.ts`.

## Dev

```bash
bun install
bun run dev
```

Proxy: `/api` -> `http://127.0.0.1:8000`

Backend esperado:

```bash
uvicorn backend:app --reload --port 8000
```
