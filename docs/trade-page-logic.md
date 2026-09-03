# Trade page logic — órdenes avanzadas estilo goodcryptoX

Spec de implementación para un agente coder. **Este archivo es la tarea.** Modela una página de
trading equivalente a `https://app.goodcrypto.app/trade/BINA0/BTCUSDT/algo`, adaptada a este PoC.

App: [`tradelix-poc-web`](../) (Vite/React 19, port 3200, proxy `/api` → FastAPI 8000, **paper-only**).
Shell: [`src/components/TradingDashboard.tsx`](../src/components/TradingDashboard.tsx).
Chart: [`src/components/PriceChart.tsx`](../src/components/PriceChart.tsx).
Tipos/API: [`src/api/market-client.ts`](../src/api/market-client.ts).
Layout base: [`docs/to-do-better-ui.md`](./to-do-better-ui.md) (Progressive Disclosure Cockpit).

> Convención: la prosa de este doc va en español; **todo copy de UI (labels, tooltips, aria) va en
> inglés**, igual que el resto del cockpit. Toda ejecución es **paper**. `ALPACA_PAPER_TRADE` es env,
> nunca un toggle de UI.

---

## 0. Principio rector (no negociable)

**El LLM propone; el risk determinista + dry-run/paper deciden si algo toca el portfolio.**
La página de órdenes avanzadas es una **superficie de composición y visualización**: deja que un
humano (o el Decision Agent) arme un setup TP/SL/condicional, lo previsualice en dry-run, lo pase por
el **gate**, y solo entonces lo **arme** y **ejecute**. Ningún control nuevo puede saltarse
`gate → arm → execute`.

---

## 1. Contexto y alcance

goodcryptoX enruta como `/trade/{account}/{pair}/{tab}` → `BINA0` (cuenta/exchange), `BTCUSDT` (par),
`algo` (pestaña de órdenes **algorítmicas/condicionales**). En este PoC el equivalente es:

| goodcryptoX | tradelix-poc-web |
|---|---|
| `account` = `BINA0` (Binance sub-cuenta) | broker = **Alpaca paper**, cuenta única (`GET /account`) |
| `pair` = `BTCUSDT` | `symbol` (equities/crypto de Alpaca) — el `symbol` que ya maneja el shell |
| `tab` = `algo` | **Algo workspace**: order ticket avanzado + builder de condicionales + líneas en el chart |

Alcance de este spec: **interactividad**, visualización de **BUY/SELL, BREAK EVEN, TAKE PROFIT,
STOP LOSS**, **programación de órdenes condicionales**, la **máquina de estados** de las órdenes, el
**mapeo a órdenes reales de Alpaca**, y la **integración con el flujo agéntico**.

Fuera de alcance: live trading, order book L2, DEX/perps, copy-trading, grid/DCA bots (referenciados
solo como evolución).

---

## 2. Órdenes soportadas (modelo conceptual, tomado de goodcryptoX)

| Tipo | Qué hace | Parámetros clave |
|---|---|---|
| **Market** | entra/sale ya | `side`, `qty`\|`notional` |
| **Limit** | precio o mejor | `side`, `qty`, `limit_price` |
| **Stop / Stop-limit** | dispara al `stop_price` | `stop_price`, (`limit_price`) |
| **Take Profit (TP)** | sale con ganancia al `tp_price` | `tp_price`, `market`\|`limit` |
| **Multiple TPs** | reparte la posición en N salidas | `[{tp_price, size_pct, type}]` (Σ pct = 100) |
| **Stop Loss (SL)** | corta pérdida al `sl_price` | `sl_price`, `market`\|`limit` |
| **TP + SL combo (OCO)** | TP y SL atados; uno cancela al otro | `tp_price`, `sl_price` |
| **Trailing Stop** | SL que sigue al precio a `trailing_distance` | `trailing_distance`, `trailing_start`, `improve_only` |
| **Trailing TP** | TP que trailea tras alcanzar activación (garantiza ≥ break-even) | `activation`, `trailing_distance` |
| **SL que sigue a TPs** | el SL sube (long) al dispararse cada TP → **break-even** y más allá | `follow: be \| tp_levels` |
| **Conditional / Algo** | cualquiera de las anteriores **armada tras una condición** (nivel de precio o webhook), server-side, **sin congelar balance** hasta el disparo | `trigger: {kind: price\|webhook, ...}` |

**Regla goodcryptoX de balance:** las condicionales viven server-side; el capital queda **libre**
hasta que se dispara la condición. Aquí se replica con el **motor condicional** (§9) sobre paper.

---

## 3. Zonas / layout (extensión del PDC)

No se rompe el cockpit A/B/C/D de [`to-do-better-ui.md`](./to-do-better-ui.md). El Algo workspace se
inyecta así:

