# API usage metering & consumption limiter — spec

Spec de implementación para un agente coder. **Este archivo es la tarea.** Define cómo **consultar el
consumo** de cada API externa que usa el proyecto y cómo **limitar el uso** (presupuesto por **ventana
de ejecución**, enforcement **block + degrade**).

Companion de [`trade-page-logic.md`](./trade-page-logic.md) (ver **§14 scheduler + ventana UTC**, a la
que se ata el presupuesto). Backend: `alpaca-ai-trading-agents-hackathon-lablab.ai` (FastAPI monolito,
**paper-only**). Front: [`tradelix-poc-web`](../).

> Convención: prosa en español; **copy de UI en inglés**. Todo paper. Secrets nunca se hacen echo.

---

## 0. Resumen ejecutivo — ¿se puede consultar el consumo?

| Proveedor | ¿Consultable? | Cómo | Unidad | Endpoint de consulta |
|---|---|---|---|---|
| **Groq** (LLM) | **Sí** (hoy se descarta) | headers `x-ratelimit-*` + objeto `usage` en cada respuesta | tokens (TPM), requests (RPD) | **No hay** endpoint de gasto → contador local |
| **Tavily** (search) | **Sí** | endpoint dedicado + coste por request | créditos | **`GET https://api.tavily.com/usage`** |
| **Alpaca** (trading/data) | **Parcial** | headers `X-RateLimit-*` (SDK los oculta) | requests/min | No; leer headers vía httpx o contador local |
| **DuckDuckGo** IA | n/a | gratis/keyless | — | — |

**Hallazgo clave:** hoy hay **cero metering** en el código; en Groq los tokens y headers **llegan pero
se descartan** (`Reasoner.chat` solo guarda `.content`); `invocation_logs` no tiene columnas de coste.

---

## 1. Objetivo y alcance

1. **Observabilidad**: medir consumo real por proveedor (tokens, créditos, requests, coste estimado).
2. **Límite**: aplicar un **presupuesto por ventana de ejecución** (el periodo UTC inicio–fin del
   scheduler, `trade-page-logic.md` §14). Enforcement **block + degrade**: degradar antes de cortar.
3. **Higiene**: respetar los rate-limits del proveedor (RPM/TPM/200-min) con throttle + backoff, para
   no romper el flujo (baseline obligatorio, independiente del presupuesto elegido).

Paper only. LLM propone; el limitador es **determinista** y vive en el mismo carril que el gate.

---

## 2. Inventario de APIs (real, todas backend)

El front `tradelix-poc-web` **no** hace llamadas externas: todo `fetch`/`EventSource` va a
`env.VITE_API_URL` (same-origin `/api`). Los proveedores externos:

| Proveedor | Librería | Sitio de construcción / llamada |
|---|---|---|
| **Groq** | `langchain-groq` `ChatGroq` | `agents/react_core.py:27` (`Reasoner.chat` :29-35); `agents/sentiment_agent.py:81/86` |
| **Tavily** | `tavily-python` `TavilyClient` | `services/news_service.py:58/62` (`_fetch_market_news`) |
| **Alpaca** | `alpaca-py` | `services/alpaca_service.py` (`_get_trading_client`/`_get_data_client`) |
| **DuckDuckGo** | raw `urllib` | `services/concept_lookup.py:83-105` (keyless) |

Keys en `services/secrets.py` (DB `account_settings` gana a `.env`): `GROQ_API_KEY`, `TAVILY_API_KEY`,
`ALPACA_API_KEY`/`ALPACA_SECRET_KEY`. Cache Redis (`services/cache.py`) amortigua news/indicators/
account; **el LLM no se cachea**.

---

## 3. Detalle por proveedor — cómo consultar el consumo

### 3.1 Groq (LLM) — headers + `usage`, sin endpoint de gasto

Cada respuesta de Groq trae dos fuentes de consumo, **hoy tiradas** en `Reasoner.chat`
(`agents/react_core.py:29-35`, que solo retorna `{"response": result.content}`):

- **Tokens** — vía LangChain `AIMessage`:
  - `msg.usage_metadata` → `{ input_tokens, output_tokens, total_tokens }`.
  - `msg.response_metadata["token_usage"]` → `{ prompt_tokens, completion_tokens, total_tokens }`.
