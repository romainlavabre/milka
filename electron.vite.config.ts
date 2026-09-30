import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared'), '@core': resolve('src/core') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  renderer: {
    // Monaco ships one chunk per language: listing them all drowns real warnings.
    logLevel: 'warn',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { ...shared, '@': resolve('src/renderer/src') }
    }
  }
})
