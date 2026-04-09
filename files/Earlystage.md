# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **mean-reversion DCA (Dollar Cost Averaging) trading bot** for Binance USDT-M Futures. It implements a multi-bot architecture where each symbol runs as a child process, and a master orchestrator handles all order execution.

## Running the System

```bash
# Install dependencies
pip install -r requirements.txt

# Start the multi-bot orchestrator
python master.py

# Reload allocation after adding/removing bots (sends SIGHUP to master)
kill -HUP <master_pid>
```

## After Editing Shared Files

The bot directories under `bots/` each contain copies of the shared Python files. After editing `bot.py`, `client.py`, `config.py`, `state.py`, `strategy.py`, or `stream.py` at the root level, propagate changes to all bots:

```bash
./update_bots.sh
```

## Configuration

**`master.env`** — trade API key, LEVEL_PCT sizing, Telegram credentials. Copy from `master.env.example`.

**`bots/SYMBOL/.env`** — per-bot config (read-only API key, symbol, leverage, MA settings, deviations, TP%, trailing stop). No LEVEL_PCT here.

## Architecture

```
master.py                          (single process — trade API key)
  ├── Queue ←→ bots/BTCUSDT/bot.py  (child process — read-only key)
  ├── Queue ←→ bots/ETHUSDT/bot.py  (child process)
  └── ...N workers
```

### Process Separation

- **Master** (`master.py`): holds the trade API key. Exclusively places/cancels orders, fetches balances, computes order quantity (`balance × LEVEL_PCT × allocation × leverage / price`), manages bot process lifecycle, handles SIGINT/SIGTERM/SIGHUP.
- **Bots** (`bots/SYMBOL/bot.py`): hold a read-only API key. Run strategy logic, candle detection, MA calculation, DCA level tracking, fill event processing, trailing stop via WebSocket. Send `order intents` to master via `multiprocessing.Queue`; receive fill results back.

### IPC Protocol

Two queues per bot: `order_queue` (bot → master) and `result_queue` (master → bot). Message types: `order`, `result`, `sync_request`, `sync_response`, `status`, `shutdown`.

**Order actions (bot → master):**

| Action | Description |
|--------|-------------|
| `ENTRY` | Legacy market entry (unused — kept for reference) |
| `PLACE_ENTRY_LIMIT` | Place GTC LIMIT entry order; master sizes qty from balance |
| `CANCEL_ENTRY_LIMIT` | Cancel a pending entry limit by `client_order_id` |
| `PLACE_TP_LIMIT_DYNAMIC` | Place TP LIMIT reduceOnly with explicit bot-tracked qty |
| `CANCEL_EXIT` | Cancel active exit order |
| `CHECK_EXIT_STATUS` | Query exit order status |
| `CLOSE_MARKET` | Market close (trailing stop / emergency) |
| `GET_OPEN_ORDERS` | Fetch all open orders for a symbol (used by sync_state) |

### Allocation System

Each bot receives `allocation = 1.0 / N` where N is the number of bot directories. Bots with open positions lock their allocation in `state.json` (`locked_allocation`) during rebalances, using it until the position closes.

### Key Modules

| File | Role |
|------|------|
| `master.py` | Orchestrator + order executor |
| `bot.py` | Strategy runner + intent sender + fill event processor |
| `strategy.py` | Pure-math helpers: MA (SMA/EMA/WMA/RMA/HMA), DCA level generation, qty rounding. **Never modify strategy logic.** |
| `stream.py` | WebSocket streams: `MarkPriceStream`, `KlineStream`, `UserDataStream`. **Never modify.** |
| `client.py` | `BinanceClient` — REST API wrapper (root = trade key, bots/ = read-only) |
| `config.py` | All env-var configuration with fail-fast validation at import time |
| `state.py` | `State` class — persistent JSON state with atomic writes and type validation |
| `telegram_bot.py` | Fleet-wide Telegram control (`/status`, `/stop`, `/start`, `/exit`, `/create`) |

### Entry Logic (Limit Orders)

Entries use GTC LIMIT orders, not market orders. On every candle close:

1. **Flat bot**: cancels and replaces L1 (LONG) and S1 (SHORT) limits at the new MA-derived levels. Both coexist simultaneously.
2. **First fill on L1/S1**: cancels the opposite side's limit immediately.
3. **Partial fill on L1/S1**: keeps the remaining qty on the book; does NOT place L2/S2 yet.
4. **Full fill on L1/S1**: places L2/S2 at the current DCA level.
5. **Full fill on L2+**: places the next level immediately.
6. **L2+ limits are placed once** (on previous fill) and NOT updated each bar.

Fill detection is real-time via `UserDataStream` (Binance User Data Stream WebSocket). Fill events are processed on the main thread between candle closes.

### Exit Logic (Dynamic TP)

- **Non-trailing mode**: `_reconcile_tp_order()` runs every poll cycle (~15s). If position size or TP price has changed (due to partial fills or DCA), cancels the old TP and places a fresh one sized to the current `state.position_size`. First TP placement also goes through this path.
- **Trailing mode**: Phase 1 — wait for mark price to cross TP (TP level refreshed each cycle to track DCA partial fills). Phase 2 — real-time WebSocket marks the extreme; fires MARKET close when price retraces `TRAILING_DISTANCE_PCT`. REST polling serves as backup if WebSocket is stale.

### State Fields (key additions from Stage 1/2)

| Field | Type | Description |
|-------|------|-------------|
| `pending_entry_orders` | dict | Tracks open entry limits: `{label: {client_order_id, side, price, original_qty, filled_qty, avg_fill_price, level_index, direction, status}}` |
| `active_limit_ids` | dict | Reverse map: `{client_order_id: label}` for fast fill-event lookup |

### WebSocket Streams

Three background threads per bot:

| Stream | Source | Purpose |
|--------|--------|---------|
| `MarkPriceStream` | `<symbol>@markPrice` | Real-time mark price for trailing stop |
| `KlineStream` | `<symbol>@kline_<interval>` | Candle-close wake signal for main loop |
| `UserDataStream` | `listenKey` (User Data Stream) | Real-time fill/partial-fill detection via `ORDER_TRADE_UPDATE` |

The `UserDataStream` listenKey is refreshed every 30 minutes automatically. It reconnects on disconnect with exponential back-off.

## Logs

Rotating log files (10 MB × 5): `logs/master.log`, `logs/bot_SYMBOL.log`.
