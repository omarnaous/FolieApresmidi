import { useCallback, useState } from 'react';
import { apiFields, focusFirstError, messageFor, type FieldErrors } from '../lib/errors';

/**
 * A form's complaints: per field when the problem belongs to one, a single
 * line above the button when it does not. `order` is the fields' order on the
 * page, so the first one gets scrolled to.
 */
export function useFormErrors(order: string[], idFor: (field: string) => string) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);

  const show = useCallback((found: FieldErrors) => {
    setErrors(found);
    focusFirstError(found, order, idFor);
  }, [order, idFor]);

  const fail = useCallback((err: unknown, fallback?: string) => {
    const found = apiFields(err);
    if (Object.keys(found).length) show(found);
    else setAlert(messageFor(err, fallback));
  }, [show]);

  /** Clear one field's complaint (as they start fixing it), or everything. */
  const clear = useCallback((field?: string) => {
    setAlert(null);
    setErrors((e) => {
      if (!field) return {};
      if (!e[field]) return e;
      const rest = { ...e };
      delete rest[field];
      return rest;
    });
  }, []);

  return { errors, alert, show, fail, clear };
}
