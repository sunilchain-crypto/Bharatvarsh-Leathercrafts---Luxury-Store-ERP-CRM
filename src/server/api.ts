/**
 * RESTful API Routes for Bharatvarsh Leathercrafts LLP
 * Enforces server-side RBAC on all admin/CRM/ERP/Store Management endpoints.
 */

import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { db, MASTER_AUTHORIZED_ACCOUNTS } from './db.ts';
import { mysqlAdapter } from './mysqlAdapter.ts';
import { handleWebhookRequest } from './webhooks.ts';
import { erpSync } from './erpSync.ts';
import { cartRecovery } from './cartRecovery.ts';
import {
  classifyCustomerRFM,
  computeUnitEconomics,
  computeOperationalHealth,
  computeCohortRetention,
  computeSkuReorderVelocity
} from './rfm.ts';
import {
  requireAuth,
  requireStoreManagementAccess,
  requireCrmAccess,
  requireErpAccess,
  requireAnalyticsAccess,
  requireMasterAdminAccess,
  resolveAuthTokenAsync,
  AuthenticatedRequest
} from './authMiddleware.ts';
import { verifyFirebaseIdToken } from './firebaseAuthVerifier.ts';
import { signSessionJwt } from './security.ts';
import {
  getIntegrationsReadiness,
  createGatewayOrderOrIntent,
  createPaymentLink,
  allocateCourierAwb,
  dispatchOrderConfirmationAndCareGuide,
  dispatchCartRecoveryNotice,
  dispatchInboxAgentReply
} from './integrations.ts';
import {
  renderTaxInvoicePdf,
  renderTaxInvoiceHtml,
  renderCreditNotePdf,
  renderCreditNoteHtml
} from './invoicePdf.ts';
import { sendDailyOrdersReport, generateDailyOrderWorkbook } from './dailyOrderReport.ts';
import {
  validateIndianCheckoutFields,
  validateIndianPhone,
  validateIndianPincode,
  validateEmailAddress,
  normalizeIndianState
} from '../lib/indianValidation.ts';
import { verifyRecaptchaEnterpriseToken } from './recaptcha.ts';

export const apiRouter = express.Router();

function getEffectiveProductPrice(product: any): number {
  const mrp = Number(product?.price || 0);
  const offer = product?.offerPrice !== undefined && product?.offerPrice !== null ? Number(product.offerPrice) : 0;
  if (Number.isFinite(offer) && offer > 0 && offer <= mrp) {
    return offer;
  }
  return mrp;
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

const VIDEO_MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm'
};

const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_BYTES = 50 * 1024 * 1024;

function parseMultipartSingleFile(
  body: Buffer,
  contentType: string
): { filename: string; mimeType: string; buffer: Buffer } | null {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) return null;

  const delimiter = Buffer.from(`--${boundary}`);
  const headerEndMarker = Buffer.from('\r\n\r\n');
  let searchFrom = 0;

  while (searchFrom < body.length) {
    const startBoundary = body.indexOf(delimiter, searchFrom);
    if (startBoundary === -1) break;
    const afterBoundary = startBoundary + delimiter.length;
    if (body[afterBoundary] === 45 && body[afterBoundary + 1] === 45) break;

    let partStart = afterBoundary;
    if (body[partStart] === 13 && body[partStart + 1] === 10) partStart += 2;
    else if (body[partStart] === 10) partStart += 1;

    const nextBoundary = body.indexOf(delimiter, partStart);
    if (nextBoundary === -1) break;

    let partEnd = nextBoundary;
    if (partEnd >= 2 && body[partEnd - 2] === 13 && body[partEnd - 1] === 10) partEnd -= 2;
    else if (partEnd >= 1 && body[partEnd - 1] === 10) partEnd -= 1;

    const partBuf = body.subarray(partStart, partEnd);
    const headerEndIdx = partBuf.indexOf(headerEndMarker);
    if (headerEndIdx !== -1) {
      const rawHeaders = partBuf.subarray(0, headerEndIdx).toString('utf8');
      const filenameMatch = rawHeaders.match(/filename="([^"]+)"/i) || rawHeaders.match(/filename=([^;\r\n]+)/i);
      if (filenameMatch) {
        const mimeMatch = rawHeaders.match(/Content-Type:\s*([^\r\n;]+)/i);
        return {
          filename: (filenameMatch[1] || '').trim(),
          mimeType: (mimeMatch?.[1] || '').trim().toLowerCase(),
          buffer: partBuf.subarray(headerEndIdx + 4)
        };
      }
    }
    searchFrom = nextBoundary;
  }
  return null;
}

const KB_MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime'
};

const KB_EXT_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.ms-powerpoint': '.ppt',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov'
};

const KB_VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov']);
const MAX_KB_UPLOAD_BYTES = 50 * 1024 * 1024;

interface ParsedMultipartFile {
  fieldName: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

function parseMultipartFormData(
  body: Buffer,
  contentType: string
): {
  fields: Record<string, string>;
  file: ParsedMultipartFile | null;
  files: Record<string, ParsedMultipartFile>;
} {
  const fields: Record<string, string> = {};
  let file: ParsedMultipartFile | null = null;
  const files: Record<string, ParsedMultipartFile> = {};
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) return { fields, file, files };

  const delimiter = Buffer.from(`--${boundary}`);
  const headerEndMarker = Buffer.from('\r\n\r\n');
  let searchFrom = 0;

  while (searchFrom < body.length) {
    const startBoundary = body.indexOf(delimiter, searchFrom);
    if (startBoundary === -1) break;
    const afterBoundary = startBoundary + delimiter.length;
    if (body[afterBoundary] === 45 && body[afterBoundary + 1] === 45) break;

    let partStart = afterBoundary;
    if (body[partStart] === 13 && body[partStart + 1] === 10) partStart += 2;
    else if (body[partStart] === 10) partStart += 1;

    const nextBoundary = body.indexOf(delimiter, partStart);
    if (nextBoundary === -1) break;

    let partEnd = nextBoundary;
    if (partEnd >= 2 && body[partEnd - 2] === 13 && body[partEnd - 1] === 10) partEnd -= 2;
    else if (partEnd >= 1 && body[partEnd - 1] === 10) partEnd -= 1;

    const partBuf = body.subarray(partStart, partEnd);
    const headerEndIdx = partBuf.indexOf(headerEndMarker);
    if (headerEndIdx !== -1) {
      const rawHeaders = partBuf.subarray(0, headerEndIdx).toString('utf8');
      const nameMatch = rawHeaders.match(/name="([^"]+)"/i) || rawHeaders.match(/name=([^;\r\n]+)/i);
      const filenameMatch = rawHeaders.match(/filename="([^"]+)"/i) || rawHeaders.match(/filename=([^;\r\n]+)/i);
      const contentBuf = partBuf.subarray(headerEndIdx + 4);
      const fieldName = (nameMatch?.[1] || 'file').trim();
      if (filenameMatch) {
        const mimeMatch = rawHeaders.match(/Content-Type:\s*([^\r\n;]+)/i);
        const parsedFile: ParsedMultipartFile = {
          fieldName,
          filename: (filenameMatch[1] || '').trim(),
          mimeType: (mimeMatch?.[1] || '').trim().toLowerCase(),
          buffer: contentBuf
        };
        if (!file && fieldName !== 'videoFile') {
          file = parsedFile;
        }
        files[fieldName] = parsedFile;
      } else if (nameMatch) {
        fields[fieldName] = contentBuf.toString('utf8').trim();
      }
    }
    searchFrom = nextBoundary;
  }
  if (!file && files.videoFile) {
    file = files.videoFile;
  }
  return { fields, file, files };
}

const rawMediaUploadMiddleware = express.raw({
  type: [
    'multipart/form-data',
    'image/*',
    'video/*',
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/octet-stream'
  ],
  limit: '55mb'
});

function handleMediaUploadBody(req: Request, res: Response, next: NextFunction) {
  if (req.is('application/json') && req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return next();
  }
  return rawMediaUploadMiddleware(req, res, (err: any) => {
    if (err) {
      if (err.type === 'entity.too.large' || err.status === 413) {
        return res.status(413).json({
          error: 'Uploaded file exceeds maximum allowed payload size.'
        });
      }
      return res.status(400).json({ error: err.message || 'Invalid media upload payload.' });
    }
    return next();
  });
}

// Critical Paths Verification Endpoint (Restricted to Admin)
apiRouter.get('/test/critical-paths', requireStoreManagementAccess, async (req: Request, res: Response) => {
  try {
    const { runCriticalPathTests } = await import('../tests/criticalPaths.test.ts');
    const result = await runCriticalPathTests();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ passed: false, error: err?.message || 'Failed to execute critical path tests' });
  }
});

// ==========================================
// 1. PUBLIC & STOREFRONT ENDPOINTS
// ==========================================

// Catalog: Categories & Products enriched with live inventory availability
apiRouter.get('/catalog', (req: Request, res: Response) => {
  const catalog = db.getCatalog();
  res.json({ success: true, catalog });
});

// Public Leather Knowledge Base Presentations & Guides
apiRouter.get('/knowledge-base', (_req: Request, res: Response) => {
  const entries = db.getKnowledgeBase();
  res.json({ success: true, entries });
});

// Public Storefront Statutory & Operational Metadata (no sensitive secrets/credentials)
apiRouter.get('/storefront/config', (req: Request, res: Response) => {
  const cfg = db.getConfig();
  res.json({
    success: true,
    gstInvoicingEnabled: cfg.gstInvoicingEnabled,
    gstRatePercent: cfg.gstRatePercent ?? 18,
    supplierGstin: cfg.supplierGstin || '27AABCB1234F1Z8',
    primaryHubCity: cfg.primaryHubCity || 'Pune'
  });
});

// Server-Side Promo Code Validation (dynamically reads StoreManagementConfig.promoCodes)
apiRouter.post('/checkout/validate-promo', async (req: Request, res: Response) => {
  const { code, subtotal, recaptchaToken } = req.body || {};
  const recaptchaCheck = await verifyRecaptchaEnterpriseToken({
    token: recaptchaToken,
    expectedAction: 'PROMO_VALIDATE'
  });
  if (!recaptchaCheck.allowed) {
    return res.status(403).json({
      success: false,
      valid: false,
      error: recaptchaCheck.reason || 'Security verification failed.'
    });
  }
  const rule = db.validatePromoCode(code);
  if (!rule) {
    return res.status(404).json({
      success: false,
      valid: false,
      error: 'Invalid or inactive promo code.'
    });
  }
  const baseSubtotal = Number(subtotal) > 0 ? Number(subtotal) : 0;
  const discountAmount = Math.round((baseSubtotal * rule.discountPercent) / 100);
  res.json({
    success: true,
    valid: true,
    code: rule.code,
    discountPercent: rule.discountPercent,
    discountAmount,
    description: rule.description || `${rule.discountPercent}% bespoke discount`
  });
});

