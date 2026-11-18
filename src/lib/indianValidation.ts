/**
 * Strict Indian Address, Pincode, Phone (+91), and Patron Validation Utilities
 * Shared across React storefront/CRM forms and Express backend API endpoints.
 */

export const INDIAN_STATES_AND_UTS = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry'
] as const;

const STATE_ALIASES: Record<string, string> = {
  'new delhi': 'Delhi',
  'nct of delhi': 'Delhi',
  'delhi ncr': 'Delhi',
  'orissa': 'Odisha',
  'pondicherry': 'Puducherry',
  'uttaranchal': 'Uttarakhand',
  'andaman & nicobar islands': 'Andaman and Nicobar Islands',
  'jammu & kashmir': 'Jammu and Kashmir',
  'dadra & nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'daman & diu': 'Dadra and Nagar Haveli and Daman and Diu'
};

export const INDIAN_PHONE_REGEX = /^\+91[6-9]\d{9}$/;
export const INDIAN_PINCODE_REGEX = /^[1-9][0-9]{5}$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeIndianState(raw?: string): string | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (STATE_ALIASES[lower]) {
    return STATE_ALIASES[lower];
  }
  const exact = INDIAN_STATES_AND_UTS.find(s => s.toLowerCase() === lower);
  return exact || null;
}

export function validateIndianPhone(raw?: string): {
  valid: boolean;
  compact: string;
  formatted: string;
  error?: string;
} {
  const input = String(raw || '').trim();
  if (!input) {
    return {
      valid: false,
      compact: '',
      formatted: '',
      error: 'Phone number is required (+91 followed by 10 digits).'
    };
  }
  const compact = input.replace(/[\s\-()]+/g, '');
  if (!INDIAN_PHONE_REGEX.test(compact)) {
    return {
      valid: false,
      compact,
      formatted: input,
      error: 'Phone number must start with +91 followed by 10 digits (e.g. +91 98201 12345).'
    };
  }
  const digits = compact.slice(3);
  return {
    valid: true,
    compact,
    formatted: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
  };
}

/**
 * Helper for controlled React phone inputs that keeps a clean +91 prefix
 */
export function coerceIndianPhoneInput(raw: string): string {
  const stripped = raw.replace(/[^\d+]/g, '');
  if (!stripped || stripped === '+' || stripped === '+9') {
    return '+91 ';
  }
  let digits = stripped;
  if (digits.startsWith('+91')) {
    digits = digits.slice(3);
  } else if (digits.startsWith('91') && digits.length > 10) {
    digits = digits.slice(2);
  } else {
    digits = digits.replace(/^\+/, '');
  }
  const clipped = digits.replace(/\D/g, '').slice(0, 10);
  if (!clipped) return '+91 ';
  if (clipped.length <= 5) return `+91 ${clipped}`;
  return `+91 ${clipped.slice(0, 5)} ${clipped.slice(5)}`;
}

export function validateIndianPincode(raw?: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const normalized = String(raw || '').replace(/\s+/g, '');
  if (!normalized) {
    return {
      valid: false,
      normalized: '',
      error: '6-digit Indian PIN code is required.'
    };
  }
  if (!INDIAN_PINCODE_REGEX.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Enter a valid 6-digit Indian PIN code (cannot start with 0).'
    };
  }
  return { valid: true, normalized };
}

export function validateEmailAddress(raw?: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const normalized = String(raw || '').trim().toLowerCase();
  if (!normalized || !EMAIL_REGEX.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Please enter a valid email address.'
    };
  }
  return { valid: true, normalized };
}

export interface ShippingAndPatronInput {
  fullName?: string;
  email?: string;
  phone?: string;
  street?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
}

export function validateIndianCheckoutFields(input: ShippingAndPatronInput): {
  valid: boolean;
  errors: Record<string, string>;
  firstError?: string;
  normalized: {
    fullName: string;
    email: string;
    phone: string;
    street: string;
    city: string;
    state: string;
    pincode: string;
    country: 'India';
  };
} {
  const errors: Record<string, string> = {};

  const cleanName = String(input.fullName || '').trim();
  if (cleanName.length < 2) {
    errors.fullName = 'Full name must be at least 2 characters.';
  }

  const emailCheck = validateEmailAddress(input.email);
  if (!emailCheck.valid) {
    errors.email = emailCheck.error!;
  }

  const phoneCheck = validateIndianPhone(input.phone);
  if (!phoneCheck.valid) {
    errors.phone = phoneCheck.error!;
  }

  const cleanStreet = String(input.street || '').trim();
  if (cleanStreet.length < 5) {
    errors.street = 'Street address must be at least 5 characters.';
  }

  const cleanCity = String(input.city || '').trim();
  if (cleanCity.length < 2) {
    errors.city = 'City is required (minimum 2 characters).';
  }

  const normalizedState = normalizeIndianState(input.state);
  if (!normalizedState) {
    errors.state = 'Please select a valid Indian State or Union Territory.';
  }

  const pincodeCheck = validateIndianPincode(input.pincode);
  if (!pincodeCheck.valid) {
    errors.pincode = pincodeCheck.error!;
  }

  const cleanCountry = String(input.country || 'India').trim();
  if (cleanCountry.toLowerCase() !== 'india') {
    errors.country = 'Shipping destination is currently restricted to India only.';
  }

  const errorKeys = Object.keys(errors);
  return {
    valid: errorKeys.length === 0,
    errors,
    firstError: errorKeys.length > 0 ? errors[errorKeys[0]] : undefined,
    normalized: {
      fullName: cleanName,
      email: emailCheck.normalized,
      phone: phoneCheck.formatted,
      street: cleanStreet,
      city: cleanCity,
      state: normalizedState || String(input.state || '').trim(),
      pincode: pincodeCheck.normalized,
      country: 'India'
    }
  };
}
