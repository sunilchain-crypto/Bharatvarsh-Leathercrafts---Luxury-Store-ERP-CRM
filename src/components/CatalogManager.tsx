import React, { useState, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Edit3,
  HelpCircle,
  CheckCircle2,
  FolderPlus,
  AlertCircle,
  X,
  Upload,
  Film,
  Image as ImageIcon,
  Loader2
} from 'lucide-react';
import { Category, Product, SolutionEngine } from '../types/index.ts';

interface CMSProduct extends Product {
  initialPuneStock?: number;
  initialMumbaiStock?: number;
}

interface CatalogManagerProps {
  catalog: { categories: Category[]; products: CMSProduct[] };
  authToken: string;
  onCatalogUpdated: (newCatalog: { categories: Category[]; products: CMSProduct[] }) => void;
}

const DEFAULT_IMAGES = [
  { label: 'Men Belt & Wallet Showcase', url: '/assets/images/product_men_belt_wallet_1794461808951.jpg' },
  { label: 'Women Purse & Bag Showcase', url: '/assets/images/product_women_purse_bag_1794461810441.jpg' },
  { label: 'Travel Backpack & Folio Showcase', url: '/assets/images/product_travel_backpack_folio_1794461810700.jpg' },
  { label: 'Leathercraft Workshop Bench', url: '/assets/images/hero_leathercraft_workshop_1794461808596.jpg' },
  { label: 'Custom Monogram Debossing', url: '/assets/images/custom_debossing_monogram_1794461810572.jpg' }
];

const EMPTY_IMAGE_SLOTS: [string, string, string, string] = ['', '', '', ''];

function toFourImageSlots(p?: Pick<Product, 'images' | 'image'>): [string, string, string, string] {
  const source =
    p?.images && p.images.length > 0
      ? p.images
      : p?.image
      ? [p.image]
      : [];
  return [source[0] || '', source[1] || '', source[2] || '', source[3] || ''];
}

