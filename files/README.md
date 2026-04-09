# Trading Bot — Binance USDT-M Futures Mean Reversion DCA

A production-grade Python trading bot implementing a **mean reversion dollar-cost averaging (DCA) strategy** on Binance USDT-M Futures. Designed for active development and backtesting with comprehensive safety mechanisms, logging, and test coverage.

## Key Features

- **Mean Reversion DCA**: 6 configurable DCA levels (L1–L6 for longs, S1–S6 for shorts) at increasing deviations from a 20-period moving average
- **GTC LIMIT Orders**: Good-till-canceled limit entries; first fill cancels opposite side
- **Dynamic TP Management**: Weighted average entry price × (1 ± take_profit_pct), with REST reconciliation
- **Sub-Second Trailing Stop**: Mark price event-driven exit; respects candle-close trading rules
- **MACD Exit Filter** (optional): PineScript-synchronized latch/unlatch mechanism suppresses TP during momentum divergences
- **Short-Squeeze Protection**: Detects Upbit announcement spikes via aggTrade volume; closes SHORT positions automatically, locks in loss-recovery reentry via WMA(7) downtrend gate
- **Async/Await Architecture**: Single event loop, non-blocking order/stream I/O, asyncio-based
- **Comprehensive Logging**: Segregated logs (master, per-symbol, irregularities); structured event bus with Telegram sink
- **Backtest-Ready Broker**: Broker class depends only on abstract protocols; MockClient enables historical simulation
- **186+ Regression Tests**: Rules 1–16 coverage, 221 total tests (~0.6s runtime)

## Architecture Overview

```
master.py (single asyncio event loop)
├── BinanceAsyncClient (one aiohttp session, trade key + listen key)
├── Bot Task per Symbol (run_bot coroutine, one per symbol)
│   ├── Entry: Place GTC LIMIT orders at DCA levels
│   ├── Fill: UserDataStream → asyncio.Queue → process_fill_events()
│   ├── TP: REST reconciliation (cancel-replace on drift)
│   └── Exit: Trailing stop via mark price or manual close
├── AsyncMarkPriceStream (combined WS: 1s, 1000 symbols)
├── AsyncKlineStream (combined WS: 1m + 5m + 15m, per-symbol callbacks)
├── AsyncUserDataStream per Symbol (ORDER_TRADE_UPDATE fills)
├── AsyncAggTradeStream (1s buckets; short-squeeze spike detection)
├── Broker (1300 lines: order lifecycle, state management, MACD logic)
├── Event Bus (TradeEventBus: async event delivery, LogSink, TelegramSink)
└── Upbit Confirmation Sink (passive upbit_risk state manager)
```

**All persistent state is in `state.json`** (per symbol); order IDs and fill tracking survive restarts.

## Quick Start

### Prerequisites
- Python 3.10+
- Binance account with USDT-M Futures enabled (testnet or live)
- Telegram bot token (optional, for alerts)

### Installation

```bash
# Clone or navigate to the project directory
cd /home/admin/Development

# Install dependencies
pip install -r requirements.txt

# Create master.env from template
cp master.env.example master.env
```

### Configuration

Edit `master.env`:

```env
# Binance API (testnet: https://testnet.binance.vision)
BASE_URL=https://fapi.binance.com
WS_BASE_URL=wss://fstream.binance.com

# API Keys (from Binance — NEVER commit)
TRADE_KEY=your_api_key
TRADE_SECRET=your_secret

# Telegram (optional)
TELEGRAM_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Feature Flags
SHORT_SQUEEZE_ENABLED=false  # Enable Short-Squeeze protection (set true to activate)
MACD_EXIT_ENABLED=true       # Enable MACD exit filter per-bot

# Logging
LOG_DIR=logs

# Master process
POLL_INTERVAL_SEC=15
```

### Per-Bot Configuration

Each symbol gets a `.env` file in the `configs/` directory. Example: `configs/BTCUSDT.env`

