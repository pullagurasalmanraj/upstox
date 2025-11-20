// ✅ All imports at the top
import React, { useState, useEffect, useRef, Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useLocation,
  Navigate,
} from "react-router-dom";
import {
  LayoutDashboard,
  Star,
  Briefcase,
  Settings as SettingsIcon,
  ChevronDown,
  Moon,
  Sun,
  Brain,
  Cpu,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import Dashboard from "./pages/Dashboard";
import Watchlist from "./pages/Watchlist";
import Portfolio from "./pages/Portfolio";
import SettingsPage from "./pages/SettingsPage";
import LstmPredictor from "./pages/LstmPredictor";
import TransformerPredictor from "./pages/TransformerPredictor";
import Login from "./pages/Login";
import LoginSuccess from "./pages/LoginSuccess";
import { ThemeProvider, useTheme } from "./context/ThemeContext";

// ================================
// 💀 Professional Skeleton Loader
// ================================
function SkeletonLoader() {
  const shimmer =
    "animate-pulse bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 dark:from-gray-700 dark:via-gray-800 dark:to-gray-700";

  return (
    <div className="p-10">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        {[...Array(4)].map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`p-5 rounded-2xl border text-center shadow-md ${shimmer}`}
            style={{ height: "150px" }}
          ></motion.div>
        ))}
      </div>

      <div className="max-w-4xl mx-auto mt-6 rounded-xl border shadow-md overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className={`h-14 border-b last:border-none ${shimmer}`}
          ></div>
        ))}
      </div>
    </div>
  );
}

// ================================
// 🔒 Protected Route
// ================================
function ProtectedRoute({ children }) {
  const token = localStorage.getItem("upstox_access_token");
  const expiry = parseInt(localStorage.getItem("upstox_token_expiry") || "0", 10);
  const isValid = token && Date.now() < expiry;

  if (!isValid) {
    console.warn("🔒 Invalid or expired token — redirecting to login");
    return <Navigate to="/login" replace />;
  }

  return children;
}

