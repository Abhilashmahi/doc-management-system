import { describe, expect, it, vi } from 'vitest';
import { checkOrigin } from '../src/middleware/origin-check.js';
import { HttpError } from '../src/utils/http-error.js';

// Use a fixed allowed origin, so the test does not depend on the developer's backend/.env file.
vi.mock('../src/config/env.js', () => ({ env: { CORS_ORIGIN: 'http://localhost:5173' } }));

function run(method: string, origin: string | undefined) {
  const req = { method, get: (name: string) => (name.toLowerCase() === 'origin' ? origin : undefined) };
  const next = vi.fn();
  checkOrigin(req as never, {} as never, next);
  return next.mock.calls[0]?.[0];
}

describe('origin check (CSRF protection)', () => {
  it('allows change requests from the allowed frontend address', () => {
    expect(run('POST', 'http://localhost:5173')).toBeUndefined();
  });

  it('allows change requests that send no Origin header', () => {
    expect(run('POST', undefined)).toBeUndefined();
  });

  it('blocks change requests from another port and explains the fix', () => {
    const error = run('POST', 'http://localhost:5174');
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(403);
    expect((error as HttpError).message).toContain('http://localhost:5174');
    expect((error as HttpError).message).toContain('http://localhost:5173');
  });

  it('never blocks read-only requests', () => {
    expect(run('GET', 'http://localhost:5174')).toBeUndefined();
  });
});