```
Ticker (symbol, last, equity, buying power, paper badge, Armed, Kill) ─────────────
Header (symbol select · Refresh · Dry-run · Execute · Options) ────────────────────
┌────────────┬────────────────────────────────┬──────────────────────────┐
│ A Pipeline │ B Chart + order lines           │ C Decision rail +        │
│ graph      │  PriceChart con Entry/TP/SL/BE  │   ORDER TICKET (algo)    │
│ Run/Stop   │  drag handles, R:R shading      │   side · size · TP/SL    │
│ inspector  │  compact market state           │   trailing · conditional │
└────────────┴────────────────────────────────┴──────────────────────────┘
D Blotter tabs: Positions | Execution | Conditional Orders | Invocations | Decision Log
```

- **Order Ticket** vive dentro de la **Decision rail (C)**, debajo del bloque de decisión/gate: es la
  materialización operativa de la propuesta del Decision Agent (side + size ya vienen de `PocDecision`
  / `PocRisk`).
- **Order lines** se dibujan en el **chart (B)** reutilizando `createPriceLine` (§4).
- Nueva pestaña **Conditional Orders** en el **blotter (D)**: lista/estado de condicionales activas.

Narrow viewport: A → B → (ticket colapsable) → C → D. No ocultar Armed/Kill.

---

## 4. Interactividad del chart — líneas de orden

Se **extiende** `PriceChart.tsx`, que hoy ya usa `series.createPriceLine()` para order-blocks
bull/bear (ver refs `bullLine`/`bearLine`). Se añade un juego de líneas de orden gestionadas:

| Línea | Color (token) | Estilo | Label |
|---|---|---|---|
| **Entry** | `--gold` (`#f0b90b`) | Solid | `ENTRY @ {price}` |
| **Take Profit** (1..n) | `--long` (`#0ecb81`) | Dashed | `TP{n} +{pct}% ({size_pct}%)` |
| **Stop Loss** | `--short` (`#f6465d`) | Dashed | `SL −{pct}%` |
| **Break-even** | `--gold` atenuado | Dotted | `BE` |

Comportamiento:

1. **Drag para fijar precio.** Cada línea es arrastrable; al soltar actualiza el precio de esa pata en
   el ticket y recomputa % y **R-múltiplo**. `lightweight-charts` v5 no trae drag nativo de price
   lines → implementar con un handler sobre `chart.subscribeCrosshairMove` + captura de puntero sobre
   la banda de la línea, o líneas custom con un plugin de series primitives. Mantener la API del
   componente (`symbol`, `bars`) y **añadir props** `orderPlan?: OrderPlan` + `onPlanChange?`.
2. **Zona de riesgo/beneficio.** Sombrear entre Entry↔SL (rojo tenue) y Entry↔TP (verde tenue) para
   leer R:R de un vistazo.
3. **R-múltiplo y PnL en vivo.** `R = |tp − entry| / |entry − sl|`. PnL estimado por pata = `size *
   (exit − entry) * dir`. Mostrar en la etiqueta y en el ticket.
4. **Snapping opcional** a `bullish_ob` / `bearish_ob` (`PocMarketState`) y a SMA/EMA overlays.
5. **Sólo humanos ven el chart.** Nunca se envían OHLCV ni imágenes al LLM (invariante); el agente
   recibe únicamente el snapshot compacto que ya produce el backend.

Colores/format vía tokens de `src/styles.css` y helpers de `src/lib/format.ts`
(`actionClass`, `orderStatusClass`, `formatMoney`).

---

## 5. Visualización BUY/SELL

- **Side toggle** BUY/SELL en el Order Ticket. Colorea con `actionClass` (BUY = long/verde,
  SELL = short/rojo, HOLD = gold). El default se **siembra** desde `PocDecision.action`.
- **Direccionalidad de las patas.** Para `long` (BUY): TP arriba del entry, SL abajo. Para `short`
  (SELL): TP abajo, SL arriba. El builder valida esta invariante y bloquea configuraciones inválidas
  (p. ej. SL por encima del entry en un long) antes del dry-run.
- **Position badge** (desde `PocPosition`): `side · qty · avg_entry_price · unrealized_pl`, con el
  uPnL coloreado (verde/rojo). Fuente: `GET /positions`.
- **Size**: notional o qty; se siembra desde `PocRisk.position_size`. El gate valida contra
  `buying_power`.

---

## 6. BREAK EVEN

**Definición:** mover el Stop Loss al precio de entrada (ajustado por fees/comisiones) para eliminar
el riesgo de la operación.

**Trigger (dos modos, elegibles en el ticket):**
- **On TP1 fill** (recomendado, = "SL que sigue a TPs"): al llenarse el primer TP, `sl_price ←
  break_even_price`.
