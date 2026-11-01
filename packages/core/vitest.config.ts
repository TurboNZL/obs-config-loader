import { defineConfig } from 'vitest/config'

// The git tests run real git in temp folders; on a Windows runner each scenario takes seconds, not milliseconds.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } })
