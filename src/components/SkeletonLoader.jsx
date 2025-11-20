// src/components/SkeletonLoader.jsx
import React from "react";
import { motion } from "framer-motion";

export default function SkeletonLoader({ type = "card", count = 4 }) {
  const shimmer =
    "animate-pulse bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 dark:from-gray-700 dark:via-gray-800 dark:to-gray-700";

  // 🟦 Dashboard card placeholders
  if (type === "card") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        {[...Array(count)].map((_, i) => (
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
    );
  }

  // 🟨 List/table placeholders (for Watchlist, etc.)
  if (type === "list") {
    return (
      <div className="max-w-4xl mx-auto mt-6 rounded-xl border shadow-md overflow-hidden">
        {[...Array(count)].map((_, i) => (
          <div
            key={i}
            className={`h-14 border-b last:border-none ${shimmer}`}
          ></div>
        ))}
      </div>
    );
  }

  // 🟧 Chart placeholder
  if (type === "chart") {
    return (
      <div className="flex justify-center mt-10">
        <div
          className={`rounded-full ${shimmer}`}
          style={{ width: "250px", height: "250px" }}
        ></div>
      </div>
    );
  }

  // 🟩 Default block
  return <div className={`w-full h-10 rounded-md ${shimmer}`}></div>;
}