```env
SYMBOL=BTCUSDT
BASE_ASSET_QTY=1.0
ALLOCATION=0.5
LEVERAGE=10
TAKE_PROFIT_PCT=2.5
TRAILING_STOP_ENABLED=true
TRAILING_STOP_ACTIVATION_PCT=1.5
TRAILING_STOP_RETRACE_PCT=0.8

# DCA Level Percentages (as % of account balance per level)
LEVEL_PCT_1=1.0
LEVEL_PCT_2=2.0
LEVEL_PCT_3=4.0
LEVEL_PCT_4=8.0
LEVEL_PCT_5=16.0
LEVEL_PCT_6=0.0        # S6 reserved for squeeze recovery only

# Mean Reversion Deviations (% from MA20)
DEVIATION_1=1.0
DEVIATION_2=2.0
DEVIATION_3=4.0
DEVIATION_4=8.0
DEVIATION_5=16.0
DEVIATION_6=32.0

# MACD Exit (if MACD_EXIT_ENABLED=true)
MACD_EXIT_ENABLED=true

# Log Level
LOG_LEVEL=INFO
```

### Run the Bot

```bash
# Start the trading bot (all symbols in configs/)
python master.py

# For testnet development, edit master.env first:
# BASE_URL=https://testnet.binance.vision
# WS_BASE_URL=wss://stream.testnet.binance.vision:9443
```

The bot will:
1. Load all `configs/*.env` files
2. Initialize state from `state.json` files
3. Connect WebSocket streams (mark price, klines, user data, aggTrade)
4. Begin placing entries at DCA levels
5. Log fills, cancellations, and state transitions to `logs/`

## Testing

```bash
# Run all tests (221 tests, ~0.6s)
pytest tests/ -v

# Run specific test suite
pytest tests/test_broker.py -v        # Order lifecycle, Rules 1–12
pytest tests/test_macd_exit.py -v     # MACD latch/unlatch, cache freshness
pytest tests/test_squeeze_mode.py -v  # Spike detection, pseudo-fill reentry
pytest tests/test_state.py -v         # State transitions
pytest tests/test_strategy.py -v      # MA, MACD math, rounding
pytest tests/test_event_bus.py -v     # Event delivery, sink isolation
```

## Safety & Risk Management

### Critical Rules (Must Read Before Modifying)

**Rule 1: Never clear `pending_entry_orders` in periodic functions**
- Order tracking is the source of truth for live orders on the exchange
- Only clear after a confirmed fill or successful cancel
- Periodic reconciliation may call `cancel_order()` — results are persisted to state

**Rule 2: Preserve order tracking on unknown/failed cancel outcomes**
- `cancel_exit()` and `cancel_entry()` keep the order ID if cancel fails (network timeout, unknown error)
- The order may still be live on the exchange
- Always check `state.exit_order_id is not None` before placing a replacement (Rule 16)

**Rule 3: Test fill event pipeline first**
- Fill delivery is critical; always regression-test new fill-dependent logic end-to-end
- Use `tests/fake_client.py` as a template for mock clients

**Rule 4: WMA(7) is the squeeze re-entry gate**
- `place_squeeze_reentry()` only fires after 2 consecutive WMA(7) declines
- `squeeze_mode_active` blocks all new SHORT entries until `clear_squeeze()` runs
- Prevents whipsaws into a falling knife

**Rule 5: `upbit_risk` is a symbol property, not position state**
- Do NOT clear it in `state.reset()`
- Persists across position flat transitions
- Updated passively by `UpbitConfirmationSink` (no polling; events only)

**Rule 6: Always one-way position mode**
- `_pos_side()` always returns `None`
- Never pass `positionSide=LONG` or `positionSide=SHORT` to order calls
- Binance interprets `None` as one-way mode (correct)

**Rule 7: MACD is exit-filter only**
- `evaluate_macd_exit()` suppresses TP (suppress/normal)
- No entry gate; entry proceeds regardless of MACD state
- `MACD_EXIT_ENABLED=true` in `master.env` or per-bot `.env` enables the filter

**Rule 8: `squeeze_adjusted_tp_pct` persists across `clear_squeeze()`**
- It is position-level state, not squeeze state
- Cleared only by `state.reset()` on flat exit
- Never zero it in `clear_squeeze()`

**Rule 9: Squeeze re-entry clears MACD latch**
- `process_squeeze_reentry_fill()` zeros `macd_exit_latched` and `macd_exit_momentum_seen`
- Prevents loss-recovery TP from being suppressed by stale pre-spike MACD state
- Runs after `clear_squeeze()`

