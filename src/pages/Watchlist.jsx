import React, { useEffect, useState, useRef } from "react";
import { useTheme } from "../context/ThemeContext";

export default function Watchlist() {
    const { theme } = useTheme();
    const isLight = theme === "light";

    const [watchlist, setWatchlist] = useState([]);
    const [prices, setPrices] = useState({});
    const [priceChange, setPriceChange] = useState({});

    const wsRef = useRef(null);
    const reconnectTimer = useRef(null);

    // Load watchlist
    useEffect(() => {
        const saved = localStorage.getItem("watchlist");
        if (saved) setWatchlist(JSON.parse(saved));
    }, []);

    // -----------------------------
    // WS CONNECT
    // -----------------------------
    useEffect(() => {
        function connectWS() {
            console.log("🔄 Connecting → ws://localhost:9000");
            const ws = new WebSocket("ws://localhost:9000");
            wsRef.current = ws;

            ws.onopen = () => {
                console.log("🟢 WS Connected");

                if (watchlist.length > 0) {
                    const keys = watchlist.map((x) => x.instrument_key);
                    ws.send(JSON.stringify({ subscribe: keys }));
                    console.log("📡 Sent subscribe:", keys);
                }
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);

                    // Ignore heartbeat messages
                    if (msg?.data?.type === "market_info") return;

                    // Extract feeds (Upstox v3 format)
                    const feeds = msg?.data?.feeds;
                    if (!feeds) return;

                    Object.entries(feeds).forEach(([instrumentKey, feed]) => {
                        const ltp =
                            feed.fullFeed?.marketFF?.ltpc?.ltp ?? null;
                        if (ltp === null) return;

                        setPrices((prev) => {
                            const old = prev[instrumentKey]?.ltp;

                            const nextChange =
                                old === undefined
                                    ? "neutral"
                                    : ltp > old
                                        ? "up"
                                        : "down";

                            setPriceChange((pc) => ({
                                ...pc,
                                [instrumentKey]: nextChange,
                            }));

                            return {
                                ...prev,
                                [instrumentKey]: { ltp },
                            };
                        });
                    });
                } catch (e) {
                    console.error("❌ WS parse error:", e);
                }
            };

            ws.onclose = () => {
                console.warn("🔴 WS Closed. Reconnecting in 2s...");
                reconnectTimer.current = setTimeout(connectWS, 2000);
            };

            ws.onerror = (err) => {
                console.error("⚠️ WS Error:", err);
            };
        }

        connectWS();

        return () => {
            if (wsRef.current) wsRef.current.close();
            clearTimeout(reconnectTimer.current);
        };
    }, []);

    // -----------------------------
    // RESEND SUBSCRIBE WHEN WATCHLIST CHANGES
    // -----------------------------
    useEffect(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const keys = watchlist.map((x) => x.instrument_key);
            wsRef.current.send(JSON.stringify({ subscribe: keys }));
            console.log("📡 Re-subscribed:", keys);
        }
    }, [watchlist]);

    // Remove
    const removeFromWatchlist = (symbol) => {
        const updated = watchlist.filter((s) => s.symbol !== symbol);
        setWatchlist(updated);
        localStorage.setItem("watchlist", JSON.stringify(updated));
    };

    // -----------------------------
    // UI Rendering
    // -----------------------------
    return (
        <div className={`p-6 min-h-screen ${isLight ? "bg-gray-50 text-gray-900" : "bg-[#0b0f19] text-gray-100"}`}>
            <h2 className={`text-3xl font-bold mb-6 ${isLight ? "text-yellow-600" : "text-yellow-400"}`}>
                ⭐ My Watchlist
            </h2>

            {watchlist.length === 0 ? (
                <p className="text-center mt-20 text-gray-400">Your watchlist is empty!</p>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    {watchlist.map((inst) => {
                        const key = inst.instrument_key;
                        const ltp = prices[key]?.ltp ?? "--";
                        const trend = priceChange[key];

                        return (
                            <div
                                key={key}
                                className={`rounded-lg p-4 shadow-md border ${isLight
                                    ? "bg-white border-gray-200"
                                    : "bg-[#161b22] border-gray-700"
                                    }`}
                            >
                                <button
                                    onClick={() => removeFromWatchlist(inst.symbol)}
                                    className="absolute top-2 right-2 text-yellow-400 text-xl"
                                >
                                    ★
                                </button>

                                <h3 className="text-lg font-semibold">{inst.symbol}</h3>
                                <p className="text-xs text-gray-400">{inst.instrument_key}</p>

                                <p className={`text-xl mt-3 font-bold ${trend === "up"
                                    ? "text-green-500"
                                    : trend === "down"
                                        ? "text-red-500"
                                        : "text-blue-400"
                                    }`}>
                                    ₹ {ltp !== "--" ? ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "--.--"}
                                </p>

                                <p className="text-xs text-gray-400">
                                    {ltp === "--" ? "Waiting for ticks..." : "Real-time update"}
                                </p>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
