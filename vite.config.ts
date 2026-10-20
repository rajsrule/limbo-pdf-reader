import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/.tools/**",
        "**/src-tauri/**",
        "**/tests/**",
        "**/docs/**",
        "**/artifacts/**",
      ],
    },
  },
  optimizeDeps: { entries: ["index.html"] },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