**Rule 10: MACD reads from WS cache, not REST**
- `evaluate_macd_exit()` performs zero REST calls per cycle
- `broker.cached_macd_5m_closes` / `cached_macd_15m_closes` are kept fresh by kline WebSocket callbacks
- `fast_unlatch_check()` from the 15m tick handler wakes the main loop sub-second on a histogram flip

**Rule 11: Cancel-then-replace must check cancel outcome**
- After `cancel_exit()` / `cancel_entry()` in a reconcile loop, verify tracking was cleared
- Rule 2 means the order may still be live if the cancel failed
- Overwriting the oid without checking orphans a live exchange order

**Rule 12: Flat-spike squeeze self-clears at the WMA(7) gate**
- When a spike fires while flat (`pre_close_level=0`), `place_squeeze_reentry()` calls `clear_squeeze()` at the WMA(7) 2-decline point
- Without this, the squeeze latch would block all future S1/L1 entries permanently

**Rule 13: Broker depends only on `protocols.TradingClient` + `protocols.MarkPriceStream`**
- No concrete exchange imports in `broker.py`
- Zero mock/fake-specific code
- Enables backtesting with historical data

**Rule 14: `macd_exit_momentum_seen` clears only on squeeze re-entry fill**
- At S4+, the main loop skips MACD evaluation (returns `"normal"` automatically)
- `fast_unlatch_check()` bails at `open_trades >= 4` (S4+)
- Loss-recovery TP on squeeze re-entry must run regardless of momentum

**Rule 15: MACD cache self-heals on WS outage**
- `_fetch_macd_closes()` detects stale cache (no update within `2 × interval`)
- Falls back to REST and reseeds cache + freshness timestamps
- Next WS tick resumes incremental updates

**Rule 16: Cancel-then-replace paths MUST check cancel outcome before writing a replacement oid**
- `cancel_exit()` / `cancel_entry()` preserve tracking on Rule 2 unknown failures
- Writing a fresh oid without checking orphans a potentially-live exchange order
- See CONTEXT.md for the correct pattern

### Secrets & Credentials

- **NEVER commit credentials** to git
- All secrets in `master.env` (gitignored by default)
- API keys, tokens, and private state are per-symbol in `.env` files

### Defensive Programming

- Mandatory for all exchange API calls
- Handle all error states: network timeout, insufficient balance, invalid price, etc.
- Logging is critical — every order placement, cancel, fill, and state transition

## MACD Exit Filter

The MACD exit filter mirrors PineScript exactly (lines 32–86). It suppresses TP during momentum divergences:

- **ARM**: 5m histogram 2 consecutive moves favour position AND 15m MACD line confirms direction
- **LATCH** (`macd_exit_latched=True`): arm fires → suppress TP (big divergence detected)
- **UNLATCH**: 15m histogram flips → fall through to building check
- **BUILDING**: 5m favor active but not latched → suppress TP (momentum building)
- **NORMAL**: neither latched nor building → allow TP

**Enable per-bot** in `configs/SYMBOL.env`:
```env
MACD_EXIT_ENABLED=true
```

**Sub-second detection**:
- Latch: `fast_latch_check()` from 5m kline WebSocket → `macd_latch_event`
- Unlatch: `fast_unlatch_check()` from 15m kline WebSocket → `macd_unlatch_event`
- Main loop wakes within ~1 tick on either event (no waiting for `poll_interval_sec`)

**Monitoring cadence**:
| Signal | Path | Latency |
|---|---|---|
| Latch (arm fires) | `fast_latch_check()` from 5m WS tick → `macd_latch_event` | **sub-second** |
| Unlatch (15m hist flip) | `fast_unlatch_check()` from 15m WS tick → `macd_unlatch_event` | **sub-second** |
| Building / S4+ / fallback | `evaluate_macd_exit()` main loop | `poll_interval_sec` (15s default) |

## Short-Squeeze Protection (Stage 7)

Detects Upbit announcement spikes and closes SHORT positions automatically to prevent liquidation.

### Enable

Set `SHORT_SQUEEZE_ENABLED=true` in `master.env`:

```env
SHORT_SQUEEZE_ENABLED=true
```

### How It Works