- **On price** (BE anticipado): al alcanzarse un `be_trigger_price`, `sl_price ← break_even_price`.

**Fórmula del precio break-even** (incluye fees round-trip `f` como fracción, p. ej. 0.001):
- Long: `break_even_price = avg_entry_price * (1 + f)`
- Short: `break_even_price = avg_entry_price * (1 − f)`

En paper sin fees, `f = 0` → BE = `avg_entry_price`. Tras BE, si hay más niveles de TP, el SL puede
seguir escalando a `tp_price[k-1]` cuando dispara `tp[k]` (trailing por niveles).

La **línea BE** aparece punteada en el chart apenas se configura; se “realiza” (el SL salta a ella)
al cumplirse el trigger, y la transición se refleja en la máquina de estados (`be_moved`, §10).

---

## 7. TAKE PROFIT

### 7.1 TP único
`tp_price` + tipo (`market` = ejecución garantizada con posible slippage; `limit` = protege precio,
riesgo de no llenarse). Cierra el 100% de la posición.

### 7.2 Multiple Take Profits
Reparte la posición en N salidas: `tps: [{ tp_price, size_pct, type }]`, con **Σ `size_pct` = 100**.
Reglas:
- Orden ascendente de "bondad" según `side` (long: precios crecientes; short: decrecientes).
- Cada nivel llena su `size_pct` de la qty original; el remanente sigue vivo.
- Interacción con **un SL único**: cuando dispara `tp[k]`, el SL puede seguir a los TPs (§6) y su
  `qty` se reduce al remanente. UI muestra por nivel: precio, %Δ desde entry, size %, y PnL parcial.

Validación del builder: `Σ size_pct == 100`, precios estrictamente monótonos respecto al side, y
todos del lado correcto del entry.

---

## 8. STOP LOSS

Tres modos (mutuamente combinables con TPs):

1. **Fixed** — `sl_price` estático, `market` o `limit`.
2. **Trailing** — sigue al precio a `trailing_distance` (abs o %):
   - `trailing_start`: condición para **empezar** a trailear (nivel de precio **o** webhook). Antes de
     activarse, el SL no se mueve.
   - `improve_only`: el nivel efectivo **nunca empeora** respecto al mejor alcanzado (long: solo
     sube; short: solo baja).
   - Al retroceder el precio `trailing_distance` desde su extremo, dispara (market o stop-limit).
3. **Follow-TP** — ver §6: BE en TP1 y luego escalonado por niveles.

**Trailing TP** (simétrico): solo **activa** (`activation`) cuando el precio mejoró lo suficiente para
asegurar **≥ break-even**; a partir de ahí trailea a `trailing_distance` capturando extensión.

`market` vs `limit`: documentar el trade-off (slippage vs. no-fill) en el tooltip del control.

---

## 9. Programación de órdenes condicionales (Algo)

Cualquier orden de §2 puede envolverse en una **condición de disparo**. Server-side, **sin congelar
balance** hasta el trigger (réplica de la mecánica goodcryptoX mediante un motor condicional propio,
en paper).

**Trigger kinds:**
- **`price`** — `{ kind: "price", op: ">=" | "<=", price }` sobre el last del símbolo.
- **`webhook`** — `{ kind: "webhook", token }`: se dispara con un POST entrante (equivalente a un
  webhook de TradingView). El token es opaco y **redactado** en `GET` (invariante de secrets).

**Esquema JSON de una orden condicional** (payload del builder → backend):

```jsonc
{
  "symbol": "AAPL",
  "side": "buy",                 // buy | sell
  "trigger": { "kind": "price", "op": ">=", "price": 190.0 },
  "entry":   { "type": "market" },                 // o limit/stop
  "size":    { "notional": 500 },                  // o { "qty": 3 }
  "bracket": {
    "tps": [
      { "tp_price": 195.0, "size_pct": 50, "type": "limit" },
      { "tp_price": 200.0, "size_pct": 50, "type": "market" }
    ],
    "sl":  { "mode": "trailing", "trailing_distance_pct": 1.5,
             "trailing_start": { "kind": "price", "price": 193.0 },
             "improve_only": true },
    "break_even": { "on": "tp1_fill", "fees_frac": 0.0 }
  },
  "expires_at": null             // GTC por defecto
}
```

**Builder UI** (en el Order Ticket, sección *Conditional*):
- Selector de `trigger.kind` (Price level / Webhook), con campos contextuales.
- Resumen legible: *"When AAPL ≥ 190.00 → BUY $500 market, TP 195/200, trailing SL 1.5% (BE at TP1)"*.
- Estado en la pestaña **Conditional Orders** del blotter: `armed → triggered → working → done |
  cancelled | expired`.

