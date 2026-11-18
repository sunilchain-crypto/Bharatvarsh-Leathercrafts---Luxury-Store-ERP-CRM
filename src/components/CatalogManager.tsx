import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit3, HelpCircle, CheckCircle2, FolderPlus, AlertCircle, X, Upload } from 'lucide-react';

interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  productTypes: string[];
}

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
  allowCustomization: boolean;
  careKitIncluded: boolean;
  stockCount?: number;
  initialPuneStock?: number;
  initialMumbaiStock?: number;
}

interface CatalogManagerProps {
  catalog: { categories: Category[]; products: Product[] };
  authToken: string;
  onCatalogUpdated: (newCatalog: { categories: Category[]; products: Product[] }) => void;
}

const DEFAULT_IMAGES = [
  { label: 'Men Belt & Wallet Showcase', url: '/assets/images/product_men_belt_wallet_1794461808951.jpg' },
  { label: 'Women Purse & Bag Showcase', url: '/assets/images/product_women_purse_bag_1794461810441.jpg' },
  { label: 'Travel Backpack & Folio Showcase', url: '/assets/images/product_travel_backpack_folio_1794461810700.jpg' },
  { label: 'Leathercraft Workshop Bench', url: '/assets/images/hero_leathercraft_workshop_1794461808596.jpg' },
  { label: 'Custom Monogram Debossing', url: '/assets/images/custom_debossing_monogram_1794461810572.jpg' }
];