- **Rate-limit** — `msg.response_metadata` incluye los headers de Groq:

| Header | Significado |
|---|---|
| `x-ratelimit-limit-requests` | límite **RPD** (requests por día) |
| `x-ratelimit-limit-tokens` | límite **TPM** (tokens por minuto) |
| `x-ratelimit-remaining-requests` | requests restantes (día) |
| `x-ratelimit-remaining-tokens` | tokens restantes (minuto) |
| `x-ratelimit-reset-requests` | tiempo al reset de RPD (ej. `"1.2s"`, `"120ms"` → normalizar a ms) |
| `x-ratelimit-reset-tokens` | tiempo al reset de TPM |
| `retry-after` | segundos a esperar (solo en **429**) |

**No hay endpoint público de gasto/uso por key** (solo el dashboard de la consola). → El coste $ se
**calcula localmente** desde `total_tokens` × precio por modelo (tabla §10). RPD se rastrea con
contador local (los headers dan `remaining-requests`, pero conviene un contador propio por robustez).

**Captura:** en `Reasoner.chat` y en `agents/sentiment_agent.py:86`, tras `llm.invoke(...)`, leer
`usage_metadata`/`response_metadata` **antes** de descartar y pasar a `usage_meter.record(...)` (§4).

### 3.2 Tavily (search/deep-research) — endpoint `GET /usage`

Tavily **sí** expone un endpoint de consumo:

```
GET https://api.tavily.com/usage
Authorization: Bearer tvly-XXXX
X-Project-ID: proj_...        # opcional, para acotar a un proyecto
```

Respuesta (bloques a nivel key y cuenta; forma documentada por Tavily):
```jsonc
{
  "key":     { "usage": <créditos usados por esta key>, "limit": <tope de la key> },
  "account": { "usage": <créditos usados en el ciclo>,  "plan_limit": <tope del plan> }
}
```
`remaining = plan_limit - account.usage`. Errores: `401` (key mala), `429` (rate del propio endpoint).

**Coste por acción (créditos)** — para estimar antes de llamar:

| Acción | Créditos |
|---|---|
| Search **basic** | 1 |
| Search **advanced** (el que usa `news_service`, `search_depth="advanced"`) | 2 |
| Extract basic / advanced | 1 / 2 por cada 5 URLs |
| Map | 1–2 por 10 páginas |
| Research `model=mini` / `model=pro` | **4–110 / 15–250** |

**Estrategia:** contar créditos **localmente** por cada llamada (sabemos la acción/depth) y
**reconciliar** periódicamente con `GET /usage` (autoridad). El poll de `/usage` se hace 1× por tick del
scheduler o cada N llamadas (evita gastar rate del propio endpoint).

### 3.3 Alpaca (trading + data) — headers `X-RateLimit-*`

Toda respuesta de la API trae:

| Header | Significado |
|---|---|
| `X-RateLimit-Limit` | total permitido en la ventana (**200/min** por cuenta) |
| `X-RateLimit-Remaining` | requests restantes en la ventana |
| `X-RateLimit-Reset` | epoch (s) del reset de la ventana |

Problema: `alpaca-py` usa métodos de alto nivel y **oculta los headers**. Opciones:
- **(a)** envolver las llamadas con un cliente `httpx` propio (event hook `response`) que lea los headers
  y llame `usage_meter.record("alpaca", ...)`; o
- **(b)** **contador local** por método en `services/alpaca_service.py` (cada `submit_order`,
  `get_stock_bars`, etc. incrementa un contador de requests/min).

Paper trading **no tiene coste $**; el límite relevante es **requests/min** (higiene, §8). Marcar el
path muerto `services/mcp_client.py` `place_order()` como **side-channel no medido** si algún día se
cablea a ejecución.

### 3.4 DuckDuckGo Instant Answer — gratis

Keyless, sin coste, cacheado 3600s (`TTL_CONCEPT`). Solo **conteo informativo** de requests (no entra
en presupuesto). Headers accesibles (raw `urllib`) pero irrelevantes.

