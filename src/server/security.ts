/**
 * Cryptographic Security Utilities for Bharatvarsh Leathercrafts LLP
 * - HMAC-SHA256 Signed Session JWTs (stateless, exp-checked, timing-safe)
 * - Salted crypto.scrypt Password Hashing & Timing-Safe Verification
 *   (with transparent legacy unsalted SHA-256 verification + rehash upgrade detection)
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { UserRole } from '../types/index.ts';

export interface SessionJwtClaims {
  sub: string;
  email: string;
  name?: string;
  role: UserRole;
  iat: number;
  exp: number;
}

const JWT_SECRET_FILE = path.resolve(process.cwd(), 'src/server/data/.jwt_secret');
let cachedJwtSecret: string | null = null;

/**
 * Returns the HMAC-SHA256 signing secret from env (`JWT_SECRET` / `AUTH_JWT_SECRET`),
 * or creates and persists a cryptographically random 32-byte key on disk across restarts.
 */
export function getJwtSecret(): string {
  const envSecret = (process.env.JWT_SECRET || process.env.AUTH_JWT_SECRET || '').trim();
  if (envSecret.length > 0) {
    return envSecret;
  }

  if (cachedJwtSecret) {
    return cachedJwtSecret;
  }

  try {
    const dir = path.dirname(JWT_SECRET_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(JWT_SECRET_FILE)) {
      const existing = fs.readFileSync(JWT_SECRET_FILE, 'utf-8').trim();
      if (/^[0-9a-f]{64}$/i.test(existing)) {
        cachedJwtSecret = existing;
        return cachedJwtSecret;
      }
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(JWT_SECRET_FILE, generated, { encoding: 'utf-8', mode: 0o600 });
    cachedJwtSecret = generated;
    return cachedJwtSecret;
  } catch {
    cachedJwtSecret = crypto.randomBytes(32).toString('hex');
    return cachedJwtSecret;
  }
}

/**
 * Issues an HMAC-SHA256 signed JWT for credential / patron sessions.
 */
export function signSessionJwt(
  payload: { sub: string; email: string; name?: string; role: UserRole },
  expiresInSeconds: number = 7 * 24 * 60 * 60
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const claims: SessionJwtClaims = {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    ...(payload.name ? { name: payload.name } : {}),
    role: payload.role,
    iat: nowSec,
    exp: nowSec + expiresInSeconds
  };
  const payloadB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigB64 = crypto.createHmac('sha256', getJwtSecret()).update(signingInput).digest('base64url');
  return `${signingInput}.${sigB64}`;
}

/**
 * Verifies an HMAC-SHA256 signed JWT signature and expiration.
 */
export function verifySessionJwt(token: string): SessionJwtClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    if (!headerB64 || !payloadB64 || !signatureB64) return null;

    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    if (!header || header.alg !== 'HS256') return null;

    const expectedSigB64 = crypto
      .createHmac('sha256', getJwtSecret())
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    const providedBuf = Buffer.from(signatureB64, 'utf8');
    const expectedBuf = Buffer.from(expectedSigB64, 'utf8');
    if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
      return null;
    }

    const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as SessionJwtClaims;
    if (!claims || !claims.email || typeof claims.exp !== 'number') {
      return null;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (claims.exp <= nowSec) {
      return null;
    }

    return {
      ...claims,
      email: claims.email.trim().toLowerCase()
    };
  } catch {
    return null;
  }
}

/**
 * Hashes a password with a per-credential random 16-byte salt using crypto.scrypt.
 * Format: scrypt$<saltHex>$<derivedKeyHex>
 */
export function hashPassword(password: string): string {
  const saltHex = crypto.randomBytes(16).toString('hex');
  const derivedHex = crypto.scryptSync(password, saltHex, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${saltHex}$${derivedHex}`;
}

/**
 * Timing-safe verification against salted scrypt hashes (`scrypt$salt$hash`)
 * or legacy 64-char SHA-256 hex hashes (flagging `needsRehash: true` on legacy match).
 */
export function verifyPassword(
  password: string,
  storedHash?: string | null
): { valid: boolean; needsRehash: boolean } {
  if (!password || !storedHash || typeof storedHash !== 'string') {
    return { valid: false, needsRehash: false };
  }

  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return { valid: false, needsRehash: false };
    const [, saltHex, hashHex] = parts;
    if (!saltHex || !hashHex) return { valid: false, needsRehash: false };

    try {
      const derived = crypto.scryptSync(password, saltHex, 64, { N: 16384, r: 8, p: 1 });
      const expected = Buffer.from(hashHex, 'hex');
      if (derived.length !== expected.length) {
        return { valid: false, needsRehash: false };
      }
      return { valid: crypto.timingSafeEqual(derived, expected), needsRehash: false };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  // Legacy unsalted SHA-256 compatibility check (auto-upgrades on successful login)
  if (/^[0-9a-f]{64}$/i.test(storedHash)) {
    const legacyDigest = crypto.createHash('sha256').update(password).digest('hex');
    const a = Buffer.from(legacyDigest, 'hex');
    const b = Buffer.from(storedHash.toLowerCase(), 'hex');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { valid: true, needsRehash: true };
    }
  }

  return { valid: false, needsRehash: false };
}

/**
 * Constant-time hex/UTF-8 string comparison helper.
 */
export function safeCompareStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
