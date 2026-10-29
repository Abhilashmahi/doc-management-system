import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/services/passwords.js';
import { hashToken } from '../src/utils/token-hash.js';

describe('password hashing', () => {
  it('creates an Argon2id hash that is not the raw password', async () => {
    const hash = await hashPassword('Correct-Horse-Battery-1');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('Correct-Horse');
  });

  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('Correct-Horse-Battery-1');
    expect(await verifyPassword(hash, 'Correct-Horse-Battery-1')).toBe(true);
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
  });

  it('treats a malformed hash as a failed check instead of crashing', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });
});

describe('session token hashing', () => {
  it('stores a 64-character SHA-256 hex digest, never the token itself', () => {
    const digest = hashToken('my-session-token');
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain('my-session-token');
    expect(hashToken('my-session-token')).toBe(digest);
  });
});
