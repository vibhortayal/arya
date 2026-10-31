import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/* The app, served at / by api/main.py from web/dist. Images, models,
 * three.js, scene.js, the manifest and icons are not copied into the
 * build: they stay in the static folder (assistant/pwa/), which the
 * API serves at / beside the build and also reads itself (store
 * models, character manifest). The dev server proxies them. Built
 * files go to /app/ so they never share a folder with the static
 * /assets/ images. */
const API = process.env.ARYA_API || "http://localhost:8000";
const PROXY = ["/api", "/auth", "/decode", "/import", "/eyes", "/assets", "/models", "/vendor", "/icons", "/mcp",
  "/scene.js", "/boot.js", "/manifest.json", "/auth-callback.js"];

export default defineConfig({
  base: "/",
  build: { assetsDir: "app" },
  // en.json (145 KB) ships as a JSON.parse string, which parses faster
  // than the same data as a JS object literal (speed audit #16).
  json: { stringify: true },
  plugins: [
    react(),
    VitePWA({
      // Registered by hand (src/app/sw-register.ts), at /sw.js.
      injectRegister: false,
      manifest: false,
      // Our own worker (src/sw.js): the old app's rules, and its push
      // handlers; the plugin only injects the list of built files.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,webp}"],
        // A classic script, as the old worker was.
        rollupFormat: "iife",
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: Object.fromEntries(PROXY.map(p => [p, { target: API, changeOrigin: false }])),
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
