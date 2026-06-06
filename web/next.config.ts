import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep the native SQLite binding out of the bundle; it is loaded from
  // node_modules at runtime.
  serverExternalPackages: ["better-sqlite3"],
  // Ensure the compiled native binary is copied into the standalone output.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/better-sqlite3/build/Release/*.node"],
  },
};

export default nextConfig;