export const CatalogManager: React.FC<CatalogManagerProps> = ({ catalog, authToken, onCatalogUpdated }) => {
  const [categories, setCategories] = useState<Category[]>(catalog.categories || []);
  const [products, setProducts] = useState<Product[]>(catalog.products || []);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmDeleteProduct, setConfirmDeleteProduct] = useState<Product | null>(null);

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
  const [prodDesc, setProdDesc] = useState('');
  const [prodFeaturesText, setProdFeaturesText] = useState(
    'Full-grain steerhide\nHand-burnished beeswax edges\nSolid brass hardware'
  );
  const [prodHsn, setProdHsn] = useState('4202');
  const [prodGstPercent, setProdGstPercent] = useState('');
  const [prodSolutionEngine, setProdSolutionEngine] = useState('EVERYDAY_CARRY');
  const [prodAllowCustomization, setProdAllowCustomization] = useState(true);
  const [prodCareKitIncluded, setProdCareKitIncluded] = useState(true);
  const [prodImage, setProdImage] = useState(DEFAULT_IMAGES[0].url);
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

  const handleSaveCatalog = async (updatedCategories: Category[], updatedProducts: Product[]) => {
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
    setProdDesc('');
    setProdFeaturesText('Full-grain vegetable-tanned leather\nHand-burnished beeswax edges\nSolid brass hardware');
    setProdHsn('4202');
    setProdGstPercent('');
    setProdSolutionEngine('EVERYDAY_CARRY');
    setProdAllowCustomization(true);
    setProdCareKitIncluded(true);
    setProdImage(DEFAULT_IMAGES[0].url);
    setPuneInitStock(15);
    setMumbaiInitStock(10);
    setProductModalError(null);
    setShowProductModal(true);
  };

  const openEditProduct = (p: Product) => {
    setEditingProductId(p.id);
    setProdName(p.name);
    setProdCategory(p.category);
    setProdType(p.productType);
    setProdSku(p.sku);
    setProdPrice(p.price);
    setProdDesc(p.description);
    setProdFeaturesText((p.features || []).join('\n'));
    setProdHsn(p.hsnCode);
    setProdGstPercent(typeof p.gstRate === 'number' ? String(Math.round(p.gstRate * 100)) : '');
    setProdSolutionEngine(p.solutionEngine || 'EVERYDAY_CARRY');
    setProdAllowCustomization(p.allowCustomization !== false);
    setProdCareKitIncluded(p.careKitIncluded !== false);
    setProdImage(p.images[0] || DEFAULT_IMAGES[0].url);
    setProductModalError(null);
    setShowProductModal(true);
  };

  const handleImageFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      setFeedback({ type: 'error', message: 'Uploaded product image must be 1.5MB or smaller.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setProdImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
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
        const { gstRate: _prevGst, ...restProduct } = p;
        return {
          ...restProduct,
          name: prodName,
          category: prodCategory,
          productType: prodType.trim(),
          sku: trimmedSku,
          price: prodPrice,
          description: prodDesc,
          features: resolvedFeatures,
          hsnCode: prodHsn,
          ...(typeof normalizedGstRate === 'number' ? { gstRate: normalizedGstRate } : {}),
          solutionEngine: prodSolutionEngine,
          allowCustomization: prodAllowCustomization,
          careKitIncluded: prodCareKitIncluded,
          images: [prodImage.trim() || DEFAULT_IMAGES[0].url, ...p.images.slice(1)]
        };
      });
      handleSaveCatalog(nextCategories, nextProducts);
    } else {
      const newProduct: Product = {
        id: `prod-${Date.now()}`,
        name: prodName,
        category: prodCategory,
        productType: prodType.trim(),
        sku: trimmedSku,
        price: prodPrice,
        currency: 'INR',
        description: prodDesc || 'Handcrafted heirloom leather goods crafted from vegetable-tanned hides.',
        features: resolvedFeatures,
        images: [prodImage.trim() || DEFAULT_IMAGES[0].url],
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

  const isPresetImage = DEFAULT_IMAGES.some((img) => img.url === prodImage);

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
          {products.map((p) => (
            <div key={p.id} className="p-4 flex items-center justify-between gap-4 hover:bg-[#FAF7F2]/50">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={p.images[0]}
                  alt={p.name}
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 object-cover rounded bg-[#FAF7F2] border shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-[#16120E] truncate">{p.name}</h4>
                    {p.inStock === false && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-100 text-red-900">
                        Out of Stock · Deactivated
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#5C4D3E] font-mono mt-0.5">
                    Category: <strong className="text-[#16120E]">{p.category}</strong> ({p.productType}) · SKU: {p.sku} · HSN: {p.hsnCode} · GST:{' '}
                    {typeof p.gstRate === 'number' ? `${Math.round(p.gstRate * 100)}%` : 'Store Default'}
                    {typeof p.stockCount === 'number' && ` · On Hand: ${p.stockCount} pcs`}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 font-mono">
                <span className="font-bold text-sm text-[#16120E] mr-2 tabular-nums">
                  ₹{p.price.toLocaleString('en-IN')}
                </span>

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
          ))}
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

              <div className="grid grid-cols-4 gap-2">
                <div className="col-span-2">
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
                  <label className="block text-[#5C4D3E] mb-1">Price (₹)</label>
                  <input
                    type="number"
                    required
                    step={100}
                    value={prodPrice}
                    onChange={(e) => setProdPrice(parseInt(e.target.value || '0', 10))}
                    className="w-full px-3 py-1.5 border rounded font-mono font-bold bg-[#FAF7F2]"
                  />
                </div>
                <div>
                  <label className="block text-[#5C4D3E] mb-1">GST % (Blank = Store Default)</label>
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
                    onChange={(e) => setProdSolutionEngine(e.target.value)}
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

              {/* Product Image: Preset quick-pick OR custom URL OR local upload */}
              <div className="space-y-2 p-3 bg-[#FAF7F2] rounded-lg border border-[#221C16]/10">
                <label className="block text-[#5C4D3E] font-semibold">Product Photography</label>
                <div className="flex items-center gap-3">
                  {prodImage && (
                    <img
                      src={prodImage}
                      alt="Preview"
                      referrerPolicy="no-referrer"
                      className="w-14 h-14 object-cover rounded border bg-white shrink-0"
                    />
                  )}
                  <div className="flex-1 space-y-1.5 min-w-0">
                    <select
                      value={isPresetImage ? prodImage : 'CUSTOM'}
                      onChange={(e) => {
                        if (e.target.value !== 'CUSTOM') setProdImage(e.target.value);
                      }}
                      className="w-full px-2.5 py-1 border rounded bg-white"
                    >
                      {DEFAULT_IMAGES.map((img) => (
                        <option key={img.url} value={img.url}>
                          Preset: {img.label}
                        </option>
                      ))}
                      {!isPresetImage && <option value="CUSTOM">Custom Image URL / Upload</option>}
                    </select>
                    <input
                      type="text"
                      value={prodImage}
                      onChange={(e) => setProdImage(e.target.value)}
                      placeholder="Paste custom https:// image URL or upload file below"
                      className="w-full px-2.5 py-1 border rounded font-mono text-[11px] bg-white"
                    />
                  </div>
                </div>
                <label className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-[#221C16]/20 rounded bg-white cursor-pointer hover:bg-[#EBE4D5]/40 text-[11px] font-medium">
                  <Upload className="w-3.5 h-3.5 text-[#8B4513]" />
                  <span>Upload Image File (≤ 1.5MB)</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageFileUpload}
                    className="hidden"
                  />
                </label>
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
