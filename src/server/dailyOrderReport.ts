/**
 * Daily Post-Midnight Excel (.xlsx) Order Report Engine
 * Generates an IST (Asia/Kolkata) yesterday order workbook (Orders + Summary sheets)
 * and dispatches it via SMTP to Support@bharatvarshcrafts.com once per calendar day.
 */

import * as XLSX from 'xlsx';
import { db } from './db.ts';
import { sendEmail, getSupportOrderEmailRecipient } from './integrations.ts';
import { Order } from '../types/index.ts';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
let reportTimer: NodeJS.Timeout | null = null;
let reportInFlight = false;

export function getYesterdayIstDateKey(referenceNow: Date = new Date()): string {
  const istNow = new Date(referenceNow.getTime() + IST_OFFSET_MS);
  const yesterdayUtcMidnight = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() - 1)
  );
  return yesterdayUtcMidnight.toISOString().slice(0, 10);
}

export function getIstDayUtcWindow(dateKey: string): { startUtcMs: number; endUtcMs: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`Invalid IST date key "${dateKey}". Expected YYYY-MM-DD.`);
  }
  const [yr, mo, dy] = dateKey.split('-').map(n => parseInt(n, 10));
  const istMidnightAsUtcMs = Date.UTC(yr, mo - 1, dy, 0, 0, 0, 0);
  const startUtcMs = istMidnightAsUtcMs - IST_OFFSET_MS;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000 - 1;
  return { startUtcMs, endUtcMs };
}

function formatIstDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return `${ist.toISOString().slice(0, 19).replace('T', ' ')} IST`;
}

