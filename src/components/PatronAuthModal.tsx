import React, { useState } from 'react';
import { X, LogOut, Lock, CheckCircle2 } from 'lucide-react';
import { AuthUser } from '../types/index.ts';
import {
  signInWithGoogle,
  registerWithFirebaseEmail,
  signInWithFirebaseEmail,
  requestFirebasePasswordReset,
  getFirebaseSignInMethods
} from '../lib/firebase.ts';
import {
  INDIAN_STATES_AND_UTS,
  coerceIndianPhoneInput,
  validateEmailAddress,
  validateIndianPhone,
  validateIndianPincode,
  normalizeIndianState
} from '../lib/indianValidation.ts';
import { executeRecaptchaEnterprise } from '../lib/recaptcha.ts';

interface PatronAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AuthUser | null;
  onLoginSuccess: (user: AuthUser, token: string) => void;
  onLogout: () => void;
}

function formatFirebaseAuthError(code: string, fallbackMessage?: string, methods: string[] = []): string {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
  const isGoogleLinked = methods.includes('google.com');

  switch (code) {
    case 'auth/account-exists-with-different-credential':
      return "This email is linked to Google Sign-In. Please click 'Continue with Google' or use Forgot Password to set an email password.";
    case 'auth/email-already-in-use':
      return isGoogleLinked
        ? "This email is already linked to Google Sign-In. Please click 'Continue with Google' or use 'Forgot Password?' to set a password."
        : "An account with this email already exists. Please switch to Sign In, click 'Continue with Google', or use 'Forgot Password?'.";
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return isGoogleLinked
        ? "This email is linked to Google Sign-In. Please click 'Continue with Google' or use 'Forgot Password?' to set an email password."
        : "Invalid email or password. If you originally signed in with Google, please click 'Continue with Google' or use 'Forgot Password?' to set an email password.";
    case 'auth/wrong-password':
      return isGoogleLinked
        ? "This email is linked to Google Sign-In. Please click 'Continue with Google' or use 'Forgot Password?' to set an email password."
        : "Incorrect password. Please try again or click 'Forgot Password?' to reset it.";
    case 'auth/user-not-found':
      return "No account exists for this email yet. Click 'Create Account' to register or 'Continue with Google'.";
    case 'auth/unauthorized-domain':
      return `Authentication is not yet authorized for "${host}". Add "${host}" under Firebase Console → Authentication → Settings → Authorized domains.`;
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is disabled on the Firebase project. Please enable Email/Password under Firebase Console → Authentication → Sign-in method, or Continue with Google.';
    case 'auth/too-many-requests':
      return "Too many sign-in attempts. Please wait a few minutes or click 'Forgot Password?' to reset access.";
    case 'auth/weak-password':
      return 'Password is too weak. Please enter at least 8 characters.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    default:
      return fallbackMessage || 'Authentication failed. Please check your credentials and try again.';
  }
}

