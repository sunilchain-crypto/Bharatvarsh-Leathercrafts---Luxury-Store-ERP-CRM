/**
 * ERP Synchronization & Supply Chain Layer
 * Handles bi-directional inventory, RMA lifecycle, custom quote to Sales Order push, and courier milestones.
 */

import { db } from './db.ts';
import { Order, OrderItem, GSTCreditNote } from '../types/index.ts';
import { dispatchOrderConfirmationAndCareGuide } from './integrations.ts';

export interface CustomQuotePayload {
  leadId?: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  items?: Array<{
    productId?: string;
    productName?: string;
    sku: string;
    quantity: number;
    unitPrice?: number;
    leatherType?: 'VEGETABLE_TANNED_HERITAGE' | 'BIO_SUBSTITUTE_CACTUS';
    monogramInitials?: string;
    foilType?: 'BLIND' | 'GOLD_FOIL' | 'SILVER_FOIL';
  }>;
  dealType?: 'WHOLESALE_BULK' | 'CUSTOM_BESPOKE' | 'VIP_CONCIERGE';
  notes?: string;
}

export interface RMAPayload {
  orderId: string;
  customerId: string;
  reason: 'COLOR_MISMATCH' | 'TEXTURE_DEFECT' | 'HARDWARE_DAMAGE' | 'INCORRECT_SIZE';
  inspectionNotes?: string;
  restockInWarehouse: boolean;
  restockLocation?: 'punePrimaryHub' | 'mumbaiWarehouse';
  actorEmail: string;
}

export class ERPSynchronizer {
  /**
   * Pushes a custom quote / B2B corporate gifting lead directly into the ERP as an official Sales Order
   */
  public async pushCustomQuoteToSalesOrder(payload: CustomQuotePayload, actorEmail: string): Promise<Order> {
    const linkedLead = payload.leadId
      ? db.getCorporateGiftingLeads().find(l => l.id === payload.leadId)
      : undefined;

    if (payload.leadId && !linkedLead) {
      throw new Error(`Corporate gifting lead "${payload.leadId}" not found.`);
    }

    if (linkedLead?.erpOrderId) {
      throw new Error(
        `DUPLICATE_ERP_ORDER: Corporate lead "${linkedLead.companyName}" is already linked to ERP Sales Order ${linkedLead.erpOrderNumber || linkedLead.erpOrderId}.`
      );
    }

    const rawItems =
      Array.isArray(payload.items) && payload.items.length > 0
        ? payload.items
        : Array.isArray(linkedLead?.items) && linkedLead!.items!.length > 0
        ? linkedLead!.items!
        : [];

    if (rawItems.length === 0) {
      throw new Error('At least one catalog SKU and quantity must be selected before pushing to ERP Sales Order.');
    }

    const catalogProducts = db.getCatalog().products || [];
    const storeDefaultGstRate = (typeof db.getConfig().gstRatePercent === 'number' ? db.getConfig().gstRatePercent : 18) / 100;

    let subtotal = 0;
    let totalTaxAmount = 0;

    const orderItems: OrderItem[] = rawItems.map((item, idx) => {
      const matchedProduct = catalogProducts.find(
        (p: any) => (item.productId && p.id === item.productId) || (item.sku && p.sku === item.sku)
      );
      if (!matchedProduct && !item.productId && typeof item.unitPrice !== 'number') {
        throw new Error(`Unknown catalog SKU in quote: ${item.sku}`);
      }

      const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
      const resolvedUnitPrice =
        typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice) && item.unitPrice > 0
          ? item.unitPrice
          : Number(matchedProduct?.price || 0);

      if (!Number.isFinite(resolvedUnitPrice) || resolvedUnitPrice <= 0) {
        throw new Error(`Invalid unit price for SKU ${item.sku}`);
      }

      const gstRate =
        typeof matchedProduct?.gstRate === 'number' ? matchedProduct.gstRate : storeDefaultGstRate;
      const lineSubtotal = qty * resolvedUnitPrice;
      const lineTax = Math.round(lineSubtotal * gstRate);
      subtotal += lineSubtotal;
      totalTaxAmount += lineTax;

      return {
        id: `item_quote_${Date.now()}_${idx}`,
        orderId: '',
        productId: item.productId || matchedProduct?.id || `prod_${item.sku}`,
        productName: item.productName || matchedProduct?.name || item.sku,
        sku: matchedProduct?.sku || item.sku,
        category: matchedProduct?.category || 'travell',
        quantity: qty,
        unitPrice: resolvedUnitPrice,
        leatherType:
          item.leatherType === 'BIO_SUBSTITUTE_CACTUS'
            ? 'BIO_SUBSTITUTE_CACTUS'
            : 'VEGETABLE_TANNED_HERITAGE',
        customization: item.monogramInitials
          ? {
              monogramInitials: item.monogramInitials,
              foilType: item.foilType || 'GOLD_FOIL',
              placement: 'Custom Specification'
            }
          : undefined,
        hsnCode: matchedProduct?.hsnCode || '4202',
        gstRate,
        taxAmount: lineTax,
        lineTotal: lineSubtotal + lineTax
      };
    });

