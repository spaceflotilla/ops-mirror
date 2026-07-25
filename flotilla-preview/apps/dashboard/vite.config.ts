import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset URLs so snapshot previews under /p/{slug}/ (and the
  // auth router /{slug}/) load JS/CSS instead of requesting /assets at origin root.
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3101",
        changeOrigin: true,
      },
      "/auth": {
        target: "http://127.0.0.1:3101",
        changeOrigin: true,
      },
    },
  },
});
