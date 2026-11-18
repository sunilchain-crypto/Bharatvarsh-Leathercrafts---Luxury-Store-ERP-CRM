import React from 'react';
import { BrandLogo } from './BrandLogo.tsx';
import { ShoppingBag, ShieldCheck, User } from 'lucide-react';
import { AuthUser } from '../types/index.ts';

interface NavbarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  cartCount: number;
  onOpenCart: () => void;
  currentUser: AuthUser | null;
  onOpenAuth: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  cartCount,
  onOpenCart,
  currentUser,
  onOpenAuth
}) => {
  const isStaff = Boolean(currentUser?.isStoreManagementAuthorized);
  const role = currentUser?.role || 'PATRON';
  const canViewCrm = isStaff && (role === 'STORE_MANAGER' || role === 'SUPPORT_AGENT');
  const canViewErp = isStaff && (role === 'STORE_MANAGER' || role === 'LOGISTICS_COORDINATOR');
  const canViewAnalytics =
    isStaff && (role === 'STORE_MANAGER' || role === 'SUPPORT_AGENT' || role === 'LOGISTICS_COORDINATOR');
  const canViewAdminConsole = isStaff && role === 'STORE_MANAGER';

  return (
    <header className="sticky top-0 z-40 bg-[#FAF7F2]/95 backdrop-blur-md border-b border-[#221C16]/10 px-6 py-3 transition-colors">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-8">
        {/* Zone 1: Brand Wordmark & Attached Logo */}
        <button
          onClick={() => onSelectTab('storefront')}
          className="text-left shrink-0 hover:opacity-90 transition-opacity"
        >
          <BrandLogo size="md" />
        </button>

        {/* Zone 2: Navigation links - Scoped strictly by authenticated RBAC role */}
        <nav className="hidden lg:flex items-center gap-6 text-xs font-medium tracking-wide uppercase">
          <button
            onClick={() => onSelectTab('storefront')}
            className={`whitespace-nowrap shrink-0 transition-colors ${
              currentTab === 'storefront'
                ? 'text-[#8B4513] font-semibold border-b border-[#8B4513] pb-0.5'
                : 'text-[#5C4D3E] hover:text-[#16120E]'
            }`}
          >
            Collections
          </button>

          {currentUser && (
            <button
              onClick={() => onSelectTab('my-atelier')}
              className={`whitespace-nowrap shrink-0 transition-colors ${
                currentTab === 'my-atelier'
                  ? 'text-[#8B4513] font-semibold border-b border-[#8B4513] pb-0.5'
                  : 'text-[#5C4D3E] hover:text-[#16120E]'
              }`}
            >
              My Atelier
            </button>
          )}

          {canViewCrm && (
            <>
              <button
                onClick={() => onSelectTab('crm')}
                className={`whitespace-nowrap shrink-0 transition-colors ${
                  currentTab === 'crm'
                    ? 'text-[#8B4513] font-semibold border-b border-[#8B4513] pb-0.5'
                    : 'text-[#5C4D3E] hover:text-[#16120E]'
                }`}
              >
                Customer 360
              </button>

              <button
                onClick={() => onSelectTab('inbox')}
                className={`whitespace-nowrap shrink-0 transition-colors ${
                  currentTab === 'inbox'
                    ? 'text-[#8B4513] font-semibold border-b border-[#8B4513] pb-0.5'
                    : 'text-[#5C4D3E] hover:text-[#16120E]'
                }`}
              >
                Inbox
              </button>
            </>
          )}

          {canViewErp && (
            <button
              onClick={() => onSelectTab('erp')}
              className={`whitespace-nowrap shrink-0 transition-colors ${
                currentTab === 'erp'
                  ? 'text-[#8B4513] font-semibold border-b border-[#8B4513] pb-0.5'
                  : 'text-[#5C4D3E] hover:text-[#16120E]'
              }`}
            >
              ERP & Inventory
            </button>
          )}

          {canViewCrm && (
            <button
              onClick={() => onSelectTab('kanban')}
              className={`whitespace-nowrap shrink-0 transition-colors ${
                currentTab === 'kanban'
                  ? 'text-[#8B4513] font-semibold border-b border-[#8B4513] pb-0.5'
                  : 'text-[#5C4D3E] hover:text-[#16120E]'
              }`}
            >
              Pipeline
            </button>
          )}

          {canViewAnalytics && (
            <button
              onClick={() => onSelectTab('analytics')}
              className={`whitespace-nowrap shrink-0 transition-colors ${
                currentTab === 'analytics'
                  ? 'text-[#8B4513] font-semibold border-b border-[#8B4513] pb-0.5'
                  : 'text-[#5C4D3E] hover:text-[#16120E]'
              }`}
            >
              Analytics
            </button>
          )}

          {canViewAdminConsole && (
            <button
              onClick={() => onSelectTab('store-management')}
              className={`whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors ${
                currentTab === 'store-management' || currentTab === 'catalog-cms'
                  ? 'text-[#8B4513] font-semibold border-b border-[#8B4513] pb-0.5'
                  : 'text-[#5C4D3E] hover:text-[#16120E]'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-[#C5A059]" />
              Admin Console
            </button>
          )}
        </nav>

        {/* Zone 3: Account Sign In & Bag */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onOpenAuth}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[#221C16] hover:bg-[#EBE4D5]/60 rounded border border-[#221C16]/15 transition-colors whitespace-nowrap"
            title="Account & Sign In"
          >
            <User className="w-3.5 h-3.5 text-[#8B4513]" />
            <span className="max-w-[120px] truncate">
              {currentUser ? currentUser.email.split('@')[0] : 'Sign In'}
            </span>
          </button>

          <button
            onClick={onOpenCart}
            className="relative flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-[#FAF7F2] bg-[#221C16] hover:bg-[#342B22] rounded transition-colors shadow-sm whitespace-nowrap"
          >
            <ShoppingBag className="w-3.5 h-3.5 text-[#C5A059]" />
            <span>Bag</span>
            {cartCount > 0 && (
              <span className="font-mono text-[11px] font-bold bg-[#C5A059] text-[#16120E] px-1.5 py-0.2 rounded-full tabular-nums">
                {cartCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Responsive Mobile Navigation Sub-bar */}
      {(currentUser || isStaff) && (
        <div className="lg:hidden flex items-center gap-4 overflow-x-auto pt-2.5 mt-2.5 border-t border-[#221C16]/10 text-[11px] font-medium uppercase tracking-wider">
          <button onClick={() => onSelectTab('storefront')} className="whitespace-nowrap shrink-0 text-[#5C4D3E]">Collections</button>
          {currentUser && (
            <button
              onClick={() => onSelectTab('my-atelier')}
              className={`whitespace-nowrap shrink-0 ${currentTab === 'my-atelier' ? 'text-[#8B4513] font-semibold' : 'text-[#5C4D3E]'}`}
            >
              My Atelier
            </button>
          )}
          {canViewCrm && (
            <>
              <button onClick={() => onSelectTab('crm')} className="whitespace-nowrap shrink-0 text-[#5C4D3E]">Customer 360</button>
              <button onClick={() => onSelectTab('inbox')} className="whitespace-nowrap shrink-0 text-[#5C4D3E]">Inbox</button>
            </>
          )}
          {canViewErp && (
            <button onClick={() => onSelectTab('erp')} className="whitespace-nowrap shrink-0 text-[#5C4D3E]">ERP & Inventory</button>
          )}
          {canViewCrm && (
            <button onClick={() => onSelectTab('kanban')} className="whitespace-nowrap shrink-0 text-[#5C4D3E]">Pipeline</button>
          )}
          {canViewAnalytics && (
            <button onClick={() => onSelectTab('analytics')} className="whitespace-nowrap shrink-0 text-[#5C4D3E]">Analytics</button>
          )}
          {canViewAdminConsole && (
            <button onClick={() => onSelectTab('store-management')} className="whitespace-nowrap shrink-0 text-[#8B4513] font-semibold">Admin Console</button>
          )}
        </div>
      )}
    </header>
  );
};
