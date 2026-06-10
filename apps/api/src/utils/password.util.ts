// Password hashing and comparison using bcrypt.

import bcrypt from "bcrypt";

const ROUNDS = 12;

/** Hash a plain-text password for storage. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

/** Compare plain password with stored hash. */
export async function comparePassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
