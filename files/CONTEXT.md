# CONTEXT.md — Architecture & Rules Reference

**Read this before modifying order lifecycle logic, state transitions, or streaming I/O.**
All trading infrastructure must comply with Rules 1–12 (below) to prevent duplicate orders,
missed fills, and state corruption.

---

## 1. What This Project Is

A Binance USDT-M Futures trading bot that implements a **Mean Reversion DCA strategy**.
It places entries at progressively deeper deviation levels from a moving average, then
exits at a take-profit target (fixed or trailing). The PineScript in the repo is the
reference implementation — the Python code mirrors its logic.

**Key trading mechanics:**
- 6 DCA levels (L1–L6 for longs, S1–S6 for shorts) at increasing deviations from MA
- Position sizing: `balance × LEVEL_PCT × allocation × leverage / price`
- TP: weighted average entry price × (1 ± take_profit_pct)
- Optional trailing stop: activates at TP, closes on retrace from extreme
- Multi-bot: one bot per symbol, fleet managed by master process

---

## 2. Current Architecture (All Stages Complete)

```
master.py (single process, single event loop)
  ├── BinanceAsyncClient (one aiohttp session, trade key)
  ├── asyncio.Task per bot (run_bot coroutine, one per symbol)
  ├── AsyncMarkPriceStream  — combined WS, asyncio.Event for trailing stop
  ├── AsyncKlineStream      — combined WS, candle-close events
  ├── AsyncUserDataStream   — per-symbol asyncio.Queue for ORDER_TRADE_UPDATE fills
  └── Telegram (aiohttp polling)
```

**Entry**: GTC LIMIT orders at DCA levels. L1+S1 coexist when flat. First fill cancels opposite.
**Fills**: UserDataStream → `fill_queues[symbol]` → `process_fill_events()` (partial fill aware).
**TP**: REST poll reconciliation (cancel-replace when qty/price drifts).
**Trailing**: `AsyncMarkPriceStream.get_trailing_event()` → sub-second response.
**Exit**: All paths go through `_go_flat()` (clears trailing state, cancels entries, resets state).

### Architecture Refactoring (Stages 0–2, Complete)
- **Stage 0** ✅ Single-process asyncio, `BotConfig` dataclass, async client/streams
- **Stage 1** ✅ GTC LIMIT entries, UserDataStream fills, dynamic TP reconciliation
- **Stage 2** ✅ Sub-second trailing stop via mark price event, centralized `go_flat()`

### Broker Extraction & Backtest Readiness (Stages 3–7, Complete)
- **Stage 3** ✅ Extracted `Broker` class (1300 lines): all order lifecycle logic
  - bot.py reduced to ~260 lines (runtime loop + stream wiring only)
  - Broker depends ONLY on protocols.TradingClient/MarkPriceStream (zero concrete imports)
- **Stage 4** ✅ Event bus: TradeEventBus + LogSink, TelegramSink (non-blocking, crash-isolated)
- **Stage 5** ✅ MACD math: `calculate_macd()` + `calculate_macd_series()` in `strategy.py` (pure math, no side effects)
- **Stage 6** ✅ Regression tests: 186 tests covering Rules 1–13, State, Broker, EventBus, Stage 7, MACD exit
- **Stage 7** ✅ Upbit announcement risk + Short-Squeeze mode (replaces hedge mode)
  - `AsyncAggTradeStream`: 1s volume buckets; spike gated on: vol > threshold AND price up AND `state.upbit_risk=True`; fires even when flat (handler decides action); `_WS_BASE` derived from `BASE_URL` via `_WS_MAP` (testnet-safe); takes `symbol_states` dict ref
  - `SqueezeModeHandler` (bot.py): on `AnnouncementRiskDetected`: if SHORT → `broker.close_short_on_squeeze(spike_price)`; if flat → latch `squeeze_mode_active=True`, cancel pending S entries; on `UpbitListingConfirmed` → unsubscribe aggTrade + set `upbit_risk=False`
  - `Broker.close_short_on_squeeze()`: cancel pending SHORT entries, infer spike-filled levels from spike_price, save squeeze state, market-close entire SHORT, call `go_flat()`
  - `Broker.check_pseudo_fills()`: called every candle during squeeze; checks up to 2 levels beyond `squeeze_pre_close_level` (through S6); theoretical price = `squeeze_ma20_at_close × (1 + deviations[i])`; S6 uses `_SQUEEZE_S6_PCT` (24%) instead of `cfg.level_pct[5]` (0%)
  - `Broker.place_squeeze_reentry()`: single GTC LIMIT SELL at WMA(7) price; qty = `squeeze_contracts_closed + squeeze_pseudo_fill_qty`
  - `Broker.process_squeeze_reentry_fill()`: sets position state, adjusts TP for loss recovery (`tp_pct + loss/notional`), places next DCA, calls `state.clear_squeeze()`
  - `Broker.check_wma7_downtrend()`: two consecutive WMA(7) declines → returns 2 (requires `len(closes) >= wma7_period + 2`)
  - `UpbitConfirmationSink`: **passive upbit_risk manager** — `startup_check()` on boot queries Upbit, sets `state.upbit_risk` for all symbols, launches 30-min background re-check loop; on `True→False` transition emits `UpbitListingConfirmed`
  - `master.py` collects `symbol_states: dict[str, State]`, wires into `agg_stream` and `upbit_sink` after bot tasks created; awaits `upbit_sink.startup_check()`, then calls `agg_stream.filter_by_upbit_risk()`
  - **`upbit_risk` field** in `state.json`: `True` = NOT on Upbit (risk active), `False` = already listed (safe); NOT cleared by `state.reset()` — symbol-level property, not position state
  - **S6 squeeze-exclusive**: `_SQUEEZE_S6_PCT = 24.0` (broker.py constant); S6 is only placed during squeeze recovery (`squeeze_adjusted_tp_pct > 0`); `LEVEL_PCT_6=0.0` remains global default — S6 never fires in normal mode
  - **One-way position mode always** — `_pos_side()` always returns `None`; no LONG positions ever placed
  - `SHORT_SQUEEZE_ENABLED` is account-wide (`master.env`); **must be explicitly set to `true`** (see `master.env.example`)
  - **`squeeze_adjusted_tp_pct`** persists through `clear_squeeze()` — cleared only by `state.reset()` on flat exit