Invariante: una condicional **también** pasa por `gate` en el momento de crearse (validación estática:
R:R, max_loss, size) y **de nuevo** al dispararse (validación en vivo antes de mandar a Alpaca).

---

## 10. Máquina de estados de la orden / setup

```
        Dry-run OK          Arm            trigger/mkt
draft ──────────────► previewed ──────► armed ──────────► working
  ▲                        │  gate BLOCK   │ Kill            │
  │ edit                   └───────────────┴───────► rejected/cancelled
  │                                                          │ TP1 fill
  └───────────────────────── closed ◄── done ◄── be_moved ◄──┘
                                          │           │ next TP fills / trailing
                                          └───────────┴──► trailing ──► closed
```

| Estado | Significado |
|---|---|
| `draft` | editándose en el ticket / arrastrando líneas |
| `previewed` | pasó `buildDryRunPreview` extendido; muestra las llamadas que haría |
| `armed` | Armed on + gate ALLOW; esperando ejecución o trigger condicional |
| `working` | entry llena; patas TP/SL vivas en Alpaca/motor |
| `partially_filled` | algún TP parcial; remanente vivo |
| `be_moved` | SL reubicado a break-even (§6) |
| `trailing` | SL/TP en modo trailing activo |
| `closed` / `cancelled` / `rejected` / `expired` | terminales |

`Kill` fuerza cancel de todo lo armado/working. Reutiliza `orderStatusClass` para el color de cada
estado en el blotter.

---

## 11. Mapeo a órdenes reales de Alpaca

Alpaca soporta **nativo**: `bracket` (OTOCO), `oco`, `stop`, `stop_limit`, `trailing_stop`, y
`--dry-run`. Lo que no es un tipo nativo único se **emula en el motor condicional server-side**.

| Feature de la página | Alpaca nativo | Emulado (motor condicional) |
|---|---|---|
| Market / Limit / Stop / Stop-limit | ✅ `type=market/limit/stop/stop_limit` | — |
| TP + SL combo | ✅ `order_class=bracket` (`take_profit`+`stop_loss`) u `oco` sobre posición | — |
| Trailing Stop | ✅ `type=trailing_stop` (`trail_price`/`trail_percent`) | `trailing_start` / `improve_only` si no hay equivalente exacto |
| Multiple TPs | — (bracket sólo 1 TP + 1 SL) | ✅ N legs: 1 bracket base + salidas limit adicionales gestionadas |
| Break-even / SL-follow-TP | — | ✅ al fill de TP1 → `PATCH`/replace del SL a BE |
| Trailing TP con activación | parcial | ✅ activación + trailing gestionados server-side |
| Conditional por price/webhook | — (no congela balance) | ✅ motor evalúa trigger y **entonces** manda la orden a Alpaca |

**Dry-run.** Extender `buildDryRunPreview()` (`market-client.ts`) para que, en vez de un único
`place_stock_order`, devuelva el **plan completo de llamadas** que se harían:

```jsonc
{
  "status": "DRY_RUN",
  "would_call": [
    { "tool": "place_stock_order", "order_class": "bracket", "symbol": "AAPL",
      "side": "buy", "notional": 500, "take_profit": {"limit_price": 195},
      "stop_loss": {"stop_price": 188} },
    { "tool": "place_stock_order", "type": "limit", "symbol": "AAPL",
      "side": "sell", "qty": "<remainder>", "limit_price": 200 }
  ],
  "conditional": { "kind": "price", "op": ">=", "price": 190 },
  "risk": { "r_multiple": 2.3, "max_loss": 12.0, "break_even": "on tp1" }
}
```

En condicionales, el dry-run muestra el **plan diferido** (no ejecuta) y el resumen del trigger.

---

## 12. Contratos nuevos (backend + tipos TS) — *greenfield*

Hoy **no existen**; añadirlos sin romper los contratos actuales de
[`to-do-better-ui.md`](./to-do-better-ui.md).

**Tipos en `src/api/market-client.ts`:**

```ts
// Extender PocRisk (hoy sólo tiene take_profit)
export type PocRisk = {
  /* ...existente... */
  take_profit: number;
  stop_loss?: number;
  break_even?: number;
  r_multiple?: number;
};

export type PocOrderLeg = {
  role: "entry" | "tp" | "sl" | "be";
  type: "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";
  price?: number;
  size_pct?: number;               // para multiple TPs
  trailing_distance?: number;
  trailing_start?: PocTrigger;
  improve_only?: boolean;
};

export type PocTrigger =
  | { kind: "price"; op: ">=" | "<="; price: number }
  | { kind: "webhook"; token_source: "db" | "env" | "missing" }; // token redactado

export type PocBracketPlan = {
  symbol: string;
  side: "buy" | "sell";
  size: { notional?: number; qty?: number };
  entry: PocOrderLeg;
  tps: PocOrderLeg[];
  sl?: PocOrderLeg;
  break_even?: { on: "tp1_fill" | "price"; price?: number; fees_frac: number };
};

export type PocConditionalOrder = {
  id: string;
  status: "armed" | "triggered" | "working" | "done" | "cancelled" | "expired";
  trigger: PocTrigger;
  plan: PocBracketPlan;
  created_ts: string;
  triggered_ts?: string | null;
};
```

