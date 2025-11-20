import React, { useState, useEffect, useMemo } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { format } from "date-fns";
import { Loader2, TrendingUp } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import Fuse from "fuse.js";

export default function LSTMPage() {
  const { theme } = useTheme();
  const isLight = theme === "light";

  const [symbol, setSymbol] = useState("");
  const [filtered, setFiltered] = useState([]);
  const [file, setFile] = useState(null);
  const [instruments, setInstruments] = useState([]);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [predicted, setPredicted] = useState(null);
  const [error, setError] = useState("");

  // 🟢 Fetch instruments from backend
  useEffect(() => {
    async function fetchInstruments() {
      try {
        const res = await fetch("/api/instruments");
        const data = await res.json();
        if (data.instruments) setInstruments(data.instruments);
        else setError("Failed to load instruments.");
      } catch (err) {
        setError("Error fetching instruments: " + err.message);
      }
    }
    fetchInstruments();
  }, []);

  // 🔍 Initialize Fuse.js
  const fuse = useMemo(() => {
    if (!instruments || instruments.length === 0) return null;
    return new Fuse(instruments, {
      keys: ["symbol", "name"],
      threshold: 0.4,
      distance: 100,
      minMatchCharLength: 1,
    });
  }, [instruments]);

  // 🔎 Handle fuzzy search
  const handleSearch = (value) => {
    setSymbol(value);
    if (value.length > 1 && fuse) {
      const results = fuse.search(value);
      const topMatches = results.map((r) => r.item).slice(0, 10);
      setFiltered(topMatches);
    } else {
      setFiltered([]);
    }
  };

  // 🚀 Run LSTM prediction
  const handlePredict = async () => {
    if (!symbol && !file) return setError("Please select a symbol or upload an Excel file");
    if (!file && (!startDate || !endDate))
      return setError("Please select both start and end dates");

    setLoading(true);
    setError("");
    setPredicted(null);

    try {
      let res;
      if (file) {
        // 🧾 Use FormData for file upload
        const formData = new FormData();
        formData.append("file", file);
        formData.append("symbol", symbol || "CUSTOM");

        res = await fetch("/api/predict-lstm", {
          method: "POST",
          body: formData,
        });
      } else {
        // 🧠 Standard date range prediction
        const body = {
          symbol: symbol.trim().toUpperCase(),
          start: format(startDate, "yyyy/MM/dd"),
          end: format(endDate, "yyyy/MM/dd"),
        };
        res = await fetch("/api/predict-lstm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      const data = await res.json();
      if (res.ok && data.predicted_open) setPredicted(data);
      else setError(data.error || "Prediction failed.");
    } catch (err) {
      setError("Request failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };


  return (
    <div
      className={`min-h-screen flex items-center justify-center transition-colors duration-500 px-4 ${isLight
        ? "bg-gradient-to-br from-white via-blue-50 to-gray-100 text-gray-900"
        : "bg-gradient-to-br from-[#0b0f19] via-[#111827] to-[#1e293b] text-gray-100"
        }`}
    >
      <div
        className={`w-full max-w-3xl rounded-3xl p-8 sm:p-10 shadow-2xl border backdrop-blur-xl transition-all duration-500 ${isLight
          ? "bg-white/80 border-gray-200 hover:shadow-blue-200/50"
          : "bg-white/10 border-gray-700 hover:shadow-blue-900/50"
          }`}
      >
        {/* 🧭 Header */}
        <div className="flex flex-col sm:flex-row items-center justify-center mb-8 gap-3 text-center sm:text-left">
          <TrendingUp
            size={40}
            className={isLight ? "text-blue-600" : "text-blue-400"}
          />
          <h1
            className={`text-3xl sm:text-4xl font-extrabold tracking-wide ${isLight ? "text-blue-700" : "text-blue-300"
              }`}
          >
            LSTM Stock Predictor
          </h1>
        </div>

        {/* 🔍 Stock Search */}
        <div className="mb-8 relative">
          <label
            className={`block mb-2 text-sm font-semibold ${isLight ? "text-gray-700" : "text-gray-300"
              }`}
          >
            Select Stock Symbol
          </label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search NSE symbol (e.g., TCS, INFY, RELIANCE)"
            className={`w-full p-3 rounded-xl border focus:outline-none focus:ring-2 transition-all ${isLight
              ? "bg-white border-gray-300 focus:ring-blue-400"
              : "bg-gray-800 border-gray-600 focus:ring-blue-500"
              }`}
          />
          {filtered.length > 0 && (
            <ul
              className={`absolute mt-1 w-full rounded-xl shadow-lg z-10 overflow-y-auto max-h-56 ${isLight
                ? "bg-white border border-gray-200"
                : "bg-gray-800 border border-gray-700"
                }`}
            >
              {filtered.map((inst) => (
                <li
                  key={inst.instrument_key}
                  onClick={() => {
                    setSymbol(inst.symbol);
                    setFiltered([]);
                  }}
                  className={`px-4 py-2 cursor-pointer transition-all ${isLight
                    ? "hover:bg-blue-100 text-gray-800"
                    : "hover:bg-blue-900/40 text-gray-200"
                    }`}
                >
                  <span className="font-semibold">{inst.symbol}</span> —{" "}
                  <span
                    className={`text-sm ${isLight ? "text-gray-500" : "text-gray-400"
                      }`}
                  >
                    {inst.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 📅 Date Pickers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
          <div>
            <label
              className={`block mb-2 text-sm font-semibold ${isLight ? "text-gray-700" : "text-gray-300"
                }`}
            >
              Start Date
            </label>
            <DatePicker
              selected={startDate ? new Date(startDate) : null}
              onChange={(date) => setStartDate(date)}
              dateFormat="dd/MM/yyyy"
              showMonthDropdown
              showYearDropdown
              dropdownMode="select"
              scrollableYearDropdown
              yearDropdownItemNumber={100}
              placeholderText="DD/MM/YYYY"
              className={`w-full p-3 rounded-lg border outline-none focus:ring-2 transition-all ${isLight
                ? "bg-white border-gray-300 text-gray-800 focus:ring-blue-400"
                : "bg-[#1b2332] border-gray-600 text-gray-100 focus:ring-blue-500"
                }`}
            />
          </div>

          <div>
            <label
              className={`block mb-2 text-sm font-semibold ${isLight ? "text-gray-700" : "text-gray-300"
                }`}
            >
              End Date
            </label>
            <DatePicker
              selected={endDate ? new Date(endDate) : null}
              onChange={(date) => setEndDate(date)}
              dateFormat="dd/MM/yyyy"
              showMonthDropdown
              showYearDropdown
              dropdownMode="select"
              scrollableYearDropdown
              yearDropdownItemNumber={100}
              placeholderText="DD/MM/YYYY"
              className={`w-full p-3 rounded-lg border outline-none focus:ring-2 transition-all ${isLight
                ? "bg-white border-gray-300 text-gray-800 focus:ring-blue-400"
                : "bg-[#1b2332] border-gray-600 text-gray-100 focus:ring-blue-500"
                }`}
            />
          </div>
        </div>
        {/* 📁 File Upload (optional) */}
        <div className="mb-6">
          <label
            className={`block mb-2 text-sm font-semibold ${isLight ? "text-gray-700" : "text-gray-300"
              }`}
          >
            Upload Custom Excel (optional)
          </label>
          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => setFile(e.target.files[0])}
            className={`w-full p-3 rounded-xl border cursor-pointer ${isLight
              ? "bg-white border-gray-300"
              : "bg-gray-800 border-gray-600"
              }`}
          />
          {file && (
            <p className="mt-1 text-xs text-blue-500 font-medium">
              Selected: {file.name}
            </p>
          )}
        </div>

        {/* 🚀 Run Button */}
        <div className="flex justify-center mt-6">
          <button
            onClick={handlePredict}
            disabled={loading}
            className={`w-64 py-2.5 text-base font-semibold rounded-lg transition-all flex justify-center items-center gap-2 shadow-md ${loading
              ? "opacity-70 cursor-wait"
              : "hover:scale-[1.02] active:scale-[0.98]"
              } ${isLight
                ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:shadow-lg"
                : "bg-gradient-to-r from-blue-500 to-indigo-700 text-white hover:shadow-blue-800/50"
              }`}
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin" /> Running LSTM...
              </>
            ) : (
              "🚀 Run LSTM Prediction"
            )}
          </button>
        </div>

        {/* ⚠️ Error Message */}
        {error && (
          <p className="text-red-500 mt-4 text-center text-sm font-medium">{error}</p>
        )}

        {/* ✅ Prediction Result */}
        {predicted && (
          <div
            className={`mt-8 p-6 rounded-2xl border shadow-lg text-center transition-all ${isLight
              ? "bg-gradient-to-br from-green-50 to-emerald-100 border-green-200 text-green-800"
              : "bg-gradient-to-br from-green-900/40 to-emerald-800/20 border-green-800 text-green-300"
              }`}
          >
            <h2 className="text-lg font-semibold mb-2">
              Predicted Next Day Open —{" "}
              <span className="font-bold text-blue-500">{predicted.symbol}</span>
            </h2>
            <p className="text-3xl font-extrabold">
              ₹ {predicted.predicted_open.toFixed(2)}
            </p>
            <p className="mt-2 text-xs opacity-80">
              Period: {predicted.start} → {predicted.end}
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
