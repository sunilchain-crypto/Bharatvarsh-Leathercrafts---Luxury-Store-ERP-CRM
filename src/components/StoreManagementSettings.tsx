import React, { useState, useEffect } from 'react';
import { AlertTriangle, Lock, Database, CheckCircle2, Server, Sliders, Plus, Trash2, Radio, FileSpreadsheet } from 'lucide-react';
import { StoreManagementConfig, AuditLogEntry, AuthUser, PromoCodeRule } from '../types/index.ts';

interface MySQLStatus {
  connected: boolean;
  host: string;
  port: number;
  database: string;
  user: string;
  configSource?: 'env' | 'persisted_ui' | 'none';
  lastSyncAt?: string | null;
  lastError?: string | null;
}

interface ProviderReadiness {
  provider: string;
  category: 'PAYMENTS' | 'LOGISTICS' | 'MESSAGING';
  configured: boolean;
  mode: 'LIVE' | 'SANDBOX_FALLBACK';
  summary: string;
}

interface StoreManagementSettingsProps {
  currentUser: AuthUser | null;
  authToken: string;
}

export const StoreManagementSettings: React.FC<StoreManagementSettingsProps> = ({ currentUser, authToken }) => {
  const [config, setConfig] = useState<StoreManagementConfig | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [isMasterSuperAdmin, setIsMasterSuperAdmin] = useState(false);
  const [mysqlStatus, setMysqlStatus] = useState<MySQLStatus | null>(null);
  const [integrations, setIntegrations] = useState<ProviderReadiness[]>([]);
  const [lastPersistError, setLastPersistError] = useState<string | null>(null);

  // Add Authorized Admin User ID Form
  const [newUserId, setNewUserId] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<'STORE_MANAGER' | 'SUPPORT_AGENT' | 'LOGISTICS_COORDINATOR'>('STORE_MANAGER');

  // Operational Rules, GST Metadata & Promo Engine Form
  const [abandonmentMinutes, setAbandonmentMinutes] = useState(15);
  const [supplierGstin, setSupplierGstin] = useState('27AABCB1234F1Z8');
  const [gstRatePercent, setGstRatePercent] = useState(18);
  const [promoCodes, setPromoCodes] = useState<PromoCodeRule[]>([]);
  const [newPromoCode, setNewPromoCode] = useState('');
  const [newPromoDiscount, setNewPromoDiscount] = useState(10);
  const [newPromoDesc, setNewPromoDesc] = useState('');
  const [isSavingRules, setIsSavingRules] = useState(false);

  // Hostinger Local MySQL Configuration Form
  const [mysqlHost, setMysqlHost] = useState('localhost');
  const [mysqlPort, setMysqlPort] = useState(3306);
  const [mysqlDatabase, setMysqlDatabase] = useState('');
  const [mysqlUser, setMysqlUser] = useState('');
  const [mysqlPassword, setMysqlPassword] = useState('');
  const [isConnectingMysql, setIsConnectingMysql] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isTogglingGst, setIsTogglingGst] = useState(false);
  const [lastDailyReportDate, setLastDailyReportDate] = useState<string | null>(null);
  const [isSendingDailyReport, setIsSendingDailyReport] = useState(false);

  const tokenHeader = `Bearer ${authToken}`;

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/store-management/config', {
        headers: { Authorization: tokenHeader }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setConfig(data.config);
        setAuditLogs(data.auditLogs);
        setIsMasterSuperAdmin(data.isMasterSuperAdmin);
        setLastPersistError(data.lastPersistError || null);
        setLastDailyReportDate(data.lastDailyReportDate || null);
        if (Array.isArray(data.integrations)) {
          setIntegrations(data.integrations);
        }
        if (data.config) {
          setAbandonmentMinutes(data.config.abandonmentThresholdMinutes ?? 15);
          setSupplierGstin(data.config.supplierGstin || '27AABCB1234F1Z8');
          setGstRatePercent(data.config.gstRatePercent ?? 18);
          setPromoCodes(Array.isArray(data.config.promoCodes) ? data.config.promoCodes : []);
        }
        if (data.mysqlStatus) {
          setMysqlStatus(data.mysqlStatus);
          setMysqlHost(data.mysqlStatus.host || 'localhost');
          setMysqlPort(data.mysqlStatus.port || 3306);
          setMysqlDatabase((prev) =>
            prev || (data.mysqlStatus.database && data.mysqlStatus.database !== '(not configured)' ? data.mysqlStatus.database : '')
          );
          setMysqlUser((prev) =>
            prev || (data.mysqlStatus.user && data.mysqlStatus.user !== '(not configured)' ? data.mysqlStatus.user : '')
          );
        }
      } else {
        setFeedback({
          type: 'error',
          message: data.message || data.error || 'Access Denied: You are not authorized to view Store Management.'
        });
      }
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message });
    }
  };

  useEffect(() => {
    if (authToken) {
      fetchConfig();
    }
  }, [currentUser, authToken]);

  const handleToggleGst = async () => {
    if (!config) return;
    setIsTogglingGst(true);
    try {
      const res = await fetch('/api/store-management/gst-toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: tokenHeader
        },
        body: JSON.stringify({ enabled: !config.gstInvoicingEnabled })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setConfig((prev) => (prev ? { ...prev, gstInvoicingEnabled: data.gstInvoicingEnabled } : prev));
        setFeedback({ type: 'success', message: data.message });
        fetchConfig();
      } else {
        setFeedback({ type: 'error', message: data.message || data.error || 'Action failed' });
      }
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message });
    } finally {
      setIsTogglingGst(false);
    }
  };

  const handleSendDailyOrderReportNow = async () => {
    setIsSendingDailyReport(true);
    try {
      const res = await fetch('/api/admin/reports/send-daily-orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: tokenHeader
        },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setLastDailyReportDate(data.dateKey || lastDailyReportDate);
        setFeedback({
          type: 'success',
          message: `Daily Excel report ${data.filename} (${data.orderCount} orders, ₹${Math.round(
            data.grossRevenue || 0
          ).toLocaleString('en-IN')}) dispatched via ${data.deliveryMode}${
            data.fallbackReason ? ` (${data.fallbackReason})` : ''
          }.`
        });
        fetchConfig();
      } else {
        setFeedback({
          type: 'error',
          message: data.error || data.message || 'Failed to dispatch daily order report.'
        });
      }
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message });
    } finally {
      setIsSendingDailyReport(false);
    }
  };

  const handleAddPromoCode = () => {
    const clean = newPromoCode.trim().toUpperCase();
    if (!clean) return;
    if (promoCodes.some((p) => p.code.toUpperCase() === clean)) {
      setFeedback({ type: 'error', message: `Promo code "${clean}" already exists in the table.` });
      return;
    }
    const nextPromo: PromoCodeRule = {
      code: clean,
      discountPercent: Math.max(1, Math.min(75, newPromoDiscount || 10)),
      active: true,
      description: newPromoDesc.trim() || `${clean} Storefront Incentive`
    };
    setPromoCodes((prev) => [...prev, nextPromo]);
    setNewPromoCode('');
    setNewPromoDesc('');
  };

  const handleTogglePromoActive = (code: string) => {
    setPromoCodes((prev) =>
      prev.map((p) => (p.code === code ? { ...p, active: !p.active } : p))
    );
  };

  const handleRemovePromo = (code: string) => {
    setPromoCodes((prev) => prev.filter((p) => p.code !== code));
  };

  const handleSaveOperationalRules = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingRules(true);
    try {
      const res = await fetch('/api/store-management/operational-rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: tokenHeader
        },
        body: JSON.stringify({
          abandonmentThresholdMinutes: abandonmentMinutes,
          supplierGstin,
          gstRatePercent,
          promoCodes
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setFeedback({ type: 'success', message: data.message });
        fetchConfig();
      } else {
        setFeedback({ type: 'error', message: data.error || 'Failed to save operational rules' });
      }
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message });
    } finally {
      setIsSavingRules(false);
    }
  };

  const handleAddManager = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserId.trim()) return;

    try {
      const res = await fetch('/api/store-management/permitted-managers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: tokenHeader
        },
        body: JSON.stringify({
          userId: newUserId.trim(),
          displayName: newDisplayName.trim() || undefined,
          password: newPassword || undefined,
          role: newStaffRole
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNewUserId('');
        setNewDisplayName('');
        setNewPassword('');
        setNewStaffRole('STORE_MANAGER');
        setFeedback({ type: 'success', message: data.message });
        fetchConfig();
      } else {
        setFeedback({ type: 'error', message: data.message || data.error || 'Failed to add Admin User ID' });
      }
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message });
    }
  };

  const handleRemoveManager = async (userId: string) => {
    try {
      const res = await fetch(`/api/admin-users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: {
          Authorization: tokenHeader
        }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setFeedback({ type: 'success', message: data.message });
        fetchConfig();
      } else {
        setFeedback({ type: 'error', message: data.message || data.error || 'Failed to revoke Admin User ID' });
      }
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message });
    }
  };

  const handleConnectMySQL = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsConnectingMysql(true);
    try {
      const res = await fetch('/api/store-management/mysql-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: tokenHeader
        },
        body: JSON.stringify({
          host: mysqlHost,
          port: mysqlPort,
          database: mysqlDatabase,
          user: mysqlUser,
          password: mysqlPassword
        })
      });
      const data = await res.json();
      if (data.mysqlStatus) {
        setMysqlStatus(data.mysqlStatus);
      }
      setFeedback({
        type: data.success ? 'success' : 'error',
        message: data.message || data.error || (data.success ? 'Hostinger MySQL connected and synced.' : 'MySQL connection failed.')
      });
      if (data.success) {
        setMysqlPassword('');
        fetchConfig();
      }
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message });
    } finally {
      setIsConnectingMysql(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-[#221C16]/10">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-[#8B4513]">
            <Lock className="w-3.5 h-3.5 text-[#C5A059]" />
            <span>Strict Access Enforced Server-Side · Primary Hub: Pune</span>
          </div>
          <h1 className="font-display text-3xl font-bold text-[#16120E] mt-1">
            Admin Console, Database & Access Control
          </h1>
          <p className="text-xs text-[#5C4D3E] mt-1">
            Manage authorized Admin User IDs, Hostinger local MySQL database, tax/promo rules, and external gateway integrations.
          </p>
        </div>

        <div className="text-xs font-mono bg-white px-3 py-1.5 rounded border shadow-sm">
          Active Identity: <strong className="text-[#16120E]">{currentUser?.email}</strong>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-4 rounded-xl border text-xs font-medium flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-red-50 text-red-900 border-red-200'
          }`}
        >
          <span>{feedback.message}</span>
          <button onClick={() => setFeedback(null)} className="underline ml-4">
            Dismiss
          </button>
        </div>
      )}

      {!config ? (
        <div className="p-12 text-center bg-white rounded-xl border border-red-200 text-xs text-red-800 space-y-2">
          <AlertTriangle className="w-8 h-8 text-red-600 mx-auto" />
          <h3 className="font-bold text-sm">Access Denied</h3>
          <p>
            Your current logged-in identity does not have permission to view or administer the Admin Console.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column (6 Cols) */}
          <div className="lg:col-span-6 space-y-6">
            {/* 1. Hostinger Local MySQL Database Configuration */}
            <div className="p-6 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-bold text-[#16120E] flex items-center gap-2">
                    <Database className="w-4 h-4 text-[#8B4513]" />
                    <span>Hostinger Local MySQL Database</span>
                  </h2>
                  <p className="text-xs text-[#5C4D3E] mt-1 leading-relaxed">
                    Supply your Hostinger local MySQL database name, User ID, and password below (or via server environment variables) for permanent relational persistence across refreshes and restarts.
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 text-[10px] font-mono font-bold rounded border shrink-0 ${
                    mysqlStatus?.connected
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-amber-50 text-amber-900 border-amber-200'
                  }`}
                >
                  {mysqlStatus?.connected ? 'MySQL Connected' : 'Local Disk Fallback'}
                </span>
              </div>

              {mysqlStatus && (
                <div className="p-3 bg-[#FAF7F2] rounded-lg border text-[11px] font-mono space-y-1 text-[#5C4D3E]">
                  <div className="flex items-center gap-1.5 text-[#16120E] font-bold">
                    <Server className="w-3.5 h-3.5 text-[#8B4513]" />
                    <span>
                      Endpoint: {mysqlStatus.host}:{mysqlStatus.port} / DB: {mysqlStatus.database || '(not set)'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>User ID: {mysqlStatus.user || '(not set)'}</span>
                    <span>
                      Source:{' '}
                      {mysqlStatus.configSource === 'env'
                        ? 'Environment Variables'
                        : mysqlStatus.configSource === 'persisted_ui'
                        ? 'Encrypted Saved Config (Auto-Reconnect)'
                        : 'Not Configured'}
                    </span>
                  </div>
                  {mysqlStatus.lastSyncAt && (
                    <div>Last MySQL Sync: {mysqlStatus.lastSyncAt.slice(0, 19).replace('T', ' ')} UTC</div>
                  )}
                  {(mysqlStatus.lastError || lastPersistError) && (
                    <div className={mysqlStatus.connected ? 'text-red-700 font-semibold' : 'text-amber-800'}>
                      {mysqlStatus.connected ? 'Sync Error: ' : 'Status Note: '}
                      {mysqlStatus.lastError || lastPersistError}
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={handleConnectMySQL} className="space-y-3 text-xs pt-2 border-t border-[#221C16]/10">
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-[11px] text-[#5C4D3E] mb-1">MySQL Host</label>
                    <input
                      type="text"
                      required
                      value={mysqlHost}
                      onChange={(e) => setMysqlHost(e.target.value)}
                      placeholder="localhost"
                      className="w-full px-3 py-1.5 bg-[#FAF7F2] border rounded font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#5C4D3E] mb-1">Port</label>
                    <input
                      type="number"
                      required
                      value={mysqlPort}
                      onChange={(e) => setMysqlPort(parseInt(e.target.value || '3306', 10))}
                      className="w-full px-3 py-1.5 bg-[#FAF7F2] border rounded font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-[#5C4D3E] mb-1">Hostinger MySQL Database Name</label>
                  <input
                    type="text"
                    required
                    value={mysqlDatabase}
                    onChange={(e) => setMysqlDatabase(e.target.value)}
                    placeholder="e.g. u123456789_bharatvarsh"
                    className="w-full px-3 py-1.5 bg-[#FAF7F2] border rounded font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-[#5C4D3E] mb-1">MySQL User ID</label>
                    <input
                      type="text"
                      required
                      value={mysqlUser}
                      onChange={(e) => setMysqlUser(e.target.value)}
                      placeholder="e.g. u123456789_admin"
                      className="w-full px-3 py-1.5 bg-[#FAF7F2] border rounded font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#5C4D3E] mb-1">MySQL Password</label>
                    <input
                      type="password"
                      value={mysqlPassword}
                      onChange={(e) => setMysqlPassword(e.target.value)}
                      placeholder="Enter database password"
                      className="w-full px-3 py-1.5 bg-[#FAF7F2] border rounded font-mono"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isConnectingMysql}
                  className="w-full py-2 text-xs font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22] disabled:opacity-60 flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#C5A059]" />
                  <span>{isConnectingMysql ? 'Connecting & Syncing...' : 'Save Credentials & Sync Hostinger MySQL'}</span>
                </button>
              </form>
            </div>

            {/* 2. Operational Rules, GST Metadata & Dynamic Promo Codes */}
            <div className="p-6 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-4">
              <div>
                <h2 className="font-display text-lg font-bold text-[#16120E] flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-[#8B4513]" />
                  <span>Operational Rules, Tax & Promo Engine</span>
                </h2>
                <p className="text-xs text-[#5C4D3E] mt-1">
                  Configure abandoned-cart sweep threshold, supplier GSTIN & rate, and live storefront promo codes.
                </p>
              </div>

              <form onSubmit={handleSaveOperationalRules} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-[#5C4D3E] mb-1">Abandonment (min)</label>
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={abandonmentMinutes}
                      onChange={(e) => setAbandonmentMinutes(Math.max(1, parseInt(e.target.value || '15', 10)))}
                      className="w-full px-3 py-1.5 bg-[#FAF7F2] border rounded font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#5C4D3E] mb-1">Supplier GSTIN</label>
                    <input
                      type="text"
                      value={supplierGstin}
                      onChange={(e) => setSupplierGstin(e.target.value.toUpperCase())}
                      className="w-full px-3 py-1.5 bg-[#FAF7F2] border rounded font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#5C4D3E] mb-1">Default GST (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={28}
                      value={gstRatePercent}
                      onChange={(e) => setGstRatePercent(Math.max(0, Math.min(28, parseInt(e.target.value || '18', 10))))}
                      className="w-full px-3 py-1.5 bg-[#FAF7F2] border rounded font-mono tabular-nums"
                    />
                  </div>
                </div>

                {/* Promo Codes List */}
                <div className="space-y-2 pt-2 border-t border-[#221C16]/10">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-[#5C4D3E]">
                    Active Storefront Promo Codes ({promoCodes.length})
                  </div>

                  <div className="space-y-1.5">
                    {promoCodes.map((promo) => (
                      <div
                        key={promo.code}
                        className="p-2.5 bg-[#FAF7F2] rounded border border-[#221C16]/10 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-mono font-bold text-[#16120E]">
                            {promo.code} · {promo.discountPercent}% OFF
                          </div>
                          {promo.description && (
                            <div className="text-[11px] text-[#5C4D3E] truncate">{promo.description}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleTogglePromoActive(promo.code)}
                            className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded border ${
                              promo.active
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-white text-[#5C4D3E] border-[#221C16]/20'
                            }`}
                          >
                            {promo.active ? 'ACTIVE' : 'PAUSED'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemovePromo(promo.code)}
                            className="p-1 text-red-700 hover:bg-red-50 rounded"
                            title="Delete promo code"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-1.5 pt-1">
                    <input
                      type="text"
                      placeholder="CODE (e.g. FESTIVE15)"
                      value={newPromoCode}
                      onChange={(e) => setNewPromoCode(e.target.value.toUpperCase())}
                      className="sm:col-span-4 px-2.5 py-1.5 bg-[#FAF7F2] border rounded font-mono text-[11px]"
                    />
                    <input
                      type="number"
                      min={1}
                      max={75}
                      value={newPromoDiscount}
                      onChange={(e) => setNewPromoDiscount(parseInt(e.target.value || '10', 10))}
                      className="sm:col-span-2 px-2.5 py-1.5 bg-[#FAF7F2] border rounded font-mono text-[11px]"
                      title="Discount %"
                    />
                    <input
                      type="text"
                      placeholder="Description"
                      value={newPromoDesc}
                      onChange={(e) => setNewPromoDesc(e.target.value)}
                      className="sm:col-span-4 px-2.5 py-1.5 bg-[#FAF7F2] border rounded text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={handleAddPromoCode}
                      className="sm:col-span-2 px-2.5 py-1.5 bg-[#EBE4D5] text-[#16120E] font-semibold rounded hover:bg-[#DFD4BF] flex items-center justify-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSavingRules}
                  className="w-full py-2 text-xs font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22] disabled:opacity-60"
                >
                  {isSavingRules ? 'Saving Operational Rules...' : 'Save Operational Rules & Promos'}
                </button>
              </form>
            </div>

            {/* 3. Authorized Admin User IDs (UI-Based Provisioning) */}
            <div className="p-6 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-4">
              <div>
                <h2 className="font-display text-lg font-bold text-[#16120E]">
                  Authorized Admin User IDs
                </h2>
                <p className="text-xs text-[#5C4D3E] mt-1">
                  Only User IDs listed below can view admin modules and make inventory or catalog changes. Customers never see admin options.
                </p>
              </div>

              {/* Master Super-Admins (Permanent) */}
              <div className="space-y-2">
                <span className="text-[11px] font-mono text-[#8B4513] uppercase tracking-wider block">
                  Founding Master Accounts (Permanent)
                </span>
                <div className="space-y-1.5">
                  {config.masterSuperAdmins.map((adm) => (
                    <div
                      key={adm}
                      className="p-2.5 rounded bg-[#FAF7F2] border text-xs font-mono flex items-center justify-between"
                    >
                      <span className="font-bold text-[#16120E]">{adm}</span>
                      <span className="text-[10px] text-[#8B4513] bg-[#C5A059]/20 px-2 py-0.5 rounded">
                        Master Admin
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Delegated Authorized Admin User IDs */}
              <div className="space-y-2 pt-2 border-t border-[#221C16]/10">
                <span className="text-[11px] font-mono text-[#5C4D3E] uppercase tracking-wider block">
                  Delegated Admin User IDs
                </span>

                <div className="space-y-1.5">
                  {config.permittedStoreManagers
                    .filter((mgr) => !config.masterSuperAdmins.includes(mgr))
                    .map((mgr) => {
                      const cred = config.adminCredentials?.find((c) => c.userId.toLowerCase() === mgr.toLowerCase());
                      const staffRole = cred?.role || 'STORE_MANAGER';
                      const roleLabel =
                        staffRole === 'SUPPORT_AGENT'
                          ? 'Support Agent'
                          : staffRole === 'LOGISTICS_COORDINATOR'
                          ? 'Logistics Coordinator'
                          : 'Store Manager';
                      return (
                        <div
                          key={mgr}
                          className="p-2.5 rounded bg-white border text-xs font-mono flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[#16120E] font-bold truncate">{mgr}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#EBE4D5] text-[#8B4513] font-semibold shrink-0">
                                {roleLabel}
                              </span>
                            </div>
                            {cred?.displayName && (
                              <div className="text-[10px] text-[#5C4D3E] font-sans">
                                {cred.displayName} · Added {cred.addedAt?.slice(0, 10)}
                              </div>
                            )}
                          </div>
                          {isMasterSuperAdmin && (
                            <button
                              onClick={() => handleRemoveManager(mgr)}
                              className="text-red-700 hover:text-red-800 text-[11px] underline shrink-0"
                            >
                              Revoke Access
                            </button>
                          )}
                        </div>
                      );
                    })}
                  {config.permittedStoreManagers.filter((m) => !config.masterSuperAdmins.includes(m)).length === 0 && (
                    <div className="text-[11px] text-[#5C4D3E] italic">
                      No additional delegated Admin User IDs configured yet.
                    </div>
                  )}
                </div>
              </div>

              {/* UI Provisioning Form: Add More Authorized Admin User IDs */}
              {isMasterSuperAdmin && (
                <form onSubmit={handleAddManager} className="pt-3 border-t space-y-2.5 text-xs">
                  <label className="block text-[11px] text-[#16120E] font-semibold">
                    Provision New Authorized Staff / Admin User ID
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      required
                      placeholder="Staff User ID or Email"
                      value={newUserId}
                      onChange={(e) => setNewUserId(e.target.value)}
                      className="px-3 py-1.5 text-xs bg-[#FAF7F2] border rounded focus:outline-none"
                    />
                    <input
                      type="text"
                      placeholder="Display Name"
                      value={newDisplayName}
                      onChange={(e) => setNewDisplayName(e.target.value)}
                      className="px-3 py-1.5 text-xs bg-[#FAF7F2] border rounded focus:outline-none"
                    />
                    <select
                      value={newStaffRole}
                      onChange={(e) =>
                        setNewStaffRole(
                          e.target.value as 'STORE_MANAGER' | 'SUPPORT_AGENT' | 'LOGISTICS_COORDINATOR'
                        )
                      }
                      aria-label="Staff RBAC Role"
                      className="px-3 py-1.5 text-xs bg-[#FAF7F2] border rounded font-mono focus:outline-none"
                    >
                      <option value="STORE_MANAGER">Store Manager (Full Access)</option>
                      <option value="SUPPORT_AGENT">Support Agent (CRM & Inbox)</option>
                      <option value="LOGISTICS_COORDINATOR">Logistics Coordinator (ERP & RMA)</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="Set / update Staff Password (optional; required for password login)"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-xs bg-[#FAF7F2] border rounded focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="px-4 py-1.5 text-xs font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22] shrink-0"
                    >
                      Authorize User ID
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* 4. GST Invoicing Module Toggle */}
            <div className="p-6 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-4">
              <div>
                <h2 className="font-display text-lg font-bold text-[#16120E]">
                  GST Invoicing Module (Pune Primary Hub)
                </h2>
                <p className="text-xs text-[#5C4D3E] mt-1 leading-relaxed">
                  Automated {gstRatePercent}% GST tax invoices and credit notes issued from Maharashtra Primary Hub (GSTIN {supplierGstin}). Every state toggle is recorded permanently in the audit log.
                </p>
              </div>

              <div className="flex items-center justify-between p-4 bg-[#FAF7F2] rounded-lg border">
                <div>
                  <span className="text-xs font-bold text-[#16120E] block">
                    Current Module State:
                  </span>
                  <span
                    className={`text-xs font-mono font-bold ${
                      config.gstInvoicingEnabled ? 'text-emerald-800' : 'text-red-800'
                    }`}
                  >
                    {config.gstInvoicingEnabled ? '● ENABLED (Running)' : '○ SUSPENDED (Halted)'}
                  </span>
                </div>

                <button
                  type="button"
                  disabled={!isMasterSuperAdmin || isTogglingGst}
                  onClick={handleToggleGst}
                  className={`px-4 py-2 rounded text-xs font-bold uppercase tracking-wider transition-colors shadow-sm ${
                    config.gstInvoicingEnabled
                      ? 'bg-red-800 text-white hover:bg-red-900'
                      : 'bg-emerald-800 text-white hover:bg-emerald-900'
                  } disabled:opacity-50`}
                >
                  {config.gstInvoicingEnabled ? 'Suspend Invoicing' : 'Enable Invoicing'}
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: External Integrations Status + Append-Only Audit Log (6 Cols) */}
          <div className="lg:col-span-6 space-y-6">
            {/* External Provider Readiness Card */}
            <div className="p-6 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-4">
              <div>
                <h3 className="font-display text-lg font-bold text-[#16120E] flex items-center gap-2">
                  <Radio className="w-4 h-4 text-[#8B4513]" />
                  <span>External Provider & Gateway Readiness</span>
                </h3>
                <p className="text-xs text-[#5C4D3E] mt-1">
                  Adapters execute live API calls when valid credentials exist in the server environment, and automatically fall back to deterministic sandbox mode otherwise.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                {integrations.map((item) => (
                  <div
                    key={item.provider}
                    className="p-3 rounded-lg bg-[#FAF7F2] border border-[#221C16]/10 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#16120E]">{item.provider}</span>
                      <span
                        className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                          item.mode === 'LIVE'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-amber-50 text-amber-900 border-amber-200'
                        }`}
                      >
                        {item.mode === 'LIVE' ? 'LIVE' : 'SANDBOX'}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#5C4D3E] leading-snug">{item.summary}</div>
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-[#221C16]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-[#16120E] flex items-center gap-1.5">
                    <FileSpreadsheet className="w-4 h-4 text-[#8B4513]" />
                    <span>Daily Post-Midnight Excel Report (.xlsx)</span>
                  </div>
                  <div className="text-[11px] text-[#5C4D3E]">
                    Auto-emails yesterday&apos;s IST order summary to <strong>Support@bharatvarshcrafts.com</strong> after 12:00 AM IST.{' '}
                    <span className="font-mono text-[#16120E]">
                      Last dispatched: {lastDailyReportDate || 'Pending initial run'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!isMasterSuperAdmin || isSendingDailyReport}
                  onClick={handleSendDailyOrderReportNow}
                  title={!isMasterSuperAdmin ? 'Master Super-Admin access required' : undefined}
                  className="px-3.5 py-2 text-xs font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22] disabled:opacity-50 shrink-0"
                >
                  {isSendingDailyReport ? 'Generating Excel...' : "Send Yesterday's Excel Report Now"}
                </button>
              </div>
            </div>

            {/* Audit Trail */}
            <div className="bg-white rounded-xl border border-[#221C16]/10 shadow-sm overflow-hidden flex flex-col h-[700px]">
              <div className="p-4 bg-[#FAF7F2] border-b border-[#221C16]/10 flex items-center justify-between">
                <div>
                  <h3 className="font-display text-base font-bold text-[#16120E]">
                    Regulatory Audit Trail
                  </h3>
                  <span className="text-[11px] text-[#5C4D3E]">
                    Append-only immutable record of system changes
                  </span>
                </div>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-white border text-[#16120E]">
                  {auditLogs.length} events
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-4 divide-y divide-[#221C16]/5 font-mono text-xs">
                {auditLogs.map((log) => (
                  <div key={log.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-[#5C4D3E]">
                      <span className="font-bold text-[#8B4513]">{log.action}</span>
                      <span>{log.timestamp.slice(0, 19).replace('T', ' ')}</span>
                    </div>
                    <div className="text-[#16120E] font-sans text-xs">{log.details}</div>
                    <div className="text-[10px] text-[#5C4D3E]">
                      Actor: <strong className="text-[#16120E]">{log.actorEmail}</strong> · Category: {log.category}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