### MACD Exit Filter (Post-Stage 7, Complete)
- **`evaluate_macd_exit()`** in `broker.py`: mirrors PineScript lines 32-86 exactly
  - **ARM**: 5m histogram 2 consecutive moves favour position AND 15m MACD line confirms direction
  - **LATCH** (`macd_exit_latched=True`): arm fires → suppress TP (big divergence)
  - **UNLATCH**: 15m histogram flips → fall through to building check on same evaluation
  - **BUILDING**: 5m favor active but not latched → suppress TP (momentum building)
  - **NORMAL**: neither latched nor building → allow TP
  - S4+ always returns `"normal"` (intentional deviation from Pine — Pine gates on `disable_macd_exit_s4_s5` input). At S4+ the main loop also clears `macd_exit_latched` and `macd_exit_momentum_seen` — `fast_unlatch_check()` defers to the main loop here (Rule 14).
  - `momentum_seen` is informational only — logically redundant in Pine's `tp_allowed` formula
- **`MACD_EXIT_ENABLED=true`** in per-bot `.env` activates the filter
- **Entry gate removed** — `_macd_allows_entry()` and `macd_enabled` / `MACD_ENABLED` deleted; PineScript uses MACD as exit filter only, never as entry gate

### MACD WS Cache + Fast Latch/Unlatch (Option B, Complete)
- **Goal**: eliminate REST polling for MACD klines; sub-second latch AND unlatch detection via WS callbacks.
- **`broker.cached_macd_5m_closes` / `cached_macd_15m_closes`**: in-memory close lists kept fresh by kline WebSocket live callbacks in `bot.py`. Track last open_time per interval so each tick either updates the unclosed bar in place or appends a new bar (and trims to `macd_slow + macd_signal + 5`).
- **`broker.init_macd_caches()`**: one-time REST pre-population on startup (called from `bot.py` after the level cache init). No-op when MACD exit is disabled.
- **`broker._fetch_macd_closes()`**: now prefers cache; falls back to REST when cache is empty (early startup or unit tests using `FakeClient.klines_by_interval`) **or stale** (no WS update within `2 × interval` — detects WS outages). On REST fallthrough it **reseeds** cache + freshness timestamps so the live callback takes over next tick (self-heal — Rule 15). After warm-up with a live WS, `evaluate_macd_exit()` performs **zero REST calls per cycle**.
- **`broker.fast_unlatch_check()`**: sync, called from the 15m kline live callback. Mirrors **only** the unlatch portion of `evaluate_macd_exit()` (latched + 15m hist flips → unlatch). Returns True so the caller can `macd_unlatch_event.set()` to wake the main loop within ~1 tick.
- **`broker.fast_latch_check()`**: sync, called from the 5m kline live callback. Mirrors the ARM + LATCH portion of `evaluate_macd_exit()` (five_m_favor + fifteen_m_confirm + NOT hist_flipped → latch). S4+ deferred to main loop (Rule 14). Returns True so the caller can `macd_latch_event.set()` to wake the main loop within ~1 tick so TP is cancelled without waiting up to `poll_interval_sec`.
- **`evaluate_macd_exit()` building phase uses closed bars only**: `five_m_building = hist_5m[1] < hist_5m[0]` (SHORT) — does NOT include the unclosed bar (`hist_5m[2]`) to prevent intra-bar oscillation causing TP place/cancel churn. The arm/latch condition continues to use the full 3-bar chain including the unclosed bar (handled sub-second by `fast_latch_check()`).
- **`evaluate_macd_exit()` decision-flip logging**: `broker._macd_last_decision` tracks the last returned decision. A single INFO line is emitted on every `suppress ↔ normal` transition, identifying the reason (latched / building / normal) so each TP cancel/repost has a log explanation.
- **`bot.py` wiring**: `_on_macd_5m_tick` updates 5m cache AND calls `fast_latch_check()`; `_on_macd_15m_tick` updates 15m cache AND calls `fast_unlatch_check()`. Main loop `wait_tasks` includes both `macd_latch_event.wait()` and `macd_unlatch_event.wait()` — either event wakes the loop sub-second.
- **`stream.py` AsyncKlineStream`**: callbacks now keyed by `(symbol, interval)`; new `register_live_callback() / unregister_live_callback()` fire on **every** kline message (intra-bar + close). Old `register_callback()` still fires only on closed bars and now requires the interval argument.
- **`master.py`**: auto-adds `(symbol, "5m")` and `(symbol, "15m")` to the kline stream's `symbol_intervals` for any MACD-enabled bot whose main interval differs.
- **Backtest path**: tests construct `Broker` directly, set `broker.cached_macd_*_closes = [...]`, and call `fast_latch_check()` / `fast_unlatch_check()` synchronously.
- **MACD monitoring cadence summary**:
  | Signal | Path | Latency |
  |---|---|---|
  | Price cache updates | WS live callback → `cached_macd_*_closes` | ~100-500ms |
  | Latch (arm fires) | `fast_latch_check()` from 5m WS tick → `macd_latch_event` | **sub-second** |
  | Unlatch (15m hist flip) | `fast_unlatch_check()` from 15m WS tick → `macd_unlatch_event` | **sub-second** |
  | Building / S4+ / fallback | `evaluate_macd_exit()` main loop | `poll_interval_sec` (15s) |
  | S4+ latch clear | `evaluate_macd_exit()` main loop only (Rule 14) | up to 15s |

### MACD ↔ Short-Squeeze Interaction (Complete)
- **MACD stays active during `upbit_risk=True`**: counter-intuitive but correct. When spike risk is live there are no guaranteed fills (the spike is too ferocious to cancel a S1/L1 in time), so the *favourable* policy is to keep MACD's exit suppression on — it widens the exit window into the danger zone deliberately.
- **`process_squeeze_reentry_fill()` clears MACD latch**: `clear_squeeze()` does NOT touch `macd_exit_latched` / `macd_exit_momentum_seen` (those are MACD-owned, not squeeze-owned). On a squeeze re-entry fill, the new SHORT could otherwise inherit a stale latch from a 15m bar that's now an hour+ in the past — which would silently suppress the loss-recovery TP set on the same fill. The re-entry handler now clears both flags right after `clear_squeeze()` runs (Rule 14).
- **MACD bypassed during squeeze recovery**: squeeze pseudo-fills push `open_trades` to S4+, where `evaluate_macd_exit()` always returns `"normal"`. This is intentional — the loss-recovery TP must run regardless of momentum.
- **Cancel-vs-squeeze ordering is benign**: asyncio is single-threaded; if MACD's `cancel_exit()` and `close_short_on_squeeze()` interleave at await boundaries, both orderings produce a valid terminal state (Rule 2 covers the empty `exit_order_id` case).

### Audit Round 2 — MACD WS Cache + Fast Unlatch Hardening (Complete)
Follow-up audit after Option B landed, scoped to edge-case vulnerabilities of the
same nature as the original findings (stale state, await-boundary races, callback
safety, cache freshness, init ordering). Findings and fixes:

- **HIGH 1 — Cache self-heal**: if `init_macd_caches()` failed at startup the cache
  stayed empty forever because `_macd_update_cache()` bails on empty lists — every
  cycle silently fell through to REST. `_fetch_macd_closes()` now reseeds
  `cached_macd_*_closes`, `_last_macd_*_open_time`, **and** `_last_macd_*_update_ts`
  on any successful REST fallthrough, so the live callback resumes incremental
  updates from the next tick onward.
- **HIGH 2 — Stale cache on WS outage**: `AsyncKlineStream` reconnects with a 5s
  sleep, but longer outages would freeze the cache and let `evaluate_macd_exit()`
  read stale histograms silently. Added `_last_macd_5m_update_ts` /
  `_last_macd_15m_update_ts` stamped on every live callback tick (including empty
  cache), plus `_MACD_STALE_SECS = {"5m": 600, "15m": 1800}` gate in
  `_fetch_macd_closes()`: any read of a cache older than `2 × interval` triggers a
  REST reseed with a `WARNING` log.
- **MEDIUM 3 — Callback exceptions silenced**: `stream.py` was logging live and
  close callback exceptions at `logger.debug` — upgraded to `logger.exception` with
  symbol/interval context. A hidden exception in `fast_unlatch_check()` used to
  kill the sub-second unlatch path with no operator signal.
- **LOW 4 — `macd_exit_tp_level` not cleared on squeeze re-entry**: vestigial
  field, no current reader, but cleared inconsistently elsewhere.
  `process_squeeze_reentry_fill()` now clears it alongside `macd_exit_latched` and
  `macd_exit_momentum_seen` for consistency.

New tests: `TestMACDCacheSelfHeal` class in `tests/test_macd_exit.py` covers REST
reseed on empty cache, forced reseed on stale cache, fresh cache hit under
threshold, and `init_macd_caches()` stamping freshness timestamps.

Codified as **Rule 15**.

### Audit Round 3 — Rule 2 Violations in Order-Replacement Paths (Complete)
Targeted audit across the full order lifecycle (broker.py, bot.py, state.py, stream.py,
master.py, event_bus.py, upbit_sink.py) for severe edge-case bugs of the same nature
as the flat-spike squeeze lockup — failures that silently lose order tracking or
leave state machines stuck.

Two HIGH findings, both real Rule 2 violations in cancel-then-replace paths:

- **HIGH 1 — `reconcile_tp` overwrites preserved `exit_order_id`**
  (`broker.py:319-361`). `reconcile_tp()` called `cancel_exit()` and then
  unconditionally proceeded to `place_limit_close()`, writing the new oid over
  `state.exit_order_id` at the end. But `cancel_exit()` is Rule 2-compliant — on
  unknown failure it **preserves** the old oid. The overwrite silently orphaned a
  potentially-live exit order on the exchange. The `-2022` adoption branch caught
  only the case where Binance rejected the second placement; if Binance accepted
  both, the result was two reduceOnly orders live with tracking for only one,
  enabling over-close on the next position.
  **Fix:** after `cancel_exit()`, bail with a warning if `state.exit_order_id is
  not None`, retrying next cycle.

- **HIGH 2 — `reconcile_pending` clears tracking on failed premature-DCA cancel**
  (`broker.py:1050-1066`). The startup "premature DCA" cancel loop caught cancel
  exceptions but still called `state.clear_pending_order(label)` outside the
  try/except. On a network blip the order stayed live on the exchange while the
  bot forgot about it — classic orphan-order risk, and if it later filled, open
  trades / position size / tp_level drifted silently away from the exchange.
  **Fix:** `continue` on cancel failure (preserving tracking). Only clear on
  confirmed cancel success.

Audit also verified (no findings, documented here so future audits don't re-check):
- `macd_exit_momentum_seen` is logging-only (CONTEXT.md explicit) — no race at S4+
  between `fast_unlatch_check()` and the main loop's S4+ bypass block.
- `fast_unlatch_check()` explicitly bails at `open_trades >= 4`, so the "S4+
  unlatch race" is impossible.
- `process_squeeze_reentry_fill()` is idempotent on restart — `poll_pending_fills`
  re-checks `squeeze_reentry_oid`, and reprocessing overwrites position state with
  the same values (same fill_qty/fill_price), `clear_squeeze()` is a no-op the
  second time.
- Event bus sink crash isolation is correct (`event_bus.py:126-130`): sink
  exceptions are logged via `logger.exception` and the consumer task continues.
- `go_flat()` clears trailing before any await (Rule 8).
- `cancel_entry()` correctly preserves tracking on Rule 2 unknown outcomes.
- `place_initial_entries()` only places L1/S1 when `cancel_ok.get(label, True)` —
  failed cancels block replacement.

Codified as **Rule 16** below.

### Rule 16: Cancel-then-replace paths MUST check the cancel outcome
Any function that cancels an order and then places a replacement must **verify
the cancel succeeded** before proceeding. `cancel_exit()` and `cancel_entry()`
both preserve tracking on Rule 2 unknown failures — writing a fresh oid on top
without checking orphans a potentially-live exchange order.

Pattern (correct):
```python
if state.exit_order_id:
    await self.cancel_exit()
    if state.exit_order_id is not None:
        return  # preserved by Rule 2 — retry next cycle