1. **Startup Upbit Check**: On boot, `UpbitConfirmationSink.startup_check()` queries Upbit to determine which symbols have listed tokens
   - Sets `state.upbit_risk` per symbol: `True` = NOT on Upbit (risk active), `False` = already listed (safe)
   - Launches 30-min background re-check loop

2. **Spike Detection**: `AsyncAggTradeStream` buckets 1s aggTrades into volume; if:
   - Volume > threshold AND price up AND `state.upbit_risk=True`
   - → fire `AnnouncementRiskDetected` event (fires even when flat)

3. **On Spike**:
   - If SHORT positioned: `broker.close_short_on_squeeze(spike_price)`
     - Cancel pending SHORT entries
     - Market-close entire SHORT position
     - Save squeeze state
   - If flat: latch `squeeze_mode_active=True`, block all new SHORT entries

4. **Re-Entry Gate**: WMA(7) downtrend (2 consecutive declines)
   - Only after WMA(7) 2-decline gate fires: place single GTC LIMIT re-entry at WMA(7) price
   - Qty = closed contracts + pseudo-filled contracts
   - S6-exclusive TP for loss recovery (24% S6 level)

5. **Passive Upbit Listing Confirmation**: `UpbitConfirmationSink` emits `UpbitListingConfirmed` when a symbol transitions from `upbit_risk=True` → `False`
   - Unsubscribes aggTrade stream for that symbol
   - Stops spike detection (no longer needed)

**S6 squeeze-exclusive**: `_SQUEEZE_S6_PCT = 24.0` (hardcoded); S6 is only placed during squeeze recovery (`squeeze_adjusted_tp_pct > 0`). In normal mode, `LEVEL_PCT_6=0.0` remains default — S6 never fires.

## Project Structure

```
/home/admin/Development/
├── master.py               # Master process: bot coordination, WebSocket setup
├── bot.py                  # Per-symbol bot coroutine: entry, fill handling, exit
├── broker.py               # Order lifecycle, MACD exit, squeeze mode (1300 lines)
├── state.py                # Position state, serialization, transitions
├── stream.py               # WebSocket stream handlers (mark price, klines, user data, aggTrade)
├── strategy.py             # MACD calculation, moving averages
├── event_bus.py            # Async event delivery, LogSink, TelegramSink
├── upbit_sink.py           # Upbit confirmation passive manager
├── log_router.py           # Log file segregation (master, per-symbol, irregularities)
├── protocols.py            # Abstract base classes for TradingClient, streams
├── config.py               # BotConfig dataclass
├── tests/
│   ├── test_broker.py      # Order lifecycle, Rules 1–12 (27 tests)
│   ├── test_macd_exit.py   # MACD latch/unlatch/cache (75 tests)
│   ├── test_squeeze_mode.py # Spike detection, pseudo-fill reentry (35 tests)
│   ├── test_state.py       # State transitions, flat ↔ positioned
│   ├── test_strategy.py    # MA, MACD math, rounding (61 tests)
│   ├── test_event_bus.py   # Event delivery, sink isolation
│   └── fake_client.py      # MockClient for testing (no Binance API calls)
├── configs/
│   ├── SYMBOL1.env         # Per-bot configuration
│   ├── SYMBOL2.env
│   └── ...
├── state/
│   ├── SYMBOL1.json        # Persistent position state
│   ├── SYMBOL2.json
│   └── ...
├── logs/
│   ├── master.log          # WARNING+ (all) + key broker INFO
│   ├── SYMBOL1.log         # All records with [SYMBOL1]
│   ├── SYMBOL2.log
│   └── agg_irregularities.log  # AggTrade + Upbit + squeeze events
├── master.env              # Credentials & global config (gitignored)
├── master.env.example      # Template
├── requirements.txt        # Dependencies
└── README.md               # This file
```

## Logging

Three log destinations:

1. **stdout**: All INFO+ messages (real-time monitoring in terminal)
2. **logs/master.log**: WARNING+ + key broker INFO (fills, exits, squeeze events)
3. **logs/SYMBOL.log**: All records with `[SYMBOL]` in the message
4. **logs/agg_irregularities.log**: AggTrade volume spikes, Upbit updates, squeeze mode events

Routing is configured in `log_router.py` and wired via `attach_routers(LOG_DIR)` from `_setup_logging()`.

## Development

### Running Tests Before Committing

