import talib
import ta
import tensorflow as tf
print(f"🔹 Using TensorFlow {tf.__version__}")

import pytz
from datetime import datetime, time as dtime
from flask_socketio import SocketIO
from google.protobuf.json_format import MessageToDict
from flask import Flask, jsonify, send_from_directory, request, send_file, redirect, url_for
import websocket  # websocket-client
import requests
import queue
import os
import json
import asyncio
import ssl
import threading
import websockets
import gzip
import upstox_client
import time
import random
from io import BytesIO
import numpy as np
import pandas as pd
import yfinance as yf
import joblib
from tensorflow.keras.models import Sequential, load_model, Model
from tensorflow.keras.layers import (
    LSTM, Dense, Dropout, Activation,
    Input, LayerNormalization, MultiHeadAttention, Flatten
)
from sklearn.preprocessing import MinMaxScaler
from dotenv import load_dotenv, set_key
from apscheduler.schedulers.background import BackgroundScheduler
from typing import Dict, List
from datetime import timedelta
from datetime import datetime, timezone

# ================================
# 🌐 Timezone
# ================================
INDIA_TZ = pytz.timezone("Asia/Kolkata")

# ================================
# 🔐 Token Handling
# ================================
TOKENS_FILE = "tokens.json"
ENV_FILE = ".env"


# ================================
# 🔐 TOKEN FRESHNESS CHECK LOGIC
# ================================
from datetime import datetime, timedelta, timezone
import os, json

TOKENS_FILE = "tokens.json"
ENV_FILE = ".env"

def token_is_fresh(max_age_hours=24):
    """Check if Upstox access token exists and is less than max_age_hours old."""
    if not os.path.exists(TOKENS_FILE):
        print("⚠️ tokens.json not found.")
        return False

    try:
        with open(TOKENS_FILE, "r") as f:
            data = json.load(f)

        access_token = data.get("access_token")
        saved_at = data.get("saved_at")

        if not access_token or not saved_at:
            print("⚠️ No token or saved_at timestamp in tokens.json")
            return False

        # ensure timezone-aware timestamp
        saved_time = datetime.fromisoformat(saved_at)
        if saved_time.tzinfo is None:
            saved_time = saved_time.replace(tzinfo=timezone.utc)

        now_utc = datetime.now(timezone.utc)
        age = now_utc - saved_time

        if age < timedelta(hours=max_age_hours):
            print(f"🟢 Token is still valid ({age.total_seconds()/3600:.1f} hours old)")
            os.environ["UPSTOX_ACCESS_TOKEN"] = access_token
            return True

        print(f"⏰ Token expired ({age.total_seconds()/3600:.1f} hours old)")
        return False

    except Exception as e:
        print("⚠️ token_is_fresh() error:", e)
        return False


def save_tokens(data):
    """Save tokens to file and update .env + runtime env."""
    data["saved_at"] = datetime.now(timezone.utc).isoformat()
    with open(TOKENS_FILE, "w") as f:
        json.dump(data, f, indent=2)
    print("💾 Tokens saved to tokens.json")

    access_token = data.get("access_token")
    if access_token:
        try:
            # Write token to .env
            set_key(ENV_FILE, "UPSTOX_ACCESS_TOKEN", access_token)
            os.environ["UPSTOX_ACCESS_TOKEN"] = access_token
            print("🧠 Updated UPSTOX_ACCESS_TOKEN in .env and runtime")
        except Exception as e:
            print(f"⚠️ Failed to update .env: {e}")

def load_tokens():
    """Load tokens from tokens.json if available."""
    if os.path.exists(TOKENS_FILE):
        with open(TOKENS_FILE, "r") as f:
            return json.load(f)
    return {}

def get_access_token():
    """Return current access token from file."""
    tokens = load_tokens()
    return tokens.get("access_token")

def update_env_access_token():
    """Sync latest access token into environment variables."""
    global UPSTOX_ACCESS_TOKEN
    UPSTOX_ACCESS_TOKEN = get_access_token() or UPSTOX_ACCESS_TOKEN
    os.environ["UPSTOX_ACCESS_TOKEN"] = UPSTOX_ACCESS_TOKEN
    print(f"🔑 Updated runtime access token: {UPSTOX_ACCESS_TOKEN[:12]}...")

# ================================
# ⚙️ Environment and Config
# ================================
load_dotenv(override=True)

UPSTOX_CLIENT_ID = os.getenv("UPSTOX_CLIENT_ID", "").strip()
UPSTOX_CLIENT_SECRET = os.getenv("UPSTOX_CLIENT_SECRET", "").strip()
UPSTOX_ACCESS_TOKEN = os.getenv("UPSTOX_ACCESS_TOKEN", "").strip()
UPSTOX_REDIRECT_URI = os.getenv("UPSTOX_REDIRECT_URI", "http://localhost:5000").strip()
UPSTOX_API_BASE = "https://api.upstox.com/v2"
UPSTOX_AUTHORIZE_URL = os.getenv(
    "UPSTOX_AUTHORIZE_URL",
    "https://api.upstox.com/v3/feed/market-data-feed/authorize"
).strip()
UPSTOX_SUB_MODE = os.getenv("UPSTOX_SUB_MODE", "ltpc").strip()
UPSTOX_WS_RECONNECT_SECONDS = int(os.getenv("UPSTOX_WS_RECONNECT_SECONDS", "5"))

print(f"🔁 Reconnection Time (seconds): {UPSTOX_WS_RECONNECT_SECONDS}")

# ================================
# 🧩 Protobuf Decoder
# ================================
try:
    from MarketDataFeedV3_pb2 import FeedResponse
    PROTO_MESSAGE_CLASS = FeedResponse
    print("🟢 Protobuf decoder loaded successfully (MarketDataFeedV3_pb2.FeedResponse)")
except Exception as e:
    PROTO_MESSAGE_CLASS = None
    print("❌ Failed to import MarketDataFeedV3_pb2:", e)

# ================================
# 📁 PATH SETUP
# ================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "../frontend/dist")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# ================================
# 🗓️ Safe Date Parser
# ================================
def normalize_date(date_str):
    """Normalize date format to YYYY-MM-DD for yfinance compatibility."""
    if not date_str:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(date_str).date().strftime("%Y-%m-%d")
    except Exception:
        raise ValueError(f"Invalid date format: {date_str}")

# ================================
# 📦 LOAD NSE_EQ STOCKS
# ================================
print("📦 Loading instrument file...")