---

## 4. Captura de consumo (mecánica) — `services/usage_meter.py` (nuevo)

Servicio central con un único punto de registro:

```python
def record(provider: str, *, requests: int = 0, tokens: int = 0, credits: int = 0,
           est_cost_usd: float = 0.0, remaining: int | None = None,
           reset_ts: float | None = None, model: str | None = None,
           run_id: str | None = None, window_id: str | None = None) -> None: ...
```

Puntos de inserción (todos ya identificados):
- **Groq**: `agents/react_core.py` `Reasoner.chat` (:29-35) y `agents/sentiment_agent.py` (:86) — leer
  `usage_metadata`/`response_metadata`.
- **Tavily**: `services/news_service.py` (:62/70) — sumar créditos por `search_depth`; + poll `/usage`.
- **Alpaca**: wrapper httpx / contador en `services/alpaca_service.py`.

`record()` (a) actualiza el rollup en Redis (contadores calientes por ventana/minuto, baratos) y
(b) persiste el detalle en Postgres (§5). Reusa el buffer por `run_id` de `services/logs.py`.

---

## 5. Modelo de datos (Postgres)

**Extender `invocation_logs`** (`services/db.py:105-122`) con columnas de coste (hoy solo `latency_ms`/
`status`/`model`):

```
prompt_tokens INT NULL, completion_tokens INT NULL, total_tokens INT NULL,
credits INT NULL, est_cost_usd NUMERIC NULL
```

**Nueva tabla rollup `api_usage`** (agregado por proveedor y ventana):

| Campo | Tipo |
|---|---|
| `id` | PK |
| `provider` | str (`groq`/`tavily`/`alpaca`/`ddg`) |
| `window_id` | str NULL (id de la ventana del scheduler; NULL = global/día) |
| `requests` | int |
| `tokens` | int |
| `credits` | int |
| `est_cost_usd` | numeric |
| `remaining_reported` | int NULL (último `remaining` del proveedor) |
| `reset_ts` | `DateTime(tz)` NULL |
| `updated_at` | `DateTime(tz)` |

**Nueva tabla `api_budgets`** (config de límites, editable):

| Campo | Tipo |
|---|---|
| `provider` | str (PK con `limit_type`) |
| `scope` | str (`window`) |
| `limit_type` | str (`tokens`/`credits`/`requests`/`cost`) |
| `limit_value` | numeric |
| `warn_pct` | int (ej. 80) |
| `action` | str (`block_degrade`) |

Persistencia por el patrón de `services/persist.py` (`public_view()/update()`).

---

## 6. Estimación de consumo por run / ventana

Para dimensionar el presupuesto de ventana, modelar el volumen (cold cache):

| Proveedor | Shallow / run | Deep / run |
|---|---|---|
| Groq (llamadas) | ~1 (sentiment one-shot) | hasta ~6 (sentiment 3 + decision 3 turnos ReAct) |
| Tavily (créditos) | 2 (1 search advanced, ×2) | 2 + tools (varias searches) |
| Alpaca (requests) | 6–8 (bars ×3–5 + orders + positions + clock) | igual + tools |
| DuckDuckGo | 0 | algunos (lookup en ReAct) |

**Consumo de ventana** ≈ `Σ_ticks Σ_símbolos (consumo_por_run)`, con `ticks = ventana / interval_seconds`
y `símbolos = |universo|`. Ej.: universo 6 símbolos × ventana 2 h × cadencia 30 min = 4 ticks × 6 = 24
runs → 24 llamadas Groq (shallow) o hasta 144 (deep). Esto guía el `limit_value` por proveedor.

---

## 7. Limitador (budget guard) + degradación

**Pre-llamada**, antes de cada request externa:

```python
usage_guard.allow(provider, est_cost) -> Verdict{ ok, action, reason }
```

Compara el consumo acumulado de la **ventana** contra `api_budgets`. Estados por proveedor:
`OK (< warn_pct) → WARN (≥ warn_pct) → OVER (≥ limit)`.

**Escalera de degradación** (al entrar en `WARN`/`OVER`, en orden; `action = block_degrade`):

