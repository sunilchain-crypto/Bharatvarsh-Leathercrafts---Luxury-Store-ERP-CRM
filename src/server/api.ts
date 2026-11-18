/**
 * RESTful API Routes for Bharatvarsh Leathercrafts LLP
 * Enforces server-side RBAC on all admin/CRM/ERP/Store Management endpoints.
 */

import express, { Request, Response } from 'express';
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
import {
  validateIndianCheckoutFields,
  validateIndianPhone,
  validateIndianPincode,
  validateEmailAddress,
  normalizeIndianState
} from '../lib/indianValidation.ts';

export const apiRouter = express.Router();

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
apiRouter.post('/checkout/validate-promo', (req: Request, res: Response) => {
  const { code, subtotal } = req.body || {};
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
      const unitPrice = prod ? Number(prod.price) : 0;
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
      paymentGateway
    } = req.body;

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

      const unitPrice = Number(product.price);
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

    // Fire-and-forget transactional confirmation + care guide dispatch
    dispatchOrderConfirmationAndCareGuide(order)
      .then((delivery) => {
        db.logAudit(
          'integrations',
          'ORDER_NOTIFICATION_DISPATCHED',
          'STORE_MANAGEMENT',
          `Order ${order.orderNumber} notifications -> Payment:${gatewayResult.mode}, Email:${delivery.emailDelivery.mode}, WhatsApp:${delivery.whatsappDelivery.mode}`
        );
      })
      .catch(() => {});

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
    const { email, password, fullName, phone, street, city, state, pincode, country, address } = req.body || {};
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
    const { email, password } = req.body;
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

// Google Firebase ID Token Exchange Endpoint
apiRouter.post('/auth/firebase', async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body;
    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({ error: 'Authentication token is required' });
    }

    const claims = await verifyFirebaseIdToken(idToken);
    if (!claims || !claims.email) {
      return res.status(401).json({ error: 'Invalid or expired Google authentication token.' });
    }

    const cleanEmail = claims.email.trim().toLowerCase();
    const isAuthorizedAdmin = db.isStoreManagementAuthorized(cleanEmail);
    const isMaster = db.isMasterAuthorized(cleanEmail);
    const resolvedRole = isAuthorizedAdmin ? db.getStaffRole(cleanEmail) : 'PATRON';

    const { customer } = await db.runAtomicMutation(() =>
      db.findOrCreateCustomer({
        email: cleanEmail,
        fullName: claims.name || cleanEmail.split('@')[0],
        identityUid: claims.uid,
        role: resolvedRole
      })
    );

    res.json({
      success: true,
      token: idToken,
      user: {
        uid: claims.uid,
        email: customer.email,
        name: claims.name || customer.fullName,
        role: resolvedRole,
        isMasterAdmin: isMaster,
        isStoreManagementAuthorized: isAuthorizedAdmin,
        photoURL: claims.picture,
        authProvider: 'GOOGLE'
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
    const { cartId, channel } = req.body;
    const chosenChannel: 'EMAIL' | 'WHATSAPP' = channel === 'WHATSAPP' ? 'WHATSAPP' : 'EMAIL';
    const result = await db.runAtomicMutation(() => cartRecovery.dispatchRecoveryMessage(cartId, chosenChannel));

    let delivery: any = null;
    if (result.success) {
      const activePromo = (db.getConfig().promoCodes || []).find(p => p.active)?.code || 'HEIRLOOM10';
      const baseAppUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
      const fullCheckoutUrl = result.cart.checkoutUrl.startsWith('http')
        ? result.cart.checkoutUrl
        : `${baseAppUrl}${result.cart.checkoutUrl}`;
      delivery = await dispatchCartRecoveryNotice(result.cart, chosenChannel, activePromo, fullCheckoutUrl);
    }

    res.json({ ...result, delivery });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

// ==========================================
// 3. ERP & SUPPLY CHAIN ENDPOINTS (STORE_MANAGER | LOGISTICS_COORDINATOR)
// ==========================================

apiRouter.get('/erp/inventory', requireErpAccess, (req: AuthenticatedRequest, res: Response) => {
  const inventory = db.getInventory();
  const bom = db.getBillOfMaterials();
  const lowStockAlerts = db.getLowStockAlerts();
  res.json({ success: true, inventory, billOfMaterials: bom, lowStockAlerts });
});

// Permanent Inventory Stock Adjustment (Row-locked in MySQL)
apiRouter.post('/erp/inventory/adjust', requireErpAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sku, location, newQty } = req.body;
    const updated = await db.updateInventoryStockAsync(sku, location, newQty, req.user!.email);
    res.json({ success: true, inventoryItem: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    integrations
  });
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

// Update Catalog Content (Persisted to MySQL + catalog.json)
apiRouter.post('/store-management/catalog', requireStoreManagementAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { catalog } = req.body;
    if (!catalog) return res.status(400).json({ error: 'Catalog data is required' });

    const updatedCatalog = await db.saveCatalogAsync(catalog, req.user!.email);
    res.json({ success: true, catalog: updatedCatalog, message: 'Catalog updated successfully' });
  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : 'Failed to save catalog';
    const isValidationError =
      msg.toLowerCase().includes('duplicate sku') || msg.toLowerCase().includes('cannot be empty');
    res.status(isValidationError ? 400 : 500).json({ error: msg });
  }
});

// ==========================================
// 6. GATEWAY WEBHOOK INGESTION
// ==========================================
apiRouter.post('/webhooks/gateway', handleWebhookRequest);
