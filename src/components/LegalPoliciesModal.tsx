import React, { useEffect } from 'react';
import { X, FileText, RotateCcw, Truck, Shield } from 'lucide-react';

export type LegalPolicyTab = 'TERMS' | 'RETURNS' | 'SHIPPING' | 'PRIVACY';

interface LegalPoliciesModalProps {
  activeTab: LegalPolicyTab | null;
  onChangeTab: (tab: LegalPolicyTab) => void;
  onClose: () => void;
}

const TABS: Array<{ id: LegalPolicyTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'TERMS', label: 'Terms & Conditions', icon: FileText },
  { id: 'RETURNS', label: 'Return & Exchange (10-Day)', icon: RotateCcw },
  { id: 'SHIPPING', label: 'Shipping Policy', icon: Truck },
  { id: 'PRIVACY', label: 'Privacy Policy', icon: Shield }
];

export const LegalPoliciesModal: React.FC<LegalPoliciesModalProps> = ({
  activeTab,
  onChangeTab,
  onClose
}) => {
  useEffect(() => {
    if (!activeTab) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTab, onClose]);

  if (!activeTab) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-policies-heading"
    >
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[#E8E2D9] bg-[#FAF7F2] text-[#221C16] shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#E8E2D9] bg-[#16120E] px-6 py-4 text-[#FAF7F2]">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#C5A059]">
              BHARATVARSH LEATHERCRAFTS LLP · STATUTORY &amp; PATRON POLICIES
            </p>
            <h2 id="legal-policies-heading" className="mt-1 font-serif text-xl font-semibold">
              Terms, Returns, Shipping &amp; Privacy
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close legal policies modal"
            className="rounded p-2 text-[#FAF7F2]/75 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex flex-wrap gap-1 border-b border-[#E8E2D9] bg-[#F3EFE8] px-4 py-2.5 sm:px-6">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChangeTab(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded px-3.5 py-2 text-xs font-semibold tracking-wide transition ${
                  selected
                    ? 'bg-[#221C16] text-[#FAF7F2]'
                    : 'text-[#5C4D40] hover:bg-[#E8E2D9] hover:text-[#221C16]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Policy Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6 text-sm leading-relaxed text-[#4A3F35]">
          {activeTab === 'TERMS' && (
            <>
              <div>
                <h3 className="font-serif text-xl font-semibold text-[#221C16]">
                  Terms &amp; Conditions of Sale
                </h3>
                <p className="mt-1 font-mono text-xs text-[#7A6B5D]">
                  Effective Date: November 2026 · Governed by the Laws of India
                </p>
              </div>
              <section className="space-y-2">
                <h4 className="font-serif text-base font-semibold text-[#221C16]">
                  1. Craftsmanship &amp; Natural Hide Variations
                </h4>
                <p>
                  Every Bharatvarsh Leathercrafts LLP piece is handcrafted from full-grain
                  vegetable-tanned hides or conscious botanical bio-substitutes. Subtle tonal
                  nuances, natural grain markings, and evolving amber patina are hallmarks of
                  uncoated natural leather and are not manufacturing defects.
                </p>
              </section>
              <section className="space-y-2">
                <h4 className="font-serif text-base font-semibold text-[#221C16]">
                  2. Pricing, GST &amp; Authoritative Checkout
                </h4>
                <p>
                  All catalog prices are quoted in Indian Rupees (INR). Applicable Goods &amp;
                  Services Tax (GST) is computed transparently at checkout, and a compliant GST Tax
                  Invoice is issued electronically for every paid order. Promotional codes are
                  validated server-side and cannot be stacked unless explicitly stated.
                </p>
              </section>
              <section className="space-y-2">
                <h4 className="font-serif text-base font-semibold text-[#221C16]">
                  3. Bespoke Debossing &amp; Solid Brass Hardware Guarantee
                </h4>
                <p>
                  Personalized heated-brass monograms are stamped to patron specification. Every
                  piece includes a 2-year solid cast-brass hardware warranty covering locks,
                  buckles, and rivets against structural failure under normal use.
                </p>
              </section>
              <section className="space-y-2">
                <h4 className="font-serif text-base font-semibold text-[#221C16]">
                  4. Intellectual Property &amp; Contact
                </h4>
                <p>
                  All designs, editorial photography, and Leather Knowledge Base materials belong
                  exclusively to Bharatvarsh Leathercrafts LLP. For formal inquiries, contact{' '}
                  <span className="font-medium text-[#221C16]">support@bharatvarshcrafts.com</span>.
                </p>
              </section>
            </>
          )}

          {activeTab === 'RETURNS' && (
            <>
              <div>
                <h3 className="font-serif text-xl font-semibold text-[#221C16]">
                  Return &amp; Exchange Policy (Strict 10-Day Window)
                </h3>
                <p className="mt-1 font-mono text-xs text-[#8B4513]">
                  RETURNS &amp; EXCHANGES ACCEPTED STRICTLY WITHIN 10 CALENDAR DAYS OF DELIVERY
                </p>
              </div>
              <div className="rounded-lg border border-[#C5A059]/60 bg-[#F8F3EA] p-4 text-[#221C16]">
                <p className="font-semibold">10-Day Post-Delivery Eligibility Rule</p>
                <p className="mt-1 text-xs leading-relaxed text-[#5C4D40]">
                  Patrons may submit a return or exchange request directly inside{' '}
                  <span className="font-semibold text-[#221C16]">My Atelier</span> within{' '}
                  <span className="font-semibold text-[#221C16]">10 calendar days</span> from the
                  recorded courier delivery timestamp. Once 10 days have elapsed from delivery, the
                  return and exchange window closes permanently and no returns or exchanges are
                  permitted.
                </p>
              </div>
              <section className="space-y-2">
                <h4 className="font-serif text-base font-semibold text-[#221C16]">
                  1. Eligible Conditions
                </h4>
                <ul className="list-disc space-y-1.5 pl-5">
                  <li>
                    Pieces must be unused, unsoiled, and returned in original dust bags and atelier
                    packaging with the beeswax balm jar and serial tags intact.
                  </li>
                  <li>
                    Valid return/exchange grounds include size/fit exchange, hardware transit
                    damage, leather grain or stitching defect, or verifiable colour discrepancy.
                  </li>
                  <li>
                    Custom monogrammed / debossed pieces are eligible for replacement or repair
                    only in the event of a verifiable manufacturing or hardware defect.
                  </li>
                </ul>
              </section>
              <section className="space-y-2">
                <h4 className="font-serif text-base font-semibold text-[#221C16]">
                  2. How to Initiate a Return in My Atelier
                </h4>
                <p>
                  Sign in to <span className="font-semibold text-[#221C16]">My Atelier</span>,
                  locate your delivered order within 10 days of delivery, and click{' '}
                  <span className="font-semibold text-[#221C16]">Request Return / Exchange</span>.
                  Our Atelier Support Desk receives your request immediately, arranges insured
                  reverse pickup, inspects the piece on arrival, and issues an exchange or GST
                  Credit Note refund to your original payment method within 5–7 business days of
                  quality approval.
                </p>
              </section>
            </>
          )}

          {activeTab === 'SHIPPING' && (
            <>
              <div>
                <h3 className="font-serif text-xl font-semibold text-[#221C16]">
                  Shipping &amp; Insured Dispatch Policy
                </h3>
                <p className="mt-1 font-mono text-xs text-[#7A6B5D]">
                  Pan-India Complimentary Insured Courier Service
                </p>
              </div>
              <section className="space-y-2">
                <h4 className="font-serif text-base font-semibold text-[#221C16]">
                  1. Dispatch &amp; Personalization Timelines
                </h4>
                <p>
                  Ready-to-ship heirloom pieces are inspected, hand-buffed, and dispatched within
                  24–48 business hours. Orders specifying bespoke heated-brass monogramming require
                  an additional 1–2 business days for artisanal stamping and cooling verification.
                </p>
              </section>
              <section className="space-y-2">
                <h4 className="font-serif text-base font-semibold text-[#221C16]">
                  2. Insured Pan-India Delivery &amp; AWB Tracking
                </h4>
                <p>
                  Every shipment travels via our insured logistics partners with live Airway Bill
                  (AWB) tracking visible in <span className="font-semibold">My Atelier</span>.
                  Metro destinations typically receive delivery within 2–4 business days; other
                  serviceable Indian pin codes within 4–7 business days.
                </p>
              </section>
              <section className="space-y-2">
                <h4 className="font-serif text-base font-semibold text-[#221C16]">
                  3. Complimentary Care Kit Inclusion
                </h4>
                <p>
                  All leathercraft orders include an organic beeswax conditioning balm and
                  unbleached breathable cotton storage bag at no additional shipping charge.
                </p>
              </section>
            </>
          )}

          {activeTab === 'PRIVACY' && (
            <>
              <div>
                <h3 className="font-serif text-xl font-semibold text-[#221C16]">
                  Privacy &amp; Patron Data Protection Policy
                </h3>
                <p className="mt-1 font-mono text-xs text-[#7A6B5D]">
                  Compliant with India&apos;s Digital Personal Data Protection Framework
                </p>
              </div>
              <section className="space-y-2">
                <h4 className="font-serif text-base font-semibold text-[#221C16]">
                  1. Data We Collect
                </h4>
                <p>
                  We collect only the information necessary to craft, personalize, invoice, and
                  deliver your orders: patron name, email address, Indian mobile number, delivery
                  address, monogram preferences, and warranty registrations.
                </p>
              </section>
              <section className="space-y-2">
                <h4 className="font-serif text-base font-semibold text-[#221C16]">
                  2. Payment Security &amp; Fraud Protection
                </h4>
                <p>
                  Payments are processed through PCI-DSS compliant payment gateways (Razorpay and
                  Stripe). Bharatvarsh Leathercrafts LLP never stores raw card numbers or CVV codes.
                  Sign-in and checkout flows are safeguarded by Google reCAPTCHA Enterprise and
                  Firebase App Check.
                </p>
              </section>
              <section className="space-y-2">
                <h4 className="font-serif text-base font-semibold text-[#221C16]">
                  3. Patron Control &amp; Requests
                </h4>
                <p>
                  We never sell or rent patron personal data to third-party brokers. To request
                  access, correction, or archival of your account data, write to{' '}
                  <span className="font-medium text-[#221C16]">support@bharatvarshcrafts.com</span>.
                </p>
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#E8E2D9] bg-[#F3EFE8] px-6 py-3.5">
          <span className="font-mono text-[11px] text-[#6B5D51]">
            Bharatvarsh Leathercrafts LLP · support@bharatvarshcrafts.com
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-[#221C16] px-5 py-2 text-xs font-semibold uppercase tracking-widest text-[#FAF7F2] transition hover:bg-[#8B4513]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
