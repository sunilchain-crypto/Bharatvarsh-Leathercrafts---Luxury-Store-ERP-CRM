/**
 * GST-Compliant Tax Invoice & Credit Note Renderer
 * Produces deterministic standards-compliant binary PDF 1.4 documents AND print-ready HTML previews,
 * complete with the Bharatvarsh Leathercrafts LLP crest logo, Registered Office address, GSTIN,
 * and auto-filled patron phone & shipping/billing address details.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import {
  Customer,
  CustomerAddress,
  GSTInvoice,
  GSTCreditNote,
  Order,
  StoreManagementConfig
} from '../types/index.ts';

export const REGISTERED_OFFICE_ADDRESS_HTML =
  'NT2-1703, The Crown Greens, Plot 7, Hinjewadi Phase 2, Pune, Maharashtra \u2013 411057';
export const REGISTERED_OFFICE_ADDRESS_PDF =
  'NT2-1703, The Crown Greens, Plot 7, Hinjewadi Phase 2, Pune, Maharashtra - 411057';

export interface InvoiceRecipientFallback {
  customer?: Customer;
  defaultAddress?: CustomerAddress;
}

interface PdfImageResource {
  width: number;
  height: number;
  flateRgb: Buffer;
}

let cachedLogoDataUri: string | null | undefined = undefined;
let cachedLogoPdfImage: PdfImageResource | null | undefined = undefined;

function resolveLogoFilePath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'public', 'assets', 'logo.png'),
    path.resolve(process.cwd(), 'dist', 'assets', 'logo.png'),
    path.resolve(process.cwd(), 'public', 'assets', 'aistudio', 'Circular_with_Stitch_and_ring_Bharatvarsh_2405b0e7.png')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getLogoDataUri(): string | null {
  if (cachedLogoDataUri !== undefined) return cachedLogoDataUri;
  try {
    const filePath = resolveLogoFilePath();
    if (!filePath) {
      cachedLogoDataUri = null;
      return null;
    }
    const buf = fs.readFileSync(filePath);
    cachedLogoDataUri = `data:image/png;base64,${buf.toString('base64')}`;
    return cachedLogoDataUri;
  } catch {
    cachedLogoDataUri = null;
    return null;
  }
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePngToPdfRgb(pngBuf: Buffer): PdfImageResource | null {
  try {
    const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (pngBuf.length < 33 || !pngBuf.subarray(0, 8).equals(PNG_SIG)) {
      return null;
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idatChunks: Buffer[] = [];

    while (offset + 8 <= pngBuf.length) {
      const length = pngBuf.readUInt32BE(offset);
      const type = pngBuf.subarray(offset + 4, offset + 8).toString('ascii');
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > pngBuf.length) break;
      const chunk = pngBuf.subarray(dataStart, dataEnd);

      if (type === 'IHDR') {
        width = chunk.readUInt32BE(0);
        height = chunk.readUInt32BE(4);
        bitDepth = chunk[8];
        colorType = chunk[9];
      } else if (type === 'IDAT') {
        idatChunks.push(chunk);
      } else if (type === 'IEND') {
        break;
      }
      offset = dataEnd + 4;
    }

    if (!width || !height || bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || idatChunks.length === 0) {
      return null;
    }

    const bpp = colorType === 6 ? 4 : 3;
    const stride = width * bpp;
    const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
    if (inflated.length < height * (stride + 1)) {
      return null;
    }

    const rawRgba = Buffer.alloc(height * stride);
    for (let y = 0; y < height; y++) {
      const filterType = inflated[y * (stride + 1)];
      const rowStart = y * (stride + 1) + 1;
      const outStart = y * stride;
      const prevStart = (y - 1) * stride;

      for (let x = 0; x < stride; x++) {
        const raw = inflated[rowStart + x];
        const a = x >= bpp ? rawRgba[outStart + x - bpp] : 0;
        const b = y > 0 ? rawRgba[prevStart + x] : 0;
        const c = x >= bpp && y > 0 ? rawRgba[prevStart + x - bpp] : 0;

        let val = raw;
        if (filterType === 1) val = (raw + a) & 0xff;
        else if (filterType === 2) val = (raw + b) & 0xff;
        else if (filterType === 3) val = (raw + Math.floor((a + b) / 2)) & 0xff;
        else if (filterType === 4) val = (raw + paethPredictor(a, b, c)) & 0xff;
        rawRgba[outStart + x] = val;
      }
    }

    // Composite onto warm parchment header background (#FAF7F2 -> 250, 247, 242)
    const bgR = 250;
    const bgG = 247;
    const bgB = 242;
    const rgbOut = Buffer.alloc(width * height * 3);
    for (let i = 0, j = 0; i < width * height; i++) {
      const srcIdx = i * bpp;
      const r = rawRgba[srcIdx];
      const g = rawRgba[srcIdx + 1];
      const b = rawRgba[srcIdx + 2];
      if (bpp === 4) {
        const alpha = rawRgba[srcIdx + 3] / 255;
        rgbOut[j++] = Math.round(r * alpha + bgR * (1 - alpha));
        rgbOut[j++] = Math.round(g * alpha + bgG * (1 - alpha));
        rgbOut[j++] = Math.round(b * alpha + bgB * (1 - alpha));
      } else {
        rgbOut[j++] = r;
        rgbOut[j++] = g;
        rgbOut[j++] = b;
      }
    }

    return {
      width,
      height,
      flateRgb: zlib.deflateSync(rgbOut)
    };
  } catch {
    return null;
  }
}

function getLogoPdfImage(): PdfImageResource | null {
  if (cachedLogoPdfImage !== undefined) return cachedLogoPdfImage;
  try {
    const filePath = resolveLogoFilePath();
    if (!filePath) {
      cachedLogoPdfImage = null;
      return null;
    }
    cachedLogoPdfImage = decodePngToPdfRgb(fs.readFileSync(filePath));
    return cachedLogoPdfImage;
  } catch {
    cachedLogoPdfImage = null;
    return null;
  }
}

function toPdfAscii(input: string): string {
  return String(input || '')
    .replace(/₹/g, 'Rs. ')
    .replace(/•/g, '-')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E]/g, ' ');
}

function escapePdfString(input: string): string {
  return toPdfAscii(input)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function escapeHtml(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatInrAscii(n: number): string {
  return `Rs. ${Math.round(n).toLocaleString('en-IN')}`;
}

function formatInrHtml(n: number): string {
  return `&#8377;${Math.round(n).toLocaleString('en-IN')}`;
}

function resolveRecipientDetails(
  invoice: GSTInvoice | undefined,
  order: Order | undefined,
  fallback?: InvoiceRecipientFallback
) {
  const addr = order?.shippingAddress || order?.billingAddress || fallback?.defaultAddress;
  const cust = fallback?.customer;
  const name =
    addr?.recipientName ||
    order?.customerName ||
    cust?.fullName ||
    'Valued Patron';
  const email = order?.customerEmail || cust?.email || '';
  const phone = order?.customerPhone || addr?.phone || cust?.phone || '';
  const street = addr?.street || cust?.address || '';
  const city = addr?.city || cust?.city || '';
  const state = addr?.state || cust?.state || invoice?.placeOfSupply || '';
  const pincode = addr?.pincode || cust?.pincode || '';
  const country = addr?.country || 'India';

  const addressParts = [
    street,
    [city, state].filter(Boolean).join(', '),
    pincode ? `PIN: ${pincode}` : '',
    country
  ].filter(Boolean);

  return {
    name,
    email,
    phone,
    street,
    city,
    state,
    pincode,
    country,
    formattedLine: addressParts.join(', ')
  };
}

interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  yOffset?: number;
  x?: number;
  color?: string;
}

/**
 * Generates a clean multi-line single-page A4 PDF 1.4 binary buffer using Helvetica & Helvetica-Bold
 * and embeds the Bharatvarsh Leathercrafts LLP crest logo XObject in the header.
 */
