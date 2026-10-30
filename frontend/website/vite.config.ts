/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", ["SCAN_API_BASE_URL"]);
  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        // Mirrors the /scan-health proxy in server.js for `npm run dev`.
        "/scan-health": {
          target: env.SCAN_API_BASE_URL || "http://localhost:8080",
          changeOrigin: true,
          rewrite: () => "/healthz",
        },
      },
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
    },
  };
});
