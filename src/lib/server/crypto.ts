import 'server-only';
import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Uses only Node's built-in crypto primitives (no custom cryptography):
 *  - session tokens, link tokens and recovery codes come from crypto.randomBytes;
 *  - high-entropy secrets are stored as SHA-256 hashes (lookup by hash, no plaintext at rest);
 *  - researcher passwords use scrypt with a per-password random salt.
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// Crockford base32 alphabet without I, L, O, U to avoid transcription errors.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 26 random base32 characters (130 bits), grouped as XXXXX-XXXXX-XXXXX-XXXXX-XXXXXX. */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(26);
  const chars = [...bytes].map((b) => B32[b & 31]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5, 10)}-${chars.slice(10, 15)}-${chars.slice(15, 20)}-${chars.slice(20)}`;
}

/** Normalise user input: uppercase, drop separators/spaces, map look-alike letters. */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0').replace(/U/g, 'V');
}

export function hashRecoveryCode(input: string): string {
  return sha256(`recovery:${normalizeRecoveryCode(input)}`);
}

export function generateEmailCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex'), bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [kind, N, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !N || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Short pseudonymous participant code for researcher views, e.g. P-7K3Q9X. */
export function generatePublicCode(): string {
  const bytes = randomBytes(6);
  return `P-${[...bytes].map((b) => B32[b & 31]).join('')}`;
}

export function generateSeed(): string {
  return randomBytes(16).toString('hex');
}