export function generateDailyOrderWorkbook(targetDateIst?: string): {
  dateKey: string;
  filename: string;
  buffer: Buffer;
  orderCount: number;
  grossRevenue: number;
  totalDiscount: number;
  totalTaxableValue: number;
  totalTax: number;
  orders: Order[];
} {
  const dateKey = targetDateIst && /^\d{4}-\d{2}-\d{2}$/.test(targetDateIst)
    ? targetDateIst
    : getYesterdayIstDateKey();

  const { startUtcMs, endUtcMs } = getIstDayUtcWindow(dateKey);
  const allOrders = db.getOrders();
  const invoices = db.getInvoices();

  const dayOrders = allOrders
    .filter(o => {
      const ts = new Date(o.createdAt).getTime();
      return Number.isFinite(ts) && ts >= startUtcMs && ts <= endUtcMs;
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  let grossRevenue = 0;
  let totalDiscount = 0;
  let totalTaxableValue = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let totalTax = 0;

  const orderRows = dayOrders.map(order => {
    const matchedInv = invoices.find(
      inv => inv.orderId === order.id || (order.invoiceNumber && inv.invoiceNumber === order.invoiceNumber)
    );
    const shipCity = order.shippingAddress?.city || order.billingAddress?.city || '';
    const shipState = order.shippingAddress?.state || order.billingAddress?.state || matchedInv?.placeOfSupply || '';
    const pincode = order.shippingAddress?.pincode || order.billingAddress?.pincode || '';

    const taxableValue = matchedInv
      ? Number(matchedInv.taxableValue)
      : Math.max(0, Number(order.subtotal || 0) - Number(order.discountAmount || 0));

    const isInterState = matchedInv
      ? matchedInv.isInterState
      : shipState.trim().toLowerCase() !== 'maharashtra';

    const cgst = matchedInv
      ? Number(matchedInv.cgstAmount || 0)
      : isInterState
      ? 0
      : Math.round(Number(order.taxAmount || 0) / 2);

    const sgst = matchedInv
      ? Number(matchedInv.sgstAmount || 0)
      : isInterState
      ? 0
      : Number(order.taxAmount || 0) - Math.round(Number(order.taxAmount || 0) / 2);

    const igst = matchedInv
      ? Number(matchedInv.igstAmount || 0)
      : isInterState
      ? Number(order.taxAmount || 0)
      : 0;

    const itemsSummary = (order.items || [])
      .map(it => `${it.productName} (${it.sku}) x${it.quantity}`)
      .join('; ');

    const monogramSpecs =
      (order.items || [])
        .filter(it => it.customization?.monogramInitials)
        .map(it => `${it.sku}: ${it.customization!.monogramInitials} (${it.customization!.foilType})`)
        .join('; ') || 'None';

    grossRevenue += Number(order.totalAmount || 0);
    totalDiscount += Number(order.discountAmount || 0);
    totalTaxableValue += taxableValue;
    totalCgst += cgst;
    totalSgst += sgst;
    totalIgst += igst;
    totalTax += cgst + sgst + igst;

    return {
      'Order Number': order.orderNumber,
      'Order Date/Time (IST)': formatIstDateTime(order.createdAt),
      'Invoice Number': order.invoiceNumber || 'Pending / Exempt',
      'Customer Name': order.customerName,
      Email: order.customerEmail,
      Phone: order.customerPhone || '',
      'Shipping City & State': [shipCity, shipState].filter(Boolean).join(', '),
      Pincode: pincode,
      'Items & SKUs': itemsSummary,
      'Monogram Specs': monogramSpecs,
      'Subtotal (INR)': Number(order.subtotal || 0),
      'Discount (INR)': Number(order.discountAmount || 0),
      'Taxable Value (INR)': taxableValue,
      'CGST (INR)': cgst,
      'SGST (INR)': sgst,
      'IGST (INR)': igst,
      'Total Amount (INR)': Number(order.totalAmount || 0),
      'Payment Gateway': order.paymentGateway,
      'Payment Status': order.paymentStatus,
      'Order Status': order.status,
      'AWB Number': order.awbNumber || 'Pending Allocation'
    };
  });

  const summaryRows = [
    { Metric: 'Report Date (IST)', Value: dateKey },
    { Metric: 'Generated At (IST)', Value: formatIstDateTime(new Date().toISOString()) },
    { Metric: 'Total Orders', Value: dayOrders.length },
    { Metric: 'Gross Revenue (INR)', Value: grossRevenue },
    { Metric: 'Total Discounts (INR)', Value: totalDiscount },
    { Metric: 'Total Taxable Value (INR)', Value: totalTaxableValue },
    { Metric: 'Total CGST Collected (INR)', Value: totalCgst },
    { Metric: 'Total SGST Collected (INR)', Value: totalSgst },
    { Metric: 'Total IGST Collected (INR)', Value: totalIgst },
    { Metric: 'Total Tax Collected (INR)', Value: totalTax }
  ];

  const wb = XLSX.utils.book_new();
  const ordersSheet =
    orderRows.length > 0
      ? XLSX.utils.json_to_sheet(orderRows)
      : XLSX.utils.aoa_to_sheet([
          [
            'Order Number',
            'Order Date/Time (IST)',
            'Invoice Number',
            'Customer Name',
            'Email',
            'Phone',
            'Shipping City & State',
            'Pincode',
            'Items & SKUs',
            'Monogram Specs',
            'Subtotal (INR)',
            'Discount (INR)',
            'Taxable Value (INR)',
            'CGST (INR)',
            'SGST (INR)',
            'IGST (INR)',
            'Total Amount (INR)',
            'Payment Gateway',
            'Payment Status',
            'Order Status',
            'AWB Number'
          ]
        ]);

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, ordersSheet, 'Orders');
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  const rawOut = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const buffer = Buffer.isBuffer(rawOut) ? rawOut : Buffer.from(rawOut);
  const filename = `Orders_${dateKey}.xlsx`;

  return {
    dateKey,
    filename,
    buffer,
    orderCount: dayOrders.length,
    grossRevenue,
    totalDiscount,
    totalTaxableValue,
    totalTax,
    orders: dayOrders
  };
}

export async function sendDailyOrdersReport(options?: {
  force?: boolean;
  targetDateIst?: string;
  actorEmail?: string;
}): Promise<{
  success: boolean;
  skipped: boolean;
  dateKey: string;
  filename: string;
  orderCount: number;
  grossRevenue: number;
  totalTax: number;
  deliveryMode: 'LIVE' | 'SANDBOX_FALLBACK';
  messageId?: string;
  fallbackReason?: string;
}> {
  const targetDateKey = options?.targetDateIst && /^\d{4}-\d{2}-\d{2}$/.test(options.targetDateIst)
    ? options.targetDateIst
    : getYesterdayIstDateKey();

  const lastSent = db.getLastDailyReportDate();
  if (!options?.force && lastSent === targetDateKey) {
    return {
      success: true,
      skipped: true,
      dateKey: targetDateKey,
      filename: `Orders_${targetDateKey}.xlsx`,
      orderCount: 0,
      grossRevenue: 0,
      totalTax: 0,
      deliveryMode: 'SANDBOX_FALLBACK',
      fallbackReason: `Report for ${targetDateKey} already dispatched`
    };
  }

  const report = generateDailyOrderWorkbook(targetDateKey);
  const recipient = getSupportOrderEmailRecipient();
  const formattedGross = Math.round(report.grossRevenue).toLocaleString('en-IN');
  const formattedTax = Math.round(report.totalTax).toLocaleString('en-IN');
  const subject = `Daily Order Summary (${report.dateKey}) — ${report.orderCount} Orders | ₹${formattedGross}`;

  const text = [
    `Bharatvarsh Leathercrafts LLP — Daily Order Summary (${report.dateKey} IST)`,
    `Total Orders: ${report.orderCount}`,
    `Gross Revenue: ₹${formattedGross}`,
    `Total Tax Collected: ₹${formattedTax}`,
    '',
    `Attached workbook: ${report.filename} (Sheets: Orders, Summary)`
  ].join('\n');

  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#FAF7F2;padding:24px;color:#16120E;">
    <div style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid #D8CFC2;padding:24px;border-radius:8px;">
      <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#8B4513;font-weight:700;">Bharatvarsh Leathercrafts LLP · Automated Ledger</div>
      <h2 style="font-family:Georgia,serif;font-size:20px;margin:8px 0;">Daily Order Summary (${report.dateKey} IST)</h2>
      <div style="background:#FAF7F2;border:1px solid #E5DDD0;padding:14px;border-radius:6px;font-size:13px;line-height:1.8;font-family:monospace;">
        <div><strong>Total Orders:</strong> ${report.orderCount}</div>
        <div><strong>Gross Revenue:</strong> &#8377;${formattedGross}</div>
        <div><strong>Total Tax Collected:</strong> &#8377;${formattedTax}</div>
      </div>
      <p style="font-size:12px;color:#5C4D3E;margin-top:14px;">
        Full itemized order &amp; GST breakdown workbook is attached as <strong>${report.filename}</strong>.
      </p>
    </div>
  </div>`;

  const delivery = await sendEmail({
    to: recipient,
    subject,
    text,
    html,
    attachments: [
      {
        filename: report.filename,
        content: report.buffer,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }
    ]
  });

  if (delivery.mode === 'LIVE' || !delivery.smtpConfigured) {
    await db.runAtomicMutation(() => {
      if (!options?.targetDateIst || options.targetDateIst === getYesterdayIstDateKey()) {
        db.setLastDailyReportDate(report.dateKey);
      }
      db.logAudit(
        options?.actorEmail || 'daily_report_scheduler',
        'DAILY_ORDER_REPORT_SENT',
        'STORE_MANAGEMENT',
        `Dispatched ${report.filename} to ${recipient} (${report.orderCount} orders, ₹${formattedGross}, Mode: ${delivery.mode})`
      );
    });
  } else {
    db.logAudit(
      options?.actorEmail || 'daily_report_scheduler',
      'DAILY_ORDER_REPORT_ERROR',
      'STORE_MANAGEMENT',
      `Failed live SMTP dispatch of ${report.filename} to ${recipient}: ${delivery.fallbackReason || 'Unknown error'}`
    );
  }

  return {
    success: true,
    skipped: false,
    dateKey: report.dateKey,
    filename: report.filename,
    orderCount: report.orderCount,
    grossRevenue: report.grossRevenue,
    totalTax: report.totalTax,
    deliveryMode: delivery.mode,
    messageId: delivery.messageId,
    fallbackReason: delivery.fallbackReason
  };
}

export async function runScheduledDailyOrderReportIfDue(): Promise<void> {
  if (reportInFlight) return;
  const yesterdayKey = getYesterdayIstDateKey();
  if (db.getLastDailyReportDate() === yesterdayKey) return;

  reportInFlight = true;
  try {
    const result = await sendDailyOrdersReport({ force: false, targetDateIst: yesterdayKey });
    if (!result.skipped) {
      console.log(
        `[DailyOrderReport] Dispatched ${result.filename} (${result.orderCount} orders, mode: ${result.deliveryMode})`
      );
    }
  } catch (err: any) {
    console.error('[DailyOrderReport] Scheduled report failed:', err?.message || err);
  } finally {
    reportInFlight = false;
  }
}

export function startDailyOrderReportScheduler(intervalMs: number = 60000): void {
  if (reportTimer) return;
  // Run initial check shortly after boot so restarts just past 12:00 AM IST catch up safely
  setTimeout(() => {
    runScheduledDailyOrderReportIfDue().catch(() => {});
  }, 5000);
  reportTimer = setInterval(() => {
    runScheduledDailyOrderReportIfDue().catch(() => {});
  }, intervalMs);
  console.log(`[DailyOrderReport] Scheduler active (IST post-midnight check every ${intervalMs / 1000}s)`);
}

export function stopDailyOrderReportScheduler(): void {
  if (reportTimer) {
    clearInterval(reportTimer);
    reportTimer = null;
  }
}