**Endpoints FastAPI a añadir** (paper, detrás del gate):

| Método | Ruta | Rol |
|---|---|---|
| `POST` | `/bracket/preview` | dry-run del plan → devuelve `would_call[]` + risk (§11) |
| `POST` | `/bracket/execute` | crea el bracket/legs en Alpaca (requiere Armed + gate ALLOW) |
| `GET` | `/conditional-orders` | lista condicionales (tokens redactados) |
| `POST` | `/conditional-orders` | crea una condicional (validación estática por el gate) |
| `DELETE` | `/conditional-orders/{id}` | cancela una condicional |
| `POST` | `/webhook/{token}` | dispara condicionales tipo webhook |

El motor condicional evalúa triggers (loop/stream) y, al dispararse, **revalida por el gate** y manda
la orden. Reutiliza el `POST /execute` existente como base de la ejecución.

---

## 13. Integración con el flujo agéntico

```
Decision Agent (LLM)  ──►  propone PocBracketPlan / PocConditionalOrder
        │                    (side, size, tp/sl, condición)
        ▼
   Order Ticket (humano ajusta arrastrando líneas)  ──►  POST /bracket/preview (dry-run)
        │
        ▼
   Gate (determinista): R:R, max_loss, position_size, buying_power  ──►  ALLOW | BLOCK | NO_TRADE
        │ ALLOW + Armed
        ▼
   POST /bracket/execute  (o crear condicional)  ──►  Alpaca paper / motor condicional
        │
        ▼
   Blotter: Execution / Conditional Orders / Positions  +  Decision Log / audit
```

- El LLM **solo propone**; nunca ejecuta ni ve OHLCV. Recibe el snapshot compacto y devuelve un plan.
- El **gate** valida el plan estáticamente al crear y en vivo al disparar (condicionales).
- `Armed` + `Kill` (ticker) siguen siendo los interruptores maestros; el motor condicional también
  respeta `Kill`.

---

## 14. Scheduler y ventana de ejecución (cadencia + periodo UTC)

Controles elegibles desde la interfaz para decidir **cada cuánto** corre el sistema multiagente y en
**qué periodo** (inicio/fin, `dd mm yyyy hh mm ss`, **UTC**) están activos los agentes **y sus órdenes
asociadas**. Hoy el pipeline corre solo por request (Run/Execute) y **no existe scheduler**: esto es
el primer loop de fondo del PoC.

### 14.1 Ubicación en el cockpit (split Nielsen de `to-do-better-ui.md`)

- **Ticker** → `Schedule` **status chip** (alarma, siempre visible), junto a Armed/Kill:
  `⏱ every 15m · window active · next run 14:32:00Z` + botón **Start / Stop**. Los interruptores y el
  estado viven en la bench.
- **Options drawer** → sección **Schedule** (config infrecuente): edición de cadencia y ventana.

Regla: **on/off + estado** en el ticker (alarma); **edición de cadencia/ventana** en Options (config).

### 14.2 Cadencia (interval)

- **Presets**: `1m · 5m · 15m · 30m · 1h · 4h · 1d`.
- **Custom**: campo numérico `N` + unidad (`s | m | h`).
- Ambos se normalizan a **`interval_seconds`**.
- **Piso mínimo** `MIN_INTERVAL_S` (p. ej. 30 s): el pipeline es **síncrono** y puede tardar; intervalos
  menores se rechazan en validación.
- **Sin solapamiento**: si el run anterior sigue `in_flight`, el tick se **omite** (no se encola).

### 14.3 Ventana de ejecución (periodo UTC)

- `window_start` y `window_end`: **ISO-8601 UTC** (`2026-09-03T14:30:00Z`), granularidad de **segundos**.
- La UI pide/muestra en **UTC explícito** con badge `UTC`; **no** convierte a hora local.
- Validación: `window_end > window_start`; `window_start` puede ser "ahora". `window_end` es requerido
  (una ventana abierta sería un caso aparte, fuera de este spec).
- **Input sin librería de fechas** (no hay `date-fns`/`dayjs`/`luxon` ni date-picker en `ui/`):
  6 segmentos `dd mm yyyy hh mm ss` con badge `UTC` (recomendado, respeta el formato pedido), o como
  fallback simple `<input type="datetime-local" step="1">` interpretado como UTC (se le anexa `Z`).
  Iconos `Calendar` / `Clock` de `lucide-react`.

