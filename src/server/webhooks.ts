/**
 * Webhook Ingestion & Idempotent Event Handlers
 * Handles: customer.created, order.placed, order.fulfilled, checkout.abandoned, refund.processed
 */

import crypto from 'crypto';
import { Request, Response } from 'express';
import { db } from './db.ts';
import { GatewayWebhookPayload } from '../types/index.ts';
import { safeCompareStrings } from './security.ts';

function isUnsignedTestWebhookAllowed(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    (process.env.NODE_ENV === 'test' || process.env.ALLOW_UNSIGNED_TEST_WEBHOOKS === 'true')
  );
}

/**
 * Verifies upstream gateway webhook signatures (Razorpay X-Razorpay-Signature or Stripe-Signature)
 * against the raw wire payload bytes. Rejects missing/invalid signatures unless test flag is enabled.
 */
export function verifyWebhookSignature(req: Request): {
  valid: boolean;
  provider?: 'RAZORPAY' | 'STRIPE' | 'TEST_BYPASS';
  reason?: string;
} {
  const rawBuf: Buffer = Buffer.isBuffer((req as any).rawBody)
    ? (req as any).rawBody
    : Buffer.from(JSON.stringify(req.body || {}), 'utf8');

  const rzpSigHeader = (req.header('x-razorpay-signature') || '').trim();
  const stripeSigHeader = (req.header('stripe-signature') || '').trim();

  if (rzpSigHeader) {
    const rzpSecret = (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
    if (!rzpSecret) {
      return { valid: false, reason: 'Razorpay webhook secret is not configured on the server.' };
    }
    const expectedHex = crypto.createHmac('sha256', rzpSecret).update(rawBuf).digest('hex');
    if (!safeCompareStrings(rzpSigHeader.toLowerCase(), expectedHex.toLowerCase())) {
      return { valid: false, reason: 'Invalid X-Razorpay-Signature.' };
    }
    return { valid: true, provider: 'RAZORPAY' };
  }

  if (stripeSigHeader) {
    const stripeSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    if (!stripeSecret) {
      return { valid: false, reason: 'Stripe webhook secret is not configured on the server.' };
    }

    const parts = stripeSigHeader.split(',').map(p => p.trim());
    let timestamp = '';
    const v1Signatures: string[] = [];
    for (const part of parts) {
      const eqIdx = part.indexOf('=');
      if (eqIdx <= 0) continue;
      const k = part.slice(0, eqIdx).trim();
      const v = part.slice(eqIdx + 1).trim();
      if (k === 't') timestamp = v;
      if (k === 'v1' && v) v1Signatures.push(v);
    }

    const parsedTs = Number(timestamp);
    if (!timestamp || !Number.isFinite(parsedTs) || v1Signatures.length === 0) {
      return { valid: false, reason: 'Malformed Stripe-Signature header.' };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - parsedTs) > 300) {
      return { valid: false, reason: 'Expired Stripe-Signature timestamp outside replay window.' };
    }

    const signedPayload = `${timestamp}.${rawBuf.toString('utf8')}`;
    const expectedHex = crypto.createHmac('sha256', stripeSecret).update(signedPayload).digest('hex');
    const matched = v1Signatures.some(sig => safeCompareStrings(sig.toLowerCase(), expectedHex.toLowerCase()));
    if (!matched) {
      return { valid: false, reason: 'Invalid Stripe-Signature.' };
    }
    return { valid: true, provider: 'STRIPE' };
  }

  if (isUnsignedTestWebhookAllowed()) {
    return { valid: true, provider: 'TEST_BYPASS' };
  }

  return {
    valid: false,
    reason: 'Missing webhook signature header (X-Razorpay-Signature or Stripe-Signature).'
  };
}

export interface WebhookResult {
  success: boolean;
  status: 'PROCESSED' | 'IGNORED_DUPLICATE' | 'FAILED_RETRY';
  eventId: string;
  event: string;
  message: string;
  details?: any;
}