// Cart Persistence (Patron or Guest)
apiRouter.post('/cart/persist', async (req: Request, res: Response) => {
  try {
    const { cartId, customerId, email, phone, items, subtotal } = req.body;
    if (!email || !items) {
      return res.status(400).json({ error: 'Missing required cart payload (email, items)' });
    }

    const saved = await db.runAtomicMutation(() =>
      cartRecovery.persistStorefrontCart({
        cartId,
        customerId,
        email,
        phone,
        items,
        subtotal: subtotal || 0
      })
    );

    res.json({ success: true, cart: saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Resume Abandoned / Persisted Cart by ID (supports direct cart ID or signed HMAC ?token=)
apiRouter.get('/cart/:id', (req: Request, res: Response) => {
  const tokenParam = typeof req.query.token === 'string' ? req.query.token : undefined;
  const resolution = cartRecovery.resolveResumableCart(req.params.id, tokenParam);

  if (resolution.status === 'INVALID_TOKEN') {
    return res.status(403).json({ error: 'Invalid or tampered cart recovery token.' });
  }
  if (resolution.status === 'NOT_FOUND') {
    return res.status(404).json({ error: 'Saved cart not found.' });
  }

  const { cart, tokenVerified } = resolution;
  res.json({
    success: true,
    cart: {
      id: cart.id,
      items: cart.items,
      subtotal: cart.subtotal,
      currency: cart.currency,
      isAbandoned: cart.isAbandoned,
      recoveryStage: cart.recoveryStage,
      checkoutUrl: cart.checkoutUrl,
      resumeTokenVerified: tokenVerified,
      ...(tokenVerified ? { email: cart.email } : {})
    }
  });
});

// Storefront Idle Cart Abandonment Simulator (Isolated from Financial Webhook Gateway)
apiRouter.post('/cart/simulate-abandonment', async (req: Request, res: Response) => {
  try {
    const { cartId, email, phone, items } = req.body;
    if (!email || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Patron email and cart items are required to simulate abandonment.' });
    }

    const catalog = db.getCatalog();
    const authoritativeSubtotal = items.reduce((sum: number, item: any) => {
      const prod = (catalog.products || []).find((p: any) => p.id === item.productId || p.sku === item.sku);
      const unitPrice = prod ? getEffectiveProductPrice(prod) : 0;
      const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
      return sum + unitPrice * qty;
    }, 0);

    const saved = await db.runAtomicMutation(() => {
      const cart = cartRecovery.persistStorefrontCart({
        cartId,
        email: String(email).trim(),
        phone: phone ? String(phone).trim() : '',
        items,
        subtotal: authoritativeSubtotal
      });
      cart.isAbandoned = true;
      cart.abandonedAt = new Date().toISOString();
      cart.recoveryStage = 'DETECTED';

      db.logAudit(
        'storefront_simulator',
        'CART_ABANDONMENT_SIMULATED',
        'WEBHOOK_EVENT',
        `Simulated idle cart abandonment for ${cart.email} (Cart ID: ${cart.id})`
      );
      return cart;
    });

    res.json({
      success: true,
      cart: saved,
      message: `Abandoned cart registered for ${saved.email}.`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Checkout & Place Order (authoritative catalog pricing, server promo rules, SELECT ... FOR UPDATE stock deduction)
apiRouter.post('/checkout/place-order', async (req: Request, res: Response) => {
  try {
    const {
      customerId,
      customerName,
      customerEmail,
      customerPhone,
      items,
      discountCode,
      shippingAddress,
      billingAddress,
      paymentGateway,
      recaptchaToken
    } = req.body;

    const recaptchaCheck = await verifyRecaptchaEnterpriseToken({
      token: recaptchaToken,
      expectedAction: 'CHECKOUT',
      actorHint: customerEmail
    });
    if (!recaptchaCheck.allowed) {
      return res.status(403).json({
        error: recaptchaCheck.reason || 'Security verification failed. Please reload and try again.'
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'At least one item in bag is required to place an order.',
        errors: { items: 'At least one item is required.' }
      });
    }

    const validation = validateIndianCheckoutFields({
      fullName: customerName,
      email: customerEmail,
      phone: customerPhone,
      street: shippingAddress?.street,
      city: shippingAddress?.city,
      state: shippingAddress?.state,
      pincode: shippingAddress?.pincode,
      country: shippingAddress?.country || 'India'
    });

    if (!validation.valid) {
      return res.status(400).json({
        error: validation.firstError || 'Please complete all required Indian shipping details.',
        errors: validation.errors
      });
    }

    const catalog = db.getCatalog();
    const catalogProducts = catalog.products || [];
    const cfg = db.getConfig();
    const storeDefaultTaxRate = (typeof cfg.gstRatePercent === 'number' ? cfg.gstRatePercent : 18) / 100;

    const preparedLines = items.map((item: any, idx: number) => {
      const byId = item.productId
        ? catalogProducts.find((p: any) => p.id === item.productId)
        : undefined;
      const bySku = item.sku
        ? catalogProducts.find((p: any) => p.sku === item.sku)
        : undefined;

      const product = byId || bySku;
      if (!product || (byId && bySku && byId.id !== bySku.id)) {
        throw new Error(`Unknown or mismatched catalog product in checkout payload: ${item.productName || item.sku || item.productId}`);
      }

      const qty = Math.floor(Number(item.quantity));
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`Invalid quantity for ${product.name}`);
      }

      const unitPrice = getEffectiveProductPrice(product);
      const gstRate = typeof product.gstRate === 'number' ? product.gstRate : storeDefaultTaxRate;
      const hsnCode = product.hsnCode || '4202';
      const lineSubtotal = unitPrice * qty;

      const monogramText = item.customization?.monogramInitials || item.monogram;
      const foilType = item.customization?.foilType || item.foilStyle || 'GOLD_FOIL';

      return {
        idx,
        product,
        qty,
        unitPrice,
        gstRate,
        hsnCode,
        lineSubtotal,
        leatherType:
          item.leatherType === 'BIO_SUBSTITUTE_CACTUS'
            ? ('BIO_SUBSTITUTE_CACTUS' as const)
            : ('VEGETABLE_TANNED_HERITAGE' as const),
        ...(monogramText
          ? {
              customization: {
                monogramInitials: String(monogramText).slice(0, 8),
                foilType:
                  foilType === 'BLIND' || foilType === 'SILVER_FOIL' || foilType === 'GOLD_FOIL'
                    ? foilType
                    : ('GOLD_FOIL' as const),
                placement: item.customization?.placement || 'Primary Panel'
              }
            }
          : {})
      };
    });

    const authoritativeSubtotal = preparedLines.reduce((sum: number, l: any) => sum + l.lineSubtotal, 0);

    const normalizedCode =
      typeof discountCode === 'string' && discountCode.trim().length > 0
        ? discountCode.trim().toUpperCase()
        : undefined;

    const promoRule = normalizedCode ? db.validatePromoCode(normalizedCode) : null;
    if (normalizedCode && !promoRule) {
      return res.status(400).json({ error: `Invalid or expired promo code: ${normalizedCode}` });
    }

    const authoritativeDiscountAmount = promoRule
      ? Math.round((authoritativeSubtotal * promoRule.discountPercent) / 100)
      : 0;
    const taxableValue = Math.max(0, authoritativeSubtotal - authoritativeDiscountAmount);

    const authoritativeItems = preparedLines.map((line: any) => {
      const lineTaxable =
        authoritativeSubtotal > 0 ? line.lineSubtotal * (taxableValue / authoritativeSubtotal) : 0;
      const lineTaxAmount = Math.round(lineTaxable * line.gstRate);

      return {
        id: `item_${Date.now()}_${line.idx}`,
        orderId: '',
        productId: line.product.id,
        productName: line.product.name,
        sku: line.product.sku,
        category: line.product.category,
        quantity: line.qty,
        unitPrice: line.unitPrice,
        leatherType: line.leatherType,
        ...(line.customization ? { customization: line.customization } : {}),
        hsnCode: line.hsnCode,
        gstRate: line.gstRate,
        taxAmount: lineTaxAmount,
        lineTotal: Math.round(lineTaxable) + lineTaxAmount
      };
    });

    const authoritativeTaxAmount = authoritativeItems.reduce(
      (sum: number, it: any) => sum + it.taxAmount,
      0
    );
    const authoritativeTotalAmount = taxableValue + authoritativeTaxAmount;

    const { customer } = await db.runAtomicMutation(() =>
      db.findOrCreateCustomer({
        email: validation.normalized.email,
        phone: validation.normalized.phone,
        fullName: validation.normalized.fullName,
        identityUid: customerId,
        updatePhone: true,
        address: {
          street: validation.normalized.street,
          city: validation.normalized.city,
          state: validation.normalized.state,
          pincode: validation.normalized.pincode,
          country: 'India'
        }
      })
    );

    const normalizedShippingAddress = {
      id: shippingAddress?.id || `addr_${Date.now()}`,
      customerId: customer.id,
      recipientName: validation.normalized.fullName,
      phone: validation.normalized.phone,
      street: validation.normalized.street,
      city: validation.normalized.city,
      state: validation.normalized.state,
      pincode: validation.normalized.pincode,
      country: 'India',
      isDefault: true,
      addressType: 'SHIPPING' as const
    };

    const normalizedBillingAddress = billingAddress?.street
      ? {
          id: billingAddress.id || normalizedShippingAddress.id,
          customerId: customer.id,
          recipientName: billingAddress.recipientName || validation.normalized.fullName,
          phone: billingAddress.phone || validation.normalized.phone,
          street: String(billingAddress.street).trim(),
          city: String(billingAddress.city || validation.normalized.city).trim(),
          state: normalizeIndianState(billingAddress.state) || validation.normalized.state,
          pincode: validateIndianPincode(billingAddress.pincode).valid
            ? validateIndianPincode(billingAddress.pincode).normalized
            : validation.normalized.pincode,
          country: 'India',
          isDefault: true,
          addressType: 'BILLING' as const
        }
      : { ...normalizedShippingAddress, addressType: 'BILLING' as const };

    const selectedGateway: 'RAZORPAY' | 'STRIPE' | 'CASH_ON_DELIVERY' =
      paymentGateway === 'STRIPE' || paymentGateway === 'CASH_ON_DELIVERY' ? paymentGateway : 'RAZORPAY';

    const gatewayResult = await createGatewayOrderOrIntent({
      gateway: selectedGateway,
      amountInr: authoritativeTotalAmount,
      receipt: `bvl_${Date.now()}`,
      customerName: customer.fullName,
      customerEmail: customer.email,
      customerPhone: customer.phone
    });

    const order = await db.createOrderAsync({
      customerId: customer.id,
      customerName: validation.normalized.fullName,
      customerEmail: customer.email,
      customerPhone: validation.normalized.phone,
      status: 'PROCESSING',
      currency: 'INR',
      subtotal: authoritativeSubtotal,
      discountAmount: authoritativeDiscountAmount,
      discountCode: normalizedCode,
      taxAmount: authoritativeTaxAmount,
      shippingFee: 0,
      totalAmount: authoritativeTotalAmount,
      paymentGateway: selectedGateway,
      paymentId: gatewayResult.paymentId,
      paymentStatus: 'PAID',
      items: authoritativeItems,
      shippingAddress: normalizedShippingAddress,
      billingAddress: normalizedBillingAddress
    });

    // Fire-and-forget transactional confirmation, Support@bharatvarshcrafts.com PDF invoice & care guide dispatch
    dispatchOrderConfirmationAndCareGuide(order)
      .then((delivery) => {
        db.logAudit(
          'integrations',
          'ORDER_NOTIFICATION_DISPATCHED',
          'STORE_MANAGEMENT',
          `Order ${order.orderNumber} notifications -> Payment:${gatewayResult.mode}, PatronEmail:${delivery.emailDelivery.mode}, SupportInvoice:${delivery.supportEmailDelivery.mode}, WhatsApp:${delivery.whatsappDelivery.mode}`
        );
      })
      .catch((err: any) => {
        db.logAudit(
          'integrations',
          'ORDER_NOTIFICATION_ERROR',
          'STORE_MANAGEMENT',
          `Order ${order.orderNumber} email/notification failed: ${err?.message || err}`
        );
      });

    res.status(201).json({
      success: true,
      order,
      gateway: {
        provider: gatewayResult.provider,
        mode: gatewayResult.mode,
        paymentId: gatewayResult.paymentId
      }
    });
  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : 'Checkout failed';
    const isDbError = msg.toLowerCase().includes('mysql');
    const isStockError =
      msg.toLowerCase().includes('out of stock') || msg.toLowerCase().includes('insufficient stock');
    res.status(isDbError ? 500 : isStockError ? 409 : 400).json({ error: msg });
  }
});

// ==========================================
// 1B. PATRON SELF-SERVICE PORTAL (AUTHENTICATED CALLER-SCOPED)
// ==========================================

apiRouter.get('/patron/overview', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const caller = req.user!;
  const cleanEmail = caller.email.trim().toLowerCase();
  const matchedCustomer = db.getCustomerById(cleanEmail) || db.getCustomerById(caller.uid);
  const custId = matchedCustomer?.id || caller.uid;

  const orders = db
    .getOrders()
    .filter(
      o =>
        o.customerId === custId ||
        o.customerEmail.trim().toLowerCase() === cleanEmail
    );

  const orderIds = new Set(orders.map(o => o.id));
  const invoices = db
    .getInvoices()
    .filter(inv => inv.customerId === custId || orderIds.has(inv.orderId));
  const invoiceNums = new Set(invoices.map(i => i.invoiceNumber));
  const creditNotes = db
    .getCreditNotes()
    .filter(cn => orderIds.has(cn.orderId) || invoiceNums.has(cn.originalInvoiceNumber));
  const warranties = db
    .getWarranties()
    .filter(w => w.customerId === custId || orderIds.has(w.orderId));
  const careKits = db
    .getCareKits()
    .filter(c => c.customerId === custId || orderIds.has(c.orderId));
  const hotStampingVectors = db
    .getHotStampingVectors()
    .filter(h => h.customerId === custId || (h.orderId && orderIds.has(h.orderId)));

  const cfg = db.getConfig();
  const addresses = matchedCustomer ? db.getCustomerAddresses(matchedCustomer.id) : [];
  const defaultAddress = matchedCustomer ? db.getDefaultCustomerAddress(matchedCustomer.id) : undefined;

  res.json({
    success: true,
    patron: {
      customerId: custId,
      fullName: matchedCustomer?.fullName || caller.name,
      email: cleanEmail,
      phone: matchedCustomer?.phone || defaultAddress?.phone || '',
      defaultAddress,
      addresses,
      rfmSegment: matchedCustomer?.rfmSegment || 'Promising/Recent',
      loyaltyPoints: matchedCustomer?.loyaltyPoints ?? 0,
      storeCreditBalance: matchedCustomer?.storeCreditBalance ?? 0,
      totalOrders: orders.length,
      lifetimeValue: orders.filter(o => o.paymentStatus === 'PAID').reduce((s, o) => s + o.totalAmount, 0)
    },
    addresses,
    defaultAddress,
    orders,
    invoices,
    creditNotes,
    warranties,
    careKits,
    hotStampingVectors,
    gstInvoicingEnabled: cfg.gstInvoicingEnabled,
    supplierGstin: cfg.supplierGstin,
    gstRatePercent: cfg.gstRatePercent
  });
});

// Patron-Initiated Return / Exchange Request (Strict 10-Day Post-Delivery Window)
apiRouter.post('/patron/orders/:id/return-request', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const allowedReasons = ['COLOR_MISMATCH', 'TEXTURE_DEFECT', 'HARDWARE_DAMAGE', 'INCORRECT_SIZE'] as const;
    const rawReason = String(req.body?.reason || '').trim().toUpperCase();
    if (!allowedReasons.includes(rawReason as any)) {
      return res.status(400).json({
        error: 'Please select a valid return or exchange reason (COLOR_MISMATCH, TEXTURE_DEFECT, HARDWARE_DAMAGE, or INCORRECT_SIZE).'
      });
    }

    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
    const outcome = await db.runAtomicMutation(() =>
      db.requestOrderReturn({
        orderId: req.params.id,
        customerEmail: req.user!.email,
        customerUid: req.user!.uid,
        reason: rawReason as (typeof allowedReasons)[number],
        notes
      })
    );

    if (!outcome.ok) {
      const statusCode =
        outcome.code === 'NOT_FOUND'
          ? 404
          : outcome.code === 'FORBIDDEN' || outcome.code === 'WINDOW_EXPIRED'
          ? 403
          : outcome.code === 'CONFLICT'
          ? 409
          : 400;
      return res.status(statusCode).json({
        success: false,
        code: outcome.code,
        error: outcome.error
      });
    }

    return res.status(201).json({
      success: true,
      order: outcome.order,
      ticket: outcome.ticket,
      message: `Return / exchange request registered for ${outcome.order!.orderNumber} (Support Desk Ticket ${outcome.ticket!.ticketNumber}).`
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to register return request.' });
  }
});

// Debossing Personalization Vector Capture (Scoped strictly to authenticated caller or 'cust_guest')
apiRouter.post('/personalization-vector', async (req: Request, res: Response) => {
  try {
    const { productId, productName, monogramText, foilStyle, fontFamily, previewImageUrl } = req.body;
    if (!productId || !monogramText) {
      return res.status(400).json({ error: 'Product ID and monogram text are required.' });
    }

    const authUser = await resolveAuthTokenAsync(req.headers.authorization);
    let scopedCustomerId = 'cust_guest';
    if (authUser) {
      const matchedCustomer = db.getCustomerById(authUser.email) || db.getCustomerById(authUser.uid);
      scopedCustomerId = matchedCustomer ? matchedCustomer.id : authUser.uid;
    }

    const vector = await db.runAtomicMutation(() =>
      db.addHotStampingVector({
        customerId: scopedCustomerId,
        productId,
        productName,
        monogramText: String(monogramText).slice(0, 8),
        foilStyle: foilStyle || 'GOLD_FOIL',
        fontFamily: fontFamily || 'CINZEL',
        previewImageUrl,
        recordedAt: new Date().toISOString()
      })
    );

    res.status(201).json({ success: true, vector });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Patron Self-Service Registration (Salted scrypt + HMAC-SHA256 JWT + strict Indian phone/address validation)
apiRouter.post('/auth/register', async (req: Request, res: Response) => {
  try {
    const { email, password, fullName, phone, street, city, state, pincode, country, address, recaptchaToken } = req.body || {};
    const recaptchaCheck = await verifyRecaptchaEnterpriseToken({
      token: recaptchaToken,
      expectedAction: 'SIGNUP',
      actorHint: email
    });
    if (!recaptchaCheck.allowed) {
      return res.status(403).json({ error: recaptchaCheck.reason || 'Security verification failed.' });
    }
    const errors: Record<string, string> = {};

    const cleanName = String(fullName || '').trim();
    if (cleanName.length < 2) {
      errors.fullName = 'Full name must be at least 2 characters.';
    }

    const emailCheck = validateEmailAddress(email);
    if (!emailCheck.valid) {
      errors.email = emailCheck.error!;
    }

    if (!password || String(password).length < 8) {
      errors.password = 'Password must be at least 8 characters long.';
    }

    const phoneCheck = validateIndianPhone(phone);
    if (!phoneCheck.valid) {
      errors.phone = phoneCheck.error!;
    }

    const rawStreet = address?.street ?? street;
    const rawCity = address?.city ?? city;
    const rawState = address?.state ?? state;
    const rawPincode = address?.pincode ?? pincode;
    const rawCountry = address?.country ?? country;

    const hasAnyAddressInput = Boolean(
      String(rawStreet || '').trim() ||
        String(rawCity || '').trim() ||
        String(rawState || '').trim() ||
        String(rawPincode || '').trim()
    );

    let normalizedAddress:
      | { street: string; city: string; state: string; pincode: string; country: 'India' }
      | undefined = undefined;

    if (hasAnyAddressInput) {
      if (String(rawStreet || '').trim().length < 5) {
        errors.street = 'Street address must be at least 5 characters.';
      }
      if (String(rawCity || '').trim().length < 2) {
        errors.city = 'City is required (minimum 2 characters).';
      }
      const normState = normalizeIndianState(rawState);
      if (!normState) {
        errors.state = 'Please select a valid Indian State or Union Territory.';
      }
      const pinCheck = validateIndianPincode(rawPincode);
      if (!pinCheck.valid) {
        errors.pincode = pinCheck.error!;
      }
      if (rawCountry && String(rawCountry).trim().toLowerCase() !== 'india') {
        errors.country = 'Shipping destination is currently restricted to India only.';
      }
      if (!errors.street && !errors.city && !errors.state && !errors.pincode && !errors.country && normState) {
        normalizedAddress = {
          street: String(rawStreet).trim(),
          city: String(rawCity).trim(),
          state: normState,
          pincode: pinCheck.normalized,
          country: 'India'
        };
      }
    }

    const errKeys = Object.keys(errors);
    if (errKeys.length > 0) {
      return res.status(400).json({
        error: errors[errKeys[0]],
        errors
      });
    }

    const { customer } = await db.runAtomicMutation(() =>
      db.registerPatronWithPassword({
        email: emailCheck.normalized,
        password,
        fullName: cleanName,
        phone: phoneCheck.formatted,
        address: normalizedAddress
      })
    );

    const token = signSessionJwt({
      sub: customer.identityUid || customer.id,
      email: customer.email,
      name: customer.fullName,
      role: 'PATRON'
    });

    res.status(201).json({
      success: true,
      token,
      user: {
        uid: customer.identityUid || customer.id,
        email: customer.email,
        name: customer.fullName,
        role: 'PATRON',
        isMasterAdmin: false,
        isStoreManagementAuthorized: false,
        authProvider: 'CREDENTIALS'
      },
      customer
    });
  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : 'Registration failed';
    if (msg.startsWith('ACCOUNT_EXISTS:')) {
      return res.status(409).json({ error: msg.replace('ACCOUNT_EXISTS: ', '') });
    }
    const isDbError = msg.toLowerCase().includes('mysql');
    res.status(isDbError ? 500 : 400).json({ error: msg });
  }
});

// Patron / Admin Credential Authentication Endpoint (Verifies salted scrypt hash; issues HMAC-SHA256 JWT)
apiRouter.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password, recaptchaToken } = req.body;
    const recaptchaCheck = await verifyRecaptchaEnterpriseToken({
      token: recaptchaToken,
      expectedAction: 'LOGIN',
      actorHint: email
    });
    if (!recaptchaCheck.allowed) {
      return res.status(403).json({ error: recaptchaCheck.reason || 'Security verification failed.' });
    }

    if (!email || !password) {
      return res.status(400).json({ error: 'Email / User ID and password are required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const isAuthorizedAdmin = db.isStoreManagementAuthorized(cleanEmail);
    const isMaster = db.isMasterAuthorized(cleanEmail);

    if (isAuthorizedAdmin) {
      const verification = db.verifyAdminLogin(cleanEmail, password);
      if (!verification.valid) {
        return res.status(401).json({ error: verification.reason || 'Invalid admin credentials' });
      }
    } else {
      const verification = db.verifyPatronLogin(cleanEmail, password);
      if (!verification.valid) {
        return res.status(401).json({ error: verification.reason || 'Invalid email or password' });
      }
    }

    const resolvedRole = isAuthorizedAdmin ? db.getStaffRole(cleanEmail) : 'PATRON';

    const { customer } = await db.runAtomicMutation(() =>
      db.findOrCreateCustomer({
        email: cleanEmail,
        fullName: cleanEmail.includes('@') ? cleanEmail.split('@')[0].replace(/[._]/g, ' ') : cleanEmail,
        role: resolvedRole
      })
    );

    const token = signSessionJwt({
      sub: customer.identityUid || customer.id,
      email: customer.email,
      name: customer.fullName,
      role: resolvedRole
    });

    res.json({
      success: true,
      token,
      user: {
        uid: customer.identityUid || customer.id,
        email: customer.email,
        name: customer.fullName,
        role: resolvedRole,
        isMasterAdmin: isMaster,
        isStoreManagementAuthorized: isAuthorizedAdmin,
        authProvider: 'CREDENTIALS'
      },
      customer
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Google & Email Firebase ID Token Exchange Endpoint (syncs patron + optional +91 phone & Indian address)
apiRouter.post('/auth/firebase', async (req: Request, res: Response) => {
  try {
    const { idToken, fullName, phone, street, city, state, pincode, country, address, recaptchaToken, recaptchaAction } = req.body || {};
    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({ error: 'Authentication token is required' });
    }

    if (recaptchaToken !== undefined || recaptchaAction !== undefined) {
      const allowedFirebaseActions = ['LOGIN', 'SIGNUP', 'GOOGLE_LOGIN'];
      const expectedAction = allowedFirebaseActions.includes(String(recaptchaAction || ''))
        ? String(recaptchaAction)
        : 'LOGIN';
      const recaptchaCheck = await verifyRecaptchaEnterpriseToken({
        token: recaptchaToken,
        expectedAction
      });
      if (!recaptchaCheck.allowed) {
        return res.status(403).json({ error: recaptchaCheck.reason || 'Security verification failed.' });
      }
    }

    const claims = await verifyFirebaseIdToken(idToken);
    if (!claims || !claims.email) {
      return res.status(401).json({ error: 'Invalid or expired Firebase authentication token.' });
    }

    const cleanEmail = claims.email.trim().toLowerCase();
    const isAuthorizedAdmin = db.isStoreManagementAuthorized(cleanEmail);
    const isMaster = db.isMasterAuthorized(cleanEmail);
    const resolvedRole = isAuthorizedAdmin ? db.getStaffRole(cleanEmail) : 'PATRON';

    const errors: Record<string, string> = {};
    let validatedPhone = '';
    if (phone && String(phone).trim()) {
      const phoneCheck = validateIndianPhone(phone);
      if (!phoneCheck.valid) {
        errors.phone = phoneCheck.error!;
      } else {
        validatedPhone = phoneCheck.formatted;
      }
    }

    const rawStreet = address?.street ?? street;
    const rawCity = address?.city ?? city;
    const rawState = address?.state ?? state;
    const rawPincode = address?.pincode ?? pincode;
    const rawCountry = address?.country ?? country;

    const hasAnyAddress = Boolean(
      String(rawStreet || '').trim() ||
        String(rawCity || '').trim() ||
        String(rawState || '').trim() ||
        String(rawPincode || '').trim()
    );

    let normalizedAddress:
      | { street: string; city: string; state: string; pincode: string; country: 'India' }
      | undefined = undefined;

    if (hasAnyAddress) {
      if (String(rawStreet || '').trim().length < 5) errors.street = 'Street address must be at least 5 characters.';
      if (String(rawCity || '').trim().length < 2) errors.city = 'City is required (minimum 2 characters).';
      const normState = normalizeIndianState(rawState);
      if (!normState) errors.state = 'Please select a valid Indian State or Union Territory.';
      const pinCheck = validateIndianPincode(rawPincode);
      if (!pinCheck.valid) errors.pincode = pinCheck.error!;
      if (rawCountry && String(rawCountry).trim().toLowerCase() !== 'india') {
        errors.country = 'Shipping destination is currently restricted to India only.';
      }
      if (!errors.street && !errors.city && !errors.state && !errors.pincode && !errors.country && normState) {
        normalizedAddress = {
          street: String(rawStreet).trim(),
          city: String(rawCity).trim(),
          state: normState,
          pincode: pinCheck.normalized,
          country: 'India'
        };
      }
    }

    const errKeys = Object.keys(errors);
    if (errKeys.length > 0) {
      return res.status(400).json({ error: errors[errKeys[0]], errors });
    }

    const explicitName = typeof fullName === 'string' && fullName.trim().length >= 2 ? fullName.trim() : '';
    const resolvedFullName = explicitName || claims.name || cleanEmail.split('@')[0];

    const { customer } = await db.runAtomicMutation(() =>
      db.findOrCreateCustomer({
        email: cleanEmail,
        fullName: resolvedFullName,
        updateFullName: Boolean(explicitName),
        ...(validatedPhone ? { phone: validatedPhone, updatePhone: true } : {}),
        ...(normalizedAddress ? { address: normalizedAddress } : {}),
        identityUid: claims.uid,
        role: resolvedRole
      })
    );

    const provider = claims.signInProvider === 'google.com' ? 'GOOGLE' : 'FIREBASE';

    res.json({
      success: true,
      token: idToken,
      user: {
        uid: claims.uid,
        email: customer.email,
        name: explicitName || claims.name || customer.fullName,
        role: resolvedRole,
        isMasterAdmin: isMaster,
        isStoreManagementAuthorized: isAuthorizedAdmin,
        photoURL: claims.picture,
        authProvider: provider
      },
      customer
    });
  } catch (err: any) {
    const isDbError = typeof err?.message === 'string' && err.message.toLowerCase().includes('mysql');
    res.status(isDbError ? 500 : 401).json({ error: err.message || 'Authentication failed' });
  }
});

// ==========================================
// 2. CRM & CUSTOMER 360 ENDPOINTS (STORE_MANAGER | SUPPORT_AGENT)
// ==========================================

apiRouter.get('/crm/customers', requireCrmAccess, (req: AuthenticatedRequest, res: Response) => {
  const customers = db.getCustomers().map(c => {
    const { segment, score } = classifyCustomerRFM(c);
    return {
      ...c,
      rfmSegment: segment,
      rfmScore: score
    };
  });
  res.json({ success: true, customers });
});

apiRouter.post('/crm/customers', requireCrmAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, phone, fullName, utmSource, utmMedium, street, city, state, pincode, country, address } = req.body || {};
    const errors: Record<string, string> = {};

    const cleanName = String(fullName || '').trim();
    if (cleanName.length < 2) {
      errors.fullName = 'Customer name must be at least 2 characters.';
    }

    const emailCheck = validateEmailAddress(email);
    if (!emailCheck.valid) {
      errors.email = emailCheck.error!;
    }

    const phoneCheck = validateIndianPhone(phone);
    if (!phoneCheck.valid) {
      errors.phone = phoneCheck.error!;
    }

    const rawStreet = address?.street ?? street;
    const rawCity = address?.city ?? city;
    const rawState = address?.state ?? state;
    const rawPincode = address?.pincode ?? pincode;
    const rawCountry = address?.country ?? country;

    const hasAnyAddress = Boolean(
      String(rawStreet || '').trim() ||
        String(rawCity || '').trim() ||
        String(rawState || '').trim() ||
        String(rawPincode || '').trim()
    );

    let normalizedAddress:
      | { street: string; city: string; state: string; pincode: string; country: 'India' }
      | undefined = undefined;

    if (hasAnyAddress) {
      if (String(rawStreet || '').trim().length < 5) errors.street = 'Street address must be at least 5 characters.';
      if (String(rawCity || '').trim().length < 2) errors.city = 'City is required (minimum 2 characters).';
      const normState = normalizeIndianState(rawState);
      if (!normState) errors.state = 'Please select a valid Indian State or Union Territory.';
      const pinCheck = validateIndianPincode(rawPincode);
      if (!pinCheck.valid) errors.pincode = pinCheck.error!;
      if (rawCountry && String(rawCountry).trim().toLowerCase() !== 'india') {
        errors.country = 'Shipping destination is currently restricted to India only.';
      }
      if (!errors.street && !errors.city && !errors.state && !errors.pincode && !errors.country && normState) {
        normalizedAddress = {
          street: String(rawStreet).trim(),
          city: String(rawCity).trim(),
          state: normState,
          pincode: pinCheck.normalized,
          country: 'India'
        };
      }
    }

    const errKeys = Object.keys(errors);
    if (errKeys.length > 0) {
      return res.status(400).json({ error: errors[errKeys[0]], errors });
    }

    const result = await db.runAtomicMutation(() =>
      db.findOrCreateCustomer({
        email: emailCheck.normalized,
        phone: phoneCheck.formatted,
        fullName: cleanName,
        utmSource,
        utmMedium,
        updatePhone: true,
        address: normalizedAddress
      })
    );
    res.status(201).json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Explicit Soft-Delete Customer Endpoint (is_active = 0, deleted_at = NOW(); preserves orders & audit logs)
apiRouter.delete('/customers/:id', requireCrmAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const archived = await db.softDeleteCustomerAsync(req.params.id, req.user!.email);
    res.json({
      success: true,
      customer: archived,
      message: `Customer "${archived.fullName}" archived (soft-deleted) while preserving order and audit history.`
    });
  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : 'Failed to archive customer';
    const isNotFound = msg.toLowerCase().includes('not found');
    const isDbError = msg.toLowerCase().includes('mysql');
    res.status(isDbError ? 500 : isNotFound ? 404 : 400).json({ error: msg });
  }
});

apiRouter.get('/crm/customer/:id', requireCrmAccess, (req: AuthenticatedRequest, res: Response) => {
  const customer = db.getCustomerById(req.params.id);
  if (!customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const { segment, score } = classifyCustomerRFM(customer);
  const orders = db.getOrders().filter(o => o.customerId === customer.id || o.customerEmail.toLowerCase() === customer.email.toLowerCase());
  const hotStamping = db.getHotStampingVectors(customer.id);
  const warranties = db.getWarranties(customer.id);
  const careKits = db.getCareKits(customer.id);
  const tickets = db.getTicketsByCustomer(customer.id);
  const abandonedCarts = db.getCarts().filter(c => c.email.toLowerCase() === customer.email.toLowerCase() && c.isAbandoned);

  const purchasedSkus = orders.flatMap(o => o.items.map(it => it.sku));
  const inventory = db.getInventory();
  const recommendations = inventory
    .filter(i => !purchasedSkus.includes(i.sku) && (i.stockByLocation.mumbaiWarehouse > 0 || i.stockByLocation.punePrimaryHub > 0))
    .slice(0, 3);

  res.json({
    success: true,
    customer: {
      ...customer,
      rfmSegment: segment,
      rfmScore: score
    },
    orders,
    hotStampingVectors: hotStamping,
    warranties,
    careKitDispatches: careKits,
    supportTickets: tickets,
    abandonedCarts,
    recommendations
  });
});

// Omnichannel Support Tickets
apiRouter.get('/crm/tickets', requireCrmAccess, (req: AuthenticatedRequest, res: Response) => {
  const tickets = db.getSupportTickets();
  res.json({ success: true, tickets });
});

apiRouter.post('/crm/tickets/:id/reply', requireCrmAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { text, channel } = req.body;
    const resolvedChannel = channel || 'WHATSAPP';
    const ticket = await db.runAtomicMutation(() =>
      db.addSupportMessage(req.params.id, text, 'AGENT', resolvedChannel)
    );
    const matchedCustomer =
      db.getCustomerById(ticket.customerId) || db.getCustomerById(ticket.customerEmail);
    const resolvedPhone = matchedCustomer?.phone || ticket.customerPhone;
    const delivery = await dispatchInboxAgentReply({
      ticket: resolvedPhone ? { ...ticket, customerPhone: resolvedPhone } : ticket,
      channel: resolvedChannel,
      text,
      toPhone: resolvedPhone
    });
    res.json({
      success: true,
      ticket: resolvedPhone ? { ...ticket, customerPhone: resolvedPhone } : ticket,
      delivery
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Server-Side Payment Link Creation (Razorpay Payment Links / Stripe Checkout Links)
apiRouter.post('/crm/payment-links', requireCrmAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { gateway, amountInr, description, customerName, customerEmail, customerPhone, ticketNumber } = req.body || {};
    const amount = Number(amountInr) > 0 ? Number(amountInr) : 4200;
    const resolvedCustomer = customerEmail ? db.getCustomerById(String(customerEmail)) : undefined;
    const finalPhone = customerPhone || resolvedCustomer?.phone;
    const linkResult = await createPaymentLink({
      gateway: gateway === 'STRIPE' ? 'STRIPE' : 'RAZORPAY',
      amountInr: amount,
      description: description || `Bharatvarsh Atelier Bespoke Commission (${ticketNumber || 'Concierge'})`,
      customerName: customerName || 'Valued Patron',
      customerEmail: customerEmail || 'patron@bharatvarshcrafts.com',
      customerPhone: finalPhone,
      referenceId: ticketNumber ? `bvl_${ticketNumber.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now().toString(36)}` : undefined
    });

    await db.runAtomicMutation(() => {
      db.logAudit(
        req.user!.email,
        'PAYMENT_LINK_GENERATED',
        'STORE_MANAGEMENT',
        `Generated ${linkResult.provider} payment link (${linkResult.mode}) for ₹${amount} -> ${customerEmail || 'patron'}`
      );
    });

    res.json({ success: true, ...linkResult });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Sales Pipeline & Kanban
apiRouter.get('/crm/kanban', requireCrmAccess, (req: AuthenticatedRequest, res: Response) => {
  const corporateLeads = db.getCorporateGiftingLeads();
  const abandonedCarts = db.getCarts().filter(c => c.isAbandoned);

  res.json({
    success: true,
    pipeline: {
      corporateLeads,
      abandonedCarts
    }
  });
});

apiRouter.post('/crm/leads', requireCrmAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const lead = await db.runAtomicMutation(() => db.addCorporateGiftingLead(req.body));
    res.status(201).json({ success: true, lead });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.patch('/crm/leads/:id', requireCrmAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, swatchKitAwb, items } = req.body;
    const existingLead = db.getCorporateGiftingLeads().find(l => l.id === req.params.id);
    if (!existingLead) {
      return res.status(404).json({ error: `Lead ${req.params.id} not found` });
    }

    if (status === 'ORDER_CONFIRMED') {
      if (!['STORE_MANAGER', 'LOGISTICS_COORDINATOR'].includes(req.user!.role)) {
        return res.status(403).json({
          error: 'FORBIDDEN',
          message: 'Only Store Managers or Logistics Coordinators can push corporate quotes into ERP Sales Orders.'
        });
      }
      if (existingLead.erpOrderId) {
        return res.status(409).json({
          error: `Lead "${existingLead.companyName}" has already been pushed to ERP Order ${existingLead.erpOrderNumber || existingLead.erpOrderId}.`
        });
      }
      const lineItems = Array.isArray(items) && items.length > 0 ? items : existingLead.items;
      if (!lineItems || lineItems.length === 0) {
        return res.status(400).json({
          error: 'Select at least one catalog SKU and quantity before confirming ERP Sales Order.'
        });
      }
      const order = await erpSync.pushCustomQuoteToSalesOrder(
        {
          leadId: existingLead.id,
          items: lineItems,
          dealType: 'WHOLESALE_BULK'
        },
        req.user!.email
      );
      const updatedLead = db.getCorporateGiftingLeads().find(l => l.id === existingLead.id);
      return res.json({ success: true, lead: updatedLead, order });
    }

    const updated = await db.runAtomicMutation(() =>
      db.updateCorporateLeadStatus(req.params.id, status, swatchKitAwb, { items })
    );
    res.json({ success: true, lead: updated });
  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : 'Failed to update corporate lead';
    const isDuplicate = msg.startsWith('DUPLICATE_ERP_ORDER');
    const isStock = msg.toLowerCase().includes('out of stock') || msg.toLowerCase().includes('insufficient stock');
    res.status(isDuplicate || isStock ? 409 : 400).json({ error: msg.replace('DUPLICATE_ERP_ORDER: ', '') });
  }
});

apiRouter.post('/crm/cart-recovery/trigger', requireCrmAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { cartId, channel } = req.body || {};
    if (!cartId || typeof cartId !== 'string') {
      return res.status(400).json({ success: false, error: 'cartId is required.' });
    }
    const chosenChannel: 'EMAIL' | 'WHATSAPP' = channel === 'WHATSAPP' ? 'WHATSAPP' : 'EMAIL';

    let resolved;
    try {
      resolved = cartRecovery.resolveCartRecipient(cartId);
    } catch (e: any) {
      return res.status(404).json({ success: false, error: e.message || 'Cart not found.' });
    }

    if (chosenChannel === 'EMAIL' && (!resolved.email || !resolved.email.includes('@'))) {
      return res.status(400).json({
        success: false,
        error: 'Patron email address is missing or invalid for this cart.'
      });
    }
    if (chosenChannel === 'WHATSAPP' && resolved.phone.replace(/\D/g, '').length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Valid Indian mobile number is missing for WhatsApp recovery.'
      });
    }

    if (resolved.inCooldown) {
      return res.json({
        success: false,
        message: `Recovery message already dispatched to ${resolved.email || resolved.phone} within the 2-hour cooldown window.`,
        cart: resolved.cart,
        deliveryMode: 'SANDBOX_FALLBACK',
        fallbackReason: 'Cooldown window active'
      });
    }

    const activePromo = (db.getConfig().promoCodes || []).find(p => p.active)?.code || 'HEIRLOOM10';
    const requestOrigin = req.get('host') ? `${req.protocol}://${req.get('host')}` : 'http://localhost:3000';
    const baseAppUrl = (process.env.APP_URL || requestOrigin).replace(/\/$/, '');
    const fullCheckoutUrl = resolved.cart.checkoutUrl.startsWith('http')
      ? resolved.cart.checkoutUrl
      : `${baseAppUrl}${resolved.cart.checkoutUrl}`;

    const delivery = await dispatchCartRecoveryNotice(resolved.cart, chosenChannel, activePromo, fullCheckoutUrl);

    if (chosenChannel === 'EMAIL' && (delivery as any)?.smtpConfigured && delivery.mode === 'SANDBOX_FALLBACK') {
      db.logAudit(
        req.user!.email,
        'CART_RECOVERY_EMAIL_ERROR',
        'STORE_MANAGEMENT',
        `SMTP failed for abandoned cart ${cartId} (${resolved.email}): ${delivery.fallbackReason || 'Transport error'}`
      );
      return res.status(502).json({
        success: false,
        error: delivery.fallbackReason || 'Live SMTP delivery failed.',
        message: delivery.fallbackReason || 'Live SMTP delivery failed.',
        deliveryMode: delivery.mode,
        messageId: delivery.messageId,
        fallbackReason: delivery.fallbackReason,
        delivery
      });
    }

    const result = await db.runAtomicMutation(() => cartRecovery.dispatchRecoveryMessage(cartId, chosenChannel));

    res.json({
      ...result,
      deliveryMode: delivery.mode,
      messageId: delivery.messageId,
      fallbackReason: delivery.fallbackReason,
      delivery
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/crm/cart/detect-sweep', requireCrmAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await db.runAtomicMutation(() => cartRecovery.runAbandonmentDetectionSweep());
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Remove an unrecoverable / obsolete card from the Abandoned Checkout Recovery Board
apiRouter.delete('/crm/abandoned-carts/:id', requireCrmAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const cartId = String(req.params.id || '').trim();
    if (!cartId) {
      return res.status(400).json({ success: false, error: 'Cart ID is required.' });
    }
    const removed = await db.deleteCartAsync(cartId, req.user!.email);
    if (!removed) {
      return res.status(404).json({ success: false, error: 'Abandoned cart card not found.' });
    }
    return res.json({
      success: true,
      removedCartId: removed.id,
      message: `Removed abandoned checkout card (${removed.email || removed.id}) from the recovery board.`
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to remove abandoned cart card.' });
  }
});

// ==========================================
// 3. ERP & SUPPLY CHAIN ENDPOINTS (STORE_MANAGER | LOGISTICS_COORDINATOR)
// ==========================================

apiRouter.get('/erp/inventory', requireErpAccess, (req: AuthenticatedRequest, res: Response) => {
  const inventory = db.getInventory();
  const bom = db.getBillOfMaterials();
  const lowStockAlerts = db.getLowStockAlerts();
  res.json({ success: true, inventory, billOfMaterials: bom, lowStockAlerts });
});

// Permanent Inventory Stock & Safety Stock Adjustment (Row-locked in MySQL)
apiRouter.post('/erp/inventory/adjust', requireErpAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sku, location, newQty, safetyStock } = req.body;
    const parsedSafety =
      safetyStock !== undefined && safetyStock !== null && safetyStock !== ''
        ? Number(safetyStock)
        : undefined;
    const updated = await db.updateInventoryStockAsync(sku, location, newQty, req.user!.email, parsedSafety);
    res.json({ success: true, inventoryItem: updated, lowStockAlerts: db.getLowStockAlerts() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Direct inline update of SKU Safety Stock threshold under Stock by Location
apiRouter.patch('/erp/inventory/:sku/safety-stock', requireErpAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sku = decodeURIComponent(String(req.params.sku || '').trim());
    const safetyStock = Number(req.body?.safetyStock);
    if (!sku || !Number.isFinite(safetyStock) || safetyStock < 0) {
      return res.status(400).json({ error: 'Valid SKU and non-negative safetyStock integer are required.' });
    }
    const updated = await db.updateInventorySafetyStockAsync(sku, safetyStock, req.user!.email);
    return res.json({ success: true, inventoryItem: updated, lowStockAlerts: db.getLowStockAlerts() });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Failed to update safety stock.' });
  }
});

apiRouter.post('/erp/bom', requireErpAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const bomItem = await db.runAtomicMutation(() => db.addBillOfMaterialsItem(req.body, req.user!.email));
    res.status(201).json({ success: true, bomItem });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/erp/bom/:id/adjust', requireErpAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { inventoryOnHand, safetyStock } = req.body;
    const bomItem = await db.runAtomicMutation(() =>
      db.updateBomItemStock(req.params.id, inventoryOnHand, safetyStock, req.user!.email)
    );
    res.json({ success: true, bomItem });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/erp/orders', requireErpAccess, (req: AuthenticatedRequest, res: Response) => {
  const orders = db.getOrders();
  res.json({ success: true, orders });
});

apiRouter.post('/erp/orders/:id/status', requireErpAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, courierPreference } = req.body;
    let updated = await db.runAtomicMutation(() => db.updateOrderStatus(req.params.id, status, req.user!.email));

    let logisticsResult: any = null;
    if (status === 'DISPATCHED') {
      logisticsResult = await allocateCourierAwb({
        order: updated,
        courierPreference: courierPreference === 'DELHIVERY' ? 'DELHIVERY' : updated.courierPartner || 'SHIPROCKET'
      });
      if (logisticsResult?.awbNumber) {
        updated = await db.runAtomicMutation(() => {
          const ord = db.getOrderById(req.params.id);
          if (ord) {
            ord.awbNumber = logisticsResult.awbNumber;
            ord.courierPartner = logisticsResult.courier;
            ord.updatedAt = new Date().toISOString();
          }
          return ord!;
        });
      }
    }

    res.json({ success: true, order: updated, logistics: logisticsResult });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/erp/quotes/push-order', requireErpAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const order = await erpSync.pushCustomQuoteToSalesOrder(req.body, req.user!.email);
    const lead = req.body?.leadId
      ? db.getCorporateGiftingLeads().find(l => l.id === req.body.leadId)
      : undefined;
    res.status(201).json({ success: true, order, lead });
  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : 'Failed to push quote to ERP Sales Order';
    const isDuplicate = msg.startsWith('DUPLICATE_ERP_ORDER');
    const isStock = msg.toLowerCase().includes('out of stock') || msg.toLowerCase().includes('insufficient stock');
    res.status(isDuplicate || isStock ? 409 : 400).json({ error: msg.replace('DUPLICATE_ERP_ORDER: ', '') });
  }
});

apiRouter.post('/erp/rma/process', requireErpAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderId, customerId, reason, inspectionNotes, restockInWarehouse, restockLocation } = req.body;
    const result = await erpSync.processRMA({
      orderId,
      customerId,
      reason,
      inspectionNotes,
      restockInWarehouse: Boolean(restockInWarehouse),
      restockLocation: restockLocation === 'mumbaiWarehouse' ? 'mumbaiWarehouse' : 'punePrimaryHub',
      actorEmail: req.user!.email
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/erp/invoices', requireErpAccess, (req: AuthenticatedRequest, res: Response) => {
  const invoices = db.getInvoices();
  const creditNotes = db.getCreditNotes();
  const gstEnabled = db.getConfig().gstInvoicingEnabled;
  res.json({ success: true, gstEnabled, invoices, creditNotes });
});

// Real GST Tax Invoice & Credit Note PDF / Print-Ready HTML Renderer
// Enforces auth (Bearer header or ?token=) and caller ownership (Store Manager / Logistics Coordinator OR owning Patron)
apiRouter.get('/erp/invoices/:num', async (req: Request, res: Response) => {
  const headerOrQueryToken =
    req.headers.authorization ||
    (typeof req.query.token === 'string' && req.query.token.trim()
      ? `Bearer ${req.query.token.trim()}`
      : undefined);

  const user = await resolveAuthTokenAsync(headerOrQueryToken);
  if (!user) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required to access tax documents.' });
  }

  const rawParam = decodeURIComponent(req.params.num || '');
  const isHtml = req.query.format === 'html';
  const asAttachment = req.query.download === '1' || req.query.download === 'true';

  const invoice = db.findInvoiceByNumberOrSlug(rawParam);
  const creditNote = !invoice ? db.findCreditNoteByNumberOrSlug(rawParam) : undefined;

  if (!invoice && !creditNote) {
    return res.status(404).json({ error: 'Tax invoice or credit note not found.' });
  }

  const orderId = invoice ? invoice.orderId : creditNote!.orderId;
  const order = db.getOrderById(orderId);
  const isErpStaff =
    db.isStoreManagementAuthorized(user.email) &&
    ['STORE_MANAGER', 'LOGISTICS_COORDINATOR'].includes(db.getStaffRole(user.email));
  const callerCust = db.getCustomerById(user.email) || db.getCustomerById(user.uid);
  const ownsDocument =
    (invoice && callerCust && invoice.customerId === callerCust.id) ||
    (order && order.customerEmail.trim().toLowerCase() === user.email.trim().toLowerCase()) ||
    (order && callerCust && order.customerId === callerCust.id);

  if (!isErpStaff && !ownsDocument) {
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: 'You do not have permission to view or download this GST document.'
    });
  }

  const config = db.getConfig();
  const ownerCustomer =
    db.getCustomerById(order?.customerId || invoice?.customerId || '') ||
    (order?.customerEmail ? db.getCustomerById(order.customerEmail) : undefined);
  const ownerDefaultAddr = ownerCustomer ? db.getDefaultCustomerAddress(ownerCustomer.id) : undefined;
  const recipientFallback = { customer: ownerCustomer, defaultAddress: ownerDefaultAddr };

  if (invoice) {
    if (isHtml) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(renderTaxInvoiceHtml(invoice, order, config, recipientFallback));
    }
    const pdfBuf = renderTaxInvoicePdf(invoice, order, config, recipientFallback);
    const filename = `${invoice.invoiceNumber.replace(/\//g, '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${asAttachment ? 'attachment' : 'inline'}; filename="${filename}"`);
    return res.send(pdfBuf);
  }

  const relatedInv = db.findInvoiceByNumberOrSlug(creditNote!.originalInvoiceNumber);
  if (isHtml) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(renderCreditNoteHtml(creditNote!, relatedInv, order, config, recipientFallback));
  }
  const cnPdf = renderCreditNotePdf(creditNote!, relatedInv, order, config, recipientFallback);
  const cnFilename = `${creditNote!.creditNoteNumber.replace(/\//g, '-')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${asAttachment ? 'attachment' : 'inline'}; filename="${cnFilename}"`);
  return res.send(cnPdf);
});

apiRouter.post('/erp/courier/milestone', requireErpAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderId, milestone, locationName } = req.body;
    const updated = await erpSync.syncCourierMilestone(orderId, milestone, locationName || 'Pune Primary Hub');
    res.json({ success: true, order: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. PERFORMANCE INSIGHTS & ANALYTICS (STORE_MANAGER | SUPPORT_AGENT | LOGISTICS_COORDINATOR)
// ==========================================

apiRouter.get('/analytics/dashboard', requireAnalyticsAccess, (req: AuthenticatedRequest, res: Response) => {
  const unitEconomics = computeUnitEconomics();
  const operationalHealth = computeOperationalHealth();
  const cohorts = computeCohortRetention();
  const skuVelocity = computeSkuReorderVelocity();
  const lowStockAlerts = db.getLowStockAlerts();

  res.json({
    success: true,
    unitEconomics,
    operationalHealth,
    cohorts,
    skuVelocity,
    lowStockAlerts
  });
});

// ==========================================
// 5. STORE MANAGEMENT ACCESS & SETTINGS (ADMIN ONLY)
// ==========================================

apiRouter.get('/store-management/config', requireStoreManagementAccess, (req: AuthenticatedRequest, res: Response) => {
  const config = db.getConfig();
  const auditLogs = db.getAuditLogs().slice(0, 50);
  const isMaster = db.isMasterAuthorized(req.user!.email);
  const mysqlStatus = mysqlAdapter.getStatus();
  const lastPersistError = db.getLastPersistError();
  const integrations = getIntegrationsReadiness();

  res.json({
    success: true,
    config,
    auditLogs,
    isMasterSuperAdmin: isMaster,
    mysqlStatus,
    lastPersistError,
    lastDailyReportDate: db.getLastDailyReportDate() || null,
    integrations
  });
});

apiRouter.post('/admin/reports/send-daily-orders', requireMasterAdminAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetDateIst = typeof req.body?.date === 'string' ? req.body.date.trim() : undefined;
    const result = await sendDailyOrdersReport({
      force: true,
      targetDateIst,
      actorEmail: req.user!.email
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to generate daily Excel order report.' });
  }
});

apiRouter.get('/admin/reports/daily-orders-excel', requireStoreManagementAccess, (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetDateIst = typeof req.query?.date === 'string' ? req.query.date.trim() : undefined;
    const report = generateDailyOrderWorkbook(targetDateIst);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
    res.send(report.buffer);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to export daily Excel workbook.' });
  }
});

apiRouter.get('/store-management/integrations-status', requireStoreManagementAccess, (req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, integrations: getIntegrationsReadiness() });
});

apiRouter.post('/store-management/operational-rules', requireStoreManagementAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { abandonmentThresholdMinutes, supplierGstin, gstRatePercent, promoCodes } = req.body || {};
    const updatedConfig = await db.runAtomicMutation(() =>
      db.updateOperationalSettings(
        {
          abandonmentThresholdMinutes,
          supplierGstin,
          gstRatePercent,
          promoCodes
        },
        req.user!.email
      )
    );
    res.json({
      success: true,
      config: updatedConfig,
      message: 'Operational rules, GST tax metadata, and promo codes updated permanently.'
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/store-management/mysql-config', requireStoreManagementAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { host, port, database, user, password } = req.body;
    const result = await mysqlAdapter.configureAndConnect(
      {
        host: host || 'localhost',
        port: port ? parseInt(port, 10) : 3306,
        database,
        user,
        password
      },
      { persistCredentials: true }
    );
    if (result.connected) {
      await db.runAtomicMutation(() => {
        db.logAudit(
          req.user!.email,
          'MYSQL_CONNECTED',
          'STORE_MANAGEMENT',
          `Connected Hostinger MySQL database '${database}' on ${host} (encrypted credentials persisted for reboot)`
        );
      });
      await mysqlAdapter.saveCatalogAndStateAtomic(db.getRawCatalog(), db.getFullStateSnapshot());
    }
    res.status(result.connected ? 200 : 400).json({
      success: result.connected,
      message: result.message,
      mysqlStatus: mysqlAdapter.getStatus()
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
      message: err.message,
      mysqlStatus: mysqlAdapter.getStatus()
    });
  }
});

apiRouter.post('/store-management/gst-toggle', requireMasterAdminAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { enabled } = req.body;
    await db.runAtomicMutation(() => {
      db.updateGstInvoicing(Boolean(enabled), req.user!.email);
    });
    res.json({
      success: true,
      gstInvoicingEnabled: db.getConfig().gstInvoicingEnabled,
      message: `GST Invoicing module ${enabled ? 'enabled' : 'disabled'} successfully.`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Add Permitted Staff / Admin User ID (via UI) with Granular RBAC Role
apiRouter.post('/store-management/permitted-managers', requireMasterAdminAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, userId, displayName, password, role } = req.body;
    const targetId = userId || email;
    if (!targetId) return res.status(400).json({ error: 'User ID or Email is required' });

    await db.runAtomicMutation(() => {
      db.addPermittedManager(targetId, req.user!.email, displayName, password, role);
    });
    res.json({
      success: true,
      config: db.getConfig(),
      permittedStoreManagers: db.getConfig().permittedStoreManagers,
      message: `Authorized Staff User ID "${targetId}" added successfully (${role || 'STORE_MANAGER'}).`
    });
  } catch (err: any) {
    const isDbError = typeof err?.message === 'string' && err.message.toLowerCase().includes('mysql');
    res.status(isDbError ? 500 : 400).json({ error: err.message });
  }
});

// Explicit Targeted Admin User Deletion Endpoint (Master Super-Admin Only)
apiRouter.delete('/admin-users/:id', requireMasterAdminAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetId = decodeURIComponent(req.params.id || '').trim();
    if (!targetId) return res.status(400).json({ error: 'Admin User ID is required' });

    await db.deleteAdminUserAsync(targetId, req.user!.email);
    res.json({
      success: true,
      config: db.getConfig(),
      permittedStoreManagers: db.getConfig().permittedStoreManagers,
      message: `Revoked Admin access and deleted "${targetId}" from authorized admin users.`
    });
  } catch (err: any) {
    const isDbError = typeof err?.message === 'string' && err.message.toLowerCase().includes('mysql');
    res.status(isDbError ? 500 : 400).json({ error: err.message });
  }
});

// Remove Permitted Admin User ID (Alias delegating to targeted deleteAdminUserAsync)
apiRouter.delete('/store-management/permitted-managers', requireMasterAdminAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, userId } = req.body;
    const targetId = userId || email;
    if (!targetId) return res.status(400).json({ error: 'User ID or Email is required' });

    await db.deleteAdminUserAsync(targetId, req.user!.email);
    res.json({
      success: true,
      config: db.getConfig(),
      permittedStoreManagers: db.getConfig().permittedStoreManagers,
      message: `Revoked Admin access for "${targetId}".`
    });
  } catch (err: any) {
    const isDbError = typeof err?.message === 'string' && err.message.toLowerCase().includes('mysql');
    res.status(isDbError ? 500 : 400).json({ error: err.message });
  }
});

