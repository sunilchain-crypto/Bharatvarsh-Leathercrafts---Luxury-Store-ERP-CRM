/**
 * External Provider Integration Adapters for Bharatvarsh Leathercrafts LLP
 * Payments: Razorpay & Stripe (Orders, PaymentIntents, Payment Links)
 * Logistics: Shiprocket & Delhivery (AWB Allocation & Milestone Sync)
 * Messaging: Transactional SMTP (nodemailer) & WhatsApp Business Cloud API
 *
 * Executes live provider API calls when non-placeholder environment keys are configured,
 * and falls back gracefully to deterministic sandbox simulation when keys are absent.
 */

import nodemailer from 'nodemailer';
import { Order, CartRecord, SupportTicket, GSTInvoice } from '../types/index.ts';
import { db } from './db.ts';
import { renderTaxInvoicePdf, REGISTERED_OFFICE_ADDRESS_HTML } from './invoicePdf.ts';

export type GatewayExecutionMode = 'LIVE' | 'SANDBOX_FALLBACK';

export interface ProviderReadiness {
  provider: string;
  category: 'PAYMENTS' | 'LOGISTICS' | 'MESSAGING';
  configured: boolean;
  mode: GatewayExecutionMode;
  summary: string;
}

export function isConfiguredCredential(value?: string): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('placeholder') ||
    lower.startsWith('your_') ||
    lower.includes('dummy') ||
    lower.includes('example')
  ) {
    return false;
  }
  return true;
}

export function getIntegrationsReadiness(): ProviderReadiness[] {
  const razorpayConfigured =
    isConfiguredCredential(process.env.RAZORPAY_KEY_ID) &&
    isConfiguredCredential(process.env.RAZORPAY_KEY_SECRET);
  const stripeConfigured = isConfiguredCredential(process.env.STRIPE_SECRET_KEY);
  const shiprocketConfigured =
    isConfiguredCredential(process.env.SHIPROCKET_API_TOKEN) ||
    (isConfiguredCredential(process.env.SHIPROCKET_EMAIL) &&
      isConfiguredCredential(process.env.SHIPROCKET_PASSWORD));
  const delhiveryConfigured = isConfiguredCredential(process.env.DELHIVERY_API_KEY);
  const smtpHostClean = normalizeEnvValue(process.env.SMTP_HOST);
  const smtpConfigured =
    isConfiguredCredential(smtpHostClean) &&
    isConfiguredCredential(normalizeEnvValue(process.env.SMTP_USER)) &&
    isConfiguredCredential(normalizeEnvValue(process.env.SMTP_PASS));
  const whatsappConfigured =
    isConfiguredCredential(process.env.WHATSAPP_BUSINESS_PHONE_NUMBER_ID) &&
    isConfiguredCredential(process.env.WHATSAPP_ACCESS_TOKEN);

  return [
    {
      provider: 'Razorpay',
      category: 'PAYMENTS',
      configured: razorpayConfigured,
      mode: razorpayConfigured ? 'LIVE' : 'SANDBOX_FALLBACK',
      summary: razorpayConfigured
        ? 'Live Razorpay Orders & Payment Links active'
        : 'Missing live RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET — using sandbox fallback'
    },
    {
      provider: 'Stripe',
      category: 'PAYMENTS',
      configured: stripeConfigured,
      mode: stripeConfigured ? 'LIVE' : 'SANDBOX_FALLBACK',
      summary: stripeConfigured
        ? 'Live Stripe PaymentIntents & Checkout Links active'
        : 'Missing live STRIPE_SECRET_KEY — using sandbox fallback'
    },
    {
      provider: 'Shiprocket',
      category: 'LOGISTICS',
      configured: shiprocketConfigured,
      mode: shiprocketConfigured ? 'LIVE' : 'SANDBOX_FALLBACK',
      summary: shiprocketConfigured
        ? 'Live Shiprocket AWB dispatch & courier API active'
        : 'Missing live SHIPROCKET credentials — using Pune hub sandbox AWB'
    },
    {
      provider: 'Delhivery',
      category: 'LOGISTICS',
      configured: delhiveryConfigured,
      mode: delhiveryConfigured ? 'LIVE' : 'SANDBOX_FALLBACK',
      summary: delhiveryConfigured
        ? 'Live Delhivery express surface/air cargo active'
        : 'Missing live DELHIVERY_API_KEY — using Delhivery sandbox fallback'
    },
    {
      provider: 'Transactional SMTP',
      category: 'MESSAGING',
      configured: smtpConfigured,
      mode: smtpConfigured ? 'LIVE' : 'SANDBOX_FALLBACK',
      summary: smtpConfigured
        ? `Live SMTP relay configured (${smtpHostClean}, auto 465/587 TLS)${
            isPerOrderEmailDisabled() ? ' · Daily consolidated mode' : ''
          }`
        : 'Missing SMTP_HOST / SMTP_USER / SMTP_PASS — logging email dispatches locally'
    },
    {
      provider: 'WhatsApp Business',
      category: 'MESSAGING',
      configured: whatsappConfigured,
      mode: whatsappConfigured ? 'LIVE' : 'SANDBOX_FALLBACK',
      summary: whatsappConfigured
        ? 'Live Meta WhatsApp Cloud API active'
        : 'Missing WHATSAPP_ACCESS_TOKEN / PHONE_NUMBER_ID — logging WhatsApp dispatches locally'
    }
  ];
}

// ==========================================
// 1. PAYMENTS ADAPTER (RAZORPAY / STRIPE)
// ==========================================