1. **Saltar deep-research**: forzar `deep=false` → no dispara ReAct/Tavily research (ahorra Groq+Tavily).
2. **Modelo Groq más barato**: conmutar `GROQ_MODEL*` al de menor coste del allowlist (`gpt-oss-20b`).
3. **Subir TTLs de cache** (`services/cache.py`) y **reducir universo** (menos símbolos por tick).
4. **Bajar cadencia**: aumentar `interval_seconds` del scheduler.
5. **Parar**: al agotar el presupuesto de **ventana** → detener el scheduler (§14) y **bloquear**
   nuevas llamadas (verdict BLOCK); las posiciones/condicionales no se tocan por esto (el flatten solo
   ocurre en `window_end`).

**Integración:**
- **Gate**: nuevo check `budget_ok` en `evaluate_gate()` (`agents/execution_gate.py`) —
  hard si `OVER` en un proveedor crítico (Groq/Alpaca de ejecución), soft (WARN) si degradable.
- **Scheduler** (§14): antes de cada tick, `usage_guard` decide correr / degradar / parar. El chip de
  schedule muestra el % de presupuesto consumido.

---

## 8. Higiene de rate-limit (baseline, siempre)

Independiente del presupuesto de ventana; obligatorio para no romper:

- **Leer `remaining`/`reset`** de cada proveedor (Groq headers, Alpaca `X-RateLimit-*`) y **throttle**
  cuando `remaining` esté bajo (ej. < 10%): pausar hasta `reset`.
- **429**: backoff exponencial con jitter, honrando `retry-after` (Groq) / `X-RateLimit-Reset` (Alpaca).
- Configurar `ChatGroq(max_retries=N)` explícito (hoy default 2 sin configurar).
- Mantener las guardas de fan-out existentes (`parallel_map(max_workers=3)`, `REACT_TOOL_TIMEOUT_S=8`).

---

## 9. API interna nueva — recurso `/usage`

| Método | Ruta | Rol |
|---|---|---|
| `GET` | `/usage` | snapshot por proveedor: `used`, `remaining`, `limit`, `reset_ts`, `credits`, `est_cost_usd`, `state` (OK/WARN/OVER), `degrade_level`, `window_id` |
| `GET` | `/usage/budgets` | presupuestos configurados |
| `PUT` | `/usage/budgets` | set `{provider, limit_type, limit_value, warn_pct, action}` (validado, persistido) |

El FE hace **poll** de `GET /usage` (`refetchInterval` 10 s, patrón de `controlQuery`).

---

## 10. Tablas de referencia (para el coste estimado)

- **Groq**: coste = `total_tokens × precio_por_token(model)`. Mantener un mapa `precio_por_1M_tokens`
  por modelo del allowlist (`services/config.py` `GROQ_ALLOWLIST`), separando prompt/completion. Límites
  free-tier orientativos: RPM/TPM/RPD por modelo (los headers dan los reales por respuesta).
- **Tavily**: coste = `Σ créditos` (tabla §3.2); `remaining` autoritativo desde `GET /usage`.
- **Alpaca**: sin coste $ en paper; límite **200 req/min** por cuenta.

> Los precios exactos por modelo se parametrizan en config (no hardcodear en el código de negocio); la
> UI solo lee `est_cost_usd` ya calculado.

---

## 11. UI (`tradelix-poc-web`)

- **Pestaña `Usage`** en el blotter (junto a Positions/Execution/Conditional Orders): una fila por
  proveedor con barra **used vs budget** de la ventana activa, `remaining`, `reset`, `est_cost_usd`, y
  un badge de estado (`OK`/`WARN`/`OVER`) + `degrade_level`. Colorear con el patrón `orderStatusClass`.
- **Options drawer** → sección **Budgets**: editar `limit_value`/`warn_pct` por proveedor → `PUT
  /usage/budgets`.
- **Schedule chip** (§14): añadir `· budget 62%` para leer el presupuesto de ventana de un vistazo.
- Tipos TS en `src/api/market-client.ts`:

