/**
 * Server-Side Google Firebase ID Token Verifier
 * Cryptographically validates RS256 JWT signatures against Google's official
 * Secure Token x509 public certificates without requiring a private service-account key.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface VerifiedFirebaseClaims {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
  signInProvider?: string;
  exp: number;
}

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedCerts: Record<string, string> = {};
let certsExpiresAt = 0;

// Cache recently verified ID tokens until near expiry to avoid repeated RSA verification overhead
const verifiedTokenCache = new Map<string, VerifiedFirebaseClaims>();

function getProjectId(): string {
  const envProjectId = (process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '').trim();
  if (envProjectId) {
    return envProjectId;
  }
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (cfg.projectId) return cfg.projectId;
    }
  } catch {
    // ignore read error
  }
  return 'gen-lang-client-0774833728';
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLen), 'base64');
}

async function fetchGooglePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (now < certsExpiresAt && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }

  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Google public certificates (${res.status})`);
  }

  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSeconds = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;

  cachedCerts = (await res.json()) as Record<string, string>;
  certsExpiresAt = now + maxAgeSeconds * 1000;
  return cachedCerts;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseClaims | null> {
  if (!idToken || typeof idToken !== 'string') return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const cached = verifiedTokenCache.get(idToken);
  if (cached && cached.exp > nowSeconds + 15) {
    return cached;
  }

  const parts = idToken.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; kid?: string };
  let payload: Record<string, any>;

  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf-8'));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf-8'));
  } catch {
    return null;
  }

  if (header.alg !== 'RS256' || !header.kid) {
    return null;
  }

  const projectId = getProjectId();
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;

  if (payload.aud !== projectId) return null;
  if (payload.iss !== expectedIssuer) return null;
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;
  if (typeof payload.iat !== 'number' || payload.iat > nowSeconds + 300) return null;

  const certs = await fetchGooglePublicCerts();
  const pemCert = certs[header.kid];
  if (!pemCert) {
    // Force refresh once in case Google rotated keys
    certsExpiresAt = 0;
    const refreshed = await fetchGooglePublicCerts();
    if (!refreshed[header.kid]) return null;
  }

  const cert = cachedCerts[header.kid];
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();

  const signatureBuf = base64UrlDecode(signatureB64);
  const isValid = verifier.verify(cert, signatureBuf);
  if (!isValid) return null;

  const email = typeof payload.email === 'string' ? payload.email.toLowerCase().trim() : '';
  if (!email) return null;

  const claims: VerifiedFirebaseClaims = {
    uid: payload.sub,
    email,
    emailVerified: Boolean(payload.email_verified),
    name: typeof payload.name === 'string' ? payload.name : email.split('@')[0],
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    signInProvider: typeof payload.firebase?.sign_in_provider === 'string' ? payload.firebase.sign_in_provider : undefined,
    exp: payload.exp
  };

  if (verifiedTokenCache.size > 500) {
    verifiedTokenCache.clear();
  }
  verifiedTokenCache.set(idToken, claims);

  return claims;
}
