import React, { useState } from 'react';
import { Sparkles, Shield, ArrowRight, CheckCircle2, Ban } from 'lucide-react';
import { CartItem } from '../types/index.ts';

interface Product {
  id: string;
  category: string;
  productType: string;
  name: string;
  sku: string;
  price: number;
  currency: string;
  description: string;
  features: string[];
  images: string[];
  hsnCode: string;
  gstRate?: number;
  solutionEngine: string;
  inStock: boolean;
  isActive?: boolean;
  stockCount?: number;
  allowCustomization: boolean;
  careKitIncluded: boolean;
}

interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  productTypes: string[];
}

interface StorefrontProps {
  categories: Category[];
  products: Product[];
  bagQtyByProductId?: Record<string, number>;
  onSelectProduct: (product: Product) => void;
  onQuickAdd: (item: CartItem) => void;
}

export const Storefront: React.FC<StorefrontProps> = ({
  categories,
  products,
  bagQtyByProductId = {},
  onSelectProduct,
  onQuickAdd
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedProductType, setSelectedProductType] = useState<string>('all');

  const filteredProducts = products.filter(p => {
    if (selectedCategory !== 'all' && p.category !== selectedCategory) return false;
    if (selectedProductType !== 'all' && p.productType !== selectedProductType) return false;
    return true;
  });

  const currentCategoryObj = categories.find(c => c.id === selectedCategory);
  const availableProductTypes = currentCategoryObj ? currentCategoryObj.productTypes : [];

  return (
    <div className="space-y-16 pb-20">
      {/* 1. Hero Campaign Section: Craftsmanship & Heritage */}
      <section className="relative overflow-hidden bg-[#16120E] text-[#FAF7F2]">
        <div className="max-w-7xl mx-auto px-6 py-16 lg:py-24 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-6 z-10">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.25em] text-[#C5A059]">
              <span>Handcrafted in Pune & Kanpur</span>
              <span aria-hidden="true">·</span>
              <span>Full-Grain Vegetable Tannage</span>
            </div>

            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#FAF7F2] leading-[1.1] text-balance">
              Heirloom Leathercraft Built for Generations.
            </h1>

            <p className="text-base sm:text-lg text-[#EBE4D5]/80 font-sans max-w-xl leading-relaxed">
              Cut from uncorrected 4mm steerhides, saddle-stitched with bonded filament thread, and hand-burnished using pure Himalayan beeswax. Personalize with live brass debossing.
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <a
                href="#collections"
                className="px-6 py-3 text-xs font-bold tracking-widest uppercase text-[#16120E] bg-[#C5A059] hover:bg-[#D4AF37] rounded transition-all shadow-md flex items-center gap-2"
              >
                <span>Explore The Atelier</span>
                <ArrowRight className="w-4 h-4" />
              </a>

              <div className="flex items-center gap-4 text-xs font-mono text-[#EBE4D5]/70 pl-2">
                <span className="flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-[#C5A059]" />
                  2-Yr Hardware Warranty
                </span>
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#C5A059]" />
                  24k Gold Foil Stamping
                </span>
              </div>
            </div>
          </div>

          {/* Hero Photography Asset */}
          <div className="relative aspect-[16/10] lg:aspect-[4/3] rounded-lg overflow-hidden border border-[#C5A059]/20 shadow-2xl">
            <img
              src="/assets/images/hero_leathercraft_workshop_1794461808596.jpg"
              alt="Artisan Leathercraft Workshop Bench"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#16120E]/80 via-transparent to-transparent" />
            <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-xs text-[#EBE4D5]/90 font-mono">
              <span>Atelier Bench No. 04 · Pune Primary Hub</span>
              <span>100% Solid Brass Hardware</span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Signature Atelier Pillars */}
      <section className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-xl bg-white border border-[#221C16]/10 shadow-sm flex flex-col justify-between">
            <div className="space-y-3">
              <span className="text-[11px] font-mono font-bold tracking-widest text-[#8B4513] uppercase block">
                01 · Everyday Carry
              </span>
              <h3 className="font-display text-xl font-bold text-[#16120E]">Everyday Carry</h3>
              <p className="text-xs text-[#5C4D3E] leading-relaxed">
                Slim bifold wallets, hand-creased bridle belts, and key lanyards calibrated to mold to your posture with rich pull-up amber luster.
              </p>
            </div>
            <div className="mt-4 pt-4 border-t border-[#221C16]/10 text-xs font-mono text-[#8B4513] flex items-center gap-1">
              <span>Free Personalization Included</span>
            </div>
          </div>

          <div className="p-6 rounded-xl bg-white border border-[#221C16]/10 shadow-sm flex flex-col justify-between">
            <div className="space-y-3">
              <span className="text-[11px] font-mono font-bold tracking-widest text-[#8B4513] uppercase block">
                02 · Transit Folios
              </span>
              <h3 className="font-display text-xl font-bold text-[#16120E]">Transit Folios</h3>
              <p className="text-xs text-[#5C4D3E] leading-relaxed">
                Water-resistant waxed rucksacks and triple-gusset briefcases tailored for business journeys, fitted with luggage trolley pass-through sleeves.
              </p>
            </div>
            <div className="mt-4 pt-4 border-t border-[#221C16]/10 text-xs font-mono text-[#8B4513] flex items-center gap-1">
              <span>Padded 16" Laptop Armor</span>
            </div>
          </div>

          <div className="p-6 rounded-xl bg-white border border-[#221C16]/10 shadow-sm flex flex-col justify-between">
            <div className="space-y-3">
              <span className="text-[11px] font-mono font-bold tracking-widest text-[#8B4513] uppercase block">
                03 · Lifetime Heirloom Care
              </span>
              <h3 className="font-display text-xl font-bold text-[#16120E]">Lifetime Heirloom Care</h3>
              <p className="text-xs text-[#5C4D3E] leading-relaxed">
                Every purchase automatically registers a 2-year solid hardware warranty and triggers dispatch of an organic beeswax balm conditioning kit.
              </p>
            </div>
            <div className="mt-4 pt-4 border-t border-[#221C16]/10 text-xs font-mono text-[#8B4513] flex items-center gap-1">
              <span>Digital Balm Guides Included</span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Product Catalogue & Browsable Taxonomy */}
      <section id="collections" className="max-w-7xl mx-auto px-6 scroll-mt-24">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-[#221C16]/10">
          <div>
            <div className="text-xs font-mono text-[#8B4513] uppercase tracking-widest">
              Permanent Collection
            </div>
            <h2 className="font-display text-3xl font-bold text-[#16120E] mt-1">
              Curated Leather Masterpieces
            </h2>
          </div>

          <div className="flex items-center gap-2 p-1 bg-[#EBE4D5]/60 rounded-lg">
            <button
              onClick={() => {
                setSelectedCategory('all');
                setSelectedProductType('all');
              }}
              className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors ${
                selectedCategory === 'all'
                  ? 'bg-[#221C16] text-[#FAF7F2] shadow-sm font-semibold'
                  : 'text-[#5C4D3E] hover:text-[#16120E]'
              }`}
            >
              All Pieces
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  setSelectedCategory(cat.id);
                  setSelectedProductType('all');
                }}
                className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors ${
                  selectedCategory === cat.id
                    ? 'bg-[#221C16] text-[#FAF7F2] shadow-sm font-semibold'
                    : 'text-[#5C4D3E] hover:text-[#16120E]'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {availableProductTypes.length > 0 && (
          <div className="flex items-center gap-3 py-4 text-xs">
            <span className="text-[#5C4D3E] font-medium">Types:</span>
            <button
              onClick={() => setSelectedProductType('all')}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                selectedProductType === 'all'
                  ? 'bg-[#8B4513] text-white font-medium'
                  : 'text-[#5C4D3E] hover:text-[#16120E] underline'
              }`}
            >
              All {currentCategoryObj?.name}
            </button>
            {availableProductTypes.map((pt) => (
              <button
                key={pt}
                onClick={() => setSelectedProductType(pt)}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  selectedProductType === pt
                    ? 'bg-[#8B4513] text-white font-medium'
                    : 'text-[#5C4D3E] hover:text-[#16120E] underline'
                }`}
              >
                {pt}
              </button>
            ))}
          </div>
        )}

        {/* Product Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mt-8">
          {filteredProducts.map((product) => {
            const isAvailable = product.inStock !== false && (product.stockCount === undefined || product.stockCount > 0);
            const inBagQty = bagQtyByProductId[product.id] || 0;
            const maxStock = typeof product.stockCount === 'number' ? product.stockCount : Infinity;
            const isAtBagLimit = isAvailable && inBagQty >= maxStock;

            return (
              <div
                key={product.id}
                className={`group bg-white rounded-xl border border-[#221C16]/10 overflow-hidden shadow-sm transition-all duration-200 flex flex-col justify-between ${
                  isAvailable ? 'hover:shadow-md' : 'opacity-80'
                }`}
              >
                <div>
                  <div
                    onClick={() => onSelectProduct(product)}
                    className="relative aspect-[4/3] bg-[#FAF7F2] overflow-hidden cursor-pointer"
                  >
                    <img
                      src={product.images[0]}
                      alt={product.name}
                      referrerPolicy="no-referrer"
                      className={`w-full h-full object-cover transition-transform duration-300 ${
                        isAvailable ? 'group-hover:scale-105' : 'grayscale opacity-55'
                      }`}
                    />
                    <div className="absolute top-3 left-3 bg-[#FAF7F2]/90 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider text-[#16120E]">
                      {product.productType}
                    </div>

                    {!isAvailable ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-[#16120E]/45 backdrop-blur-[1px]">
                        <span className="px-3.5 py-1.5 bg-[#16120E] text-[#FAF7F2] border border-[#C5A059]/40 rounded text-xs font-mono font-bold uppercase tracking-widest flex items-center gap-1.5 shadow-lg">
                          <Ban className="w-3.5 h-3.5 text-red-400" />
                          Out of Stock
                        </span>
                      </div>
                    ) : (
                      product.allowCustomization && (
                        <div className="absolute top-3 right-3 bg-[#16120E]/85 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider text-[#C5A059] flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          Debossing
                        </div>
                      )
                    )}
                  </div>

                  <div className="p-5">
                    <div className="flex items-center justify-between text-[11px] font-mono text-[#8B4513] uppercase tracking-wider">
                      <span>{product.category} · HSN {product.hsnCode}</span>
                      {!isAvailable ? (
                        <span className="text-red-700 font-bold">Out of Stock</span>
                      ) : typeof product.stockCount === 'number' && product.stockCount <= 10 ? (
                        <span className="text-amber-800 font-semibold">
                          {product.stockCount} left{inBagQty > 0 ? ` · ${inBagQty} in bag` : ''}
                        </span>
                      ) : inBagQty > 0 ? (
                        <span className="text-[#5C4D3E] font-semibold">{inBagQty} in bag</span>
                      ) : null}
                    </div>
                    <h3
                      onClick={() => onSelectProduct(product)}
                      className="font-display font-bold text-lg text-[#16120E] mt-1 hover:text-[#8B4513] transition-colors cursor-pointer"
                    >
                      {product.name}
                    </h3>
                    <p className="text-xs text-[#5C4D3E] mt-2 line-clamp-2 leading-relaxed font-sans">
                      {product.description}
                    </p>
                  </div>
                </div>

                <div className="p-5 pt-0 border-t border-[#221C16]/5 mt-2 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] text-[#5C4D3E] block">Price (+ GST)</span>
                    <span className="font-mono text-base font-bold text-[#16120E] tabular-nums">
                      ₹{product.price.toLocaleString('en-IN')}
                    </span>
                  </div>

                  {isAvailable ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectProduct(product)}
                        className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#221C16] border border-[#221C16]/20 rounded hover:bg-[#FAF7F2] transition-colors"
                      >
                        Personalize
                      </button>
                      <button
                        type="button"
                        disabled={isAtBagLimit}
                        title={isAtBagLimit ? `Maximum stock (${maxStock}) already in bag` : 'Add to bag'}
                        onClick={() =>
                          onQuickAdd({
                            productId: product.id,
                            productName: product.name,
                            sku: product.sku,
                            unitPrice: product.price,
                            quantity: 1,
                            leatherType: 'VEGETABLE_TANNED_HERITAGE',
                            imageUrl: product.images[0]
                          })
                        }
                        className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded transition-colors ${
                          isAtBagLimit
                            ? 'bg-[#221C16]/20 text-[#5C4D3E] cursor-not-allowed'
                            : 'text-white bg-[#221C16] hover:bg-[#342B22]'
                        }`}
                      >
                        {isAtBagLimit ? 'Max in Bag' : 'Add'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="px-3.5 py-1.5 text-xs font-mono font-semibold uppercase tracking-wider text-red-800 bg-red-50 border border-red-200 rounded cursor-not-allowed"
                    >
                      Out of Stock
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 4. Brand Craftsmanship & Leather Ethics Commitment */}
      <section className="bg-[#FAF7F2] border-y border-[#221C16]/10 py-16">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div className="space-y-4">
            <span className="text-xs font-mono uppercase tracking-[0.2em] text-[#8B4513]">
              The Bharatvarsh Standard
            </span>
            <h2 className="font-display text-3xl font-bold text-[#16120E]">
              Traceable Kanpur Hides. Assembled in Pune.
            </h2>
            <p className="text-sm text-[#4A3E31] leading-relaxed">
              Modern fast-fashion hides rely on toxic chromium baths that decay within three years. We exclusively use traditional tree bark tannins (mimosa, chestnut, and quebracho) steeped over 60 days and hand-assembled at our Pune Primary Hub. The result is leather that does not wear out—it wears in, accumulating an individual story with every transit.
            </p>
            <div className="grid grid-cols-2 gap-4 pt-2 text-xs text-[#5C4D3E]">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#1B332A]" />
                <span>Zero Chromium-6 Runoff</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#1B332A]" />
                <span>Cast Brass Rivet Hardware</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#1B332A]" />
                <span>GST Compliant Invoicing</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#1B332A]" />
                <span>Shiprocket/Delhivery AWBs</span>
              </div>
            </div>
          </div>

          <div className="relative aspect-[4/3] rounded-xl overflow-hidden border border-[#221C16]/15 shadow-lg">
            <img
              src="/assets/images/custom_debossing_monogram_1794461810572.jpg"
              alt="Artisan Hot Stamping Gold Debossing"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </section>
    </div>
  );
};