// ================================
// 🧭 Header Component
// ================================
function Header({ active, setActive }) {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === "light";
  const [menuOpen, setMenuOpen] = useState(false);
  const [aiDropdownOpen, setAIDropdownOpen] = useState(false);
  const menuRef = useRef(null);
  const aiRef = useRef(null);

  const tabs = [
    { name: "Dashboard", icon: <LayoutDashboard size={18} />, path: "/" },
    { name: "Watchlist", icon: <Star size={18} />, path: "/watchlist" },
    { name: "Portfolio", icon: <Briefcase size={18} />, path: "/portfolio" },
    { name: "Settings", icon: <SettingsIcon size={18} />, path: "/settings" },
  ];

  const aiModels = [
    {
      name: "LSTM Predictor",
      icon: <Brain size={18} />,
      path: "/lstm",
      color: "text-blue-500",
    },
    {
      name: "Transformer Predictor",
      icon: <Cpu size={18} />,
      path: "/transformer",
      color: "text-indigo-400",
    },
  ];

  // 🧠 Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      if (aiRef.current && !aiRef.current.contains(e.target)) setAIDropdownOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 🚪 Logout Function
  const handleLogout = () => {
    localStorage.removeItem("upstox_access_token");
    localStorage.removeItem("upstox_token_expiry");
    window.location.href = "/login";
  };

  return (
    <header
      className={`flex justify-between items-center px-8 py-4 border-b shadow-sm ${
        isLight ? "border-gray-200 bg-white" : "border-gray-800 bg-[#101826]"
      }`}
    >
      {/* 📊 Logo */}
      <h1
        className={`text-2xl font-bold tracking-wide ${
          isLight ? "text-blue-600" : "text-blue-400"
        }`}
      >
        📊 Upstox Dashboard
      </h1>

      <div className="flex items-center gap-4">
        {/* 🌐 Main Menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((prev) => !prev)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition font-medium ${
              isLight
                ? "bg-gray-100 hover:bg-gray-200 text-gray-700"
                : "bg-gray-800 hover:bg-gray-700 text-gray-100"
            }`}
          >
            Menu <ChevronDown size={18} />
          </button>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.15 }}
                className={`absolute right-0 mt-2 w-52 rounded-lg shadow-xl border z-40 ${
                  isLight
                    ? "bg-white border-gray-200"
                    : "bg-gray-800 border-gray-700"
                }`}
              >
                {tabs.map((tab) => (
                  <Link
                    key={tab.name}
                    to={tab.path}
                    onClick={() => {
                      setActive(tab.name.toLowerCase());
                      setMenuOpen(false);
                    }}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md transition ${
                      active === tab.name.toLowerCase()
                        ? isLight
                          ? "bg-blue-500 text-white"
                          : "bg-blue-600 text-white"
                        : isLight
                        ? "text-gray-600 hover:bg-gray-100 hover:text-blue-600"
                        : "text-gray-300 hover:bg-gray-700 hover:text-white"
                    }`}
                  >
                    {tab.icon}
                    {tab.name}
                  </Link>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 🤖 AI/ML Dropdown */}
        <div className="relative" ref={aiRef}>
          <button
            onClick={() => setAIDropdownOpen((prev) => !prev)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition ${
              isLight
                ? "bg-gray-100 hover:bg-gray-200 text-gray-700"
                : "bg-gray-800 hover:bg-gray-700 text-gray-100"
            }`}
          >
            <Cpu size={18} className="text-indigo-400" />
            AI/ML Models <ChevronDown size={18} />
          </button>

          <AnimatePresence>
            {aiDropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className={`absolute right-0 mt-2 w-64 rounded-xl shadow-2xl border z-40 overflow-hidden ${
                  isLight
                    ? "bg-white border-gray-200"
                    : "bg-gray-900 border-gray-700"
                }`}
              >
                {aiModels.map((model) => (
                  <Link
                    key={model.name}
                    to={model.path}
                    onClick={() => {
                      setActive(model.name.toLowerCase());
                      setAIDropdownOpen(false);
                    }}
                    className={`flex items-center gap-3 px-5 py-3 border-b last:border-none transition-all ${
                      isLight
                        ? "hover:bg-gray-100 text-gray-700"
                        : "hover:bg-gray-800 text-gray-200"
                    }`}
                  >
                    <span className={`${model.color}`}>{model.icon}</span>
                    <span className="font-medium">{model.name}</span>
                  </Link>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 🌙 Theme Toggle */}
        <button
          onClick={toggleTheme}
          className={`p-2 rounded-full transition ${
            isLight
              ? "bg-gray-100 hover:bg-gray-200 text-gray-700"
              : "bg-gray-800 hover:bg-gray-700 text-yellow-300"
          }`}
          title="Toggle theme"
        >
          {isLight ? <Moon size={20} /> : <Sun size={20} />}
        </button>

        {/* 🚪 Logout */}
        <button
          onClick={handleLogout}
          className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg shadow-md transition-all"
        >
          Logout
        </button>
      </div>
    </header>
  );
}

// ================================
// 🧠 Main App Content
// ================================
function AppContent() {
  const { theme } = useTheme();
  const [active, setActive] = useState("");
  const isLight = theme === "light";
  const location = useLocation();

  useEffect(() => {
    const currentPath = location.pathname.replace("/", "") || "dashboard";
    setActive(currentPath);
  }, [location]);

  // 🔁 Auto Refresh Token
  useEffect(() => {
    const interval = setInterval(() => {
      const expiry = parseInt(localStorage.getItem("upstox_token_expiry") || "0", 10);
      const token = localStorage.getItem("upstox_access_token");

      if (token && Date.now() > expiry - 10 * 60 * 1000) {
        console.log("🔄 Token expiring soon — refreshing...");
        fetch("http://localhost:5000/api/refresh-token", {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.access_token) {
              localStorage.setItem("upstox_access_token", data.access_token);
              const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
              localStorage.setItem("upstox_token_expiry", expiresAt.toString());
              console.log("✅ Token refreshed automatically.");
            }
          })
          .catch(() => console.warn("⚠️ Token refresh failed."));
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className={`min-h-screen transition-colors duration-300 ${
        isLight ? "bg-gray-50 text-gray-900" : "bg-[#0b0f19] text-gray-100"
      }`}
    >
      {location.pathname !== "/login" && location.pathname !== "/login-success" && (
        <Header active={active} setActive={setActive} />
      )}

      <main className="relative z-10 p-10">
        <Suspense fallback={<SkeletonLoader />}>
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/login-success" element={<LoginSuccess />} />

            {/* Protected Routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/watchlist"
              element={
                <ProtectedRoute>
                  <Watchlist />
                </ProtectedRoute>
              }
            />
            <Route
              path="/portfolio"
              element={
                <ProtectedRoute>
                  <Portfolio />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <SettingsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/lstm"
              element={
                <ProtectedRoute>
                  <LstmPredictor />
                </ProtectedRoute>
              }
            />
            <Route
              path="/transformer"
              element={
                <ProtectedRoute>
                  <TransformerPredictor />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

// ================================
// 🧱 Root App Component
// ================================
export default function App() {
  return (
    <ThemeProvider>
      <Router>
        <AppContent />
      </Router>
    </ThemeProvider>
  );
}
