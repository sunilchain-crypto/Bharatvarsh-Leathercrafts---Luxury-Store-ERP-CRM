import { isConfiguredCredential } from './integrations.ts';
import { db } from './db.ts';

export interface RecaptchaVerificationResult {
  allowed: boolean;
  mode: 'LIVE' | 'CLIENT_ONLY_PASS';
  score?: number;
  action?: string;
  reason?: string;
}

const DEFAULT_SITE_KEY = '6Le3mCcuAAAAAJCQBRIMvqTGd4RadX5JvnNubovL';

export async function verifyRecaptchaEnterpriseToken(params: {
  token?: string;
  expectedAction: string;
  actorHint?: string;
}): Promise<RecaptchaVerificationResult> {
  const apiKey = process.env.RECAPTCHA_ENTERPRISE_API_KEY;
  if (!isConfiguredCredential(apiKey)) {
    return {
      allowed: true,
      mode: 'CLIENT_ONLY_PASS',
      action: params.expectedAction,
      reason: 'RECAPTCHA_ENTERPRISE_API_KEY not configured; client execution active without server assessment blocking.'
    };
  }

  const cleanToken = typeof params.token === 'string' ? params.token.trim() : '';
  if (!cleanToken) {
    db.logAudit(
      params.actorHint || 'anonymous',
      'RECAPTCHA_BLOCKED',
      'AUTH_PERMISSION',
      `Blocked ${params.expectedAction}: missing reCAPTCHA Enterprise token`
    );
    return {
      allowed: false,
      mode: 'LIVE',
      reason: 'Security verification token missing. Please reload the page and try again.'
    };
  }

  const projectId =
    process.env.RECAPTCHA_ENTERPRISE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    'bharatvarsh-auth';
  const siteKey = process.env.RECAPTCHA_ENTERPRISE_SITE_KEY || DEFAULT_SITE_KEY;
  const minScore = Number.isFinite(Number(process.env.RECAPTCHA_MIN_SCORE))
    ? Number(process.env.RECAPTCHA_MIN_SCORE)
    : 0.3;

  try {
    const endpoint = `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}/assessments?key=${encodeURIComponent(apiKey!)}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: {
          token: cleanToken,
          expectedAction: params.expectedAction,
          siteKey
        }
      })
    });

    const data = (await response.json().catch(() => null)) as any;
    if (!response.ok || !data) {
      return {
        allowed: false,
        mode: 'LIVE',
        reason: data?.error?.message || `reCAPTCHA Enterprise API HTTP ${response.status}`
      };
    }

    const tokenProps = data.tokenProperties || {};
    const riskAnalysis = data.riskAnalysis || {};
    const score = typeof riskAnalysis.score === 'number' ? riskAnalysis.score : 0;

    if (!tokenProps.valid) {
      db.logAudit(
        params.actorHint || 'anonymous',
        'RECAPTCHA_BLOCKED',
        'AUTH_PERMISSION',
        `Blocked ${params.expectedAction}: invalid reCAPTCHA token (${tokenProps.invalidReason || 'UNKNOWN'})`
      );
      return {
        allowed: false,
        mode: 'LIVE',
        score,
        action: tokenProps.action,
        reason: `Security check failed (${tokenProps.invalidReason || 'invalid token'}). Please try again.`
      };
    }

    if (tokenProps.action && tokenProps.action !== params.expectedAction) {
      db.logAudit(
        params.actorHint || 'anonymous',
        'RECAPTCHA_BLOCKED',
        'AUTH_PERMISSION',
        `Blocked ${params.expectedAction}: action mismatch (got ${tokenProps.action})`
      );
      return {
        allowed: false,
        mode: 'LIVE',
        score,
        action: tokenProps.action,
        reason: 'Security token action mismatch. Please refresh and retry.'
      };
    }

    if (score < minScore) {
      db.logAudit(
        params.actorHint || 'anonymous',
        'RECAPTCHA_BLOCKED',
        'AUTH_PERMISSION',
        `Blocked ${params.expectedAction}: low risk score (${score} < ${minScore})`
      );
      return {
        allowed: false,
        mode: 'LIVE',
        score,
        action: tokenProps.action,
        reason: 'Automated or suspicious activity detected. Please retry or contact concierge.'
      };
    }

    return {
      allowed: true,
      mode: 'LIVE',
      score,
      action: tokenProps.action || params.expectedAction
    };
  } catch (err: any) {
    return {
      allowed: false,
      mode: 'LIVE',
      reason: `reCAPTCHA Enterprise verification error: ${err?.message || 'network failure'}`
    };
  }
}
