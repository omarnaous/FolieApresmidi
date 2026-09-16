import { AppError } from './errors';

/**
 * R2, Queues and Images are bound in every environment except the free-plan
 * `preview` one (see wrangler.jsonc), so `wrangler types` makes them optional.
 * These accessors are where that shows up: the Worker degrades — media streams
 * from its source URL, jobs run inline, uploads answer with a plain message —
 * instead of throwing on a missing binding.
 */

export const mediaBucket = (env: Env): R2Bucket | undefined => env.MEDIA;

export const jobQueue = (env: Env): Queue | undefined => env.JOBS;

export const imagesBinding = (env: Env): ImagesBinding | undefined => env.IMAGES;

/** For the routes that cannot do anything useful without a bucket to write to. */
export function requireMediaBucket(env: Env): R2Bucket {
  if (!env.MEDIA) throw new AppError('BAD_REQUEST', 'File storage (R2) is not enabled in this environment, so uploads are unavailable.');
  return env.MEDIA;
}
