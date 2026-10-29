import { describe, expect, it } from 'vitest';
import { canvasSchema } from '../src/services/canvas.js';
import { validateDocumentData } from '../src/services/document-data.js';
import { HttpError } from '../src/utils/http-error.js';

const definitions = [
  { fieldKey: 'FullName', label: 'Full Name', dataType: 'text', validation: { maxLength: 10 } },
  { fieldKey: 'Age', label: 'Age', dataType: 'number', validation: { min: 0, max: 150 } },
  { fieldKey: 'DateOfBirth', label: 'Date of Birth', dataType: 'date', validation: {} },
  { fieldKey: 'Gender', label: 'Gender', dataType: 'select', validation: { options: ['Male', 'Female'] } },
];
const templateFields = definitions.map((d) => ({ fieldKey: d.fieldKey, required: d.fieldKey === 'FullName', defaultValue: '' }));

function problems(data: Record<string, unknown>, draft = false): string[] {
  try {
    validateDocumentData(definitions, templateFields, data, { draft });
    return [];
  } catch (error) {
    return ((error as HttpError).details as { field: string }[]).map((d) => d.field);
  }
}

describe('document field validation', () => {
  it('accepts valid values and keeps only template fields', () => {
    const clean = validateDocumentData(definitions, templateFields, { FullName: ' Ravi ', Age: '30', DateOfBirth: '1996-02-29', Gender: 'Male', Extra: 'x' }, { draft: false });
    expect(clean).toEqual({ FullName: 'Ravi', Age: '30', DateOfBirth: '1996-02-29', Gender: 'Male' });
  });

  it('requires required fields only for final documents, not drafts', () => {
    expect(problems({})).toEqual(['FullName']);
    expect(problems({}, true)).toEqual([]);
  });

  it('rejects bad numbers, impossible dates, unknown options and long text', () => {
    expect(problems({ FullName: 'Ravi', Age: '200' })).toEqual(['Age']);
    expect(problems({ FullName: 'Ravi', DateOfBirth: '2023-02-30' })).toEqual(['DateOfBirth']);
    expect(problems({ FullName: 'Ravi', Gender: 'Other' })).toEqual(['Gender']);
    expect(problems({ FullName: 'A very long name' })).toEqual(['FullName']);
  });
});

describe('canvas schema', () => {
  const page = { id: 'p1', width: 794, height: 1123, background: '#fff' };

  it('accepts a page with a field and a QR code bound to a field', () => {
    const result = canvasSchema.safeParse({
      schemaVersion: 1,
      pages: [
        {
          ...page,
          elements: [
            { id: 'a', type: 'field', fieldKey: 'FullName', x: 1, y: 2, width: 100, height: 20, fontFamily: 'Arial', fontSize: 12, fontStyle: 'normal', fill: '#000', align: 'left' },
            { id: 'b', type: 'qrcode', value: '', fieldKey: 'RegistrationNumber', x: 1, y: 2, width: 100, height: 100, color: '#000', background: '#fff' },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown element types and embedded image data', () => {
    expect(canvasSchema.safeParse({ schemaVersion: 1, pages: [{ ...page, elements: [{ id: 'x', type: 'script', x: 0, y: 0, width: 1, height: 1 }] }] }).success).toBe(false);
    expect(canvasSchema.safeParse({ schemaVersion: 1, pages: [{ ...page, elements: [{ id: 'x', type: 'image', fileId: 'data:image/png;base64,AAA', x: 0, y: 0, width: 1, height: 1 }] }] }).success).toBe(false);
  });
});