# safe to place replacement
```

Pattern (INCORRECT — Rule 16 violation):
```python
if state.exit_order_id:
    await self.cancel_exit()
# unconditionally place new, overwriting tracking
state.exit_order_id = new_oid
```

Same pattern applies to `cancel_order()` call sites in reconciliation loops: if
the cancel raises, `clear_pending_order()` / `pop()` must be skipped so the order
remains visible to future cycles.

### Vulnerability Fixes (Post-Stage 7, Complete)
- **`cancel_exit()` Rule 2 alignment**: `exit_order_id` cleared only after confirmed cancel or -2011; preserved on unknown failure — bot retries next cycle
- **Squeeze reentry terminal status**: WS and REST poll paths both handle `CANCELED`/`EXPIRED`/`REJECTED` by clearing `squeeze_reentry_oid` so squeeze can recover
- **Squeeze cumulative loss**: `close_short_on_squeeze()` queries position after market close to get actual fill price; computes `squeeze_cumulative_loss` and `squeeze_avg_close_price` for loss-recovery TP
- **Open**: squeeze re-entry repricing (Finding #3) — no reprice/reconcile loop yet

**Backtest-Readiness**: Broker now mockable without exchange I/O. To backtest:
1. Create `MockClient` implementing `protocols.TradingClient`
2. Create `MockMarkStream` implementing `protocols.MarkPriceStream`
3. Instantiate `Broker(mock_client, state, config, mock_mark_stream)`
4. Drive `broker.place_entry()`, `broker.process_fill()`, etc. with historical data

---

## 3. File Structure

```
├── master.py           # Orchestrator: discovers bots, spawns tasks, shared streams
├── bot.py              # ~260 lines: runtime loop + stream wiring (Stage 3: slimmed)
├── broker.py           # ~1300 lines: order lifecycle logic, DCA progression, state transitions
├── client.py           # Binance REST client (async, uses protocols.TradingClient)
├── stream.py           # WebSocket streams (implements protocols.MarkPriceStream, etc.)
├── strategy.py         # Pure math: MA (5 types), DCA levels, rounding, MACD filter
├── state.py            # Persistent JSON state per bot (atomic writes, validation)
├── config.py           # BotConfig dataclass + validate()
├── protocols.py        # Structural protocols for TradingClient, AggTradeStream, etc.
├── events.py           # Dataclass event types (EntryFilled, ExitFilled, AnnouncementRiskDetected, etc.)
├── event_bus.py        # TradeEventBus + LogSink, TelegramSink; subscribe_dynamic() (Stage 7)
├── agg_trade_stream.py # Stage 7: @aggTrade WS; spike gated on upbit_risk (fires even when flat); _WS_BASE from base_url
├── upbit_sink.py       # Stage 7: UpbitConfirmationSink (startup check, 30-min bg poll); passive upbit_risk manager
├── log_router.py       # Per-symbol log files + agg_irregularities.log; wired via attach_routers() in master._setup_logging()
├── telegram_bot.py     # Telegram control: /status, /stop, /help
├── master.env          # Master credentials (trade key), LEVEL_PCT, BOTS_DIR, SHORT_SQUEEZE_ENABLED
├── master.env.example  # Template for master.env — includes all Stage 7 knobs
├── .env.example        # Per-bot config template
├── PineScript.pine     # Reference TradingView strategy (read-only, never modify)
├── tests/
│   ├── test_strategy.py           # 61 tests: MA functions, MACD, levels, rounding
│   ├── test_state.py              # State transitions: flat → positioned → flat
│   ├── test_broker.py             # 27 tests: order lifecycle, Rules 1–12 coverage
│   ├── test_event_bus.py          # Event delivery, isolation, sink safety
│   ├── test_squeeze_mode.py        # 31 tests: Stage 7 spike/squeeze/pseudo-fill/reentry/S6-exclusive/Upbit
│   ├── test_macd_exit.py          # 41 tests: MACD exit latch/unlatch/building, vuln fixes (cancel_exit, squeeze terminal status, loss computation)
│   ├── fake_client.py             # FakeClient + FakeMarkStream stubs
│   └── __init__.py
├── bots/
│   ├── BTCUSDT/
│   │   ├── .env        # Per-bot config (symbol, leverage, MA, TP, MACD, etc.)
│   │   └── state.json  # Persistent position/order state
│   ├── ETHUSDT/
│   │   ├── .env
│   │   └── state.json
│   └── .../
└── update_bots.sh      # Deploy helper: rsync bot.py/stream.py to each bot dir
```

---

## 4. Critical Rules — NEVER Violate These

These rules come from hard-won production bugs documented in `session-history.md`.
Violating any of them will cause the same bugs to recur.

### Rule 1: Never clear `pending_entry_orders` in periodic functions
`sync_state()` and `manage_entry_limits()` run every poll cycle or every candle.
Clearing `pending_entry_orders` here destroys tracking for live exchange orders,
causing duplicate orders to stack (60+ orders incident). Only clear on:
- One-time startup cleanup (before main loop)
- Confirmed position close via `_go_flat()` / `state.reset()`

### Rule 2: Never clear order tracking on unknown/failed outcomes
If a cancel call fails, times out, or returns an unexpected status — **preserve
tracking**. The order may still be live on the exchange. Clearing tracking and
placing a new order creates duplicates. Retry the cancel on the next cycle.

### Rule 3: Handle the cancel-then-fill race (V2)
When canceling an order that may have filled between the cancel request being
sent and arriving at the exchange: check the order status after a failed cancel.
If FILLED, preserve tracking so the UserDataStream fill event can still match.

### Rule 4: Handle simultaneous L1+S1 fills (V4 whipsaw)
Both sides can fill in a fast whipsaw. After canceling the opposite side on
first fill, verify the cancel succeeded. If the opposite was already filled,
market-close the unwanted side immediately.

### Rule 5: Handle partial-fill-then-cancel (V5)
Binance can partially fill then cancel the remainder (self-trade prevention).
The UserDataStream must forward CANCELED events when `accumulated_qty > 0`.
Treat these as complete fills for DCA progression.

### Rule 6: Pre-populate cached levels before processing fills (V3)
`cached_long_levels` and `cached_short_levels` must be populated from the
initial candle fetch BEFORE the main loop processes any fill events. Otherwise
fill events arrive but DCA placement fails because levels are empty.

### Rule 7: Use `state.position_side is None` for flat checks
The State class has no `in_position` property. Always use
`state.position_side is None` and `state.open_trades == 0`.

### Rule 8: Always include `mark_stream` when going flat
`_go_flat()` must clear the mark price stream's trailing state. Without this,
the stream keeps firing trailing stop events for a flat bot.

### Rule 9: `sync_state()` returns True for flat — caller calls `_go_flat()`
`sync_state()` does not have access to `last_tp` or `mark_stream`. It returns
True to signal the main loop to call `_go_flat()` where those are in scope.

### Rule 10: `strategy.py` functions take explicit parameters
After Stage 0, `calculate_ma()`, `calculate_long_levels()`, and
`calculate_short_levels()` accept `ma_type`, `ma_period`, `deviations` as
params — NOT read from module globals. Always pass from `BotConfig`.

### Rule 11: Parallel `asyncio.gather()` calls use `save=False`
When multiple coroutines modify `state` in parallel (e.g., cancel L1 + S1),
pass `save=False` and do a single `state.save()` after the gather completes.
Prevents interleaved partial saves at await boundaries.

### Rule 12: Disabled levels (LEVEL_PCT=0) must be guarded everywhere
`_place_entry_limit()`, `_verify_dca_limit_exists()`, and `compute_entry_qty()`
all must check `level_pct[index] <= 0` and skip. Otherwise disabled levels
trigger silent failures and retry spam every candle.

### Rule 13: WMA(7) is the squeeze re-entry gate — never bypass it
The squeeze re-entry limit order is only ever placed via `Broker.place_squeeze_reentry()`,
triggered by 2 consecutive WMA(7) declines (`check_wma7_downtrend()` returns 2).
Do not place re-entry orders from `UpbitListingConfirmed` or any other event.
`squeeze_mode_active` blocks all new SHORT entries until `state.clear_squeeze()` runs
after the re-entry fill — this is the only path back to normal DCA.

### Rule 14: Squeeze re-entry must clear MACD latch carried over from pre-spike
`clear_squeeze()` does NOT touch `macd_exit_latched` or `macd_exit_momentum_seen` —
those flags live outside squeeze state. `process_squeeze_reentry_fill()` clears both
flags right after `clear_squeeze()` so the loss-recovery TP set on the new SHORT is
not silently suppressed by a stale latch from a 15m bar that's now hours in the past.
Similarly, `fast_unlatch_check()` defers to `evaluate_macd_exit()` at S4+ — it must
NOT clear the latch there because the main loop also clears `macd_exit_momentum_seen`
on the same code path, and duplicating it in the WS callback would split the
clearing logic across two places.

### Rule 15: MACD WS cache must self-heal and must never serve stale data
The Option B MACD cache (`cached_macd_5m_closes`, `cached_macd_15m_closes`) has two
failure modes the live callback alone cannot recover from:

1. **Init failure** — if `init_macd_caches()` errors on a REST call at startup, the
   cache stays empty and the live callback bails forever on `if not closes: return`.
2. **WebSocket outage** — if the kline stream disconnects for longer than
   `2 × interval`, no live callbacks fire, the cache freezes, and `evaluate_macd_exit()`
   would silently read stale histograms and make wrong latch/unlatch decisions.

`broker._fetch_macd_closes()` defends against both:
- It tracks `_last_macd_5m_update_ts` / `_last_macd_15m_update_ts` (monotonic wall
  clock), stamped by **every** live callback tick (even when the cache is empty —
  so the staleness gate knows the WS is alive).
- It treats a cache with `now - last_ts >= _MACD_STALE_SECS[interval]` as cold and
  forces a REST reseed.
- On successful REST fall-through it **reseeds** `cached_macd_*_closes`,
  `_last_macd_*_open_time`, and `_last_macd_*_update_ts` so the live callback can
  resume incremental updates next tick — this self-heals both failure modes.
- Any new code that manipulates the MACD caches must update the freshness timestamp
  and go through `_fetch_macd_closes()` for reads — never read the cache attributes
  directly in decision-making code without the staleness gate.

Additionally: live-callback exceptions in `stream.py` are logged with
`logger.exception(...)` — **never** downgrade them to `debug`. A silenced live
callback means the MACD fast-unlatch path has stopped working and the operator
has no signal.

---

## 5. Key Data Structures

### `BotConfig` (dataclass — one per bot task)
```python
@dataclass
class BotConfig:
    symbol: str              # "BTCUSDT"
    interval: str            # "5m"
    leverage: int            # 5
    margin_type: str         # "CROSSED"
    enable_long: bool
    enable_short: bool
    ma_type: str             # "WMA"
    ma_period: int           # 20
    deviations: list[float]  # [0.013, 0.075, 0.133, 0.211, 0.337, 0.54]
    take_profit_long_pct: float   # 0.02
    take_profit_short_pct: float  # 0.02
    trailing_enabled: bool
    trailing_distance_pct: float  # 0.01
    manual_long_price: float      # 0 = use MA-derived
    manual_short_price: float
    poll_interval_sec: int        # 15
    state_file: str               # "bots/BTCUSDT/state.json"
    level_pct: list[float]        # [2.0, 4.0, 6.0, 13.0, 17.0, 0.0] from master.env
    allocation: float             # 1.0 / N bots
    exchange_info: dict           # cached from get_exchange_info()
    # MACD exit filter (per-bot .env — MACD_EXIT_ENABLED)
    macd_exit_enabled: bool = False
    macd_fast:    int  = 12
    macd_slow:    int  = 26
    macd_signal:  int  = 9
    # Stage 7: Short-Squeeze mode (master.env overrides per-bot values)
    squeeze_mode_enabled: bool    = False
    announce_vol_threshold_usdt: float = 200_000.0
    announce_wma_period: int      = 7
