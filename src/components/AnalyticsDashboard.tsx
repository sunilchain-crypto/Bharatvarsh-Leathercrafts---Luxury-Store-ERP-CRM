import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { UnitEconomicsMetrics, OperationalHealthMetrics } from '../types/index.ts';

interface AnalyticsDashboardProps {
  authToken: string;
}

interface LowStockAlertsState {
  lowStockSkus: Array<{
    sku: string;
    name: string;
    totalStock: number;
    safetyStock: number;
  }>;
  lowStockBom: Array<{
    id: string;
    materialName: string;
    parentSku: string;
    inventoryOnHand: number;
    safetyStock: number;
    unit: string;
    vendorName: string;
  }>;
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ authToken }) => {
  const [unitEconomics, setUnitEconomics] = useState<UnitEconomicsMetrics | null>(null);
  const [operationalHealth, setOperationalHealth] = useState<OperationalHealthMetrics | null>(null);
  const [cohorts, setCohorts] = useState<any[]>([]);
  const [skuVelocity, setSkuVelocity] = useState<any[]>([]);
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlertsState>({
    lowStockSkus: [],
    lowStockBom: []
  });
  const [isLoading, setIsLoading] = useState(false);

  const fetchAnalytics = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/analytics/dashboard', {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (data.success) {
        setUnitEconomics(data.unitEconomics);
        setOperationalHealth(data.operationalHealth);
        setCohorts(data.cohorts);
        setSkuVelocity(data.skuVelocity);
        if (data.lowStockAlerts) {
          setLowStockAlerts(data.lowStockAlerts);
        }
      }
    } catch (e) {
      console.warn('Analytics fetch failed', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [authToken]);

  const reasons = operationalHealth?.returnRateByReason;
  const maxReturnReason = Math.max(
    5,
    reasons?.colorExpectation ?? 0,
    reasons?.textureExpectation ?? 0,
    reasons?.sizingFit ?? 0,
    reasons?.transitDamage ?? 0
  );
  const barWidth = (value?: number) => {
    const num = value ?? 0;
    if (num <= 0) return '0%';
    return `${Math.min(100, Math.max(4, Math.round((num / maxReturnReason) * 100)))}%`;
  };

  const totalAlerts = lowStockAlerts.lowStockSkus.length + lowStockAlerts.lowStockBom.length;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="pb-4 border-b border-[#221C16]/10 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <span className="text-xs font-mono uppercase tracking-widest text-[#8B4513]">
            Performance Insights
          </span>
          <h1 className="font-display text-3xl font-bold text-[#16120E] mt-1">
            Unit Economics & Operational Health
          </h1>
          <p className="text-xs text-[#5C4D3E] mt-1">
            Live LTV to CAC ratio, attribution, order transit SLA, dynamic RMA breakdown, 90-day cohorts, and reorder velocity.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchAnalytics}
          disabled={isLoading}
          className="px-3 py-1.5 text-xs font-semibold border border-[#221C16]/15 rounded hover:bg-white text-[#221C16] disabled:opacity-50 self-start sm:self-auto"
        >
          {isLoading ? 'Refreshing...' : 'Refresh Live Metrics'}
        </button>
      </div>

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-1">
          <span className="text-xs text-[#5C4D3E] uppercase tracking-wider block">Customer Acq. Cost (CAC)</span>
          <div className="font-mono text-2xl font-bold text-[#16120E] tabular-nums">
            ₹{unitEconomics ? unitEconomics.cac.toLocaleString('en-IN') : '...'}
          </div>
          <span className="text-[11px] text-[#1B332A] font-mono">Organic word-of-mouth buffer</span>
        </div>

        <div className="p-5 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-1">
          <span className="text-xs text-[#5C4D3E] uppercase tracking-wider block">True Blended ROAS</span>
          <div className="font-mono text-2xl font-bold text-[#16120E] tabular-nums">
            {unitEconomics ? `${unitEconomics.roas}x` : '...'}
          </div>
          <span className="text-[11px] text-[#1B332A] font-mono">Editorial PR & High-Intent Search</span>
        </div>

        <div className="p-5 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-1">
          <span className="text-xs text-[#5C4D3E] uppercase tracking-wider block">Average Order Value (AOV)</span>
          <div className="font-mono text-2xl font-bold text-[#16120E] tabular-nums">
            ₹{unitEconomics ? unitEconomics.aov.toLocaleString('en-IN') : '...'}
          </div>
          <span className="text-[11px] text-[#8B4513] font-mono">Lifted by Monogram Bundles</span>
        </div>

        <div className="p-5 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-1">
          <span className="text-xs text-[#5C4D3E] uppercase tracking-wider block">Repeat Patron Rate</span>
          <div className="font-mono text-2xl font-bold text-[#16120E] tabular-nums">
            {unitEconomics ? `${unitEconomics.repeatPurchaseRate}%` : '...'}
          </div>
          <span className="text-[11px] text-[#1B332A] font-mono">Heirloom Care post-purchase flow</span>
        </div>
      </div>

      {/* Low-Stock & BOM Reorder Alert Strip */}
      <div
        className={`p-5 rounded-xl border shadow-sm space-y-3 ${
          totalAlerts > 0
            ? 'bg-amber-50/70 border-amber-300'
            : 'bg-white border-[#221C16]/10'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {totalAlerts > 0 ? (
              <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            )}
            <h2 className="font-display text-lg font-bold text-[#16120E]">
              Low-Stock & BOM Raw Material Reorder Alerts ({totalAlerts})
            </h2>
          </div>
          <span className="text-[11px] font-mono text-[#5C4D3E]">
            Live threshold monitoring across Pune, Mumbai & Workshop BOM
          </span>
        </div>

        {totalAlerts === 0 ? (
          <p className="text-xs text-[#5C4D3E]">
            All finished SKUs and BOM raw leather/brass supplies are currently above safety stock thresholds.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {lowStockAlerts.lowStockSkus.map((sku) => (
              <div
                key={sku.sku}
                className="p-3 bg-white rounded-lg border border-amber-200 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-bold text-[#16120E] truncate">{sku.name}</div>
                  <div className="text-[11px] font-mono text-[#5C4D3E]">
                    Finished SKU · {sku.sku}
                  </div>
                </div>
                <div className="text-right font-mono shrink-0">
                  <span className={`font-bold ${sku.totalStock === 0 ? 'text-red-800' : 'text-amber-900'}`}>
                    {sku.totalStock} pcs left
                  </span>
                  <div className="text-[10px] text-[#5C4D3E]">Safety: {sku.safetyStock} pcs</div>
                </div>
              </div>
            ))}

            {lowStockAlerts.lowStockBom.map((bom) => (
              <div
                key={bom.id}
                className="p-3 bg-white rounded-lg border border-amber-200 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-bold text-[#16120E] truncate">{bom.materialName}</div>
                  <div className="text-[11px] font-mono text-[#5C4D3E]">
                    BOM ({bom.parentSku}) · {bom.vendorName}
                  </div>
                </div>
                <div className="text-right font-mono shrink-0">
                  <span className="font-bold text-amber-900">
                    {bom.inventoryOnHand} {bom.unit}
                  </span>
                  <div className="text-[10px] text-[#5C4D3E]">
                    Safety: {bom.safetyStock} {bom.unit}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Operational Health & Return Reasons */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Operational Health Box */}
        <div className="p-6 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-6">
          <h2 className="font-display text-xl font-bold text-[#16120E]">
            Operational Quality & Transit SLA
          </h2>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 bg-[#FAF7F2] rounded-lg">
              <span className="text-[11px] text-[#5C4D3E] block">Avg Delivery Time</span>
              <span className="font-mono text-lg font-bold text-[#16120E] tabular-nums">
                {operationalHealth ? operationalHealth.averageTransitDays : '—'} Days
              </span>
              <span className="text-[10px] text-[#5C4D3E] block mt-0.5">
                {operationalHealth?.completedDeliveries ?? 0} Completed
              </span>
            </div>

            <div className="p-3 bg-[#FAF7F2] rounded-lg">
              <span className="text-[11px] text-[#5C4D3E] block">On-Time Delivery</span>
              <span className="font-mono text-lg font-bold text-[#1B332A] tabular-nums">
                {operationalHealth ? operationalHealth.onTimeDeliveryRate : '—'}%
              </span>
              <span className="text-[10px] text-[#5C4D3E] block mt-0.5">Air Cargo Route</span>
            </div>

            <div className="p-3 bg-[#FAF7F2] rounded-lg">
              <span className="text-[11px] text-[#5C4D3E] block">Warranty Claims</span>
              <span className="font-mono text-lg font-bold text-[#8B4513] tabular-nums">
                {operationalHealth ? operationalHealth.warrantyClaimFrequency : '—'}%
              </span>
              <span className="text-[10px] text-[#5C4D3E] block mt-0.5">Per 100 Sold Units</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#16120E]">
                Return Rate by Root Cause (Target &lt; 5%)
              </h3>
              <span className="text-[11px] font-mono text-[#5C4D3E]">
                {operationalHealth?.totalReturns ?? 0} RMA(s) logged
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <div className="flex justify-between text-[#5C4D3E] mb-1 font-mono tabular-nums">
                  <span>Color / Expectation Mismatch</span>
                  <span className="font-bold text-[#16120E]">
                    {operationalHealth?.returnRateByReason.colorExpectation ?? 0}%
                  </span>
                </div>
                <div className="w-full bg-[#FAF7F2] h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-[#8B4513] h-full rounded-full transition-all"
                    style={{ width: barWidth(reasons?.colorExpectation) }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[#5C4D3E] mb-1 font-mono tabular-nums">
                  <span>Natural Hide Grain Texture</span>
                  <span className="font-bold text-[#16120E]">
                    {operationalHealth?.returnRateByReason.textureExpectation ?? 0}%
                  </span>
                </div>
                <div className="w-full bg-[#FAF7F2] h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-[#A75D28] h-full rounded-full transition-all"
                    style={{ width: barWidth(reasons?.textureExpectation) }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[#5C4D3E] mb-1 font-mono tabular-nums">
                  <span>Belt Waist Sizing Fit</span>
                  <span className="font-bold text-[#16120E]">
                    {operationalHealth?.returnRateByReason.sizingFit ?? 0}%
                  </span>
                </div>
                <div className="w-full bg-[#FAF7F2] h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-[#C5A059] h-full rounded-full transition-all"
                    style={{ width: barWidth(reasons?.sizingFit) }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[#5C4D3E] mb-1 font-mono tabular-nums">
                  <span>Transit / Hardware Damage</span>
                  <span className="font-bold text-[#16120E]">
                    {operationalHealth?.returnRateByReason.transitDamage ?? 0}%
                  </span>
                </div>
                <div className="w-full bg-[#FAF7F2] h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-red-700 h-full rounded-full transition-all"
                    style={{ width: barWidth(reasons?.transitDamage) }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Retention Cohorts Box */}
        <div className="p-6 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-6">
          <h2 className="font-display text-xl font-bold text-[#16120E]">
            Quarterly Patron Retention Curves
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="bg-[#FAF7F2] border-b border-[#221C16]/10 text-[#5C4D3E] uppercase text-[10px]">
                  <th className="p-3">Cohort</th>
                  <th className="p-3 text-center">Acquired</th>
                  <th className="p-3 text-center">30-Day Ret.</th>
                  <th className="p-3 text-center">60-Day Ret.</th>
                  <th className="p-3 text-center">90-Day Ret.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#221C16]/5">
                {cohorts.map((c, i) => (
                  <tr key={i} className="hover:bg-[#FAF7F2]/50">
                    <td className="p-3 font-bold text-[#16120E]">{c.cohort}</td>
                    <td className="p-3 text-center tabular-nums">{c.totalPatrons}</td>
                    <td className="p-3 text-center tabular-nums text-emerald-800 font-bold">
                      {c.totalPatrons > 0 ? Math.round((c.day30 / c.totalPatrons) * 100) : 0}%
                    </td>
                    <td className="p-3 text-center tabular-nums text-emerald-800 font-bold">
                      {c.totalPatrons > 0 ? Math.round((c.day60 / c.totalPatrons) * 100) : 0}%
                    </td>
                    <td className="p-3 text-center tabular-nums text-emerald-800 font-bold">
                      {c.totalPatrons > 0 ? Math.round((c.day90 / c.totalPatrons) * 100) : 0}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-3 rounded-lg bg-[#FAF7F2] text-xs text-[#5C4D3E] leading-relaxed">
            <strong>Live Cohort Calculation:</strong> Retention columns compute dynamically from customer acquisition quarters and repeat purchase timestamps in the Bharatvarsh order ledger.
          </div>
        </div>
      </div>

      {/* SKU Reorder Velocity */}
      <div className="p-6 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-4">
        <h2 className="font-display text-xl font-bold text-[#16120E]">
          SKU Reorder Velocity & Demand Forecasting
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {skuVelocity.map((sku) => (
            <div key={sku.sku} className="p-3.5 bg-[#FAF7F2] rounded-lg border border-[#221C16]/10 space-y-1">
              <span className="text-[10px] font-mono text-[#5C4D3E] block truncate">{sku.sku}</span>
              <div className="font-bold text-xs text-[#16120E] truncate">{sku.name}</div>
              <div className="flex items-center justify-between pt-2">
                <span className="font-mono text-sm font-bold text-[#16120E] tabular-nums">
                  {sku.unitsSold30d} sold
                </span>
                <span className="text-[11px] font-mono font-bold text-[#1B332A] tabular-nums">
                  {sku.velocityTrend}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