file_path = os.path.join(BASE_DIR, "upstox_instruments.json.gz")
instruments, equities = [], []

if os.path.exists(file_path):
    try:
        with gzip.open(file_path, "rt", encoding="utf-8") as f:
            instruments = json.load(f)
        for i in instruments:
            if (
                i.get("segment") == "NSE_EQ"
                and i.get("exchange") == "NSE"
                and i.get("instrument_type") == "EQ"
            ):
                equities.append({
                    "symbol": i.get("trading_symbol"),
                    "exchange": i.get("exchange"),
                    "instrument_key": i.get("instrument_key"),
                    "name": i.get("name"),
                    "short_name": i.get("short_name"),
                })
        print(f"✅ Loaded {len(equities)} NSE Equity instruments")
    except Exception as e:
        print("❌ Failed to load instruments file:", e)
else:
    print("⚠️ instruments file not found:", file_path)

# Build symbol → instrument_key lookup
SYMBOL_TO_KEY: Dict[str, str] = {}
for eq in equities:
    sym = (eq.get("symbol") or "").strip().upper()
    key = (eq.get("instrument_key") or "").strip()
    if sym and key:
        SYMBOL_TO_KEY[sym] = key

def is_market_open():
    """Check if Indian market is open (NSE/BSE hours)."""
    now = datetime.now(INDIA_TZ).time()
    return dtime(9, 0) <= now <= dtime(15, 30)

# 📡 Upstox Streamer Class
# =======================================
class UpstoxStreamer(threading.Thread):
    def __init__(self, access_token: str):
        super().__init__(daemon=True)
        self.access_token = access_token
        self.connected = False
        self.stop_event = threading.Event()
        self.subscribed_keys: set[str] = set()
        self.ctrl_q = queue.Queue()
        self.sub_lock = threading.Lock()
        self.ws = None

    # 🔑 Get a new authorized WS URL each time