```

### `State` (persisted to state.json — one per bot task)
```python
{
    "open_trades": 0,              # 0–6, completed DCA levels
    "position_side": null,         # null | "LONG" | "SHORT"
    "position_size": 0.0,          # base-asset qty, always ≥ 0
    "avg_entry_price": 0.0,        # weighted average across all fills
    "tp_level": 0.0,               # computed from avg_entry × (1 ± tp_pct)
    "trailing_active": false,
    "trailing_extreme": 0.0,
    "last_candle_ts": 0,           # open_time of last processed candle
    "exit_order_id": null,         # clientOrderId of active TP order
    "locked_allocation": null,     # preserved across restarts for open positions
    "pending_entry_orders": {},    # Stage 1: tracked limit orders
    "active_limit_ids": {},        # Stage 1: reverse lookup oid → label
    "dca_levels": [null, null, null, null, null],        # legacy, may be removed
    "dca_levels_short": [null, null, null, null, null],  # legacy, may be removed
    # Stage 7: Short-Squeeze mode (NOT cleared by state.reset(); persist across flat)
    "squeeze_mode_active": false,          # True = blocks new S entries; awaiting re-entry
    "squeeze_contracts_closed": 0.0,       # qty closed at spike (incl. inferred fills)
    "squeeze_avg_close_price": 0.0,        # filled by market close fill event
    "squeeze_cumulative_loss": 0.0,        # realized loss USDT
    "squeeze_wma7_at_close": 0.0,          # WMA(7) at spike time (informational)
    "squeeze_ma20_at_close": 0.0,          # MA(20) frozen at spike — pseudo-fill basis
    "squeeze_balance_at_close": 0.0,       # account balance at spike — pseudo-fill qty basis
    "squeeze_pre_close_level": 0,          # open_trades at spike time
    "squeeze_pseudo_fill_count": 0,        # pseudo-fill levels crossed during squeeze
    "squeeze_pseudo_fill_qty": 0.0,        # cumulative qty from pseudo-fills
    "squeeze_reentry_oid": null,           # clientOrderId of single re-entry LIMIT SELL
    "squeeze_adjusted_tp_pct": 0.0,        # > 0 overrides normal tp_short_pct until exit
    # upbit_risk: True = NOT on Upbit (spike risk active)
    #             False = already listed on Upbit (safe)
    # Set by UpbitConfirmationSink startup/bg check; NOT cleared by state.reset()
    "upbit_risk": true,
}
```

### `pending_entry_orders` structure
```python
{
    "L1": {
        "client_order_id": "MR-B1-1700000000000",
        "side": "BUY",
        "price": 85000.0,
        "original_qty": 0.010,
        "filled_qty": 0.003,       # accumulated partial fills
        "avg_fill_price": 85000.0, # weighted average
        "level_index": 0,          # 0–5
        "direction": "LONG",
        "status": "NEW",           # "NEW" | "PARTIALLY_FILLED" | "FILLED"
    },
    "S1": { ... }                  # can coexist with L1 when flat
}
```

### `active_limit_ids` — reverse lookup for fill matching
```python
{"MR-B1-1700000000000": "L1", "MR-S1-1700000000001": "S1"}
```

---

## 6. Binance API Reference (frequently used)

### REST endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/fapi/v1/klines` | OHLCV candle data |
| GET | `/fapi/v1/premiumIndex` | Mark price |
| GET | `/fapi/v3/positionRisk` | Current position (signed) |
| GET | `/fapi/v3/balance` | USDT balance (signed) |
| GET | `/fapi/v1/exchangeInfo` | Symbol filters (LOT_SIZE, PRICE_FILTER) |
| GET | `/fapi/v1/order` | Query order by origClientOrderId (signed) |
| GET | `/fapi/v1/openOrders` | List open orders (signed) |
| POST | `/fapi/v1/order` | Place order (signed) |
| DELETE | `/fapi/v1/order` | Cancel order (signed) |
| DELETE | `/fapi/v1/allOpenOrders` | Cancel all open orders (signed) |
| POST | `/fapi/v1/listenKey` | Create User Data Stream key (signed) |
| PUT | `/fapi/v1/listenKey` | Keepalive listenKey (signed) |
| POST | `/fapi/v1/leverage` | Set leverage (signed) |
| POST | `/fapi/v1/marginType` | Set margin type (signed) |