export const PatronAuthModal: React.FC<PatronAuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onLoginSuccess,
  onLogout
}) => {
  const [authMode, setAuthMode] = useState<'SIGN_IN' | 'SIGN_UP'>('SIGN_IN');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('+91 ');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showAddressFields, setShowAddressFields] = useState(false);
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const resetFormFields = () => {
    setFullName('');
    setPhone('+91 ');
    setEmail('');
    setPassword('');
    setStreet('');
    setCity('');
    setState('');
    setPincode('');
    setShowAddressFields(false);
  };

  const handleGoogleLogin = async () => {
    setIsGoogleSubmitting(true);
    setErrorMessage(null);
    setInfoMessage(null);
    try {
      const recaptchaToken = await executeRecaptchaEnterprise('GOOGLE_LOGIN');
      const { idToken } = await signInWithGoogle();
      const res = await fetch('/api/auth/firebase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, recaptchaToken, recaptchaAction: 'GOOGLE_LOGIN' })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onLoginSuccess(data.user, data.token);
        onClose();
      } else {
        setErrorMessage(data.error || 'Google sign-in verification failed.');
      }
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setErrorMessage('Google sign-in window was closed before completion.');
      } else if (code === 'auth/popup-blocked') {
        setErrorMessage('Pop-up was blocked by your browser. Please allow pop-ups and try again.');
      } else {
        setErrorMessage(formatFirebaseAuthError(code, err?.message));
      }
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    setErrorMessage(null);
    setInfoMessage(null);
    const cleanEmail = email.trim();
    const emailCheck = validateEmailAddress(cleanEmail);
    if (!emailCheck.valid) {
      setErrorMessage('Enter your registered email address first, then click "Forgot Password?".');
      return;
    }

    setIsResettingPassword(true);
    try {
      await executeRecaptchaEnterprise('PASSWORD_RESET');
      await requestFirebasePasswordReset(emailCheck.normalized);
      setInfoMessage(
        `Password reset email dispatched to ${emailCheck.normalized}. Check your inbox (and spam folder) to set or reset your password.`
      );
    } catch (err: any) {
      const methods = await getFirebaseSignInMethods(emailCheck.normalized);
      setErrorMessage(formatFirebaseAuthError(err?.code || '', err?.message, methods));
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);

    if (authMode === 'SIGN_IN') {
      if (!email.trim() || !password) {
        setErrorMessage('Email / User ID and password are required.');
        return;
      }
    } else {
      if (fullName.trim().length < 2) {
        setErrorMessage('Full name must be at least 2 characters.');
        return;
      }
      const phoneCheck = validateIndianPhone(phone);
      if (!phoneCheck.valid) {
        setErrorMessage(phoneCheck.error || 'Valid +91 Indian mobile number is required.');
        return;
      }
      const emailCheck = validateEmailAddress(email);
      if (!emailCheck.valid) {
        setErrorMessage(emailCheck.error || 'Please enter a valid email address.');
        return;
      }
      if (password.length < 8) {
        setErrorMessage('Password must be at least 8 characters long.');
        return;
      }
      const hasAnyAddr = Boolean(street.trim() || city.trim() || state.trim() || pincode.trim());
      if (hasAnyAddr) {
        if (street.trim().length < 5) {
          setErrorMessage('Street address must be at least 5 characters.');
          return;
        }
        if (city.trim().length < 2) {
          setErrorMessage('City is required (minimum 2 characters).');
          return;
        }
        if (!normalizeIndianState(state)) {
          setErrorMessage('Please select a valid Indian State or Union Territory.');
          return;
        }
        const pinCheck = validateIndianPincode(pincode);
        if (!pinCheck.valid) {
          setErrorMessage(pinCheck.error || 'Enter a valid 6-digit Indian PIN code.');
          return;
        }
      }
    }

    setIsSubmitting(true);

    try {
      const hasAnyAddr = Boolean(street.trim() || city.trim() || state.trim() || pincode.trim());

      if (authMode === 'SIGN_UP') {
        const cleanEmail = email.trim().toLowerCase();
        const cleanName = fullName.trim();
        const formattedPhone = validateIndianPhone(phone).formatted;

        const recaptchaToken = await executeRecaptchaEnterprise('SIGNUP');
        const { idToken } = await registerWithFirebaseEmail(cleanEmail, password, cleanName);
        const res = await fetch('/api/auth/firebase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idToken,
            recaptchaToken,
            recaptchaAction: 'SIGNUP',
            fullName: cleanName,
            phone: formattedPhone,
            ...(hasAnyAddr
              ? {
                  street: street.trim(),
                  city: city.trim(),
                  state: normalizeIndianState(state) || state.trim(),
                  pincode: pincode.trim(),
                  country: 'India'
                }
              : {})
          })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          onLoginSuccess(data.user, data.token);
          resetFormFields();
          onClose();
        } else {
          setErrorMessage(data.error || 'Account created in Firebase, but profile sync failed.');
        }
        return;
      }

      // SIGN_IN mode:
      const cleanIdentifier = email.trim();
      const looksLikeEmail = cleanIdentifier.includes('@');
      const recaptchaToken = await executeRecaptchaEnterprise('LOGIN');

      if (looksLikeEmail) {
        try {
          const { idToken } = await signInWithFirebaseEmail(cleanIdentifier.toLowerCase(), password);
          const res = await fetch('/api/auth/firebase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken, recaptchaToken, recaptchaAction: 'LOGIN' })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            onLoginSuccess(data.user, data.token);
            resetFormFields();
            onClose();
            return;
          }
          setErrorMessage(data.error || 'Firebase session verification failed.');
          return;
        } catch (fbErr: any) {
          const fbCode = fbErr?.code || '';
          // Keep backend credential login as fallback for Store Management staff/admin accounts & legacy credentials
          const canFallbackToBackend =
            fbCode === 'auth/invalid-credential' ||
            fbCode === 'auth/invalid-login-credentials' ||
            fbCode === 'auth/user-not-found' ||
            fbCode === 'auth/wrong-password' ||
            fbCode === 'auth/operation-not-allowed';

          if (canFallbackToBackend) {
            const backendRes = await fetch('/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: cleanIdentifier,
                password,
                recaptchaToken,
                recaptchaAction: 'LOGIN'
              })
            });
            const backendData = await backendRes.json().catch(() => null);
            if (backendRes.ok && backendData?.success) {
              onLoginSuccess(backendData.user, backendData.token);
              resetFormFields();
              onClose();
              return;
            }
          }

          const methods = await getFirebaseSignInMethods(cleanIdentifier);
          setErrorMessage(formatFirebaseAuthError(fbCode, fbErr?.message, methods));
          return;
        }
      }

      // Non-email Staff User ID login directly via backend credential verification
      const staffRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanIdentifier,
          password,
          recaptchaToken,
          recaptchaAction: 'LOGIN'
        })
      });
      const staffData = await staffRes.json();
      if (staffRes.ok && staffData.success) {
        onLoginSuccess(staffData.user, staffData.token);
        resetFormFields();
        onClose();
      } else {
        setErrorMessage(staffData.error || 'Authentication failed. Please check your User ID and password.');
      }
    } catch (err: any) {
      const code = err?.code || '';
      const methods = email.includes('@') ? await getFirebaseSignInMethods(email) : [];
      setErrorMessage(formatFirebaseAuthError(code, err?.message, methods));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#16120E]/70 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-md bg-white rounded-xl border border-[#221C16]/15 shadow-2xl p-6 space-y-5 text-[#221C16] max-h-[92vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-[#5C4D3E] hover:text-[#16120E] bg-[#FAF7F2] rounded-full"
        >
          <X className="w-5 h-5" />
        </button>

        <div>
          <h2 className="font-display text-xl font-bold text-[#16120E]">
            {authMode === 'SIGN_IN' ? 'Account Sign In' : 'Create Patron Account'}
          </h2>
          <p className="text-xs text-[#5C4D3E] mt-1">
            {authMode === 'SIGN_IN'
              ? 'Sign in with Google or your Firebase-secured email and password to manage orders and atelier preferences.'
              : 'Register with Firebase Auth and save your +91 mobile & delivery details for faster checkout.'}
          </p>
        </div>

        {/* Active session banner */}
        {currentUser && (
          <div className="p-3.5 bg-[#FAF7F2] rounded-lg border border-[#221C16]/10 flex items-center justify-between gap-3 text-xs font-mono">
            <div className="flex items-center gap-2.5 min-w-0">
              {currentUser.photoURL && (
                <img
                  src={currentUser.photoURL}
                  alt={currentUser.name}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full border border-[#221C16]/20 shrink-0"
                />
              )}
              <div className="min-w-0">
                <div className="text-[#5C4D3E]">Signed in as:</div>
                <div className="font-bold text-[#16120E] truncate">{currentUser.email}</div>
                <div className="text-[10px] text-[#8B4513] mt-0.5">
                  {currentUser.isStoreManagementAuthorized ? 'Authorized Administrator' : 'Patron Account'}
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                onLogout();
                onClose();
              }}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-700 hover:text-red-900 border border-red-200 rounded bg-white shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="p-3 bg-red-50 text-red-900 border border-red-200 rounded text-xs leading-relaxed">
            {errorMessage}
          </div>
        )}

        {infoMessage && (
          <div className="p-3 bg-emerald-50 text-emerald-900 border border-emerald-200 rounded text-xs leading-relaxed flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <span>{infoMessage}</span>
          </div>
        )}

        {/* Primary Google Sign-In Button */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={isGoogleSubmitting || isSubmitting}
          className="w-full py-2.5 px-4 bg-[#FAF7F2] hover:bg-[#EBE4D5]/70 text-[#16120E] border border-[#221C16]/20 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-2.5 shadow-sm disabled:opacity-60"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          <span>{isGoogleSubmitting ? 'Connecting Google Account...' : 'Continue with Google'}</span>
        </button>

        {/* Sign In / Create Account Mode Selector */}
        <div className="grid grid-cols-2 p-1 rounded-lg bg-[#FAF7F2] border border-[#221C16]/10 text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setAuthMode('SIGN_IN');
              setErrorMessage(null);
              setInfoMessage(null);
            }}
            className={`py-1.5 rounded-md transition-colors ${
              authMode === 'SIGN_IN' ? 'bg-white text-[#16120E] shadow-sm' : 'text-[#5C4D3E] hover:text-[#16120E]'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMode('SIGN_UP');
              setErrorMessage(null);
              setInfoMessage(null);
            }}
            className={`py-1.5 rounded-md transition-colors ${
              authMode === 'SIGN_UP' ? 'bg-white text-[#16120E] shadow-sm' : 'text-[#5C4D3E] hover:text-[#16120E]'
            }`}
          >
            Create Account
          </button>
        </div>

        <form noValidate onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          {authMode === 'SIGN_UP' && (
            <>
              <div>
                <label className="block text-[#5C4D3E] font-medium mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Aarav Kulkarni"
                  className="w-full px-3 py-2 border border-[#221C16]/20 rounded bg-[#FAF7F2] focus:outline-none focus:border-[#8B4513]"
                />
              </div>

              <div>
                <label className="block text-[#5C4D3E] font-medium mb-1">Indian Mobile (+91 · 10 digits) *</label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(coerceIndianPhoneInput(e.target.value))}
                  placeholder="+91 98200 12345"
                  className="w-full px-3 py-2 font-mono border border-[#221C16]/20 rounded bg-[#FAF7F2] focus:outline-none focus:border-[#8B4513]"
                />
              </div>

              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddressFields(v => !v)}
                  className="text-[11px] font-semibold text-[#8B4513] underline"
                >
                  {showAddressFields ? 'Hide Delivery Address' : '+ Add Indian Delivery Address (Auto-fills checkout & GST invoices)'}
                </button>
                {showAddressFields && (
                  <div className="mt-2.5 p-3 rounded-lg bg-[#FAF7F2] border border-[#221C16]/10 space-y-2.5">
                    <div>
                      <label className="block text-[11px] text-[#5C4D3E] mb-1">Street Address</label>
                      <input
                        type="text"
                        value={street}
                        onChange={(e) => setStreet(e.target.value)}
                        placeholder="House / Building, Street, Locality"
                        className="w-full px-2.5 py-1.5 border border-[#221C16]/20 rounded bg-white text-xs"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] text-[#5C4D3E] mb-1">City</label>
                        <input
                          type="text"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          placeholder="City"
                          className="w-full px-2 py-1.5 border border-[#221C16]/20 rounded bg-white text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-[#5C4D3E] mb-1">State</label>
                        <select
                          value={state}
                          onChange={(e) => setState(e.target.value)}
                          className="w-full px-2 py-1.5 border border-[#221C16]/20 rounded bg-white text-xs"
                        >
                          <option value="">State</option>
                          {INDIAN_STATES_AND_UTS.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-[#5C4D3E] mb-1">PIN Code</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={pincode}
                          onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="411057"
                          className="w-full px-2 py-1.5 font-mono border border-[#221C16]/20 rounded bg-white text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <div>
            <label className="block text-[#5C4D3E] font-medium mb-1">
              {authMode === 'SIGN_IN' ? 'Email or Staff User ID' : 'Email Address'}
            </label>
            <input
              type={authMode === 'SIGN_UP' ? 'email' : 'text'}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@domain.com"
              className="w-full px-3 py-2 border border-[#221C16]/20 rounded bg-[#FAF7F2] focus:outline-none focus:border-[#8B4513]"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[#5C4D3E] font-medium">
                Password {authMode === 'SIGN_UP' && <span className="text-[10px] font-normal">(min 8 chars)</span>}
              </label>
              {authMode === 'SIGN_IN' && (
                <button
                  type="button"
                  disabled={isResettingPassword || isSubmitting}
                  onClick={handleForgotPassword}
                  className="text-[11px] font-semibold text-[#8B4513] hover:underline disabled:opacity-50"
                >
                  {isResettingPassword ? 'Sending reset link...' : 'Forgot Password?'}
                </button>
              )}
            </div>
            <input
              type="password"
              required
              minLength={authMode === 'SIGN_UP' ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={authMode === 'SIGN_UP' ? 'Choose a strong password' : 'Enter password'}
              className="w-full px-3 py-2 border border-[#221C16]/20 rounded bg-[#FAF7F2] focus:outline-none focus:border-[#8B4513]"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || isGoogleSubmitting}
            className="w-full py-2.5 bg-[#221C16] text-[#FAF7F2] font-semibold rounded hover:bg-[#342B22] transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Lock className="w-3.5 h-3.5 text-[#C5A059]" />
            <span>
              {isSubmitting
                ? authMode === 'SIGN_UP'
                  ? 'Creating Account...'
                  : 'Signing In...'
                : authMode === 'SIGN_UP'
                ? 'Create Patron Account'
                : 'Sign In with Email / Credentials'}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
};