// Upload Product Media (Images: png/jpg/jpeg/webp <= 10MB, Video: mp4/webm <= 50MB) to /assets/images/
apiRouter.post(
  '/store-management/upload-media',
  requireStoreManagementAccess,
  handleMediaUploadBody,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contentTypeHeader = String(req.headers['content-type'] || '').toLowerCase();
      let rawFilename = '';
      let rawMimeType = '';
      let fileBuffer: Buffer | null = null;

      if (Buffer.isBuffer(req.body)) {
        if (contentTypeHeader.includes('multipart/form-data')) {
          const parsed = parseMultipartSingleFile(req.body, String(req.headers['content-type'] || ''));
          if (!parsed) {
            return res.status(400).json({ error: 'No media file found in multipart upload.' });
          }
          rawFilename = parsed.filename;
          rawMimeType = parsed.mimeType;
          fileBuffer = parsed.buffer;
        } else {
          rawFilename = String(req.headers['x-filename'] || req.query.filename || '');
          rawMimeType = contentTypeHeader.split(';')[0].trim();
          fileBuffer = req.body;
        }
      } else if (req.body && typeof req.body === 'object') {
        rawFilename = String(req.body.filename || req.body.fileName || req.body.name || '');
        rawMimeType = String(req.body.mimeType || req.body.contentType || '').toLowerCase().trim();
        const encoded = String(req.body.dataBase64 || req.body.dataUrl || req.body.data || req.body.base64 || '').trim();
        const dataUrlMatch = encoded.match(/^data:([^;]+);base64,(.+)$/i);
        if (dataUrlMatch) {
          if (!rawMimeType) rawMimeType = dataUrlMatch[1].toLowerCase().trim();
          fileBuffer = Buffer.from(dataUrlMatch[2], 'base64');
        } else if (encoded) {
          fileBuffer = Buffer.from(encoded, 'base64');
        }
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        return res.status(400).json({ error: 'Empty or missing media upload payload.' });
      }

      const rawExt = path.extname(rawFilename || '').toLowerCase();
      const isValidImageExt = Boolean(IMAGE_MIME_BY_EXT[rawExt]);
      const isValidVideoExt = Boolean(VIDEO_MIME_BY_EXT[rawExt]);
      const normalizedMime = rawMimeType === 'image/jpg' ? 'image/jpeg' : rawMimeType;
      const mimeExt = normalizedMime ? EXT_BY_MIME[normalizedMime] : undefined;

      // Reject explicitly disallowed extensions even if spoofed, or unknown MIME+ext pairs
      if (rawExt && !isValidImageExt && !isValidVideoExt) {
        return res.status(400).json({
          error: 'Unsupported file extension. Allowed images: png, jpg, jpeg, webp. Allowed videos: mp4, webm.'
        });
      }
      if (normalizedMime && normalizedMime !== 'application/octet-stream' && !mimeExt) {
        return res.status(400).json({
          error: 'Unsupported media MIME type. Allowed images: png, jpg, jpeg, webp. Allowed videos: mp4, webm.'
        });
      }
      if (!rawExt && !mimeExt) {
        return res.status(400).json({
          error: 'Could not verify media format. Upload a valid png, jpg, jpeg, webp, mp4, or webm file.'
        });
      }
      if (isValidImageExt && mimeExt && !IMAGE_MIME_BY_EXT[mimeExt]) {
        return res.status(400).json({ error: 'File extension does not match uploaded MIME type.' });
      }
      if (isValidVideoExt && mimeExt && !VIDEO_MIME_BY_EXT[mimeExt]) {
        return res.status(400).json({ error: 'File extension does not match uploaded MIME type.' });
      }

      const isVideo = isValidVideoExt || Boolean(mimeExt && VIDEO_MIME_BY_EXT[mimeExt]);
      const canonicalExt =
        rawExt === '.jpeg'
          ? '.jpeg'
          : isValidImageExt || isValidVideoExt
          ? rawExt
          : mimeExt!;
      const resolvedMime =
        normalizedMime && mimeExt
          ? normalizedMime
          : isVideo
          ? VIDEO_MIME_BY_EXT[canonicalExt]
          : IMAGE_MIME_BY_EXT[canonicalExt];

      if (!isVideo && fileBuffer.length > MAX_IMAGE_UPLOAD_BYTES) {
        return res.status(413).json({ error: 'Image file size must not exceed 10MB.' });
      }
      if (isVideo && fileBuffer.length > MAX_VIDEO_UPLOAD_BYTES) {
        return res.status(413).json({ error: 'Video file size must not exceed 50MB.' });
      }

      const rawBase =
        path
          .basename(rawFilename || '', path.extname(rawFilename || ''))
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 48) || (isVideo ? 'atelier_video' : 'atelier_piece');

      const safeFileName = `${rawBase}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${canonicalExt}`;
      const publicImagesDir = path.resolve(process.cwd(), 'public', 'assets', 'images');
      fs.mkdirSync(publicImagesDir, { recursive: true });
      fs.writeFileSync(path.join(publicImagesDir, safeFileName), fileBuffer);

      const distDir = path.resolve(process.cwd(), 'dist');
      if (fs.existsSync(distDir)) {
        const distImagesDir = path.join(distDir, 'assets', 'images');
        fs.mkdirSync(distImagesDir, { recursive: true });
        fs.writeFileSync(path.join(distImagesDir, safeFileName), fileBuffer);
      }

      const publicUrl = `/assets/images/${safeFileName}`;
      db.logAudit(
        req.user!.email,
        'UPLOAD_MEDIA',
        'STORE_MANAGEMENT',
        `Uploaded ${isVideo ? 'video' : 'image'} asset ${publicUrl} (${fileBuffer.length} bytes)`
      );

      return res.status(201).json({
        success: true,
        url: publicUrl,
        filename: safeFileName,
        mediaType: isVideo ? 'video' : 'image',
        mimeType: resolvedMime,
        sizeBytes: fileBuffer.length
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Media upload failed.' });
    }
  }
);