export async function processWebhookEvent(payload: GatewayWebhookPayload): Promise<WebhookResult> {
  const { eventId, event, data, timestamp } = payload;

  if (!eventId) {
    throw new Error('Missing eventId in webhook payload');
  }

  // 1. Idempotency Check: prevent duplicate processing
  if (db.isWebhookProcessed(eventId)) {
    return {
      success: true,
      status: 'IGNORED_DUPLICATE',
      eventId,
      event,
      message: `Event ${eventId} has already been processed idempotently.`
    };
  }

  // 2. Dispatch by Event Type
  try {
    switch (event) {
      case 'customer.created': {
        const { customer, isNew } = await db.runAtomicMutation(() => {
          const res = db.findOrCreateCustomer({
            email: data.email,
            phone: data.phone,
            fullName: data.fullName || 'Patron',
            identityUid: data.identityUid || data.firebaseUid,
            utmSource: data.utmSource,
            utmMedium: data.utmMedium
          });
          db.markWebhookProcessed(eventId);
          db.logAudit(
            'webhook_gateway',
            'WEBHOOK_CUSTOMER_CREATED',
            'WEBHOOK_EVENT',
            `Processed ${event} for ${res.customer.email} (New: ${res.isNew})`
          );
          return res;
        });

        return {
          success: true,
          status: 'PROCESSED',
          eventId,
          event,
          message: `Customer ${customer.email} synchronized successfully.`,
          details: { customerId: customer.id, isNew }
        };
      }

      case 'order.placed': {
        // Create order atomically with SELECT ... FOR UPDATE row locking and push to ERP
        const order = await db.createOrderAsync({
          customerId: data.customerId || 'cust_guest',
          customerName: data.customerName || 'Valued Patron',
          customerEmail: data.customerEmail,
          customerPhone: data.customerPhone || '',
          status: 'PROCESSING',
          currency: 'INR',
          subtotal: data.subtotal,
          discountAmount: data.discountAmount || 0,
          discountCode: data.discountCode,
          taxAmount: data.taxAmount || Math.round(data.subtotal * 0.18),
          shippingFee: data.shippingFee || 0,
          totalAmount: data.totalAmount,
          paymentGateway: data.paymentGateway || 'RAZORPAY',
          paymentId: data.paymentId || `pay_rzp_${Date.now()}`,
          paymentStatus: 'PAID',
          items: data.items || [],
          shippingAddress: data.shippingAddress || {
            id: 'addr_temp',
            customerId: data.customerId,
            street: 'Koregaon Park Boulevard',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411001',
            country: 'India',
            isDefault: true,
            addressType: 'SHIPPING'
          },
          billingAddress: data.billingAddress || data.shippingAddress
        });

        await db.runAtomicMutation(() => {
          db.markWebhookProcessed(eventId);
          db.logAudit('webhook_gateway', 'WEBHOOK_ORDER_PLACED', 'WEBHOOK_EVENT', `Order ${order.orderNumber} ingested and pushed to ERP`);
        });

        return {
          success: true,
          status: 'PROCESSED',
          eventId,
          event,
          message: `Order ${order.orderNumber} processed and ERP inventory deducted.`,
          details: { orderNumber: order.orderNumber, total: order.totalAmount }
        };
      }

      case 'order.fulfilled': {
        const orderId = data.orderId || data.orderNumber;
        const updatedOrder = await db.runAtomicMutation(() => {
          const updated = db.updateOrderStatus(orderId, 'DISPATCHED', 'logistics_webhook');
          db.markWebhookProcessed(eventId);
          db.logAudit(
            'webhook_gateway',
            'WEBHOOK_ORDER_FULFILLED',
            'WEBHOOK_EVENT',
            `Order ${updated.orderNumber} dispatched with AWB ${updated.awbNumber}`
          );
          return updated;
        });

        return {
          success: true,
          status: 'PROCESSED',
          eventId,
          event,
          message: `Order ${updatedOrder.orderNumber} fulfilled with tracking AWB ${updatedOrder.awbNumber}.`,
          details: { orderNumber: updatedOrder.orderNumber, status: updatedOrder.status }
        };
      }

      case 'checkout.abandoned': {
        const cart = await db.runAtomicMutation(() => {
          const saved = db.saveCartState({
            id: data.cartId,
            email: data.email,
            phone: data.phone,
            items: data.items,
            subtotal: data.subtotal
          });
          saved.isAbandoned = true;
          saved.abandonedAt = timestamp || new Date().toISOString();
          saved.recoveryStage = 'DETECTED';

          db.markWebhookProcessed(eventId);
          db.logAudit(
            'webhook_gateway',
            'WEBHOOK_CHECKOUT_ABANDONED',
            'WEBHOOK_EVENT',
            `Cart ${saved.id} (${saved.email}) marked abandoned in CRM Kanban`
          );
          return saved;
        });

        return {
          success: true,
          status: 'PROCESSED',
          eventId,
          event,
          message: `Abandoned cart registered for ${cart.email}.`,
          details: { cartId: cart.id, subtotal: cart.subtotal }
        };
      }

      case 'refund.processed': {
        const orderId = data.orderId;
        const { orderNumber, creditNoteNumber } = await db.runAtomicMutation(() => {
          const order = db.getOrderById(orderId);
          if (!order) {
            throw new Error(`Order ${orderId} not found for refund`);
          }

          order.status = 'RETURNED';
          order.paymentStatus = 'REFUNDED';
          order.updatedAt = new Date().toISOString();

          // If GST invoicing enabled, issue GST Credit Note
          let cnNum: string | undefined;
          if (order.invoiceNumber && db.getConfig().gstInvoicingEnabled) {
            const cn = db.issueCreditNote(order.invoiceNumber, 'DEFECT_REFUND', 'webhook_gateway');
            cnNum = cn.creditNoteNumber;
          }

          db.markWebhookProcessed(eventId);
          db.logAudit(
            'webhook_gateway',
            'WEBHOOK_REFUND_PROCESSED',
            'WEBHOOK_EVENT',
            `Refund processed for order ${order.orderNumber}. Credit note: ${cnNum || 'N/A'}`
          );
          return { orderNumber: order.orderNumber, creditNoteNumber: cnNum };
        });

        return {
          success: true,
          status: 'PROCESSED',
          eventId,
          event,
          message: `Refund processed for ${orderNumber}.`,
          details: { orderNumber, creditNoteNumber }
        };
      }

      default:
        throw new Error(`Unsupported webhook event: ${event}`);
    }
  } catch (err: any) {
    db.logAudit('webhook_gateway', 'WEBHOOK_FAILED', 'WEBHOOK_EVENT', `Webhook ${eventId} (${event}) failed: ${err.message}`);
    return {
      success: false,
      status: 'FAILED_RETRY',
      eventId,
      event,
      message: err.message
    };
  }
}

/**
 * Express handler for POST /api/webhooks/gateway
 */
export async function handleWebhookRequest(req: Request, res: Response) {
  const sigCheck = verifyWebhookSignature(req);
  if (!sigCheck.valid) {
    db.logAudit(
      'webhook_gateway',
      'WEBHOOK_SIGNATURE_REJECTED',
      'WEBHOOK_EVENT',
      `Rejected unsigned or forged webhook on ${req.originalUrl}: ${sigCheck.reason}`,
      req.ip
    );
    return res.status(401).json({
      error: 'INVALID_WEBHOOK_SIGNATURE',
      message: sigCheck.reason || 'Webhook signature verification failed.'
    });
  }

  const payload = req.body as GatewayWebhookPayload;

  if (!payload || !payload.eventId || !payload.event) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'Invalid webhook payload structure' });
  }

  const result = await processWebhookEvent(payload);

  if (result.status === 'FAILED_RETRY') {
    // Return 500 so upstream gateway (Razorpay/Stripe) initiates retry
    return res.status(500).json(result);
  }

  return res.status(200).json(result);
}
