import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd with the real bindings from wrangler.jsonc (D1, KV,
// R2, Queues, rate limiters) simulated locally. Every test file gets its own
// storage, and test/setup.ts applies the migrations to it first.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: './worker/index.ts',
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url))),
          APP_ENV: 'development',
          APP_URL: 'http://localhost',
          ALLOWED_ORIGINS: 'http://localhost',
          PASSWORD_PEPPER: 'test-pepper-not-secret',
          COOKIE_SECRET: 'test-cookie-secret-not-secret',
          SETUP_TOKEN: 'test-setup-token',
          RESEND_API_KEY: '',
          // hashing strength is not what these tests measure
          PASSWORD_ITERATIONS: '1000',
        },
      },
    })),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
