import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 127.0.0.1 вместо localhost: на части машин localhost резолвится в
      // ::1, а API-сервер слушает IPv4 — прокси умирал с 502.
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
