import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function LoginSuccess() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const code = params.get("code");

    // 🧠 Case 1: Received access token (normal backend redirect)
    if (token) {
      console.log("✅ Received Upstox access token:", token.slice(0, 10) + "...");

      localStorage.setItem("upstox_access_token", token);
      localStorage.setItem("upstox_token_expiry", (Date.now() + 24 * 60 * 60 * 1000).toString());

      setTimeout(() => {
        const stored = localStorage.getItem("upstox_access_token");
        if (stored) {
          console.log("💾 Token stored successfully — redirecting to dashboard...");
          navigate("/");
        } else {
          console.warn("⚠️ Token storage failed — going back to login.");
          navigate("/login");
        }
      }, 600);
      return;
    }

    // 🧠 Case 2: Got `code` but not `token` (user came directly from Upstox)
    if (code) {
      console.log("📩 Received Upstox code — redirecting to backend /enter-code page...");
      window.location.href = `http://localhost:5000/enter-code?code=${code}`;
      return;
    }

    // 🧠 Case 3: Nothing found — check if we already have a token stored
    const existing = localStorage.getItem("upstox_access_token");
    if (existing) {
      console.log("🔁 Existing token found — redirecting to dashboard...");
      navigate("/");
    } else {
      console.warn("⚠️ No token or code found — redirecting to login page.");
      navigate("/login");
    }
  }, [navigate]);

  return (
    <div className="flex flex-col items-center justify-center h-screen text-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <h1 className="text-2xl font-semibold text-blue-700 mb-4">
        Logging you in...
      </h1>
      <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-blue-600 border-solid"></div>
      <p className="mt-4 text-gray-600 text-sm">
        Please wait while we verify your login with Upstox.
      </p>
    </div>
  );
}