function buildSinglePagePdfBuffer(lines: PdfLine[]): Buffer {
  const logoImg = getLogoPdfImage();
  const ops: string[] = [];

  // Warm parchment header band
  ops.push('0.980 0.969 0.949 rg');
  ops.push('36 734 523 76 re f');
  // Top & bottom subtle accent rules
  ops.push('0.545 0.271 0.075 RG');
  ops.push('1.2 w');
  ops.push('36 734 m 559 734 l S');
  ops.push('0.85 w');
  ops.push('36 58 m 559 58 l S');

  if (logoImg) {
    ops.push('q');
    ops.push('52 0 0 52 44 746 cm');
    ops.push('/Im1 Do');
    ops.push('Q');
  }

  let y = 790;
  for (const line of lines) {
    if (line.yOffset) {
      y -= line.yOffset;
    }
    const font = line.bold ? '/F2' : '/F1';
    const size = line.size || 9.5;
    const xPos = line.x ?? 44;
    const rgb = line.color || '0.086 0.071 0.055';
    ops.push(`${rgb} rg`);
    ops.push('BT');
    ops.push(`${font} ${size} Tf`);
    ops.push(`${xPos} ${y} Td`);
    ops.push(`(${escapePdfString(line.text)}) Tj`);
    ops.push('ET');
    y -= size + 5;
  }

  const streamContent = ops.join('\n');
  const streamLen = Buffer.byteLength(streamContent, 'utf8');

  const xObjectDict = logoImg ? '/XObject << /Im1 7 0 R >> ' : '';
  const chunks: Buffer[] = [];
  const offsets: number[] = [0];
  let bytePos = 0;

  const pushStr = (s: string) => {
    const b = Buffer.from(s, 'utf8');
    chunks.push(b);
    bytePos += b.length;
  };
  const pushObjHeader = () => {
    offsets.push(bytePos);
  };

  pushStr('%PDF-1.4\n');

  pushObjHeader();
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  pushObjHeader();
  pushStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  pushObjHeader();
  pushStr(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> ${xObjectDict}>> /Contents 6 0 R >>\nendobj\n`
  );

  pushObjHeader();
  pushStr('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  pushObjHeader();
  pushStr('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');

  pushObjHeader();
  pushStr(`6 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream\nendobj\n`);

  if (logoImg) {
    pushObjHeader();
    pushStr(
      `7 0 obj\n<< /Type /XObject /Subtype /Image /Width ${logoImg.width} /Height ${logoImg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${logoImg.flateRgb.length} >>\nstream\n`
    );
    chunks.push(logoImg.flateRgb);
    bytePos += logoImg.flateRgb.length;
    pushStr('\nendstream\nendobj\n');
  }

  const totalObjects = offsets.length - 1;
  const xrefPos = bytePos;
  pushStr(`xref\n0 ${totalObjects + 1}\n`);
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i <= totalObjects; i++) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

export function renderTaxInvoicePdf(
  invoice: GSTInvoice,
  order: Order | undefined,
  config: StoreManagementConfig,
  customerFallback?: InvoiceRecipientFallback
): Buffer {
  const gstRate = config.gstRatePercent || 18;
  const halfRate = Number((gstRate / 2).toFixed(2));
  const supplierGstin = invoice.supplierGstin || config.supplierGstin || '27AABCB1234F1Z8';
  const recipient = resolveRecipientDetails(invoice, order, customerFallback);
  const headerX = getLogoPdfImage() ? 106 : 44;

  const lines: PdfLine[] = [
    { text: 'BHARATVARSH LEATHERCRAFTS LLP', size: 14.5, bold: true, x: headerX, color: '0.133 0.110 0.086' },
    {
      text: `TAX INVOICE (ORIGINAL FOR RECIPIENT)  |  GSTIN: ${supplierGstin} (27 - Maharashtra)`,
      size: 8.8,
      bold: true,
      x: headerX,
      color: '0.545 0.271 0.075'
    },
    { text: REGISTERED_OFFICE_ADDRESS_PDF, size: 8.2, x: headerX, color: '0.361 0.302 0.243' },
    {
      text: `Invoice No: ${invoice.invoiceNumber}    Date: ${invoice.invoiceDate.slice(0, 10)}    Order Ref: ${order?.orderNumber || invoice.orderId}`,
      size: 9.5,
      bold: true,
      yOffset: 18
    },
    {
      text: `Place of Supply: ${invoice.placeOfSupply} (${invoice.isInterState ? 'Inter-State IGST' : 'Intra-State CGST + SGST'})    Status: ${invoice.status}`,
      size: 9
    },
    {
      text: `Billed & Shipped To: ${recipient.name}${recipient.phone ? `  |  Phone: ${recipient.phone}` : ''}${recipient.email ? `  |  ${recipient.email}` : ''}`,
      size: 9,
      bold: true,
      yOffset: 8
    },
    {
      text: `Delivery Address: ${recipient.formattedLine || invoice.placeOfSupply}`,
      size: 8.5,
      color: '0.361 0.302 0.243'
    },
    { text: 'ITEMIZED SUPPLY & HSN SCHEDULE', size: 10, bold: true, yOffset: 12, color: '0.545 0.271 0.075' },
    { text: 'SKU              | HSN  | Qty | Unit Price   | Tax      | Line Total', size: 8.5, bold: true }
  ];

  const items = order?.items || [];
  for (const it of items.slice(0, 10)) {
    const skuCol = (it.sku || '').padEnd(16, ' ').slice(0, 16);
    const hsnCol = (it.hsnCode || '4202').padEnd(4, ' ').slice(0, 4);
    const qtyCol = String(it.quantity).padStart(3, ' ');
    const priceCol = formatInrAscii(it.unitPrice).padStart(12, ' ');
    const taxCol = formatInrAscii(it.taxAmount).padStart(8, ' ');
    const totalCol = formatInrAscii(it.lineTotal).padStart(12, ' ');
    lines.push({
      text: `${it.productName}${it.customization?.monogramInitials ? ` [Monogram: ${it.customization.monogramInitials}]` : ''}`,
      size: 9,
      bold: true,
      yOffset: 4
    });
    lines.push({
      text: `${skuCol} | ${hsnCol} | ${qtyCol} | ${priceCol} | ${taxCol} | ${totalCol}`,
      size: 8.5,
      color: '0.25 0.22 0.19'
    });
  }

  lines.push({ text: 'TAXATION & VALUE SUMMARY', size: 10, bold: true, yOffset: 14, color: '0.545 0.271 0.075' });
  if (order && order.discountAmount > 0) {
    lines.push({
      text: `Subtotal Before Privilege (${order.discountCode || 'PROMO'}): ${formatInrAscii(order.subtotal)}   Discount: -${formatInrAscii(order.discountAmount)}`,
      size: 9
    });
  }
  lines.push({ text: `Taxable Value: ${formatInrAscii(invoice.taxableValue)}`, size: 9.5, bold: true });
  if (invoice.isInterState) {
    lines.push({ text: `IGST @ ${gstRate}%: ${formatInrAscii(invoice.igstAmount)}`, size: 9 });
  } else {
    lines.push({
      text: `CGST @ ${halfRate}%: ${formatInrAscii(invoice.cgstAmount)}    SGST @ ${halfRate}%: ${formatInrAscii(invoice.sgstAmount)}`,
      size: 9
    });
  }
  lines.push({ text: `TOTAL TAX INVOICE AMOUNT: ${formatInrAscii(invoice.totalInvoiceAmount)}`, size: 11.5, bold: true, yOffset: 6 });
  lines.push({
    text: 'Statutory Declaration: Certified true & correct under Section 31 of CGST Act, 2017. Includes 2-Year Solid Brass Hardware Warranty.',
    size: 8,
    yOffset: 14,
    color: '0.361 0.302 0.243'
  });

  return buildSinglePagePdfBuffer(lines);
}

export function renderCreditNotePdf(
  creditNote: GSTCreditNote,
  invoice: GSTInvoice | undefined,
  order: Order | undefined,
  config: StoreManagementConfig,
  customerFallback?: InvoiceRecipientFallback
): Buffer {
  const gstRate = config.gstRatePercent || 18;
  const supplierGstin = invoice?.supplierGstin || config.supplierGstin || '27AABCB1234F1Z8';
  const recipient = resolveRecipientDetails(invoice, order, customerFallback);
  const headerX = getLogoPdfImage() ? 106 : 44;

  const lines: PdfLine[] = [
    { text: 'BHARATVARSH LEATHERCRAFTS LLP', size: 14.5, bold: true, x: headerX, color: '0.133 0.110 0.086' },
    {
      text: `GST CREDIT NOTE (RMA / RETURN)  |  GSTIN: ${supplierGstin} (27 - Maharashtra)`,
      size: 8.8,
      bold: true,
      x: headerX,
      color: '0.6 0.12 0.12'
    },
    { text: REGISTERED_OFFICE_ADDRESS_PDF, size: 8.2, x: headerX, color: '0.361 0.302 0.243' },
    { text: `Credit Note No: ${creditNote.creditNoteNumber}    Issued: ${creditNote.issuedAt.slice(0, 10)}`, size: 9.5, bold: true, yOffset: 18 },
    { text: `Original Tax Invoice: ${creditNote.originalInvoiceNumber}    Order Ref: ${order?.orderNumber || creditNote.orderId}`, size: 9 },
    {
      text: `Recipient: ${recipient.name}${recipient.phone ? `  |  Phone: ${recipient.phone}` : ''}${recipient.email ? `  |  ${recipient.email}` : ''}`,
      size: 9,
      bold: true,
      yOffset: 8
    },
    {
      text: `Address: ${recipient.formattedLine || invoice?.placeOfSupply || 'India'}`,
      size: 8.5,
      color: '0.361 0.302 0.243'
    },
    { text: `Return Reason Classification: ${creditNote.reason}`, size: 9.5, bold: true, yOffset: 8 },
    { text: 'CREDIT ADJUSTMENT BREAKDOWN', size: 10, bold: true, yOffset: 14, color: '0.545 0.271 0.075' },
    { text: `Taxable Value Reversed: ${formatInrAscii(creditNote.taxableValue)}`, size: 9.5 },
    {
      text:
        creditNote.igstAmount > 0
          ? `IGST Reversed (${gstRate}%): ${formatInrAscii(creditNote.igstAmount)}`
          : `CGST Reversed: ${formatInrAscii(creditNote.cgstAmount)}    SGST Reversed: ${formatInrAscii(creditNote.sgstAmount)}`,
      size: 9
    },
    { text: `TOTAL GST CREDIT NOTE VALUE: ${formatInrAscii(creditNote.totalCreditAmount)}`, size: 11.5, bold: true, yOffset: 8 },
    {
      text: 'Issued under Section 34 of the Central Goods & Services Tax Act, 2017 · Pune Primary Hub.',
      size: 8,
      yOffset: 14,
      color: '0.361 0.302 0.243'
    }
  ];
  return buildSinglePagePdfBuffer(lines);
}

export function renderTaxInvoiceHtml(
  invoice: GSTInvoice,
  order: Order | undefined,
  config: StoreManagementConfig,
  customerFallback?: InvoiceRecipientFallback
): string {
  const gstRate = config.gstRatePercent || 18;
  const halfRate = Number((gstRate / 2).toFixed(2));
  const supplierGstin = invoice.supplierGstin || config.supplierGstin || '27AABCB1234F1Z8';
  const items = order?.items || [];
  const recipient = resolveRecipientDetails(invoice, order, customerFallback);
  const logoUri = getLogoDataUri() || '/assets/logo.png';

  const rowsHtml = items
    .map(
      (it) => `
      <tr>
        <td>
          <strong>${escapeHtml(it.productName)}</strong>
          <div class="meta">${escapeHtml(it.sku)} · ${it.leatherType === 'BIO_SUBSTITUTE_CACTUS' ? 'Bio-Cactus' : 'Veg-Tanned Steerhide'}${
            it.customization?.monogramInitials ? ` · Monogram "${escapeHtml(it.customization.monogramInitials)}" (${escapeHtml(it.customization.foilType)})` : ''
          }</div>
        </td>
        <td class="mono center">${escapeHtml(it.hsnCode || '4202')}</td>
        <td class="mono center">${it.quantity}</td>
        <td class="mono right">${formatInrHtml(it.unitPrice)}</td>
        <td class="mono right">${formatInrHtml(it.taxAmount)}</td>
        <td class="mono right bold">${formatInrHtml(it.lineTotal)}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Tax Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #16120E; background: #FAF7F2; margin: 0; padding: 28px; }
    .sheet { max-width: 820px; margin: 0 auto; background: #FFFFFF; border: 1px solid #D8CFC2; padding: 36px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; border-bottom: 2px solid #8B4513; padding-bottom: 18px; margin-bottom: 22px; }
    .brand-wrap { display: flex; align-items: center; gap: 14px; }
    .logo { width: 64px; height: 64px; border-radius: 9999px; border: 1px solid #C5A059; object-fit: cover; flex-shrink: 0; background: #FAF7F2; }
    .brand { font-family: Georgia, serif; font-size: 20px; font-weight: 700; letter-spacing: 0.04em; color: #16120E; }
    .sub { font-size: 11.5px; color: #5C4D3E; margin-top: 4px; line-height: 1.5; }
    .doc-label { text-align: right; flex-shrink: 0; }
    .doc-label h1 { font-size: 15px; letter-spacing: 0.14em; text-transform: uppercase; color: #8B4513; margin: 0 0 6px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; font-size: 12px; line-height: 1.6; }
    .box { background: #FAF7F2; border: 1px solid #E5DDD0; padding: 14px; }
    .box-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #8B4513; font-weight: 700; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
    th { background: #FAF7F2; border-top: 1px solid #D8CFC2; border-bottom: 1px solid #D8CFC2; padding: 10px 8px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #5C4D3E; }
    td { padding: 10px 8px; border-bottom: 1px solid #EFEAE2; vertical-align: top; }
    .meta { font-size: 11px; color: #5C4D3E; margin-top: 2px; }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: 700; }
    .totals { max-width: 340px; margin-left: auto; font-size: 12px; }
    .totals-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #EFEAE2; }
    .totals-row.grand { font-size: 15px; font-weight: 700; border-top: 2px solid #16120E; border-bottom: 2px solid #16120E; padding: 10px 0; margin-top: 6px; }
    .footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid #E5DDD0; font-size: 11px; color: #5C4D3E; display: flex; justify-content: space-between; gap: 20px; }
    @media print { body { background: #FFFFFF; padding: 0; } .sheet { border: none; padding: 18px; } .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="brand-wrap">
        <img class="logo" src="${logoUri}" alt="Bharatvarsh Leathercrafts LLP Logo" />
        <div>
          <div class="brand">BHARATVARSH LEATHERCRAFTS LLP</div>
          <div class="sub">
            Registered Office: ${escapeHtml(REGISTERED_OFFICE_ADDRESS_HTML)}<br/>
            Supplier GSTIN: <strong class="mono">${escapeHtml(supplierGstin)}</strong> · State Code: 27 – Maharashtra
          </div>
        </div>
      </div>
      <div class="doc-label">
        <h1>Tax Invoice</h1>
        <div class="mono" style="font-size:13px;font-weight:700;">${escapeHtml(invoice.invoiceNumber)}</div>
        <div class="sub">Date: <span class="mono">${escapeHtml(invoice.invoiceDate.slice(0, 10))}</span> · Status: ${escapeHtml(invoice.status)}</div>
      </div>
    </div>

    <div class="grid">
      <div class="box">
        <div class="box-title">Billed &amp; Shipped To</div>
        <strong>${escapeHtml(recipient.name)}</strong><br/>
        ${recipient.email ? `${escapeHtml(recipient.email)}` : ''}${recipient.phone ? ` · <span class="mono">${escapeHtml(recipient.phone)}</span>` : ''}<br/>
        ${
          recipient.street
            ? `${escapeHtml(recipient.street)}<br/>${escapeHtml(recipient.city)}${recipient.state ? `, ${escapeHtml(recipient.state)}` : ''}${recipient.pincode ? ` – <span class="mono">${escapeHtml(recipient.pincode)}</span>` : ''}<br/>${escapeHtml(recipient.country)}`
            : escapeHtml(invoice.placeOfSupply)
        }
      </div>
      <div class="box">
        <div class="box-title">Supply &amp; Logistics Reference</div>
        Order Number: <strong class="mono">${escapeHtml(order?.orderNumber || invoice.orderId)}</strong><br/>
        Place of Supply: <strong>${escapeHtml(invoice.placeOfSupply)}</strong> (${invoice.isInterState ? 'Inter-State IGST' : 'Intra-State CGST + SGST'})<br/>
        Courier / AWB: <span class="mono">${escapeHtml(order?.courierPartner || 'SHIPROCKET')} · ${escapeHtml(order?.awbNumber || 'Pending')}</span>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description &amp; Craft Specification</th>
          <th class="center">HSN</th>
          <th class="center">Qty</th>
          <th class="right">Unit Rate</th>
          <th class="right">GST (${gstRate}%)</th>
          <th class="right">Line Total</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    <div class="totals">
      <div class="totals-row"><span>Taxable Value</span><span class="mono">${formatInrHtml(invoice.taxableValue)}</span></div>
      ${
        order && order.discountAmount > 0
          ? `<div class="totals-row"><span>Bespoke Privilege (${escapeHtml(order.discountCode || 'PROMO')})</span><span class="mono">-${formatInrHtml(order.discountAmount)}</span></div>`
          : ''
      }
      ${
        invoice.isInterState
          ? `<div class="totals-row"><span>IGST (${gstRate}%)</span><span class="mono">${formatInrHtml(invoice.igstAmount)}</span></div>`
          : `<div class="totals-row"><span>CGST (${halfRate}%)</span><span class="mono">${formatInrHtml(invoice.cgstAmount)}</span></div>
             <div class="totals-row"><span>SGST (${halfRate}%)</span><span class="mono">${formatInrHtml(invoice.sgstAmount)}</span></div>`
      }
      <div class="totals-row grand"><span>Total Invoice Value</span><span class="mono">${formatInrHtml(invoice.totalInvoiceAmount)}</span></div>
    </div>

    <div class="footer">
      <div>Certified under Section 31 of the CGST Act, 2017. Registered Solid Brass Hardware carries a 2-year structural warranty from invoice date.</div>
      <div class="right" style="white-space:nowrap;">Authorized Signatory<br/><strong>Bharatvarsh Leathercrafts LLP</strong></div>
    </div>
  </div>
</body>
</html>`;
}

export function renderCreditNoteHtml(
  creditNote: GSTCreditNote,
  invoice: GSTInvoice | undefined,
  order: Order | undefined,
  config: StoreManagementConfig,
  customerFallback?: InvoiceRecipientFallback
): string {
  const gstRate = config.gstRatePercent || 18;
  const supplierGstin = invoice?.supplierGstin || config.supplierGstin || '27AABCB1234F1Z8';
  const recipient = resolveRecipientDetails(invoice, order, customerFallback);
  const logoUri = getLogoDataUri() || '/assets/logo.png';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>GST Credit Note ${escapeHtml(creditNote.creditNoteNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #16120E; background: #FAF7F2; margin: 0; padding: 28px; }
    .sheet { max-width: 780px; margin: 0 auto; background: #FFFFFF; border: 1px solid #D8CFC2; padding: 36px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; border-bottom: 2px solid #991B1B; padding-bottom: 18px; margin-bottom: 22px; }
    .brand-wrap { display: flex; align-items: center; gap: 14px; }
    .logo { width: 64px; height: 64px; border-radius: 9999px; border: 1px solid #C5A059; object-fit: cover; flex-shrink: 0; background: #FAF7F2; }
    .brand { font-family: Georgia, serif; font-size: 20px; font-weight: 700; color: #16120E; }
    .sub { font-size: 11.5px; color: #5C4D3E; margin-top: 4px; line-height: 1.5; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 20px; font-size: 12px; line-height: 1.65; }
    .box { background: #FAF7F2; border: 1px solid #E5DDD0; padding: 14px; }
    .box-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #991B1B; font-weight: 700; margin-bottom: 6px; }
    .totals { max-width: 340px; margin-left: auto; font-size: 12px; }
    .row { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid #EFEAE2; }
    .grand { font-size: 15px; font-weight: 700; color: #991B1B; border-top: 2px solid #991B1B; border-bottom: 2px solid #991B1B; padding: 10px 0; margin-top: 6px; }
    @media print { body { background: #FFFFFF; padding: 0; } .sheet { border: none; padding: 18px; } }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="brand-wrap">
        <img class="logo" src="${logoUri}" alt="Bharatvarsh Leathercrafts LLP Logo" />
        <div>
          <div class="brand">BHARATVARSH LEATHERCRAFTS LLP</div>
          <div class="sub">
            Registered Office: ${escapeHtml(REGISTERED_OFFICE_ADDRESS_HTML)}<br/>
            Supplier GSTIN: <strong class="mono">${escapeHtml(supplierGstin)}</strong> · State Code: 27 – Maharashtra
          </div>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:14px;font-weight:700;letter-spacing:0.12em;color:#991B1B;text-transform:uppercase;">GST Credit Note</div>
        <div class="mono" style="font-size:13px;font-weight:700;margin-top:4px;">${escapeHtml(creditNote.creditNoteNumber)}</div>
        <div class="sub">Issued: <span class="mono">${escapeHtml(creditNote.issuedAt.slice(0, 10))}</span></div>
      </div>
    </div>

    <div class="grid">
      <div class="box">
        <div class="box-title">Patron Billing &amp; Return Address</div>
        <strong>${escapeHtml(recipient.name)}</strong><br/>
        ${recipient.email ? `${escapeHtml(recipient.email)}` : ''}${recipient.phone ? ` · <span class="mono">${escapeHtml(recipient.phone)}</span>` : ''}<br/>
        ${
          recipient.street
            ? `${escapeHtml(recipient.street)}<br/>${escapeHtml(recipient.city)}${recipient.state ? `, ${escapeHtml(recipient.state)}` : ''}${recipient.pincode ? ` – <span class="mono">${escapeHtml(recipient.pincode)}</span>` : ''}<br/>${escapeHtml(recipient.country)}`
            : escapeHtml(invoice?.placeOfSupply || 'India')
        }
      </div>
      <div class="box">
        <div class="box-title">Credit Note Reference</div>
        Original Tax Invoice: <strong class="mono">${escapeHtml(creditNote.originalInvoiceNumber)}</strong><br/>
        Order Reference: <strong class="mono">${escapeHtml(order?.orderNumber || creditNote.orderId)}</strong><br/>
        Reason Code: <strong class="mono">${escapeHtml(creditNote.reason)}</strong>
      </div>
    </div>

    <div class="totals">
      <div class="row"><span>Taxable Value Reversed</span><span class="mono">${formatInrHtml(creditNote.taxableValue)}</span></div>
      ${
        creditNote.igstAmount > 0
          ? `<div class="row"><span>IGST Reversed (${gstRate}%)</span><span class="mono">${formatInrHtml(creditNote.igstAmount)}</span></div>`
          : `<div class="row"><span>CGST Reversed</span><span class="mono">${formatInrHtml(creditNote.cgstAmount)}</span></div>
             <div class="row"><span>SGST Reversed</span><span class="mono">${formatInrHtml(creditNote.sgstAmount)}</span></div>`
      }
      <div class="row grand"><span>Total Credit Amount</span><span class="mono">${formatInrHtml(creditNote.totalCreditAmount)}</span></div>
    </div>
  </div>
</body>
</html>`;
}
