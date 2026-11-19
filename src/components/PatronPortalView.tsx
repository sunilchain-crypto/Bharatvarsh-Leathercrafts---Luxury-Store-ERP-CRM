import React, { useState, useEffect } from 'react';
import {
  Package,
  FileText,
  ShieldCheck,
  Sparkles,
  Truck,
  Download,
  Eye,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  RotateCcw,
  X
} from 'lucide-react';
import {
  Order,
  GSTInvoice,
  GSTCreditNote,
  WarrantyRegistration,
  CareKitDispatch,
  HotStampingVector,
  AuthUser
} from '../types/index.ts';
import { InvoicePreviewModal, downloadGstDocumentPdf } from './InvoicePreviewModal.tsx';

interface PatronOverviewPayload {
  patron: {
    customerId: string;
    fullName: string;
    email: string;
    phone: string;
    rfmSegment: string;
    loyaltyPoints: number;
    storeCreditBalance: number;
    totalOrders: number;
    lifetimeValue: number;
  };
  orders: Order[];
  invoices: GSTInvoice[];
  creditNotes: GSTCreditNote[];
  warranties: WarrantyRegistration[];
  careKits: CareKitDispatch[];
  hotStampingVectors: HotStampingVector[];
  gstInvoicingEnabled: boolean;
  supplierGstin: string;
  gstRatePercent: number;
}

interface PatronPortalViewProps {
  currentUser: AuthUser;
  authToken: string;
  onExploreStorefront: () => void;
}

