import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API = process.env.VITE_API_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/docs': API,
      '/openapi.json': API,
      '/ws': { target: API.replace('http', 'ws'), ws: true },
    },
  },
})