### 14.4 Máquina de estados del scheduler

```
                 enable + save
   disabled ───────────────────► scheduled ──(now ≥ start)──► running
      ▲                              │  countdown to start        │  cada interval_seconds:
      │ disable/Stop                 │                            │  pipeline → gate → arm → execute
      │                             kill                        kill│  + evalúa condicionales
   ended ◄──(now ≥ end)── running ◄──┴──────── paused ◄────────────┘
     │  wind-down: cancel_armed() + flatten
     └────────────────────────────────────────────────────────────
```

| Estado | Significado |
|---|---|
| `disabled` | sin schedule activo; solo Run/Execute manuales |
| `scheduled` | habilitado, `now < window_start`; el chip cuenta atrás al inicio |
| `running` | dentro de ventana; **tick** cada `interval_seconds` |
| `paused` | Kill activo → no se lanzan runs (la ventana sigue corriendo) |
| `ended` | `now ≥ window_end`; ejecutado el wind-down; terminal |

Cada **tick** dentro de ventana ejecuta el **mismo path que `POST /execute`** (pipeline → `evaluate_gate`
→ arm → `execute_trade`) y evalúa las condicionales; nada salta el gate.

### 14.5 Fin de ventana (wind-down) — *parar + cancelar + flatten*

Al alcanzar `window_end`, `end_action = "stop_cancel_flatten"`:

1. **Parar** el ticking (no más ciclos de agentes).
2. **Cancelar** las condicionales/pendientes aún no disparadas → reusar
   `conditional.cancel_armed()` (el mismo que ya llama `POST /control/kill`).
3. **Flatten**: cerrar posiciones abiertas con órdenes **market reduce-only** (paper) vía
   `alpaca_service` (cierre de posiciones / `get_market_clock` para el modo).
4. **Auditar** cada acción (audit log / Decision Log).

El wind-down es una acción de **seguridad que reduce exposición**, por lo que corre aunque el sistema
no esté `armed` (arm gobierna **abrir** riesgo, no **cerrar**); respeta `Kill` (si ya está engaged, el
flatten igualmente procede porque reduce riesgo).

### 14.6 Enforcement — la ventana como hard check del gate

Se añade `config.is_within_window(now)` y se integra como **hard check** en `evaluate_gate()`
(`agents/execution_gate.py`, junto a `kill_switch`). Efecto:

- Bloquea `POST /execute` fuera de ventana.
- Bloquea el **disparo de condicionales** fuera de ventana (recorren el mismo gate) → así **agentes y
  órdenes asociadas** quedan acotados por el mismo periodo, incluso una condicional de precio que se
  cumpla fuera de la ventana **no** ejecuta.
- `Kill` sigue por encima de todo (pausa runs); el wind-down de fin de ventana sí se ejecuta.

### 14.7 Persistencia (durable, a diferencia de arm/kill)

Arm/Kill viven **en memoria** (`services/config.py:_state`) y se resetean al reiniciar. El schedule
debe sobrevivir reinicios → **nueva tabla singleton Postgres** `schedule_settings` (modelo
`ScheduleSettings` en `services/db.py`):

| Campo | Tipo |
|---|---|
| `id` | PK singleton (=1) |
| `enabled` | bool |
| `interval_seconds` | int (≥ `MIN_INTERVAL_S`) |
| `window_start` | `DateTime(timezone=True)` (UTC) |
| `window_end` | `DateTime(timezone=True)` (UTC) |
| `end_action` | str (`stop_cancel_flatten`) |
| `updated_at` | `DateTime(timezone=True)` |

El scheduler la **lee al arrancar** (reanuda una ventana en curso). Persistencia por
`services/persist.py` (patrón `public_view()/update()`).

### 14.8 Scheduler server-side

Un **único** loop de fondo, dueño de toda la evaluación periódica:

- `AsyncIOScheduler` (APScheduler) **o** una `asyncio.Task` creada en el `lifespan`/startup de FastAPI
  (`backend.py`).
- Cada `interval_seconds`: `if enabled and is_within_window(now) and not in_flight →` corre el ciclo;
  además **empuja las condicionales** en cada tick (hoy solo se evalúan en requests entrantes a
  `/spy` / `/webhook`; el scheduler pasa a ser su reloj).
- Al cruzar `window_end`: ejecuta el wind-down (§14.5) una sola vez y pasa a `ended`.

### 14.9 Contratos API nuevos — recurso `/schedule`

Separado de `/settings` por ser **operativo** (config + estado vivo):

