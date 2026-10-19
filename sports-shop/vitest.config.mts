import { defineConfig } from 'vitest/config'

/**
 * Unit/integration tests run in Node against better-sqlite3 compiled for the
 * plain Node ABI (via V8 module mocking, see below). The Electron GUI is not
 * involved; the production database path (app.getPath('userData')) is only
 * used by src/main/db/index.ts, which tests never import.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each test FILE gets its own database instances via helpers.ts; files
    // themselves run isolated so temp dirs never clash.
    isolate: true
  },
  resolve: {
    alias: {
      // Under Vitest/Node, `require('better-sqlite3')` resolves to the
      // Node-ABI build shipped with the package — no Electron needed here.
    }
  }
})
