import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5555,
    // The project lives on iCloud Drive (com~apple~CloudDocs); native fs events
    // are unreliable there, so HMR silently misses edits. Poll instead.
    watch: {
      usePolling: true,
      interval: 300,
    },
    proxy: {
      "/api": {
        target: "http://localhost:5556",
        changeOrigin: true,
      },
    },
  },
});
