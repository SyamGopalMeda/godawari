import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// API for the dev/preview proxy; override when :8000 is taken, e.g. PUSHKAR_API_PROXY=http://localhost:8001
const API_TARGET = process.env.PUSHKAR_API_PROXY ?? 'http://localhost:8000'
const WS_TARGET = API_TARGET.replace(/^http/, 'ws')

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'brand/gloomdev-logo.webp'],
      manifest: {
        name: 'Pushkar Sahayam - Godavari Pushkaralu 2027',
        short_name: 'Pushkar Sahayam',
        description: 'Crowd status, navigation, parking, family safety and emergency help for Godavari Pushkaralu pilgrims',
        theme_color: '#2C1A10',
        background_color: '#FAF8F6',
        display: 'standalone',
        start_url: '/',
        lang: 'te',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/, /^\/ws/, /^\/docs/],
        runtimeCaching: [
          {
            // brand fonts: stylesheet revalidates, font files cached for a year (work offline after first visit)
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'font-css', expiration: { maxEntries: 4 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'font-files', expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            // map tiles: cache-first, bounded, so the site map works with poor signal
            urlPattern: /^https:\/\/([abcd]\.basemaps\.cartocdn\.com|[abc]\.tile\.openstreetmap\.org)\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 14 } },
          },
          {
            // reference data: network-first with fallback to the last copy
            urlPattern: /\/api\/v1\/(locations|parking|crowd\/status|alerts\/active|emergency\/contacts|sites)/,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-reference', networkTimeoutSeconds: 4, expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 6 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/ws': { target: WS_TARGET, ws: true },
      '/health': { target: API_TARGET },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/ws': { target: WS_TARGET, ws: true },
      '/health': { target: API_TARGET },
    },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
  // @ts-expect-error vitest config is read by vitest, not vite
  test: { environment: 'jsdom', setupFiles: ['./src/__tests__/setup.ts'], testTimeout: 15000, include: ['src/**/*.test.tsx'] },
})