    const totalAmount = subtotal + totalTaxAmount;

    const resolvedEmail = (payload.customerEmail || linkedLead?.email || '').trim().toLowerCase();
    const resolvedName =
      payload.customerName ||
      (linkedLead ? `${linkedLead.companyName} (${linkedLead.contactPerson})` : 'Corporate Patron');
    const resolvedPhone = payload.customerPhone || linkedLead?.phone || '';

    let resolvedCustomerId = payload.customerId;
    if (!resolvedCustomerId && resolvedEmail) {
      const { customer } = await db.runAtomicMutation(() =>
        db.findOrCreateCustomer({
          email: resolvedEmail,
          phone: resolvedPhone,
          fullName: resolvedName
        })
      );
      resolvedCustomerId = customer.id;
    }

    const customerIdFinal = resolvedCustomerId || `cust_corp_${Date.now()}`;

    const newOrder = await db.createOrderAsync({
      customerId: customerIdFinal,
      customerName: resolvedName,
      customerEmail: resolvedEmail || 'corporate@bharatvarshcrafts.com',
      customerPhone: resolvedPhone,
      status: 'PROCESSING',
      currency: 'INR',
      subtotal,
      discountAmount: 0,
      taxAmount: totalTaxAmount,
      shippingFee: 0,
      totalAmount,
      paymentGateway: 'RAZORPAY',
      paymentId: `quote_pay_${Date.now()}`,
      paymentStatus: 'PAID',
      items: orderItems,
      shippingAddress: {
        id: `addr_quote_${Date.now()}`,
        customerId: customerIdFinal,
        street: 'Consolidated Commercial Dock, Pune Primary Hub',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
        country: 'India',
        isDefault: true,
        addressType: 'SHIPPING'
      },
      billingAddress: {
        id: `addr_quote_b_${Date.now()}`,
        customerId: customerIdFinal,
        street: 'Consolidated Commercial Dock, Pune Primary Hub',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
        country: 'India',
        isDefault: true,
        addressType: 'BILLING'
      }
    });

    await db.runAtomicMutation(() => {
      if (payload.leadId) {
        db.updateCorporateLeadStatus(payload.leadId, 'ORDER_CONFIRMED', undefined, {
          erpOrderId: newOrder.id,
          erpOrderNumber: newOrder.orderNumber,
          items: orderItems.map(it => ({
            sku: it.sku,
            productId: it.productId,
            productName: it.productName,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            leatherType: it.leatherType
          })),
          dealValueInr: totalAmount
        });
      }
      db.logAudit(
        actorEmail,
        'ERP_SALES_ORDER_PUSH',
        'STORE_MANAGEMENT',
        `CRM quote converted into ERP Sales Order ${newOrder.orderNumber} (Deal: ${payload.dealType || 'WHOLESALE_BULK'}, Amount: ₹${totalAmount}${
          linkedLead ? `, Lead: ${linkedLead.companyName}` : ''
        })`
      );
    });