// Knowledge Base Presentation & Video Upload / Update (.pdf, .pptx, .ppt, .mp4, .webm, .mov <= 50MB + video URL)
apiRouter.post(
  '/store-management/knowledge-base',
  requireStoreManagementAccess,
  handleMediaUploadBody,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contentTypeHeader = String(req.headers['content-type'] || '').toLowerCase();
      let entryId = '';
      let title = '';
      let description = '';
      let category: 'LEATHER_GUIDE' | 'CARE_MANUAL' | 'CRAFT_DECK' | 'SUSTAINABILITY' = 'LEATHER_GUIDE';
      let rawFilename = '';
      let rawMimeType = '';
      let fileBuffer: Buffer | null = null;
      let rawVideoFilename = '';
      let rawVideoMimeType = '';
      let videoBuffer: Buffer | null = null;
      let externalVideoUrlInput = '';
      let removeVideo = false;
      let slides: Array<{ title: string; subtitle?: string; points: string[] }> | undefined;

      if (Buffer.isBuffer(req.body)) {
        if (contentTypeHeader.includes('multipart/form-data')) {
          const parsed = parseMultipartFormData(req.body, String(req.headers['content-type'] || ''));
          entryId = parsed.fields.id || '';
          title = parsed.fields.title || '';
          description = parsed.fields.description || '';
          externalVideoUrlInput = parsed.fields.videoUrl || '';
          removeVideo = ['true', '1', 'yes'].includes((parsed.fields.removeVideo || '').toLowerCase());
          const rawCat = (parsed.fields.category || 'LEATHER_GUIDE').toUpperCase();
          if (['LEATHER_GUIDE', 'CARE_MANUAL', 'CRAFT_DECK', 'SUSTAINABILITY'].includes(rawCat)) {
            category = rawCat as typeof category;
          }
          if (parsed.files.file) {
            rawFilename = parsed.files.file.filename;
            rawMimeType = parsed.files.file.mimeType;
            fileBuffer = parsed.files.file.buffer;
          } else if (parsed.file && parsed.file.fieldName !== 'videoFile') {
            rawFilename = parsed.file.filename;
            rawMimeType = parsed.file.mimeType;
            fileBuffer = parsed.file.buffer;
          }
          if (parsed.files.videoFile) {
            rawVideoFilename = parsed.files.videoFile.filename;
            rawVideoMimeType = parsed.files.videoFile.mimeType;
            videoBuffer = parsed.files.videoFile.buffer;
          }
        } else {
          rawFilename = String(req.headers['x-filename'] || req.query.filename || '');
          rawMimeType = contentTypeHeader.split(';')[0].trim();
          title = String(req.headers['x-kb-title'] || req.query.title || '');
          description = String(req.headers['x-kb-description'] || req.query.description || '');
          fileBuffer = req.body;
        }
      } else if (req.body && typeof req.body === 'object') {
        entryId = String(req.body.id || '').trim();
        title = String(req.body.title || '').trim();
        description = String(req.body.description || '').trim();
        externalVideoUrlInput = String(req.body.videoUrl || '').trim();
        removeVideo = Boolean(req.body.removeVideo === true || String(req.body.removeVideo || '').toLowerCase() === 'true');
        const rawCat = String(req.body.category || 'LEATHER_GUIDE').toUpperCase();
        if (['LEATHER_GUIDE', 'CARE_MANUAL', 'CRAFT_DECK', 'SUSTAINABILITY'].includes(rawCat)) {
          category = rawCat as typeof category;
        }
        if (Array.isArray(req.body.slides)) {
          slides = req.body.slides;
        }
        rawFilename = String(req.body.filename || req.body.fileName || '').trim();
        rawMimeType = String(req.body.mimeType || req.body.contentType || '').toLowerCase().trim();
        const encoded = String(req.body.dataBase64 || req.body.dataUrl || req.body.data || '').trim();
        const dataUrlMatch = encoded.match(/^data:([^;]+);base64,(.+)$/i);
        if (dataUrlMatch) {
          if (!rawMimeType) rawMimeType = dataUrlMatch[1].toLowerCase().trim();
          fileBuffer = Buffer.from(dataUrlMatch[2], 'base64');
        } else if (encoded) {
          fileBuffer = Buffer.from(encoded, 'base64');
        }

        rawVideoFilename = String(req.body.videoFilename || req.body.videoFileName || '').trim();
        rawVideoMimeType = String(req.body.videoMimeType || '').toLowerCase().trim();
        const videoEncoded = String(req.body.videoBase64 || req.body.videoDataUrl || '').trim();
        const videoDataUrlMatch = videoEncoded.match(/^data:([^;]+);base64,(.+)$/i);
        if (videoDataUrlMatch) {
          if (!rawVideoMimeType) rawVideoMimeType = videoDataUrlMatch[1].toLowerCase().trim();
          videoBuffer = Buffer.from(videoDataUrlMatch[2], 'base64');
        } else if (videoEncoded) {
          videoBuffer = Buffer.from(videoEncoded, 'base64');
        }
      }

      const existing = entryId ? db.getKnowledgeBase().find(k => k.id === entryId) : undefined;
      const finalTitle =
        title ||
        existing?.title ||
        (rawFilename ? path.basename(rawFilename, path.extname(rawFilename)).replace(/[_-]+/g, ' ') : '') ||
        (rawVideoFilename ? path.basename(rawVideoFilename, path.extname(rawVideoFilename)).replace(/[_-]+/g, ' ') : '');
      if (!finalTitle || finalTitle.length < 2) {
        return res.status(400).json({ error: 'Knowledge Base entry title is required (minimum 2 characters).' });
      }
      const finalDescription =
        description || existing?.description || 'Bharatvarsh Atelier leathercraft presentation & patron reference guide.';

      const saveKbAssetToDisk = (buf: Buffer, origName: string, canonicalExt: string, fallbackPrefix: string) => {
        const rawBase =
          path
            .basename(origName || finalTitle, path.extname(origName || ''))
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 48) || fallbackPrefix;

        const safeFileName = `${rawBase}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${canonicalExt}`;
        const publicKbDir = path.resolve(process.cwd(), 'public', 'assets', 'knowledge-base');
        fs.mkdirSync(publicKbDir, { recursive: true });
        fs.writeFileSync(path.join(publicKbDir, safeFileName), buf);

        const distDir = path.resolve(process.cwd(), 'dist');
        if (fs.existsSync(distDir)) {
          const distKbDir = path.join(distDir, 'assets', 'knowledge-base');
          fs.mkdirSync(distKbDir, { recursive: true });
          fs.writeFileSync(path.join(distKbDir, safeFileName), buf);
        }
        return { safeFileName, publicUrl: `/assets/knowledge-base/${safeFileName}` };
      };

      const cleanupKbAssetIfLocal = (assetUrl?: string) => {
        if (!assetUrl || !assetUrl.startsWith('/assets/knowledge-base/')) return;
        const basename = path.basename(assetUrl);
        const publicPath = path.resolve(process.cwd(), 'public', 'assets', 'knowledge-base', basename);
        const distPath = path.resolve(process.cwd(), 'dist', 'assets', 'knowledge-base', basename);
        try {
          if (fs.existsSync(publicPath)) fs.unlinkSync(publicPath);
          if (fs.existsSync(distPath)) fs.unlinkSync(distPath);
        } catch {
          // Non-fatal cleanup
        }
      };

      let fileUrl = existing?.fileUrl;
      let fileName = existing?.fileName;
      let fileType: 'PDF' | 'PPTX' | 'PPT' | 'VIDEO' | 'DECK' = existing?.fileType || 'DECK';
      let mimeType = existing?.mimeType;
      let sizeBytes = existing?.sizeBytes;

      let videoUrl = existing?.videoUrl;
      let videoFileName = existing?.videoFileName;
      let videoMimeType = existing?.videoMimeType;
      let videoSizeBytes = existing?.videoSizeBytes;

      if (removeVideo) {
        cleanupKbAssetIfLocal(existing?.videoUrl);
        videoUrl = undefined;
        videoFileName = undefined;
        videoMimeType = undefined;
        videoSizeBytes = undefined;
      }

      // 1. Handle primary uploaded file (.pdf, .pptx, .ppt, OR direct video .mp4/.webm/.mov)
      if (fileBuffer && fileBuffer.length > 0) {
        if (fileBuffer.length > MAX_KB_UPLOAD_BYTES) {
          return res.status(413).json({ error: 'Uploaded file size must not exceed 50MB.' });
        }

        const rawExt = path.extname(rawFilename || '').toLowerCase();
        const validByExt = Boolean(KB_MIME_BY_EXT[rawExt]);
        const extByMime = rawMimeType ? KB_EXT_BY_MIME[rawMimeType] : undefined;

        if (rawExt && !validByExt) {
          return res.status(400).json({
            error: 'Unsupported file format. Please upload .pdf, .pptx, .ppt, .mp4, .webm, or .mov files.'
          });
        }
        if (!validByExt && !extByMime) {
          return res.status(400).json({
            error: 'Could not verify file format. Please upload a valid .pdf, .pptx, .ppt, .mp4, .webm, or .mov file.'
          });
        }

        const canonicalExt = validByExt ? rawExt : extByMime!;
        const resolvedMime = KB_MIME_BY_EXT[canonicalExt];
        const saved = saveKbAssetToDisk(
          fileBuffer,
          rawFilename,
          canonicalExt,
          KB_VIDEO_EXTS.has(canonicalExt) ? 'leather_video' : 'leather_presentation'
        );

        if (KB_VIDEO_EXTS.has(canonicalExt)) {
          if (existing?.videoUrl && existing.videoUrl !== saved.publicUrl) {
            cleanupKbAssetIfLocal(existing.videoUrl);
          }
          videoUrl = saved.publicUrl;
          videoFileName = rawFilename || saved.safeFileName;
          videoMimeType = resolvedMime;
          videoSizeBytes = fileBuffer.length;
          if (!existing?.fileUrl && (!existing?.slides || existing.slides.length === 0)) {
            fileType = 'VIDEO';
          }
        } else {
          if (existing?.fileUrl && existing.fileUrl !== saved.publicUrl) {
            cleanupKbAssetIfLocal(existing.fileUrl);
          }
          fileUrl = saved.publicUrl;
          fileName = rawFilename || saved.safeFileName;
          fileType = canonicalExt === '.pdf' ? 'PDF' : canonicalExt === '.pptx' ? 'PPTX' : 'PPT';
          mimeType = resolvedMime;
          sizeBytes = fileBuffer.length;
        }
      }

      // 2. Handle dedicated videoFile upload (allows adding/replacing video on any deck or PDF)
      if (videoBuffer && videoBuffer.length > 0) {
        if (videoBuffer.length > MAX_KB_UPLOAD_BYTES) {
          return res.status(413).json({ error: 'Video file size must not exceed 50MB.' });
        }
        const rawVidExt = path.extname(rawVideoFilename || '').toLowerCase();
        const validVidByExt = KB_VIDEO_EXTS.has(rawVidExt);
        const vidExtByMime = rawVideoMimeType ? KB_EXT_BY_MIME[rawVideoMimeType] : undefined;
        const validVidByMime = Boolean(vidExtByMime && KB_VIDEO_EXTS.has(vidExtByMime));

        if (!validVidByExt && !validVidByMime) {
          return res.status(400).json({
            error: 'Unsupported video format. Please upload an .mp4, .webm, or .mov video file.'
          });
        }

        const canonicalVidExt = validVidByExt ? rawVidExt : vidExtByMime!;
        const resolvedVidMime = KB_MIME_BY_EXT[canonicalVidExt];
        const savedVid = saveKbAssetToDisk(videoBuffer, rawVideoFilename, canonicalVidExt, 'leather_video');

        if (existing?.videoUrl && existing.videoUrl !== savedVid.publicUrl) {
          cleanupKbAssetIfLocal(existing.videoUrl);
        }
        videoUrl = savedVid.publicUrl;
        videoFileName = rawVideoFilename || savedVid.safeFileName;
        videoMimeType = resolvedVidMime;
        videoSizeBytes = videoBuffer.length;
        if (!fileUrl && (!existing?.slides || existing.slides.length === 0) && (!slides || slides.length === 0)) {
          fileType = 'VIDEO';
        }
      } else if (!removeVideo && externalVideoUrlInput) {
        const cleanVidUrl = externalVideoUrlInput.trim();
        if (!/^(\/assets\/|https?:\/\/)/i.test(cleanVidUrl)) {
          return res.status(400).json({
            error: 'Video URL must start with https://, http://, or /assets/.'
          });
        }
        if (existing?.videoUrl && existing.videoUrl !== cleanVidUrl) {
          cleanupKbAssetIfLocal(existing.videoUrl);
        }
        videoUrl = cleanVidUrl;
        videoFileName = undefined;
        videoMimeType = undefined;
        videoSizeBytes = undefined;
        if (!fileUrl && (!existing?.slides || existing.slides.length === 0) && (!slides || slides.length === 0)) {
          fileType = 'VIDEO';
        }
      }

      if (!existing && !fileUrl && !videoUrl && (!slides || slides.length === 0)) {
        return res.status(400).json({
          error: 'Please attach a presentation file (.pdf, .pptx, .ppt), upload a video (.mp4, .webm, .mov), or enter a video URL.'
        });
      }

      const savedEntry = await db.runAtomicMutation(() =>
        db.upsertKnowledgeBaseEntry(
          {
            id: entryId || undefined,
            title: finalTitle,
            description: finalDescription,
            category,
            fileUrl,
            fileName,
            fileType,
            mimeType,
            sizeBytes,
            videoUrl,
            videoFileName,
            videoMimeType,
            videoSizeBytes,
            uploadedBy: req.user!.email,
            slides: slides || existing?.slides
          },
          req.user!.email
        )
      );

      return res.status(existing ? 200 : 201).json({
        success: true,
        entry: savedEntry,
        entries: db.getKnowledgeBase(),
        message: existing
          ? `Knowledge Base entry "${savedEntry.title}" updated.`
          : `Knowledge Base entry "${savedEntry.title}" published.`
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Knowledge Base upload failed.' });
    }
  }
);

