import React, { useState, useEffect } from 'react';
import { X, Sparkles, Shield, Droplets, Award, Ban } from 'lucide-react';
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
  stockCount?: number;
  allowCustomization: boolean;
  careKitIncluded: boolean;
}

interface ProductDetailModalProps {
  product: Product | null;
  bagQuantityForProduct?: number;
  defaultGstRatePercent?: number;
  onClose: () => void;
  onAddToCart: (item: CartItem) => void;
  customerId?: string;
  authToken?: string;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product,
  bagQuantityForProduct = 0,
  defaultGstRatePercent = 18,
  onClose,
  onAddToCart,
  customerId,
  authToken
}) => {
  const [selectedImage, setSelectedImage] = useState(product?.images?.[0] || '');
  const [leatherType, setLeatherType] = useState<'VEGETABLE_TANNED_HERITAGE' | 'BIO_SUBSTITUTE_CACTUS'>('VEGETABLE_TANNED_HERITAGE');
  const [monogram, setMonogram] = useState('BLC');
  const [foilStyle, setFoilStyle] = useState<'BLIND' | 'GOLD_FOIL' | 'SILVER_FOIL'>('GOLD_FOIL');
  const [isDebossingActive, setIsDebossingActive] = useState(true);

  useEffect(() => {
    if (!product) return;
    setSelectedImage(product.images?.[0] || '');
    setLeatherType('VEGETABLE_TANNED_HERITAGE');
    setMonogram('BLC');
    setFoilStyle('GOLD_FOIL');
    setIsDebossingActive(true);
  }, [product?.id]);

  if (!product) return null;

  const isAvailable = product.inStock !== false && (product.stockCount === undefined || product.stockCount > 0);
  const maxStock = typeof product.stockCount === 'number' ? product.stockCount : Infinity;
  const remainingStock = Math.max(0, maxStock - bagQuantityForProduct);
  const isAtBagLimit = isAvailable && remainingStock <= 0;
  const effectiveGstPercent =
    typeof product.gstRate === 'number'
      ? Number((product.gstRate * 100).toFixed(2))
      : defaultGstRatePercent;

  const handleAdd = async () => {
    if (!isAvailable || isAtBagLimit) return;

    if (isDebossingActive && monogram.trim()) {
      try {
        await fetch('/api/personalization-vector', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
          },
          body: JSON.stringify({
            customerId: customerId || 'cust_guest',
            productId: product.id,
            productName: product.name,
            monogramText: monogram.toUpperCase().trim(),
            foilStyle,
            fontFamily: 'CINZEL'
          })
        });
      } catch (e) {
        console.warn('Vector save failed:', e);
      }
    }

    onAddToCart({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      unitPrice: product.price,
      quantity: 1,
      leatherType,
      monogram: isDebossingActive ? monogram.toUpperCase().trim() : undefined,
      foilStyle: isDebossingActive ? foilStyle : undefined,
      imageUrl: selectedImage || product.images[0]
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-[#16120E]/70 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-4xl max-h-[92vh] overflow-y-auto bg-[#FAF7F2] rounded-xl border border-[#221C16]/15 shadow-2xl text-[#221C16]">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 text-[#5C4D3E] hover:text-[#16120E] bg-[#EBE4D5]/80 hover:bg-[#EBE4D5] rounded-full transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-6 sm:p-8">
          <div className="flex flex-col gap-4">
            <div className="relative aspect-[4/3] w-full rounded-lg overflow-hidden bg-[#221C16]/5 border border-[#221C16]/10">
              <img
                src={selectedImage}
                alt={product.name}
                referrerPolicy="no-referrer"
                className={`w-full h-full object-cover transition-transform duration-300 ${
                  isAvailable ? 'hover:scale-105' : 'grayscale opacity-60'
                }`}
              />
              <div className="absolute bottom-3 left-3 bg-[#16120E]/80 backdrop-blur-md px-2.5 py-1 rounded text-[11px] font-mono text-[#FAF7F2] tracking-wider uppercase">
                {leatherType === 'VEGETABLE_TANNED_HERITAGE' ? 'Heritage Full-Grain Hide' : 'Organic Cactus Bio-Leather'}
              </div>
              {!isAvailable && (
                <div className="absolute top-3 left-3 bg-red-800 text-white px-2.5 py-1 rounded text-[11px] font-mono font-bold uppercase tracking-wider">
                  Out of Stock · Deactivated
                </div>
              )}
            </div>

            {product.images.length > 1 && (
              <div className="flex items-center gap-3">
                {product.images.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedImage(img)}
                    className={`relative w-20 h-16 rounded border overflow-hidden transition-all ${
                      selectedImage === img
                        ? 'border-[#8B4513] ring-2 ring-[#8B4513]/30'
                        : 'border-[#221C16]/15 opacity-70 hover:opacity-100'
                    }`}
                  >
                    <img src={img} alt="Thumbnail" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-[#221C16]/10 space-y-2.5 text-xs text-[#5C4D3E]">
              <div className="flex items-center gap-2.5">
                <Shield className="w-4 h-4 text-[#8B4513] shrink-0" />
                <span>2-Year Hardware & Solid Brass Rivet Warranty Included</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Droplets className="w-4 h-4 text-[#8B4513] shrink-0" />
                <span>Complimentary Organic Beeswax Conditioning Kit Dispatched</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Award className="w-4 h-4 text-[#C5A059] shrink-0" />
                <span>Atelier Heirloom Certified · Lifetime Reconditioning</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-[#8B4513]">
                <span>{product.category}</span>
                <span aria-hidden="true">·</span>
                <span>{product.productType}</span>
                <span aria-hidden="true">·</span>
                <span>HSN {product.hsnCode}</span>
              </div>

              <h2 className="font-display font-bold text-2xl sm:text-3xl text-[#16120E] mt-1 tracking-tight">
                {product.name}
              </h2>

              <div className="flex items-baseline gap-3 mt-3">
                <span className="font-mono text-2xl font-bold text-[#16120E] tabular-nums">
                  ₹{product.price.toLocaleString('en-IN')}
                </span>
                <span className="text-xs text-[#5C4D3E] font-sans">
                  (+ {effectiveGstPercent}% GST at checkout · Dispatched from Pune Primary Hub)
                </span>
              </div>

              <p className="mt-4 text-sm text-[#4A3E31] leading-relaxed font-sans">
                {product.description}
              </p>

              <div className="mt-5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#221C16] mb-2">
                  Select Hide Material
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setLeatherType('VEGETABLE_TANNED_HERITAGE')}
                    className={`p-3 text-left rounded-lg border text-xs transition-all ${
                      leatherType === 'VEGETABLE_TANNED_HERITAGE'
                        ? 'border-[#8B4513] bg-[#EBE4D5]/40 text-[#16120E] font-medium ring-1 ring-[#8B4513]'
                        : 'border-[#221C16]/15 hover:border-[#221C16]/30 text-[#5C4D3E]'
                    }`}
                  >
                    <div className="font-semibold text-sm">Vegetable-Tanned Hide</div>
                    <div className="text-[11px] opacity-80 mt-0.5">Kanpur Steer · Rich Patina</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLeatherType('BIO_SUBSTITUTE_CACTUS')}
                    className={`p-3 text-left rounded-lg border text-xs transition-all ${
                      leatherType === 'BIO_SUBSTITUTE_CACTUS'
                        ? 'border-[#8B4513] bg-[#EBE4D5]/40 text-[#16120E] font-medium ring-1 ring-[#8B4513]'
                        : 'border-[#221C16]/15 hover:border-[#221C16]/30 text-[#5C4D3E]'
                    }`}
                  >
                    <div className="font-semibold text-sm">Bio-Cactus Leather</div>
                    <div className="text-[11px] opacity-80 mt-0.5">Desert Nopal · Organic Plant</div>
                  </button>
                </div>
              </div>

              {/* Live Debossing Preview Module */}
              <div className="mt-6 p-4 rounded-xl bg-[#221C16]/5 border border-[#221C16]/15">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#C5A059]" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#16120E]">
                      Live Debossing & Hot Stamping
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsDebossingActive(!isDebossingActive)}
                    className="text-xs text-[#8B4513] underline font-medium"
                  >
                    {isDebossingActive ? 'Remove Monogram' : 'Add Personalization'}
                  </button>
                </div>

                {isDebossingActive ? (
                  <div className="space-y-4">
                    <div className="relative h-28 w-full rounded-lg bg-gradient-to-br from-[#271E17] via-[#1D1611] to-[#120E0A] flex flex-col items-center justify-center p-4 shadow-inner border border-[#C5A059]/20 overflow-hidden">
                      <div className="absolute inset-0 opacity-15 pointer-events-none bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:12px_12px]" />

                      <div className="relative text-center">
                        <span className="text-[10px] tracking-[0.2em] uppercase text-[#A75D28] font-mono block mb-1">
                          Artisan Heated Brass Die
                        </span>
                        <div
                          className={`font-display text-4xl sm:text-5xl font-bold tracking-[0.3em] uppercase select-none transition-all ${
                            foilStyle === 'GOLD_FOIL'
                              ? 'gold-foil-deboss'
                              : foilStyle === 'SILVER_FOIL'
                              ? 'silver-foil-deboss'
                              : 'blind-deboss'
                          }`}
                        >
                          {monogram || 'BLC'}
                        </div>
                        <span className="text-[9px] text-[#C5A059]/80 font-mono tracking-wider mt-1 block">
                          HAND-PRESSED AT PUNE ATELIER
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-[#5C4D3E] mb-1">
                          Monogram (1-4 Chars)
                        </label>
                        <input
                          type="text"
                          maxLength={4}
                          value={monogram}
                          onChange={(e) => setMonogram(e.target.value.toUpperCase())}
                          placeholder="e.g. V.S"
                          className="w-full px-3 py-1.5 text-xs font-mono font-bold tracking-widest bg-white border border-[#221C16]/20 rounded focus:outline-none focus:border-[#8B4513]"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-[#5C4D3E] mb-1">
                          Foil Finish
                        </label>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setFoilStyle('GOLD_FOIL')}
                            className={`flex-1 py-1 px-1.5 text-[11px] rounded border transition-colors ${
                              foilStyle === 'GOLD_FOIL'
                                ? 'bg-[#C5A059] text-[#16120E] font-bold border-[#C5A059]'
                                : 'bg-white text-[#5C4D3E] border-[#221C16]/15'
                            }`}
                          >
                            24k Gold
                          </button>
                          <button
                            type="button"
                            onClick={() => setFoilStyle('BLIND')}
                            className={`flex-1 py-1 px-1.5 text-[11px] rounded border transition-colors ${
                              foilStyle === 'BLIND'
                                ? 'bg-[#221C16] text-[#FAF7F2] font-bold border-[#221C16]'
                                : 'bg-white text-[#5C4D3E] border-[#221C16]/15'
                            }`}
                          >
                            Blind
                          </button>
                          <button
                            type="button"
                            onClick={() => setFoilStyle('SILVER_FOIL')}
                            className={`flex-1 py-1 px-1.5 text-[11px] rounded border transition-colors ${
                              foilStyle === 'SILVER_FOIL'
                                ? 'bg-[#D8D8D8] text-[#16120E] font-bold border-[#8A8A8A]'
                                : 'bg-white text-[#5C4D3E] border-[#221C16]/15'
                            }`}
                          >
                            Silver
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[#5C4D3E]">
                    Standard piece with authentic blind craftsman heat stamp mark on reverse.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-[#221C16]/10 space-y-2">
              {typeof product.stockCount === 'number' && isAvailable && (
                <div className="flex items-center justify-between text-[11px] font-mono text-[#5C4D3E]">
                  <span>Available Warehouse Stock: {product.stockCount} pcs</span>
                  {bagQuantityForProduct > 0 && (
                    <span className="text-[#8B4513] font-semibold">
                      {bagQuantityForProduct} already in bag
                    </span>
                  )}
                </div>
              )}
              {!isAvailable ? (
                <button
                  type="button"
                  disabled
                  className="w-full py-3 px-6 text-sm font-mono font-semibold tracking-wider uppercase text-red-900 bg-red-100 border border-red-300 rounded-lg cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Ban className="w-4 h-4" />
                  <span>Currently Out of Stock</span>
                </button>
              ) : isAtBagLimit ? (
                <button
                  type="button"
                  disabled
                  className="w-full py-3 px-6 text-sm font-mono font-semibold tracking-wider uppercase text-amber-900 bg-amber-100 border border-amber-300 rounded-lg cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Ban className="w-4 h-4" />
                  <span>Maximum Stock in Bag ({maxStock} Available)</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleAdd}
                  className="w-full py-3 px-6 text-sm font-semibold tracking-wider uppercase text-[#FAF7F2] bg-[#221C16] hover:bg-[#342B22] rounded-lg transition-colors shadow-md flex items-center justify-center gap-2"
                >
                  <span>Add to Bag</span>
                  <span className="font-mono tabular-nums">· ₹{product.price.toLocaleString('en-IN')}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
