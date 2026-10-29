import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* The Quest lab: the game alone on one page, no sign-in, no API, no
 * service worker. Kept out of the app build so it never ships with it.
 *   npx vite --config vite.lab.config.ts           (dev, /quest-lab.html)
 *   npx vite build --config vite.lab.config.ts     (dist-lab/) */
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5174, fs: { allow: [".."] } },
  build: { outDir: "dist-lab", assetsInlineLimit: 0, rollupOptions: { input: { "quest-lab": "quest-lab.html" } } },
});
