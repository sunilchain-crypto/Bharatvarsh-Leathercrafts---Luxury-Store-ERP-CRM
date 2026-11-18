/**
 * Client-Side Google Firebase Authentication SDK Initialization
 * Loads configuration from firebase-applet-config.json.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
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

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
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

export async function signOutFirebase(): Promise<void> {
  if (auth.currentUser) {
    await signOut(auth);
  }
}

export { onAuthStateChanged, onIdTokenChanged };
export type { User as FirebaseAuthUser };