    // Async transactional email with PDF invoice to Support@bharatvarshcrafts.com & patron
    dispatchOrderConfirmationAndCareGuide(newOrder)
      .then((delivery) => {
        db.logAudit(
          'integrations',
          'ORDER_NOTIFICATION_DISPATCHED',
          'STORE_MANAGEMENT',
          `ERP Order ${newOrder.orderNumber} notifications -> PatronEmail:${delivery.emailDelivery.mode}, SupportInvoice:${delivery.supportEmailDelivery.mode}, WhatsApp:${delivery.whatsappDelivery.mode}`
        );
      })
      .catch((err: any) => {
        db.logAudit(
          'integrations',
          'ORDER_NOTIFICATION_ERROR',
          'STORE_MANAGEMENT',
          `Failed order notification dispatch for ${newOrder.orderNumber}: ${err?.message || err}`
        );
      });

    return newOrder;
  }

  /**
   * RMA & Return Lifecycle with warehouse inspection & credit note generation
   */
  public async processRMA(rma: RMAPayload): Promise<{ order: Order; creditNote?: GSTCreditNote }> {
    const existingOrder = db.getOrderById(rma.orderId);
    if (!existingOrder) throw new Error(`Order ${rma.orderId} not found`);

    const targetLocation: 'punePrimaryHub' | 'mumbaiWarehouse' =
      rma.restockLocation === 'mumbaiWarehouse' ? 'mumbaiWarehouse' : 'punePrimaryHub';
    const locationLabel = targetLocation === 'punePrimaryHub' ? 'Pune Primary Hub' : 'Mumbai Warehouse';

    const lockItems = rma.restockInWarehouse
      ? existingOrder.items.map(it => ({
          sku: it.sku,
          productId: it.productId,
          productName: it.productName,
          quantity: it.quantity
        }))
      : [];

    return db.runLockedStockMutation(lockItems, () => {
      const order = db.getOrderById(rma.orderId);
      if (!order) throw new Error(`Order ${rma.orderId} not found`);

      order.status = 'RETURNED';
      order.paymentStatus = 'REFUNDED';
      order.updatedAt = new Date().toISOString();

      // Restock in inspected warehouse hub if approved
      if (rma.restockInWarehouse) {
        for (const item of order.items) {
          const inv = db.getInventory().find(i => i.productId === item.productId || i.sku === item.sku);
          if (inv) {
            inv.stockByLocation[targetLocation] += item.quantity;
            db.logAudit(
              rma.actorEmail,
              'RESTOCK_INVENTORY',
              'INVENTORY_ADJUSTMENT',
              `Restocked ${item.quantity} units of ${inv.sku} to ${locationLabel} after RMA inspection.`
            );
          }
        }
      }

      // Generate GST Credit note if enabled
      let creditNote: GSTCreditNote | undefined;
      if (order.invoiceNumber && db.getConfig().gstInvoicingEnabled) {
        creditNote = db.issueCreditNote(order.invoiceNumber, 'GOODS_RETURN', rma.actorEmail);
      }

      db.logAudit(
        rma.actorEmail,
        'RMA_PROCESSED',
        'STORE_MANAGEMENT',
        `RMA concluded for ${order.orderNumber} (Reason: ${rma.reason}). Credit Note: ${creditNote ? creditNote.creditNoteNumber : 'SUSPENDED'}`
      );

      return { order, creditNote };
    });
  }

  /**
   * Syncs real-time courier milestones (In Transit, Out for Delivery, Delivered, RTO) from Shiprocket / Delhivery
   */
  public async syncCourierMilestone(
    orderId: string,
    milestone: 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'RTO',
    locationName: string
  ): Promise<Order> {
    return db.runAtomicMutation(() => {
      const order = db.getOrderById(orderId);
      if (!order) throw new Error(`Order ${orderId} not found`);

      order.courierStatus = milestone;
      if (milestone === 'DELIVERED') {
        order.status = 'DELIVERED';
      }
      order.updatedAt = new Date().toISOString();

      db.logAudit(
        'logistics_sync',
        'COURIER_MILESTONE_UPDATED',
        'STORE_MANAGEMENT',
        `Order ${order.orderNumber} AWB ${order.awbNumber}: Milestone changed to ${milestone} at ${locationName}`
      );

      return order;
    });
  }
}

export const erpSync = new ERPSynchronizer();