def _authorize_get_ws_url(self) -> str:
    """
    Authorize feed access via Upstox API v2 — returns a websocket URL.
    """
    if not self.access_token or len(self.access_token) < 20:
        raise RuntimeError("Invalid or missing Upstox access token.")

    headers = {
        "Api-Key": UPSTOX_CLIENT_ID,  # ✅ include your API key here
        "Authorization": f"Bearer {self.access_token}",
        "Accept": "application/json",
    }

    try:
        resp = requests.get(UPSTOX_AUTHORIZE_URL, headers=headers, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        print(f"⚠️ WS Authorization failed: {resp.status_code if resp else '??'} - {getattr(resp, 'text', e)}")
        raise

    data = resp.json()
    ws_url = data.get("data", {}).get("authorized_redirect_uri")
    if not ws_url:
        raise RuntimeError(f"Missing authorized_redirect_uri in response: {data}")

    print("🔑 Authorized WS URL received:", ws_url)
    return ws_url


    # 📡 Subscribe / Unsubscribe
    def _send_subscribe(self, keys: list[str]):
        if not self.connected or not self.ws or not keys:
            print("⚠️ WebSocket not ready for subscription yet.")
            return
        payload = {
            "guid": f"g_{int(time.time() * 1000)}",
            "method": "sub",
            "data": {"mode": UPSTOX_SUB_MODE, "instrumentKeys": keys},
        }
        try:
            self.ws.send(json.dumps(payload))
            print(f"📡 Sent SUB for {len(keys)} keys → {keys}")
        except Exception as e:
            print("❌ SUB send failed:", e)

    def _send_unsubscribe(self, keys: list[str]):
        if not self.connected or not self.ws or not keys:
            print("⚠️ WebSocket not ready for unsubscribe yet.")
            return
        payload = {
            "guid": f"g_{int(time.time() * 1000)}",
            "method": "unsub",
            "data": {"mode": UPSTOX_SUB_MODE, "instrumentKeys": keys},
        }
        try:
            self.ws.send(json.dumps(payload))
            print(f"📴 Sent UNSUB for {len(keys)} keys → {keys}")
        except Exception as e:
            print("❌ UNSUB send failed:", e)

    # 🧠 Public APIs
    def subscribe(self, instrument_keys: list[str]):
        if not instrument_keys:
            print("⚠️ No instrument keys provided for subscription.")
            return
        with self.sub_lock:
            self.subscribed_keys.update(instrument_keys)
        if self.connected and self.ws:
            self._send_subscribe(instrument_keys)
        else:
            self.ctrl_q.put({"type": "sub", "keys": instrument_keys})
            print("⏳ Queued keys for auto-subscription once connected.")

    def unsubscribe(self, instrument_keys: list[str]):
        if not instrument_keys:
            print("⚠️ No instrument keys provided for unsubscription.")
            return
        with self.sub_lock:
            for k in instrument_keys:
                self.subscribed_keys.discard(k)
        if self.connected and self.ws:
            self._send_unsubscribe(instrument_keys)
        else:
            self.ctrl_q.put({"type": "unsub", "keys": instrument_keys})
            print("⏳ Queued keys for auto-unsubscription once connected.")

    # ⚙️ WebSocket Callbacks
    def _on_open(self, ws):
        self.connected = True
        print("✅ Upstox WS connected.")
        with self.sub_lock:
            keys = list(self.subscribed_keys)
        if keys:
            print(f"📡 Restoring {len(keys)} subscriptions...")
            self._send_subscribe(keys)

    def _on_close(self, ws, code, reason):
        self.connected = False
        print(f"🔌 Upstox WS closed: code={code}, reason={reason}")

    def _on_error(self, ws, error):
        self.connected = False
        print("⚠️ Upstox WS error:", error)

    # 🧩 Message Handler
    def _on_message(self, ws, message):
        try:
            if isinstance(message, (bytes, bytearray)):
                if PROTO_MESSAGE_CLASS is None:
                    print("❌ Protobuf not loaded; cannot decode binary.")
                    return
                msg = PROTO_MESSAGE_CLASS()
                msg.ParseFromString(message)
                parsed_ticks = {}

                for key, feed in msg.feeds.items():
                    try:
                        if feed.HasField("ltpc"):
                            ltp = feed.ltpc.ltp
                            parsed_ticks[key] = {"ltp": round(float(ltp), 2)}
                        elif feed.HasField("fullFeed"):
                            if feed.fullFeed.HasField("marketFF"):
                                ltp = feed.fullFeed.marketFF.ltpc.ltp
                                ohlc = feed.fullFeed.marketFF.marketOHLC.ohlc
                                if ltp:
                                    parsed_ticks[key] = {"ltp": round(float(ltp), 2)}
                                    if len(ohlc) > 0:
                                        parsed_ticks[key].update({
                                            "open": ohlc[0].open,
                                            "high": ohlc[0].high,
                                            "low": ohlc[0].low,
                                            "close": ohlc[0].close,
                                        })
                    except Exception as inner:
                        print(f"⚠️ Decode error for {key}:", inner)

                if parsed_ticks:
                    socketio.emit("tick_update", parsed_ticks, broadcast=True)
                    print("📈 Tick update:", parsed_ticks)
                return

            if isinstance(message, str):
                data = json.loads(message)
                if "subscription" in message.lower():
                    print("🟢 Subscription ACK:", data)
                elif "error" in data:
                    print("⚠️ WS error:", data)
        except Exception as e:
            print("⚠️ _on_message exception:", e)

    # ✅ FIXED: now indented properly inside the class
    def run(self):
        """Main WebSocket connection loop."""
        consecutive_403 = 0  # track repeated forbidden responses

        while not self.stop_event.is_set():
            try:
                # 🕒 Skip connection if market is closed
                if not is_market_open():
                    print("⏸️ Market closed (after 3:30 PM). Waiting for next open window...")
                    time.sleep(600)
                    continue

                # 🛡️ Check token validity
                if not self.access_token or len(self.access_token) < 20:
                    print("⚠️ Missing or invalid access token. Skipping WS connect.")
                    time.sleep(60)
                    continue

                # ✅ Fetch fresh WS URL
                try:
                    ws_url = self._authorize_get_ws_url()
                    print("🔑 Authorized WS URL received:", ws_url)
                except Exception as e:
                    print(f"⚠️ WS Authorization failed: {e}")
                    time.sleep(60)
                    continue

                # ✅ Establish WebSocket connection
                self.ws = websocket.WebSocketApp(
                    ws_url,
                    on_open=self._on_open,
                    on_message=self._on_message,
                    on_error=self._on_error,
                    on_close=self._on_close,
                )

                ws_thread = threading.Thread(
                    target=self.ws.run_forever,
                    kwargs={"ping_interval": 20, "ping_timeout": 10},
                    daemon=True,
                )
                ws_thread.start()

                connected_once = False
                while ws_thread.is_alive() and not self.stop_event.is_set():
                    if self.connected:
                        connected_once = True
                    try:
                        cmd = self.ctrl_q.get(timeout=0.2)
                        if cmd["type"] == "sub":
                            self._send_subscribe(cmd["keys"])
                        elif cmd["type"] == "unsub":
                            self._send_unsubscribe(cmd["keys"])
                    except queue.Empty:
                        continue

                if not connected_once:
                    consecutive_403 += 1
                    print("⚠️ Connection failed (403 or timeout). Waiting before retry...")

                if not connected_once:
                    if consecutive_403 >= 3:
                        print("🚫 Too many 403 errors. Pausing for 15 minutes.")
                        time.sleep(900)
                        consecutive_403 = 0
                    else:
                        time.sleep(60)
                    continue

                consecutive_403 = 0
                print(f"🔁 Reconnecting in {UPSTOX_WS_RECONNECT_SECONDS}s...")
                time.sleep(UPSTOX_WS_RECONNECT_SECONDS)

            except Exception as e:
                print("❌ WS loop exception:", e)
                time.sleep(UPSTOX_WS_RECONNECT_SECONDS)

    # 🧹 Graceful shutdown
    def shutdown(self):
        self.stop_event.set()
        try:
            if self.ws:
                self.ws.close()
                print("🧹 WebSocket closed cleanly.")
        except Exception:
            pass

# ================================
# 🧠 SAFE INDEX FEED STARTUP HANDLER (CLEANED)
# ================================
async def index_feed_loop():
    """
    Continuously fetch live index prices (Nifty, BankNifty, Sensex)
    via Upstox WebSocket — runs only if access token is valid.
    """
    INDEX_KEYS = [
        "NSE_INDEX|Nifty 50",
        "NSE_INDEX|Nifty Bank",
        "NSE_INDEX|SENSEX",
    ]

    while True:
        try:
            # 🕒 Skip connecting when market is closed
            if not is_market_open():
                print("⏸️ Market closed — will retry in 10 minutes...")
                await asyncio.sleep(600)
                continue

            # 🧠 Validate token before trying authorization
            if not UPSTOX_ACCESS_TOKEN or len(UPSTOX_ACCESS_TOKEN) < 20:
                print("⚠️ Skipping index feed — invalid or missing Upstox access token.")
                await asyncio.sleep(120)
                continue

            headers = {
                "Authorization": f"Bearer {UPSTOX_ACCESS_TOKEN}",
                "Accept": "application/json",
            }

            resp = requests.get(UPSTOX_AUTHORIZE_URL, headers=headers, timeout=10)
            try:
                data = resp.json()
            except Exception:
                print("⚠️ Upstox authorize returned non-JSON:")
                print(resp.text[:500])
                await asyncio.sleep(60)
                continue

            # 🧾 Validate API response
            ws_url = data.get("data", {}).get("authorized_redirect_uri")
            if not ws_url:
                print("❌ Invalid authorize response from Upstox:")
                print(json.dumps(data, indent=2))
                await asyncio.sleep(120)
                continue

            print("🔑 (Index Feed) Authorized WS URL:", ws_url)

            # ✅ Connect securely to WebSocket
            ssl_ctx = ssl.create_default_context()
            ssl_ctx.check_hostname = False
            ssl_ctx.verify_mode = ssl.CERT_NONE

            async with websockets.connect(ws_url, ssl=ssl_ctx) as ws:
                print("✅ (Index Feed) Connected to Upstox")

                # Subscribe to key indices
                sub_payload = {
                    "guid": "indexfeed",
                    "method": "sub",
                    "data": {"mode": "full", "instrumentKeys": INDEX_KEYS},
                }
                await ws.send(json.dumps(sub_payload))
                print("📡 Subscribed to:", INDEX_KEYS)

                # Receive and broadcast data
                while is_market_open():
                    try:
                        message = await asyncio.wait_for(ws.recv(), timeout=30)

                        if PROTO_MESSAGE_CLASS is None:
                            print("❌ Protobuf not loaded; cannot decode index binary.")
                            break

                        feed_resp = PROTO_MESSAGE_CLASS()
                        feed_resp.ParseFromString(message)
                        feed_dict = MessageToDict(feed_resp)

                        parsed = {}
                        for key, feed in (feed_dict.get("feeds") or {}).items():
                            full_feed = feed.get("fullFeed", {})
                            if "indexFF" in full_feed:
                                idx = full_feed["indexFF"]
                                ltpc = idx.get("ltpc", {})
                                ohlc = idx.get("marketOHLC", {}).get("ohlc", [])
                                parsed[key] = {
                                    "ltp": round(float(ltpc.get("ltp", 0.0)), 2),
                                    "open": ohlc[0].get("open") if ohlc else None,
                                    "high": ohlc[0].get("high") if ohlc else None,
                                    "low": ohlc[0].get("low") if ohlc else None,
                                    "close": ohlc[0].get("close") if ohlc else None,
                                }

                        if parsed:
                            socketio.emit("index_update", parsed, broadcast=True)
                            print("📈 Index update:", parsed)

                    except asyncio.TimeoutError:
                        if not is_market_open():
                            print("🕒 Market closed mid-loop — disconnecting gracefully.")
                            break
                        continue

        except Exception as e:
            print("💥 (Index Feed Error):", e)
            await asyncio.sleep(60)

def start_index_feed():
    """
    Start the index feed safely in a background thread.
    Only starts if a valid access token is present.
    """
    if not UPSTOX_ACCESS_TOKEN or len(UPSTOX_ACCESS_TOKEN) < 20:
        print("⏸️ Skipping index feed — invalid or missing Upstox token.")
        return

    def _runner():
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(index_feed_loop())
        except Exception as e:
            print("💥 (Index Feed Thread) error:", e)
        finally:
            try:
                loop.close()
            except Exception:
                pass

    # Start background thread
    print("🚀 Launching index feed thread...")
    threading.Thread(target=_runner, daemon=True).start()

# ================================
# 📜 Instruments Endpoint
# ================================
@app.route("/api/instruments", methods=["GET"])
def get_instruments():
    try:
        return jsonify({"instruments": equities})
    except Exception as e:
        print("❌ Error loading instruments:", e)
        return jsonify({"error": str(e)}), 500

# ================================
# 🟢 Dynamic Subscribe/Unsubscribe via REST (optional) + SocketIO
# ================================
def symbols_to_keys(symbols: List[str]) -> List[str]:
    keys = []
    for s in symbols:
        sym = (s or "").strip().upper()
        k = SYMBOL_TO_KEY.get(sym)
        if k:
            keys.append(k)
    return keys

@app.route("/api/subscribe", methods=["POST"])
def subscribe_http():
    if not sdk_streamer:
        return jsonify({"error": "Streamer not ready (no token)"}), 503
    data = request.get_json(silent=True) or {}
    symbols = data.get("symbols") or []
    keys = data.get("instrument_keys") or data.get("instrumentKeys") or []
    if symbols and not keys:
        keys = [SYMBOL_TO_KEY.get(s.upper()) for s in symbols if SYMBOL_TO_KEY.get(s.upper())]
    if not keys:
        return jsonify({"error": "No valid instrument keys"}), 400

    sdk_streamer.subscribe(keys)
    print(f"📡 HTTP subscribe: {keys}")
    return jsonify({"ok": True, "subscribed": keys}), 200

@app.route("/api/unsubscribe", methods=["POST"])
def unsubscribe_http():
    if not sdk_streamer:
        return jsonify({"error": "Streamer not ready (no token)"}), 503
    data = request.get_json(silent=True) or {}
    symbols = data.get("symbols") or []
    keys = data.get("instrument_keys") or data.get("instrumentKeys") or []
    if symbols and not keys:
        keys = [SYMBOL_TO_KEY.get(s.upper()) for s in symbols if SYMBOL_TO_KEY.get(s.upper())]
    if not keys:
        return jsonify({"error": "No valid instrument keys"}), 400

    sdk_streamer.unsubscribe(keys)
    print(f"📴 HTTP unsubscribe: {keys}")
    return jsonify({"ok": True, "unsubscribed": keys}), 200

# Socket.IO: dynamic subs from React
@socketio.on("subscribe_symbols")
def sio_subscribe_symbols(payload):
    symbols = payload if isinstance(payload, list) else payload.get("symbols", [])
    keys = symbols_to_keys(symbols)
    if keys and sdk_streamer:
        sdk_streamer.subscribe(keys)
    socketio.emit("subscribed", {"keys": keys})

@app.route("/api/history/download", methods=["GET"])
def download_history_excel():
    try:
        from datetime import datetime, timedelta
        import inspect
        import talib

        symbol = request.args.get("symbol")
        start = normalize_date(request.args.get("start"))
        end = normalize_date(request.args.get("end"))

        if not symbol or not start or not end:
            return jsonify({"error": "Missing symbol, start, or end date"}), 400

        ticker = f"{symbol}.NS"
        print(f"📥 Downloading {ticker} ({start} → {end})")

        start_dt = datetime.strptime(start, "%Y-%m-%d")
        end_dt = datetime.strptime(end, "%Y-%m-%d")

        # ✅ Add buffer to handle weekends or missing candles
        buffered_start = start_dt - timedelta(days=10)
        buffered_end = end_dt + timedelta(days=2)

        # ✅ Fetch data
        df = yf.download(
            ticker,
            start=buffered_start.strftime("%Y-%m-%d"),
            end=buffered_end.strftime("%Y-%m-%d"),
            interval="1d",
            auto_adjust=True,
            progress=False,
        )

        if df.empty:
            return jsonify({
                "error": f"No trading data found for {symbol} between {start} and {end}. Try a longer range."
            }), 404

        # ✅ Flatten MultiIndex columns
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = ['_'.join([str(c) for c in col if c]).strip() for col in df.columns]
        else:
            df.columns = [str(c).strip() for c in df.columns]

        df.reset_index(inplace=True)

        # ✅ Normalize Date column
        if "Date" not in df.columns:
            for col in df.columns:
                if "date" in col.lower() or "time" in col.lower():
                    df.rename(columns={col: "Date"}, inplace=True)
                    break

        if "Date" not in df.columns:
            raise KeyError("⚠️ Date column missing even after normalization")

        df["Date"] = pd.to_datetime(df["Date"], errors="coerce").dt.tz_localize(None)
        df = df[df["Date"].between(start_dt, end_dt)]
        df["Date"] = df["Date"].dt.strftime("%Y-%m-%d")

        # ✅ Detect OHLCV columns
        colmap = {str(c).lower(): c for c in df.columns}
        open_col = next((colmap[k] for k in colmap if "open" in k), None)
        high_col = next((colmap[k] for k in colmap if "high" in k), None)
        low_col = next((colmap[k] for k in colmap if "low" in k), None)
        close_col = next((colmap[k] for k in colmap if "close" in k), None)
        vol_col = next((colmap[k] for k in colmap if "vol" in k), None)

        if not all([open_col, high_col, low_col, close_col, vol_col]):
            print("⚠️ Columns detected:", df.columns.tolist())
            return jsonify({
                "error": f"Missing OHLCV columns in Yahoo data for {symbol}. Got: {list(df.columns)}"
            }), 500

        # ✅ Rename to standard
        df.rename(columns={
            open_col: "Open",
            high_col: "High",
            low_col: "Low",
            close_col: "Close",
            vol_col: "Volume",
        }, inplace=True)

        # 🧹 Clean numeric data
        for col in ["Open", "High", "Low", "Close", "Volume"]:
            df[col] = pd.to_numeric(df[col], errors="coerce")

        df.ffill(inplace=True)
        df.bfill(inplace=True)

        # === Technical Indicators ===
        close, high, low, volume = df["Close"], df["High"], df["Low"], df["Volume"]

        # Momentum
        df["RSI_14"] = ta.momentum.RSIIndicator(close, window=14).rsi()
        df["ROC_5"] = ta.momentum.ROCIndicator(close, window=5).roc()
        df["MOM_10"] = ta.momentum.ROCIndicator(close, window=10).roc()

        # Trend
        df["SMA_5"] = ta.trend.SMAIndicator(close, window=5).sma_indicator()
        df["SMA_20"] = ta.trend.SMAIndicator(close, window=20).sma_indicator()
        df["EMA_5"] = ta.trend.EMAIndicator(close, window=5).ema_indicator()
        df["EMA_20"] = ta.trend.EMAIndicator(close, window=20).ema_indicator()

        macd = ta.trend.MACD(close)
        df["MACD"] = macd.macd()
        df["MACD_Signal"] = macd.macd_signal()
        df["MACD_Hist"] = macd.macd_diff()

        adx = ta.trend.ADXIndicator(high, low, close, window=14)
        df["ADX"] = adx.adx()
        df["+DI"] = adx.adx_pos()
        df["-DI"] = adx.adx_neg()

        # Volatility
        bb = ta.volatility.BollingerBands(close, window=20, window_dev=2)
        df["BB_High"] = bb.bollinger_hband()
        df["BB_Low"] = bb.bollinger_lband()
        df["BB_Mid"] = bb.bollinger_mavg()
        df["Volatility_5"] = close.rolling(5).std()
        df["Volume_Change"] = volume.pct_change()

        # === ALL Candlestick Patterns ===
        print("🕯️ Detecting all TA-Lib candlestick functions...")
        candle_funcs = []
        for name in dir(talib):
            if name.startswith("CDL"):
                func = getattr(talib, name)
                if callable(func):
                    candle_funcs.append(name)

        print(f"📊 Found {len(candle_funcs)} TA-Lib candlestick functions.")

        for func_name in candle_funcs:
            try:
                func = getattr(talib, func_name)
                df[func_name] = func(df["Open"], df["High"], df["Low"], df["Close"])
            except Exception as e:
                print(f"⚠️ Failed to compute {func_name}: {e}")
                df[func_name] = 0

        # === Signals
        df["RSI_Signal"] = np.where(
            df["RSI_14"] > 70, "Overbought",
            np.where(df["RSI_14"] < 30, "Oversold", "")
        )
        df["MACD_Signal"] = np.where(df["MACD_Hist"] > 0, "Bullish", "Bearish")
        df["Trend_Strength"] = np.where(df["ADX"] > 25, "Strong Trend", "Weak Trend")
        df["BB_Signal"] = np.where(
            df["Close"] > df["BB_High"], "Above Upper Band",
            np.where(df["Close"] < df["BB_Low"], "Below Lower Band", "")
        )

        # Clean remaining NaNs
        df.replace([np.inf, -np.inf], np.nan, inplace=True)
        df.fillna("", inplace=True)

        print(f"✅ Final Data: {len(df)} rows | {df['Date'].iloc[0]} → {df['Date'].iloc[-1]}")
        print(f"🕯️ {len(candle_funcs)} candlestick columns added.")

        # === Excel Export ===
        output = BytesIO()
        with pd.ExcelWriter(output, engine="xlsxwriter") as writer:
            df.to_excel(writer, index=False, sheet_name="StockData")
            workbook = writer.book
            worksheet = writer.sheets["StockData"]

            header_format = workbook.add_format({
                "bold": True,
                "text_wrap": True,
                "valign": "top",
                "fg_color": "#007ACC",
                "font_color": "white",
                "border": 1
            })

            for col_num, value in enumerate(df.columns.values):
                worksheet.write(0, col_num, value, header_format)
                worksheet.set_column(col_num, col_num, 14)

        output.seek(0)
        filename = f"{symbol}_{start}_to_{end}_TechnicalData.xlsx"

        return send_file(
            output,
            as_attachment=True,
            download_name=filename,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    except Exception as e:
        print("❌ Excel Download Error:", e)
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500

# =======================================
# 🧠 LSTM + ReLU Model Utilities
# =======================================
def set_seed(seed=42):
    os.environ["PYTHONHASHSEED"] = str(seed)
    np.random.seed(seed)
    random.seed(seed)
    tf.random.set_seed(seed)

set_seed(42)

MODEL_DIR = "models"
os.makedirs(MODEL_DIR, exist_ok=True)

def build_lstm_model(input_shape):
    model = Sequential([
        LSTM(128, return_sequences=True, input_shape=input_shape),
        Dropout(0.2),
        LSTM(128),
        Dropout(0.2),
        Dense(64),
        Activation("relu"),
        Dense(1)
    ])
    model.compile(optimizer="adam", loss="mean_squared_error")
    return model

def train_and_save_model(symbol, df):
    print(f"🧠 Training new LSTM+ReLU model for {symbol}...")
    scaler = MinMaxScaler(feature_range=(0, 1))
    # ✅ Use consistent 5 features in both train & predict
    scaled = scaler.fit_transform(df[["Open", "High", "Low", "Close", "Volume"]])

    X, y = [], []
    for i in range(60, len(scaled)):
        X.append(scaled[i - 60:i])
        y.append(scaled[i, 0])
    X, y = np.array(X), np.array(y)

    model = build_lstm_model((X.shape[1], X.shape[2]))
    model.fit(X, y, epochs=40, batch_size=32, verbose=1)

    model_path = os.path.join(MODEL_DIR, f"lstm_relu_{symbol.lower()}.h5")
    scaler_path = os.path.join(MODEL_DIR, f"scaler_{symbol.lower()}.pkl")
    model.save(model_path)
    joblib.dump(scaler, scaler_path)
    print(f"💾 Model and scaler saved for {symbol}.")
    return model, scaler

# =======================================
# 🔮 LSTM Prediction (ReLU version)
# =======================================
@app.route("/api/predict-lstm", methods=["POST"])
def predict_lstm():
    try:
        symbol = request.form.get("symbol") or (request.json and request.json.get("symbol"))
        if not symbol:
            return jsonify({"error": "Stock symbol is required"}), 400

        model_path = os.path.join(MODEL_DIR, f"lstm_relu_{symbol.lower()}.h5")
        scaler_path = os.path.join(MODEL_DIR, f"scaler_{symbol.lower()}.pkl")

        # Load uploaded Excel or fetch from Yahoo Finance
        if "file" in request.files:
            file = request.files["file"]
            df = pd.read_excel(file) if file.filename.endswith(".xlsx") else pd.read_csv(file)
        else:
            data = request.get_json()
            start = data.get("start")
            end = data.get("end")
            df = yf.download(f"{symbol}.NS", start=start, end=end, auto_adjust=True)

        df.dropna(subset=["Open", "High", "Low", "Close", "Volume"], inplace=True)
        df.reset_index(drop=True, inplace=True)

        # Load or train model
        if os.path.exists(model_path) and os.path.exists(scaler_path):
            print(f"📦 Loading existing model and scaler for {symbol}...")
            model = load_model(model_path)
            scaler = joblib.load(scaler_path)
        else:
            model, scaler = train_and_save_model(symbol, df)

        # Predict next day's open
        scaled = scaler.transform(df[["Open", "High", "Low", "Close", "Volume"]])
        last_60 = scaled[-60:]
        next_input = np.expand_dims(last_60, axis=0)
        predicted_scaled = model.predict(next_input, verbose=0)
        predicted_open = scaler.inverse_transform(
            np.concatenate([predicted_scaled, np.zeros((1, 4))], axis=1)
        )[0, 0]

        print(f"✅ Predicted Open for {symbol}: {predicted_open:.2f}")
        return jsonify({
            "symbol": symbol.upper(),
            "predicted_open": round(float(predicted_open), 2),
            "rows_used": len(df),
            "status": "success"
        })

    except Exception as e:
        print("❌ Prediction Error:", e)
        return jsonify({"error": str(e)}), 500

# =======================================
# 🤖 TRANSFORMER MODEL (Attention-based)
# =======================================
from tensorflow.keras.layers import (
    Input,
    Dense,
    LayerNormalization,
    MultiHeadAttention,
    Dropout,
    Flatten,
    Add,
)
from tensorflow.keras.models import Model

def build_transformer_model(input_shape):
    """
    Transformer Encoder (version-safe for all TensorFlow releases).
    """
    inputs = Input(shape=input_shape)
    attn = MultiHeadAttention(num_heads=4, key_dim=input_shape[-1])
    try:
        attention_output = attn(query=inputs, key=inputs, value=inputs)
    except TypeError:
        attention_output = attn(inputs, inputs)

    x = Add()([inputs, attention_output])
    x = LayerNormalization(epsilon=1e-6)(x)

    ff = Dense(128, activation="relu")(x)
    ff = Dropout(0.2)(ff)
    ff = Dense(input_shape[-1])(ff)

    x = Add()([x, ff])
    x = LayerNormalization(epsilon=1e-6)(x)

    x = Flatten()(x)
    x = Dense(64, activation="relu")(x)
    x = Dropout(0.2)(x)
    outputs = Dense(1)(x)

    model = Model(inputs, outputs)
    model.compile(optimizer="adam", loss="mean_squared_error")
    return model

def train_and_save_transformer(symbol, df):
    print(f"🧠 Training new Transformer model for {symbol}...")
    scaler = MinMaxScaler(feature_range=(0, 1))
    data = scaler.fit_transform(df[["Open", "High", "Low", "Close", "Volume"]])

    X, y = [], []
    for i in range(60, len(data)):
        X.append(data[i-60:i])
        y.append(data[i, 0])
    X, y = np.array(X), np.array(y)

    model = build_transformer_model((X.shape[1], X.shape[2]))
    model.fit(X, y, epochs=20, batch_size=32, verbose=1)

    model_path = os.path.join(MODEL_DIR, f"transformer_{symbol.lower()}.h5")
    scaler_path = os.path.join(MODEL_DIR, f"transformer_scaler_{symbol.lower()}.pkl")
    model.save(model_path)
    joblib.dump(scaler, scaler_path)
    print(f"💾 Transformer model and scaler saved for {symbol}.")
    return model, scaler

@app.route("/api/predict-transformer", methods=["POST"])
def predict_transformer():
    try:
        if "file" in request.files:
            file = request.files["file"]
            symbol = request.form.get("symbol", "CUSTOM")
            df = pd.read_excel(file) if file.filename.endswith(".xlsx") else pd.read_csv(file)
        else:
            data = request.form or request.get_json(silent=True) or {}
            symbol = data.get("symbol", "CUSTOM")
            start = data.get("start", "1925-01-01")
            end = data.get("end", datetime.now().strftime("%Y-%m-%d"))
            df = yf.download(f"{symbol}.NS", start=start, end=end, auto_adjust=True)

        df = df.dropna(subset=["Open", "High", "Low", "Close", "Volume"])
        df.reset_index(drop=True, inplace=True)

        model_path = os.path.join(MODEL_DIR, f"transformer_{symbol.lower()}.h5")
        scaler_path = os.path.join(MODEL_DIR, f"transformer_scaler_{symbol.lower()}.pkl")

        if os.path.exists(model_path) and os.path.exists(scaler_path):
            print(f"📦 Loading existing Transformer model for {symbol}...")
            model = load_model(model_path)
            scaler = joblib.load(scaler_path)
        else:
            model, scaler = train_and_save_transformer(symbol, df)

        scaled = scaler.transform(df[["Open", "High", "Low", "Close", "Volume"]])
        last_60 = scaled[-60:]
        next_input = np.expand_dims(last_60, axis=0)

        predicted_scaled = model.predict(next_input, verbose=0)
        predicted_open = scaler.inverse_transform(
            np.concatenate([predicted_scaled, np.zeros((1, 4))], axis=1)
        )[0, 0]

        print(f"✅ Predicted Open for {symbol}: {predicted_open:.2f}")
        return jsonify({
            "symbol": symbol.upper(),
            "predicted_open": round(float(predicted_open), 2),
            "rows_used": len(df),
            "status": "success"
        })
    except Exception as e:
        print("❌ Transformer Prediction Error:", e)
        return jsonify({"error": str(e)}), 500

# ================================
# 🧭 FRONTEND ROUTING
# ================================
@app.errorhandler(404)
def not_found(e):
    return send_from_directory(FRONTEND_DIR, "index.html")

import requests, math, time, random, yfinance as yf
from flask import jsonify, make_response
from datetime import datetime
from zoneinfo import ZoneInfo

_last_market_data = None
_last_market_time = 0

@app.route("/api/index-summary", methods=["GET"])
def index_summary():
    """
    Fetch index data from Yahoo. Falls back to yfinance if rate-limited.
    Caches results to avoid hitting 429 Too Many Requests.
    """
    global _last_market_data, _last_market_time

    INDEX_MAP = {
        "Nifty 50": "^NSEI",
        "Sensex": "^BSESN",
        "Bank Nifty": "^NSEBANK",
        "Nifty Next 50": "^NSMIDCP",
    }

    now = time.time()
    cache_ttl = 300  # 5 minutes
    as_of = datetime.now(ZoneInfo("Asia/Kolkata")).isoformat()

    # ✅ Serve cached data if still fresh
    if _last_market_data and (now - _last_market_time) < cache_ttl:
        print("🟢 Using cached market data")
        resp = make_response(jsonify(_last_market_data))
        resp.headers["Cache-Control"] = "no-store"
        return resp

    try:
        # Random delay to avoid rate-limit bursts
        time.sleep(random.uniform(0.2, 0.8))

        symbols = ",".join(INDEX_MAP.values())
        url = f"https://query1.finance.yahoo.com/v7/finance/quote?symbols={requests.utils.quote(symbols)}"
        r = requests.get(url, timeout=8)

        if r.status_code == 429:
            raise requests.exceptions.HTTPError("429 Too Many Requests")

        r.raise_for_status()
        data = r.json().get("quoteResponse", {}).get("result", [])
        by_symbol = {row.get("symbol"): row for row in data}

        summary = {}
        total_change = total_percent = 0.0
        count = 0

        def clean(x):
            if x is None or (isinstance(x, float) and math.isnan(x)):
                return None
            return round(float(x), 2)

        for name, sym in INDEX_MAP.items():
            q = by_symbol.get(sym, {}) or {}
            open_  = clean(q.get("regularMarketOpen"))
            high   = clean(q.get("regularMarketDayHigh"))
            low    = clean(q.get("regularMarketDayLow"))
            close  = clean(q.get("regularMarketPrice"))
            prev   = clean(q.get("regularMarketPreviousClose"))
            change = clean(q.get("regularMarketChange")) or (round(close - prev, 2) if close and prev else 0)
            pct    = clean(q.get("regularMarketChangePercent")) or (round((change/prev)*100, 2) if prev else 0)
            direction = "up" if change >= 0 else "down"

            summary[name] = {
                "symbol": sym,
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "prevClose": prev,
                "change": change,
                "percent": pct,
                "direction": direction,
                "source": "yahoo.quote"
            }

            total_change += change
            total_percent += pct
            count += 1

    except Exception as e:
        print("⚠️ Yahoo API error:", e)
        # 🔁 fallback to yfinance if quote API fails
        summary = {}
        total_change = total_percent = 0.0
        count = 0

        for name, ticker in INDEX_MAP.items():
            try:
                data = yf.download(ticker, period="5d", interval="1d", progress=False)
                if len(data) >= 2:
                    prev_close = float(data["Close"].iloc[-2])
                    latest = data.iloc[-1]
                    close_price = float(latest["Close"])
                    open_price = float(latest["Open"])
                    high_price = float(latest["High"])
                    low_price = float(latest["Low"])

                    change = round(close_price - prev_close, 2)
                    percent = round((change / prev_close) * 100, 2)
                    direction = "up" if change >= 0 else "down"

                    summary[name] = {
                        "symbol": ticker,
                        "open": open_price,
                        "high": high_price,
                        "low": low_price,
                        "close": close_price,
                        "prevClose": prev_close,
                        "change": change,
                        "percent": percent,
                        "direction": direction,
                        "source": "yfinance"
                    }

                    total_change += change
                    total_percent += percent
                    count += 1
            except Exception as inner_e:
                summary[name] = {"symbol": ticker, "error": str(inner_e)}

    # ✅ Market Summary
    if count:
        avg_percent = round(total_percent / count, 2)
        direction = "up" if avg_percent >= 0 else "down"
        icon = "▲" if direction == "up" else "▼"
        market_summary = {
            "title": f"{icon} Market {'Gain' if direction == 'up' else 'Loss'}",
            "avg_percent": avg_percent,
            "total_change": round(total_change, 2),
            "direction": direction,
        }
    else:
        market_summary = {"title": "Market Data Unavailable", "direction": "neutral"}

    payload = {
        "status": "success",
        "indices": summary,
        "marketSummary": market_summary,
        "asOf": as_of,
    }

    _last_market_data = payload
    _last_market_time = now

    resp = make_response(jsonify(payload))
    resp.headers["Cache-Control"] = "no-store"
    return resp

# =====================================
# 🔐 STEP 1: Redirect user to Upstox Login
# =====================================
@app.route("/auth/login")
def auth_login():
    """Redirect user to Upstox OAuth login page."""
    auth_url = (
        f"{UPSTOX_API_BASE}/login/authorization/dialog"
        f"?client_id={UPSTOX_CLIENT_ID}"
        f"&redirect_uri={UPSTOX_REDIRECT_URI}"
        f"&response_type=code"
    )
    print(f"🔗 Redirecting to Upstox login: {auth_url}")
    return redirect(auth_url)

@app.route("/", methods=["GET"])
def handle_root_or_callback():
    """Handle normal frontend requests and Upstox OAuth callback."""
    code = request.args.get("code")

    # If Upstox redirects with ?code=XYZ → exchange token
    if code:
        print(f"📩 Received OAuth code from Upstox: {code}")

        token_url = f"{UPSTOX_API_BASE}/login/authorization/token"
        payload = {
            "code": code,
            "client_id": UPSTOX_CLIENT_ID,
            "client_secret": UPSTOX_CLIENT_SECRET,
            "redirect_uri": UPSTOX_REDIRECT_URI,
            "grant_type": "authorization_code",
        }

        try:
            res = requests.post(token_url, data=payload, timeout=15)
            token_data = res.json()
            print("🧾 Token exchange result:", token_data)

            if res.status_code == 200 and "access_token" in token_data:
                save_tokens(token_data)
                update_env_access_token()

                # Restart streamer and index feed
                global sdk_streamer
                try:
                    if sdk_streamer:
                        sdk_streamer.shutdown()
                except Exception:
                    pass

                sdk_streamer = UpstoxStreamer(os.environ["UPSTOX_ACCESS_TOKEN"])
                sdk_streamer.start()
                start_index_feed()

                return redirect(f"/login-success?token={token_data['access_token']}")

            print("❌ Token exchange failed:", token_data)
            return f"<h3>Token exchange failed</h3><pre>{token_data}</pre>", 400

        except Exception as e:
            print("💥 Exception during token exchange:", e)
            return f"<h3>Server error</h3><pre>{e}</pre>", 500

    # ✅ If no code, check if token is still fresh (you have logged in today)
    if token_is_fresh():
        print("🟢 Token valid — skipping Upstox login and serving dashboard.")
        return send_from_directory(FRONTEND_DIR, "index.html")

    # 🔄 Token expired or missing → redirect to Upstox login
    print("🔴 Token missing or expired — redirecting to Upstox login.")
    return redirect("/auth/login")


@app.route("/login-success")
def serve_login_success():
    response = send_from_directory(FRONTEND_DIR, "index.html")
    response.headers["Cache-Control"] = "no-store"
    return response

# =====================================
# 🧾 MANUAL CODE ENTRY PAGE
# =====================================
@app.route("/enter-code", methods=["GET"])
def enter_code_page():
    """Render manual Upstox code entry page (prefilled if ?code= is present)."""
    prefill = request.args.get("code", "")
    html = f"""
    <html>
    <head>
      <title>Enter Upstox Authorization Code</title>
      <style>
        body {{
          font-family: Arial, sans-serif;
          background: linear-gradient(135deg, #dbeafe, #ede9fe);
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
        }}
        .container {{
          background: white;
          border-radius: 16px;
          padding: 40px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1);
          text-align: center;
          width: 400px;
        }}
        input {{
          width: 100%;
          padding: 10px;
          margin-top: 15px;
          font-size: 16px;
          border: 1px solid #ccc;
          border-radius: 8px;
        }}
        button {{
          margin-top: 20px;
          padding: 10px 20px;
          background-color: #2563eb;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          cursor: pointer;
        }}
        button:hover {{ background-color: #1d4ed8; }}
        h2 {{ color: #1e3a8a; }}
      </style>
    </head>
    <body>
      <div class="container">
        <h2>Enter Upstox Authorization Code</h2>
        <form action="/exchange-token" method="POST">
          <input type="text" name="code" value="{prefill}" placeholder="Paste your Upstox code here" required />
          <button type="submit">Exchange & Save Token</button>
        </form>
      </div>
    </body>
    </html>
    """
    return html

# =====================================
# 🔄 EXCHANGE CODE → TOKEN & SAVE
# =====================================
@app.route("/exchange-token", methods=["POST"])
def exchange_token():
    """Exchange Upstox code for access token and save to .env."""
    code = request.form.get("code")
    if not code:
        return "❌ Missing authorization code", 400

    print(f"📤 Exchanging Upstox code: {code[:6]}...")
    token_url = f"{UPSTOX_API_BASE}/login/authorization/token"

    payload = {
        "code": code,
        "client_id": UPSTOX_CLIENT_ID,
        "client_secret": UPSTOX_CLIENT_SECRET,
        "redirect_uri": UPSTOX_REDIRECT_URI,  # no slash
        "grant_type": "authorization_code",
    }

    try:
        res = requests.post(token_url, data=payload, timeout=15)
        data = res.json()

        if res.status_code == 200 and "access_token" in data:
            access_token = data["access_token"]
            print(f"✅ Token received: {access_token[:12]}...")

            save_tokens(data)
            update_env_access_token()

            # 🔄 (Re)start streamer and index feed
            global sdk_streamer
            try:
                if sdk_streamer:
                    sdk_streamer.shutdown()
            except Exception:
                pass
            sdk_streamer = UpstoxStreamer(os.environ["UPSTOX_ACCESS_TOKEN"])
            sdk_streamer.start()
            start_index_feed()

            return f"""
            <html><body style="text-align:center;margin-top:80px;font-family:sans-serif;">
              <h2 style="color:green;">✅ Token Saved Successfully!</h2>
              <p>Access Token (first 10 chars): <b>{access_token[:10]}...</b></p>
              <a href="/">Go to Dashboard</a>
            </body></html>
            """
        else:
            return f"<h3 style='color:red;'>❌ Token Exchange Failed</h3><pre>{data}</pre>", 400

    except Exception as e:
        print("💥 Error exchanging token:", e)
        return f"<h3 style='color:red;'>Server Error:</h3><pre>{e}</pre>", 500

# ===== Create WS streamer if we have a valid token =====
sdk_streamer = None
if UPSTOX_ACCESS_TOKEN and len(UPSTOX_ACCESS_TOKEN) >= 20:
    sdk_streamer = UpstoxStreamer(UPSTOX_ACCESS_TOKEN)
    sdk_streamer.start()
    start_index_feed()
else:
    print("⏸️ Not starting UpstoxStreamer — no valid access token yet.")

# ================================
# 🚀 MAIN
# ================================
if __name__ == "__main__":
    print("🚀 Server running at http://localhost:5000")
    socketio.run(
        app,
        host="0.0.0.0",
        port=5000,
        debug=True,
        allow_unsafe_werkzeug=True
    )
