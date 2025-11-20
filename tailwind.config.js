/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "dark-bg": "#0b0f19", // base dark
        "dark-card": "#151b2b",
        "accent-blue": "#3b82f6",
        "accent-green": "#10b981",
        "accent-red": "#ef4444",
      },
      boxShadow: {
        glow: "0 0 15px rgba(59, 130, 246, 0.3)",
      },
    },
  },
  plugins: [],
};
