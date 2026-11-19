import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { Navbar } from './components/Navbar.tsx';
import { BrandLogo } from './components/BrandLogo.tsx';
import { Storefront } from './components/Storefront.tsx';
import { ProductDetailModal } from './components/ProductDetailModal.tsx';
import { CartDrawer } from './components/CartDrawer.tsx';
import { Customer360View } from './components/Customer360View.tsx';
import { OmnichannelInbox } from './components/OmnichannelInbox.tsx';
import { SalesKanban } from './components/SalesKanban.tsx';
import { ERPWarehouseView } from './components/ERPWarehouseView.tsx';
import { AnalyticsDashboard } from './components/AnalyticsDashboard.tsx';
import { StoreManagementSettings } from './components/StoreManagementSettings.tsx';
import { CatalogManager } from './components/CatalogManager.tsx';
import { PatronAuthModal } from './components/PatronAuthModal.tsx';
import { PatronPortalView } from './components/PatronPortalView.tsx';
import { OurStoryView } from './components/OurStoryView.tsx';
import { KnowledgeBaseView } from './components/KnowledgeBaseView.tsx';
import { LegalPoliciesModal, LegalPolicyTab } from './components/LegalPoliciesModal.tsx';
import { CartItem, AuthUser } from './types/index.ts';
import { auth, onIdTokenChanged, signOutFirebase } from './lib/firebase.ts';