export const CatalogManager: React.FC<CatalogManagerProps> = ({ catalog, authToken, onCatalogUpdated }) => {
  const [categories, setCategories] = useState<Category[]>(catalog.categories || []);
  const [products, setProducts] = useState<CMSProduct[]>(catalog.products || []);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmDeleteProduct, setConfirmDeleteProduct] = useState<CMSProduct | null>(null);

  useEffect(() => {
    setCategories(catalog.categories || []);
    setProducts(catalog.products || []);
  }, [catalog]);

  // Add / Edit Product Modal State
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [prodName, setProdName] = useState('');
  const [prodCategory, setProdCategory] = useState('men');
  const [prodType, setProdType] = useState('Wallets');
  const [prodSku, setProdSku] = useState('BVL-CUSTOM-01');
  const [prodPrice, setProdPrice] = useState(4500);
  const [prodOfferPrice, setProdOfferPrice] = useState('');
  const [prodDesc, setProdDesc] = useState('');
  const [prodFeaturesText, setProdFeaturesText] = useState(
    'Full-grain steerhide\nHand-burnished beeswax edges\nSolid brass hardware'
  );
  const [prodHsn, setProdHsn] = useState('4202');
  const [prodGstPercent, setProdGstPercent] = useState('');
  const [prodSolutionEngine, setProdSolutionEngine] = useState<SolutionEngine>('EVERYDAY_CARRY');
  const [prodAllowCustomization, setProdAllowCustomization] = useState(true);
  const [prodCareKitIncluded, setProdCareKitIncluded] = useState(true);
  const [prodImages, setProdImages] = useState<[string, string, string, string]>([
    DEFAULT_IMAGES[0].url,
    '',
    '',
    ''
  ]);
  const [prodVideoUrl, setProdVideoUrl] = useState('');
  const [uploadingSlot, setUploadingSlot] = useState<number | 'video' | null>(null);
  const [uploadNotice, setUploadNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [puneInitStock, setPuneInitStock] = useState(15);
  const [mumbaiInitStock, setMumbaiInitStock] = useState(10);
  const [productModalError, setProductModalError] = useState<string | null>(null);

  // Add / Edit / Delete Category Modal State
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategorySlug, setEditingCategorySlug] = useState<string | null>(null);
  const [catName, setCatName] = useState('');
  const [catSlug, setCatSlug] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [catTypesText, setCatTypesText] = useState('Belts, Wallets');
  const [confirmDeleteCategory, setConfirmDeleteCategory] = useState<Category | null>(null);
  const [reassignCategorySlug, setReassignCategorySlug] = useState('');

  const handleSaveCatalog = async (updatedCategories: Category[], updatedProducts: CMSProduct[]) => {
    try {
      const res = await fetch('/api/store-management/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          catalog: {
            categories: updatedCategories,
            products: updatedProducts
          }
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const nextCat = data.catalog || { categories: updatedCategories, products: updatedProducts };
        setCategories(nextCat.categories);
        setProducts(nextCat.products);
        onCatalogUpdated(nextCat);
        setFeedback({ type: 'success', message: 'Catalog and inventory synced permanently.' });
        setTimeout(() => setFeedback(null), 4000);
      } else {
        setFeedback({ type: 'error', message: data.error || 'Failed to save catalog' });
      }
    } catch (e: any) {
      setFeedback({ type: 'error', message: 'Failed to save catalog: ' + e.message });
    }
  };

  const openAddProduct = () => {
    setEditingProductId(null);
    setProdName('');
    setProdCategory(categories[0]?.slug || 'men');
    setProdType(categories[0]?.productTypes[0] || 'Wallets');
    setProdSku(`BVL-NEW-${Math.floor(100 + Math.random() * 899)}`);
    setProdPrice(4500);
    setProdOfferPrice('');
    setProdDesc('');
    setProdFeaturesText('Full-grain vegetable-tanned leather\nHand-burnished beeswax edges\nSolid brass hardware');
    setProdHsn('4202');
    setProdGstPercent('');
    setProdSolutionEngine('EVERYDAY_CARRY');
    setProdAllowCustomization(true);
    setProdCareKitIncluded(true);
    setProdImages([DEFAULT_IMAGES[0].url, '', '', '']);
    setProdVideoUrl('');
    setUploadingSlot(null);
    setUploadNotice(null);
    setPuneInitStock(15);
    setMumbaiInitStock(10);
    setProductModalError(null);
    setShowProductModal(true);
  };

  const openEditProduct = (p: CMSProduct) => {
    setEditingProductId(p.id);
    setProdName(p.name);
    setProdCategory(p.category);
    setProdType(p.productType);
    setProdSku(p.sku);
    setProdPrice(p.price);
    setProdOfferPrice(typeof p.offerPrice === 'number' && p.offerPrice > 0 ? String(p.offerPrice) : '');
    setProdDesc(p.description);
    setProdFeaturesText((p.features || []).join('\n'));
    setProdHsn(p.hsnCode);
    setProdGstPercent(typeof p.gstRate === 'number' ? String(Math.round(p.gstRate * 100)) : '');
    setProdSolutionEngine(p.solutionEngine || 'EVERYDAY_CARRY');
    setProdAllowCustomization(p.allowCustomization !== false);
    setProdCareKitIncluded(p.careKitIncluded !== false);
    const slots = toFourImageSlots(p);
    if (!slots[0]) slots[0] = DEFAULT_IMAGES[0].url;
    setProdImages(slots);
    setProdVideoUrl(p.videoUrl || '');
    setUploadingSlot(null);
    setUploadNotice(null);
    setProductModalError(null);
    setShowProductModal(true);
  };

  const uploadMediaToServer = async (file: File, kind: 'image' | 'video', targetSlot: number | 'video') => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (kind === 'image') {
      if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext) && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        setUploadNotice({ type: 'error', message: 'Image must be PNG, JPG, JPEG, or WEBP.' });
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setUploadNotice({ type: 'error', message: 'Image size must not exceed 10MB.' });
        return;
      }
    } else {
      if (!['mp4', 'webm'].includes(ext) && !['video/mp4', 'video/webm'].includes(file.type)) {
        setUploadNotice({ type: 'error', message: 'Video must be MP4 or WEBM.' });
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        setUploadNotice({ type: 'error', message: 'Video size must not exceed 50MB.' });
        return;
      }
    }

    setUploadingSlot(targetSlot);
    setUploadNotice(null);
    setProductModalError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/store-management/upload-media', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        body: formData
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.url) {
        throw new Error(data.error || 'Media upload failed');
      }

      if (targetSlot === 'video') {
        setProdVideoUrl(data.url);
      } else {
        setProdImages((prev) => {
          const next = [...prev] as [string, string, string, string];
          next[targetSlot] = data.url;
          return next;
        });
      }
      setUploadNotice({
        type: 'success',
        message: `Uploaded to ${data.url}`
      });
    } catch (err: any) {
      setUploadNotice({
        type: 'error',
        message: err?.message || 'Failed to upload media file.'
      });
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleImageSlotUpload = (slotIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    uploadMediaToServer(file, 'image', slotIndex);
  };

  const handleVideoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    uploadMediaToServer(file, 'video', 'video');
  };

  const handleSaveProductSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedSku = prodSku.trim();
    if (!trimmedSku) {
      setProductModalError('Product SKU cannot be empty.');
      return;
    }
    const duplicate = products.find(
      (p) => p.id !== editingProductId && p.sku.trim().toUpperCase() === trimmedSku.toUpperCase()
    );
    if (duplicate) {
      setProductModalError(`SKU "${trimmedSku}" is already assigned to "${duplicate.name}". Please use a unique SKU.`);
      return;
    }

    if (!Number.isFinite(prodPrice) || prodPrice < 0) {
      setProductModalError('MRP Price must be a valid non-negative number.');
      return;
    }

    const trimmedOffer = prodOfferPrice.trim();
    let parsedOfferPrice: number | undefined;
    if (trimmedOffer !== '') {
      const numOffer = Number(trimmedOffer);
      if (!Number.isFinite(numOffer) || numOffer < 0) {
        setProductModalError('Offer Price must be a valid non-negative number.');
        return;
      }
      if (numOffer > 0) {
        if (numOffer > prodPrice) {
          setProductModalError(`Offer price (₹${numOffer.toLocaleString('en-IN')}) cannot exceed MRP price (₹${prodPrice.toLocaleString('en-IN')}).`);
          return;
        }
        parsedOfferPrice = numOffer;
      }
    }

    const cleanImages = prodImages.map((u) => u.trim()).filter(Boolean).slice(0, 4);
    if (cleanImages.length === 0) {
      cleanImages.push(DEFAULT_IMAGES[0].url);
    }
    const cleanVideoUrl = prodVideoUrl.trim();

    setProductModalError(null);

    const parsedFeatures = prodFeaturesText
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
    const resolvedFeatures =
      parsedFeatures.length > 0
        ? parsedFeatures
        : ['Full-grain steerhide', 'Hand-burnished beeswax edges', 'Solid brass hardware'];
    const trimmedGst = prodGstPercent.trim();
    const parsedGstNum = trimmedGst === '' ? undefined : Number(trimmedGst);
    const normalizedGstRate =
      typeof parsedGstNum === 'number' && Number.isFinite(parsedGstNum)
        ? Math.max(0, Math.min(28, parsedGstNum)) / 100
        : undefined;

    // Ensure productType is listed in category.productTypes
    const nextCategories = categories.map((c) => {
      if (c.slug === prodCategory && !c.productTypes.includes(prodType.trim())) {
        return { ...c, productTypes: [...c.productTypes, prodType.trim()] };
      }
      return c;
    });

    if (editingProductId) {
      const nextProducts = products.map((p) => {
        if (p.id !== editingProductId) return p;
        const { gstRate: _prevGst, offerPrice: _prevOffer, videoUrl: _prevVideo, ...restProduct } = p;
        return {
          ...restProduct,
          name: prodName,
          category: prodCategory,
          productType: prodType.trim(),
          sku: trimmedSku,
          price: prodPrice,
          ...(typeof parsedOfferPrice === 'number' ? { offerPrice: parsedOfferPrice } : {}),
          description: prodDesc,
          features: resolvedFeatures,
          hsnCode: prodHsn,
          ...(typeof normalizedGstRate === 'number' ? { gstRate: normalizedGstRate } : {}),
          solutionEngine: prodSolutionEngine,
          allowCustomization: prodAllowCustomization,
          careKitIncluded: prodCareKitIncluded,
          images: cleanImages,
          image: cleanImages[0] || '',
          ...(cleanVideoUrl ? { videoUrl: cleanVideoUrl } : {})
        };
      });
      handleSaveCatalog(nextCategories, nextProducts);
    } else {
      const newProduct: CMSProduct = {
        id: `prod-${Date.now()}`,
        name: prodName,
        category: prodCategory,
        productType: prodType.trim(),
        sku: trimmedSku,
        price: prodPrice,
        ...(typeof parsedOfferPrice === 'number' ? { offerPrice: parsedOfferPrice } : {}),
        currency: 'INR',
        description: prodDesc || 'Handcrafted heirloom leather goods crafted from vegetable-tanned hides.',
        features: resolvedFeatures,
        image: cleanImages[0] || '',
        images: cleanImages,
        ...(cleanVideoUrl ? { videoUrl: cleanVideoUrl } : {}),
        hsnCode: prodHsn,
        ...(typeof normalizedGstRate === 'number' ? { gstRate: normalizedGstRate } : {}),
        solutionEngine: prodSolutionEngine,
        inStock: puneInitStock + mumbaiInitStock > 0,
        allowCustomization: prodAllowCustomization,
        careKitIncluded: prodCareKitIncluded,
        initialPuneStock: puneInitStock,
        initialMumbaiStock: mumbaiInitStock
      };
      handleSaveCatalog(nextCategories, [...products, newProduct]);
    }

    setShowProductModal(false);
  };

  const openAddCategoryModal = () => {
    setEditingCategorySlug(null);
    setCatName('');
    setCatSlug('');
    setCatDesc('');
    setCatTypesText('Belts, Wallets');
    setShowCategoryModal(true);
  };

  const openEditCategoryModal = (cat: Category) => {
    setEditingCategorySlug(cat.slug);
    setCatName(cat.name);
    setCatSlug(cat.slug);
    setCatDesc(cat.description);
    setCatTypesText(cat.productTypes.join(', '));
    setShowCategoryModal(true);
  };

  const handleSaveCategorySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return;
    const sanitizedSlug = (catSlug || catName)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    if (!sanitizedSlug) return;

    const productTypes = catTypesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const resolvedTypes = productTypes.length > 0 ? productTypes : ['Essentials'];

    if (editingCategorySlug) {
      if (
        sanitizedSlug !== editingCategorySlug &&
        categories.some((c) => c.slug === sanitizedSlug)
      ) {
        setFeedback({ type: 'error', message: `Category slug "${sanitizedSlug}" already exists.` });
        return;
      }

      const nextCategories = categories.map((c) =>
        c.slug === editingCategorySlug
          ? {
              ...c,
              id: sanitizedSlug,
              name: catName.trim(),
              slug: sanitizedSlug,
              description: catDesc.trim() || c.description,
              productTypes: resolvedTypes
            }
          : c
      );

      const nextProducts =
        sanitizedSlug === editingCategorySlug
          ? products
          : products.map((p) =>
              p.category === editingCategorySlug ? { ...p, category: sanitizedSlug } : p
            );

      handleSaveCatalog(nextCategories, nextProducts);
    } else {
      if (categories.some((c) => c.slug === sanitizedSlug)) {
        setFeedback({ type: 'error', message: `Category "${sanitizedSlug}" already exists.` });
        return;
      }
      const newCat: Category = {
        id: sanitizedSlug,
        name: catName.trim(),
        slug: sanitizedSlug,
        description: catDesc.trim() || `Handcrafted ${catName.trim()} leathercraft essentials.`,
        productTypes: resolvedTypes
      };
      handleSaveCatalog([...categories, newCat], products);
    }

    setShowCategoryModal(false);
    setEditingCategorySlug(null);
    setCatName('');
    setCatSlug('');
    setCatDesc('');
  };

  const openDeleteCategoryModal = (cat: Category) => {
    const otherCats = categories.filter((c) => c.slug !== cat.slug);
    setReassignCategorySlug(otherCats[0]?.slug || '');
    setConfirmDeleteCategory(cat);
  };

  const handleConfirmDeleteCategory = () => {
    if (!confirmDeleteCategory) return;
    const assignedProductsCount = products.filter((p) => p.category === confirmDeleteCategory.slug).length;
    const remainingCategories = categories.filter((c) => c.slug !== confirmDeleteCategory.slug);

    if (assignedProductsCount > 0 && remainingCategories.length === 0) {
      setFeedback({
        type: 'error',
        message: 'Cannot remove the only remaining collection category while products exist in it.'
      });
      setConfirmDeleteCategory(null);
      return;
    }

    const nextProducts =
      assignedProductsCount > 0 && reassignCategorySlug
        ? products.map((p) =>
            p.category === confirmDeleteCategory.slug ? { ...p, category: reassignCategorySlug } : p
          )
        : products;

    setConfirmDeleteCategory(null);
    handleSaveCatalog(remainingCategories, nextProducts);
  };

  const handleConfirmDeleteProduct = () => {
    if (!confirmDeleteProduct) return;
    const nextProducts = products.filter((p) => p.id !== confirmDeleteProduct.id);
    setConfirmDeleteProduct(null);
    handleSaveCatalog(categories, nextProducts);
  };

  const isPresetPrimaryImage = DEFAULT_IMAGES.some((img) => img.url === prodImages[0]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-[#221C16]/10">
        <div>
          <span className="text-xs font-mono uppercase tracking-widest text-[#8B4513]">
            Content Management Layer
          </span>
          <h1 className="font-display text-3xl font-bold text-[#16120E] mt-1">
            Product Catalogue & Taxonomy CMS
          </h1>
          <p className="text-xs text-[#5C4D3E] mt-1">
            Add, edit, or delete categories, upload or link custom product photography, manage tax rates, and initialize Pune/Mumbai stock.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={openAddCategoryModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-[#221C16]/20 text-[#221C16] rounded hover:bg-white"
          >
            <FolderPlus className="w-4 h-4 text-[#8B4513]" />
            <span>Add Category</span>
          </button>

          <button
            onClick={openAddProduct}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-[#221C16] text-[#FAF7F2] rounded hover:bg-[#342B22]"
          >
            <Plus className="w-4 h-4 text-[#C5A059]" />
            <span>Add New Product</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 border rounded-lg text-xs font-medium flex items-center justify-between gap-2 ${
            feedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="p-0.5 opacity-70 hover:opacity-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Categories Overview with Edit & Delete */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {categories.map((cat) => {
          const count = products.filter((p) => p.category === cat.slug).length;
          return (
            <div key={cat.id} className="p-4 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-display text-base font-bold text-[#16120E]">{cat.name}</div>
                  <div className="text-[10px] font-mono text-[#5C4D3E]">
                    slug: {cat.slug} · {count} piece(s)
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditCategoryModal(cat)}
                    className="p-1 text-[#5C4D3E] hover:text-[#16120E] rounded hover:bg-[#FAF7F2]"
                    title="Edit category"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openDeleteCategoryModal(cat)}
                    className="p-1 text-red-700 hover:text-red-900 rounded hover:bg-red-50"
                    title="Delete category"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-[#5C4D3E] text-[11px]">{cat.description}</p>
              <div className="text-[11px] font-mono text-[#8B4513] pt-1">
                Types: {cat.productTypes.join(', ')}
              </div>
            </div>
          );
        })}
      </div>

      {/* Guide Card */}
      <div className="p-5 bg-white rounded-xl border border-[#221C16]/10 shadow-sm space-y-2 text-xs leading-relaxed">
        <h3 className="font-display text-base font-bold text-[#16120E] flex items-center gap-1.5">
          <HelpCircle className="w-4 h-4 text-[#8B4513]" />
          <span>Catalogue & Inventory Administration Guide</span>
        </h3>
        <p className="text-[#5C4D3E]">
          1. <strong>Categories & Types:</strong> Create, rename, or reorganize collections. Deleting a populated category safely reassigns its products so no SKU is orphaned.
        </p>
        <p className="text-[#5C4D3E]">
          2. <strong>Custom Photography & Attributes:</strong> Paste any external image URL or upload an image file directly, configure HSN/GST rates, monogram eligibility, and feature callouts.
        </p>
        <p className="text-[#5C4D3E]">
          3. <strong>Permanent Stock Control:</strong> Adjust live stock counts from ERP & Inventory. When combined stock across Pune Primary Hub and Mumbai Warehouse reaches 0, the piece deactivates on the storefront.
        </p>
      </div>

      {/* Product List */}
      <div className="bg-white rounded-xl border border-[#221C16]/10 shadow-sm overflow-hidden">
        <div className="p-4 bg-[#FAF7F2] border-b border-[#221C16]/10 font-bold text-xs text-[#16120E] flex items-center justify-between">
          <span>Catalogue Pieces ({products.length})</span>
          <span className="font-mono text-[11px] text-[#5C4D3E]">Syncs to Storefront & ERP Permanently</span>
        </div>

        <div className="divide-y divide-[#221C16]/5 text-xs">
          {products.map((p) => {
            const mediaCount = (p.images || []).filter(Boolean).length;
            const hasOffer = typeof p.offerPrice === 'number' && p.offerPrice > 0 && p.offerPrice < p.price;
            const discountPct = hasOffer ? Math.round(((p.price - p.offerPrice!) / p.price) * 100) : 0;
            return (
              <div key={p.id} className="p-4 flex items-center justify-between gap-4 hover:bg-[#FAF7F2]/50">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={p.images?.[0] || p.image || DEFAULT_IMAGES[0].url}
                    alt={p.name}
                    referrerPolicy="no-referrer"
                    className="w-12 h-12 object-cover rounded bg-[#FAF7F2] border shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-bold text-[#16120E] truncate">{p.name}</h4>
                      {hasOffer && discountPct > 0 && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1B332A] text-[#FAF7F2]">
                          {discountPct}% OFF
                        </span>
                      )}
                      {p.videoUrl && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#EBE4D5] text-[#8B4513] inline-flex items-center gap-1">
                          <Film className="w-3 h-3" />
                          Video
                        </span>
                      )}
                      {p.inStock === false && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-100 text-red-900">
                          Out of Stock · Deactivated
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[#5C4D3E] font-mono mt-0.5">
                      Category: <strong className="text-[#16120E]">{p.category}</strong> ({p.productType}) · SKU: {p.sku} · HSN: {p.hsnCode} · GST:{' '}
                      {typeof p.gstRate === 'number' ? `${Math.round(p.gstRate * 100)}%` : 'Store Default'} · {mediaCount}/4 img
                      {typeof p.stockCount === 'number' && ` · On Hand: ${p.stockCount} pcs`}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 font-mono">
                  <div className="text-right mr-2">
                    {hasOffer ? (
                      <>
                        <span className="font-bold text-sm text-[#1B332A] tabular-nums block">
                          ₹{p.offerPrice!.toLocaleString('en-IN')}
                        </span>
                        <span className="text-[11px] text-[#5C4D3E]/70 line-through tabular-nums block">
                          ₹{p.price.toLocaleString('en-IN')}
                        </span>
                      </>
                    ) : (
                      <span className="font-bold text-sm text-[#16120E] tabular-nums">
                        ₹{p.price.toLocaleString('en-IN')}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => openEditProduct(p)}
                    className="p-1.5 text-[#5C4D3E] hover:text-[#16120E] hover:bg-[#EBE4D5]/60 rounded transition-colors"
                    title="Edit product"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfirmDeleteProduct(p)}
                    className="p-1.5 text-red-700 hover:text-red-900 hover:bg-red-50 rounded transition-colors"
                    title="Remove from catalogue"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal: Add / Edit Category */}
      {showCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#16120E]/70 backdrop-blur-sm">
          <div className="bg-white rounded-xl border p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="font-display text-xl font-bold text-[#16120E]">
              {editingCategorySlug ? 'Edit Collection Category' : 'Add Collection Category'}
            </h3>
            <form onSubmit={handleSaveCategorySubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#5C4D3E] mb-1">Category Name</label>
                <input
                  type="text"
                  required
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="e.g. Executive Desk"
                  className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                />
              </div>
              {editingCategorySlug && (
                <div>
                  <label className="block text-[#5C4D3E] mb-1">Category Slug</label>
                  <input
                    type="text"
                    required
                    value={catSlug}
                    onChange={(e) => setCatSlug(e.target.value)}
                    className="w-full px-3 py-1.5 border rounded font-mono bg-[#FAF7F2]"
                  />
                </div>
              )}
              <div>
                <label className="block text-[#5C4D3E] mb-1">Product Types (comma separated)</label>
                <input
                  type="text"
                  required
                  value={catTypesText}
                  onChange={(e) => setCatTypesText(e.target.value)}
                  placeholder="e.g. Desk Mats, Folio Cases"
                  className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                />
              </div>
              <div>
                <label className="block text-[#5C4D3E] mb-1">Description</label>
                <textarea
                  rows={2}
                  value={catDesc}
                  onChange={(e) => setCatDesc(e.target.value)}
                  className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowCategoryModal(false)}
                  className="px-3 py-1.5 border rounded text-[#5C4D3E]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#221C16] text-[#FAF7F2] font-semibold rounded hover:bg-[#342B22]"
                >
                  {editingCategorySlug ? 'Update Category' : 'Save Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirm Category Deletion */}
      {confirmDeleteCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#16120E]/70 backdrop-blur-sm">
          <div className="bg-white rounded-xl border border-[#221C16]/15 p-6 max-w-md w-full space-y-4 shadow-2xl text-xs">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-red-50 text-red-800 shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="space-y-1.5">
                <h3 className="font-display text-lg font-bold text-[#16120E]">
                  Delete Category "{confirmDeleteCategory.name}"?
                </h3>
                {(() => {
                  const linkedCount = products.filter((p) => p.category === confirmDeleteCategory.slug).length;
                  const otherCategories = categories.filter((c) => c.slug !== confirmDeleteCategory.slug);
                  if (linkedCount === 0) {
                    return (
                      <p className="text-[#5C4D3E]">
                        No catalogue pieces currently reference this category. It will be removed cleanly.
                      </p>
                    );
                  }
                  if (otherCategories.length === 0) {
                    return (
                      <p className="text-red-800 font-medium">
                        {linkedCount} product(s) belong to this category and no fallback category exists. Add another category before deleting this one.
                      </p>
                    );
                  }
                  return (
                    <div className="space-y-2">
                      <p className="text-[#5C4D3E]">
                        <strong>{linkedCount}</strong> product(s) belong to this category. Choose the destination category to reassign them to:
                      </p>
                      <select
                        value={reassignCategorySlug}
                        onChange={(e) => setReassignCategorySlug(e.target.value)}
                        className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                      >
                        {otherCategories.map((c) => (
                          <option key={c.slug} value={c.slug}>
                            {c.name} ({c.slug})
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#221C16]/10">
              <button
                type="button"
                onClick={() => setConfirmDeleteCategory(null)}
                className="px-3.5 py-1.5 border border-[#221C16]/20 rounded text-[#5C4D3E]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  products.some((p) => p.category === confirmDeleteCategory.slug) &&
                  categories.filter((c) => c.slug !== confirmDeleteCategory.slug).length === 0
                }
                onClick={handleConfirmDeleteCategory}
                className="px-4 py-1.5 bg-red-800 text-white font-semibold rounded hover:bg-red-900 disabled:opacity-50"
              >
                Delete Category
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add / Edit Product */}
      {showProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#16120E]/70 backdrop-blur-sm">
          <div className="bg-white rounded-xl border p-6 max-w-lg w-full space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="font-display text-xl font-bold text-[#16120E]">
              {editingProductId ? 'Edit Leathercraft Piece' : 'Add New Leathercraft Piece'}
            </h3>

            {productModalError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-900 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                <span>{productModalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveProductSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#5C4D3E] mb-1">Product Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. The Sahyadri Travel Duffle"
                  value={prodName}
                  onChange={(e) => setProdName(e.target.value)}
                  className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[#5C4D3E] mb-1">Top-Level Category</label>
                  <select
                    value={prodCategory}
                    onChange={(e) => setProdCategory(e.target.value)}
                    className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                  >
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.slug}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[#5C4D3E] mb-1">Product Type</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Briefcases / Wallets"
                    value={prodType}
                    onChange={(e) => setProdType(e.target.value)}
                    className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-[#5C4D3E] mb-1">SKU</label>
                  <input
                    type="text"
                    required
                    value={prodSku}
                    onChange={(e) => setProdSku(e.target.value)}
                    className="w-full px-3 py-1.5 border rounded font-mono bg-[#FAF7F2]"
                  />
                </div>
                <div>
                  <label className="block text-[#5C4D3E] mb-1">Price / MRP (₹) *</label>
                  <input
                    type="number"
                    required
                    min={0}
                    step={50}
                    value={prodPrice}
                    onChange={(e) => setProdPrice(Math.max(0, parseInt(e.target.value || '0', 10)))}
                    className="w-full px-3 py-1.5 border rounded font-mono font-bold bg-[#FAF7F2]"
                  />
                </div>
                <div>
                  <label className="block text-[#5C4D3E] mb-1">Offer Price (₹)</label>
                  <input
                    type="number"
                    min={0}
                    step={50}
                    placeholder="Optional"
                    value={prodOfferPrice}
                    onChange={(e) => setProdOfferPrice(e.target.value)}
                    className={`w-full px-3 py-1.5 border rounded font-mono font-bold bg-[#FAF7F2] ${
                      prodOfferPrice.trim() && Number(prodOfferPrice) > prodPrice ? 'border-red-500 text-red-800' : ''
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-[#5C4D3E] mb-1">GST % (Blank = Default)</label>
                  <input
                    type="number"
                    min={0}
                    max={28}
                    placeholder="Default"
                    value={prodGstPercent}
                    onChange={(e) => setProdGstPercent(e.target.value)}
                    className="w-full px-3 py-1.5 border rounded font-mono bg-[#FAF7F2]"
                  />
                </div>
              </div>

              {(() => {
                const trimmed = prodOfferPrice.trim();
                if (!trimmed) return null;
                const offerVal = Number(trimmed);
                if (!Number.isFinite(offerVal) || offerVal <= 0) return null;
                if (offerVal > prodPrice) {
                  return (
                    <div className="px-2.5 py-1.5 rounded bg-red-50 border border-red-200 text-[11px] text-red-800 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Offer price (₹{offerVal.toLocaleString('en-IN')}) cannot exceed MRP price (₹{prodPrice.toLocaleString('en-IN')}).</span>
                    </div>
                  );
                }
                const pct = prodPrice > 0 ? Math.round(((prodPrice - offerVal) / prodPrice) * 100) : 0;
                return (
                  <div className="px-2.5 py-1.5 rounded bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900 font-mono">
                    Active Offer: ₹{offerVal.toLocaleString('en-IN')} ({pct}% savings off MRP ₹{prodPrice.toLocaleString('en-IN')})
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[#5C4D3E] mb-1">HSN Code</label>
                  <input
                    type="text"
                    value={prodHsn}
                    onChange={(e) => setProdHsn(e.target.value)}
                    className="w-full px-3 py-1.5 border rounded font-mono bg-[#FAF7F2]"
                  />
                </div>
                <div>
                  <label className="block text-[#5C4D3E] mb-1">Solution Collection</label>
                  <select
                    value={prodSolutionEngine}
                    onChange={(e) => setProdSolutionEngine(e.target.value as SolutionEngine)}
                    className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                  >
                    <option value="EVERYDAY_CARRY">Everyday Carry</option>
                    <option value="TRANSIT_FOLIOS">Transit Folios</option>
                    <option value="LIFETIME_HEIRLOOM_CARE">Lifetime Heirloom Care</option>
                  </select>
                </div>
              </div>

              {!editingProductId && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[#5C4D3E] mb-1">Initial Pune Hub Stock</label>
                    <input
                      type="number"
                      min={0}
                      value={puneInitStock}
                      onChange={(e) => setPuneInitStock(Math.max(0, parseInt(e.target.value || '0', 10)))}
                      className="w-full px-3 py-1.5 border rounded font-mono bg-[#FAF7F2]"
                    />
                  </div>
                  <div>
                    <label className="block text-[#5C4D3E] mb-1">Initial Mumbai Stock</label>
                    <input
                      type="number"
                      min={0}
                      value={mumbaiInitStock}
                      onChange={(e) => setMumbaiInitStock(Math.max(0, parseInt(e.target.value || '0', 10)))}
                      className="w-full px-3 py-1.5 border rounded font-mono bg-[#FAF7F2]"
                    />
                  </div>
                </div>
              )}

              {/* Product Multi-Media: Up to 4 Images + 1 Video uploaded to /assets/images/ */}
              <div className="space-y-3 p-3.5 bg-[#FAF7F2] rounded-lg border border-[#221C16]/10">
                <div className="flex items-center justify-between">
                  <label className="text-[#5C4D3E] font-semibold flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-[#8B4513]" />
                    <span>Product Photography (Up to 4 Images) & 1 Video</span>
                  </label>
                  <span className="text-[10px] font-mono text-[#5C4D3E]">
                    Saved to /assets/images/
                  </span>
                </div>

                {uploadNotice && (
                  <div
                    className={`p-2 rounded border text-[11px] flex items-center justify-between gap-2 ${
                      uploadNotice.type === 'error'
                        ? 'bg-red-50 border-red-200 text-red-900'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    }`}
                  >
                    <span className="truncate font-mono">{uploadNotice.message}</span>
                    <button type="button" onClick={() => setUploadNotice(null)} className="shrink-0 opacity-70 hover:opacity-100">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {/* Image Slot 1 Preset Quick-Pick */}
                <div>
                  <select
                    value={isPresetPrimaryImage ? prodImages[0] : 'CUSTOM'}
                    onChange={(e) => {
                      if (e.target.value !== 'CUSTOM') {
                        setProdImages((prev) => [e.target.value, prev[1], prev[2], prev[3]]);
                      }
                    }}
                    className="w-full px-2.5 py-1 border rounded bg-white text-[11px]"
                  >
                    {DEFAULT_IMAGES.map((img) => (
                      <option key={img.url} value={img.url}>
                        Primary Preset: {img.label}
                      </option>
                    ))}
                    {!isPresetPrimaryImage && <option value="CUSTOM">Primary Image: Custom URL / Upload</option>}
                  </select>
                </div>

                {/* 4 Image Slots */}
                <div className="space-y-2">
                  {[0, 1, 2, 3].map((slotIdx) => {
                    const url = prodImages[slotIdx] || '';
                    const isUploadingThis = uploadingSlot === slotIdx;
                    return (
                      <div key={slotIdx} className="flex items-center gap-2 bg-white p-2 rounded border border-[#221C16]/10">
                        {url ? (
                          <img
                            src={url}
                            alt={`Slot ${slotIdx + 1}`}
                            referrerPolicy="no-referrer"
                            className="w-10 h-10 object-cover rounded border bg-[#FAF7F2] shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded border border-dashed border-[#221C16]/20 bg-[#FAF7F2] flex items-center justify-center text-[10px] font-mono text-[#5C4D3E]/60 shrink-0">
                            {slotIdx + 1}
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] font-mono text-[#5C4D3E] mb-0.5">
                            {slotIdx === 0 ? 'Image 1 (Primary)' : `Image ${slotIdx + 1} (Gallery)`}
                          </div>
                          <input
                            type="text"
                            value={url}
                            onChange={(e) => {
                              const val = e.target.value;
                              setProdImages((prev) => {
                                const next = [...prev] as [string, string, string, string];
                                next[slotIdx] = val;
                                return next;
                              });
                            }}
                            placeholder={slotIdx === 0 ? '/assets/images/... or https://...' : 'Optional gallery image URL or upload'}
                            className="w-full px-2 py-1 border rounded font-mono text-[11px] bg-[#FAF7F2]"
                          />
                        </div>

                        <label className="inline-flex items-center gap-1 px-2 py-1.5 border border-[#221C16]/20 rounded bg-[#FAF7F2] cursor-pointer hover:bg-[#EBE4D5]/50 text-[10px] font-semibold shrink-0">
                          {isUploadingThis ? (
                            <>
                              <Loader2 className="w-3 h-3 text-[#8B4513] animate-spin" />
                              <span>Uploading</span>
                            </>
                          ) : (
                            <>
                              <Upload className="w-3 h-3 text-[#8B4513]" />
                              <span>Upload Image</span>
                            </>
                          )}
                          <input
                            type="file"
                            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                            disabled={uploadingSlot !== null}
                            onChange={(e) => handleImageSlotUpload(slotIdx, e)}
                            className="hidden"
                          />
                        </label>

                        {url && (
                          <button
                            type="button"
                            onClick={() =>
                              setProdImages((prev) => {
                                const next = [...prev] as [string, string, string, string];
                                next[slotIdx] = '';
                                return next;
                              })
                            }
                            className="p-1 text-[#5C4D3E] hover:text-red-700 shrink-0"
                            title="Clear slot"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* 1 Showcase Video Slot */}
                <div className="pt-2 border-t border-[#221C16]/10 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-[#5C4D3E] flex items-center gap-1.5">
                      <Film className="w-3.5 h-3.5 text-[#8B4513]" />
                      <span>Product Showcase Video (Optional · MP4 / WebM ≤ 50MB)</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-2 bg-white p-2 rounded border border-[#221C16]/10">
                    <input
                      type="text"
                      value={prodVideoUrl}
                      onChange={(e) => setProdVideoUrl(e.target.value)}
                      placeholder="/assets/images/showcase.mp4 or external MP4 URL"
                      className="flex-1 px-2 py-1 border rounded font-mono text-[11px] bg-[#FAF7F2]"
                    />

                    <label className="inline-flex items-center gap-1 px-2 py-1.5 border border-[#221C16]/20 rounded bg-[#FAF7F2] cursor-pointer hover:bg-[#EBE4D5]/50 text-[10px] font-semibold shrink-0">
                      {uploadingSlot === 'video' ? (
                        <>
                          <Loader2 className="w-3 h-3 text-[#8B4513] animate-spin" />
                          <span>Uploading</span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-3 h-3 text-[#8B4513]" />
                          <span>Upload Video</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept=".mp4,.webm,video/mp4,video/webm"
                        disabled={uploadingSlot !== null}
                        onChange={handleVideoFileUpload}
                        className="hidden"
                      />
                    </label>

                    {prodVideoUrl && (
                      <button
                        type="button"
                        onClick={() => setProdVideoUrl('')}
                        className="p-1 text-[#5C4D3E] hover:text-red-700 shrink-0"
                        title="Remove video"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {prodVideoUrl && (
                    <video
                      src={prodVideoUrl}
                      controls
                      muted
                      playsInline
                      className="w-full max-h-36 rounded border bg-[#16120E] object-contain"
                    />
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[#5C4D3E] mb-1">Description</label>
                <textarea
                  rows={2}
                  value={prodDesc}
                  onChange={(e) => setProdDesc(e.target.value)}
                  placeholder="Artisan description and leather tanning details..."
                  className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                />
              </div>

              <div>
                <label className="block text-[#5C4D3E] mb-1">Key Features (one per line)</label>
                <textarea
                  rows={3}
                  value={prodFeaturesText}
                  onChange={(e) => setProdFeaturesText(e.target.value)}
                  placeholder="Full-grain steerhide&#10;Hand-burnished beeswax edges"
                  className="w-full px-3 py-1.5 border rounded bg-[#FAF7F2]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prodAllowCustomization}
                    onChange={(e) => setProdAllowCustomization(e.target.checked)}
                  />
                  <span>Allow Blind-Deboss Monogram</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prodCareKitIncluded}
                    onChange={(e) => setProdCareKitIncluded(e.target.checked)}
                  />
                  <span>Includes Beeswax Care Kit</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className="px-3 py-1.5 border rounded text-[#5C4D3E]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#221C16] text-[#FAF7F2] font-semibold rounded hover:bg-[#342B22]"
                >
                  {editingProductId ? 'Update Piece' : 'Save Piece to Catalog'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirm Product Removal */}
      {confirmDeleteProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#16120E]/70 backdrop-blur-sm">
          <div className="bg-white rounded-xl border border-[#221C16]/15 p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-red-50 text-red-800 shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-display text-lg font-bold text-[#16120E]">
                  Remove Catalogue Piece?
                </h3>
                <p className="text-xs text-[#5C4D3E] leading-relaxed">
                  Are you sure you want to remove <strong className="text-[#16120E]">{confirmDeleteProduct.name}</strong> (<span className="font-mono">{confirmDeleteProduct.sku}</span>) from the catalogue? Its matching inventory slot will also be removed.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#221C16]/10 text-xs">
              <button
                type="button"
                onClick={() => setConfirmDeleteProduct(null)}
                className="px-3.5 py-1.5 border border-[#221C16]/20 rounded text-[#5C4D3E] hover:bg-[#FAF7F2]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteProduct}
                className="px-4 py-1.5 bg-red-800 text-white font-semibold rounded hover:bg-red-900"
              >
                Remove Piece
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
