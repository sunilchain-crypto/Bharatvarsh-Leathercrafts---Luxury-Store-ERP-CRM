/**
 * Server-Side Authentication & Access Control Layer
 * Verifies Google Firebase ID tokens and credential session tokens, enforces RBAC,
 * and restricts admin/store management access.
 */

import { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';
import { UserRole, AuthUser } from '../types/index.ts';
import { verifyFirebaseIdToken } from './firebaseAuthVerifier.ts';
import { verifySessionJwt } from './security.ts';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

const TEST_SESSION_CACHE = new Map<string, AuthUser>();

TEST_SESSION_CACHE.set('token_sunil', {
  uid: 'uid_admin_sunil',
  email: 'sunilchain@gmail.com',
  name: 'Sunil Chainani',
  role: 'STORE_MANAGER',
  isMasterAdmin: true,
  isStoreManagementAuthorized: true
});

TEST_SESSION_CACHE.set('token_support', {
  uid: 'uid_admin_support',
  email: 'support@bharatvarshcrafts.com',
  name: 'Bharatvarsh Support Desk',
  role: 'STORE_MANAGER',
  isMasterAdmin: true,
  isStoreManagementAuthorized: true
});

TEST_SESSION_CACHE.set('token_patron_vikram', {
  uid: 'uid_patron_01',
  email: 'vikram.singhania@heritagecrafts.in',
  name: 'Vikramaditya Singhania',
  role: 'PATRON',
  isMasterAdmin: false,
  isStoreManagementAuthorized: false
});

function isTestAuthTokensEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    (process.env.NODE_ENV === 'test' || process.env.ENABLE_TEST_AUTH_TOKENS === 'true')
  );
}

/**
 * Resolves synchronous credential/session tokens (HMAC-SHA256 signed JWTs or test-gated fixtures)
 * and evaluates live permissions from the database.
 */
export function resolveAuthToken(authHeader?: string): AuthUser | null {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  // Static test tokens are strictly disabled unless test-only flag is active
  if (isTestAuthTokensEnabled() && TEST_SESSION_CACHE.has(token)) {
    const cached = TEST_SESSION_CACHE.get(token)!;
    const isAuth = db.isStoreManagementAuthorized(cached.email);
    return {
      ...cached,
      role: isAuth ? db.getStaffRole(cached.email) : 'PATRON',
      isMasterAdmin: db.isMasterAuthorized(cached.email),
      isStoreManagementAuthorized: isAuth
    };
  }

  // Verify HMAC-SHA256 signed session JWT
  const claims = verifySessionJwt(token);
  if (!claims || !claims.email) {
    return null;
  }

  const email = claims.email.trim().toLowerCase();
  const isMaster = db.isMasterAuthorized(email);
  const isAdmin = db.isStoreManagementAuthorized(email);
  const resolvedRole: UserRole = isAdmin ? db.getStaffRole(email) : 'PATRON';

  return {
    uid: claims.sub,
    email,
    name: claims.name || email.split('@')[0],
    role: resolvedRole,
    isMasterAdmin: isMaster,
    isStoreManagementAuthorized: isAdmin,
    authProvider: 'CREDENTIALS'
  };
}

/**
 * Resolves either an HMAC-SHA256 signed session JWT or a Google Firebase RS256 ID token.
 */
export async function resolveAuthTokenAsync(authHeader?: string): Promise<AuthUser | null> {
  const syncUser = resolveAuthToken(authHeader);
  if (syncUser) return syncUser;

  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token || token.split('.').length !== 3) return null;

  try {
    const claims = await verifyFirebaseIdToken(token);
    if (!claims || !claims.email) return null;

    const cleanEmail = claims.email.trim().toLowerCase();
    const isMaster = db.isMasterAuthorized(cleanEmail);
    const isAdmin = db.isStoreManagementAuthorized(cleanEmail);
    const resolvedRole: UserRole = isAdmin ? db.getStaffRole(cleanEmail) : 'PATRON';

    return {
      uid: claims.uid,
      email: cleanEmail,
      name: claims.name || cleanEmail.split('@')[0],
      role: resolvedRole,
      isMasterAdmin: isMaster,
      isStoreManagementAuthorized: isAdmin,
      photoURL: claims.picture,
      authProvider: 'GOOGLE'
    };
  } catch {
    return null;
  }
}

