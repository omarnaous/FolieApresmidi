/** Structured JSON logs — searchable in Workers Logs. Never log secrets, tokens or passwords. */
type Fields = Record<string, unknown>;

const write = (level: 'info' | 'warn' | 'error', event: string, fields: Fields = {}) => {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

export const log = {
  info: (event: string, fields?: Fields) => write('info', event, fields),
  warn: (event: string, fields?: Fields) => write('warn', event, fields),
  error: (event: string, fields?: Fields) => write('error', event, fields),
};

export const errorFields = (err: unknown): Fields =>
  err instanceof Error ? { error: err.message, stack: err.stack?.split('\n').slice(0, 5).join('\n') } : { error: String(err) };
