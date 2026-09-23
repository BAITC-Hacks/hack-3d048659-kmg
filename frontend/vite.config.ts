import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxy = {
  "/api": {
    target: "http://127.0.0.1:8000",
    // Preserve the browser's host so the API can validate same-origin writes.
    changeOrigin: false,
    timeout: 120_000,
    proxyTimeout: 120_000,
  },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
});
