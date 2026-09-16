import { zValidator } from '@hono/zod-validator';
import type { ZodType } from 'zod';
import { invalid } from './errors';

interface IssueLike {
  path?: readonly PropertyKey[];
  message: string;
}

function fieldsFrom(error: unknown): Record<string, string> {
  const issues = (error as { issues?: IssueLike[] } | undefined)?.issues ?? [];
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = (issue.path ?? []).map(String).join('.') || '_';
    fields[key] ??= issue.message;
  }
  return fields;
}

const hook = (result: { success: boolean; error?: unknown }) => {
  if (!result.success) throw invalid(fieldsFrom(result.error));
};

/** Validate a JSON body; failures become 422 VALIDATION_FAILED with per-field messages. */
export const json = <T extends ZodType>(schema: T) => zValidator('json', schema, hook);

/** Validate query parameters. */
export const query = <T extends ZodType>(schema: T) => zValidator('query', schema, hook);

/** Validate an already-parsed value (multipart fields, CSV rows…). */
export function parse<T extends ZodType>(schema: T, value: unknown): T['_output'] {
  const result = schema.safeParse(value);
  if (!result.success) throw invalid(fieldsFrom(result.error));
  return result.data;
}
