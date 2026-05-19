import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // --- NEW: Proxy configuration ---
  server: {
    proxy: {
      // This catches BOTH standard http fetch() and ws:// websockets!
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true, // Crucial: Tells Vite to proxy WebSockets on this route
      },
      '/api/ws': {
        target: 'http://localhost:8000',
        ws: true, // This MUST be true
      },
      '/api/agent': {
        target: 'http://localhost:8001', // Point to the Agent container
        changeOrigin: true,
        ws: true, // Enable WebSocket proxying for the chat stream
      }
    }
  }
})