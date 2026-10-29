import { createHash } from 'node:crypto';

// The browser gets a random token in an HttpOnly cookie. The database stores only its SHA-256 hash,
// so a leaked database cannot be used to log in.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
