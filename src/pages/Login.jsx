import React, { useEffect } from "react";

export default function Login() {
  useEffect(() => {
    document.title = "Login | Upstox Dashboard";
  }, []);

  const handleLogin = () => {
    // Redirect to Flask backend OAuth endpoint
    window.location.href = "http://localhost:5000/auth/login";
  };

  return (
    <div className="flex flex-col justify-center items-center h-screen bg-gradient-to-br from-blue-100 via-indigo-100 to-purple-100">
      <div className="bg-white shadow-xl rounded-3xl p-10 w-full max-w-md text-center">
        <h1 className="text-3xl font-bold text-blue-600 mb-4">
          🔑 Login with Upstox
        </h1>
        <p className="text-gray-600 mb-6">
          Please log in with your Upstox account to continue.
        </p>

        <button
          onClick={handleLogin}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md transition-all"
        >
          Login with Upstox
        </button>

        <p className="mt-6 text-sm text-gray-500">
          You’ll be redirected to the official Upstox website for secure login.
        </p>
      </div>
    </div>
  );
}
