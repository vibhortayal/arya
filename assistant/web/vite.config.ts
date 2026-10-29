import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/* The new app is served at /next/ next to the current PWA (which stays
 * at /) until the switch-over. Images, models and three.js are not
 * copied: they load from the current PWA's static mount (/assets,
 * /models, /vendor), so both apps share one set of files. */
const API = process.env.ARYA_API || "http://localhost:8000";
const PROXY = ["/api", "/auth", "/decode", "/import", "/eyes", "/assets", "/models", "/vendor", "/icons", "/mcp"];

export default defineConfig({
  base: "/next/",
  plugins: [
    react(),
    VitePWA({
      // Registered by hand in main.tsx, and only once the app owns "/".
      injectRegister: false,
      registerType: "autoUpdate",
      manifest: false,
      workbox: {
        navigateFallback: "/next/index.html",
        // The API is never cached; the shell is.
        navigateFallbackDenylist: [/^\/(api|auth|decode|import|eyes)\//],
        globPatterns: ["**/*.{js,css,html,svg,png,webp}"],
      },
    }),
  ],
  server: {
    port: 5173,
    fs: { allow: [".."] },
    proxy: Object.fromEntries(PROXY.map(p => [p, { target: API, changeOrigin: false }])),
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
