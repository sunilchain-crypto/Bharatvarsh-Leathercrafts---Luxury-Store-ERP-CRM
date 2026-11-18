import React, { useState, useEffect } from 'react';
import { Phone, Mail, Sparkles, Shield, Package, RefreshCw, UserPlus, Archive } from 'lucide-react';
import { Customer } from '../types/index.ts';
import { coerceIndianPhoneInput, validateEmailAddress, validateIndianPhone } from '../lib/indianValidation.ts';

interface Customer360ViewProps {
  authToken: string;
}

export const Customer360View: React.FC<Customer360ViewProps> = ({ authToken }) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('cust_01_vip');
  const [customerDetail, setCustomerDetail] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // UI-based New Customer Modal & Archival State
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustEmail, setNewCustEmail] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('+91 ');
  const [addCustError, setAddCustError] = useState<string | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchCustomerList = async () => {
    try {
      const res = await fetch('/api/crm/customers', {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (data.success) {
        setCustomers(data.customers);
        if (data.customers.length === 0) {
          setSelectedCustomerId('');
          setCustomerDetail(null);
        } else if (!data.customers.some((c: Customer) => c.id === selectedCustomerId)) {
          setSelectedCustomerId(data.customers[0].id);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch customers', e);
    }
  };

  const fetchCustomerDetail = async (id: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/crm/customer/${id}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (data.success) {
        setCustomerDetail(data);
      }
    } catch (e) {
      console.warn('Failed to fetch customer detail', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomerList();
  }, [authToken]);

  useEffect(() => {
    setConfirmArchiveId(null);
    if (selectedCustomerId) {
      fetchCustomerDetail(selectedCustomerId);
    }
  }, [selectedCustomerId, authToken]);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddCustError(null);

    if (newCustName.trim().length < 2) {
      setAddCustError('Full name must be at least 2 characters.');
      return;
    }
    const emailCheck = validateEmailAddress(newCustEmail);
    if (!emailCheck.valid) {
      setAddCustError(emailCheck.error || 'Please enter a valid email address.');
      return;
    }
    const phoneCheck = validateIndianPhone(newCustPhone);
    if (!phoneCheck.valid) {
      setAddCustError(phoneCheck.error || 'Phone number must start with +91 followed by 10 digits.');
      return;
    }

    try {
      const res = await fetch('/api/crm/customers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          fullName: newCustName.trim(),
          email: emailCheck.normalized,
          phone: phoneCheck.formatted
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowAddCustomer(false);
        setAddCustError(null);
        setNewCustName('');
        setNewCustEmail('');
        setNewCustPhone('+91 ');
        setFeedback({ type: 'success', message: `Patron "${data.customer?.fullName || newCustName}" added to Customer Master.` });
        await fetchCustomerList();
        if (data.customer?.id) setSelectedCustomerId(data.customer.id);
      } else {
        setAddCustError(data.error || 'Failed to create customer');
      }
    } catch (e: any) {
      setAddCustError('Failed to create customer: ' + e.message);
    }
  };

  const handleArchiveCustomer = async (customerId: string) => {
    setIsArchiving(true);
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setConfirmArchiveId(null);
        setFeedback({
          type: 'success',
          message: data.message || 'Patron archived from active CRM lists; historical orders and audit trail preserved.'
        });
        await fetchCustomerList();
      } else {
        setFeedback({ type: 'error', message: data.error || 'Failed to archive patron record' });
      }
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message || 'Failed to archive patron record' });
    } finally {
      setIsArchiving(false);
    }
  };

  const filteredCustomers = customers.filter(
    (c) =>
      c.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.includes(searchQuery)
  );

  const getRfmBadgeColor = (segment: string) => {
    switch (segment) {
      case 'Champions/VIPs':
        return 'bg-[#C5A059]/20 text-[#8B4513] border-[#C5A059]/40';
      case 'At-Risk/Churning':
        return 'bg-red-50 text-red-800 border-red-200';
      case 'Bargain Hunters':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'Promising/Recent':
      default:
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-[#221C16]/10">
        <div>
          <span className="text-xs font-mono uppercase tracking-widest text-[#8B4513]">
            Customer Intelligence
          </span>
          <h1 className="font-display text-3xl font-bold text-[#16120E] mt-1">
            Customer 360 & Identity Master
          </h1>
          <p className="text-xs text-[#5C4D3E] mt-1">
            Merged storefront sessions, guest checkouts, and patron records with live RFM segmentation and interaction vectors.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowAddCustomer(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22]"
          >
            <UserPlus className="w-3.5 h-3.5 text-[#C5A059]" />
            <span>Add Customer</span>
          </button>

          <button
            onClick={() => {
              fetchCustomerList();
              if (selectedCustomerId) fetchCustomerDetail(selectedCustomerId);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#221C16] border border-[#221C16]/15 rounded hover:bg-white self-start md:self-auto"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh Data</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-red-50 text-red-900 border-red-200'
          }`}
        >
          <span>{feedback.message}</span>
          <button onClick={() => setFeedback(null)} className="underline ml-4 shrink-0">
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-4">
          <div className="p-3 bg-white rounded-lg border border-[#221C16]/10 shadow-sm">
            <input
              type="text"
              placeholder="Search patron by name, email, or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-[#FAF7F2] border border-[#221C16]/15 rounded focus:outline-none"
            />
          </div>

          <div className="space-y-2.5 max-h-[720px] overflow-y-auto pr-1">
            {filteredCustomers.map((cust) => (
              <div
                key={cust.id}
                onClick={() => setSelectedCustomerId(cust.id)}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  selectedCustomerId === cust.id
                    ? 'bg-white border-[#8B4513] shadow-md ring-1 ring-[#8B4513]'
                    : 'bg-white/80 border-[#221C16]/10 hover:border-[#221C16]/25'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-[#16120E] truncate">
                      {cust.fullName}
                    </h3>
                    <div className="text-xs text-[#5C4D3E] truncate">{cust.email}</div>
                  </div>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded border ${getRfmBadgeColor(
                      cust.rfmSegment
                    )} shrink-0`}
                  >
                    {cust.rfmSegment}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-[#221C16]/5 text-center">
                  <div>
                    <span className="text-[10px] text-[#5C4D3E] block">Orders</span>
                    <span className="font-mono text-xs font-bold text-[#16120E]">
                      {cust.totalOrders}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#5C4D3E] block">LTV</span>
                    <span className="font-mono text-xs font-bold text-[#16120E] tabular-nums">
                      ₹{cust.lifetimeValue.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#5C4D3E] block">Last Order</span>
                    <span className="font-mono text-xs font-bold text-[#16120E]">
                      {cust.daysSinceLastOrder}d ago
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-6">
          {isLoading || !customerDetail ? (
            <div className="p-12 text-center text-xs text-[#5C4D3E]">
              Loading 360-degree customer records...
            </div>
          ) : (
            <>
              <div className="p-6 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-full bg-[#221C16] text-[#C5A059] flex items-center justify-center font-display text-xl font-bold shrink-0">
                      {customerDetail.customer.fullName.charAt(0)}
                    </div>
                    <div>
                      <h2 className="font-display text-2xl font-bold text-[#16120E]">
                        {customerDetail.customer.fullName}
                      </h2>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-[#5C4D3E] mt-1 font-mono">
                        <span className="flex items-center gap-1">
                          <Mail className="w-3.5 h-3.5 text-[#8B4513]" />
                          {customerDetail.customer.email}
                        </span>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5 text-[#8B4513]" />
                          {customerDetail.customer.phone || 'No phone registered'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:items-end gap-1.5">
                    <span
                      className={`text-xs font-semibold px-3 py-1 rounded-full border ${getRfmBadgeColor(
                        customerDetail.customer.rfmSegment
                      )}`}
                    >
                      {customerDetail.customer.rfmSegment}
                    </span>
                    <span className="text-[10px] font-mono text-[#5C4D3E]">
                      RFM Score: R{customerDetail.customer.rfmScore?.recency} · F
                      {customerDetail.customer.rfmScore?.frequency} · M
                      {customerDetail.customer.rfmScore?.monetary}
                    </span>

                    {customerDetail.customer.role !== 'STORE_MANAGER' && (
                      confirmArchiveId === customerDetail.customer.id ? (
                        <div className="flex items-center gap-1.5 pt-1">
                          <button
                            type="button"
                            disabled={isArchiving}
                            onClick={() => handleArchiveCustomer(customerDetail.customer.id)}
                            className="px-2.5 py-1 text-[11px] font-semibold bg-red-800 text-white rounded hover:bg-red-900 disabled:opacity-60"
                          >
                            {isArchiving ? 'Archiving...' : 'Confirm Archive'}
                          </button>
                          <button
                            type="button"
                            disabled={isArchiving}
                            onClick={() => setConfirmArchiveId(null)}
                            className="px-2.5 py-1 text-[11px] border rounded text-[#5C4D3E] hover:bg-[#FAF7F2]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmArchiveId(customerDetail.customer.id)}
                          className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-red-800 border border-red-200 rounded hover:bg-red-50 transition-colors"
                        >
                          <Archive className="w-3 h-3" />
                          <span>Archive Patron</span>
                        </button>
                      )
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-4 border-t border-[#221C16]/10">
                  <div className="p-3 bg-[#FAF7F2] rounded-lg">
                    <span className="text-[10px] text-[#5C4D3E] uppercase tracking-wider block">
                      Lifetime Orders
                    </span>
                    <span className="font-mono text-lg font-bold text-[#16120E]">
                      {customerDetail.customer.totalOrders}
                    </span>
                  </div>

                  <div className="p-3 bg-[#FAF7F2] rounded-lg">
                    <span className="text-[10px] text-[#5C4D3E] uppercase tracking-wider block">
                      Lifetime Value (LTV)
                    </span>
                    <span className="font-mono text-lg font-bold text-[#16120E] tabular-nums">
                      ₹{customerDetail.customer.lifetimeValue.toLocaleString('en-IN')}
                    </span>
                  </div>

                  <div className="p-3 bg-[#FAF7F2] rounded-lg">
                    <span className="text-[10px] text-[#5C4D3E] uppercase tracking-wider block">
                      Average Order Value
                    </span>
                    <span className="font-mono text-lg font-bold text-[#16120E] tabular-nums">
                      ₹{customerDetail.customer.averageOrderValue.toLocaleString('en-IN')}
                    </span>
                  </div>

                  <div className="p-3 bg-[#FAF7F2] rounded-lg">
                    <span className="text-[10px] text-[#5C4D3E] uppercase tracking-wider block">
                      Return / Refund Rate
                    </span>
                    <span className="font-mono text-lg font-bold text-[#16120E]">
                      {customerDetail.customer.refundRate}%
                    </span>
                  </div>

                  <div className="p-3 bg-[#FAF7F2] rounded-lg">
                    <span className="text-[10px] text-[#5C4D3E] uppercase tracking-wider block">
                      Days Since Last
                    </span>
                    <span className="font-mono text-lg font-bold text-[#16120E]">
                      {customerDetail.customer.daysSinceLastOrder} days
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 text-xs font-mono pt-2 text-[#5C4D3E]">
                  <div>
                    <span>Acquisition Channel: </span>
                    <strong className="text-[#16120E]">
                      {customerDetail.customer.utmSource || 'Direct Atelier Visit'}
                    </strong>
                    {customerDetail.customer.utmMedium && ` (${customerDetail.customer.utmMedium})`}
                  </div>
                  <div>
                    <span>Loyalty Points: </span>
                    <strong className="text-[#8B4513] font-bold">
                      {customerDetail.customer.loyaltyPoints} pts
                    </strong>
                    <span className="ml-3">Store Credit: </span>
                    <strong className="text-[#1B332A] font-bold">
                      ₹{customerDetail.customer.storeCreditBalance.toLocaleString('en-IN')}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#16120E]">
                    <Sparkles className="w-4 h-4 text-[#C5A059]" />
                    <span>Debossing Vectors</span>
                  </div>
                  {customerDetail.hotStampingVectors.length === 0 ? (
                    <p className="text-xs text-[#5C4D3E]">No custom hot-stamping on record.</p>
                  ) : (
                    <div className="space-y-2">
                      {customerDetail.hotStampingVectors.map((hsv: any) => (
                        <div key={hsv.id} className="p-2.5 rounded bg-[#FAF7F2] border text-xs">
                          <div className="font-semibold text-[#16120E]">{hsv.productName}</div>
                          <div className="text-[11px] font-mono text-[#8B4513] mt-0.5">
                            Monogram: "{hsv.monogramText}" · {hsv.foilStyle}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-4 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#16120E]">
                    <Shield className="w-4 h-4 text-[#8B4513]" />
                    <span>Hardware Warranties</span>
                  </div>
                  {customerDetail.warranties.length === 0 ? (
                    <p className="text-xs text-[#5C4D3E]">No active hardware registrations.</p>
                  ) : (
                    <div className="space-y-2">
                      {customerDetail.warranties.map((war: any) => (
                        <div key={war.id} className="p-2.5 rounded bg-[#FAF7F2] border text-xs">
                          <div className="font-semibold text-[#16120E]">{war.productName}</div>
                          <div className="text-[11px] font-mono text-[#1B332A] mt-0.5">
                            Serial: {war.hardwareSerial} · Active till {war.expiryDate?.slice(0, 10)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-4 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#16120E]">
                    <Package className="w-4 h-4 text-[#1B332A]" />
                    <span>Care Kit Dispatches</span>
                  </div>
                  {customerDetail.careKitDispatches.length === 0 ? (
                    <p className="text-xs text-[#5C4D3E]">No care kits dispatched.</p>
                  ) : (
                    <div className="space-y-2">
                      {customerDetail.careKitDispatches.map((ck: any) => (
                        <div key={ck.id} className="p-2.5 rounded bg-[#FAF7F2] border text-xs">
                          <div className="font-semibold text-[#16120E]">
                            Organic Beeswax Balm Kit
                          </div>
                          <div className="text-[11px] font-mono text-[#5C4D3E] mt-0.5">
                            AWB: {ck.awbNumber} ({ck.courier}) · {ck.status}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-4">
                <h3 className="font-display text-lg font-bold text-[#16120E]">
                  Order Transactions & GST Invoices
                </h3>

                {customerDetail.orders.length === 0 ? (
                  <p className="text-xs text-[#5C4D3E]">No transactions recorded yet.</p>
                ) : (
                  <div className="divide-y divide-[#221C16]/10">
                    {customerDetail.orders.map((order: any) => (
                      <div key={order.id} className="py-3.5 first:pt-0 last:pb-0 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <div className="font-mono font-bold text-[#16120E]">
                            {order.orderNumber}
                            <span className="ml-2 font-normal text-[#5C4D3E]">
                              {order.createdAt?.slice(0, 10)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#EBE4D5] text-[#16120E]">
                              {order.status}
                            </span>
                            <span className="font-mono font-bold text-[#16120E]">
                              ₹{order.totalAmount.toLocaleString('en-IN')}
                            </span>
                          </div>
                        </div>

                        <div className="text-xs text-[#5C4D3E] space-y-1 pl-2 border-l border-[#221C16]/15">
                          {order.items.map((it: any) => (
                            <div key={it.id} className="flex justify-between">
                              <span>
                                {it.quantity}x {it.productName} ({it.leatherType === 'VEGETABLE_TANNED_HERITAGE' ? 'Heritage' : 'Bio'})
                              </span>
                              <span className="font-mono">₹{it.lineTotal.toLocaleString('en-IN')}</span>
                            </div>
                          ))}
                        </div>

                        <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-[#5C4D3E] pt-1">
                          <div>
                            {order.invoiceNumber ? (
                              <span className="text-[#8B4513]">GST Invoice: {order.invoiceNumber}</span>
                            ) : (
                              <span>Invoice Pending</span>
                            )}
                          </div>
                          <div>
                            {order.awbNumber && (
                              <span>AWB: {order.awbNumber} ({order.courierPartner})</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {customerDetail.recommendations && customerDetail.recommendations.length > 0 && (
                <div className="p-6 bg-[#FAF7F2] rounded-xl border border-[#8B4513]/20 space-y-3">
                  <h3 className="font-display text-base font-bold text-[#16120E] flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-[#C5A059]" />
                    <span>Atelier Product Recommendations (Inventory Linked)</span>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {customerDetail.recommendations.map((rec: any) => (
                      <div key={rec.id} className="p-3 bg-white rounded-lg border text-xs shadow-sm">
                        <div className="font-bold text-[#16120E] truncate">{rec.name}</div>
                        <div className="text-[11px] font-mono text-[#8B4513] mt-1">
                          ₹{rec.sellingPrice.toLocaleString('en-IN')}
                        </div>
                        <div className="text-[10px] text-[#5C4D3E] mt-0.5">
                          Stock: {rec.stockByLocation.mumbaiWarehouse + rec.stockByLocation.punePrimaryHub} units
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Add Customer Modal */}
      {showAddCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#16120E]/70 backdrop-blur-sm">
          <div className="bg-white rounded-xl border p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="font-display text-xl font-bold text-[#16120E]">
              Register Patron in Customer Master
            </h3>
            {addCustError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-900">
                {addCustError}
              </div>
            )}
            <form noValidate onSubmit={handleCreateCustomer} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#5C4D3E] mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={newCustName}
                  onChange={(e) => {
                    setNewCustName(e.target.value);
                    setAddCustError(null);
                  }}
                  placeholder="e.g. Siddharth Kulkarni"
                  className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                />
              </div>
              <div>
                <label className="block text-[#5C4D3E] mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  value={newCustEmail}
                  onChange={(e) => {
                    setNewCustEmail(e.target.value);
                    setAddCustError(null);
                  }}
                  placeholder="siddharth@example.com"
                  className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                />
              </div>
              <div>
                <label className="block text-[#5C4D3E] mb-1">Phone Number (+91 · 10 digits) *</label>
                <input
                  type="tel"
                  required
                  value={newCustPhone}
                  onChange={(e) => {
                    setNewCustPhone(coerceIndianPhoneInput(e.target.value));
                    setAddCustError(null);
                  }}
                  placeholder="+91 98200 12345"
                  className="w-full px-3 py-1.5 font-mono border rounded bg-[#FAF7F2]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddCustomer(false);
                    setAddCustError(null);
                  }}
                  className="px-3 py-1.5 border rounded text-[#5C4D3E]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#221C16] text-[#FAF7F2] font-semibold rounded hover:bg-[#342B22]"
                >
                  Create Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
