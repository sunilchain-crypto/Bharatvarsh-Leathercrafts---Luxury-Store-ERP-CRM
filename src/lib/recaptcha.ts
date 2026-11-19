export const RECAPTCHA_ENTERPRISE_SITE_KEY =
  (import.meta as any).env?.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY ||
  '6Le3mCcuAAAAAJCQBRIMvqTGd4RadX5JvnNubovL';

export type RecaptchaAction =
  | 'LOGIN'
  | 'SIGNUP'
  | 'PASSWORD_RESET'
  | 'GOOGLE_LOGIN'
  | 'CHECKOUT'
  | 'PROMO_VALIDATE';

interface GrecaptchaEnterprise {
  ready: (callback: () => void) => void;
  execute: (siteKey: string, options: { action: string }) => Promise<string>;
}

declare global {
  interface Window {
    grecaptcha?: {
      enterprise?: GrecaptchaEnterprise;
    };
  }
}

export async function executeRecaptchaEnterprise(
  action: RecaptchaAction,
  timeoutMs: number = 2500
): Promise<string | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  const enterprise = window.grecaptcha?.enterprise;
  if (!enterprise) {
    return null;
  }

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);

    try {
      enterprise.ready(async () => {
        try {
          const token = await enterprise.execute(RECAPTCHA_ENTERPRISE_SITE_KEY, { action });
          if (!settled) {
            settled = true;
            window.clearTimeout(timer);
            resolve(token || null);
          }
        } catch {
          if (!settled) {
            settled = true;
            window.clearTimeout(timer);
            resolve(null);
          }
        }
      });
    } catch {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(null);
      }
    }
  });
}