export const PatronPortalView: React.FC<PatronPortalViewProps> = ({
  currentUser,
  authToken,
  onExploreStorefront
}) => {
  const [section, setSection] = useState<'ORDERS' | 'INVOICES' | 'WARRANTIES' | 'CARE'>('ORDERS');
  const [overview, setOverview] = useState<PatronOverviewPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewDocNumber, setPreviewDocNumber] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [returnModalOrder, setReturnModalOrder] = useState<Order | null>(null);
  const [returnReason, setReturnReason] = useState<'COLOR_MISMATCH' | 'TEXTURE_DEFECT' | 'HARDWARE_DAMAGE' | 'INCORRECT_SIZE'>('INCORRECT_SIZE');
  const [returnNotes, setReturnNotes] = useState('');
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false);
  const [returnModalError, setReturnModalError] = useState<string | null>(null);
  const [returnSuccessBanner, setReturnSuccessBanner] = useState<string | null>(null);

  const loadOverview = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/patron/overview', {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Could not load your Atelier profile.');
      }
      setOverview(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load patron portal');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (authToken) {
      loadOverview();
    }
  }, [authToken, currentUser.email]);

  const handleDownloadPdf = async (docNumber: string) => {
    try {
      setDownloadNotice(`Downloading ${docNumber}.pdf...`);
      await downloadGstDocumentPdf(docNumber, authToken);
      setDownloadNotice(null);
    } catch (e: any) {
      setError(e?.message || 'PDF download failed');
      setDownloadNotice(null);
    }
  };

  const getReturnWindowInfo = (ord: Order) => {
    const isDelivered = ord.status === 'DELIVERED' || ord.courierStatus === 'DELIVERED';
    if (!isDelivered) {
      return { isDelivered: false, eligible: false, daysLeft: 0 };
    }
    const refTs = ord.deliveredAt || ord.updatedAt || ord.createdAt;
    const deliveredMs = new Date(refTs).getTime();
    const elapsedDays = Number.isFinite(deliveredMs)
      ? Math.max(0, (Date.now() - deliveredMs) / (1000 * 60 * 60 * 24))
      : 999;
    const eligible = elapsedDays <= 10;
    const daysLeft = eligible ? Math.max(0, Math.ceil(10 - elapsedDays)) : 0;
    return { isDelivered: true, eligible, daysLeft };
  };

  const handleSubmitReturnRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnModalOrder) return;
    setReturnModalError(null);
    setIsSubmittingReturn(true);
    try {
      const res = await fetch(`/api/patron/orders/${encodeURIComponent(returnModalOrder.id)}/return-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          reason: returnReason,
          notes: returnNotes.trim()
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setReturnModalError(data.error || 'Could not register return request.');
        return;
      }
      setReturnSuccessBanner(
        data.message || `Return / exchange request submitted for ${returnModalOrder.orderNumber}.`
      );
      setReturnModalOrder(null);
      setReturnNotes('');
      await loadOverview();
    } catch (err: any) {
      setReturnModalError(err?.message || 'Network error submitting return request.');
    } finally {
      setIsSubmittingReturn(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
      {/* Editorial Portal Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-5 border-b border-[#221C16]/10">
        <div>
          <span className="text-xs font-mono uppercase tracking-widest text-[#8B4513]">
            Private Patron Concierge
          </span>
          <h1 className="font-display text-3xl font-bold text-[#16120E] mt-1">
            My Atelier · {overview?.patron.fullName || currentUser.name}
          </h1>
          <p className="text-xs text-[#5C4D3E] mt-1 font-mono">
            {currentUser.email}
            {overview?.patron.phone ? ` · ${overview.patron.phone}` : ''}
            {overview ? ` · Loyalty Credits: ${overview.patron.loyaltyPoints.toLocaleString('en-IN')} pts` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={loadOverview}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#221C16] border border-[#221C16]/15 rounded hover:bg-white"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={onExploreStorefront}
            className="px-3.5 py-1.5 text-xs font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22]"
          >
            Browse Collections
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {downloadNotice && (
        <div className="p-3 bg-white border border-[#221C16]/15 rounded-lg text-xs font-mono text-[#1B332A] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{downloadNotice}</span>
        </div>
      )}

      {returnSuccessBanner && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{returnSuccessBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setReturnSuccessBanner(null)}
            className="text-[11px] underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Summary Metric Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-[#5C4D3E] block">Commissions Placed</span>
          <div className="font-mono text-2xl font-bold text-[#16120E] tabular-nums">
            {overview ? overview.orders.length : '...'}
          </div>
          <span className="text-[11px] text-[#5C4D3E]">Handcrafted Master Atelier Pieces</span>
        </div>

        <div className="p-5 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-[#5C4D3E] block">GST Invoices</span>
          <div className="font-mono text-2xl font-bold text-[#16120E] tabular-nums">
            {overview ? overview.invoices.length : '...'}
          </div>
          <span className="text-[11px] text-[#5C4D3E]">PDF & Print-Ready Tax Bills</span>
        </div>

        <div className="p-5 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-[#5C4D3E] block">Active Brass Warranties</span>
          <div className="font-mono text-2xl font-bold text-[#1B332A] tabular-nums">
            {overview ? overview.warranties.filter(w => w.status === 'ACTIVE').length : '...'}
          </div>
          <span className="text-[11px] text-[#5C4D3E]">2-Year Hardware Protection</span>
        </div>

        <div className="p-5 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-[#5C4D3E] block">Store Credit</span>
          <div className="font-mono text-2xl font-bold text-[#8B4513] tabular-nums">
            ₹{overview ? overview.patron.storeCreditBalance.toLocaleString('en-IN') : '...'}
          </div>
          <span className="text-[11px] text-[#5C4D3E]">Applicable at Checkout</span>
        </div>
      </div>

      {/* Workspace Switcher */}
      <div className="flex items-center gap-2 border-b border-[#221C16]/10 pb-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setSection('ORDERS')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
            section === 'ORDERS' ? 'bg-[#221C16] text-[#FAF7F2]' : 'text-[#5C4D3E] hover:text-[#16120E]'
          }`}
        >
          <Truck className="w-3.5 h-3.5" />
          <span>My Orders & AWB Tracking ({overview?.orders.length || 0})</span>
        </button>

        <button
          type="button"
          onClick={() => setSection('INVOICES')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
            section === 'INVOICES' ? 'bg-[#221C16] text-[#FAF7F2]' : 'text-[#5C4D3E] hover:text-[#16120E]'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>GST Invoices & Credit Notes ({(overview?.invoices.length || 0) + (overview?.creditNotes.length || 0)})</span>
        </button>

        <button
          type="button"
          onClick={() => setSection('WARRANTIES')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
            section === 'WARRANTIES' ? 'bg-[#221C16] text-[#FAF7F2]' : 'text-[#5C4D3E] hover:text-[#16120E]'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Brass Hardware Warranties ({overview?.warranties.length || 0})</span>
        </button>

        <button
          type="button"
          onClick={() => setSection('CARE')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
            section === 'CARE' ? 'bg-[#221C16] text-[#FAF7F2]' : 'text-[#5C4D3E] hover:text-[#16120E]'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Heirloom Care Guides ({overview?.careKits.length || 0})</span>
        </button>
      </div>

      {isLoading ? (
        <div className="p-12 text-center bg-white rounded-xl border border-[#221C16]/10 text-xs font-mono text-[#5C4D3E]">
          Loading your private atelier records...
        </div>
      ) : !overview ? null : (
        <>
          {/* SECTION 1: ORDERS & AWB TRACKING */}
          {section === 'ORDERS' && (
            <div className="space-y-4">
              {overview.orders.length === 0 ? (
                <div className="p-12 text-center bg-white rounded-xl border border-[#221C16]/10 space-y-3">
                  <Package className="w-8 h-8 text-[#8B4513] mx-auto" />
                  <h3 className="font-display text-lg font-bold text-[#16120E]">No Atelier Commissions Yet</h3>
                  <p className="text-xs text-[#5C4D3E] max-w-md mx-auto">
                    Once you commission a handcrafted piece using {currentUser.email}, your live Shiprocket/Delhivery AWB tracking, GST tax invoice, and 2-year solid brass warranty will appear here automatically.
                  </p>
                  <button
                    type="button"
                    onClick={onExploreStorefront}
                    className="px-4 py-2 text-xs font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22]"
                  >
                    Explore Leathercraft Collections
                  </button>
                </div>
              ) : (
                overview.orders.map((ord) => {
                  const retWin = getReturnWindowInfo(ord);
                  const isAlreadyReturned =
                    ord.status === 'RETURNED' || ord.returnRequestStatus === 'PROCESSED';
                  const isReturnPending =
                    ord.returnRequestStatus === 'REQUESTED' || ord.returnRequestStatus === 'APPROVED';

                  return (
                    <div key={ord.id} className="p-5 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-4">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#221C16]/10">
                        <div className="space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono font-bold text-[#16120E] text-sm">{ord.orderNumber}</span>
                            <span className="text-[#5C4D3E]">·</span>
                            <span className="font-mono text-[#5C4D3E]">{ord.createdAt.slice(0, 10)}</span>
                            <span className="text-[#5C4D3E]">·</span>
                            <span className="font-mono font-semibold text-[#1B332A]">
                              {ord.status} ({ord.courierStatus || 'IN_TRANSIT'})
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-[#5C4D3E]">
                            Courier: {ord.courierPartner || 'SHIPROCKET'} · AWB: <strong className="text-[#16120E]">{ord.awbNumber || 'Allocating...'}</strong>
                            {ord.shippingAddress?.city ? ` · Destination: ${ord.shippingAddress.city}, ${ord.shippingAddress.state}` : ''}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <div className="text-right">
                            <div className="text-[10px] uppercase tracking-wider text-[#5C4D3E]">Total Paid</div>
                            <div className="font-mono font-bold text-sm text-[#16120E] tabular-nums">
                              ₹{ord.totalAmount.toLocaleString('en-IN')}
                            </div>
                          </div>
                          {ord.invoiceNumber && (
                            <button
                              type="button"
                              onClick={() => setPreviewDocNumber(ord.invoiceNumber!)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-[#221C16]/20 rounded hover:bg-[#FAF7F2]"
                            >
                              <FileText className="w-3.5 h-3.5 text-[#8B4513]" />
                              <span>GST Invoice</span>
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="divide-y divide-[#221C16]/5 text-xs">
                        {ord.items.map((it) => (
                          <div key={it.id} className="py-2 flex items-center justify-between gap-4">
                            <div>
                              <div className="font-semibold text-[#16120E]">{it.productName}</div>
                              <div className="text-[11px] font-mono text-[#5C4D3E]">
                                SKU: {it.sku} · Qty: {it.quantity} · HSN: {it.hsnCode}
                                {it.customization?.monogramInitials ? ` · Debossed: "${it.customization.monogramInitials}" (${it.customization.foilType})` : ''}
                              </div>
                            </div>
                            <div className="font-mono font-bold text-[#16120E] tabular-nums shrink-0">
                              ₹{it.lineTotal.toLocaleString('en-IN')}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* 10-Day Return & Exchange Bar */}
                      {(isAlreadyReturned || isReturnPending || retWin.isDelivered) && (
                        <div className="pt-3 border-t border-[#221C16]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                          {isAlreadyReturned ? (
                            <div className="font-mono text-[11px] font-semibold text-[#1B332A]">
                              Return Approved &amp; Refunded
                              {ord.returnReason ? ` · ${ord.returnReason.replace(/_/g, ' ')}` : ''}
                            </div>
                          ) : isReturnPending ? (
                            <div className="font-mono text-[11px] text-[#8B4513]">
                              <strong>
                                {ord.returnRequestStatus === 'APPROVED' ? 'Return Approved' : 'Return / Exchange Requested'}
                              </strong>
                              {ord.returnReason ? ` · Reason: ${ord.returnReason.replace(/_/g, ' ')}` : ''}
                              {ord.returnRequestedAt ? ` · Submitted ${ord.returnRequestedAt.slice(0, 10)}` : ''}
                            </div>
                          ) : retWin.eligible ? (
                            <>
                              <span className="font-mono text-[11px] text-[#5C4D3E]">
                                {retWin.daysLeft === 0
                                  ? 'Final day to request a return or exchange (10-day post-delivery policy)'
                                  : `${retWin.daysLeft} ${retWin.daysLeft === 1 ? 'day' : 'days'} left to request return or exchange`}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setReturnModalError(null);
                                  setReturnReason('INCORRECT_SIZE');
                                  setReturnNotes('');
                                  setReturnModalOrder(ord);
                                }}
                                className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3 py-1.5 text-xs font-semibold border border-[#8B4513]/40 text-[#8B4513] rounded hover:bg-[#8B4513] hover:text-white transition-colors"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Request Return / Exchange</span>
                              </button>
                            </>
                          ) : (
                            <span className="font-mono text-[11px] text-[#7A6B5D]">
                              Return &amp; Exchange Window Closed (10-Day Policy)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* SECTION 2: GST INVOICES & CREDIT NOTES */}
          {section === 'INVOICES' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-[#221C16]/10 shadow-sm overflow-x-auto">
                <div className="p-4 bg-[#FAF7F2] border-b border-[#221C16]/10 flex items-center justify-between text-xs">
                  <span className="font-bold text-[#16120E]">GST Tax Invoices ({overview.invoices.length})</span>
                  <span className="font-mono text-[#5C4D3E]">Supplier GSTIN: {overview.supplierGstin}</span>
                </div>
                {overview.invoices.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#5C4D3E]">No GST invoices issued to your account yet.</div>
                ) : (
                  <table className="w-full text-left border-collapse text-xs font-mono">
                    <thead>
                      <tr className="border-b border-[#221C16]/10 text-[11px] text-[#5C4D3E] uppercase">
                        <th className="p-3.5">Invoice No.</th>
                        <th className="p-3.5">Date</th>
                        <th className="p-3.5">Place of Supply</th>
                        <th className="p-3.5 text-right">Taxable</th>
                        <th className="p-3.5 text-right">GST</th>
                        <th className="p-3.5 text-right">Total</th>
                        <th className="p-3.5 text-right font-sans">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#221C16]/5">
                      {overview.invoices.map((inv) => {
                        const gstTotal = inv.cgstAmount + inv.sgstAmount + inv.igstAmount;
                        return (
                          <tr key={inv.id} className="hover:bg-[#FAF7F2]/60">
                            <td className="p-3.5 font-bold text-[#16120E]">{inv.invoiceNumber}</td>
                            <td className="p-3.5 text-[#5C4D3E]">{inv.invoiceDate.slice(0, 10)}</td>
                            <td className="p-3.5 font-sans text-[#5C4D3E]">
                              {inv.placeOfSupply} ({inv.isInterState ? 'IGST' : 'CGST+SGST'})
                            </td>
                            <td className="p-3.5 text-right tabular-nums">₹{inv.taxableValue.toLocaleString('en-IN')}</td>
                            <td className="p-3.5 text-right tabular-nums text-[#5C4D3E]">₹{gstTotal.toLocaleString('en-IN')}</td>
                            <td className="p-3.5 text-right tabular-nums font-bold text-[#16120E]">
                              ₹{inv.totalInvoiceAmount.toLocaleString('en-IN')}
                            </td>
                            <td className="p-3.5 text-right font-sans">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setPreviewDocNumber(inv.invoiceNumber)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] border border-[#221C16]/20 rounded hover:bg-white"
                                >
                                  <Eye className="w-3 h-3 text-[#8B4513]" />
                                  <span>Preview</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDownloadPdf(inv.invoiceNumber)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22]"
                                >
                                  <Download className="w-3 h-3 text-[#C5A059]" />
                                  <span>PDF</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {overview.creditNotes.length > 0 && (
                <div className="bg-white rounded-xl border border-[#221C16]/10 shadow-sm overflow-x-auto">
                  <div className="p-4 bg-[#FAF7F2] border-b border-[#221C16]/10 font-bold text-xs text-[#16120E]">
                    GST Credit Notes ({overview.creditNotes.length})
                  </div>
                  <table className="w-full text-left border-collapse text-xs font-mono">
                    <thead>
                      <tr className="border-b border-[#221C16]/10 text-[11px] text-[#5C4D3E] uppercase">
                        <th className="p-3.5">Credit Note No.</th>
                        <th className="p-3.5">Original Invoice</th>
                        <th className="p-3.5">Reason</th>
                        <th className="p-3.5 text-right">Credit Value</th>
                        <th className="p-3.5 text-right font-sans">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#221C16]/5">
                      {overview.creditNotes.map((cn) => (
                        <tr key={cn.id}>
                          <td className="p-3.5 font-bold text-[#8B4513]">{cn.creditNoteNumber}</td>
                          <td className="p-3.5 text-[#5C4D3E]">{cn.originalInvoiceNumber}</td>
                          <td className="p-3.5 text-[#5C4D3E]">{cn.reason}</td>
                          <td className="p-3.5 text-right tabular-nums font-bold text-[#16120E]">
                            ₹{cn.totalCreditAmount.toLocaleString('en-IN')}
                          </td>
                          <td className="p-3.5 text-right font-sans">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setPreviewDocNumber(cn.creditNoteNumber)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] border border-[#221C16]/20 rounded hover:bg-white"
                              >
                                <Eye className="w-3 h-3 text-[#8B4513]" />
                                <span>Preview</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDownloadPdf(cn.creditNoteNumber)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22]"
                              >
                                <Download className="w-3 h-3 text-[#C5A059]" />
                                <span>PDF</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* SECTION 3: 2-YEAR SOLID BRASS HARDWARE WARRANTIES & MONOGRAMS */}
          {section === 'WARRANTIES' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-6 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-4">
                <h2 className="font-display text-lg font-bold text-[#16120E]">
                  2-Year Solid Brass Hardware Warranties
                </h2>
                {overview.warranties.length === 0 ? (
                  <p className="text-xs text-[#5C4D3E]">
                    Warranty certificates register automatically upon every Bharatvarsh hardware-fitted leather commission.
                  </p>
                ) : (
                  <div className="space-y-3 text-xs">
                    {overview.warranties.map((w) => (
                      <div key={w.id} className="p-4 bg-[#FAF7F2] rounded-lg border border-[#221C16]/10 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[#16120E]">{w.productName}</span>
                          <span className="font-mono text-[11px] font-semibold text-[#1B332A]">{w.status}</span>
                        </div>
                        <div className="font-mono text-[11px] text-[#5C4D3E]">
                          Hardware Serial: <strong className="text-[#16120E]">{w.hardwareSerial}</strong>
                        </div>
                        <div className="font-mono text-[11px] text-[#5C4D3E]">
                          Valid: {w.startDate.slice(0, 10)} to {w.expiryDate.slice(0, 10)} ({w.warrantyPeriodYears} Years)
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-6 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-4">
                <h2 className="font-display text-lg font-bold text-[#16120E]">
                  Registered Hot-Stamping Monograms
                </h2>
                {overview.hotStampingVectors.length === 0 ? (
                  <p className="text-xs text-[#5C4D3E]">
                    No custom blind debossing or metallic foil vectors recorded yet.
                  </p>
                ) : (
                  <div className="space-y-3 text-xs">
                    {overview.hotStampingVectors.map((h) => (
                      <div key={h.id} className="p-4 bg-[#FAF7F2] rounded-lg border border-[#221C16]/10 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-bold text-[#16120E]">{h.productName}</div>
                          <div className="font-mono text-[11px] text-[#5C4D3E] mt-0.5">
                            Foil: {h.foilStyle} · Font: {h.fontFamily} · Recorded {h.recordedAt.slice(0, 10)}
                          </div>
                        </div>
                        <div className="font-display text-xl font-bold tracking-widest text-[#8B4513] px-3 py-1 bg-white border border-[#C5A059]/40 rounded">
                          {h.monogramText}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 4: HEIRLOOM CARE GUIDES & CARE KIT DISPATCHES */}
          {section === 'CARE' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 p-6 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-4 text-xs leading-relaxed">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[#8B4513]">
                  Atelier Preservation Manual
                </span>
                <h2 className="font-display text-xl font-bold text-[#16120E]">
                  Vegetable-Tanned Steerhide & Solid Brass Care Protocol
                </h2>
                <div className="space-y-3 text-[#5C4D3E]">
                  <div className="p-3.5 bg-[#FAF7F2] rounded-lg border border-[#221C16]/10">
                    <strong className="text-[#16120E] block mb-1">1. Quarterly Organic Beeswax Conditioning</strong>
                    Warm a pea-sized portion of Bharatvarsh Organic Beeswax & Jojoba Balm between clean fingertips, apply in gentle circular strokes, allow 20 minutes to absorb, and buff with your horsehair brush to cultivate a deep amber patina.
                  </div>
                  <div className="p-3.5 bg-[#FAF7F2] rounded-lg border border-[#221C16]/10">
                    <strong className="text-[#16120E] block mb-1">2. Monsoon & High-Humidity Shielding</strong>
                    If exposed to rain, blot moisture gently with an undyed cotton cloth and air-dry away from direct sunlight or heaters for 24 hours before conditioning. Store pieces inside the provided breathable muslin dust bag.
                  </div>
                  <div className="p-3.5 bg-[#FAF7F2] rounded-lg border border-[#221C16]/10">
                    <strong className="text-[#16120E] block mb-1">3. Sand-Cast Solid Brass & Debossed Foils</strong>
                    Wipe solid antique brass locks and YKK metal teeth with a dry microfiber cloth. Avoid alcohol-based sanitizers near 24k gold-leaf or silver foil monograms.
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5 p-6 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-4">
                <h3 className="font-display text-lg font-bold text-[#16120E]">
                  Dispatched Care Kits
                </h3>
                {overview.careKits.length === 0 ? (
                  <p className="text-xs text-[#5C4D3E]">
                    Complimentary beeswax balm kits ship automatically with every handcrafted leather commission.
                  </p>
                ) : (
                  <div className="space-y-3 text-xs">
                    {overview.careKits.map((ck) => (
                      <div key={ck.id} className="p-3.5 bg-[#FAF7F2] rounded-lg border border-[#221C16]/10 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[#16120E]">{ck.kitType.replace(/_/g, ' ')}</span>
                          <span className="font-mono text-[11px] font-semibold text-[#1B332A]">{ck.status}</span>
                        </div>
                        <div className="font-mono text-[11px] text-[#5C4D3E]">
                          {ck.courier} AWB: <strong className="text-[#16120E]">{ck.awbNumber}</strong>
                        </div>
                        <div className="font-mono text-[11px] text-[#5C4D3E]">
                          Dispatched {ck.dispatchDate.slice(0, 10)} · Digital Guide {ck.digitalGuideSent ? 'Delivered' : 'Pending'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {previewDocNumber && (
        <InvoicePreviewModal
          documentNumber={previewDocNumber}
          authToken={authToken}
          onClose={() => setPreviewDocNumber(null)}
        />
      )}

      {/* Patron 10-Day Return / Exchange Request Modal */}
      {returnModalOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#16120E]/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="return-modal-title"
        >
          <div className="w-full max-w-md rounded-xl border border-[#221C16]/15 bg-[#FAF7F2] p-6 shadow-2xl space-y-4 text-[#221C16]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-[#8B4513]">
                  10-Day Return &amp; Exchange Policy
                </p>
                <h3 id="return-modal-title" className="font-display text-lg font-bold text-[#16120E] mt-0.5">
                  Request Return / Exchange
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReturnModalOrder(null)}
                className="p-1 text-[#5C4D3E] hover:text-[#16120E]"
                aria-label="Close return request modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-white rounded-lg border border-[#221C16]/10 text-xs font-mono">
              <div className="font-bold text-[#16120E]">{returnModalOrder.orderNumber}</div>
              <div className="text-[#5C4D3E] mt-0.5">
                {returnModalOrder.items.map(i => `${i.productName} ×${i.quantity}`).join(', ')}
              </div>
            </div>

            {returnModalError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{returnModalError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitReturnRequest} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-[#5C4D3E] mb-1">
                  Reason for Return / Exchange *
                </label>
                <select
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value as any)}
                  className="w-full px-3 py-2 bg-white border border-[#221C16]/20 rounded text-xs"
                >
                  <option value="INCORRECT_SIZE">Incorrect Size / Fit Exchange</option>
                  <option value="COLOR_MISMATCH">Color / Patina Tone Mismatch</option>
                  <option value="TEXTURE_DEFECT">Leather Grain / Stitching Defect</option>
                  <option value="HARDWARE_DAMAGE">Brass Hardware Transit Damage</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#5C4D3E] mb-1">
                  Additional Details (Optional)
                </label>
                <textarea
                  rows={3}
                  maxLength={800}
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder="Share preferred exchange size, pickup timing, or inspection notes..."
                  className="w-full px-3 py-2 bg-white border border-[#221C16]/20 rounded text-xs"
                />
              </div>

              <p className="text-[11px] text-[#5C4D3E] leading-relaxed">
                Submitting creates a priority Atelier Support Desk ticket and flags your order for
                insured reverse pickup &amp; RMA review. Pieces must be unused in original packaging.
              </p>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#221C16]/10">
                <button
                  type="button"
                  onClick={() => setReturnModalOrder(null)}
                  className="px-3.5 py-2 border border-[#221C16]/20 rounded text-[#5C4D3E] hover:bg-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReturn}
                  className="px-4 py-2 bg-[#221C16] text-[#FAF7F2] font-semibold rounded hover:bg-[#8B4513] disabled:opacity-50"
                >
                  {isSubmittingReturn ? 'Submitting...' : 'Submit Return Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