apiRouter.delete('/store-management/knowledge-base/:id', requireStoreManagementAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const removed = await db.runAtomicMutation(() =>
      db.deleteKnowledgeBaseEntry(req.params.id, req.user!.email)
    );
    if (!removed) {
      return res.status(404).json({ error: 'Knowledge Base presentation not found.' });
    }

    for (const candidateUrl of [removed.fileUrl, removed.videoUrl]) {
      if (candidateUrl && candidateUrl.startsWith('/assets/knowledge-base/')) {
        const basename = path.basename(candidateUrl);
        const publicPath = path.resolve(process.cwd(), 'public', 'assets', 'knowledge-base', basename);
        const distPath = path.resolve(process.cwd(), 'dist', 'assets', 'knowledge-base', basename);
        try {
          if (fs.existsSync(publicPath)) fs.unlinkSync(publicPath);
          if (fs.existsSync(distPath)) fs.unlinkSync(distPath);
        } catch {
          // Non-fatal file cleanup
        }
      }
    }

    return res.json({
      success: true,
      removed,
      entries: db.getKnowledgeBase(),
      message: `Removed "${removed.title}" from the Leather Knowledge Base.`
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to delete Knowledge Base entry.' });
  }
});

// Update Catalog Content (Persisted to MySQL + catalog.json)
apiRouter.post('/store-management/catalog', requireStoreManagementAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { catalog } = req.body;
    if (!catalog) return res.status(400).json({ error: 'Catalog data is required' });

    const updatedCatalog = await db.saveCatalogAsync(catalog, req.user!.email);
    res.json({ success: true, catalog: updatedCatalog, message: 'Catalog updated successfully' });
  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : 'Failed to save catalog';
    const lower = msg.toLowerCase();
    const isValidationError =
      lower.includes('duplicate sku') ||
      lower.includes('cannot be empty') ||
      lower.includes('offer price') ||
      lower.includes('cannot exceed') ||
      lower.includes('mrp price') ||
      lower.includes('maximum 4 product images');
    res.status(isValidationError ? 400 : 500).json({ error: msg });
  }
});

// ==========================================
// 6. GATEWAY WEBHOOK INGESTION
// ==========================================
apiRouter.post('/webhooks/gateway', handleWebhookRequest);