| Método | Ruta | Rol |
|---|---|---|
| `GET` | `/schedule` | config + estado vivo (`state`, `next_run_ts`, `last_run_ts`, `in_flight`) |
| `PUT` | `/schedule` | set `{enabled?, interval_seconds?, window_start?, window_end?, end_action?}` (validado, persistido) |
| `POST` | `/schedule/start` | habilita (paridad con `/control/arm`) |
| `POST` | `/schedule/stop` | deshabilita el ticking (no dispara wind-down; eso es solo `window_end`) |

El FE hace **poll** de `GET /schedule` (`refetchInterval` 5–10 s, como el patrón de `controlQuery`)
para pintar la cuenta atrás del chip.

### 14.10 Tipos TS (`src/api/market-client.ts`)

```ts
export type ScheduleState = "disabled" | "scheduled" | "running" | "paused" | "ended";

export type PocSchedule = {
  enabled: boolean;
  interval_seconds: number;
  window_start: string | null;   // ISO-8601 UTC (…Z)
  window_end: string | null;     // ISO-8601 UTC (…Z)
  end_action: "stop_cancel_flatten";
  state: ScheduleState;
  next_run_ts?: string | null;   // ISO-8601 UTC
  last_run_ts?: string | null;
  in_flight: boolean;
};

export async function fetchSchedule(): Promise<PocSchedule> { /* GET /schedule */ }
export async function saveSchedule(body: Partial<PocSchedule>): Promise<PocSchedule> { /* PUT /schedule */ }
export async function startSchedule(): Promise<PocSchedule> { /* POST /schedule/start */ }
export async function stopSchedule(): Promise<PocSchedule> { /* POST /schedule/stop */ }
```

### 14.11 Componentes FE

- **`ScheduleChip`** (ticker): cadencia + estado + cuenta atrás + Start/Stop. Colorea el estado con el
  patrón de `orderStatusClass`; usa `PocSchedule.state`/`next_run_ts`.
- **`ScheduleSection`** (Options drawer): cadencia (presets + custom), dos inputs UTC
  `dd mm yyyy hh mm ss` (§14.3), `end_action` mostrada (fija `stop_cancel_flatten`), **Save** →
  `saveSchedule`.
- **`UtcDateTimeField`**: input segmentado sin librería (o `datetime-local step=1` como UTC).

### 14.12 Wireframe (chip + sección)

```
Ticker: … | Paper | Armed ● | Kill ○ | ⏱ every 15m · UTC 03/09→03/09 · next 14:32:00Z [ Stop ]

┌ Options ▸ Schedule ───────────────────────────────────────────┐
│ Cadence:  ( 1m 5m [15m] 30m 1h 4h 1d )   custom [  30 ] ( s ▾ )│
│ Window (UTC):                                                  │
│   Start  [03] [09] [2026]  [14] [30] [00]   🕑 UTC             │
│   End    [03] [09] [2026]  [16] [00] [00]   🕑 UTC             │
│ On end:  Stop agents + cancel pending + flatten positions      │
│                                             [ Save schedule ]  │
└───────────────────────────────────────────────────────────────┘
```

---

## 15. Invariantes respetadas

- **Paper only.** Nunca live. `ALPACA_PAPER_TRADE` es env, no un toggle de UI.
- LLM propone; **gate/risk/ejecución son deterministas**. El inspector no ofrece modelos en
  gate/risk/execution.
- **Nada de OHLCV, cadenas de opciones ni arrays de velas en prompts.** El chart es para humanos.
- **Secrets nunca se hacen echo**: el `token` de webhook se muestra como `db | env | missing`.
- **No adoptar `alc-web`** como base; esta es la UI del PoC del hackathon.
- Copy de UI en inglés; sin segunda ruta de settings; no romper contratos vigentes.
- **Scheduler**: cada tick pasa por gate/arm/kill; `Kill` pausa el scheduler; piso de intervalo
  (`MIN_INTERVAL_S`); sin solapamiento de runs; ventana en **UTC** y persistida en Postgres.

---

## 16. Wireframe (Order Ticket + Conditional builder)

```
┌ Order Ticket (Zone C) ───────────────────────────────┐
│ [ BUY ]  SELL          size: [ $500 ]  ⟳ from risk     │
│ Entry:  ( Market ▾ )   @ 190.00        R:R  2.3        │
│ ─ Take Profit ─────────────────────────────────────── │
│  TP1  195.00  +2.6%  [50%] (limit)   ✎  🗑              │
│  TP2  200.00  +5.3%  [50%] (market)  ✎  🗑   [+ add TP] │
│ ─ Stop Loss ───────────────────────────────────────── │
│  ( Fixed | Trailing | Follow-TP )   188.00  −1.1%      │
│  ☑ Break-even on TP1 fill                              │
│ ─ Conditional (Algo) ──────────────────────────────── │
│  Trigger: ( Price ▾ )  AAPL  [ ≥ ]  [ 190.00 ]         │
│  "When AAPL ≥ 190 → BUY $500, TP 195/200, trail SL"    │
│ ────────────────────────────────────────────────────  │
│ [ Dry-run ]     gate: ALLOW ✓        [ Arm ] [ Execute ]│
└───────────────────────────────────────────────────────┘
```