```bash
# All tests
pytest tests/ -v

# Specific suite
pytest tests/test_broker.py -v

# Single test
pytest tests/test_broker.py::TestBrokerInitEntries -v

# With coverage
pytest tests/ --cov=. --cov-report=html
```

### Key Development Patterns

1. **Place code adjacent to related logic**: New order-entry code goes in `broker.py` near `place_entry()`, not in `bot.py`
2. **Use git commits to communicate intent**: `git commit -m "Rule 2: preserve cancel outcome in reconcile_tp"` is more helpful than "fix bug"
3. **Test incrementally during implementation**: Don't write 100 lines then test; write 10, test, repeat
4. **Review diffs before committing**: `git diff` to catch accidental changes
5. **Always check CONTEXT.md before touching order/state logic**: Rules 1–16 prevent recurring bugs

### Backtest Integration

To implement a backtest:

1. Create `MockClient(protocols.TradingClient)` with historical kline data
2. Create `MockMarkStream(protocols.MarkPriceStream)` with replay logic
3. Instantiate `Broker(mock_client, state, config, mock_mark_stream)`
4. Drive with `broker.place_entry()`, `broker.process_fill()`, etc. using synthetic fills

See `tests/fake_client.py` for a minimal stub. The Broker has **zero concrete exchange imports**, so any mock that implements the protocols will work.

## Environment Variables

### master.env (Global)

```env
# Binance API
BASE_URL=https://fapi.binance.com
WS_BASE_URL=wss://fstream.binance.com

# Credentials (NEVER commit)
TRADE_KEY=...
TRADE_SECRET=...

# Telegram (optional)
TELEGRAM_TOKEN=...
TELEGRAM_CHAT_ID=...

# Feature Flags
SHORT_SQUEEZE_ENABLED=false
MACD_EXIT_ENABLED=true

# Logging
LOG_DIR=logs
LOG_LEVEL=INFO

# Polling
POLL_INTERVAL_SEC=15
```

### Per-Bot (configs/SYMBOL.env)

```env
SYMBOL=BTCUSDT
BASE_ASSET_QTY=1.0
ALLOCATION=0.5
LEVERAGE=10
TAKE_PROFIT_PCT=2.5
TRAILING_STOP_ENABLED=true
TRAILING_STOP_ACTIVATION_PCT=1.5
TRAILING_STOP_RETRACE_PCT=0.8

LEVEL_PCT_1=1.0
LEVEL_PCT_2=2.0
LEVEL_PCT_3=4.0
LEVEL_PCT_4=8.0
LEVEL_PCT_5=16.0
LEVEL_PCT_6=0.0

DEVIATION_1=1.0
DEVIATION_2=2.0
DEVIATION_3=4.0
DEVIATION_4=8.0
DEVIATION_5=16.0
DEVIATION_6=32.0

MACD_EXIT_ENABLED=true
LOG_LEVEL=INFO
```

## Troubleshooting

### Bot won't start
- Check `master.env` exists and has valid Binance credentials
- Verify `configs/SYMBOL.env` files exist for each symbol
- Check logs in `logs/master.log` for startup errors

### Orders aren't filling
- Verify account has sufficient balance (in USDT)
- Check `configs/SYMBOL.env` — `ALLOCATION` and `LEVERAGE` may be too high
- On testnet, ensure sufficient test funds in Binance testnet account
- Check `logs/SYMBOL.log` for order placement errors

### Trailing stop not working
- Ensure `TRAILING_STOP_ENABLED=true` in `configs/SYMBOL.env`
- Set `TRAILING_STOP_ACTIVATION_PCT` (e.g., 1.5 = activate when up 1.5%)
- Check `logs/master.log` for mark price stream errors

### Squeeze mode fires incorrectly
- Verify `SHORT_SQUEEZE_ENABLED=true` in `master.env`
- Check `logs/agg_irregularities.log` for spike detections
- Inspect `state/SYMBOL.json` — `upbit_risk` field should reflect actual Upbit listing status
- Review `logs/master.log` for `UpbitConfirmationSink` startup logs

## License

Proprietary. For development and testing only.

## Support

For issues or questions:
- Check `logs/` for detailed error traces
- Review CONTEXT.md and CLAUDE.md in `.claude/` for architectural decisions
- Run `pytest tests/ -v` to verify the environment