export async function createGatewayOrderOrIntent(params: {
  gateway: 'RAZORPAY' | 'STRIPE' | 'CASH_ON_DELIVERY';
  amountInr: number;
  receipt: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
}): Promise<{
  mode: GatewayExecutionMode;
  provider: string;
  paymentId: string;
  clientSecret?: string;
  fallbackReason?: string;
}> {
  if (params.gateway === 'CASH_ON_DELIVERY') {
    return {
      mode: 'SANDBOX_FALLBACK',
      provider: 'CASH_ON_DELIVERY',
      paymentId: `cod_verified_${Date.now()}`
    };
  }

  const amountPaise = Math.max(100, Math.round(params.amountInr * 100));

  if (params.gateway === 'RAZORPAY') {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (isConfiguredCredential(keyId) && isConfiguredCredential(keySecret)) {
      try {
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const res = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            amount: amountPaise,
            currency: 'INR',
            receipt: params.receipt.slice(0, 40),
            notes: {
              customerEmail: params.customerEmail,
              customerName: params.customerName
            }
          })
        });
        const data = (await res.json()) as any;
        if (res.ok && data.id) {
          return {
            mode: 'LIVE',
            provider: 'RAZORPAY',
            paymentId: data.id
          };
        }
        return {
          mode: 'SANDBOX_FALLBACK',
          provider: 'RAZORPAY',
          paymentId: `pay_rzp_sbx_${Date.now()}`,
          fallbackReason: data?.error?.description || `Razorpay HTTP ${res.status}`
        };
      } catch (err: any) {
        return {
          mode: 'SANDBOX_FALLBACK',
          provider: 'RAZORPAY',
          paymentId: `pay_rzp_sbx_${Date.now()}`,
          fallbackReason: err.message
        };
      }
    }

    return {
      mode: 'SANDBOX_FALLBACK',
      provider: 'RAZORPAY',
      paymentId: `pay_rzp_sbx_${Date.now()}`,
      fallbackReason: 'Razorpay live credentials not configured'
    };
  }

  // STRIPE
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (isConfiguredCredential(stripeSecret)) {
    try {
      const form = new URLSearchParams();
      form.set('amount', String(amountPaise));
      form.set('currency', 'inr');
      form.set('receipt_email', params.customerEmail);
      form.set('description', `Bharatvarsh Order ${params.receipt}`);
      form.set('metadata[customerName]', params.customerName);

      const res = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeSecret}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: form.toString()
      });
      const data = (await res.json()) as any;
      if (res.ok && data.id) {
        return {
          mode: 'LIVE',
          provider: 'STRIPE',
          paymentId: data.id,
          clientSecret: data.client_secret
        };
      }
      return {
        mode: 'SANDBOX_FALLBACK',
        provider: 'STRIPE',
        paymentId: `pi_str_sbx_${Date.now()}`,
        fallbackReason: data?.error?.message || `Stripe HTTP ${res.status}`
      };
    } catch (err: any) {
      return {
        mode: 'SANDBOX_FALLBACK',
        provider: 'STRIPE',
        paymentId: `pi_str_sbx_${Date.now()}`,
        fallbackReason: err.message
      };
    }
  }

  return {
    mode: 'SANDBOX_FALLBACK',
    provider: 'STRIPE',
    paymentId: `pi_str_sbx_${Date.now()}`,
    fallbackReason: 'Stripe live credentials not configured'
  };
}

export async function createPaymentLink(params: {
  gateway?: 'RAZORPAY' | 'STRIPE';
  amountInr: number;
  description: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  referenceId?: string;
}): Promise<{
  mode: GatewayExecutionMode;
  provider: 'RAZORPAY' | 'STRIPE';
  paymentUrl: string;
  referenceId: string;
  fallbackReason?: string;
}> {
  const gateway = params.gateway || 'RAZORPAY';
  const amountPaise = Math.max(100, Math.round(params.amountInr * 100));
  const ref = params.referenceId || `bvl_lnk_${Date.now().toString(36)}`;
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

  if (gateway === 'RAZORPAY') {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (isConfiguredCredential(keyId) && isConfiguredCredential(keySecret)) {
      try {
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const res = await fetch('https://api.razorpay.com/v1/payment_links', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            amount: amountPaise,
            currency: 'INR',
            reference_id: ref.slice(0, 40),
            description: params.description.slice(0, 200),
            customer: {
              name: params.customerName || 'Valued Patron',
              email: params.customerEmail,
              ...(params.customerPhone ? { contact: params.customerPhone } : {})
            },
            notify: {
              sms: Boolean(params.customerPhone),
              email: Boolean(params.customerEmail)
            }
          })
        });
        const data = (await res.json()) as any;
        if (res.ok && data.short_url) {
          return {
            mode: 'LIVE',
            provider: 'RAZORPAY',
            paymentUrl: data.short_url,
            referenceId: data.id || ref
          };
        }
        return {
          mode: 'SANDBOX_FALLBACK',
          provider: 'RAZORPAY',
          paymentUrl: `${appUrl}/?payment_link=${encodeURIComponent(ref)}&gateway=razorpay`,
          referenceId: ref,
          fallbackReason: data?.error?.description || `Razorpay HTTP ${res.status}`
        };
      } catch (err: any) {
        return {
          mode: 'SANDBOX_FALLBACK',
          provider: 'RAZORPAY',
          paymentUrl: `${appUrl}/?payment_link=${encodeURIComponent(ref)}&gateway=razorpay`,
          referenceId: ref,
          fallbackReason: err.message
        };
      }
    }

    return {
      mode: 'SANDBOX_FALLBACK',
      provider: 'RAZORPAY',
      paymentUrl: `${appUrl}/?payment_link=${encodeURIComponent(ref)}&gateway=razorpay`,
      referenceId: ref,
      fallbackReason: 'Razorpay live credentials not configured'
    };
  }

  // STRIPE Checkout Session Link
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (isConfiguredCredential(stripeSecret)) {
    try {
      const form = new URLSearchParams();
      form.set('mode', 'payment');
      form.set('customer_email', params.customerEmail);
      form.set('line_items[0][price_data][currency]', 'inr');
      form.set('line_items[0][price_data][product_data][name]', params.description.slice(0, 120));
      form.set('line_items[0][price_data][unit_amount]', String(amountPaise));
      form.set('line_items[0][quantity]', '1');
      form.set('success_url', `${appUrl}/?payment_success=${encodeURIComponent(ref)}`);
      form.set('cancel_url', `${appUrl}/?payment_cancelled=${encodeURIComponent(ref)}`);

      const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeSecret}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: form.toString()
      });
      const data = (await res.json()) as any;
      if (res.ok && data.url) {
        return {
          mode: 'LIVE',
          provider: 'STRIPE',
          paymentUrl: data.url,
          referenceId: data.id || ref
        };
      }
      return {
        mode: 'SANDBOX_FALLBACK',
        provider: 'STRIPE',
        paymentUrl: `${appUrl}/?payment_link=${encodeURIComponent(ref)}&gateway=stripe`,
        referenceId: ref,
        fallbackReason: data?.error?.message || `Stripe HTTP ${res.status}`
      };
    } catch (err: any) {
      return {
        mode: 'SANDBOX_FALLBACK',
        provider: 'STRIPE',
        paymentUrl: `${appUrl}/?payment_link=${encodeURIComponent(ref)}&gateway=stripe`,
        referenceId: ref,
        fallbackReason: err.message
      };
    }
  }

  return {
    mode: 'SANDBOX_FALLBACK',
    provider: 'STRIPE',
    paymentUrl: `${appUrl}/?payment_link=${encodeURIComponent(ref)}&gateway=stripe`,
    referenceId: ref,
    fallbackReason: 'Stripe live credentials not configured'
  };
}

