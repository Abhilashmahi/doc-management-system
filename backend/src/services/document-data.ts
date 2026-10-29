import { HttpError } from '../utils/http-error.js';
import type { TemplateFields } from './canvas.js';

interface FieldDefinition {
  fieldKey: string;
  label: string;
  dataType: string;
  validation: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
    patternMessage?: string;
    options?: string[];
  };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Checks the values typed into a document form against the field rules and the template's required list.
// Only fields used by the template are kept. Drafts skip the "required" check, so half-finished work can be saved.
// Throws a 400 error listing every problem, in the same shape as other form errors.
export function validateDocumentData(
  definitions: FieldDefinition[],
  templateFields: TemplateFields,
  data: Record<string, unknown>,
  options: { draft: boolean },
): Record<string, string> {
  const byKey = new Map(definitions.map((d) => [d.fieldKey, d]));
  const problems: { field: string; message: string }[] = [];
  const clean: Record<string, string> = {};

  for (const tf of templateFields) {
    const def = byKey.get(tf.fieldKey);
    const label = def?.label ?? tf.fieldKey;
    const raw = data[tf.fieldKey];
    const value = raw === undefined || raw === null ? '' : String(raw).trim();
    const rules = def?.validation ?? {};
    const required = tf.required || rules.required === true;

    if (value === '') {
      if (required && !options.draft) problems.push({ field: tf.fieldKey, message: `${label} is required.` });
      clean[tf.fieldKey] = '';
      continue;
    }

    if (rules.maxLength !== undefined && value.length > rules.maxLength) {
      problems.push({ field: tf.fieldKey, message: `${label} can be at most ${rules.maxLength} characters long.` });
    }
    if (rules.minLength !== undefined && value.length < rules.minLength) {
      problems.push({ field: tf.fieldKey, message: `${label} must be at least ${rules.minLength} characters long.` });
    }
    if (value.length > 5000) problems.push({ field: tf.fieldKey, message: `${label} is too long.` });

    switch (def?.dataType) {
      case 'number': {
        const n = Number(value);
        if (!Number.isFinite(n)) problems.push({ field: tf.fieldKey, message: `${label} must be a number.` });
        else {
          if (rules.min !== undefined && n < rules.min) problems.push({ field: tf.fieldKey, message: `${label} must be ${rules.min} or more.` });
          if (rules.max !== undefined && n > rules.max) problems.push({ field: tf.fieldKey, message: `${label} must be ${rules.max} or less.` });
        }
        break;
      }
      case 'date':
        if (!isRealDate(value)) problems.push({ field: tf.fieldKey, message: `${label} must be a valid date.` });
        break;
      case 'select':
        if (rules.options && !rules.options.includes(value)) {
          problems.push({ field: tf.fieldKey, message: `Choose one of the listed options for ${label}.` });
        }
        break;
    }

    if (rules.pattern) {
      let ok = true;
      try {
        ok = new RegExp(`^(?:${rules.pattern})$`).test(value);
      } catch {
        ok = true; // an invalid stored pattern is ignored rather than blocking every save
      }
      if (!ok) problems.push({ field: tf.fieldKey, message: rules.patternMessage || `${label} is not in the expected format.` });
    }

    clean[tf.fieldKey] = value;
  }

  if (problems.length > 0) throw new HttpError(400, 'Some fields are invalid. Please check the form.', problems);
  return clean;
}
