import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 3000,
    // WSL2: Windows-side `localhost` forwarder is IPv4-only, so we
    // bind explicitly to 0.0.0.0. `host: true` in some Vite versions
    // resolves to a dual-stack '::' that ends up IPv6-only on Linux
    // and silently breaks Windows-side `http://localhost:3000`. That
    // matters because Google OAuth is registered against localhost
    // (not 127.0.0.1 or the WSL IP) — we have to keep the localhost
    // hostname working from the Windows browser.
    host: '0.0.0.0',
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/auth": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "query-vendor": ["@tanstack/react-query"],
        },
      },
    },
  },
});