// ==========================================
// 2. LOGISTICS ADAPTER (SHIPROCKET / DELHIVERY)
// ==========================================

async function getShiprocketBearerToken(): Promise<string | null> {
  if (isConfiguredCredential(process.env.SHIPROCKET_API_TOKEN)) {
    return process.env.SHIPROCKET_API_TOKEN!.trim();
  }
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  if (isConfiguredCredential(email) && isConfiguredCredential(password)) {
    const res = await fetch('https://apiv2.shiprocket.in/v1/external/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = (await res.json()) as any;
    if (res.ok && data.token) return data.token;
  }
  return null;
}

export async function allocateCourierAwb(params: {
  order: Order;
  courierPreference?: 'SHIPROCKET' | 'DELHIVERY';
}): Promise<{
  mode: GatewayExecutionMode;
  courier: 'SHIPROCKET' | 'DELHIVERY';
  awbNumber: string;
  fallbackReason?: string;
}> {
  const preferred = params.courierPreference || 'SHIPROCKET';
  const ord = params.order;

  if (preferred === 'DELHIVERY') {
    const apiKey = process.env.DELHIVERY_API_KEY;
    if (isConfiguredCredential(apiKey)) {
      try {
        const res = await fetch(
          `https://track.delhivery.com/waybill/api/fetch/json/?token=${encodeURIComponent(apiKey!)}&cl=${encodeURIComponent(
            process.env.DELHIVERY_CLIENT_NAME || 'BHARATVARSH_SURFACE'
          )}`
        );
        const text = await res.text();
        const cleaned = text.replace(/["\s]/g, '');
        if (res.ok && cleaned.length >= 6) {
          return {
            mode: 'LIVE',
            courier: 'DELHIVERY',
            awbNumber: cleaned
          };
        }
      } catch (err: any) {
        return {
          mode: 'SANDBOX_FALLBACK',
          courier: 'DELHIVERY',
          awbNumber: ord.awbNumber || `DLV-PNQ-${Math.floor(10000000 + Math.random() * 90000000)}`,
          fallbackReason: err.message
        };
      }
    }
    return {
      mode: 'SANDBOX_FALLBACK',
      courier: 'DELHIVERY',
      awbNumber: ord.awbNumber || `DLV-PNQ-${Math.floor(10000000 + Math.random() * 90000000)}`,
      fallbackReason: 'Delhivery API key not configured'
    };
  }

  // SHIPROCKET
  try {
    const token = await getShiprocketBearerToken();
    if (token) {
      const res = await fetch('https://apiv2.shiprocket.in/v1/external/orders/create/adhoc', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          order_id: ord.orderNumber,
          order_date: ord.createdAt.slice(0, 19).replace('T', ' '),
          pickup_location: 'Primary',
          billing_customer_name: ord.customerName,
          billing_last_name: '',
          billing_address: ord.billingAddress?.street || 'Pune Primary Hub',
          billing_city: ord.billingAddress?.city || 'Pune',
          billing_pincode: ord.billingAddress?.pincode || '411019',
          billing_state: ord.billingAddress?.state || 'Maharashtra',
          billing_country: 'India',
          billing_email: ord.customerEmail,
          billing_phone: (ord.customerPhone || '9820112345').replace(/\D/g, '').slice(-10) || '9820112345',
          shipping_is_billing: true,
          order_items: ord.items.map(it => ({
            name: it.productName,
            sku: it.sku,
            units: it.quantity,
            selling_price: it.unitPrice
          })),
          payment_method: ord.paymentGateway === 'CASH_ON_DELIVERY' ? 'COD' : 'Prepaid',
          sub_total: ord.totalAmount,
          length: 34,
          breadth: 26,
          height: 12,
          weight: 1.4
        })
      });
      const data = (await res.json()) as any;
      const awb = data?.awb_code || (data?.shipment_id ? `SR-SHP-${data.shipment_id}` : '');
      if (res.ok && awb) {
        return {
          mode: 'LIVE',
          courier: 'SHIPROCKET',
          awbNumber: String(awb)
        };
      }
      return {
        mode: 'SANDBOX_FALLBACK',
        courier: 'SHIPROCKET',
        awbNumber: ord.awbNumber || `SR-PNQ-${Math.floor(10000000 + Math.random() * 90000000)}`,
        fallbackReason: data?.message || `Shiprocket HTTP ${res.status}`
      };
    }
  } catch (err: any) {
    return {
      mode: 'SANDBOX_FALLBACK',
      courier: 'SHIPROCKET',
      awbNumber: ord.awbNumber || `SR-PNQ-${Math.floor(10000000 + Math.random() * 90000000)}`,
      fallbackReason: err.message
    };
  }

  return {
    mode: 'SANDBOX_FALLBACK',
    courier: 'SHIPROCKET',
    awbNumber: ord.awbNumber || `SR-PNQ-${Math.floor(10000000 + Math.random() * 90000000)}`,
    fallbackReason: 'Shiprocket credentials not configured'
  };
}

