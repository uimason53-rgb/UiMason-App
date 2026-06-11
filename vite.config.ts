import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
    watch: {
      // Ignore zip files and other binary archives in root — prevents EBUSY errors
      ignored: ['**/*.zip', '**/*.rar', '**/*.tar', '**/*.gz'],
    },
  },
})