### WebSocket streams
| Stream | URL pattern | Purpose |
|--------|-------------|---------|
| Mark price | `wss://fstream.binance.com/stream?streams=btcusdt@markPrice` | Real-time mark price |
| Kline | `wss://fstream.binance.com/stream?streams=btcusdt@kline_5m` | Candle close events |
| User Data | `wss://fstream.binance.com/ws/<listenKey>` | ORDER_TRADE_UPDATE fills |
| Agg Trade | `wss://fstream.binance.com/stream?streams=btcusdt@aggTrade` | Tick-level trades (Stage 7) |

### ORDER_TRADE_UPDATE fields
```
o.s  = symbol            o.c  = clientOrderId
o.S  = side (BUY/SELL)   o.o  = order type (LIMIT/MARKET)
o.q  = original qty      o.p  = order price
o.X  = order status       o.l  = last filled qty (THIS trade)
o.L  = last filled price  o.z  = accumulated filled qty
o.Z  = accumulated quote  o.T  = trade time
```

### Common error codes
| Code | Meaning | Handling |
|------|---------|----------|
| -2011 | Unknown order | Order already canceled/filled — clear tracking |
| -4028 | Cannot change with open position | Graceful skip (leverage/margin type) |
| -4046 | Margin type already set | Graceful skip |
| -4059 | Position mode already set | Graceful skip |