// ==========================================
// 3. MESSAGING ADAPTERS (SMTP & WHATSAPP)
// ==========================================

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export function normalizeEnvValue(raw?: string): string {
  if (!raw) return '';
  let val = raw.trim();
  if (
    (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
    (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
  ) {
    val = val.slice(1, -1).trim();
  }
  return val;
}

export interface SmtpTransportAttempt {
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
  label: string;
}

/**
 * Resolves canonical SMTP transport attempts so port/TLS mismatches (e.g. port 465 with secure=false
 * or port 587 with secure=true) can never trigger "Greeting never received" or SSL version errors,
 * and automatically falls back between 465 (SMTPS) and 587 (STARTTLS) if the primary port times out.
 */
export function buildSmtpTransportAttempts(env: NodeJS.ProcessEnv = process.env): SmtpTransportAttempt[] {
  const host = normalizeEnvValue(env.SMTP_HOST);
  if (!host) return [];

  const parsedPort = parseInt(normalizeEnvValue(env.SMTP_PORT), 10);
  const primaryPort = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 465;

  const rawSecure = normalizeEnvValue(env.SMTP_SECURE).toLowerCase();
  const parseBoolSecure = (fallback: boolean) => {
    if (['true', '1', 'yes', 'ssl', 'tls'].includes(rawSecure)) return true;
    if (['false', '0', 'no', 'starttls'].includes(rawSecure)) return false;
    return fallback;
  };

  // Standard SMTP ports have strict TLS semantics:
  // - 465 is ALWAYS implicit TLS (SMTPS -> secure: true)
  // - 587 is ALWAYS explicit STARTTLS (secure: false, requireTLS: true)
  let primarySecure: boolean;
  let primaryRequireTls = false;
  if (primaryPort === 465) {
    primarySecure = true;
  } else if (primaryPort === 587) {
    primarySecure = false;
    primaryRequireTls = true;
  } else if (primaryPort === 25 || primaryPort === 2525) {
    primarySecure = false;
  } else {
    primarySecure = parseBoolSecure(false);
  }

  const attempts: SmtpTransportAttempt[] = [
    {
      host,
      port: primaryPort,
      secure: primarySecure,
      ...(primaryRequireTls ? { requireTLS: true } : {}),
      label: `${host}:${primaryPort} (${primarySecure ? 'SMTPS' : primaryRequireTls ? 'STARTTLS' : 'SMTP'})`
    }
  ];

  // Add automatic fallback between 465 (SMTPS) and 587 (STARTTLS) in case one port is blocked/stalled
  if (primaryPort === 465) {
    attempts.push({
      host,
      port: 587,
      secure: false,
      requireTLS: true,
      label: `${host}:587 (STARTTLS fallback)`
    });
  } else if (primaryPort === 587) {
    attempts.push({
      host,
      port: 465,
      secure: true,
      label: `${host}:465 (SMTPS fallback)`
    });
  }

  return attempts;
}

function isRetryableSmtpTransportError(err: any): boolean {
  const code = String(err?.code || '').toUpperCase();
  const msg = String(err?.message || '').toLowerCase();
  // Never retry authentication rejections on another port
  if (code === 'EAUTH' || msg.includes('535') || msg.includes('invalid login') || msg.includes('authentication failed')) {
    return false;
  }
  return (
    code === 'ETIMEDOUT' ||
    code === 'ESOCKET' ||
    code === 'ECONNECTION' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    msg.includes('greeting never received') ||
    msg.includes('wrong version number') ||
    msg.includes('timeout') ||
    msg.includes('socket close') ||
    msg.includes('connection closed')
  );
}

export function isPerOrderEmailDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const disableFlag = normalizeEnvValue(env.DISABLE_PER_ORDER_EMAILS).toLowerCase();
  if (['true', '1', 'yes'].includes(disableFlag)) return true;
  const enableFlag = normalizeEnvValue(env.ENABLE_PER_ORDER_EMAILS).toLowerCase();
  if (['false', '0', 'no'].includes(enableFlag)) return true;
  return false;
}

export function getSupportOrderEmailRecipient(): string {
  const configured =
    normalizeEnvValue(process.env.SUPPORT_ORDER_EMAIL) || normalizeEnvValue(process.env.SMTP_SUPPORT_EMAIL);
  if (configured && isConfiguredCredential(configured)) {
    return configured;
  }
  return 'Support@bharatvarshcrafts.com';
}

export function getMissingSmtpReason(): string {
  const missing: string[] = [];
  if (!isConfiguredCredential(normalizeEnvValue(process.env.SMTP_HOST))) missing.push('SMTP_HOST');
  if (!isConfiguredCredential(normalizeEnvValue(process.env.SMTP_USER))) missing.push('SMTP_USER');
  if (!isConfiguredCredential(normalizeEnvValue(process.env.SMTP_PASS))) missing.push('SMTP_PASS');
  if (missing.length === 0) return '';
  return `Missing ${missing.join(', ')} in server environment`;
}

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}): Promise<{
  mode: GatewayExecutionMode;
  channel: 'EMAIL';
  messageId: string;
  smtpConfigured: boolean;
  transportUsed?: string;
  fallbackReason?: string;
}> {
  const recipient = (params.to || '').trim();
  if (!recipient || !recipient.includes('@')) {
    return {
      mode: 'SANDBOX_FALLBACK',
      channel: 'EMAIL',
      messageId: `email_err_${Date.now()}`,
      smtpConfigured: false,
      fallbackReason: 'Missing or invalid recipient email address'
    };
  }

  const host = normalizeEnvValue(process.env.SMTP_HOST);
  const user = normalizeEnvValue(process.env.SMTP_USER);
  const pass = normalizeEnvValue(process.env.SMTP_PASS);
  const supportEmail = normalizeEnvValue(process.env.SMTP_SUPPORT_EMAIL);
  // GoDaddy (smtpout.secureserver.net) & Hostinger require MAIL FROM to match the authenticated SMTP_USER
  const from = user || supportEmail || 'Support@bharatvarshcrafts.com';
  const replyTo = supportEmail && supportEmail.toLowerCase() !== from.toLowerCase() ? supportEmail : undefined;
  const smtpConfigured =
    isConfiguredCredential(host) && isConfiguredCredential(user) && isConfiguredCredential(pass);

  if (smtpConfigured) {
    const attempts = buildSmtpTransportAttempts(process.env);
    const attemptErrors: string[] = [];

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      const transporter = nodemailer.createTransport({
        host: attempt.host,
        port: attempt.port,
        secure: attempt.secure,
        ...(attempt.requireTLS ? { requireTLS: true } : {}),
        auth: { user, pass },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 25000,
        tls: {
          servername: attempt.host,
          minVersion: 'TLSv1.2'
        }
      });

      try {
        const info = await transporter.sendMail({
          from: `"Bharatvarsh Leathercrafts LLP" <${from}>`,
          ...(replyTo ? { replyTo } : {}),
          to: recipient,
          subject: params.subject,
          text: params.text,
          html: params.html || `<p>${params.text.replace(/\n/g, '<br/>')}</p>`,
          ...(Array.isArray(params.attachments) && params.attachments.length > 0
            ? { attachments: params.attachments }
            : {})
        });
        transporter.close();
        return {
          mode: 'LIVE',
          channel: 'EMAIL',
          messageId: info.messageId || `smtp_${Date.now()}`,
          smtpConfigured: true,
          transportUsed: attempt.label
        };
      } catch (err: any) {
        transporter.close();
        const reason = `${attempt.label} -> ${err?.message || err}`;
        attemptErrors.push(reason);
        const canFallback = i < attempts.length - 1 && isRetryableSmtpTransportError(err);
        if (!canFallback) {
          break;
        }
      }
    }

    return {
      mode: 'SANDBOX_FALLBACK',
      channel: 'EMAIL',
      messageId: `email_sbx_${Date.now()}`,
      smtpConfigured: true,
      fallbackReason: `SMTP transport error: ${attemptErrors.join(' | ')}`
    };
  }

  return {
    mode: 'SANDBOX_FALLBACK',
    channel: 'EMAIL',
    messageId: `email_sbx_${Date.now()}`,
    smtpConfigured: false,
    fallbackReason: getMissingSmtpReason() || 'SMTP credentials not configured'
  };
}