// Keep alias for backward compatibility in tests
export const resolveFirebaseToken = resolveAuthToken;

/**
 * Middleware: Requires a valid logged-in user
 */
export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const user = await resolveAuthTokenAsync(req.headers.authorization);

  if (!user) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication required. Please sign in to continue.'
    });
  }

  req.user = user;
  next();
}

/**
 * Factory for granular Role-Based Access Control (RBAC) Express middleware.
 * Rejects unauthenticated callers (401) and staff/patrons missing required role (403).
 */
export function createRoleGuard(allowedRoles: UserRole[], denialMessage: string) {
  return async function enforceRole(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const user = await resolveAuthTokenAsync(req.headers.authorization);

    if (!user) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required to access admin operations.'
      });
    }

    const isStaff = db.isStoreManagementAuthorized(user.email);
    const effectiveRole = isStaff ? db.getStaffRole(user.email) : 'PATRON';

    if (!isStaff || !allowedRoles.includes(effectiveRole)) {
      db.logAudit(
        user.email,
        'UNAUTHORIZED_ADMIN_ATTEMPT',
        'AUTH_PERMISSION',
        `Blocked ${user.email} (role: ${effectiveRole}) from ${req.method} ${req.originalUrl}`,
        req.ip
      );

      return res.status(403).json({
        error: 'FORBIDDEN',
        message: denialMessage
      });
    }

    req.user = { ...user, role: effectiveRole };
    next();
  };
}

/**
 * Middleware: Strictly enforces Full Store Management Access (STORE_MANAGER / Master Super-Admins).
 * Blocks SUPPORT_AGENT, LOGISTICS_COORDINATOR, and PATRON on Settings, Catalog CMS, and Admin Config.
 */
export const requireStoreManagementAccess = createRoleGuard(
  ['STORE_MANAGER'],
  'Access denied. Only Store Managers can access store configuration, catalog management, and administrative settings.'
);

/**
 * Middleware: CRM Access (Customer 360, Omnichannel Inbox, Payment Links, Sales Kanban).
 * Permitted: STORE_MANAGER, SUPPORT_AGENT. Blocked: LOGISTICS_COORDINATOR, PATRON.
 */
export const requireCrmAccess = createRoleGuard(
  ['STORE_MANAGER', 'SUPPORT_AGENT'],
  'Access denied. Customer 360, Omnichannel Inbox, and Sales Pipeline require Store Manager or Support Agent privileges.'
);

/**
 * Middleware: ERP & Supply Chain Access (Inventory, BOM, Orders, RMA, Invoices, Courier Milestones).
 * Permitted: STORE_MANAGER, LOGISTICS_COORDINATOR. Blocked: SUPPORT_AGENT, PATRON.
 */
export const requireErpAccess = createRoleGuard(
  ['STORE_MANAGER', 'LOGISTICS_COORDINATOR'],
  'Access denied. ERP Inventory, BOM, Dispatch, and RMA modules require Store Manager or Logistics Coordinator privileges.'
);

/**
 * Middleware: Read-only Executive & Operational Analytics Dashboard.
 * Permitted: STORE_MANAGER, SUPPORT_AGENT, LOGISTICS_COORDINATOR. Blocked: PATRON.
 */
export const requireAnalyticsAccess = createRoleGuard(
  ['STORE_MANAGER', 'SUPPORT_AGENT', 'LOGISTICS_COORDINATOR'],
  'Access denied. Only authorized staff members can view operational analytics.'
);

/**
 * Middleware: Strictly restricts Master-only actions (GST toggle, provisioning/revoking Admin User IDs)
 * to Founding Master Super-Admins (`db.isMasterAuthorized`).
 */
export async function requireMasterAdminAccess(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const user = await resolveAuthTokenAsync(req.headers.authorization);

  if (!user) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication required to perform Master Admin actions.'
    });
  }

  if (!db.isMasterAuthorized(user.email)) {
    db.logAudit(
      user.email,
      'UNAUTHORIZED_MASTER_ADMIN_ATTEMPT',
      'AUTH_PERMISSION',
      `Blocked non-master user ${user.email} from Master-only endpoint ${req.method} ${req.originalUrl}`,
      req.ip
    );

    return res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Only Founding Master Super-Admins can perform this administrative action.'
    });
  }

  req.user = user;
  next();
}
