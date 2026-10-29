import argon2 from 'argon2';

// Argon2id is the recommended password hashing algorithm. Raw passwords are never stored or logged.
const options = {
  type: argon2.argon2id as 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, options);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A malformed hash is treated as a failed check rather than a server crash.
    return false;
  }
}
