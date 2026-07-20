import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The React app lives in client/. API calls to /api are proxied to the Node
// server on port 4000 (so the browser can use relative URLs, no CORS).
export default defineConfig({
  root: "client",
  plugins: [react()],
  server: {
    port: 5173,
    fs: { allow: [".."] },
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