export const sendEmail = sendTransactionalEmail;

export async function sendWhatsAppMessage(params: {
  toPhone?: string;
  text: string;
}): Promise<{
  mode: GatewayExecutionMode;
  channel: 'WHATSAPP';
  messageId: string;
  fallbackReason?: string;
}> {
  const phoneId = process.env.WHATSAPP_BUSINESS_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const cleanPhone = (params.toPhone || '').replace(/[^\d]/g, '');

  if (isConfiguredCredential(phoneId) && isConfiguredCredential(accessToken) && cleanPhone.length >= 10) {
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone,
          type: 'text',
          text: { body: params.text.slice(0, 4096) }
        })
      });
      const data = (await res.json()) as any;
      const waId = data?.messages?.[0]?.id;
      if (res.ok && waId) {
        return {
          mode: 'LIVE',
          channel: 'WHATSAPP',
          messageId: waId
        };
      }
      return {
        mode: 'SANDBOX_FALLBACK',
        channel: 'WHATSAPP',
        messageId: `wa_sbx_${Date.now()}`,
        fallbackReason: data?.error?.message || `WhatsApp API HTTP ${res.status}`
      };
    } catch (err: any) {
      return {
        mode: 'SANDBOX_FALLBACK',
        channel: 'WHATSAPP',
        messageId: `wa_sbx_${Date.now()}`,
        fallbackReason: err.message
      };
    }
  }

  return {
    mode: 'SANDBOX_FALLBACK',
    channel: 'WHATSAPP',
    messageId: `wa_sbx_${Date.now()}`,
    fallbackReason:
      cleanPhone.length < 10
        ? 'Valid patron phone number missing'
        : 'WhatsApp Business Cloud API credentials not configured'
  };
}

