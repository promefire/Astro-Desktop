import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const devNonce = randomBytes(24).toString('base64')

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    // Explicit IPv4 and a fixed, strict port prevent localhost IPv4/IPv6 ambiguity
    // or Vite port fallback from opening an unrelated local application's page.
    server: { host: '127.0.0.1', port: 5187, strictPort: true },
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss(), {
      name: 'development-csp',
      apply: 'serve',
      transformIndexHtml: {
        order: 'post',
        handler(html) {
          return html
            .replaceAll('<script', `<script nonce="${devNonce}"`)
            .replace("script-src 'self'", `script-src 'self' 'nonce-${devNonce}'`)
            .replace("connect-src 'self'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*")
        },
      },
    }],
  },
})