```ts
export type UsageState = "OK" | "WARN" | "OVER";
export type PocApiUsage = {
  provider: "groq" | "tavily" | "alpaca" | "ddg";
  used: number; remaining: number | null; limit: number | null;
  credits?: number; est_cost_usd?: number;
  reset_ts?: string | null; state: UsageState; degrade_level: number;
  window_id?: string | null;
};
export type PocApiBudget = {
  provider: string; scope: "window";
  limit_type: "tokens" | "credits" | "requests" | "cost";
  limit_value: number; warn_pct: number; action: "block_degrade";
};
export async function fetchUsage(): Promise<PocApiUsage[]> { /* GET /usage */ }
export async function fetchBudgets(): Promise<PocApiBudget[]> { /* GET /usage/budgets */ }
export async function saveBudgets(b: PocApiBudget[]): Promise<PocApiBudget[]> { /* PUT /usage/budgets */ }
```

---

## 12. Invariantes

- **Paper only.** El limitador nunca habilita live.
- **Degradar antes de bloquear**: `block_degrade` agota la escalera §7 antes del BLOCK duro.
- **Contadores locales** cuando el proveedor no ofrece endpoint (Groq, Alpaca); reconciliar con la
  fuente autoritativa cuando exista (Tavily `/usage`).
- **Secrets**: la key de Tavily para `/usage` **no** se expone en la UI; `GET /usage` devuelve solo
  agregados, nunca keys (patrón `db|env|missing`).
- No romper contratos vigentes ni enviar OHLCV/keys al LLM. Copy de UI en inglés.

---

## 13. Criterios de aceptación

- [ ] `GET /usage` devuelve, por proveedor, `used/remaining/limit/reset/est_cost` y `state`.
- [ ] **Groq**: cada llamada registra `total_tokens` (desde `usage_metadata`) y `est_cost_usd`; los
      headers `x-ratelimit-*` se leen y guardan (`remaining_reported`, `reset_ts`).
- [ ] **Tavily**: se cuentan créditos por llamada y se reconcilian con `GET /usage`; `remaining` correcto.
- [ ] **Alpaca**: se lee `X-RateLimit-Remaining` (o contador local) y se respeta 200/min con backoff.
- [ ] Al superar `warn_pct` de la **ventana**, se aplica degradación (deep off → modelo barato → cache/
      universo → cadencia); al llegar al límite se **para el scheduler** y se **bloquea** (verdict BLOCK).
- [ ] Presupuestos editables en Options y persistidos (`api_budgets`), sobreviven reinicio.
- [ ] 429 de cualquier proveedor se maneja con `retry-after`/reset (sin crashear el run).
- [ ] Secrets nunca aparecen en `/usage` ni en la UI.

## 14. Cómo verificar (end-to-end, paper)

1. Fijar un presupuesto bajo (ej. Groq `tokens` con `warn_pct=50`) en Options ▸ Budgets → `PUT /usage/budgets`.
2. Correr el pipeline (Run) varias veces / arrancar el scheduler con ventana corta (§14) y observar
   `GET /usage`: los tokens/créditos/requests suben por proveedor.
3. Al cruzar `warn_pct`, confirmar la **degradación** (deep pasa a off, modelo Groq cambia al barato).
4. Al llegar al límite de ventana, confirmar que el scheduler **para** y nuevas ejecuciones dan **BLOCK**.
5. Forzar un 429 (o simularlo) y verificar backoff con `retry-after` sin romper el run.
6. Consultar Tavily `GET /usage` y comparar `remaining` con el contador local (reconciliación).

---

### Fuentes

- Groq rate-limit headers y 429 — [console.groq.com/docs/rate-limits](https://console.groq.com/docs/rate-limits).
- Tavily usage endpoint — [community.tavily.com — Usage Endpoint Now Live](https://community.tavily.com/t/usage-endpoint-now-live/863) — y créditos — [docs.tavily.com/documentation/api-credits](https://docs.tavily.com/documentation/api-credits).
- Alpaca rate limits — [alpaca-skills · rate-limits-resilience](https://github.com/alpacahq/alpaca-skills/blob/main/skills/broker-api/rate-limits-resilience/reference.md).
- Inventario de proveedores/keys y volumen por run: ver este repo (`services/secrets.py`, `services/config.py`, `backend.py` `run_pipeline`).
