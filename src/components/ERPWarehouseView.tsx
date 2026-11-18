import React, { useState, useEffect } from 'react';
import { RefreshCw, Plus, AlertCircle, CheckCircle2, X, Eye, Download, AlertTriangle, Sliders } from 'lucide-react';
import { ProductInventory, BillOfMaterialsItem, GSTInvoice, GSTCreditNote, Order } from '../types/index.ts';
import { InvoicePreviewModal, downloadGstDocumentPdf } from './InvoicePreviewModal.tsx';

interface ERPWarehouseViewProps {
  authToken: string;
  onInventoryChanged?: () => void;
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

export const ERPWarehouseView: React.FC<ERPWarehouseViewProps> = ({ authToken, onInventoryChanged }) => {
  const [activeTab, setActiveTab] = useState<'INVENTORY' | 'ORDERS' | 'INVOICES' | 'BOM'>('INVENTORY');
  const [inventory, setInventory] = useState<ProductInventory[]>([]);
  const [bom, setBom] = useState<BillOfMaterialsItem[]>([]);
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlertsState>({
    lowStockSkus: [],
    lowStockBom: []
  });
  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<GSTInvoice[]>([]);
  const [creditNotes, setCreditNotes] = useState<GSTCreditNote[]>([]);
  const [gstEnabled, setGstEnabled] = useState(true);
  const [supplierGstin, setSupplierGstin] = useState('27AABCB1234F1Z8');
  const [gstRatePercent, setGstRatePercent] = useState(18);
  const [erpFeedback, setErpFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [previewDocNumber, setPreviewDocNumber] = useState<string | null>(null);

  // Stock Adjustment Modal
  const [adjustingItem, setAdjustingItem] = useState<ProductInventory | null>(null);
  const [adjustLocation, setAdjustLocation] = useState<'punePrimaryHub' | 'mumbaiWarehouse'>('punePrimaryHub');
  const [newQty, setNewQty] = useState(0);

  // BOM Adjustment Modal
  const [adjustingBom, setAdjustingBom] = useState<BillOfMaterialsItem | null>(null);
  const [bomAdjustOnHand, setBomAdjustOnHand] = useState(0);
  const [bomAdjustSafety, setBomAdjustSafety] = useState(50);

  // RMA Modal
  const [rmaOrder, setRmaOrder] = useState<Order | null>(null);
  const [rmaReason, setRmaReason] = useState<'COLOR_MISMATCH' | 'TEXTURE_DEFECT' | 'HARDWARE_DAMAGE' | 'INCORRECT_SIZE'>('TEXTURE_DEFECT');
  const [restockChecked, setRestockChecked] = useState(true);
  const [restockLocation, setRestockLocation] = useState<'punePrimaryHub' | 'mumbaiWarehouse'>('punePrimaryHub');

  // Add BOM Material Modal
  const [showAddBom, setShowAddBom] = useState(false);
  const [bomMaterialName, setBomMaterialName] = useState('');
  const [bomParentSku, setBomParentSku] = useState('BVL-ALL');
  const [bomQtyPerUnit, setBomQtyPerUnit] = useState(1);
  const [bomUnit, setBomUnit] = useState<'SQ_FT' | 'METERS' | 'PIECES' | 'GRAMS'>('PIECES');
  const [bomOnHand, setBomOnHand] = useState(100);
  const [bomSafetyStock, setBomSafetyStock] = useState(50);
  const [bomVendor, setBomVendor] = useState('');

  const fetchErpData = async () => {
    try {
      const authHeader = { Authorization: `Bearer ${authToken}` };

      const [invRes, ordRes, invcRes, cfgRes] = await Promise.all([
        fetch('/api/erp/inventory', { headers: authHeader }),
        fetch('/api/erp/orders', { headers: authHeader }),
        fetch('/api/erp/invoices', { headers: authHeader }),
        fetch('/api/storefront/config')
      ]);

      const [invData, ordData, invcData, cfgData] = await Promise.all([
        invRes.json(),
        ordRes.json(),
        invcRes.json(),
        cfgRes.json()
      ]);

      if (invData.success) {
        setInventory(invData.inventory);
        setBom(invData.billOfMaterials);
        if (invData.lowStockAlerts) {
          setLowStockAlerts(invData.lowStockAlerts);
        }
      }
      if (ordData.success) setOrders(ordData.orders);
      if (invcData.success) {
        setInvoices(invcData.invoices);
        setCreditNotes(invcData.creditNotes);
        setGstEnabled(invcData.gstEnabled);
      }
      if (cfgData?.success) {
        if (cfgData.supplierGstin) setSupplierGstin(cfgData.supplierGstin);
        if (typeof cfgData.gstRatePercent === 'number') setGstRatePercent(cfgData.gstRatePercent);
      }
    } catch (e) {
      console.warn('ERP fetch error', e);
    }
  };

  useEffect(() => {
    if (authToken) {
      fetchErpData();
    }
  }, [authToken]);

  const showErpBanner = (type: 'success' | 'error', message: string) => {
    setErpFeedback({ type, message });
    if (type === 'success') {
      setTimeout(() => setErpFeedback(null), 4500);
    }
  };

  const handleUpdateOrderStatus = async (orderId: string, status: Order['status']) => {
    try {
      const res = await fetch(`/api/erp/orders/${orderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        fetchErpData();
        const awbMsg = data.logistics?.awbNumber
          ? ` AWB ${data.logistics.awbNumber} allocated via ${data.logistics.courier} (${data.logistics.mode}).`
          : '';
        showErpBanner('success', `Order status updated to ${status}.${awbMsg}`);
      } else {
        showErpBanner('error', data.error || 'Failed to update status');
      }
    } catch (e: any) {
      showErpBanner('error', e?.message || 'Failed to update status');
    }
  };

  const handleSaveStockAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingItem) return;

    try {
      const res = await fetch('/api/erp/inventory/adjust', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          sku: adjustingItem.sku,
          location: adjustLocation,
          newQty
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAdjustingItem(null);
        await fetchErpData();
        onInventoryChanged?.();
        showErpBanner('success', `Inventory count updated for ${adjustingItem.sku}.`);
      } else {
        showErpBanner('error', data.error || 'Adjustment failed');
      }
    } catch (e: any) {
      showErpBanner('error', e?.message || 'Adjustment failed');
    }
  };

  const handleSaveBomAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingBom) return;

    try {
      const res = await fetch(`/api/erp/bom/${encodeURIComponent(adjustingBom.id)}/adjust`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          inventoryOnHand: bomAdjustOnHand,
          safetyStock: bomAdjustSafety
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const name = adjustingBom.materialName;
        setAdjustingBom(null);
        await fetchErpData();
        showErpBanner('success', `Updated BOM raw material stock for "${name}".`);
      } else {
        showErpBanner('error', data.error || 'BOM adjustment failed');
      }
    } catch (e: any) {
      showErpBanner('error', e?.message || 'BOM adjustment failed');
    }
  };

  const handleProcessRma = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rmaOrder) return;

    try {
      const res = await fetch('/api/erp/rma/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          orderId: rmaOrder.id,
          customerId: rmaOrder.customerId,
          reason: rmaReason,
          restockInWarehouse: restockChecked,
          restockLocation
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const hubLabel = restockLocation === 'punePrimaryHub' ? 'Pune Primary Hub' : 'Mumbai Warehouse';
        setRmaOrder(null);
        await fetchErpData();
        onInventoryChanged?.();
        showErpBanner(
          'success',
          restockChecked
            ? `RMA processed and stock returned to ${hubLabel}.`
            : 'RMA processed without restocking inventory.'
        );
      } else {
        showErpBanner('error', data.error || 'RMA processing failed');
      }
    } catch (e: any) {
      showErpBanner('error', e?.message || 'RMA failed');
    }
  };

  const handleAddBomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/erp/bom', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          materialName: bomMaterialName,
          parentSku: bomParentSku,
          quantityPerUnit: bomQtyPerUnit,
          unit: bomUnit,
          inventoryOnHand: bomOnHand,
          safetyStock: bomSafetyStock,
          vendorName: bomVendor
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowAddBom(false);
        setBomMaterialName('');
        setBomVendor('');
        setBomSafetyStock(50);
        fetchErpData();
        showErpBanner('success', 'Raw material entry added to BOM.');
      } else {
        showErpBanner('error', data.error || 'Failed to add BOM item');
      }
    } catch (e: any) {
      showErpBanner('error', e?.message || 'Failed to add BOM item');
    }
  };

  const handleDownloadPdf = async (docNumber: string) => {
    try {
      await downloadGstDocumentPdf(docNumber, authToken);
    } catch (e: any) {
      showErpBanner('error', e?.message || 'Unable to download PDF');
    }
  };

  const totalAlerts = lowStockAlerts.lowStockSkus.length + lowStockAlerts.lowStockBom.length;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-[#221C16]/10">
        <div>
          <span className="text-xs font-mono uppercase tracking-widest text-[#8B4513]">
            Multichannel & Fulfillment Integration
          </span>
          <h1 className="font-display text-3xl font-bold text-[#16120E] mt-1">
            ERP, Inventory & Warehouse Ledger
          </h1>
          <p className="text-xs text-[#5C4D3E] mt-1">
            Multi-location stock tracking (Pune Primary Hub / Mumbai Warehouse), automated BOM consumption, GST invoicing, and logistics.
          </p>
        </div>

        <button
          onClick={fetchErpData}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#221C16] border border-[#221C16]/15 rounded hover:bg-white"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Sync ERP State</span>
        </button>
      </div>

      {erpFeedback && (
        <div
          className={`p-3 rounded-lg border text-xs font-medium flex items-center justify-between gap-2 ${
            erpFeedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {erpFeedback.type === 'error' ? (
              <AlertCircle className="w-4 h-4 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            )}
            <span>{erpFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setErpFeedback(null)}
            className="p-0.5 opacity-70 hover:opacity-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {totalAlerts > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">
                Reorder Attention Required ({lowStockAlerts.lowStockSkus.length} SKU, {lowStockAlerts.lowStockBom.length} BOM Material)
              </div>
              <div className="text-[11px] text-amber-900 mt-0.5 font-mono">
                {[
                  ...lowStockAlerts.lowStockSkus.map((s) => `${s.sku} (${s.totalStock}/${s.safetyStock})`),
                  ...lowStockAlerts.lowStockBom.map((b) => `${b.materialName} (${b.inventoryOnHand}/${b.safetyStock} ${b.unit})`)
                ].join(' · ')}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab(lowStockAlerts.lowStockBom.length > 0 ? 'BOM' : 'INVENTORY')}
            className="px-3 py-1 bg-amber-900 text-white rounded text-[11px] font-semibold shrink-0 hover:bg-amber-950"
          >
            Inspect Low Stock
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[#221C16]/10 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('INVENTORY')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
            activeTab === 'INVENTORY' ? 'bg-[#221C16] text-[#FAF7F2]' : 'text-[#5C4D3E] hover:text-[#16120E]'
          }`}
        >
          Stock by Location ({inventory.length})
        </button>
        <button
          onClick={() => setActiveTab('ORDERS')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
            activeTab === 'ORDERS' ? 'bg-[#221C16] text-[#FAF7F2]' : 'text-[#5C4D3E] hover:text-[#16120E]'
          }`}
        >
          Fulfillment & AWBs ({orders.length})
        </button>
        <button
          onClick={() => setActiveTab('INVOICES')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
            activeTab === 'INVOICES' ? 'bg-[#221C16] text-[#FAF7F2]' : 'text-[#5C4D3E] hover:text-[#16120E]'
          }`}
        >
          GST Invoices & Credit Notes ({invoices.length + creditNotes.length})
        </button>
        <button
          onClick={() => setActiveTab('BOM')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
            activeTab === 'BOM' ? 'bg-[#221C16] text-[#FAF7F2]' : 'text-[#5C4D3E] hover:text-[#16120E]'
          }`}
        >
          Bill of Materials ({bom.length})
        </button>
      </div>

      {/* Tab 1: INVENTORY BY LOCATION */}
      {activeTab === 'INVENTORY' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-[#221C16]/10 shadow-sm overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#FAF7F2] border-b border-[#221C16]/10 text-[11px] font-mono text-[#5C4D3E] uppercase">
                  <th className="p-3.5">SKU / Product Name</th>
                  <th className="p-3.5 text-center">Pune Primary Hub</th>
                  <th className="p-3.5 text-center">Mumbai Hub</th>
                  <th className="p-3.5 text-center">Total On-Hand</th>
                  <th className="p-3.5 text-center">Safety Stock</th>
                  <th className="p-3.5 text-right">Selling Price</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#221C16]/5 font-mono">
                {inventory.map((item) => {
                  const total = item.stockByLocation.punePrimaryHub + item.stockByLocation.mumbaiWarehouse;
                  const isOut = total <= 0;
                  const isLow = total > 0 && total <= item.safetyStock;

                  return (
                    <tr key={item.id} className={`hover:bg-[#FAF7F2]/60 transition-colors ${isOut ? 'bg-red-50/40' : ''}`}>
                      <td className="p-3.5 font-sans font-medium text-[#16120E]">
                        <div className="font-bold flex items-center gap-2">
                          <span>{item.name}</span>
                          {isOut && (
                            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-900">
                              Deactivated
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#5C4D3E] font-mono">
                          {item.sku} · Lot: {item.batchLotNumber}
                        </div>
                      </td>
                      <td className="p-3.5 text-center tabular-nums font-bold">
                        {item.stockByLocation.punePrimaryHub} pcs
                      </td>
                      <td className="p-3.5 text-center tabular-nums font-bold">
                        {item.stockByLocation.mumbaiWarehouse} pcs
                      </td>
                      <td className="p-3.5 text-center tabular-nums">
                        <span
                          className={`px-2 py-0.5 rounded font-bold ${
                            isOut
                              ? 'bg-red-100 text-red-900'
                              : isLow
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {total} pcs {isOut ? '· Out of Stock' : isLow ? '· Low Stock' : ''}
                        </span>
                      </td>
                      <td className="p-3.5 text-center tabular-nums text-[#5C4D3E]">
                        {item.safetyStock} pcs
                      </td>
                      <td className="p-3.5 text-right tabular-nums font-bold text-[#16120E]">
                        ₹{item.sellingPrice.toLocaleString('en-IN')}
                      </td>
                      <td className="p-3.5 text-right">
                        <button
                          onClick={() => {
                            setAdjustingItem(item);
                            setAdjustLocation('punePrimaryHub');
                            setNewQty(item.stockByLocation.punePrimaryHub);
                          }}
                          className="px-2.5 py-1 text-[11px] font-sans font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22]"
                        >
                          Adjust Count
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: FULFILLMENT & ORDERS */}
      {activeTab === 'ORDERS' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-[#221C16]/10 shadow-sm overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#FAF7F2] border-b border-[#221C16]/10 text-[11px] font-mono text-[#5C4D3E] uppercase">
                  <th className="p-3.5">Order / Date</th>
                  <th className="p-3.5">Patron</th>
                  <th className="p-3.5">Fulfillment Status</th>
                  <th className="p-3.5">Courier & AWB</th>
                  <th className="p-3.5 text-right">Amount</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#221C16]/5 font-mono">
                {orders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-[#FAF7F2]/60 transition-colors">
                    <td className="p-3.5">
                      <div className="font-bold text-[#16120E]">{ord.orderNumber}</div>
                      <div className="text-[10px] text-[#5C4D3E]">{ord.createdAt?.slice(0, 10)}</div>
                    </td>
                    <td className="p-3.5 font-sans">
                      <div className="font-semibold text-[#16120E]">{ord.customerName}</div>
                      <div className="text-[11px] text-[#5C4D3E]">{ord.customerEmail}</div>
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          ord.status === 'DELIVERED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : ord.status === 'DISPATCHED'
                            ? 'bg-blue-100 text-blue-800'
                            : ord.status === 'RETURNED'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {ord.status}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <div>{ord.awbNumber || 'Generating AWB...'}</div>
                      <div className="text-[10px] text-[#5C4D3E]">
                        {ord.courierPartner} · {ord.courierStatus}
                      </div>
                    </td>
                    <td className="p-3.5 text-right tabular-nums font-bold text-[#16120E]">
                      ₹{ord.totalAmount.toLocaleString('en-IN')}
                    </td>
                    <td className="p-3.5 text-right font-sans">
                      <div className="flex items-center justify-end gap-1.5">
                        {ord.status === 'PROCESSING' && (
                          <button
                            onClick={() => handleUpdateOrderStatus(ord.id, 'DISPATCHED')}
                            className="px-2 py-1 text-[10px] font-semibold bg-[#221C16] text-[#FAF7F2] rounded"
                          >
                            Dispatch Batch
                          </button>
                        )}
                        {ord.status === 'DISPATCHED' && (
                          <button
                            onClick={() => handleUpdateOrderStatus(ord.id, 'DELIVERED')}
                            className="px-2 py-1 text-[10px] font-semibold bg-emerald-800 text-white rounded"
                          >
                            Mark Delivered
                          </button>
                        )}
                        {ord.status !== 'RETURNED' && (
                          <button
                            onClick={() => {
                              setRestockChecked(true);
                              setRestockLocation('punePrimaryHub');
                              setRmaOrder(ord);
                            }}
                            className="px-2 py-1 text-[10px] font-semibold border border-red-300 text-red-800 rounded hover:bg-red-50"
                          >
                            Initiate RMA
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: GST INVOICES & CREDIT NOTES */}
      {activeTab === 'INVOICES' && (
        <div className="space-y-6">
          <div className="p-4 rounded-xl bg-white border border-[#221C16]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold text-[#16120E]">
                GST Invoicing Module Status
              </h3>
              <p className="text-xs text-[#5C4D3E]">
                Statutory GSTIN: <strong className="font-mono text-[#16120E]">{supplierGstin}</strong> (Rate: {gstRatePercent}% · Pune Primary Hub)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`px-3 py-1 text-xs font-mono font-bold rounded border ${
                  gstEnabled
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                    : 'bg-red-50 text-red-800 border-red-300'
                }`}
              >
                {gstEnabled ? 'Active · Generation Enabled' : 'Suspended by Store Management'}
              </span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-[#221C16]/10 shadow-sm overflow-x-auto">
            <div className="p-3.5 bg-[#FAF7F2] border-b border-[#221C16]/10 font-bold text-xs text-[#16120E]">
              Tax Invoices Issued ({invoices.length})
            </div>
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-[#221C16]/10 text-[11px] text-[#5C4D3E] uppercase">
                  <th className="p-3.5">Invoice No.</th>
                  <th className="p-3.5">Supply State</th>
                  <th className="p-3.5 text-right">Taxable Value</th>
                  <th className="p-3.5 text-right">CGST / SGST</th>
                  <th className="p-3.5 text-right">IGST</th>
                  <th className="p-3.5 text-right">Total Invoice</th>
                  <th className="p-3.5 text-right font-sans">Tax Document</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#221C16]/5">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-[#FAF7F2]/60">
                    <td className="p-3.5 font-bold text-[#16120E]">{inv.invoiceNumber}</td>
                    <td className="p-3.5 text-[#5C4D3E]">
                      {inv.placeOfSupply} {inv.isInterState ? '(Inter-State)' : '(Intra-State)'}
                    </td>
                    <td className="p-3.5 text-right tabular-nums">₹{inv.taxableValue.toLocaleString('en-IN')}</td>
                    <td className="p-3.5 text-right tabular-nums text-[#5C4D3E]">
                      ₹{(inv.cgstAmount + inv.sgstAmount).toLocaleString('en-IN')}
                    </td>
                    <td className="p-3.5 text-right tabular-nums text-[#8B4513]">
                      ₹{inv.igstAmount.toLocaleString('en-IN')}
                    </td>
                    <td className="p-3.5 text-right tabular-nums font-bold text-[#16120E]">
                      ₹{inv.totalInvoiceAmount.toLocaleString('en-IN')}
                    </td>
                    <td className="p-3.5 text-right font-sans">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPreviewDocNumber(inv.invoiceNumber)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold border border-[#221C16]/20 text-[#221C16] rounded hover:bg-[#FAF7F2]"
                        >
                          <Eye className="w-3 h-3 text-[#8B4513]" />
                          <span>Preview / Print</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadPdf(inv.invoiceNumber)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22]"
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

          {creditNotes.length > 0 && (
            <div className="bg-white rounded-xl border border-[#221C16]/10 shadow-sm overflow-x-auto">
              <div className="p-3.5 bg-red-50/60 border-b border-red-200 font-bold text-xs text-red-900">
                GST Credit Notes ({creditNotes.length})
              </div>
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead>
                  <tr className="border-b border-[#221C16]/10 text-[11px] text-[#5C4D3E] uppercase">
                    <th className="p-3.5">Credit Note No.</th>
                    <th className="p-3.5">Against Invoice</th>
                    <th className="p-3.5">Reason</th>
                    <th className="p-3.5 text-right">Total Credit Value</th>
                    <th className="p-3.5 text-right font-sans">Credit Note Doc</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#221C16]/5">
                  {creditNotes.map((cn) => (
                    <tr key={cn.id}>
                      <td className="p-3.5 font-bold text-red-900">{cn.creditNoteNumber}</td>
                      <td className="p-3.5 text-[#5C4D3E]">{cn.originalInvoiceNumber}</td>
                      <td className="p-3.5 text-[#5C4D3E]">{cn.reason}</td>
                      <td className="p-3.5 text-right tabular-nums font-bold text-red-900">
                        ₹{cn.totalCreditAmount.toLocaleString('en-IN')}
                      </td>
                      <td className="p-3.5 text-right font-sans">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPreviewDocNumber(cn.creditNoteNumber)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold border border-[#221C16]/20 text-[#221C16] rounded hover:bg-[#FAF7F2]"
                          >
                            <Eye className="w-3 h-3 text-[#8B4513]" />
                            <span>Preview</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadPdf(cn.creditNoteNumber)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22]"
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

      {/* Tab 4: BILL OF MATERIALS (BOM) */}
      {activeTab === 'BOM' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-[#221C16]/10 shadow-sm overflow-x-auto">
            <div className="p-3.5 bg-[#FAF7F2] border-b border-[#221C16]/10 font-bold text-xs text-[#16120E] flex items-center justify-between">
              <span>Raw Materials & Supply Chain Sourcing ({bom.length})</span>
              <button
                onClick={() => setShowAddBom(true)}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22]"
              >
                <Plus className="w-3.5 h-3.5 text-[#C5A059]" />
                <span>Add Raw Material</span>
              </button>
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#221C16]/10 text-[11px] font-mono text-[#5C4D3E] uppercase">
                  <th className="p-3.5">Raw Material</th>
                  <th className="p-3.5">Target SKU</th>
                  <th className="p-3.5">Qty / Finished Unit</th>
                  <th className="p-3.5">Inventory On Hand</th>
                  <th className="p-3.5">Safety Threshold</th>
                  <th className="p-3.5">Guild / Vendor Partner</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#221C16]/5 font-mono">
                {bom.map((b) => {
                  const threshold = typeof b.safetyStock === 'number' ? b.safetyStock : 50;
                  const isLow = b.inventoryOnHand <= threshold;
                  return (
                    <tr key={b.id} className={`hover:bg-[#FAF7F2]/60 ${isLow ? 'bg-amber-50/40' : ''}`}>
                      <td className="p-3.5 font-sans font-semibold text-[#16120E]">
                        <div className="flex items-center gap-2">
                          <span>{b.materialName}</span>
                          {isLow && (
                            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">
                              Reorder
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3.5 text-[#5C4D3E]">{b.parentSku}</td>
                      <td className="p-3.5 tabular-nums">{b.quantityPerUnit} {b.unit}</td>
                      <td className={`p-3.5 font-bold tabular-nums ${isLow ? 'text-amber-900' : 'text-[#1B332A]'}`}>
                        {b.inventoryOnHand} {b.unit}
                      </td>
                      <td className="p-3.5 tabular-nums text-[#5C4D3E]">{threshold} {b.unit}</td>
                      <td className="p-3.5 font-sans text-[#5C4D3E]">{b.vendorName}</td>
                      <td className="p-3.5 text-right font-sans">
                        <button
                          type="button"
                          onClick={() => {
                            setAdjustingBom(b);
                            setBomAdjustOnHand(b.inventoryOnHand);
                            setBomAdjustSafety(threshold);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22]"
                        >
                          <Sliders className="w-3 h-3 text-[#C5A059]" />
                          <span>Replenish</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Adjust Stock Count */}
      {adjustingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#16120E]/70 backdrop-blur-sm">
          <div className="bg-white rounded-xl border p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="font-display text-lg font-bold text-[#16120E]">
              Adjust Inventory Count
            </h3>
            <p className="text-xs text-[#5C4D3E]">
              Item: <strong>{adjustingItem.name}</strong> ({adjustingItem.sku})
            </p>
            <p className="text-[11px] text-[#8B4513] bg-[#FAF7F2] p-2 rounded border">
              Setting total stock across locations to 0 automatically deactivates this product as Out of Stock. Changes persist permanently in the database.
            </p>

            <form onSubmit={handleSaveStockAdjust} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#5C4D3E] mb-1">Target Location</label>
                <select
                  value={adjustLocation}
                  onChange={(e) => {
                    const loc = e.target.value as 'punePrimaryHub' | 'mumbaiWarehouse';
                    setAdjustLocation(loc);
                    setNewQty(adjustingItem.stockByLocation[loc]);
                  }}
                  className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                >
                  <option value="punePrimaryHub">Pune Primary Hub</option>
                  <option value="mumbaiWarehouse">Mumbai Warehouse Hub</option>
                </select>
              </div>

              <div>
                <label className="block text-[#5C4D3E] mb-1">New Verified Count (pcs)</label>
                <input
                  type="number"
                  min={0}
                  value={newQty}
                  onChange={(e) => setNewQty(Math.max(0, parseInt(e.target.value || '0', 10)))}
                  className="w-full px-3 py-1.5 border rounded font-mono font-bold bg-[#FAF7F2]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setAdjustingItem(null)}
                  className="px-3 py-1.5 border rounded text-[#5C4D3E]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#221C16] text-[#FAF7F2] font-semibold rounded hover:bg-[#342B22]"
                >
                  Save Permanently
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Replenish / Adjust BOM Material */}
      {adjustingBom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#16120E]/70 backdrop-blur-sm">
          <div className="bg-white rounded-xl border p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="font-display text-lg font-bold text-[#16120E]">
              Replenish BOM Raw Material
            </h3>
            <p className="text-xs text-[#5C4D3E]">
              <strong>{adjustingBom.materialName}</strong> ({adjustingBom.parentSku})
            </p>
            <form onSubmit={handleSaveBomAdjust} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#5C4D3E] mb-1">
                  Inventory On Hand ({adjustingBom.unit})
                </label>
                <input
                  type="number"
                  min={0}
                  value={bomAdjustOnHand}
                  onChange={(e) => setBomAdjustOnHand(Math.max(0, parseInt(e.target.value || '0', 10)))}
                  className="w-full px-3 py-1.5 border rounded font-mono font-bold bg-[#FAF7F2]"
                />
              </div>

              <div>
                <label className="block text-[#5C4D3E] mb-1">
                  Safety Reorder Threshold ({adjustingBom.unit})
                </label>
                <input
                  type="number"
                  min={0}
                  value={bomAdjustSafety}
                  onChange={(e) => setBomAdjustSafety(Math.max(0, parseInt(e.target.value || '0', 10)))}
                  className="w-full px-3 py-1.5 border rounded font-mono bg-[#FAF7F2]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setAdjustingBom(null)}
                  className="px-3 py-1.5 border rounded text-[#5C4D3E]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#221C16] text-[#FAF7F2] font-semibold rounded hover:bg-[#342B22]"
                >
                  Save BOM Stock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add BOM Material */}
      {showAddBom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#16120E]/70 backdrop-blur-sm">
          <div className="bg-white rounded-xl border p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="font-display text-lg font-bold text-[#16120E]">
              Add Bill of Materials Entry
            </h3>
            <form onSubmit={handleAddBomSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#5C4D3E] mb-1">Raw Material Name</label>
                <input
                  type="text"
                  required
                  value={bomMaterialName}
                  onChange={(e) => setBomMaterialName(e.target.value)}
                  placeholder="e.g. Solid Brass YKK #8 Zipper Coil"
                  className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[#5C4D3E] mb-1">Target SKU</label>
                  <input
                    type="text"
                    required
                    value={bomParentSku}
                    onChange={(e) => setBomParentSku(e.target.value)}
                    className="w-full px-3 py-1.5 border rounded font-mono bg-[#FAF7F2]"
                  />
                </div>
                <div>
                  <label className="block text-[#5C4D3E] mb-1">Unit</label>
                  <select
                    value={bomUnit}
                    onChange={(e) => setBomUnit(e.target.value as any)}
                    className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                  >
                    <option value="SQ_FT">SQ_FT</option>
                    <option value="METERS">METERS</option>
                    <option value="PIECES">PIECES</option>
                    <option value="GRAMS">GRAMS</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[#5C4D3E] mb-1">Qty Per Unit</label>
                  <input
                    type="number"
                    min={1}
                    value={bomQtyPerUnit}
                    onChange={(e) => setBomQtyPerUnit(parseInt(e.target.value || '1', 10))}
                    className="w-full px-3 py-1.5 border rounded font-mono bg-[#FAF7F2]"
                  />
                </div>
                <div>
                  <label className="block text-[#5C4D3E] mb-1">On Hand</label>
                  <input
                    type="number"
                    min={0}
                    value={bomOnHand}
                    onChange={(e) => setBomOnHand(parseInt(e.target.value || '0', 10))}
                    className="w-full px-3 py-1.5 border rounded font-mono bg-[#FAF7F2]"
                  />
                </div>
                <div>
                  <label className="block text-[#5C4D3E] mb-1">Safety Alert</label>
                  <input
                    type="number"
                    min={0}
                    value={bomSafetyStock}
                    onChange={(e) => setBomSafetyStock(parseInt(e.target.value || '0', 10))}
                    className="w-full px-3 py-1.5 border rounded font-mono bg-[#FAF7F2]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[#5C4D3E] mb-1">Vendor / Tannery Partner</label>
                <input
                  type="text"
                  required
                  value={bomVendor}
                  onChange={(e) => setBomVendor(e.target.value)}
                  placeholder="e.g. Pune Precision Hardware Works"
                  className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddBom(false)}
                  className="px-3 py-1.5 border rounded text-[#5C4D3E]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#221C16] text-[#FAF7F2] font-semibold rounded hover:bg-[#342B22]"
                >
                  Add Material
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: RMA Return */}
      {rmaOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#16120E]/70 backdrop-blur-sm">
          <div className="bg-white rounded-xl border p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="font-display text-lg font-bold text-[#16120E]">
              Initiate RMA Return & Credit Note
            </h3>
            <p className="text-xs text-[#5C4D3E]">
              Order: <strong className="font-mono text-[#16120E]">{rmaOrder.orderNumber}</strong> ({rmaOrder.customerName})
            </p>

            <form onSubmit={handleProcessRma} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#5C4D3E] mb-1">Return Reason</label>
                <select
                  value={rmaReason}
                  onChange={(e) => setRmaReason(e.target.value as any)}
                  className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                >
                  <option value="COLOR_MISMATCH">Color / Texture Expectation Mismatch</option>
                  <option value="TEXTURE_DEFECT">Natural Leather Grain Defect</option>
                  <option value="HARDWARE_DAMAGE">Solid Brass Hardware Transit Damage</option>
                  <option value="INCORRECT_SIZE">Waist Size Belt Exchange</option>
                </select>
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={restockChecked}
                  onChange={(e) => setRestockChecked(e.target.checked)}
                />
                <span>Restock inspected piece into warehouse inventory</span>
              </label>

              {restockChecked && (
                <div>
                  <label className="block text-[#5C4D3E] mb-1">Destination Warehouse Hub</label>
                  <select
                    value={restockLocation}
                    onChange={(e) => setRestockLocation(e.target.value as 'punePrimaryHub' | 'mumbaiWarehouse')}
                    className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                  >
                    <option value="punePrimaryHub">Pune Primary Hub</option>
                    <option value="mumbaiWarehouse">Mumbai Warehouse</option>
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setRmaOrder(null)}
                  className="px-3 py-1.5 border rounded text-[#5C4D3E]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-red-800 text-white font-semibold rounded hover:bg-red-900"
                >
                  Authorize RMA & Credit Note
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {previewDocNumber && (
        <InvoicePreviewModal
          documentNumber={previewDocNumber}
          authToken={authToken}
          onClose={() => setPreviewDocNumber(null)}
        />
      )}
    </div>
  );
};
