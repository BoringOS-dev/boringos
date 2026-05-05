import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    host: "0.0.0.0",
    allowedHosts: ["shell.boringos.dev"],
    proxy: {
      "/api": {
        target: process.env.BORINGOS_API_TARGET ?? "http://localhost:3030",
        changeOrigin: true,
      },
    },
  },
});
