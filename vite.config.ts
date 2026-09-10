import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { liveRainHandler } from "./server/liveRain.js";
import { liveNowcastHandler } from "./server/liveNowcast.js";

/** Serve the live HKO rainfall proxy in `npm run dev` too, so development sees real live data. */
const liveRainDevApi: Plugin = {
  name: "live-rain-dev-api",
  configureServer(server) {
    server.middlewares.use("/api/live/rainfall", (req, res) => void liveRainHandler(req, res));
    server.middlewares.use("/api/live/nowcast", (req, res) => void liveNowcastHandler(req, res));
  },
};

export default defineConfig({
  plugins: [react(), liveRainDevApi],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
  },
});
