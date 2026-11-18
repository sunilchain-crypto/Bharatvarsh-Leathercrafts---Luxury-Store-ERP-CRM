import React, { useState, useEffect } from 'react';
import { MessageSquare, Mail, MessageCircle, Send, CreditCard, CheckCircle2, Clock } from 'lucide-react';
import { SupportTicket } from '../types/index.ts';

interface OmnichannelInboxProps {
  authToken: string;
}

export const OmnichannelInbox: React.FC<OmnichannelInboxProps> = ({ authToken }) => {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string>('tkt_01');
  const [replyText, setReplyText] = useState('');
  const [activeChannel, setActiveChannel] = useState<'WHATSAPP' | 'EMAIL' | 'LIVE_CHAT'>('WHATSAPP');
  const [paymentGateway, setPaymentGateway] = useState<'RAZORPAY' | 'STRIPE'>('RAZORPAY');
  const [paymentAmountInr, setPaymentAmountInr] = useState<number>(4200);
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [paymentLinkMeta, setPaymentLinkMeta] = useState<{
    url: string;
    provider: string;
    mode: string;
  } | null>(null);
  const [deliveryNotice, setDeliveryNotice] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);

  const fetchTickets = async () => {
    try {
      const res = await fetch('/api/crm/tickets', {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (data.success) {
        setTickets(data.tickets);
      }
    } catch (e) {
      console.warn('Failed to fetch tickets', e);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [authToken]);

  const selectedTicket = tickets.find((t) => t.id === selectedTicketId) || tickets[0];

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedTicket) return;
    setReplyError(null);
    setDeliveryNotice(null);

    try {
      const res = await fetch(`/api/crm/tickets/${selectedTicket.id}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          text: replyText,
          channel: activeChannel
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setReplyText('');
        setPaymentLinkMeta(null);
        if (data.delivery) {
          setDeliveryNotice(
            `Reply dispatched via ${data.delivery.provider} (${data.delivery.mode}).`
          );
        }
        fetchTickets();
      } else {
        setReplyError(data.error || 'Failed to send reply');
      }
    } catch (e: any) {
      setReplyError(e?.message || 'Failed to send reply');
    }
  };

  const handleGeneratePaymentLink = async () => {
    if (!selectedTicket) return;
    setReplyError(null);
    setIsCreatingLink(true);
    try {
      const res = await fetch('/api/crm/payment-links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          gateway: paymentGateway,
          amountInr: paymentAmountInr > 0 ? paymentAmountInr : 4200,
          customerName: selectedTicket.customerName,
          customerEmail: selectedTicket.customerEmail,
          customerPhone: selectedTicket.customerPhone,
          ticketNumber: selectedTicket.ticketNumber,
          description: `Bespoke Service / Order (${selectedTicket.ticketNumber})`
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create server-side payment link');
      }
      setPaymentLinkMeta({
        url: data.paymentUrl,
        provider: data.provider,
        mode: data.mode
      });
      setReplyText((prev) =>
        `${prev ? prev + ' ' : ''}[One-Click Secure ${data.provider} Payment Link (₹${paymentAmountInr.toLocaleString('en-IN')}): ${data.paymentUrl}]`
      );
    } catch (e: any) {
      setReplyError(e?.message || 'Failed to create payment link');
    } finally {
      setIsCreatingLink(false);
    }
  };

  const getChannelIcon = (ch: string) => {
    switch (ch) {
      case 'WHATSAPP':
        return <MessageCircle className="w-4 h-4 text-emerald-600" />;
      case 'EMAIL':
        return <Mail className="w-4 h-4 text-blue-600" />;
      default:
        return <MessageSquare className="w-4 h-4 text-[#8B4513]" />;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-[#221C16]/10">
        <div>
          <span className="text-xs font-mono uppercase tracking-widest text-[#8B4513]">
            Multichannel Support Operations
          </span>
          <h1 className="font-display text-3xl font-bold text-[#16120E] mt-1">
            Omnichannel Patron Inbox & Ticketing
          </h1>
          <p className="text-xs text-[#5C4D3E] mt-1">
            Consolidated WhatsApp Business API, SMTP email replies (support@bharatvarshcrafts.com), and server-generated Razorpay/Stripe payment links.
          </p>
        </div>
      </div>

      {replyError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900 flex items-center justify-between gap-2">
          <span>{replyError}</span>
          <button type="button" onClick={() => setReplyError(null)} className="text-[11px] opacity-70 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {deliveryNotice && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{deliveryNotice}</span>
          </span>
          <button type="button" onClick={() => setDeliveryNotice(null)} className="text-[11px] opacity-70 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-[680px]">
        {/* Ticket List (4 Cols) */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-[#221C16]/10 shadow-sm overflow-hidden flex flex-col">
          <div className="p-3.5 bg-[#FAF7F2] border-b border-[#221C16]/10 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#16120E]">
              Active Threads ({tickets.length})
            </span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#221C16]/5">
            {tickets.map((t) => (
              <div
                key={t.id}
                onClick={() => {
                  setSelectedTicketId(t.id);
                  setActiveChannel(t.channel);
                  setPaymentLinkMeta(null);
                }}
                className={`p-4 cursor-pointer transition-colors ${
                  selectedTicket?.id === t.id ? 'bg-[#EBE4D5]/50 font-medium' : 'hover:bg-[#FAF7F2]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {getChannelIcon(t.channel)}
                    <span className="text-xs font-bold text-[#16120E] truncate">
                      {t.customerName}
                    </span>
                  </div>
                  {t.priority === 'VIP_URGENT' ? (
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-red-100 text-red-800 shrink-0">
                      VIP SLA
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-[#5C4D3E] shrink-0">{t.status}</span>
                  )}
                </div>

                <div className="text-xs text-[#16120E] font-medium mt-1 truncate">{t.subject}</div>

                <div className="flex items-center justify-between text-[11px] text-[#5C4D3E] mt-2 font-mono">
                  <span>{t.ticketNumber}</span>
                  <span className="flex items-center gap-1 tabular-nums">
                    <Clock className="w-3 h-3" /> {t.slaBreachHours}h SLA
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Conversation Thread (8 Cols) */}
        <div className="lg:col-span-8 bg-white rounded-xl border border-[#221C16]/10 shadow-sm flex flex-col justify-between overflow-hidden">
          {selectedTicket ? (
            <>
              {/* Thread Header */}
              <div className="p-4 bg-[#FAF7F2] border-b border-[#221C16]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    {getChannelIcon(selectedTicket.channel)}
                    <h3 className="text-sm font-bold text-[#16120E]">{selectedTicket.subject}</h3>
                    <span className="text-xs text-[#5C4D3E] font-mono">({selectedTicket.ticketNumber})</span>
                  </div>
                  <div className="text-xs text-[#5C4D3E] mt-0.5">
                    Patron: <strong className="text-[#16120E]">{selectedTicket.customerName}</strong> ({selectedTicket.customerEmail}
                    {selectedTicket.customerPhone ? ` · ${selectedTicket.customerPhone}` : ''}) · Category: {selectedTicket.category}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={paymentGateway}
                    onChange={(e) => setPaymentGateway(e.target.value as 'RAZORPAY' | 'STRIPE')}
                    className="px-2 py-1 text-xs bg-white border border-[#221C16]/20 rounded font-mono"
                    aria-label="Payment Gateway"
                  >
                    <option value="RAZORPAY">Razorpay</option>
                    <option value="STRIPE">Stripe</option>
                  </select>
                  <input
                    type="number"
                    min={100}
                    step={100}
                    value={paymentAmountInr}
                    onChange={(e) => setPaymentAmountInr(Math.max(100, parseInt(e.target.value || '100', 10)))}
                    className="w-24 px-2 py-1 text-xs font-mono bg-white border border-[#221C16]/20 rounded tabular-nums"
                    aria-label="Payment link amount INR"
                  />
                  <button
                    type="button"
                    disabled={isCreatingLink}
                    onClick={handleGeneratePaymentLink}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22] disabled:opacity-50"
                    title="Create server-side Razorpay or Stripe payment link"
                  >
                    <CreditCard className="w-3.5 h-3.5 text-[#C5A059]" />
                    <span>{isCreatingLink ? 'Creating...' : 'Create Payment Link'}</span>
                  </button>
                </div>
              </div>

              {/* Messages Container */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-[#FAF7F2]/40">
                {selectedTicket.messages.map((m) => {
                  const isPatron = m.sender === 'PATRON';
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${isPatron ? 'items-start' : 'items-end'}`}
                    >
                      <div className="flex items-center gap-1.5 text-[10px] text-[#5C4D3E] font-mono mb-1">
                        <span>{isPatron ? selectedTicket.customerName : 'Bharatvarsh Atelier Support'}</span>
                        <span>·</span>
                        <span>{m.timestamp.slice(11, 16)} via {m.channel}</span>
                      </div>
                      <div
                        className={`max-w-[80%] p-3.5 rounded-xl text-xs leading-relaxed shadow-sm ${
                          isPatron
                            ? 'bg-white text-[#16120E] border border-[#221C16]/10 rounded-tl-none'
                            : 'bg-[#221C16] text-[#FAF7F2] rounded-tr-none'
                        }`}
                      >
                        {m.text}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Reply Composer */}
              <form onSubmit={handleSendReply} className="p-3.5 bg-white border-t border-[#221C16]/10 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5C4D3E]">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">Dispatch via:</span>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="channel"
                        checked={activeChannel === 'WHATSAPP'}
                        onChange={() => setActiveChannel('WHATSAPP')}
                      />
                      <span>
                        WhatsApp Business{' '}
                        <span className="font-mono text-[10px] text-[#8B4513]">
                          ({selectedTicket.customerPhone || 'No phone on file'})
                        </span>
                      </span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="channel"
                        checked={activeChannel === 'EMAIL'}
                        onChange={() => setActiveChannel('EMAIL')}
                      />
                      <span>Email (support@bharatvarshcrafts.com)</span>
                    </label>
                  </div>

                  {paymentLinkMeta && (
                    <span className="text-[11px] text-[#1B332A] font-mono">
                      {paymentLinkMeta.provider} ({paymentLinkMeta.mode}) Link Attached
                    </span>
                  )}
                </div>

                {activeChannel === 'WHATSAPP' && !selectedTicket.customerPhone && (
                  <div className="px-2.5 py-1.5 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                    No phone number is registered for this patron. Live WhatsApp Business API delivery will fall back until a phone number is added.
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Compose response or instructions for patron..."
                    className="flex-1 px-3.5 py-2 text-xs bg-[#FAF7F2] border border-[#221C16]/15 rounded-lg focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white bg-[#221C16] hover:bg-[#342B22] rounded-lg transition-colors flex items-center gap-1.5 shrink-0"
                  >
                    <span>Send</span>
                    <Send className="w-3.5 h-3.5 text-[#C5A059]" />
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="p-12 text-center text-xs text-[#5C4D3E]">Select a ticket thread</div>
          )}
        </div>
      </div>
    </div>
  );
};
