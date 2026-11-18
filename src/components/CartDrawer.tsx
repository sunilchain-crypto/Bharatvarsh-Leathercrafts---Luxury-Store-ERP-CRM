import React, { useState, useEffect, useRef } from 'react';
import { X, Trash2, ArrowRight, CheckCircle2, Clock, Sparkles, AlertCircle, MapPin } from 'lucide-react';
import { CartItem, CustomerAddress } from '../types/index.ts';
import {
  INDIAN_STATES_AND_UTS,
  coerceIndianPhoneInput,
  normalizeIndianState,
  validateIndianCheckoutFields
} from '../lib/indianValidation.ts';

interface CatalogStockProduct {
  id: string;
  sku: string;
  gstRate?: number;
  stockCount?: number;
  inStock?: boolean;
}

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  products?: CatalogStockProduct[];
  onUpdateQty: (index: number, newQty: number) => void;
  onRemoveItem: (index: number) => void;
  onClearCart: () => void;
  patronEmail?: string;
  patronName?: string;
  authToken?: string;
  resumedEmail?: string;
  resumedCartId?: string;
  onStockLimitNotice?: (message: string) => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  items,
  products = [],
  onUpdateQty,
  onRemoveItem,
  onClearCart,
  patronEmail = '',
  patronName = '',
  authToken = '',
  resumedEmail = '',
  resumedCartId,
  onStockLimitNotice
}) => {
  const [email, setEmail] = useState(patronEmail || resumedEmail || '');
  const [phone, setPhone] = useState('+91 ');
  const [fullName, setFullName] = useState(patronName || '');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [gateway, setGateway] = useState<'RAZORPAY' | 'STRIPE' | 'CASH_ON_DELIVERY'>('RAZORPAY');

  const [promoCode, setPromoCode] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState<{ code: string; percent: number } | null>(null);
  const [promoFeedback, setPromoFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isValidatingPromo, setIsValidatingPromo] = useState(false);
  const [gstRatePercent, setGstRatePercent] = useState(18);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<any | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [savedAddressAutoFilled, setSavedAddressAutoFilled] = useState(false);
  const [abandonNotice, setAbandonNotice] = useState<{ type: 'info' | 'error'; message: string } | null>(null);
  const hasEditedRef = useRef(false);

  const clearFieldError = (field: string) => {
    setFieldErrors(prev => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  // Sync email & fullName whenever authentication or resumed cart context changes
  useEffect(() => {
    hasEditedRef.current = false;
    setFieldErrors({});
    setSavedAddressAutoFilled(false);
    if (patronEmail) {
      setEmail(patronEmail);
      setFullName(patronName || '');
    } else if (resumedEmail) {
      setEmail(resumedEmail);
      setFullName('');
      setPhone('+91 ');
      setStreet('');
      setCity('');
      setState('');
      setPincode('');
    } else {
      setEmail('');
      setFullName('');
      setPhone('+91 ');
      setStreet('');
      setCity('');
      setState('');
      setPincode('');
    }
  }, [patronEmail, patronName, resumedEmail]);

  // Auto-fill registered patron shipping address & phone when opening drawer
  useEffect(() => {
    if (!isOpen) {
      hasEditedRef.current = false;
      return;
    }
    if (!patronEmail || !authToken) return;

    let cancelled = false;
    fetch('/api/patron/overview', {
      headers: { Authorization: `Bearer ${authToken}` }
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled || hasEditedRef.current || !data?.success) return;
        const savedAddr = data.defaultAddress || data.patron?.defaultAddress;
        const savedName = data.patron?.fullName || patronName || '';
        const savedEmail = data.patron?.email || patronEmail;
        const rawPhone = savedAddr?.phone || data.patron?.phone || '';
        const formattedPhone = rawPhone ? coerceIndianPhoneInput(rawPhone) : '+91 ';

        if (savedName) setFullName(savedName);
        if (savedEmail) setEmail(savedEmail);
        setPhone(formattedPhone);

        if (savedAddr) {
          setStreet(savedAddr.street || '');
          setCity(savedAddr.city || '');
          setState(normalizeIndianState(savedAddr.state) || '');
          setPincode(savedAddr.pincode || '');
          setSavedAddressAutoFilled(true);
        }
        setFieldErrors({});
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isOpen, patronEmail, patronName, authToken]);

  // Sync public storefront GST rate from Store Management configuration
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/storefront/config')
      .then(r => r.json())
      .then(data => {
        if (data?.success && typeof data.gstRatePercent === 'number') {
          setGstRatePercent(data.gstRatePercent);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const discountAmount = appliedDiscount ? Math.round((subtotal * appliedDiscount.percent) / 100) : 0;
  const taxable = Math.max(0, subtotal - discountAmount);
  const appliedTaxRates = new Set<number>();
  const taxAmount = items.reduce((sum, item) => {
    const liveProd = products.find(p => p.id === item.productId || p.sku === item.sku);
    const effectiveRate = typeof liveProd?.gstRate === 'number' ? liveProd.gstRate : gstRatePercent / 100;
    appliedTaxRates.add(Number((effectiveRate * 100).toFixed(2)));
    const lineSub = item.unitPrice * item.quantity;
    const lineTaxable = subtotal > 0 ? lineSub * (taxable / subtotal) : 0;
    return sum + Math.round(lineTaxable * effectiveRate);
  }, 0);
  const taxLabel =
    appliedTaxRates.size === 1
      ? `GST (${Array.from(appliedTaxRates)[0]}% Statutory Rate)`
      : 'GST (SKU-Specific Statutory Rates)';
  const total = taxable + taxAmount;

  // Persist cart state to backend whenever items or contact info change
  useEffect(() => {
    if (items.length > 0 && email.trim()) {
      fetch('/api/cart/persist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cartId: resumedCartId,
          email,
          phone,
          items,
          subtotal
        })
      }).catch(err => console.warn('Cart persistence error', err));
    }
  }, [items, email, phone, subtotal, resumedCartId]);

  if (!isOpen) return null;

  const handleApplyPromo = async () => {
    const trimmed = promoCode.trim().toUpperCase();
    if (!trimmed) {
      setPromoFeedback({ type: 'error', message: 'Enter an incentive code to apply.' });
      return;
    }
    setPromoFeedback(null);
    setIsValidatingPromo(true);
    try {
      const res = await fetch('/api/checkout/validate-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed, subtotal })
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setAppliedDiscount({ code: data.code, percent: data.discountPercent });
        setPromoFeedback({
          type: 'success',
          message: `Promo code ${data.code} applied (${data.discountPercent}% bespoke privilege).`
        });
      } else {
        setAppliedDiscount(null);
        setPromoFeedback({
          type: 'error',
          message: data.error || 'Invalid or inactive promo code.'
        });
      }
    } catch {
      setPromoFeedback({ type: 'error', message: 'Could not validate promo code right now.' });
    } finally {
      setIsValidatingPromo(false);
    }
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) return;

    setCheckoutError(null);
    const check = validateIndianCheckoutFields({
      fullName,
      email,
      phone,
      street,
      city,
      state,
      pincode,
      country: 'India'
    });

    if (!check.valid) {
      setFieldErrors(check.errors);
      setCheckoutError(check.firstError || 'Please complete all required Indian shipping fields.');
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);
    try {
      const shippingAddress: CustomerAddress = {
        id: `addr_${Date.now()}`,
        customerId: '',
        recipientName: check.normalized.fullName,
        phone: check.normalized.phone,
        street: check.normalized.street,
        city: check.normalized.city,
        state: check.normalized.state,
        pincode: check.normalized.pincode,
        country: 'India',
        isDefault: true,
        addressType: 'SHIPPING'
      };

      const res = await fetch('/api/checkout/place-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: check.normalized.fullName,
          customerEmail: check.normalized.email,
          customerPhone: check.normalized.phone,
          items,
          subtotal,
          discountAmount,
          discountCode: appliedDiscount?.code,
          shippingAddress,
          billingAddress: shippingAddress,
          paymentGateway: gateway
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setOrderSuccess(data.order);
        onClearCart();
      } else {
        if (data?.errors && typeof data.errors === 'object') {
          setFieldErrors(data.errors);
        }
        setCheckoutError(data.error || 'Failed to place order');
      }
    } catch (err: any) {
      setCheckoutError('Order placement failed: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSimulateAbandonment = async () => {
    if (items.length === 0) return;
    if (!email.trim()) {
      setAbandonNotice({
        type: 'error',
        message: 'Please enter a patron email address below before simulating cart abandonment.'
      });
      return;
    }

    try {
      // 1. Persist cart
      const persistRes = await fetch('/api/cart/persist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cartId: resumedCartId, email, phone, items, subtotal })
      });
      const persistData = await persistRes.json();
      if (!persistRes.ok || !persistData.success) {
        throw new Error(persistData.error || 'Failed to persist cart snapshot');
      }

      // 2. Trigger isolated non-financial cart abandonment simulator
      const simRes = await fetch('/api/cart/simulate-abandonment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cartId: persistData.cart?.id,
          email,
          phone,
          items
        })
      });
      if (!simRes.ok) {
        const simData = await simRes.json().catch(() => ({}));
        throw new Error(simData.message || simData.error || 'Abandonment simulation failed');
      }

      setAbandonNotice({
        type: 'info',
        message: `Cart for ${email} flagged abandoned! Check the Sales Pipeline Kanban.`
      });
      setTimeout(() => setAbandonNotice(null), 6000);
    } catch (e: any) {
      setAbandonNotice({
        type: 'error',
        message: 'Simulation error: ' + e.message
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#16120E]/70 backdrop-blur-sm animate-fadeIn">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-lg bg-[#FAF7F2] text-[#221C16] shadow-2xl flex flex-col">
          {/* Header */}
          <div className="p-5 border-b border-[#221C16]/10 flex items-center justify-between">
            <div>
              <h2 className="font-display text-xl font-bold text-[#16120E]">Your Atelier Bag</h2>
              <span className="text-xs text-[#5C4D3E]">
                {items.length} {items.length === 1 ? 'handcrafted piece' : 'handcrafted pieces'}
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-[#5C4D3E] hover:text-[#16120E] bg-[#EBE4D5]/80 hover:bg-[#EBE4D5] rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {orderSuccess ? (
              <div className="p-6 text-center space-y-4 bg-white rounded-xl border border-[#221C16]/10 shadow-sm">
                <CheckCircle2 className="w-12 h-12 text-[#1B332A] mx-auto" />
                <h3 className="font-display text-2xl font-bold text-[#16120E]">Order Confirmed</h3>
                <p className="text-sm text-[#5C4D3E]">
                  Invoice <strong className="font-mono text-[#16120E]">{orderSuccess.invoiceNumber || orderSuccess.orderNumber}</strong> has been generated and dispatched to the Pune Primary Hub workshop bench.
                </p>
                <div className="p-3 bg-[#FAF7F2] rounded border text-left text-xs font-mono space-y-1">
                  <div><strong>AWB Tracking:</strong> {orderSuccess.awbNumber}</div>
                  <div><strong>Courier:</strong> {orderSuccess.courierPartner}</div>
                  <div><strong>Status:</strong> {orderSuccess.status}</div>
                  <div><strong>Total Amount:</strong> ₹{orderSuccess.totalAmount.toLocaleString('en-IN')}</div>
                </div>
                <button
                  onClick={() => {
                    setOrderSuccess(null);
                    onClose();
                  }}
                  className="w-full py-2.5 px-4 text-xs font-semibold uppercase tracking-wider bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22]"
                >
                  Return to Storefront
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <p className="text-sm text-[#5C4D3E]">Your bag is presently empty.</p>
                <button
                  onClick={onClose}
                  className="text-xs uppercase tracking-widest font-bold text-[#8B4513] underline"
                >
                  Explore Leathercraft Collections
                </button>
              </div>
            ) : (
              <>
                {/* Notice / error banner for abandonment simulation */}
                {abandonNotice && (
                  <div
                    className={`p-3 rounded border text-xs font-medium flex items-center justify-between gap-2 ${
                      abandonNotice.type === 'error'
                        ? 'bg-red-50 border-red-200 text-red-900'
                        : 'bg-[#FAF7F2] border-[#8B4513]/40 text-[#8B4513]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {abandonNotice.type === 'error' ? (
                        <AlertCircle className="w-4 h-4 shrink-0" />
                      ) : (
                        <Clock className="w-4 h-4 shrink-0" />
                      )}
                      <span>{abandonNotice.message}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAbandonNotice(null)}
                      className="text-[11px] opacity-70 hover:opacity-100"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {/* Items List */}
                <div className="space-y-3">
                  {items.map((item, idx) => {
                    const liveProd = products.find(p => p.id === item.productId || p.sku === item.sku);
                    const maxStock = typeof liveProd?.stockCount === 'number' ? liveProd.stockCount : Infinity;
                    const totalQtyForProduct = items
                      .filter(it => it.productId === item.productId)
                      .reduce((s, it) => s + it.quantity, 0);
                    const atMaxStock = totalQtyForProduct >= maxStock;

                    return (
                      <div
                        key={idx}
                        className="p-3 bg-white rounded-lg border border-[#221C16]/10 flex gap-3.5 shadow-sm"
                      >
                        <img
                          src={item.imageUrl}
                          alt={item.productName}
                          referrerPolicy="no-referrer"
                          className="w-16 h-16 object-cover rounded bg-[#FAF7F2] shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-semibold text-[#16120E] truncate">
                            {item.productName}
                          </h4>
                          <div className="text-[11px] text-[#5C4D3E] font-mono mt-0.5">
                            {item.leatherType === 'VEGETABLE_TANNED_HERITAGE' ? 'Heritage Hide' : 'Bio-Cactus'}
                          </div>

                          {item.monogram && (
                            <div className="text-[11px] text-[#8B4513] font-mono mt-0.5 flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-[#C5A059]" />
                              <span>Debossed: "{item.monogram}" ({item.foilStyle || 'GOLD_FOIL'})</span>
                            </div>
                          )}

                          <div className="flex items-center justify-between mt-2">
                            <span className="font-mono text-xs font-bold tabular-nums">
                              ₹{(item.unitPrice * item.quantity).toLocaleString('en-IN')}
                            </span>

                            <div className="flex items-center gap-2">
                              <div className="flex items-center border border-[#221C16]/20 rounded text-xs">
                                <button
                                  type="button"
                                  onClick={() => onUpdateQty(idx, Math.max(1, item.quantity - 1))}
                                  className="px-2 py-0.5 hover:bg-[#FAF7F2]"
                                >
                                  -
                                </button>
                                <span className="px-2 font-mono font-medium">{item.quantity}</span>
                                <button
                                  type="button"
                                  disabled={atMaxStock}
                                  title={atMaxStock ? `Max available stock (${maxStock}) reached` : 'Increase quantity'}
                                  onClick={() => {
                                    if (atMaxStock) return;
                                    const nextTotal = totalQtyForProduct + 1;
                                    onUpdateQty(idx, item.quantity + 1);
                                    if (nextTotal >= maxStock && Number.isFinite(maxStock)) {
                                      onStockLimitNotice?.(`Reached maximum available stock (${maxStock}) for ${item.productName}.`);
                                    }
                                  }}
                                  className={`px-2 py-0.5 ${
                                    atMaxStock ? 'opacity-40 cursor-not-allowed bg-[#FAF7F2]/60' : 'hover:bg-[#FAF7F2]'
                                  }`}
                                >
                                  +
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() => onRemoveItem(idx)}
                                className="text-red-700/80 hover:text-red-800 p-1"
                                title="Remove item"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {atMaxStock && Number.isFinite(maxStock) && (
                            <div className="mt-1.5 text-[10px] font-mono text-amber-800">
                              Max stock limit reached ({maxStock} pcs available)
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Promo Code Input */}
                <div className="space-y-2">
                  <div className="p-3 bg-white rounded-lg border border-[#221C16]/10 flex gap-2">
                    <input
                      type="text"
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value)}
                      placeholder="Incentive Code (e.g. HEIRLOOM10)"
                      className="flex-1 px-3 py-1.5 text-xs font-mono uppercase bg-[#FAF7F2] border border-[#221C16]/15 rounded focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={isValidatingPromo}
                      onClick={handleApplyPromo}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-[#221C16] hover:bg-[#342B22] rounded transition-colors shrink-0 disabled:opacity-60"
                    >
                      {isValidatingPromo ? '...' : 'Apply'}
                    </button>
                  </div>
                  {promoFeedback && (
                    <div
                      className={`p-2.5 rounded border text-xs flex items-center justify-between gap-2 ${
                        promoFeedback.type === 'success'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-red-50 border-red-200 text-red-900'
                      }`}
                    >
                      <span>{promoFeedback.message}</span>
                      <button
                        type="button"
                        onClick={() => setPromoFeedback(null)}
                        className="text-[11px] opacity-70 hover:opacity-100"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>

                {/* Checkout Error Banner */}
                {checkoutError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{checkoutError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCheckoutError(null)}
                      className="text-[11px] opacity-70 hover:opacity-100 shrink-0"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {/* Checkout Shipping & Payment Form */}
                <form noValidate onSubmit={handleCheckout} className="space-y-4 pt-2 border-t border-[#221C16]/10">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[#16120E]">
                      Shipping & Patron Information
                    </div>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#FAF7F2] border border-[#221C16]/15 text-[10px] font-mono text-[#5C4D3E]">
                      <MapPin className="w-3 h-3 text-[#8B4513]" />
                      India Only
                    </span>
                  </div>

                  {savedAddressAutoFilled && (
                    <div className="px-3 py-2 rounded bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Auto-filled from your saved patron delivery address.</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] text-[#5C4D3E] mb-1">Full Name *</label>
                      <input
                        type="text"
                        required
                        placeholder="Full name"
                        value={fullName}
                        onChange={(e) => {
                          hasEditedRef.current = true;
                          setFullName(e.target.value);
                          clearFieldError('fullName');
                        }}
                        className={`w-full px-2.5 py-1.5 text-xs bg-white border rounded ${
                          fieldErrors.fullName ? 'border-red-500' : 'border-[#221C16]/20'
                        }`}
                      />
                      {fieldErrors.fullName && (
                        <p className="mt-0.5 text-[10px] text-red-700">{fieldErrors.fullName}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#5C4D3E] mb-1">Phone (+91 · 10 digits) *</label>
                      <input
                        type="tel"
                        required
                        placeholder="+91 98201 12345"
                        value={phone}
                        onChange={(e) => {
                          hasEditedRef.current = true;
                          setPhone(coerceIndianPhoneInput(e.target.value));
                          clearFieldError('phone');
                        }}
                        className={`w-full px-2.5 py-1.5 text-xs font-mono bg-white border rounded ${
                          fieldErrors.phone ? 'border-red-500' : 'border-[#221C16]/20'
                        }`}
                      />
                      {fieldErrors.phone && (
                        <p className="mt-0.5 text-[10px] text-red-700">{fieldErrors.phone}</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-[#5C4D3E] mb-1">Patron Email *</label>
                    <input
                      type="email"
                      required
                      placeholder="you@domain.com"
                      value={email}
                      onChange={(e) => {
                        hasEditedRef.current = true;
                        setEmail(e.target.value);
                        clearFieldError('email');
                      }}
                      className={`w-full px-2.5 py-1.5 text-xs bg-white border rounded ${
                        fieldErrors.email ? 'border-red-500' : 'border-[#221C16]/20'
                      }`}
                    />
                    {fieldErrors.email && (
                      <p className="mt-0.5 text-[10px] text-red-700">{fieldErrors.email}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] text-[#5C4D3E] mb-1">Street Address *</label>
                    <input
                      type="text"
                      required
                      placeholder="House / Building, Street, Locality"
                      value={street}
                      onChange={(e) => {
                        hasEditedRef.current = true;
                        setStreet(e.target.value);
                        clearFieldError('street');
                      }}
                      className={`w-full px-2.5 py-1.5 text-xs bg-white border rounded ${
                        fieldErrors.street ? 'border-red-500' : 'border-[#221C16]/20'
                      }`}
                    />
                    {fieldErrors.street && (
                      <p className="mt-0.5 text-[10px] text-red-700">{fieldErrors.street}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] text-[#5C4D3E] mb-1">City *</label>
                      <input
                        type="text"
                        required
                        placeholder="City"
                        value={city}
                        onChange={(e) => {
                          hasEditedRef.current = true;
                          setCity(e.target.value);
                          clearFieldError('city');
                        }}
                        className={`w-full px-2 py-1.5 text-xs bg-white border rounded ${
                          fieldErrors.city ? 'border-red-500' : 'border-[#221C16]/20'
                        }`}
                      />
                      {fieldErrors.city && (
                        <p className="mt-0.5 text-[10px] text-red-700">{fieldErrors.city}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#5C4D3E] mb-1">State *</label>
                      <select
                        required
                        value={state}
                        onChange={(e) => {
                          hasEditedRef.current = true;
                          setState(e.target.value);
                          clearFieldError('state');
                        }}
                        className={`w-full px-2 py-1.5 text-xs bg-white border rounded ${
                          fieldErrors.state ? 'border-red-500' : 'border-[#221C16]/20'
                        }`}
                      >
                        <option value="">Select State</option>
                        {INDIAN_STATES_AND_UTS.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.state && (
                        <p className="mt-0.5 text-[10px] text-red-700">{fieldErrors.state}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#5C4D3E] mb-1">PIN Code *</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        required
                        placeholder="411057"
                        value={pincode}
                        onChange={(e) => {
                          hasEditedRef.current = true;
                          setPincode(e.target.value.replace(/\D/g, '').slice(0, 6));
                          clearFieldError('pincode');
                        }}
                        className={`w-full px-2 py-1.5 text-xs font-mono bg-white border rounded ${
                          fieldErrors.pincode ? 'border-red-500' : 'border-[#221C16]/20'
                        }`}
                      />
                      {fieldErrors.pincode && (
                        <p className="mt-0.5 text-[10px] text-red-700">{fieldErrors.pincode}</p>
                      )}
                    </div>
                  </div>

                  {/* Payment Gateway Selector */}
                  <div>
                    <label className="block text-[11px] text-[#5C4D3E] mb-1.5 font-semibold">
                      Payment Integration Layer (Sandboxed Gateway)
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setGateway('RAZORPAY')}
                        className={`py-2 px-2 text-center rounded border text-xs font-medium transition-all ${
                          gateway === 'RAZORPAY'
                            ? 'border-[#0C2340] bg-[#0C2340] text-white'
                            : 'border-[#221C16]/15 bg-white text-[#5C4D3E]'
                        }`}
                      >
                        Razorpay
                      </button>
                      <button
                        type="button"
                        onClick={() => setGateway('STRIPE')}
                        className={`py-2 px-2 text-center rounded border text-xs font-medium transition-all ${
                          gateway === 'STRIPE'
                            ? 'border-[#635BFF] bg-[#635BFF] text-white'
                            : 'border-[#221C16]/15 bg-white text-[#5C4D3E]'
                        }`}
                      >
                        Stripe
                      </button>
                      <button
                        type="button"
                        onClick={() => setGateway('CASH_ON_DELIVERY')}
                        className={`py-2 px-2 text-center rounded border text-xs font-medium transition-all ${
                          gateway === 'CASH_ON_DELIVERY'
                            ? 'border-[#8B4513] bg-[#8B4513] text-white'
                            : 'border-[#221C16]/15 bg-white text-[#5C4D3E]'
                        }`}
                      >
                        COD Verified
                      </button>
                    </div>
                  </div>

                  {/* Price Breakdown */}
                  <div className="p-3.5 bg-white rounded-lg border border-[#221C16]/10 space-y-1.5 text-xs">
                    <div className="flex justify-between text-[#5C4D3E]">
                      <span>Subtotal</span>
                      <span className="font-mono tabular-nums">₹{subtotal.toLocaleString('en-IN')}</span>
                    </div>
                    {discountAmount > 0 && (
                      <div className="flex justify-between text-[#1B332A] font-medium">
                        <span>Bespoke Discount ({appliedDiscount?.code})</span>
                        <span className="font-mono tabular-nums">-₹{discountAmount.toLocaleString('en-IN')}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[#5C4D3E]">
                      <span>{taxLabel}</span>
                      <span className="font-mono tabular-nums">₹{taxAmount.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between text-[#5C4D3E]">
                      <span>Insured Express Delivery</span>
                      <span className="text-[#1B332A] font-semibold">Complimentary</span>
                    </div>
                    <div className="pt-2 border-t border-[#221C16]/10 flex justify-between font-bold text-sm text-[#16120E]">
                      <span>Total Amount</span>
                      <span className="font-mono tabular-nums">₹{total.toLocaleString('en-IN')}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-3 px-4 text-xs font-semibold uppercase tracking-wider text-white bg-[#221C16] hover:bg-[#342B22] rounded-lg transition-colors shadow-md flex items-center justify-center gap-2"
                  >
                    <span>{isSubmitting ? 'Authorizing Payment...' : `Complete Order · ₹${total.toLocaleString('en-IN')}`}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  {/* Abandonment Simulator Button */}
                  <button
                    type="button"
                    onClick={handleSimulateAbandonment}
                    className="w-full py-2 px-3 text-[11px] text-[#8B4513] border border-[#8B4513]/30 rounded hover:bg-[#8B4513]/5 transition-colors flex items-center justify-center gap-1.5"
                    title="Simulate patron leaving cart without buying to verify CRM Kanban trigger"
                  >
                    <Clock className="w-3.5 h-3.5 text-[#8B4513]" />
                    <span>Test Idle Cart Abandonment (Triggers CRM Kanban)</span>
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
