/**
 * Secrets the Worker reads that `wrangler types` cannot see.
 *
 * It infers the names of secrets from `.dev.vars`, and only from entries that
 * have a value — these are deliberately blank there, because a developer's
 * machine sends no real email.
 *
 * They are optional, because they genuinely are: an environment given none
 * of them falls through to the next provider, and the tests hand the Worker
 * an environment that has none.
 *
 * `interface Env` is open, so this merges with the generated one rather than
 * being overwritten the next time the types are regenerated.
 */
interface Env {
  /** Brevo. With a key set, every email goes through Brevo. */
  BREVO_API_KEY?: string;
  /** Amazon SES, used when there is no Brevo key. */
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  /** Defaults to us-east-1 when blank. */
  AWS_REGION?: string;
}
