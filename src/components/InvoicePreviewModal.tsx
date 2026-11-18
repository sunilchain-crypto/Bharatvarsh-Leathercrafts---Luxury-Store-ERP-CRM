import React, { useState, useEffect, useRef } from 'react';
import { X, Download, Printer, AlertCircle } from 'lucide-react';

interface InvoicePreviewModalProps {
  documentNumber: string;
  authToken: string;
  onClose: () => void;
}

export async function downloadGstDocumentPdf(documentNumber: string, authToken: string): Promise<void> {
  const slug = documentNumber.replace(/\//g, '-');
  const res = await fetch(`/api/erp/invoices/${encodeURIComponent(slug)}.pdf?download=1`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || 'Failed to download PDF document');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${slug}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const InvoicePreviewModal: React.FC<InvoicePreviewModalProps> = ({
  documentNumber,
  authToken,
  onClose
}) => {
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadHtml = async () => {
      try {
        setError(null);
        const slug = documentNumber.replace(/\//g, '-');
        const res = await fetch(`/api/erp/invoices/${encodeURIComponent(slug)}.pdf?format=html`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || data.error || 'Unable to load GST tax document preview');
        }
        const html = await res.text();
        if (!cancelled) setHtmlContent(html);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Preview failed');
      }
    };
    loadHtml();
    return () => {
      cancelled = true;
    };
  }, [documentNumber, authToken]);

  const handlePrint = () => {
    try {
      iframeRef.current?.contentWindow?.focus();
      iframeRef.current?.contentWindow?.print();
    } catch {
      setError('Unable to trigger print dialog from embedded frame; please use Download PDF.');
    }
  };

  const handleDownloadPdf = async () => {
    setIsDownloading(true);
    try {
      await downloadGstDocumentPdf(documentNumber, authToken);
    } catch (e: any) {
      setError(e?.message || 'PDF download failed');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#16120E]/75 backdrop-blur-sm">
      <div className="bg-[#FAF7F2] rounded-xl border border-[#221C16]/20 shadow-2xl w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="px-5 py-3.5 bg-white border-b border-[#221C16]/10 flex items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-[#8B4513]">
              Statutory GST Tax Document
            </div>
            <h3 className="font-mono text-sm font-bold text-[#16120E]">{documentNumber}</h3>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              disabled={!htmlContent}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-[#221C16]/20 text-[#221C16] rounded hover:bg-[#FAF7F2] disabled:opacity-50"
            >
              <Printer className="w-3.5 h-3.5 text-[#8B4513]" />
              <span>Print</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isDownloading}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22] disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-[#C5A059]" />
              <span>{isDownloading ? 'Preparing PDF...' : 'Download PDF'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-[#5C4D3E] hover:text-[#16120E] rounded hover:bg-[#FAF7F2]"
              aria-label="Close document preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 bg-[#EBE4D5]/40 p-4 overflow-hidden">
          {error ? (
            <div className="p-6 bg-white rounded-lg border border-red-200 text-xs text-red-900 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : !htmlContent ? (
            <div className="h-full flex items-center justify-center text-xs font-mono text-[#5C4D3E]">
              Rendering GST tax document...
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              title={`Tax Document ${documentNumber}`}
              srcDoc={htmlContent}
              className="w-full h-full bg-white rounded border border-[#221C16]/10"
            />
          )}
        </div>
      </div>
    </div>
  );
};
