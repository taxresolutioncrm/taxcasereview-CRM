import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const BUILD_ID = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || (() => {
  try { return execSync('git rev-parse HEAD').toString().trim() } catch { return 'dev-local' }
})()

export default defineConfig({
  base: '/',
  plugins: [
    react(),
    {
      name: 'taxres-build-marker',
      closeBundle() {
        writeFileSync('dist/taxres-build.json', JSON.stringify({ build: BUILD_ID }) + '\n')
      },
    },
  ],
  define: {
    __TAXRES_BUILD__: JSON.stringify(BUILD_ID),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true, secure: false },
      '/uploads': { target: 'http://127.0.0.1:3000', changeOrigin: true, secure: false }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Raise warning threshold — these are known heavy chunks
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash].js`,
        chunkFileNames: `assets/[name]-[hash].js`,
        // Split heavy libraries into separate chunks so they only load when needed
        manualChunks: (id) => {
          // PDF rendering — only loads on IRS forms / documents pages
          if (id.includes('pdfjs-dist') || id.includes('pdf.worker')) return 'pdf-worker'
          if (id.includes('pdf-lib')) return 'pdf-lib'
          // Excel — only loads on reports / exports
          if (id.includes('node_modules/xlsx')) return 'xlsx'
          // SignalWire / calling — only loads in Dialer
          if (id.includes('@signalwire') || id.includes('signalwire')) return 'signalwire'
          // Stripe — only loads in payments
          if (id.includes('@stripe') || id.includes('stripe')) return 'stripe'
          // React core stays in main
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) return 'react-vendor'
          // React Router
          if (id.includes('react-router')) return 'react-router'
          // Supabase
          if (id.includes('@supabase')) return 'supabase'
        }
      }
    }
  }
})
