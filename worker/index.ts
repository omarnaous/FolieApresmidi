import { app } from './app';
import { handleScheduled } from './jobs/cron';
import type { JobMessage } from './jobs/messages';
import { handleQueue } from './jobs/queue';

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  queue: handleQueue,
  scheduled: handleScheduled,
} satisfies ExportedHandler<Env, JobMessage>;
