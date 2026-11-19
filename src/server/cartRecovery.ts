/**
 * Abandoned Cart Persistence & Autonomous Recovery Engine
 * Runs background sweeps for idle carts, persists guest/patron states, and triggers idempotent recovery.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db } from './db.ts';
import { CartRecord } from '../types/index.ts';

export type CartResumeResolution =
  | { status: 'OK'; cart: CartRecord; tokenVerified: boolean }
  | { status: 'NOT_FOUND'; tokenVerified: false }
  | { status: 'INVALID_TOKEN'; tokenVerified: false };

export class CartRecoveryEngine {
  private intervalTimer: NodeJS.Timeout | null = null;
  private cachedSecret: string | null = null;

  private getSigningSecret(): string {
    if (process.env.CART_RECOVERY_SECRET) {
      return process.env.CART_RECOVERY_SECRET;
    }
    if (this.cachedSecret) {
      return this.cachedSecret;
    }

    const secretPath = path.resolve(process.cwd(), 'src/server/data/.cart_recovery_key');
    try {
      if (fs.existsSync(secretPath)) {
        const stored = fs.readFileSync(secretPath, 'utf-8').trim();
        if (stored.length >= 32) {
          this.cachedSecret = stored;
          return stored;
        }
      }
      const generated = crypto.randomBytes(32).toString('hex');
      const dir = path.dirname(secretPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(secretPath, generated, { encoding: 'utf-8', mode: 0o600 });
      this.cachedSecret = generated;
      return generated;
    } catch {
      this.cachedSecret = crypto.createHash('sha256').update('bvl-cart-fallback-secret').digest('hex');
      return this.cachedSecret;
    }
  }

  public signResumeToken(cartId: string): string {
    return crypto
      .createHmac('sha256', this.getSigningSecret())
      .update(`resume:${cartId}`)
      .digest('base64url');
  }

  public verifyResumeToken(cartId: string, token: string): boolean {
    if (!cartId || !token || typeof token !== 'string') return false;
    const expected = this.signResumeToken(cartId);
    const actualBuf = Buffer.from(token);
    const expectedBuf = Buffer.from(expected);
    if (actualBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(actualBuf, expectedBuf);
  }

  public buildCheckoutResumeUrl(cartId: string): string {
    const token = this.signResumeToken(cartId);
    return `/?resume=${encodeURIComponent(cartId)}&token=${encodeURIComponent(token)}`;
  }

  public resolveCartRecipient(cartId: string): {
    cart: CartRecord;
    email: string;
    phone: string;
    inCooldown: boolean;
  } {
    const cart = db.getCartById(cartId);
    if (!cart) {
      throw new Error(`Cart ${cartId} not found`);
    }
    const matchedCustomer =
      (cart.customerId ? db.getCustomerById(cart.customerId) : undefined) ||
      (cart.email ? db.getCustomerById(cart.email) : undefined);

    const resolvedEmail = (cart.email || matchedCustomer?.email || '').trim();
    const resolvedPhone = (cart.phone || matchedCustomer?.phone || '').trim();
    const twoHoursMs = 2 * 60 * 60 * 1000;
    const inCooldown = Boolean(
      cart.lastRecoveryTriggerAt && Date.now() - new Date(cart.lastRecoveryTriggerAt).getTime() < twoHoursMs
    );

    return {
      cart: {
        ...cart,
        email: resolvedEmail || cart.email,
        phone: resolvedPhone || cart.phone,
        checkoutUrl: this.buildCheckoutResumeUrl(cart.id)
      },
      email: resolvedEmail,
      phone: resolvedPhone,
      inCooldown
    };
  }

  /**
   * Starts the background abandonment detection worker.
   * Sweeps every 60 seconds (or uses the configurable threshold).
   */
  public startBackgroundWorker(intervalMs: number = 60000) {
    if (this.intervalTimer) return;

    this.intervalTimer = setInterval(() => {
      this.runAbandonmentDetectionSweep();
    }, intervalMs);

    console.log(`[CartRecoveryEngine] Background worker running (sweep interval: ${intervalMs / 1000}s)`);
  }

  public stopBackgroundWorker() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  /**
   * Scans all carts in the relational store.
   * If a cart has items, has not placed an order, and is idle beyond the threshold,
   * flags it as abandoned and emits a checkout.abandoned event.
   */
  public runAbandonmentDetectionSweep(): { detectedCount: number; carts: CartRecord[] } {
    const config = db.getConfig();
    const thresholdMinutes = config.abandonmentThresholdMinutes || 15;
    const abandonedCarts = db.detectAbandonedCarts(thresholdMinutes);

    for (const c of abandonedCarts) {
      c.checkoutUrl = this.buildCheckoutResumeUrl(c.id);
    }

    if (abandonedCarts.length > 0) {
      console.log(`[CartRecoveryEngine] Sweep flagged ${abandonedCarts.length} abandoned cart(s)`);
    }

    return {
      detectedCount: abandonedCarts.length,
      carts: abandonedCarts
    };
  }

  /**
   * Persists cart state from storefront (patron or guest) with signed resume link
   */
  public persistStorefrontCart(data: {
    cartId?: string;
    customerId?: string;
    email: string;
    phone?: string;
    items: any[];
    subtotal: number;
  }): CartRecord {
    const saved = db.saveCartState(data);
    saved.checkoutUrl = this.buildCheckoutResumeUrl(saved.id);
    db.persistState();
    return saved;
  }

  /**
   * Idempotent recovery dispatcher for a specific cart
   */
  public dispatchRecoveryMessage(cartId: string, channel: 'EMAIL' | 'WHATSAPP') {
    const res = db.triggerCartRecovery(cartId, channel);
    res.cart.checkoutUrl = this.buildCheckoutResumeUrl(res.cart.id);
    db.persistState();
    return res;
  }

  /**
   * Resolves a resumable cart by cart ID and optional HMAC token.
   * Supports direct cart ID links as well as signed resume tokens; rejects tampered tokens.
   */
  public resolveResumableCart(cartId: string, token?: string): CartResumeResolution {
    const cleanId = (cartId || '').trim();
    if (!cleanId) {
      return { status: 'NOT_FOUND', tokenVerified: false };
    }

    let tokenVerified = false;
    if (token !== undefined && token !== '') {
      if (!this.verifyResumeToken(cleanId, token.trim())) {
        return { status: 'INVALID_TOKEN', tokenVerified: false };
      }
      tokenVerified = true;
    }

    const cart = db.getCartById(cleanId);
    if (!cart) {
      return { status: 'NOT_FOUND', tokenVerified: false };
    }

    return {
      status: 'OK',
      cart: {
        ...cart,
        checkoutUrl: this.buildCheckoutResumeUrl(cart.id)
      },
      tokenVerified
    };
  }
}

export const cartRecovery = new CartRecoveryEngine();
