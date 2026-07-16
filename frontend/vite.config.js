import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server on :3000. /api is proxied to the backend so local fetches to
// `${VITE_API_URL}/api/...` (VITE_API_URL=http://localhost:8000) hit uvicorn.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
