import React from 'react';
import { ArrowRight, BookOpen, Compass, ShieldCheck, Sparkles, Leaf, Hammer } from 'lucide-react';

interface OurStoryViewProps {
  onNavigate: (tab: string) => void;
}

export const OurStoryView: React.FC<OurStoryViewProps> = ({ onNavigate }) => {
  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#221C16]">
      {/* Editorial Hero */}
      <section className="relative overflow-hidden border-b border-[#E8E2D9] bg-[#16120E] text-[#FAF7F2]">
        <div className="absolute inset-0">
          <img
            src="/assets/images/hero_leathercraft_workshop_1794461808596.jpg"
            alt="Bharatvarsh Leathercrafts master artisan workbench"
            className="h-full w-full object-cover opacity-35"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#16120E]/95 via-[#16120E]/80 to-[#16120E]/45" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
          <div className="max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-[0.26em] text-[#C5A059]">
              BHARATVARSH LEATHERCRAFTS LLP · HERITAGE &amp; PHILOSOPHY
            </p>
            <h1 className="mt-5 font-serif text-4xl font-semibold leading-[1.12] tracking-wide text-[#FAF7F2] sm:text-5xl lg:text-6xl">
              Carry Your Character.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-[#E8E2D9]/90 sm:text-lg">
              Every silhouette that leaves our atelier begins with a quiet conviction: the objects
              you carry every day should not wear out — they should wear in. Built from unhurried
              vegetable-tanned full-grain hides, conscious botanical substitutes, and solid
              sand-cast brass, a Bharatvarsh piece records the patina of your life&apos;s work.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <button
                onClick={() => onNavigate('storefront')}
                className="inline-flex items-center gap-2.5 rounded bg-[#C5A059] px-6 py-3 text-xs font-semibold uppercase tracking-widest text-[#16120E] transition hover:bg-[#d5b36d]"
              >
                Explore Collections
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => onNavigate('knowledge-base')}
                className="inline-flex items-center gap-2.5 rounded border border-[#C5A059]/60 bg-transparent px-6 py-3 text-xs font-semibold uppercase tracking-widest text-[#FAF7F2] transition hover:border-[#C5A059] hover:bg-[#C5A059]/10"
              >
                <BookOpen className="h-4 w-4 text-[#C5A059]" />
                Leather Knowledge Base
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Brand Ethos Split */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12">
          <div className="lg:col-span-6">
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#8B4513]">
              01 · THE ATELIER ETHOS
            </p>
            <h2 className="mt-3 font-serif text-3xl font-semibold text-[#221C16] sm:text-4xl">
              Unhurried Craft in an Age of Disposable Luxury
            </h2>
            <p className="mt-5 text-sm leading-relaxed text-[#5C4D40] sm:text-base">
              Modern accessories are too often engineered for a single season — coated split hides
              masked with synthetic lacquer, thin electroplated buckles, and rapid machine lock
              stitches that unravel at the first sign of tension.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-[#5C4D40] sm:text-base">
              Bharatvarsh Leathercrafts LLP was founded to honour a slower, more accountable
              standard. Our master leathercrafters cut each panel by hand from full-grain hides
              tanned in botanical bark pits for forty-five days, then stitch every load-bearing
              seam with heavy waxed thread and finish edges with pure organic beeswax.
            </p>
            <div className="mt-8 grid grid-cols-3 gap-6 border-t border-[#E8E2D9] pt-7">
              <div>
                <p className="font-mono text-2xl font-semibold text-[#221C16]">45 Days</p>
                <p className="mt-1 text-xs text-[#6B5D51]">Botanical Pit Tanning</p>
              </div>
              <div>
                <p className="font-mono text-2xl font-semibold text-[#221C16]">100%</p>
                <p className="mt-1 text-xs text-[#6B5D51]">Full-Grain &amp; Bio-Hides</p>
              </div>
              <div>
                <p className="font-mono text-2xl font-semibold text-[#221C16]">2-Year</p>
                <p className="mt-1 text-xs text-[#6B5D51]">Solid Brass Guarantee</p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="overflow-hidden rounded-lg border border-[#E8E2D9] bg-white shadow-sm">
                <img
                  src="/assets/images/custom_debossing_monogram_1794461810572.jpg"
                  alt="Custom brass monogram debossing ritual"
                  className="h-64 w-full object-cover sm:h-72"
                />
                <div className="p-4">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-[#8B4513]">
                    Bespoke Signature
                  </p>
                  <p className="mt-1 font-serif text-sm font-semibold text-[#221C16]">
                    Heated Brass Monogramming
                  </p>
                </div>
              </div>
              <div className="mt-8 overflow-hidden rounded-lg border border-[#E8E2D9] bg-white shadow-sm">
                <img
                  src="/assets/images/mens_collection_editorial_1794461810572.jpg"
                  alt="Vegetable-tanned heirloom leather silhouette"
                  className="h-64 w-full object-cover sm:h-72"
                />
                <div className="p-4">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-[#8B4513]">
                    Living Patina
                  </p>
                  <p className="mt-1 font-serif text-sm font-semibold text-[#221C16]">
                    Rich Amber Aging Character
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Four Pillars */}
      <section className="border-y border-[#E8E2D9] bg-[#F3EFE8] py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#8B4513]">
              02 · FOUR PILLARS OF CRAFT
            </p>
            <h2 className="mt-3 font-serif text-3xl font-semibold text-[#221C16] sm:text-4xl">
              Materials Chosen for Permanence &amp; Conscience
            </h2>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            <article className="rounded-lg border border-[#E8E2D9] bg-[#FAF7F2] p-6">
              <Compass className="h-6 w-6 text-[#8B4513]" />
              <h3 className="mt-5 font-serif text-lg font-semibold text-[#221C16]">
                Full-Grain Vegetable-Tanned Hides
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[#5C4D40]">
                Tanned slowly with natural tree-bark extracts — completely free of heavy-metal
                chromium salts — preserving the hide&apos;s natural tensile density and warm
                earthy character.
              </p>
            </article>

            <article className="rounded-lg border border-[#E8E2D9] bg-[#FAF7F2] p-6">
              <Leaf className="h-6 w-6 text-[#1B332A]" />
              <h3 className="mt-5 font-serif text-lg font-semibold text-[#221C16]">
                Conscious Bio-Substitute Editions
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[#5C4D40]">
                For patrons seeking animal-free craft, our sustainably harvested cactus bio-leather
                delivers remarkable structural resilience, water resistance, and tactile softness.
              </p>
            </article>

            <article className="rounded-lg border border-[#E8E2D9] bg-[#FAF7F2] p-6">
              <Hammer className="h-6 w-6 text-[#8B4513]" />
              <h3 className="mt-5 font-serif text-lg font-semibold text-[#221C16]">
                Hand Saddle-Stitch &amp; Solid Brass
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[#5C4D40]">
                Every stress seam is locked with twin-needle saddle stitching and paired with
                unplated sand-cast solid brass buckles, push-locks, and rivets that mellow gracefully.
              </p>
            </article>

            <article className="rounded-lg border border-[#E8E2D9] bg-[#FAF7F2] p-6">
              <ShieldCheck className="h-6 w-6 text-[#1B332A]" />
              <h3 className="mt-5 font-serif text-lg font-semibold text-[#221C16]">
                Lifetime Heirloom Care Ritual
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[#5C4D40]">
                Each commission arrives with organic beeswax &amp; jojoba conditioning balm, a
                serialized brass hardware guarantee, and complimentary atelier care guidance.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* Closing Atelier Commitment */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-[#E8E2D9] bg-[#16120E] px-6 py-12 text-[#FAF7F2] sm:px-12 sm:py-16">
          <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.22em] text-[#C5A059]">
                <Sparkles className="h-4 w-4" />
                <span>DISCOVER THE SCIENCE OF HIDE &amp; PATINA</span>
              </div>
              <h2 className="mt-3 font-serif text-2xl font-semibold sm:text-3xl">
                Explore Our Curated Leather Knowledge Base
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[#E8E2D9]/85 sm:text-base">
                Browse interactive artisan decks and downloadable guides comparing full-grain
                vegetable-tanned leather, cactus bio-substitutes, seasonal conditioning rituals, and
                heirloom care standards.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => onNavigate('knowledge-base')}
                className="inline-flex items-center gap-2 rounded bg-[#C5A059] px-6 py-3 text-xs font-semibold uppercase tracking-widest text-[#16120E] transition hover:bg-[#d5b36d]"
              >
                Open Knowledge Base
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => onNavigate('storefront')}
                className="inline-flex items-center gap-2 rounded border border-[#FAF7F2]/30 px-6 py-3 text-xs font-semibold uppercase tracking-widest text-[#FAF7F2] transition hover:border-[#C5A059] hover:text-[#C5A059]"
              >
                Shop Heirloom Pieces
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
