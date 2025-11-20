import React, { useState, useEffect, useMemo } from "react";
import DatePicker from "react-datepicker";
import { format } from "date-fns";
import "react-datepicker/dist/react-datepicker.css";
import Fuse from "fuse.js";
import DOMPurify from "dompurify";
import { useTheme } from "../context/ThemeContext";
import SkeletonLoader from "../components/SkeletonLoader";



// ✅ Major Indexes
const INDEX_LIST = [
    { name: "NIFTY 50", symbol: "^NSEI", display: "Nifty 50", color: "text-blue-500" },
    { name: "SENSEX", symbol: "^BSESN", display: "Sensex", color: "text-orange-500" },
    { name: "BANK NIFTY", symbol: "^NSEBANK", display: "Bank Nifty", color: "text-green-500" },
    { name: "NIFTY NEXT 50", symbol: "^NSMIDCP", display: "Nifty Next 50", color: "text-purple-500" },
];

export default function Dashboard() {
    const { theme } = useTheme();
    const isLight = theme === "light";

    const [instruments, setInstruments] = useState([]);
    const [prices, setPrices] = useState({});
    const [priceChange, setPriceChange] = useState({});
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [watchlist, setWatchlist] = useState([]);
    const [selectedSymbol, setSelectedSymbol] = useState("");
    const [startDate, setStartDate] = useState(null);
    const [endDate, setEndDate] = useState(null);
    const [isConnected, setIsConnected] = useState(true);
    const [indexData, setIndexData] = useState({});
    const [marketSummary, setMarketSummary] = useState(null);
    const [asOf, setAsOf] = useState(null);
    const [toast, setToast] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    // 🔍 Helper: find LTP for a symbol (even if backend sends instrumentKey)
    const getLtpForSymbol = (symbol) => {
        if (!symbol || !prices) return "--";
        for (const [key, val] of Object.entries(prices)) {
            if (key.toUpperCase().includes(symbol.toUpperCase())) {
                return val?.ltp ?? "--";
            }
        }
        return "--";
    };


    // 🔁 Debounce search
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    // 🧠 Load watchlist
    useEffect(() => {
        const saved = localStorage.getItem("watchlist");
        if (saved) setWatchlist(JSON.parse(saved));
    }, []);

    // 📦 Load instruments
    useEffect(() => {
        fetch("http://localhost:5000/api/instruments")
            .then((res) => res.json())
            .then((data) => {
                if (Array.isArray(data.instruments)) setInstruments(data.instruments);
            })
            .catch(() => setInstruments([]));
    }, []);


    useEffect(() => {
        const ws = new WebSocket("ws://localhost:9000");

        ws.onopen = () => {
            console.log("WS connected");
            setIsConnected(true);
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                console.log("📈 Tick:", msg);

                const symbol = msg.symbol || msg.instrument_key;
                const ltp = msg.ltp;

                setPrices((prev) => ({
                    ...prev,
                    [symbol]: { ltp },
                }));

                setPriceChange((prev) => ({
                    ...prev,
                    [symbol]: prev[symbol]?.ltp <= ltp ? "up" : "down",
                }));
            } catch (err) {
                console.error("WS parse error:", err);
            }
        };

        ws.onclose = () => setIsConnected(false);
        ws.onerror = () => setIsConnected(false);

        return () => ws.close();
    }, []);

    // 🏦 Fetch Index Data
    useEffect(() => {
        let requestId = 0;
        let timer;
        let controller;

        const fetchIndexes = async () => {
            const myId = ++requestId;
            controller?.abort();
            controller = new AbortController();
            setIsLoading(true);

            try {
                const backendRes = await fetch("http://localhost:5000/api/index-summary", {
                    signal: controller.signal,
                    cache: "no-store",
                });

                if (backendRes.ok) {
                    const backendData = await backendRes.json();

                    if (backendData?.status === "success" && backendData.indices) {
                        if (myId !== requestId) return;

                        const normalized = {};
                        for (const [name, data] of Object.entries(backendData.indices)) {
                            if (!data?.symbol) continue;
                            normalized[data.symbol] = {
                                ltp: data.close,
                                open: data.open,
                                high: data.high,
                                low: data.low,
                                prevClose: data.prevClose,
                                change: data.change,
                                percent: data.percent,
                                direction: data.direction,
                                displayName: name,
                            };
                        }

                        setIndexData(normalized);
                        setMarketSummary(backendData.marketSummary ?? null);
                        setAsOf(backendData.asOf ?? null);
                        setIsLoading(false);
                        return;
                    }
                }

                await yahooFallback();
            } catch (err) {
                if (err.name === "AbortError") return;
                console.error("❌ Backend fetch failed, using fallback:", err);
                await yahooFallback();
            } finally {
                setIsLoading(false);
            }
        };

        const yahooFallback = async () => {
            const results = {};
            for (const idx of INDEX_LIST) {
                const encoded = idx.symbol.replace("^", "%5E");
                const quoteRes = await fetch(
                    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encoded}`,
                    { cache: "no-store" }
                );
                const q = (await quoteRes.json())?.quoteResponse?.result?.[0] || {};

                results[idx.symbol] = {
                    ltp: q.regularMarketPrice ?? "--",
                    open: q.regularMarketOpen ?? "--",
                    high: q.regularMarketDayHigh ?? "--",
                    low: q.regularMarketDayLow ?? "--",
                    prevClose: q.regularMarketPreviousClose ?? "--",
                    change: q.regularMarketChange ?? 0,
                    percent: q.regularMarketChangePercent ?? 0,
                    direction: (q.regularMarketChange ?? 0) >= 0 ? "up" : "down",
                    displayName: idx.display,
                };
            }

            setIndexData(results);
            setMarketSummary({
                title: "▲ Market Data (Fallback)",
                avg_percent: "--",
                direction: "neutral",
            });
            setAsOf(new Date().toISOString());
        };

        fetchIndexes();
        timer = setInterval(fetchIndexes, 300000); // every 5 mins

        return () => {
            controller?.abort();
            clearInterval(timer);
        };
    }, []);

    // 🕒 Auto-hide toast
    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    // 🔍 Fuzzy search setup
    const fuse = useMemo(
        () =>
            new Fuse(instruments, {
                keys: ["symbol", "name", "short_name"],
                threshold: 0.3,
            }),
        [instruments]
    );

    const filtered =
        debouncedSearch.trim().length > 0
            ? fuse.search(debouncedSearch).map((r) => r.item)
            : [];

    const highlightMatch = (text, query) => {
        if (!query) return DOMPurify.sanitize(text);
        const regex = new RegExp(`(${query})`, "gi");
        return DOMPurify.sanitize(text.replace(regex, "<mark>$1</mark>"));
    };

    // 📡 Subscribe to stock (via Backend REST API)
    const subscribeToStock = async (inst) => {
        console.log("🛰️ Subscribing via API:", inst.symbol);

        try {
            const res = await fetch(
                `http://localhost:5000/api/ws-subscribe?symbol=${inst.symbol}`
            );

            const data = await res.json();
            console.log("WS Subscribe API Response:", data);

            if (data?.status === "subscribed") {
                setSelectedSymbol(inst.symbol);
            } else {
                console.error("❌ Subscription failed:", data);
            }
        } catch (err) {
            console.error("❌ Error subscribing:", err);
        }

        setSearch("");
        setDebouncedSearch("");
    };


    // ⭐ Watchlist toggle
    const toggleWatchlist = (inst) => {
        const exists = watchlist.find((s) => s.symbol === inst.symbol);
        const updated = exists
            ? watchlist.filter((s) => s.symbol !== inst.symbol)
            : [...watchlist, inst];
        setWatchlist(updated);
        localStorage.setItem("watchlist", JSON.stringify(updated));
    };

    // 📥 Download Excel
    const downloadExcel = async () => {
        if (!selectedSymbol || !startDate || !endDate) {
            setToast("⚠️ Please select a stock and a valid date range.");
            return;
        }

        const s = format(startDate, "yyyy-MM-dd");
        const e = format(endDate, "yyyy-MM-dd");

        try {
            const res = await fetch(
                `http://localhost:5000/api/history/download?symbol=${selectedSymbol}&start=${s}&end=${e}`
            );

            if (!res.ok) {
                const data = await res.json();
                setToast(data.error || "❌ Unable to generate Excel file. Try again later.");
                return;
            }

            window.open(res.url, "_blank");
        } catch (err) {
            console.error("Excel download error:", err);
            setToast("⚠️ Something went wrong while fetching stock history.");
        }
    };

    // ================= Render =================
    if (isLoading) {
        return (
            <div
                className={`min-h-screen ${isLight ? "bg-gray-50 text-gray-800" : "bg-[#0b0f19] text-gray-100"
                    }`}
            >
                <SkeletonLoader />
            </div>
        );
    }

    return (
        <div
            className={`p-8 min-h-screen relative transition-colors duration-500 ${isLight
                ? "bg-gradient-to-br from-gray-50 via-white to-blue-50 text-gray-900"
                : "bg-[#0b0f19] text-gray-100"
                }`}
        >
            {/* 🔔 Toast Message */}
            {toast && (
                <div
                    className={`fixed top-6 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-xl shadow-lg text-white text-center text-lg font-semibold transition-all duration-500 ${toast.includes("⚠️") || toast.includes("❌")
                        ? "bg-red-500"
                        : "bg-green-500"
                        }`}
                >
                    {toast}
                </div>
            )}

            {/* 💹 Market Summary */}
            {marketSummary && (
                <div
                    className={`mb-10 mx-auto w-full max-w-lg text-center rounded-2xl shadow-md p-6 transition-all duration-500 border ${marketSummary.direction === "up"
                        ? "bg-green-100 text-green-800 border-green-300"
                        : marketSummary.direction === "down"
                            ? "bg-red-100 text-red-800 border-red-300"
                            : "bg-gray-100 text-gray-700 border-gray-300"
                        }`}
                >
                    <h2 className="text-2xl font-bold flex justify-center items-center gap-2">
                        {marketSummary.direction === "up" ? "▲" : "▼"} {marketSummary.title}
                    </h2>
                    <p className="text-xl font-semibold mt-2">
                        ₹{marketSummary.total_change?.toLocaleString("en-IN") ?? "--"}{" "}
                        ({marketSummary.avg_percent ?? "--"}%)
                    </p>
                    {asOf && (
                        <p className="text-sm text-gray-500 mt-2">
                            Updated at {new Date(asOf).toLocaleTimeString("en-IN")}
                        </p>
                    )}
                </div>
            )}

            {/* 🏷️ Header */}
            <h2
                className={`text-4xl font-extrabold mb-8 ${isLight ? "text-blue-700" : "text-blue-400"
                    }`}
            >
                📈 Indian Market Dashboard
            </h2>

            {/* 🔹 Index Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
                {INDEX_LIST.map((idx) => {
                    const data = indexData[idx.symbol] || {};
                    const ltp = data.ltp ?? "--";
                    const change = data.change ?? 0;
                    const percent = data.percent ?? 0;
                    const isUp = change >= 0;

                    return (
                        <div
                            key={idx.symbol}
                            className={`p-5 rounded-2xl border text-center shadow-md ${isLight
                                ? "bg-white border-gray-200"
                                : "bg-[#161b22] border-gray-700"
                                }`}
                        >
                            <p className={`font-bold text-lg ${idx.color}`}>{idx.display}</p>
                            <p className="text-2xl font-extrabold mt-2">
                                ₹ {ltp?.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </p>
                            <p
                                className={`mt-1 font-semibold ${isUp ? "text-green-500" : "text-red-500"
                                    }`}
                            >
                                {isUp ? "▲" : "▼"} {change.toFixed(2)} ({percent.toFixed(2)}%)
                            </p>
                        </div>
                    );
                })}
            </div>

            {/* 🔍 Search Box */}
            <div className="flex justify-center mb-8">
                <input
                    type="text"
                    placeholder="🔎 Search for a stock (e.g., TCS, INFY, RELIANCE)..."
                    className={`w-full max-w-xl p-3 rounded-2xl shadow-md outline-none border text-lg ${isLight
                        ? "bg-white border-gray-200 focus:border-blue-400"
                        : "bg-[#161b22] border-gray-700 focus:border-blue-400"
                        }`}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            {/* Search Results */}
            {debouncedSearch && (
                <div className="max-w-4xl mx-auto">
                    {filtered.length === 0 ? (
                        <p className="text-center text-gray-500 italic">No stocks found.</p>
                    ) : (
                        <ul
                            className={`divide-y rounded-2xl shadow-md border ${isLight
                                ? "bg-white border-gray-200 divide-gray-100"
                                : "bg-[#161b22] border-gray-700 divide-gray-800"
                                }`}
                        >
                            {filtered.slice(0, 50).map((inst) => {
                                const ltp = getLtpForSymbol(inst.symbol);
                                const isUp = priceChange[inst.symbol] === "up";
                                const isDown = priceChange[inst.symbol] === "down";
                                const inWatchlist = watchlist.some((s) => s.symbol === inst.symbol);

                                return (
                                    <li
                                        key={inst.symbol}
                                        onClick={() => subscribeToStock(inst)}
                                        className="flex justify-between items-center px-4 py-3 cursor-pointer hover:bg-blue-50 dark:hover:bg-[#1b2332]"
                                    >
                                        <div>
                                            <p
                                                className="font-semibold text-lg"
                                                dangerouslySetInnerHTML={{
                                                    __html: highlightMatch(inst.symbol, debouncedSearch),
                                                }}
                                            />
                                            <p
                                                className="text-sm text-gray-500"
                                                dangerouslySetInnerHTML={{
                                                    __html: highlightMatch(inst.name, debouncedSearch),
                                                }}
                                            />
                                        </div>

                                        <div className="text-right">
                                            <p
                                                className={`font-bold ${isUp
                                                    ? "text-green-500"
                                                    : isDown
                                                        ? "text-red-500"
                                                        : "text-gray-400"
                                                    }`}
                                            >
                                                ₹ {ltp !== "--" ? ltp.toLocaleString("en-IN") : "--"}
                                            </p>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleWatchlist(inst);
                                                }}
                                                className={`mt-1 px-2 py-1 text-xs rounded-full border ${inWatchlist
                                                    ? "bg-green-500 text-white border-green-600"
                                                    : "border-gray-400 text-gray-500 hover:bg-gray-100 dark:hover:bg-[#1b2332]"
                                                    }`}
                                            >
                                                {inWatchlist ? "★ In Watchlist" : "☆ Add"}
                                            </button>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}

            {/* 📉 Downloader */}
            <div
                className={`mt-14 p-10 rounded-3xl shadow-xl border backdrop-blur-md ${isLight
                    ? "bg-white/80 border-gray-200 hover:shadow-2xl"
                    : "bg-[#161b22]/70 border-gray-700"
                    }`}
            >
                <h3
                    className={`text-3xl font-bold mb-6 ${isLight ? "text-blue-700" : "text-blue-400"
                        }`}
                >
                    📉 Stock History Downloader
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
                    <div>
                        <label className="block mb-2 font-medium">Symbol</label>
                        <input
                            type="text"
                            placeholder="e.g., TCS"
                            className={`w-full p-3 rounded-lg border focus:ring-2 ${isLight
                                ? "bg-white border-gray-300 text-gray-800 focus:ring-blue-400"
                                : "bg-[#1b2332] border-gray-600 text-gray-100 focus:ring-blue-500"
                                }`}
                            value={selectedSymbol}
                            onChange={(e) => setSelectedSymbol(e.target.value.toUpperCase())}
                        />
                    </div>

                    <div>
                        <label className="block mb-2 font-medium">Start Date</label>
                        <DatePicker
                            selected={startDate}
                            onChange={setStartDate}
                            dateFormat="dd/MM/yyyy"
                            placeholderText="DD/MM/YYYY"
                            showMonthDropdown
                            showYearDropdown
                            dropdownMode="select"
                            scrollableYearDropdown
                            yearDropdownItemNumber={100}
                            className={`w-full p-3 rounded-lg border ${isLight
                                ? "bg-white border-gray-300 text-gray-800 focus:ring-blue-400"
                                : "bg-[#1b2332] border-gray-600 text-gray-100 focus:ring-blue-500"
                                }`}
                            maxDate={endDate || new Date()}
                        />
                    </div>

                    <div>
                        <label className="block mb-2 font-medium">End Date</label>
                        <DatePicker
                            selected={endDate}
                            onChange={setEndDate}
                            dateFormat="dd/MM/yyyy"
                            placeholderText="DD/MM/YYYY"
                            showMonthDropdown
                            showYearDropdown
                            dropdownMode="select"
                            scrollableYearDropdown
                            yearDropdownItemNumber={100}
                            className={`w-full p-3 rounded-lg border ${isLight
                                ? "bg-white border-gray-300 text-gray-800 focus:ring-blue-400"
                                : "bg-[#1b2332] border-gray-600 text-gray-100 focus:ring-blue-500"
                                }`}
                            minDate={startDate || null}
                            maxDate={new Date()}
                        />
                    </div>

                    <div className="flex items-end">
                        <button
                            onClick={downloadExcel}
                            className="w-full py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-semibold hover:scale-[1.02]"
                        >
                            ⬇️ Download Excel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
