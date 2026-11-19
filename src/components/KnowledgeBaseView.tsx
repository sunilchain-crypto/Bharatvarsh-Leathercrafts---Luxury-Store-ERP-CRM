import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Layers,
  Presentation,
  RefreshCw,
  CheckCircle2
} from 'lucide-react';
import { KnowledgeBaseEntry } from '../types';

const CATEGORY_LABELS: Record<KnowledgeBaseEntry['category'], string> = {
  LEATHER_GUIDE: 'Leather Anatomy',
  CARE_MANUAL: 'Care & Patina Manual',
  CRAFT_DECK: 'Atelier Craft Deck',
  SUSTAINABILITY: 'Conscious Materials'
};

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const KnowledgeBaseView: React.FC = () => {
  const [entries, setEntries] = useState<KnowledgeBaseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [slideIndex, setSlideIndex] = useState(0);

  const loadKnowledgeBase = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/knowledge-base');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load Knowledge Base');
      const list: KnowledgeBaseEntry[] = Array.isArray(data.entries) ? data.entries : [];
      setEntries(list);
      if (list.length > 0) {
        setSelectedId(prev => (list.some(e => e.id === prev) ? prev : list[0].id));
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to load leathercraft presentations right now.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKnowledgeBase();
  }, []);

  const selectedEntry = entries.find(e => e.id === selectedId) || entries[0];
  const slides = selectedEntry?.slides || [];
  const activeSlide = slides[slideIndex] || slides[0];

  const handleSelectEntry = (id: string) => {
    setSelectedId(id);
    setSlideIndex(0);
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#221C16]">
      {/* Header Banner */}
      <section className="border-b border-[#E8E2D9] bg-[#16120E] text-[#FAF7F2]">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#C5A059]">
            BHARATVARSH ARCHIVE · PATRON EDUCATION
          </p>
          <div className="mt-3 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h1 className="font-serif text-3xl font-semibold tracking-wide sm:text-4xl">
                Leather Knowledge Base
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#E8E2D9]/85 sm:text-base">
                Explore artisan presentations, hide-grading reference decks, and heirloom
                conditioning manuals curated by the Bharatvarsh Leathercrafts LLP atelier.
              </p>
            </div>
            <button
              onClick={loadKnowledgeBase}
              className="inline-flex items-center gap-2 self-start rounded border border-[#C5A059]/40 px-4 py-2 text-xs font-medium uppercase tracking-wider text-[#FAF7F2] transition hover:border-[#C5A059] hover:text-[#C5A059] md:self-auto"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh Archive
            </button>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            <div className="h-80 animate-pulse rounded-lg bg-[#EDE7DD] lg:col-span-4" />
            <div className="h-80 animate-pulse rounded-lg bg-[#EDE7DD] lg:col-span-8" />
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-lg border border-[#E8E2D9] bg-white p-12 text-center">
            <BookOpen className="mx-auto h-10 w-10 text-[#8B4513]" />
            <h2 className="mt-4 font-serif text-xl font-semibold">No Presentations Published Yet</h2>
            <p className="mt-2 text-sm text-[#6B5D51]">
              Atelier presentations and leather guides will appear here as soon as they are published.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            {/* Sidebar Presentation List */}
            <aside className="space-y-3 lg:col-span-4">
              <div className="flex items-center justify-between border-b border-[#E8E2D9] pb-3">
                <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#6B5D51]">
                  Published Decks ({entries.length})
                </h2>
              </div>

              {entries.map(entry => {
                const isSelected = selectedEntry?.id === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => handleSelectEntry(entry.id)}
                    className={`w-full rounded-lg border p-4 text-left transition ${
                      isSelected
                        ? 'border-[#8B4513] bg-[#F5EFE6] shadow-sm'
                        : 'border-[#E8E2D9] bg-white hover:border-[#C5A059]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-widest text-[#8B4513]">
                      <span>{CATEGORY_LABELS[entry.category] || 'Leather Guide'}</span>
                      <span>
                        {entry.fileType}
                        {entry.sizeBytes ? ` · ${formatBytes(entry.sizeBytes)}` : ''}
                      </span>
                    </div>
                    <h3 className="mt-2 font-serif text-base font-semibold text-[#221C16]">
                      {entry.title}
                    </h3>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[#5C4D40]">
                      {entry.description}
                    </p>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-[#7A6B5D]">
                      <span>
                        Updated{' '}
                        {new Date(entry.uploadedAt).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric'
                        })}
                      </span>
                      {entry.slides && entry.slides.length > 0 && (
                        <span className="font-mono">{entry.slides.length} slides</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </aside>

            {/* Primary Viewer Panel */}
            <main className="lg:col-span-8">
              {selectedEntry && (
                <div className="overflow-hidden rounded-xl border border-[#E8E2D9] bg-white shadow-sm">
                  {/* Presentation Meta Bar */}
                  <div className="flex flex-col justify-between gap-4 border-b border-[#E8E2D9] bg-[#F8F5EF] p-6 sm:flex-row sm:items-center">
                    <div>
                      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-[#8B4513]">
                        <Presentation className="h-3.5 w-3.5" />
                        <span>{CATEGORY_LABELS[selectedEntry.category]}</span>
                        <span>·</span>
                        <span>{selectedEntry.fileType}</span>
                      </div>
                      <h2 className="mt-2 font-serif text-2xl font-semibold text-[#221C16]">
                        {selectedEntry.title}
                      </h2>
                      <p className="mt-1.5 text-sm text-[#5C4D40]">{selectedEntry.description}</p>
                    </div>

                    {selectedEntry.fileUrl && (
                      <a
                        href={selectedEntry.fileUrl}
                        download={selectedEntry.fileName || true}
                        className="inline-flex shrink-0 items-center gap-2 rounded bg-[#221C16] px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-[#FAF7F2] transition hover:bg-[#8B4513]"
                      >
                        <Download className="h-4 w-4" />
                        Download {selectedEntry.fileType}
                      </a>
                    )}
                  </div>

                  {/* Interactive Slide Deck Viewer (if slides exist) */}
                  {slides.length > 0 && activeSlide && (
                    <div className="border-b border-[#E8E2D9] p-6 sm:p-8">
                      <div className="rounded-lg border border-[#E8E2D9] bg-[#16120E] p-6 text-[#FAF7F2] sm:p-10">
                        <div className="flex items-center justify-between font-mono text-xs uppercase tracking-widest text-[#C5A059]">
                          <span>ATELIER PRESENTATION SLIDE</span>
                          <span>
                            SLIDE {String(slideIndex + 1).padStart(2, '0')} /{' '}
                            {String(slides.length).padStart(2, '0')}
                          </span>
                        </div>
                        <h3 className="mt-5 font-serif text-2xl font-semibold text-[#FAF7F2] sm:text-3xl">
                          {activeSlide.title}
                        </h3>
                        {activeSlide.subtitle && (
                          <p className="mt-2 text-sm text-[#C5A059]/90">{activeSlide.subtitle}</p>
                        )}
                        <ul className="mt-6 space-y-3.5">
                          {activeSlide.points.map((pt, idx) => (
                            <li
                              key={idx}
                              className="flex items-start gap-3 text-sm leading-relaxed text-[#E8E2D9]"
                            >
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#C5A059]" />
                              <span>{pt}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Slide Navigation Controls */}
                      <div className="mt-5 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setSlideIndex(prev => Math.max(0, prev - 1))}
                          disabled={slideIndex === 0}
                          className="inline-flex items-center gap-1.5 rounded border border-[#D8CFC3] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[#221C16] transition hover:border-[#8B4513] hover:text-[#8B4513] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ChevronLeft className="h-4 w-4" />
                          Previous Slide
                        </button>
                        <div className="flex items-center gap-1.5">
                          {slides.map((_, idx) => (
                            <button
                              key={idx}
                              type="button"
                              aria-label={`Go to slide ${idx + 1}`}
                              onClick={() => setSlideIndex(idx)}
                              className={`h-2 rounded-full transition-all ${
                                idx === slideIndex ? 'w-6 bg-[#8B4513]' : 'w-2 bg-[#D8CFC3]'
                              }`}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setSlideIndex(prev => Math.min(slides.length - 1, prev + 1))
                          }
                          disabled={slideIndex >= slides.length - 1}
                          className="inline-flex items-center gap-1.5 rounded border border-[#D8CFC3] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[#221C16] transition hover:border-[#8B4513] hover:text-[#8B4513] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Next Slide
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Embedded PDF Viewer */}
                  {selectedEntry.fileUrl && selectedEntry.fileType === 'PDF' && (
                    <div className="p-6">
                      <div className="mb-3 flex items-center justify-between text-xs text-[#6B5D51]">
                        <span className="inline-flex items-center gap-1.5 font-mono uppercase tracking-wider">
                          <FileText className="h-3.5 w-3.5 text-[#8B4513]" />
                          Inline Document Preview · {selectedEntry.fileName || 'Presentation.pdf'}
                        </span>
                      </div>
                      <iframe
                        title={selectedEntry.title}
                        src={selectedEntry.fileUrl}
                        className="h-[520px] w-full rounded-lg border border-[#E8E2D9] bg-[#FAF7F2]"
                      />
                    </div>
                  )}

                  {/* PowerPoint Deck Download & Summary Card */}
                  {selectedEntry.fileUrl &&
                    (selectedEntry.fileType === 'PPTX' || selectedEntry.fileType === 'PPT') && (
                      <div className="p-8 text-center">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#F5EFE6] text-[#8B4513]">
                          <Presentation className="h-7 w-7" />
                        </div>
                        <h3 className="mt-4 font-serif text-xl font-semibold text-[#221C16]">
                          PowerPoint Presentation Ready for Download
                        </h3>
                        <p className="mx-auto mt-2 max-w-lg text-sm text-[#5C4D40]">
                          File: <span className="font-mono">{selectedEntry.fileName}</span>
                          {selectedEntry.sizeBytes ? ` · ${formatBytes(selectedEntry.sizeBytes)}` : ''}
                          . Download the full slide deck to present or review offline in Microsoft
                          PowerPoint, Keynote, or Google Slides.
                        </p>
                        <div className="mt-6">
                          <a
                            href={selectedEntry.fileUrl}
                            download={selectedEntry.fileName || true}
                            className="inline-flex items-center gap-2 rounded bg-[#8B4513] px-6 py-3 text-xs font-semibold uppercase tracking-widest text-white transition hover:bg-[#6e360f]"
                          >
                            <Download className="h-4 w-4" />
                            Download {selectedEntry.fileType} Presentation
                          </a>
                        </div>
                      </div>
                    )}
                </div>
              )}
            </main>
          </div>
        )}

        {/* Hide & Grain Reference Comparison Table */}
        <section className="mt-16 rounded-xl border border-[#E8E2D9] bg-white p-6 sm:p-8">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-[#8B4513]">
            <Layers className="h-4 w-4" />
            <span>MATERIAL SPECIFICATION MATRIX</span>
          </div>
          <h2 className="mt-2 font-serif text-2xl font-semibold text-[#221C16]">
            Understanding Leather Grades &amp; Conscious Substitutes
          </h2>
          <p className="mt-2 text-sm text-[#5C4D40]">
            A transparent comparison of how Bharatvarsh heirloom materials perform over years of
            daily travel versus conventional mass-market alternatives.
          </p>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#E8E2D9] font-mono text-[11px] uppercase tracking-wider text-[#6B5D51]">
                  <th className="py-3 pr-4">Material Standard</th>
                  <th className="px-4 py-3">Tanning / Origin</th>
                  <th className="px-4 py-3">Patina &amp; Aging</th>
                  <th className="px-4 py-3">Expected Lifespan</th>
                  <th className="py-3 pl-4">Bharatvarsh Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFEAE2] text-[#221C16]">
                <tr>
                  <td className="py-4 pr-4 font-serif font-semibold">
                    Full-Grain Vegetable-Tanned Hide
                  </td>
                  <td className="px-4 py-4 text-[#5C4D40]">
                    45-day botanical bark extracts (zero chromium)
                  </td>
                  <td className="px-4 py-4 text-[#5C4D40]">
                    Develops rich, luminous amber patina with use
                  </td>
                  <td className="px-4 py-4 font-mono text-xs">15–30+ years</td>
                  <td className="py-4 pl-4 font-mono text-xs font-semibold text-[#1B332A]">
                    ATELIER SIGNATURE
                  </td>
                </tr>
                <tr>
                  <td className="py-4 pr-4 font-serif font-semibold">
                    Conscious Cactus Bio-Substitute
                  </td>
                  <td className="px-4 py-4 text-[#5C4D40]">
                    Sustainably harvested Nopal cactus fiber matrix
                  </td>
                  <td className="px-4 py-4 text-[#5C4D40]">
                    Consistent matte-satin grain, moisture-resistant
                  </td>
                  <td className="px-4 py-4 font-mono text-xs">8–12+ years</td>
                  <td className="py-4 pl-4 font-mono text-xs font-semibold text-[#1B332A]">
                    CONSCIOUS EDITION
                  </td>
                </tr>
                <tr>
                  <td className="py-4 pr-4 font-serif font-semibold text-[#7A6B5D]">
                    Corrected Top-Grain / Chrome-Tanned
                  </td>
                  <td className="px-4 py-4 text-[#7A6B5D]">
                    Sanded surface with rapid heavy-metal tanning
                  </td>
                  <td className="px-4 py-4 text-[#7A6B5D]">
                    Minimal patina; surface coating eventually dulls
                  </td>
                  <td className="px-4 py-4 font-mono text-xs text-[#7A6B5D]">3–5 years</td>
                  <td className="py-4 pl-4 font-mono text-xs text-[#8B4513]">NOT USED</td>
                </tr>
                <tr>
                  <td className="py-4 pr-4 font-serif font-semibold text-[#7A6B5D]">
                    Genuine / Bonded Split Leather
                  </td>
                  <td className="px-4 py-4 text-[#7A6B5D]">
                    Lower hide fibers bound with synthetic polyurethane
                  </td>
                  <td className="px-4 py-4 text-[#7A6B5D]">Peels and cracks along crease lines</td>
                  <td className="px-4 py-4 font-mono text-xs text-[#7A6B5D]">1–2 years</td>
                  <td className="py-4 pl-4 font-mono text-xs text-[#8B4513]">NEVER USED</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