---

## 17. Criterios de aceptación

- [ ] El chart dibuja líneas **Entry / TP(1..n) / SL / BE** con colores de token y son **arrastrables**;
      al soltar, ticket y R:R se recomputan.
- [ ] Side toggle **BUY/SELL** colorea con `actionClass` y valida direccionalidad de TP/SL.
- [ ] **Multiple TPs** exige Σ `size_pct = 100` y precios monótonos según el side.
- [ ] **Break-even** mueve el SL a `avg_entry_price(±fees)` al fill de TP1 (o al trigger de precio);
      se ve el cambio de estado `be_moved`.
- [ ] **Trailing SL** respeta `trailing_start` e `improve_only`.
- [ ] **Conditional order**: se crea, aparece en la pestaña *Conditional Orders* como `armed`, **no
      ejecuta** hasta el trigger, y no reserva balance antes.
- [ ] **Dry-run** devuelve el **plan completo de llamadas** (bracket + legs + condición), no una sola
      orden.
- [ ] Todo pasa por **gate → Arm → Execute**; `Kill` cancela armado/working/condicionales.
- [ ] Se respetan invariantes (§15): paper only, sin OHLCV al LLM, token de webhook redactado.
- [ ] **Cadencia** elegible por presets **y** custom (`N s/m/h` → `interval_seconds`, ≥ `MIN_INTERVAL_S`);
      ticks solapados se omiten.
- [ ] **Ventana** editable con inicio/fin `dd mm yyyy hh mm ss` en **UTC**; se rechaza `end ≤ start`.
- [ ] El chip del ticker muestra estado + cuenta atrás; **no** hay run antes de `window_start`; hay un
      run por tick dentro de ventana.
- [ ] Fuera de ventana, una **condicional** cuyo precio se cumple **no** ejecuta (bloqueada por el gate).
- [ ] Al llegar `window_end`: **parar + `cancel_armed()` + flatten** (reduce-only, paper), todo auditado.
- [ ] El schedule **sobrevive un reinicio** del backend (persistido en `schedule_settings`).

## 18. Cómo verificar (end-to-end, paper)

1. `bun install && bun run dev` en `tradelix-poc-web`; backend FastAPI en `:8000`.
2. En el ticket, armar un bracket BUY con TP1/TP2 + SL; **arrastrar** las líneas y ver R:R actualizarse.
3. **Dry-run**: confirmar `would_call[]` con `order_class=bracket` + leg limit del remanente.
4. Activar break-even on TP1; simular fill de TP1 (paper) y verificar que el SL salta a BE.
5. Crear una **conditional** `price ≥ X`; confirmar estado `armed`, balance libre, y que solo ejecuta
   al cruzar X (o al hacer `POST /webhook/{token}` para el modo webhook).
6. Pulsar **Kill** y verificar cancelación de todo lo pendiente.
7. **Scheduler**: en Options ▸ Schedule elegir cadencia `custom 30 s` y una ventana UTC corta que
   empiece en ~1 min y termine en ~3 min; **Save** + **Start**. Verificar en el chip la cuenta atrás.
8. Confirmar que **no** corre antes de `window_start`, que dispara un ciclo cada 30 s dentro de ventana,
   y que una condicional cuyo precio se cumple **fuera** de ventana no ejecuta.
9. Al llegar `window_end`: verificar en el blotter/audit que se **cancelaron** las condicionales y se
   **cerraron** las posiciones (flatten), y que el estado pasa a `ended`.
10. Reiniciar el backend a mitad de ventana y confirmar que el scheduler **reanuda** desde
    `schedule_settings`.

---

## 19. Fuera de alcance (evolución)

- Grid / DCA / Infinity-Trailing bots, copy-trading, VWAP/TWAP, iceberg (roadmap goodcryptoX).
- Order book L2, DEX/perps, multi-exchange (`account` real distinto de Alpaca).
- Persistencia de layouts / `react-resizable-panels`.

---

### Fuentes (mecánica de referencia goodcryptoX)

- [docs.goodcrypto.app — índice (llms.txt)](https://docs.goodcrypto.app/llms.txt)
- [Trailing stops (CEX)](https://docs.goodcrypto.app/sex-trading/manual-orders/trailing-stops.md)
- [Trailing stop loss & trailing take profit explained](https://goodcrypto.app/trailing-stop-loss-and-trailing-take-profit-orders-explained/)
- Alpaca order classes (bracket/OCO/trailing) y `--dry-run` — ver [`alpaca-mcp-information.md`](../../alpaca-mcp-information.md).
