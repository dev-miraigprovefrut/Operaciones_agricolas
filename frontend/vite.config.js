import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    // localhost (no 127.0.0.1): las cookies de sesion del backend local
    // (localhost:8007) son del mismo sitio.
    server: { port: parseInt(env.VITE_PORT) || 5007, host: 'localhost', strictPort: true },
    publicDir: 'static'
  }
})
