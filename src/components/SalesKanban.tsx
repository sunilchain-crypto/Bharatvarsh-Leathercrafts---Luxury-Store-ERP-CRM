import React, { useState, useEffect } from 'react';
import { Sparkles, Clock, Plus, AlertCircle, PackageCheck, Trash2 } from 'lucide-react';
import { CorporateGiftingLead, CorporateGiftingLeadItem, CartRecord } from '../types/index.ts';

interface CatalogProductOption {
  id: string;
  sku: string;
  name: string;
  price: number;
  stockCount?: number;
}

interface SalesKanbanProps {
  authToken: string;
  canPushToErp?: boolean;
}

export const SalesKanban: React.FC<SalesKanbanProps> = ({ authToken, canPushToErp = true }) => {
  const [pipeline, setPipeline] = useState<{
    corporateLeads: CorporateGiftingLead[];
    abandonedCarts: CartRecord[];
  }>({ corporateLeads: [], abandonedCarts: [] });
  const [catalogProducts, setCatalogProducts] = useState<CatalogProductOption[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [triggeringCartId, setTriggeringCartId] = useState<string | null>(null);
  const [recoveryFeedback, setRecoveryFeedback] = useState<{ type: 'success' | 'warning' | 'info' | 'error'; message: string } | null>(null);

  // New Lead Modal state
  const [showAddLead, setShowAddLead] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [quantity, setQuantity] = useState(10);
  const [dealValue, setDealValue] = useState(42000);
  const [interestCategory, setInterestCategory] = useState<'TRANSIT_FOLIOS' | 'EVERYDAY_CARRY'>('TRANSIT_FOLIOS');
  const [newLeadItems, setNewLeadItems] = useState<CorporateGiftingLeadItem[]>([]);

  // Push to ERP Sales Order Confirmation Modal state
  const [pushModalLead, setPushModalLead] = useState<CorporateGiftingLead | null>(null);
  const [pushItems, setPushItems] = useState<CorporateGiftingLeadItem[]>([]);
  const [isPushingOrder, setIsPushingOrder] = useState(false);

  const fetchPipeline = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/crm/kanban', {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (data.success) {
        setPipeline(data.pipeline);
      }
    } catch (e) {
      console.warn('Failed to load Kanban', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetch('/api/catalog')
      .then(r => r.json())
      .then(data => {
        if (data?.success && Array.isArray(data.catalog?.products)) {
          setCatalogProducts(data.catalog.products);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (authToken) {
      fetchPipeline();
    }
  }, [authToken]);

  const handleTriggerRecovery = async (cartId: string, channel: 'EMAIL' | 'WHATSAPP') => {
    setTriggeringCartId(cartId);
    try {
      const res = await fetch('/api/crm/cart-recovery/trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ cartId, channel })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setRecoveryFeedback({
          type: 'error',
          message: data.error || data.message || `Recovery ${channel.toLowerCase()} dispatch failed.`
        });
        return;
      }

      const mode = data.deliveryMode || data.delivery?.mode || 'SANDBOX_FALLBACK';
      const msgId = data.messageId || data.delivery?.messageId || '';
      const reason = data.fallbackReason || data.delivery?.fallbackReason || '';

      if (mode === 'LIVE') {
        setRecoveryFeedback({
          type: 'success',
          message: `LIVE ${channel} dispatched to ${data.cart?.email || 'patron'} (Message ID: ${msgId}). Card moved to Email Dispatched.`
        });
      } else {
        setRecoveryFeedback({
          type: 'warning',
          message: `Card updated in SANDBOX_FALLBACK mode${reason ? ` (${reason})` : ''}. Configure SMTP_HOST / SMTP_USER / SMTP_PASS to deliver live emails.`
        });
      }

      await fetchPipeline();
      setTimeout(() => setRecoveryFeedback(null), 7000);
    } catch (e: any) {
      setRecoveryFeedback({ type: 'error', message: 'Recovery dispatch failed: ' + e.message });
    } finally {
      setTriggeringCartId(null);
    }
  };

  const handleRunSweep = async () => {
    try {
      const res = await fetch('/api/crm/cart/detect-sweep', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await res.json();
      setRecoveryFeedback({ type: 'info', message: `Sweep finished: ${data.detectedCount} new idle carts flagged.` });
      fetchPipeline();
      setTimeout(() => setRecoveryFeedback(null), 5000);
    } catch (e: any) {
      setRecoveryFeedback({ type: 'error', message: 'Sweep failed: ' + e.message });
    }
  };

  const openNewLeadModal = () => {
    const firstProd = catalogProducts[0];
    if (firstProd) {
      setNewLeadItems([
        {
          sku: firstProd.sku,
          productId: firstProd.id,
          productName: firstProd.name,
          quantity: 10,
          unitPrice: firstProd.price,
          leatherType: 'VEGETABLE_TANNED_HERITAGE'
        }
      ]);
      setQuantity(10);
      setDealValue(firstProd.price * 10);
    } else {
      setNewLeadItems([]);
    }
    setShowAddLead(true);
  };

  const handleAddLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/crm/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          companyName,
          contactPerson,
          email: leadEmail,
          phone: leadPhone,
          estimatedQuantity: quantity,
          budgetRangeInr: `₹${dealValue.toLocaleString('en-IN')}`,
          interestCategory,
          status: 'NEW_LEAD',
          items: newLeadItems.length > 0 ? newLeadItems : undefined,
          dealValueInr: dealValue,
          notes: 'Added through concierge sales pipeline'
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowAddLead(false);
        setCompanyName('');
        setContactPerson('');
        setLeadEmail('');
        setLeadPhone('');
        fetchPipeline();
      } else {
        setRecoveryFeedback({ type: 'error', message: data.error || 'Failed to add lead' });
      }
    } catch (e: any) {
      setRecoveryFeedback({ type: 'error', message: 'Failed to add lead: ' + e.message });
    }
  };

  const handleUpdateLeadStatus = async (leadId: string, nextStatus: CorporateGiftingLead['status']) => {
    try {
      const res = await fetch(`/api/crm/leads/${leadId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          status: nextStatus,
          swatchKitAwb: nextStatus === 'SWATCH_DISPATCHED' ? `SR-SWATCH-${Math.floor(100000 + Math.random() * 900000)}` : undefined
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRecoveryFeedback({ type: 'error', message: data.error || 'Failed to update stage' });
        return;
      }
      fetchPipeline();
    } catch (e: any) {
      setRecoveryFeedback({ type: 'error', message: 'Failed to update stage: ' + e.message });
    }
  };

  const openPushToErpModal = (lead: CorporateGiftingLead) => {
    if (!canPushToErp) {
      setRecoveryFeedback({
        type: 'error',
        message: 'Pushing corporate quotes to ERP Sales Orders requires Store Manager or Logistics Coordinator privileges.'
      });
      return;
    }
    if (lead.erpOrderId) {
      setRecoveryFeedback({
        type: 'error',
        message: `Lead "${lead.companyName}" already has ERP Order ${lead.erpOrderNumber || lead.erpOrderId}.`
      });
      return;
    }
    if (Array.isArray(lead.items) && lead.items.length > 0) {
      setPushItems(lead.items.map(it => ({ ...it })));
    } else {
      const defaultProd = catalogProducts[0];
      setPushItems(
        defaultProd
          ? [
              {
                sku: defaultProd.sku,
                productId: defaultProd.id,
                productName: defaultProd.name,
                quantity: Math.max(1, Math.min(lead.estimatedQuantity || 1, defaultProd.stockCount || 1)),
                unitPrice: defaultProd.price,
                leatherType: 'VEGETABLE_TANNED_HERITAGE'
              }
            ]
          : []
      );
    }
    setPushModalLead(lead);
  };

  const handleConfirmPushToErp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pushModalLead || isPushingOrder || pushItems.length === 0) return;

    setIsPushingOrder(true);
    try {
      const res = await fetch('/api/erp/quotes/push-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          leadId: pushModalLead.id,
          dealType: 'WHOLESALE_BULK',
          items: pushItems
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setRecoveryFeedback({ type: 'error', message: data.error || data.message || 'ERP order creation failed.' });
        return;
      }
      setPushModalLead(null);
      setRecoveryFeedback({
        type: 'info',
        message: `Created ERP Sales Order ${data.order.orderNumber} (₹${data.order.totalAmount.toLocaleString('en-IN')}), deducted Pune/Mumbai stock & BOM inputs, and issued GST invoice ${data.order.invoiceNumber || ''}.`
      });
      fetchPipeline();
    } catch (e: any) {
      setRecoveryFeedback({ type: 'error', message: 'Failed to push ERP order: ' + e.message });
    } finally {
      setIsPushingOrder(false);
    }
  };

  const leadsByStage = {
    NEW_LEAD: pipeline.corporateLeads.filter((l) => l.status === 'NEW_LEAD'),
    SWATCH_DISPATCHED: pipeline.corporateLeads.filter((l) => l.status === 'SWATCH_DISPATCHED'),
    QUOTE_ISSUED: pipeline.corporateLeads.filter((l) => l.status === 'QUOTE_ISSUED'),
    ORDER_CONFIRMED: pipeline.corporateLeads.filter((l) => l.status === 'ORDER_CONFIRMED' || l.status === 'FULFILLED')
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-[#221C16]/10">
        <div>
          <span className="text-xs font-mono uppercase tracking-widest text-[#8B4513]">
            Strategy & Value Creation
          </span>
          <h1 className="font-display text-3xl font-bold text-[#16120E] mt-1">
            Concierge & Corporate Gifting Pipeline
          </h1>
          <p className="text-xs text-[#5C4D3E] mt-1">
            B2B institutional orders, sample leather swatch dispatches, and automated abandoned cart recovery Kanban board.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRunSweep}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#221C16] border border-[#221C16]/15 rounded hover:bg-white"
            title="Scan for idle carts past 15 min threshold"
          >
            <Clock className="w-3.5 h-3.5 text-[#8B4513]" />
            <span>Scan Abandoned Carts</span>
          </button>

          <button
            onClick={openNewLeadModal}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22]"
          >
            <Plus className="w-4 h-4 text-[#C5A059]" />
            <span>New Enterprise Lead</span>
          </button>
        </div>
      </div>

      {/* Notice Feedback Banner */}
      {recoveryFeedback && (
        <div
          className={`p-3 border rounded-lg text-xs font-medium flex items-center justify-between gap-2 ${
            recoveryFeedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : recoveryFeedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : recoveryFeedback.type === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-[#EBE4D5]/80 border-[#8B4513]/30 text-[#16120E]'
          }`}
        >
          <div className="flex items-center gap-2">
            {recoveryFeedback.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
            ) : (
              <Sparkles className="w-4 h-4 text-[#8B4513] shrink-0" />
            )}
            <span>{recoveryFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setRecoveryFeedback(null)}
            className="text-[11px] opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* SECTION A: Abandoned Carts Kanban Board */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-[#16120E] flex items-center gap-2">
            <span>Abandoned Checkout Recovery Board</span>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-[#FAF7F2] border text-[#8B4513]">
              {pipeline.abandonedCarts.length} idle checkouts
            </span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Stage 1: Detected */}
          <div className="bg-white rounded-xl border border-[#221C16]/10 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[#16120E] pb-2 border-b">
              <span>01. Idle Detected</span>
              <span className="font-mono text-[10px] text-[#5C4D3E]">
                {pipeline.abandonedCarts.filter((c) => c.recoveryStage === 'DETECTED').length}
              </span>
            </div>

            <div className="space-y-3">
              {pipeline.abandonedCarts
                .filter((c) => c.recoveryStage === 'DETECTED')
                .map((cart) => (
                  <div key={cart.id} className="p-3 rounded-lg bg-[#FAF7F2] border border-[#221C16]/10 space-y-2 text-xs">
                    <div className="font-semibold text-[#16120E] truncate">{cart.email}</div>
                    <div className="text-[11px] text-[#5C4D3E]">
                      {cart.items.length} item(s) · <span className="font-mono font-bold text-[#16120E]">₹{cart.subtotal.toLocaleString('en-IN')}</span>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={triggeringCartId === cart.id}
                        onClick={() => handleTriggerRecovery(cart.id, 'EMAIL')}
                        className="flex-1 py-1 px-1.5 text-[10px] font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22] text-center disabled:opacity-50"
                      >
                        {triggeringCartId === cart.id ? 'Sending Email...' : 'Send Email (10% Off)'}
                      </button>
                      <button
                        type="button"
                        disabled={triggeringCartId === cart.id}
                        onClick={() => handleTriggerRecovery(cart.id, 'WHATSAPP')}
                        className="py-1 px-2 text-[10px] font-semibold bg-emerald-800 text-white rounded hover:bg-emerald-900 disabled:opacity-50"
                      >
                        WhatsApp
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Stage 2: Email Dispatched */}
          <div className="bg-white rounded-xl border border-[#221C16]/10 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[#16120E] pb-2 border-b">
              <span>02. Email Dispatched</span>
              <span className="font-mono text-[10px] text-[#5C4D3E]">
                {pipeline.abandonedCarts.filter((c) => c.recoveryStage === 'EMAIL_SENT').length}
              </span>
            </div>

            <div className="space-y-3">
              {pipeline.abandonedCarts
                .filter((c) => c.recoveryStage === 'EMAIL_SENT')
                .map((cart) => (
                  <div key={cart.id} className="p-3 rounded-lg bg-[#FAF7F2] border border-[#221C16]/10 space-y-2 text-xs">
                    <div className="font-semibold text-[#16120E] truncate">{cart.email}</div>
                    <div className="text-[11px] text-[#5C4D3E]">
                      Incentive Link Sent · <span className="font-mono font-bold text-[#16120E]">₹{cart.subtotal.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="text-[10px] font-mono text-[#8B4513]">
                      Attempt #{cart.recoveryAttempts} (Cooldown Active)
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Stage 3: WhatsApp Follow-Up */}
          <div className="bg-white rounded-xl border border-[#221C16]/10 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[#16120E] pb-2 border-b">
              <span>03. WhatsApp Follow-Up</span>
              <span className="font-mono text-[10px] text-[#5C4D3E]">
                {pipeline.abandonedCarts.filter((c) => c.recoveryStage === 'WHATSAPP_SENT').length}
              </span>
            </div>

            <div className="space-y-3">
              {pipeline.abandonedCarts
                .filter((c) => c.recoveryStage === 'WHATSAPP_SENT')
                .map((cart) => (
                  <div key={cart.id} className="p-3 rounded-lg bg-[#FAF7F2] border border-[#221C16]/10 space-y-2 text-xs">
                    <div className="font-semibold text-[#16120E] truncate">{cart.email}</div>
                    <div className="text-[10px] font-mono text-emerald-800">
                      WhatsApp Delivered with Deboss Incentive
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Stage 4: Recovered Patron */}
          <div className="bg-white rounded-xl border border-[#221C16]/10 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[#16120E] pb-2 border-b">
              <span>04. Recovered</span>
              <span className="font-mono text-[10px] text-[#1B332A]">
                {pipeline.abandonedCarts.filter((c) => c.recoveryStage === 'RECOVERED').length}
              </span>
            </div>

            <div className="space-y-3">
              {pipeline.abandonedCarts
                .filter((c) => c.recoveryStage === 'RECOVERED')
                .map((cart) => (
                  <div key={cart.id} className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 space-y-1 text-xs">
                    <div className="font-semibold text-emerald-900 truncate">{cart.email}</div>
                    <div className="text-[11px] text-emerald-800 font-mono">
                      Order placed successfully
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION B: Corporate Gifting & Custom Bespoke Pipeline */}
      <div className="space-y-4 pt-6 border-t border-[#221C16]/10">
        <h2 className="font-display text-xl font-bold text-[#16120E]">
          Enterprise & Corporate Gifting Funnel
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Stage 1: New Lead */}
          <div className="bg-white rounded-xl border border-[#221C16]/10 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[#16120E] pb-2 border-b">
              <span>01. Inbound Inquiries</span>
              <span className="font-mono text-[10px]">{leadsByStage.NEW_LEAD.length}</span>
            </div>
            {leadsByStage.NEW_LEAD.map((l) => (
              <div key={l.id} className="p-3 rounded-lg bg-[#FAF7F2] border space-y-2 text-xs">
                <div className="font-bold text-[#16120E]">{l.companyName}</div>
                <div className="text-[11px] text-[#5C4D3E]">Contact: {l.contactPerson}</div>
                <div className="text-[11px] font-mono font-bold text-[#8B4513]">
                  Qty: {l.estimatedQuantity} pcs · {l.budgetRangeInr}
                </div>
                <button
                  onClick={() => handleUpdateLeadStatus(l.id, 'SWATCH_DISPATCHED')}
                  className="w-full py-1 text-[11px] font-semibold bg-[#221C16] text-[#FAF7F2] rounded mt-2"
                >
                  Dispatch Swatch Kit
                </button>
              </div>
            ))}
          </div>

          {/* Stage 2: Swatch Dispatched */}
          <div className="bg-white rounded-xl border border-[#221C16]/10 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[#16120E] pb-2 border-b">
              <span>02. Swatch In Transit</span>
              <span className="font-mono text-[10px]">{leadsByStage.SWATCH_DISPATCHED.length}</span>
            </div>
            {leadsByStage.SWATCH_DISPATCHED.map((l) => (
              <div key={l.id} className="p-3 rounded-lg bg-[#FAF7F2] border space-y-2 text-xs">
                <div className="font-bold text-[#16120E]">{l.companyName}</div>
                <div className="text-[11px] font-mono text-[#1B332A]">
                  AWB: {l.swatchKitAwb || 'SR-SWATCH-99120'}
                </div>
                <button
                  onClick={() => handleUpdateLeadStatus(l.id, 'QUOTE_ISSUED')}
                  className="w-full py-1 text-[11px] font-semibold bg-[#8B4513] text-white rounded mt-2"
                >
                  Generate Official Quote
                </button>
              </div>
            ))}
          </div>

          {/* Stage 3: Quote Issued */}
          <div className="bg-white rounded-xl border border-[#221C16]/10 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[#16120E] pb-2 border-b">
              <span>03. Quote Issued</span>
              <span className="font-mono text-[10px]">{leadsByStage.QUOTE_ISSUED.length}</span>
            </div>
            {leadsByStage.QUOTE_ISSUED.map((l) => (
              <div key={l.id} className="p-3 rounded-lg bg-[#FAF7F2] border space-y-2 text-xs">
                <div className="font-bold text-[#16120E]">{l.companyName}</div>
                <div className="text-[11px] font-mono text-[#16120E] font-bold">
                  Deal: ₹{l.dealValueInr?.toLocaleString('en-IN')}
                </div>
                {Array.isArray(l.items) && l.items.length > 0 && (
                  <div className="text-[10px] font-mono text-[#5C4D3E]">
                    {l.items.map(it => `${it.sku} ×${it.quantity}`).join(', ')}
                  </div>
                )}
                <button
                  type="button"
                  disabled={!canPushToErp || Boolean(l.erpOrderId)}
                  title={!canPushToErp ? 'Requires Store Manager or Logistics Coordinator role' : undefined}
                  onClick={() => openPushToErpModal(l)}
                  className="w-full py-1 text-[11px] font-semibold bg-[#1B332A] text-white rounded mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {l.erpOrderId
                    ? `Pushed (${l.erpOrderNumber || l.erpOrderId})`
                    : canPushToErp
                    ? 'Push to ERP Sales Order'
                    : 'Push to ERP (Manager/Logistics Only)'}
                </button>
              </div>
            ))}
          </div>

          {/* Stage 4: Order Confirmed */}
          <div className="bg-white rounded-xl border border-[#221C16]/10 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[#16120E] pb-2 border-b">
              <span>04. Production & Fulfilled</span>
              <span className="font-mono text-[10px]">{leadsByStage.ORDER_CONFIRMED.length}</span>
            </div>
            {leadsByStage.ORDER_CONFIRMED.map((l) => (
              <div key={l.id} className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 space-y-1 text-xs">
                <div className="font-bold text-emerald-900">{l.companyName}</div>
                <div className="text-[11px] text-emerald-800 font-mono">
                  {l.erpOrderNumber ? `ERP Order ${l.erpOrderNumber}` : 'ERP Order Active'} · Pune Primary Hub Allocated
                </div>
                {l.dealValueInr && (
                  <div className="text-[10px] font-mono text-emerald-900">
                    Value: ₹{l.dealValueInr.toLocaleString('en-IN')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modal: New Enterprise Lead */}
      {showAddLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#16120E]/70 backdrop-blur-sm">
          <div className="bg-white rounded-xl border p-6 max-w-lg w-full space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="font-display text-xl font-bold text-[#16120E]">
              New Corporate Gifting Opportunity
            </h3>
            <form onSubmit={handleAddLeadSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#5C4D3E] mb-1">Company / Institution Name</label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Bain & Company India"
                  className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                />
              </div>

              <div>
                <label className="block text-[#5C4D3E] mb-1">Contact Person & Title</label>
                <input
                  type="text"
                  required
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  placeholder="e.g. Rajesh Khurana (VP Procurement)"
                  className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[#5C4D3E] mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={leadEmail}
                    onChange={(e) => setLeadEmail(e.target.value)}
                    className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                  />
                </div>
                <div>
                  <label className="block text-[#5C4D3E] mb-1">Phone</label>
                  <input
                    type="text"
                    required
                    value={leadPhone}
                    onChange={(e) => setLeadPhone(e.target.value)}
                    className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                  />
                </div>
              </div>

              {/* Catalog SKU Line Items Selector */}
              <div className="p-3 bg-[#FAF7F2] rounded-lg border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#16120E]">Quoted Catalog SKUs</span>
                  {catalogProducts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const p = catalogProducts[0];
                        const next = [
                          ...newLeadItems,
                          {
                            sku: p.sku,
                            productId: p.id,
                            productName: p.name,
                            quantity: 5,
                            unitPrice: p.price,
                            leatherType: 'VEGETABLE_TANNED_HERITAGE' as const
                          }
                        ];
                        setNewLeadItems(next);
                        setQuantity(next.reduce((s, it) => s + it.quantity, 0));
                        setDealValue(next.reduce((s, it) => s + (it.unitPrice || 0) * it.quantity, 0));
                      }}
                      className="text-[11px] font-semibold text-[#8B4513] underline"
                    >
                      + Add SKU Line
                    </button>
                  )}
                </div>

                {newLeadItems.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-1.5 items-center">
                    <select
                      value={row.sku}
                      onChange={(e) => {
                        const prod = catalogProducts.find(p => p.sku === e.target.value);
                        const next = newLeadItems.map((item, i) =>
                          i === idx
                            ? {
                                ...item,
                                sku: e.target.value,
                                productId: prod?.id,
                                productName: prod?.name,
                                unitPrice: prod?.price ?? item.unitPrice
                              }
                            : item
                        );
                        setNewLeadItems(next);
                        setQuantity(next.reduce((s, it) => s + it.quantity, 0));
                        setDealValue(next.reduce((s, it) => s + (it.unitPrice || 0) * it.quantity, 0));
                      }}
                      className="col-span-7 px-2 py-1 bg-white border rounded font-mono text-[11px]"
                    >
                      {catalogProducts.map(p => (
                        <option key={p.sku} value={p.sku}>
                          {p.sku} — {p.name} (₹{p.price.toLocaleString('en-IN')})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      value={row.quantity}
                      onChange={(e) => {
                        const qty = Math.max(1, parseInt(e.target.value || '1', 10));
                        const next = newLeadItems.map((item, i) => (i === idx ? { ...item, quantity: qty } : item));
                        setNewLeadItems(next);
                        setQuantity(next.reduce((s, it) => s + it.quantity, 0));
                        setDealValue(next.reduce((s, it) => s + (it.unitPrice || 0) * it.quantity, 0));
                      }}
                      className="col-span-3 px-2 py-1 bg-white border rounded font-mono text-[11px]"
                      aria-label="Line Quantity"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const next = newLeadItems.filter((_, i) => i !== idx);
                        setNewLeadItems(next);
                        if (next.length > 0) {
                          setQuantity(next.reduce((s, it) => s + it.quantity, 0));
                          setDealValue(next.reduce((s, it) => s + (it.unitPrice || 0) * it.quantity, 0));
                        }
                      }}
                      className="col-span-2 p-1 text-red-700 hover:bg-red-50 rounded flex justify-center"
                      title="Remove line"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[#5C4D3E] mb-1">Estimated Quantity</label>
                  <input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value || '1', 10)))}
                    className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                  />
                </div>
                <div>
                  <label className="block text-[#5C4D3E] mb-1">Estimated Deal Value (₹)</label>
                  <input
                    type="number"
                    step={500}
                    value={dealValue}
                    onChange={(e) => setDealValue(Math.max(0, parseInt(e.target.value || '0', 10)))}
                    className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddLead(false)}
                  className="px-3 py-1.5 border rounded text-[#5C4D3E]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#221C16] text-[#FAF7F2] font-semibold rounded hover:bg-[#342B22]"
                >
                  Save Lead
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirm SKU Line Items & Push to ERP Sales Order */}
      {pushModalLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#16120E]/70 backdrop-blur-sm">
          <div className="bg-white rounded-xl border p-6 max-w-lg w-full space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start gap-2.5">
              <PackageCheck className="w-5 h-5 text-[#1B332A] mt-0.5 shrink-0" />
              <div>
                <h3 className="font-display text-xl font-bold text-[#16120E]">
                  Confirm ERP Sales Order Allocation
                </h3>
                <p className="text-xs text-[#5C4D3E] mt-0.5">
                  Pushing <strong>{pushModalLead.companyName}</strong> creates a real ERP Sales Order, locks & deducts Pune/Mumbai warehouse stock + BOM materials, and issues a GST tax invoice.
                </p>
              </div>
            </div>

            <form onSubmit={handleConfirmPushToErp} className="space-y-3 text-xs">
              <div className="space-y-2 p-3 bg-[#FAF7F2] rounded-lg border">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#16120E]">Catalog SKUs & Quantities</span>
                  {catalogProducts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const p = catalogProducts[0];
                        setPushItems(prev => [
                          ...prev,
                          {
                            sku: p.sku,
                            productId: p.id,
                            productName: p.name,
                            quantity: 1,
                            unitPrice: p.price,
                            leatherType: 'VEGETABLE_TANNED_HERITAGE'
                          }
                        ]);
                      }}
                      className="text-[11px] font-semibold text-[#8B4513] underline"
                    >
                      + Add Line Item
                    </button>
                  )}
                </div>

                {pushItems.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-1.5 items-center">
                    <select
                      value={row.sku}
                      onChange={(e) => {
                        const prod = catalogProducts.find(p => p.sku === e.target.value);
                        setPushItems(prev =>
                          prev.map((item, i) =>
                            i === idx
                              ? {
                                  ...item,
                                  sku: e.target.value,
                                  productId: prod?.id,
                                  productName: prod?.name,
                                  unitPrice: prod?.price ?? item.unitPrice
                                }
                              : item
                          )
                        );
                      }}
                      className="col-span-6 px-2 py-1.5 bg-white border rounded font-mono text-[11px]"
                    >
                      {catalogProducts.map(p => (
                        <option key={p.sku} value={p.sku}>
                          {p.sku} · {p.name} ({typeof p.stockCount === 'number' ? `${p.stockCount} avail` : 'Catalog'})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      value={row.quantity}
                      onChange={(e) => {
                        const qty = Math.max(1, parseInt(e.target.value || '1', 10));
                        setPushItems(prev => prev.map((it, i) => (i === idx ? { ...it, quantity: qty } : it)));
                      }}
                      className="col-span-2 px-2 py-1.5 bg-white border rounded font-mono text-[11px]"
                      aria-label="Order Qty"
                    />
                    <input
                      type="number"
                      min={100}
                      value={row.unitPrice || 0}
                      onChange={(e) => {
                        const price = Math.max(1, parseInt(e.target.value || '100', 10));
                        setPushItems(prev => prev.map((it, i) => (i === idx ? { ...it, unitPrice: price } : it)));
                      }}
                      className="col-span-3 px-2 py-1.5 bg-white border rounded font-mono text-[11px]"
                      aria-label="Unit Price INR"
                    />
                    <button
                      type="button"
                      disabled={pushItems.length <= 1}
                      onClick={() => setPushItems(prev => prev.filter((_, i) => i !== idx))}
                      className="col-span-1 p-1 text-red-700 hover:bg-red-50 rounded disabled:opacity-30"
                      title="Remove line item"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between p-2.5 bg-white border rounded font-mono">
                <span className="text-[#5C4D3E]">Estimated Subtotal (excl. GST):</span>
                <strong className="text-[#16120E]">
                  ₹{pushItems.reduce((s, it) => s + (it.unitPrice || 0) * it.quantity, 0).toLocaleString('en-IN')}
                </strong>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setPushModalLead(null)}
                  className="px-3 py-1.5 border rounded text-[#5C4D3E]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPushingOrder || pushItems.length === 0}
                  className="px-4 py-1.5 bg-[#1B332A] text-white font-semibold rounded hover:bg-emerald-950 disabled:opacity-50"
                >
                  {isPushingOrder ? 'Creating ERP Order...' : 'Confirm & Create ERP Sales Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