export default function App() {
  const [currentTab, setCurrentTab] = useState<string>('storefront');
  const [catalog, setCatalog] = useState<{ categories: any[]; products: any[] }>({
    categories: [],
    products: []
  });

  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [activePolicyTab, setActivePolicyTab] = useState<LegalPolicyTab | null>(null);
  const [resumedCartContext, setResumedCartContext] = useState<{ cartId?: string; email?: string }>({});
  const [defaultGstRatePercent, setDefaultGstRatePercent] = useState<number>(18);
  const [appNotice, setAppNotice] = useState<{ type: 'success' | 'warning' | 'error' | 'info'; message: string } | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  const showNotice = (type: 'success' | 'warning' | 'error' | 'info', message: string) => {
    setAppNotice({ type, message });
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setAppNotice(null);
    }, 5500);
  };

  // Authenticated User & Token State (defaults to signed-out customer view; never exposes admin options to patrons)
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => {
    try {
      const saved = localStorage.getItem('bvl_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [authToken, setAuthToken] = useState<string>(() => {
    try {
      return localStorage.getItem('bvl_token') || '';
    } catch {
      return '';
    }
  });

  const isSignedIn = Boolean(currentUser && authToken);
  const isAuthorizedStaff = Boolean(currentUser?.isStoreManagementAuthorized && authToken);
  const staffRole = currentUser?.role || 'PATRON';
  const canViewCrm = isAuthorizedStaff && (staffRole === 'STORE_MANAGER' || staffRole === 'SUPPORT_AGENT');
  const canViewErp = isAuthorizedStaff && (staffRole === 'STORE_MANAGER' || staffRole === 'LOGISTICS_COORDINATOR');
  const canViewAnalytics =
    isAuthorizedStaff &&
    (staffRole === 'STORE_MANAGER' || staffRole === 'SUPPORT_AGENT' || staffRole === 'LOGISTICS_COORDINATOR');
  const canViewAdminConsole = isAuthorizedStaff && staffRole === 'STORE_MANAGER';

  const canAccessTab = (tab: string): boolean => {
    if (tab === 'storefront' || tab === 'our-story' || tab === 'knowledge-base') return true;
    if (tab === 'my-atelier') return isSignedIn;
    if (tab === 'crm' || tab === 'inbox' || tab === 'kanban') return canViewCrm;
    if (tab === 'erp') return canViewErp;
    if (tab === 'analytics') return canViewAnalytics;
    if (tab === 'store-management' || tab === 'catalog-cms') return canViewAdminConsole;
    return false;
  };

  // Guard: enforce strict tab permissions by signed-in RBAC role
  useEffect(() => {
    if (!canAccessTab(currentTab)) {
      setCurrentTab('storefront');
    }
  }, [isSignedIn, isAuthorizedStaff, staffRole, currentTab]);

  const applyCatalogWithCartPriceSync = (nextCatalog: { categories: any[]; products: any[] }) => {
    setCatalog(nextCatalog);
    const liveProducts = nextCatalog.products || [];
    setCartItems((prev) =>
      prev.map((item) => {
        const match = liveProducts.find((p: any) => p.id === item.productId || p.sku === item.sku);
        if (!match) return item;
        const effectivePrice =
          typeof match.offerPrice === 'number' && match.offerPrice > 0 && match.offerPrice <= match.price
            ? match.offerPrice
            : match.price;
        return effectivePrice !== item.unitPrice ? { ...item, unitPrice: effectivePrice } : item;
      })
    );
  };

  const fetchCatalog = async (): Promise<{ categories: any[]; products: any[] } | null> => {
    try {
      const [catRes, cfgRes] = await Promise.all([
        fetch('/api/catalog'),
        fetch('/api/storefront/config')
      ]);
      const cfgData = await cfgRes.json().catch(() => null);
      if (cfgData?.success && typeof cfgData.gstRatePercent === 'number') {
        setDefaultGstRatePercent(cfgData.gstRatePercent);
      }
      const data = await catRes.json();
      if (data.success && data.catalog) {
        applyCatalogWithCartPriceSync(data.catalog);
        return data.catalog;
      }
    } catch (e) {
      console.warn('Failed to fetch catalog', e);
    }
    return null;
  };

  useEffect(() => {
    const init = async () => {
      const loadedCatalog = await fetchCatalog();

      const params = new URLSearchParams(window.location.search);
      const resumeId = params.get('resume');
      const resumeToken = params.get('token');

      if (resumeId) {
        try {
          const url = `/api/cart/${encodeURIComponent(resumeId)}${
            resumeToken ? `?token=${encodeURIComponent(resumeToken)}` : ''
          }`;
          const res = await fetch(url);
          const data = await res.json();

          if (!res.ok || !data.success || !data.cart) {
            showNotice('error', data.error || 'Could not restore your saved bag.');
          } else {
            const rawItems: CartItem[] = Array.isArray(data.cart.items) ? data.cart.items : [];
            const liveProducts = loadedCatalog?.products || [];
            const usedPerProduct: Record<string, number> = {};
            const hydrated: CartItem[] = [];
            let adjustedForStock = false;

            for (const item of rawItems) {
              const prod = liveProducts.find((p: any) => p.id === item.productId || p.sku === item.sku);
              if (prod && prod.inStock === false) {
                adjustedForStock = true;
                continue;
              }
              const maxStock = typeof prod?.stockCount === 'number' ? prod.stockCount : Infinity;
              const alreadyUsed = usedPerProduct[item.productId] || 0;
              const available = Math.max(0, maxStock - alreadyUsed);

              if (available <= 0) {
                adjustedForStock = true;
                continue;
              }

              const requestedQty = Math.max(1, item.quantity || 1);
              const clampedQty = Math.min(requestedQty, available);
              if (clampedQty < requestedQty) {
                adjustedForStock = true;
              }

              usedPerProduct[item.productId] = alreadyUsed + clampedQty;
              hydrated.push({
                ...item,
                quantity: clampedQty
              });
            }

            if (hydrated.length > 0) {
              setCartItems(hydrated);
              setResumedCartContext({
                cartId: data.cart.id,
                email: data.cart.email || ''
              });
              setIsCartOpen(true);
              showNotice(
                adjustedForStock ? 'warning' : 'success',
                adjustedForStock
                  ? 'Resumed your saved Atelier Bag (quantities adjusted to live warehouse stock).'
                  : 'Resumed your saved Atelier Bag.'
              );
            } else {
              showNotice('warning', 'Items from your saved bag are currently out of stock.');
            }
          }
        } catch {
          showNotice('error', 'Failed to restore your saved bag.');
        } finally {
          window.history.replaceState({}, '', '/');
        }
      }
    };

    init();
    return () => {
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  // Keep Google Firebase Authentication state and refreshed ID tokens synchronized with server RBAC
  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async (fbUser) => {
      if (fbUser) {
        try {
          const idToken = await fbUser.getIdToken();
          const res = await fetch('/api/auth/firebase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            handleLoginSuccess(data.user, data.token);
          }
        } catch (err) {
          console.warn('Session refresh failed', err);
        }
      } else {
        setCurrentUser((prev) => {
          if (prev?.authProvider === 'GOOGLE' || prev?.authProvider === 'FIREBASE') {
            setAuthToken('');
            setCurrentTab('storefront');
            try {
              localStorage.removeItem('bvl_user');
              localStorage.removeItem('bvl_token');
            } catch {
              // ignore storage errors
            }
            return null;
          }
          return prev;
        });
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSelectTab = (tab: string) => {
    if (tab === 'my-atelier') {
      if (!isSignedIn) {
        setIsAuthOpen(true);
        return;
      }
      setCurrentTab('my-atelier');
      return;
    }
    if (!canAccessTab(tab)) {
      setCurrentTab('storefront');
      return;
    }
    setCurrentTab(tab);
    if (tab === 'storefront') {
      fetchCatalog();
    }
  };

  const handleLoginSuccess = (user: AuthUser, token: string) => {
    setCurrentUser(user);
    setAuthToken(token);
    try {
      localStorage.setItem('bvl_user', JSON.stringify(user));
      localStorage.setItem('bvl_token', token);
    } catch {
      // ignore storage errors
    }
  };

  const handleLogout = () => {
    signOutFirebase().catch(() => {});
    setCurrentUser(null);
    setAuthToken('');
    setCurrentTab('storefront');
    try {
      localStorage.removeItem('bvl_user');
      localStorage.removeItem('bvl_token');
    } catch {
      // ignore storage errors
    }
  };

  const bagQtyByProductId = cartItems.reduce<Record<string, number>>((acc, it) => {
    acc[it.productId] = (acc[it.productId] || 0) + it.quantity;
    return acc;
  }, {});

  const handleAddToCart = (newItem: CartItem) => {
    const liveProd = catalog.products.find((p: any) => p.id === newItem.productId || p.sku === newItem.sku);
    if (liveProd && (liveProd.inStock === false || (typeof liveProd.stockCount === 'number' && liveProd.stockCount <= 0))) {
      showNotice('error', `${newItem.productName} is currently out of stock.`);
      return;
    }

    const maxStock = typeof liveProd?.stockCount === 'number' ? liveProd.stockCount : Infinity;
    const currentInBag = bagQtyByProductId[newItem.productId] || 0;
    const remaining = Math.max(0, maxStock - currentInBag);

    if (remaining <= 0) {
      showNotice('warning', `Maximum available stock (${maxStock}) for ${newItem.productName} is already in your bag.`);
      return;
    }

    const qtyToAdd = Math.min(newItem.quantity, remaining);
    if (qtyToAdd < newItem.quantity) {
      showNotice('warning', `Added ${qtyToAdd} unit(s) of ${newItem.productName} — reached warehouse limit (${maxStock}).`);
    } else if (Number.isFinite(maxStock) && currentInBag + qtyToAdd >= maxStock) {
      showNotice('info', `Added last available unit (${maxStock}/${maxStock} in bag) for ${newItem.productName}.`);
    }

    setCartItems((prev) => {
      const existingIdx = prev.findIndex(
        (it) => it.productId === newItem.productId && it.leatherType === newItem.leatherType && it.monogram === newItem.monogram
      );
      if (existingIdx >= 0) {
        const copy = [...prev];
        copy[existingIdx] = { ...copy[existingIdx], quantity: copy[existingIdx].quantity + qtyToAdd };
        return copy;
      }
      return [...prev, { ...newItem, quantity: qtyToAdd }];
    });
    setIsCartOpen(true);
  };

  const handleUpdateQty = (index: number, newQty: number) => {
    const targetItem = cartItems[index];
    if (!targetItem) return;

    const liveProd = catalog.products.find((p: any) => p.id === targetItem.productId || p.sku === targetItem.sku);
    const maxStock = typeof liveProd?.stockCount === 'number' ? liveProd.stockCount : Infinity;
    const otherQtyForProduct = cartItems.reduce(
      (sum, it, i) => (i !== index && it.productId === targetItem.productId ? sum + it.quantity : sum),
      0
    );
    const maxLineQty = Math.max(1, maxStock - otherQtyForProduct);
    const clampedQty = Math.max(1, Math.min(newQty, maxLineQty));

    if (newQty > maxLineQty && Number.isFinite(maxStock)) {
      showNotice('warning', `Only ${maxStock} unit(s) of ${targetItem.productName} available in warehouse stock.`);
    }

    setCartItems((prev) => {
      const copy = [...prev];
      if (!copy[index]) return prev;
      copy[index] = { ...copy[index], quantity: clampedQty };
      return copy;
    });
  };

  const handleRemoveItem = (index: number) => {
    setCartItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClearCart = () => {
    setCartItems([]);
    setResumedCartContext({});
    fetchCatalog();
  };

  const totalCartCount = cartItems.reduce((sum, it) => sum + it.quantity, 0);

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#221C16] flex flex-col font-sans-body">
      {/* Inline Storefront / Session Notification Toast */}
      {appNotice && (
        <div className="fixed bottom-5 right-5 z-[60] max-w-sm w-full px-4 pointer-events-auto">
          <div
            className={`p-3.5 rounded-xl border shadow-xl text-xs font-medium flex items-start justify-between gap-2.5 ${
              appNotice.type === 'error'
                ? 'bg-red-50 border-red-300 text-red-900'
                : appNotice.type === 'warning'
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : appNotice.type === 'success'
                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                : 'bg-[#16120E] border-[#C5A059]/40 text-[#FAF7F2]'
            }`}
          >
            <div className="flex items-start gap-2">
              {appNotice.type === 'error' || appNotice.type === 'warning' ? (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              ) : appNotice.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <Info className="w-4 h-4 text-[#C5A059] shrink-0 mt-0.5" />
              )}
              <span>{appNotice.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setAppNotice(null)}
              className="p-0.5 opacity-70 hover:opacity-100 shrink-0"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 3-Zone Top Bar Navigation */}
      <Navbar
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        cartCount={totalCartCount}
        onOpenCart={() => setIsCartOpen(true)}
        currentUser={currentUser}
        onOpenAuth={() => setIsAuthOpen(true)}
      />

      {/* Main View Router */}
      <main className="flex-1">
        {currentTab === 'storefront' && (
          <Storefront
            categories={catalog.categories}
            products={catalog.products}
            bagQtyByProductId={bagQtyByProductId}
            onSelectProduct={setSelectedProduct}
            onQuickAdd={handleAddToCart}
          />
        )}

        {currentTab === 'our-story' && <OurStoryView onNavigate={handleSelectTab} />}

        {currentTab === 'knowledge-base' && <KnowledgeBaseView />}

        {isSignedIn && currentTab === 'my-atelier' && currentUser && (
          <PatronPortalView
            currentUser={currentUser}
            authToken={authToken}
            onExploreStorefront={() => handleSelectTab('storefront')}
          />
        )}

        {canViewCrm && currentTab === 'crm' && <Customer360View authToken={authToken} />}

        {canViewCrm && currentTab === 'inbox' && <OmnichannelInbox authToken={authToken} />}

        {canViewErp && currentTab === 'erp' && (
          <ERPWarehouseView authToken={authToken} onInventoryChanged={fetchCatalog} />
        )}

        {canViewCrm && currentTab === 'kanban' && (
          <SalesKanban
            authToken={authToken}
            canPushToErp={canViewErp}
          />
        )}

        {canViewAnalytics && currentTab === 'analytics' && <AnalyticsDashboard authToken={authToken} />}

        {canViewAdminConsole && currentTab === 'store-management' && (
          <div className="space-y-6">
            <div className="max-w-7xl mx-auto px-6 pt-6 flex justify-end">
              <button
                onClick={() => setCurrentTab('catalog-cms')}
                className="px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#16120E] border border-[#221C16]/20 rounded hover:bg-white"
              >
                Switch to Catalogue Content CMS
              </button>
            </div>
            <StoreManagementSettings currentUser={currentUser} authToken={authToken} />
          </div>
        )}

        {canViewAdminConsole && currentTab === 'catalog-cms' && (
          <div className="space-y-6">
            <div className="max-w-7xl mx-auto px-6 pt-6 flex justify-end">
              <button
                onClick={() => setCurrentTab('store-management')}
                className="px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#16120E] border border-[#221C16]/20 rounded hover:bg-white"
              >
                Back to Admin Console
              </button>
            </div>
            <CatalogManager
              catalog={catalog}
              authToken={authToken}
              onCatalogUpdated={applyCatalogWithCartPriceSync}
            />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-[#16120E] text-[#EBE4D5] border-t border-[#C5A059]/20 py-12 px-6 mt-16">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 text-xs leading-relaxed">
          <div className="space-y-3">
            <BrandLogo size="md" lightText />
            <p className="text-[#EBE4D5]/70">
              Heirloom saddlery, transit folios, and bespoke vegetable-tanned &amp; conscious leather goods. Built to carry your character for generations.
            </p>
            <div className="text-[11px] font-mono text-[#C5A059]">
              GSTIN: 27AABCB1234F1Z8
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-bold text-[#FAF7F2] uppercase tracking-wider">Explore The Atelier</div>
            <div className="text-[#EBE4D5]/70 space-y-1.5 flex flex-col items-start">
              <button type="button" onClick={() => handleSelectTab('storefront')} className="hover:text-[#C5A059] transition-colors">
                Collections &amp; Everyday Carry
              </button>
              <button type="button" onClick={() => handleSelectTab('our-story')} className="hover:text-[#C5A059] transition-colors">
                Our Story &amp; Heritage
              </button>
              <button type="button" onClick={() => handleSelectTab('knowledge-base')} className="hover:text-[#C5A059] transition-colors">
                Leather Knowledge Base
              </button>
              <button type="button" onClick={() => handleSelectTab('my-atelier')} className="hover:text-[#C5A059] transition-colors">
                My Atelier &amp; Order Tracking
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-bold text-[#FAF7F2] uppercase tracking-wider">Patron Policies</div>
            <div className="text-[#EBE4D5]/70 space-y-1.5 flex flex-col items-start">
              <button type="button" onClick={() => setActivePolicyTab('TERMS')} className="hover:text-[#C5A059] transition-colors">
                Terms &amp; Conditions
              </button>
              <button type="button" onClick={() => setActivePolicyTab('RETURNS')} className="hover:text-[#C5A059] transition-colors">
                Return &amp; Exchange Policy (10-Day)
              </button>
              <button type="button" onClick={() => setActivePolicyTab('SHIPPING')} className="hover:text-[#C5A059] transition-colors">
                Shipping &amp; Dispatch Policy
              </button>
              <button type="button" onClick={() => setActivePolicyTab('PRIVACY')} className="hover:text-[#C5A059] transition-colors">
                Privacy Policy
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-bold text-[#FAF7F2] uppercase tracking-wider">Quality &amp; Concierge</div>
            <div className="text-[#EBE4D5]/70 space-y-1">
              <div>GST Compliant Tax Invoicing</div>
              <div>2-Year Solid Brass Hardware Warranty</div>
              <div>Insured Express Pan-India Dispatch</div>
              <div>support@bharatvarshcrafts.com</div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto pt-8 mt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between text-[11px] text-[#EBE4D5]/60 font-mono">
          <div>© {new Date().getFullYear()} Bharatvarsh Leathercrafts LLP. All rights reserved.</div>
          <div className="mt-2 sm:mt-0">Carry Your Character · Handcrafted Heirloom Leathergoods</div>
        </div>
      </footer>

      {/* Product Detail Modal */}
      {selectedProduct && (
        <ProductDetailModal
          key={selectedProduct.id}
          product={selectedProduct}
          bagQuantityForProduct={bagQtyByProductId[selectedProduct.id] || 0}
          defaultGstRatePercent={defaultGstRatePercent}
          onClose={() => setSelectedProduct(null)}
          onAddToCart={handleAddToCart}
          customerId={currentUser?.uid}
          authToken={authToken}
        />
      )}

      {/* Cart & Checkout Drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        items={cartItems}
        products={catalog.products}
        onUpdateQty={handleUpdateQty}
        onRemoveItem={handleRemoveItem}
        onClearCart={handleClearCart}
        patronEmail={currentUser?.email}
        patronName={currentUser?.name}
        authToken={authToken}
        resumedEmail={resumedCartContext.email}
        resumedCartId={resumedCartContext.cartId}
        onStockLimitNotice={(msg) => showNotice('warning', msg)}
        onOpenPolicy={(tab) => setActivePolicyTab(tab)}
      />

      {/* Legal Policies Modal */}
      <LegalPoliciesModal
        activeTab={activePolicyTab}
        onChangeTab={setActivePolicyTab}
        onClose={() => setActivePolicyTab(null)}
      />

      {/* Account Sign In Modal */}
      <PatronAuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        currentUser={currentUser}
        onLoginSuccess={handleLoginSuccess}
        onLogout={handleLogout}
      />
    </div>
  );
}
