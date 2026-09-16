import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` diffs worker/db/schema.ts against migrations/meta and
// writes the next numbered SQL file. Wrangler applies them:
//   npm run db:migrate            (local)
//   npm run db:migrate:staging    npm run db:migrate:prod
export default defineConfig({
  dialect: 'sqlite',
  schema: './worker/db/schema.ts',
  out: './migrations',
});
