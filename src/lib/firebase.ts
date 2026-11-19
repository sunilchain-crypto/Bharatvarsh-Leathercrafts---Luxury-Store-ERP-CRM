/**
 * Client-Side Google Firebase Authentication SDK Initialization
 * Supports Google Sign-In, Firebase Email/Password Registration & Sign-In,
 * Password Reset Emails, and Sign-In Method inspection.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, AppCheck } from 'firebase/app-check';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail,
  signOut,
  onAuthStateChanged,
  onIdTokenChanged,
  User
} from 'firebase/auth';
import defaultFirebaseConfig from '../../firebase-applet-config.json';

const viteEnv = (import.meta as any).env || {};
const firebaseConfig = {
  ...defaultFirebaseConfig,
  ...(viteEnv.VITE_FIREBASE_API_KEY ? { apiKey: String(viteEnv.VITE_FIREBASE_API_KEY).trim() } : {}),
  ...(viteEnv.VITE_FIREBASE_AUTH_DOMAIN ? { authDomain: String(viteEnv.VITE_FIREBASE_AUTH_DOMAIN).trim() } : {}),
  ...(viteEnv.VITE_FIREBASE_PROJECT_ID ? { projectId: String(viteEnv.VITE_FIREBASE_PROJECT_ID).trim() } : {}),
  ...(viteEnv.VITE_FIREBASE_APP_ID ? { appId: String(viteEnv.VITE_FIREBASE_APP_ID).trim() } : {}),
  ...(viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID
    ? { messagingSenderId: String(viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID).trim() }
    : {})
};

const RECAPTCHA_ENTERPRISE_SITE_KEY =
  (viteEnv.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY
    ? String(viteEnv.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY).trim()
    : '') || '6Le3mCcuAAAAAJCQBRIMvqTGd4RadX5JvnNubovL';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Initialize Firebase App Check with reCAPTCHA Enterprise BEFORE initializing Auth or other Firebase services
export let appCheck: AppCheck | null = null;
if (typeof window !== 'undefined') {
  try {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
      isTokenAutoRefreshEnabled: true
    });
  } catch (err) {
    console.warn('[Firebase AppCheck] Initialization skipped or already active:', err);
  }
}

export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

export async function signInWithGoogle(): Promise<{ user: User; idToken: string }> {
  const result = await signInWithPopup(auth, googleProvider);
  const idToken = await result.user.getIdToken();
  return { user: result.user, idToken };
}

export async function registerWithFirebaseEmail(
  email: string,
  password: string,
  displayName: string
): Promise<{ user: User; idToken: string }> {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (displayName.trim()) {
    await updateProfile(cred.user, { displayName: displayName.trim() }).catch(() => {});
  }
  const idToken = await cred.user.getIdToken(true);
  return { user: cred.user, idToken };
}

export async function signInWithFirebaseEmail(
  email: string,
  password: string
): Promise<{ user: User; idToken: string }> {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  const idToken = await cred.user.getIdToken();
  return { user: cred.user, idToken };
}

export async function requestFirebasePasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function getFirebaseSignInMethods(email: string): Promise<string[]> {
  try {
    return await fetchSignInMethodsForEmail(auth, email.trim());
  } catch {
    return [];
  }
}

export async function signOutFirebase(): Promise<void> {
  if (auth.currentUser) {
    await signOut(auth);
  }
}

export { onAuthStateChanged, onIdTokenChanged };
export type { User as FirebaseAuthUser };