### Endpoint mapping (REST → WebSocket)
| REST base URL | WebSocket base |
|---------------|----------------|
| `https://fapi.binance.com` | `wss://fstream.binance.com` |
| `https://demo-fapi.binance.com` | `wss://fstream.binance.com` |
| `https://testnet.binancefuture.com` | `wss://stream.binancefuture.com` |

---

## 7. Completed Stage Summary

All stages complete on the `Limit-and-MACD` branch. 186 tests passing.

| Stage | Focus | Key additions |
|-------|-------|---------------|
| 0 | Asyncio migration | `BotConfig` dataclass, async client/streams, single event loop |
| 1 | Limit entries + dynamic TP | `AsyncUserDataStream`, `pending_entry_orders`, `manage_entry_limits`, `reconcile_tp_order` |
| 2 | Exit refinement | Sub-second trailing via `AsyncMarkPriceStream.get_trailing_event()`, centralized `_go_flat()`, `sync_state()` reconciliation |
| 3 | Broker extraction | `Broker` class, bot.py slimmed to ~260, `protocols.py` |
| 4 | Event bus | `TradeEventBus`, `LogSink`, `TelegramSink`, pub/sub event routing |
| 5 | MACD math | `calculate_macd()` + `calculate_macd_series()` in strategy.py (pure math) |
| 6 | Regression tests | 186 tests covering Rules 1–13, `FakeClient`, `FakeMarkStream` |
| 7 | Short-Squeeze mode | `AsyncAggTradeStream`, `UpbitConfirmationSink` (passive), `SqueezeModeHandler`, `close_short_on_squeeze()`, `check_pseudo_fills()`, `place_squeeze_reentry()`, WMA(7) re-entry gate |
| Vuln | Security/safety review | Upbit poll flow hardened, duplicate wma() removed, testnet WS URL fixed; `cancel_exit()` Rule 2 alignment; squeeze reentry terminal status handling |
| Post | Upbit risk + logging | `upbit_risk` state field; spike fires even when flat; startup+30-min Upbit check; `log_router.py` per-symbol logs |
| Squeeze | Hedge → Short-Squeeze | Removed hedge mode entirely; one-way position mode; pseudo-fill tracking; loss-recovery TP; `squeeze_adjusted_tp_pct` persists through `clear_squeeze()` |
| MACD-exit | PineScript MACD exit parity | `evaluate_macd_exit()` latch/unlatch/building mirrors Pine lines 32-86; entry gate (`_macd_allows_entry`, `macd_enabled`) removed; `MACD_EXIT_ENABLED` per-bot |