function resolveOrderInvoiceContext(order: Order) {
  const config = db.getConfig();
  const storedInvoice = db
    .getInvoices()
    .find(inv => inv.orderId === order.id || (order.invoiceNumber && inv.invoiceNumber === order.invoiceNumber));
  const customer = db.getCustomerById(order.customerId) || db.getCustomerById(order.customerEmail);
  const defaultAddress = customer ? db.getDefaultCustomerAddress(customer.id) : undefined;
  const shipState = order.shippingAddress?.state || defaultAddress?.state || 'Maharashtra';
  const isInterState = shipState.trim().toLowerCase() !== 'maharashtra';
  const taxableValue = Math.max(0, order.subtotal - (order.discountAmount || 0));

  const invoice: GSTInvoice = storedInvoice || {
    id: `inv_summary_${order.id}`,
    invoiceNumber: order.invoiceNumber || order.orderNumber,
    orderId: order.id,
    customerId: order.customerId,
    supplierGstin: config.supplierGstin || '27AABCB1234F1Z8',
    invoiceDate: order.createdAt,
    supplyState: 'Maharashtra',
    placeOfSupply: shipState,
    isInterState,
    taxableValue,
    cgstAmount: isInterState ? 0 : Math.round(order.taxAmount / 2),
    sgstAmount: isInterState ? 0 : order.taxAmount - Math.round(order.taxAmount / 2),
    igstAmount: isInterState ? order.taxAmount : 0,
    totalInvoiceAmount: order.totalAmount,
    status: 'ISSUED'
  };

  const pdfBuffer = renderTaxInvoicePdf(invoice, order, config, { customer, defaultAddress });
  const safeFilename = `${invoice.invoiceNumber.replace(/[/\\]/g, '-')}.pdf`;

  return { config, invoice, customer, defaultAddress, pdfBuffer, safeFilename };
}

