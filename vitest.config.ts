import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['{plugins,packages,tooling}/*/tests/**/*.spec.ts'],
    environment: 'node',
  },
})
