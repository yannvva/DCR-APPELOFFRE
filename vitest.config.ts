import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    // Les harnais live (agents réels, API/DB/réseau) sont rangés dans
    // tests/live/ (config dédiée `npm run test:live`). Par sécurité, les
    // fichiers de diagnostic préfixés « _ » ou contenant « probe » sont
    // exclus de la suite unitaire : elle doit rester rapide et déterministe.
    exclude: [
      '**/node_modules/**',
      '**/_*.test.ts',
      '**/*probe*.test.ts',
      // Harnais d'agents (appels réels API/DB) : jamais dans la suite unitaire.
      '**/agent-*.test.ts',
    ],
    environment: 'node',
  },
})