function escapeEmailHtml(val: string): string {
  return String(val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function dispatchOrderInvoiceEmailToSupport(order: Order) {
  const supportTo = getSupportOrderEmailRecipient();
  const { invoice, defaultAddress, pdfBuffer, safeFilename } = resolveOrderInvoiceContext(order);
  const addr = order.shippingAddress || defaultAddress;
  const addrLine = addr
    ? [addr.street, addr.city, addr.state, addr.pincode ? `PIN ${addr.pincode}` : '', addr.country || 'India']
        .filter(Boolean)
        .join(', ')
    : invoice.placeOfSupply;

  const itemsHtml = order.items
    .map(
      it => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #EFEAE2;">
          <strong>${escapeEmailHtml(it.productName)}</strong><br/>
          <span style="font-size:11px;color:#5C4D3E;font-family:monospace;">SKU: ${escapeEmailHtml(it.sku)} · ${
            it.leatherType === 'BIO_SUBSTITUTE_CACTUS' ? 'Bio-Cactus' : 'Veg-Tanned Heritage'
          }</span>
        </td>
        <td style="padding:8px;border-bottom:1px solid #EFEAE2;font-size:12px;">${
          it.customization?.monogramInitials
            ? `Initials: <strong>${escapeEmailHtml(it.customization.monogramInitials)}</strong> (${escapeEmailHtml(
                it.customization.foilType
              )})`
            : 'None'
        }</td>
        <td style="padding:8px;border-bottom:1px solid #EFEAE2;text-align:center;font-family:monospace;">${it.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #EFEAE2;text-align:right;font-family:monospace;">&#8377;${Math.round(
          it.lineTotal
        ).toLocaleString('en-IN')}</td>
      </tr>`
    )
    .join('');

  const taxSummaryLine = invoice.isInterState
    ? `IGST: ₹${Math.round(invoice.igstAmount).toLocaleString('en-IN')}`
    : `CGST: ₹${Math.round(invoice.cgstAmount).toLocaleString('en-IN')} · SGST: ₹${Math.round(
        invoice.sgstAmount
      ).toLocaleString('en-IN')}`;

  const subject = `New Order Placed: ${order.orderNumber} — ₹${Math.round(order.totalAmount).toLocaleString(
    'en-IN'
  )} (${order.customerName})`;

  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#FAF7F2;padding:24px;color:#16120E;">
    <div style="max-width:680px;margin:0 auto;background:#FFFFFF;border:1px solid #D8CFC2;padding:28px;border-radius:8px;">
      <div style="border-bottom:2px solid #8B4513;padding-bottom:14px;margin-bottom:18px;">
        <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#8B4513;font-weight:700;">Bharatvarsh Leathercrafts LLP · New Sales Order</div>
        <h2 style="margin:6px 0 4px;font-family:Georgia,serif;font-size:20px;">${escapeEmailHtml(order.orderNumber)} · &#8377;${Math.round(
    order.totalAmount
  ).toLocaleString('en-IN')}</h2>
        <div style="font-size:12px;color:#5C4D3E;">Invoice: <strong>${escapeEmailHtml(invoice.invoiceNumber)}</strong> · Gateway: <strong>${escapeEmailHtml(
    order.paymentGateway
  )}</strong> (${escapeEmailHtml(order.paymentStatus)})</div>
      </div>

      <div style="background:#FAF7F2;border:1px solid #E5DDD0;padding:14px;border-radius:6px;font-size:12px;line-height:1.6;margin-bottom:18px;">
        <div><strong>Patron:</strong> ${escapeEmailHtml(order.customerName)} (${escapeEmailHtml(order.customerEmail)})</div>
        <div><strong>Phone:</strong> ${escapeEmailHtml(order.customerPhone || 'N/A')}</div>
        <div><strong>Shipping Address:</strong> ${escapeEmailHtml(addrLine)}</div>
        <div><strong>Place of Supply:</strong> ${escapeEmailHtml(invoice.placeOfSupply)} (${
    invoice.isInterState ? 'Inter-State IGST' : 'Intra-State CGST + SGST'
  })</div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:18px;">
        <thead>
          <tr style="background:#FAF7F2;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#5C4D3E;">
            <th style="padding:8px;">Piece &amp; SKU</th>
            <th style="padding:8px;">Monogram Specs</th>
            <th style="padding:8px;text-align:center;">Qty</th>
            <th style="padding:8px;text-align:right;">Line Total</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <div style="font-size:12px;background:#FAF7F2;padding:12px;border-radius:6px;font-family:monospace;">
        <div>Subtotal: &#8377;${Math.round(order.subtotal).toLocaleString('en-IN')}${
    order.discountAmount > 0
      ? ` · Discount (${escapeEmailHtml(order.discountCode || 'PROMO')}): -&#8377;${Math.round(
          order.discountAmount
        ).toLocaleString('en-IN')}`
      : ''
  }</div>
        <div>Taxable Value: &#8377;${Math.round(invoice.taxableValue).toLocaleString('en-IN')} · ${escapeEmailHtml(
    taxSummaryLine
  )}</div>
        <div style="margin-top:6px;font-size:14px;font-weight:700;">Total Amount: &#8377;${Math.round(
          order.totalAmount
        ).toLocaleString('en-IN')}</div>
      </div>

      <div style="margin-top:16px;font-size:11px;color:#5C4D3E;">
        Registered Office: ${REGISTERED_OFFICE_ADDRESS_HTML}. Official GST Tax Invoice PDF (${escapeEmailHtml(
    safeFilename
  )}) is attached.
      </div>
    </div>
  </div>`;

  const text = [
    `New Order Placed: ${order.orderNumber} — ₹${Math.round(order.totalAmount).toLocaleString('en-IN')}`,
    `Patron: ${order.customerName} | Email: ${order.customerEmail} | Phone: ${order.customerPhone || 'N/A'}`,
    `Shipping Address: ${addrLine}`,
    `Invoice: ${invoice.invoiceNumber} | Payment: ${order.paymentGateway} (${order.paymentStatus})`,
    `Tax Breakdown: Taxable ₹${invoice.taxableValue} | ${taxSummaryLine}`,
    '',
    'Items:',
    ...order.items.map(
      it =>
        `- ${it.productName} (${it.sku}) x${it.quantity} — ₹${it.lineTotal}${
          it.customization?.monogramInitials
            ? ` [Monogram: ${it.customization.monogramInitials} / ${it.customization.foilType}]`
            : ''
        }`
    )
  ].join('\n');

  return sendTransactionalEmail({
    to: supportTo,
    subject,
    text,
    html,
    attachments: [
      {
        filename: safeFilename,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  });
}

export async function dispatchOrderConfirmationAndCareGuide(order: Order): Promise<{
  emailDelivery: Awaited<ReturnType<typeof sendTransactionalEmail>>;
  supportEmailDelivery: Awaited<ReturnType<typeof sendTransactionalEmail>>;
  whatsappDelivery: Awaited<ReturnType<typeof sendWhatsAppMessage>>;
}> {
  if (isPerOrderEmailDisabled()) {
    const skippedEmail = {
      mode: 'SANDBOX_FALLBACK' as GatewayExecutionMode,
      channel: 'EMAIL' as const,
      messageId: `email_skipped_${Date.now()}`,
      smtpConfigured: false,
      fallbackReason: 'Per-order emails disabled (using daily consolidated Excel summary)'
    };
    const whatsappDelivery = await sendWhatsAppMessage({
      toPhone: order.customerPhone,
      text: `Bharatvarsh Atelier: Order ${order.orderNumber} confirmed (₹${order.totalAmount.toLocaleString(
        'en-IN'
      )}). AWB: ${order.awbNumber}. Digital Beeswax Care Guide included inside your My Atelier portal.`
    });
    return {
      emailDelivery: skippedEmail,
      supportEmailDelivery: skippedEmail,
      whatsappDelivery
    };
  }

  const { pdfBuffer, safeFilename } = resolveOrderInvoiceContext(order);
  const summaryLines = order.items.map(
    it =>
      `• ${it.productName} (${it.quantity}x) — ₹${it.unitPrice.toLocaleString('en-IN')}${
        it.customization?.monogramInitials ? ` [Monogram: ${it.customization.monogramInitials}]` : ''
      }`
  );
  const text = [
    `Dear ${order.customerName},`,
    '',
    `Thank you for commissioning Bharatvarsh Leathercrafts LLP (Order ${order.orderNumber}).`,
    `Total Paid: ₹${order.totalAmount.toLocaleString('en-IN')} | Invoice: ${order.invoiceNumber || 'Issued'}`,
    `Logistics Partner: ${order.courierPartner || 'SHIPROCKET'} | AWB: ${order.awbNumber || 'Pending'}`,
    '',
    'Pieces Commissioned:',
    ...summaryLines,
    '',
    'Digital Heirloom Care Guide:',
    'Apply organic beeswax conditioning balm lightly every 90 days and buff with a soft horsehair brush. Avoid prolonged monsoon moisture; store in your breathable cotton dust bag.',
    '',
    'Warm regards,',
    'Bharatvarsh Atelier · Pune Primary Hub'
  ].join('\n');

  const [emailDelivery, supportEmailDelivery, whatsappDelivery] = await Promise.all([
    sendTransactionalEmail({
      to: order.customerEmail,
      subject: `Bharatvarsh Atelier Confirmation · ${order.orderNumber}`,
      text,
      attachments: [
        {
          filename: safeFilename,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    }),
    dispatchOrderInvoiceEmailToSupport(order),
    sendWhatsAppMessage({
      toPhone: order.customerPhone,
      text: `Bharatvarsh Atelier: Order ${order.orderNumber} confirmed (₹${order.totalAmount.toLocaleString(
        'en-IN'
      )}). AWB: ${order.awbNumber}. Digital Beeswax Care Guide included inside your My Atelier portal.`
    })
  ]);

  return { emailDelivery, supportEmailDelivery, whatsappDelivery };
}

export async function dispatchCartRecoveryNotice(
  cart: CartRecord,
  channel: 'EMAIL' | 'WHATSAPP',
  promoCode: string,
  fullCheckoutUrl: string
) {
  const itemNames = cart.items.map(it => `${it.productName} (x${it.quantity})`).join(', ');
  if (channel === 'WHATSAPP') {
    return sendWhatsAppMessage({
      toPhone: cart.phone,
      text: `Bharatvarsh Atelier: Your reserved leathercraft bag (${itemNames}, ₹${cart.subtotal.toLocaleString(
        'en-IN'
      )}) awaits at Pune Hub. Use ${promoCode} at checkout: ${fullCheckoutUrl}`
    });
  }

  const itemRowsHtml = cart.items
    .map(
      it => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #EFEAE2;">
          <strong>${escapeEmailHtml(it.productName)}</strong>
          <div style="font-size:11px;color:#5C4D3E;font-family:monospace;">SKU: ${escapeEmailHtml(it.sku || '')}</div>
        </td>
        <td style="padding:8px;border-bottom:1px solid #EFEAE2;text-align:center;font-family:monospace;">${it.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #EFEAE2;text-align:right;font-family:monospace;">&#8377;${Math.round(
          Number(it.unitPrice || 0) * Math.max(1, Number(it.quantity || 1))
        ).toLocaleString('en-IN')}</td>
      </tr>`
    )
    .join('');

  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#FAF7F2;padding:24px;color:#16120E;">
    <div style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid #D8CFC2;padding:28px;border-radius:8px;">
      <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#8B4513;font-weight:700;">Bharatvarsh Leathercrafts LLP</div>
      <h2 style="font-family:Georgia,serif;font-size:20px;margin:8px 0;">Your Reserved Atelier Bag Awaits</h2>
      <p style="font-size:13px;color:#5C4D3E;line-height:1.6;">
        Your handcrafted leathercraft selection remains reserved at our Pune Primary Hub. Complete your commission today using exclusive privilege code <strong style="color:#16120E;font-family:monospace;">${escapeEmailHtml(
          promoCode
        )}</strong>.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin:16px 0;">
        <thead>
          <tr style="background:#FAF7F2;text-align:left;font-size:10px;text-transform:uppercase;color:#5C4D3E;">
            <th style="padding:8px;">Selected Piece</th>
            <th style="padding:8px;text-align:center;">Qty</th>
            <th style="padding:8px;text-align:right;">Value</th>
          </tr>
        </thead>
        <tbody>${itemRowsHtml}</tbody>
      </table>
      <div style="font-size:13px;font-weight:700;text-align:right;margin-bottom:18px;font-family:monospace;">
        Bag Subtotal: &#8377;${Math.round(cart.subtotal).toLocaleString('en-IN')}
      </div>
      <div style="text-align:center;margin:20px 0;">
        <a href="${escapeEmailHtml(
          fullCheckoutUrl
        )}" style="display:inline-block;padding:12px 24px;background:#221C16;color:#FAF7F2;text-decoration:none;font-weight:700;font-size:13px;border-radius:6px;">
          Resume Reserved Checkout (${escapeEmailHtml(promoCode)})
        </a>
      </div>
      <div style="font-size:11px;color:#5C4D3E;border-top:1px solid #EFEAE2;padding-top:12px;">
        Direct link: ${escapeEmailHtml(fullCheckoutUrl)}
      </div>
    </div>
  </div>`;

  return sendEmail({
    to: cart.email,
    subject: `Your Handcrafted Bharatvarsh Atelier Bag Awaits (${promoCode})`,
    text: `Your selected pieces (${itemNames}, Subtotal: ₹${Math.round(cart.subtotal).toLocaleString(
      'en-IN'
    )}) remain reserved at our Pune Primary Hub.\n\nComplete your commission with code ${promoCode}: ${fullCheckoutUrl}`,
    html
  });
}

export async function dispatchInboxAgentReply(params: {
  ticket: SupportTicket;
  channel: 'WHATSAPP' | 'EMAIL' | 'LIVE_CHAT';
  text: string;
  toPhone?: string;
}) {
  if (params.channel === 'EMAIL') {
    return sendTransactionalEmail({
      to: params.ticket.customerEmail,
      subject: `Re: [${params.ticket.ticketNumber}] ${params.ticket.subject}`,
      text: params.text
    });
  }
  if (params.channel === 'WHATSAPP') {
    return sendWhatsAppMessage({
      toPhone: params.toPhone || params.ticket.customerPhone,
      text: `[${params.ticket.ticketNumber}] ${params.text}`
    });
  }
  return {
    mode: 'SANDBOX_FALLBACK' as const,
    channel: 'LIVE_CHAT' as const,
    messageId: `chat_${Date.now()}`,
    fallbackReason: 'Delivered via in-app Atelier live chat session'
  };
}