---

## 8. Testing Principles

- **Always verify fill events arrive** before testing any fill-dependent logic.
  The V6 incident (zero fill events for days) taught us: confirm the pipe works
  before building on top of it.
- **Check exchange state after every operation**, not just local state. The bot's
  view can drift from reality (partial fills, external cancels, manual intervention).
- **Log aggressively** during testing. Every order placement, cancel, fill event,
  and state transition should appear in logs with symbol, label, oid, qty, and price.
- **Test with 2+ bots** to verify the shared UserDataStream dispatches correctly
  by symbol and that parallel `asyncio.gather()` calls don't interfere across bots.

---

## 9. What NOT to Modify

- **`PineScript.pine`** — Reference strategy. Read-only. Never edit.
- **`bots/SYMBOL/.env`** — Per-bot config. The code reads these; don't change their format without updating `BotConfig.from_env_file()`.
- **`bots/SYMBOL/state.json`** — The bot manages this. Manual edits are allowed for debugging but must match `_DEFAULTS` schema.
- **`strategy.py` core math** — `sma()`, `ema()`, `wma()`, `rma()`, `hma()`, `round_qty()`, `format_qty()`, `format_price()` are battle-tested. Only change the dispatch wrappers (`calculate_ma`, `calculate_long_levels`, `calculate_short_levels`) to accept params.
