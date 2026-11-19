/**
 * Central Relational Store & Persistent Repository for Bharatvarsh Leathercrafts LLP
 * Persists permanently to Hostinger Local MySQL (via mysqlAdapter) and disk write-through storage.
 * Primary Hub: Pune, Maharashtra
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  Customer,
  CustomerAddress,
  Order,
  HotStampingVector,
  WarrantyRegistration,
  CareKitDispatch,
  CorporateGiftingLead,
  SupportTicket,
  CartRecord,
  ProductInventory,
  BillOfMaterialsItem,
  GSTInvoice,
  GSTCreditNote,
  AuditLogEntry,
  StoreManagementConfig,
  PromoCodeRule,
  UserRole,
  OrderStatus,
  AdminUserCredential
} from '../types/index.ts';
import { mysqlAdapter } from './mysqlAdapter.ts';
import { hashPassword, verifyPassword } from './security.ts';

export const MASTER_AUTHORIZED_ACCOUNTS = [
  'support@bharatvarshcrafts.com',
  'sunilchain@gmail.com'
];

export interface PatronCredentialRecord {
  email: string;
  passwordHash: string;
  updatedAt: string;
}

interface DatabaseState {
  customers: Customer[];
  addresses: CustomerAddress[];
  orders: Order[];
  hotStampingVectors: HotStampingVector[];
  warranties: WarrantyRegistration[];
  careKitDispatches: CareKitDispatch[];
  corporateGiftingLeads: CorporateGiftingLead[];
  supportTickets: SupportTicket[];
  carts: CartRecord[];
  inventory: ProductInventory[];
  billOfMaterials: BillOfMaterialsItem[];
  gstInvoices: GSTInvoice[];
  gstCreditNotes: GSTCreditNote[];
  auditLogs: AuditLogEntry[];
  config: StoreManagementConfig;
  patronCredentials?: Record<string, PatronCredentialRecord>;
  processedWebhookIds: string[];
  lastDailyReportDate?: string;
}

class RelationalDatabase {
  private state: DatabaseState;
  private catalogCache: any = null;
  private dataFilePath: string;
  private catalogFilePath: string;
  private mysqlInitialized: boolean = false;
  private writeLock: Promise<void> = Promise.resolve();
  private pendingPersistPromise: Promise<void> = Promise.resolve();
  private lastPersistError: string | null = null;
  private insideAtomicTransaction: boolean = false;

  constructor() {
    this.dataFilePath = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    this.catalogFilePath = path.resolve(process.cwd(), 'src/server/catalog.json');
    this.loadCatalog();
    this.state = this.loadPersistedStateOrSeed();
    this.reconcileInventoryWithCatalog();
    this.reconcileCustomerAddresses();
  }

  /**
   * Serializes mutating write workflows to prevent local race conditions
   * alongside MySQL SELECT ... FOR UPDATE row locks.
   */
  public withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeLock.then(fn, fn);
    this.writeLock = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /**
   * Initializes Hostinger local MySQL connection on server startup
   */
  public async initializeMySQL() {
    if (this.mysqlInitialized) return;
    this.mysqlInitialized = true;
    const status = await mysqlAdapter.configureAndConnect();
    if (status.connected) {
      try {
        const remoteCatalog = await mysqlAdapter.loadCatalogSnapshot();
        if (remoteCatalog) {
          const { catalog: normalizedCatalog, changed } = this.normalizeCatalogAssets(remoteCatalog);
          this.catalogCache = normalizedCatalog;
          this.writeCatalogToDiskOnly(normalizedCatalog);
          if (changed) {
            await mysqlAdapter.saveCatalogSnapshot(normalizedCatalog);
          }
          console.log('[DB] Hydrated product catalog from Hostinger MySQL.');
        } else if (this.catalogCache) {
          await mysqlAdapter.saveCatalogSnapshot(this.catalogCache);
          console.log('[DB] Seeded initial product catalog into Hostinger MySQL.');
        }

        const remoteState = await mysqlAdapter.loadStateSnapshot();
        if (remoteState) {
          this.state = this.migrateLegacyState(remoteState);
          this.reconcileInventoryWithCatalog();
          this.reconcileCustomerAddresses();
          this.persistToDiskOnly();
          await mysqlAdapter.saveStateSnapshot(this.state);
          console.log('[DB] Hydrated permanent state from Hostinger MySQL.');
        } else {
          await mysqlAdapter.saveStateSnapshot(this.state);
          console.log('[DB] Seeded initial state into Hostinger MySQL.');
        }
      } catch (err: any) {
        this.lastPersistError = err.message;
        console.error('[DB] Hostinger MySQL initialization sync error:', err.message);
      }
    }
  }

  private migrateLegacyState(raw: any): DatabaseState {
    // Migrate legacy jaipurAtelier key -> punePrimaryHub if present in older snapshots
    if (Array.isArray(raw.inventory)) {
      raw.inventory = raw.inventory.map((inv: any) => {
        if (inv.stockByLocation && inv.stockByLocation.jaipurAtelier !== undefined && inv.stockByLocation.punePrimaryHub === undefined) {
          inv.stockByLocation = {
            punePrimaryHub: inv.stockByLocation.jaipurAtelier,
            mumbaiWarehouse: inv.stockByLocation.mumbaiWarehouse || 0
          };
        }
        return inv;
      });
    }
    if (raw.config) {
      raw.config.primaryHubCity = 'Pune';
      if (!raw.config.supplierGstin) {
        raw.config.supplierGstin = process.env.BHARATVARSH_GSTIN || '27AABCB1234F1Z8';
      }
      if (typeof raw.config.gstRatePercent !== 'number') {
        raw.config.gstRatePercent = 18;
      }
      if (!Array.isArray(raw.config.promoCodes)) {
        raw.config.promoCodes = [
          {
            code: 'HEIRLOOM10',
            discountPercent: 10,
            active: true,
            description: '10% bespoke atelier patron privilege'
          }
        ];
      }
      if (!Array.isArray(raw.config.adminCredentials)) {
        raw.config.adminCredentials = MASTER_AUTHORIZED_ACCOUNTS.map(email => ({
          userId: email,
          displayName: email === 'sunilchain@gmail.com' ? 'Sunil Chainani' : 'Bharatvarsh Support Desk',
          role: 'STORE_MANAGER' as UserRole,
          passwordHash: '',
          addedBy: 'system',
          addedAt: new Date().toISOString(),
          isMaster: true
        }));
      } else {
        raw.config.adminCredentials = raw.config.adminCredentials.map((cred: any) => ({
          ...cred,
          role: cred.isMaster ? 'STORE_MANAGER' : cred.role || 'STORE_MANAGER'
        }));
      }
    }
    if (Array.isArray(raw.billOfMaterials)) {
      raw.billOfMaterials = raw.billOfMaterials.map((b: any) => ({
        ...b,
        safetyStock: typeof b.safetyStock === 'number' ? b.safetyStock : b.unit === 'PIECES' ? 20 : 100
      }));
    }
    if (Array.isArray(raw.customers)) {
      raw.customers = raw.customers.map((c: any) => ({
        ...c,
        isActive: c.isActive !== false,
        deletedAt: c.deletedAt ?? null
      }));
    }
    if (!raw.patronCredentials || typeof raw.patronCredentials !== 'object') {
      raw.patronCredentials = {};
    }
    if (Array.isArray(raw.hotStampingVectors)) {
      raw.hotStampingVectors = raw.hotStampingVectors.map((v: any) => ({
        ...v,
        ...(v.previewImageUrl ? { previewImageUrl: this.normalizeImageUrl(v.previewImageUrl) } : {})
      }));
    }
    if (Array.isArray(raw.carts)) {
      raw.carts = raw.carts.map((cart: any) => ({
        ...cart,
        items: Array.isArray(cart.items)
          ? cart.items.map((item: any) => ({
              ...item,
              ...(item.imageUrl ? { imageUrl: this.normalizeImageUrl(item.imageUrl) } : {})
            }))
          : []
      }));
    }
    if (Array.isArray(raw.orders)) {
      raw.orders = raw.orders.map((ord: any) => ({
        ...ord,
        items: Array.isArray(ord.items)
          ? ord.items.map((item: any) => ({
              ...item,
              ...(item.imageUrl ? { imageUrl: this.normalizeImageUrl(item.imageUrl) } : {})
            }))
          : []
      }));
    }
    return raw as DatabaseState;
  }

  private loadPersistedStateOrSeed(): DatabaseState {
    try {
      if (fs.existsSync(this.dataFilePath)) {
        const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return this.migrateLegacyState(parsed);
      }
    } catch (e) {
      console.warn('[DB] Failed to load local persistent store, initializing seed state:', e);
    }
    const seed = this.initializeSeedState();
    this.persistToDiskOnly(seed);
    return seed;
  }

  private persistToDiskOnly(targetState?: DatabaseState) {
    const dir = path.dirname(this.dataFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.dataFilePath, JSON.stringify(targetState || this.state, null, 2), 'utf-8');
  }

  private writeCatalogToDiskOnly(catalogData: any) {
    fs.writeFileSync(this.catalogFilePath, JSON.stringify(catalogData, null, 2), 'utf-8');
  }

  public getRawCatalog(): { categories: any[]; products: any[] } {
    if (!this.catalogCache) {
      this.loadCatalog();
    }
    return this.catalogCache || { categories: [], products: [] };
  }

  public getFullStateSnapshot(): DatabaseState {
    return this.state;
  }

  public getLastPersistError(): string | null {
    return this.lastPersistError;
  }

  public getLastDailyReportDate(): string | undefined {
    return this.state.lastDailyReportDate;
  }

  public setLastDailyReportDate(dateKey: string): void {
    this.state.lastDailyReportDate = dateKey;
    this.persistState();
  }

  /**
   * Queues durable persistence to local disk and Hostinger MySQL (if connected).
   * Callers performing API writes should await flushPersistence() or persistStateAsync()
   * so database write failures are surfaced to the caller rather than silently ignored.
   */
  public persistState() {
    if (this.insideAtomicTransaction) return;
    this.persistToDiskOnly();
    if (mysqlAdapter.isConnected()) {
      const snapshot = structuredClone(this.state);
      this.pendingPersistPromise = this.pendingPersistPromise
        .then(async () => {
          await mysqlAdapter.saveStateSnapshot(snapshot);
          this.lastPersistError = null;
        })
        .catch((err: any) => {
          this.lastPersistError = err.message;
          console.error('[DB] MySQL write-through failed:', err.message);
        });
    }
  }

  public async persistStateAsync(rollbackSnapshot?: DatabaseState): Promise<void> {
    this.persistToDiskOnly();
    if (mysqlAdapter.isConnected()) {
      try {
        await mysqlAdapter.saveStateSnapshot(this.state);
        this.lastPersistError = null;
      } catch (err: any) {
        this.lastPersistError = err.message;
        if (rollbackSnapshot) {
          this.state = rollbackSnapshot;
          this.persistToDiskOnly();
        }
        throw err;
      }
    }
  }

  public async runAtomicMutation<T>(fn: () => T): Promise<T> {
    return this.withWriteLock(async () => {
      const prevState = structuredClone(this.state);
      this.insideAtomicTransaction = true;
      let result: T;
      try {
        result = fn();
      } catch (err) {
        this.insideAtomicTransaction = false;
        this.state = prevState;
        throw err;
      }
      this.insideAtomicTransaction = false;

      try {
        if (mysqlAdapter.isConnected()) {
          await mysqlAdapter.saveStateSnapshot(this.state);
        }
        this.persistToDiskOnly();
        this.lastPersistError = null;
        return result;
      } catch (err: any) {
        this.state = prevState;
        this.persistToDiskOnly();
        this.lastPersistError = err.message;
        throw err;
      }
    });
  }

  public async flushPersistence(): Promise<void> {
    await this.pendingPersistPromise;
    if (this.lastPersistError) {
      const errMsg = this.lastPersistError;
      this.lastPersistError = null;
      throw new Error(errMsg);
    }
  }

  private normalizeImageUrl(url?: string): string {
    if (!url || typeof url !== 'string') return '';
    return url.trim().replace(/^\/?src\/assets\/images\//, '/assets/images/');
  }

  private normalizeCatalogAssets(catalog: any): { catalog: any; changed: boolean } {
    if (!catalog || !Array.isArray(catalog.products)) {
      return { catalog, changed: false };
    }
    let changed = false;
    const products = catalog.products.map((prod: any) => {
      const sourceImages = Array.isArray(prod.images)
        ? prod.images
        : typeof prod.image === 'string' && prod.image.trim()
        ? [prod.image]
        : [];
      const nextImages = sourceImages
        .map((img: any) => this.normalizeImageUrl(img))
        .filter(Boolean)
        .slice(0, 4);
      const nextPrimaryImage = nextImages[0] || '';
      const nextVideoUrl = typeof prod.videoUrl === 'string' ? this.normalizeImageUrl(prod.videoUrl) : '';

      const imagesChanged =
        !Array.isArray(prod.images) ||
        prod.images.length !== nextImages.length ||
        nextImages.some((img: string, idx: number) => img !== prod.images[idx]);
      const primaryChanged = prod.image !== nextPrimaryImage;
      const videoChanged = Boolean(prod.videoUrl) && nextVideoUrl !== prod.videoUrl;

      if (!imagesChanged && !primaryChanged && !videoChanged) {
        return prod;
      }
      changed = true;
      const updated = {
        ...prod,
        images: nextImages,
        image: nextPrimaryImage
      };
      if (nextVideoUrl) {
        updated.videoUrl = nextVideoUrl;
      } else {
        delete updated.videoUrl;
      }
      return updated;
    });
    return {
      catalog: changed ? { ...catalog, products } : catalog,
      changed
    };
  }

  private loadCatalog() {
    try {
      if (fs.existsSync(this.catalogFilePath)) {
        const raw = fs.readFileSync(this.catalogFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.catalogCache = this.normalizeCatalogAssets(parsed).catalog;
      }
    } catch (e) {
      console.warn('Could not read catalog.json directly, using fallback', e);
    }
  }

  /**
   * Ensures every product in catalog.json has a matching inventory record
   */
  private reconcileInventoryWithCatalog() {
    if (!this.catalogCache || !Array.isArray(this.catalogCache.products)) return;
    let changed = false;
    for (const prod of this.catalogCache.products) {
      const exists = this.state.inventory.find(i => i.productId === prod.id || i.sku === prod.sku);
      if (!exists) {
        this.state.inventory.push({
          id: `inv_${prod.sku.toLowerCase()}`,
          productId: prod.id,
          sku: prod.sku,
          name: prod.name,
          category: prod.category,
          stockByLocation: {
            punePrimaryHub: 18,
            mumbaiWarehouse: 25
          },
          safetyStock: 5,
          reorderPoint: 10,
          unitCost: Math.round(prod.price * 0.38),
          sellingPrice: prod.price,
          batchLotNumber: `LOT-2026-${prod.sku.slice(-4)}`,
          leadTimeDays: 10
        });
        changed = true;
      }
    }
    if (changed) {
      this.persistState();
    }
  }

  /**
   * Returns catalog enriched with live inventory counts and active/out-of-stock status.
   * When total inventory == 0, product is deactivated (inStock: false, isActive: false).
   */
  public getCatalog() {
    if (!this.catalogCache) {
      this.loadCatalog();
    }
    if (!this.catalogCache) return { categories: [], products: [] };

    const enrichedProducts = (this.catalogCache.products || []).map((prod: any) => {
      const inv = this.state.inventory.find(i => i.productId === prod.id || i.sku === prod.sku);
      const puneStock = inv ? inv.stockByLocation.punePrimaryHub : 0;
      const mumbaiStock = inv ? inv.stockByLocation.mumbaiWarehouse : 0;
      const totalStock = puneStock + mumbaiStock;
      const isAvailable = totalStock > 0;
      const images = (
        Array.isArray(prod.images)
          ? prod.images
          : typeof prod.image === 'string' && prod.image.trim()
          ? [prod.image.trim()]
          : []
      ).slice(0, 4);

      return {
        ...prod,
        images,
        image: images[0] || '',
        stockCount: totalStock,
        puneStock,
        mumbaiStock,
        inStock: isAvailable,
        isActive: isAvailable
      };
    });

    return {
      ...this.catalogCache,
      products: enrichedProducts
    };
  }

  private applyCatalogUpdateInMemory(catalogData: any, actorEmail: string) {
    const rawProducts = Array.isArray(catalogData.products) ? catalogData.products : [];
    const seenSkus = new Set<string>();
    const cleanProducts: any[] = [];

    for (const rawProd of rawProducts) {
      const normalizedSku = typeof rawProd?.sku === 'string' ? rawProd.sku.trim().toUpperCase() : '';
      if (!normalizedSku) {
        throw new Error(`Product "${rawProd?.name || rawProd?.id || 'Unnamed'}" SKU cannot be empty.`);
      }
      if (seenSkus.has(normalizedSku)) {
        throw new Error(`Duplicate SKU detected: "${rawProd.sku.trim()}". Every catalog piece must have a unique SKU.`);
      }
      seenSkus.add(normalizedSku);

      const numPrice = Number(rawProd.price);
      if (!Number.isFinite(numPrice) || numPrice < 0) {
        throw new Error(`MRP price must be a valid non-negative number for "${rawProd.name || normalizedSku}".`);
      }

      let cleanOfferPrice: number | undefined;
      if (rawProd.offerPrice !== undefined && rawProd.offerPrice !== null && String(rawProd.offerPrice).trim() !== '') {
        const parsedOffer = Number(rawProd.offerPrice);
        if (!Number.isFinite(parsedOffer) || parsedOffer < 0) {
          throw new Error(`Offer price must be a valid non-negative number for "${rawProd.name || normalizedSku}".`);
        }
        if (parsedOffer > 0) {
          if (parsedOffer > numPrice) {
            throw new Error(
              `Offer price (₹${parsedOffer}) cannot exceed MRP price (₹${numPrice}) for "${rawProd.name || normalizedSku}".`
            );
          }
          cleanOfferPrice = parsedOffer;
        }
      }

      const rawImageList = Array.isArray(rawProd.images)
        ? rawProd.images
        : typeof rawProd.image === 'string' && rawProd.image.trim()
        ? [rawProd.image]
        : [];
      const normalizedImages = rawImageList.map((img: any) => this.normalizeImageUrl(img)).filter(Boolean);
      if (normalizedImages.length > 4) {
        throw new Error(`Maximum 4 product images allowed for "${rawProd.name || normalizedSku}".`);
      }

      const cleanVideoUrl =
        typeof rawProd.videoUrl === 'string' ? this.normalizeImageUrl(rawProd.videoUrl) : '';

      const {
        stockCount: _stockCount,
        puneStock: _puneStock,
        mumbaiStock: _mumbaiStock,
        isActive: _isActive,
        initialPuneStock: _initialPuneStock,
        initialMumbaiStock: _initialMumbaiStock,
        offerPrice: _ignoredOffer,
        videoUrl: _ignoredVideo,
        image: _ignoredImage,
        images: _ignoredImages,
        ...rest
      } = rawProd;

      const cleanedProduct: any = {
        ...rest,
        sku: String(rawProd.sku).trim(),
        price: numPrice,
        images: normalizedImages,
        image: normalizedImages[0] || ''
      };
      if (cleanOfferPrice !== undefined) {
        cleanedProduct.offerPrice = cleanOfferPrice;
      }
      if (cleanVideoUrl) {
        cleanedProduct.videoUrl = cleanVideoUrl;
      }
      cleanProducts.push(cleanedProduct);
    }

    const cleanCatalog = {
      categories: catalogData.categories || [],
      products: cleanProducts
    };

    this.catalogCache = cleanCatalog;

    // Reconcile newly added & renamed products into inventory and BOM (preserving initialStock if supplied)
    for (const prod of rawProducts) {
      const cleanSku = String(prod.sku).trim();
      const existingInv = this.state.inventory.find(
        i => i.productId === prod.id || i.sku.toLowerCase() === cleanSku.toLowerCase()
      );
      if (!existingInv) {
        this.state.inventory.push({
          id: `inv_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          productId: prod.id,
          sku: cleanSku,
          name: prod.name,
          category: prod.category,
          stockByLocation: {
            punePrimaryHub: typeof prod.initialPuneStock === 'number' ? prod.initialPuneStock : 15,
            mumbaiWarehouse: typeof prod.initialMumbaiStock === 'number' ? prod.initialMumbaiStock : 10
          },
          safetyStock: 5,
          reorderPoint: 10,
          unitCost: Math.round(prod.price * 0.38),
          sellingPrice: prod.price,
          batchLotNumber: `LOT-2026-${cleanSku.slice(-4)}`,
          leadTimeDays: 10
        });
      } else {
        const previousSku = existingInv.sku;
        existingInv.productId = prod.id;
        existingInv.sku = cleanSku;
        existingInv.name = prod.name;
        existingInv.sellingPrice = prod.price;
        existingInv.category = prod.category;
        if (previousSku && previousSku !== cleanSku) {
          for (const bom of this.state.billOfMaterials) {
            if (bom.parentSku === previousSku) {
              bom.parentSku = cleanSku;
            }
          }
        }
      }
    }

    // Remove inventory rows for deleted catalog products so bvl_inventory stays orphan-free
    const activeProdIds = new Set(cleanProducts.map((p: any) => p.id));
    const activeSkus = new Set(cleanProducts.map((p: any) => p.sku.toLowerCase()));
    this.state.inventory = this.state.inventory.filter(
      inv => activeProdIds.has(inv.productId) || activeSkus.has(inv.sku.toLowerCase())
    );

    this.appendAuditEntry(actorEmail, 'UPDATE_CATALOG', 'STORE_MANAGEMENT', 'Updated categories and product catalog');
    return cleanCatalog;
  }

  public saveCatalog(catalogData: any, actorEmail: string): boolean {
    try {
      const cleanCatalog = this.applyCatalogUpdateInMemory(catalogData, actorEmail);
      this.writeCatalogToDiskOnly(cleanCatalog);
      this.persistState();
      if (mysqlAdapter.isConnected()) {
        this.pendingPersistPromise = this.pendingPersistPromise
          .then(() => mysqlAdapter.saveCatalogSnapshot(cleanCatalog))
          .catch((err: any) => {
            this.lastPersistError = err.message;
          });
      }
      return true;
    } catch (e) {
      console.error('Failed to save catalog.json', e);
      return false;
    }
  }

  public async saveCatalogAsync(catalogData: any, actorEmail: string): Promise<any> {
    return this.withWriteLock(async () => {
      const prevState = structuredClone(this.state);
      const prevCatalog = structuredClone(this.getRawCatalog());

      this.insideAtomicTransaction = true;
      let cleanCatalog: any;
      try {
        cleanCatalog = this.applyCatalogUpdateInMemory(catalogData, actorEmail);
      } finally {
        this.insideAtomicTransaction = false;
      }

      try {
        await mysqlAdapter.saveCatalogAndStateAtomic(cleanCatalog, this.state);
        this.writeCatalogToDiskOnly(cleanCatalog);
        this.persistToDiskOnly();
        this.lastPersistError = null;
        return this.getCatalog();
      } catch (err: any) {
        this.state = prevState;
        this.catalogCache = prevCatalog;
        this.writeCatalogToDiskOnly(prevCatalog);
        this.persistToDiskOnly();
        this.lastPersistError = err.message;
        throw err;
      }
    });
  }

  private initializeSeedState(): DatabaseState {
    const adminCredentials: AdminUserCredential[] = MASTER_AUTHORIZED_ACCOUNTS.map(email => ({
      userId: email,
      displayName: email === 'sunilchain@gmail.com' ? 'Sunil Chainani (Founding Partner)' : 'Bharatvarsh Support Desk',
      role: 'STORE_MANAGER',
      passwordHash: '',
      addedBy: 'system',
      addedAt: new Date().toISOString(),
      isMaster: true
    }));

    const config: StoreManagementConfig = {
      id: 'cfg_bvl_01',
      gstInvoicingEnabled: true,
      masterSuperAdmins: [...MASTER_AUTHORIZED_ACCOUNTS],
      permittedStoreManagers: [...MASTER_AUTHORIZED_ACCOUNTS],
      adminCredentials,
      abandonmentThresholdMinutes: 15,
      primaryHubCity: 'Pune',
      supplierGstin: process.env.BHARATVARSH_GSTIN || '27AABCB1234F1Z8',
      gstRatePercent: 18,
      promoCodes: [
        {
          code: 'HEIRLOOM10',
          discountPercent: 10,
          active: true,
          description: '10% bespoke atelier patron privilege'
        }
      ],
      updatedAt: new Date().toISOString(),
      lastUpdatedBy: 'system'
    };

    const customers: Customer[] = [
      {
        id: 'cust_01_vip',
        identityUid: 'uid_patron_01',
        fullName: 'Vikramaditya Singhania',
        email: 'vikram.singhania@heritagecrafts.in',
        phone: '+91 98201 12345',
        role: 'PATRON',
        createdAt: '2025-06-14T10:00:00Z',
        updatedAt: '2026-10-20T14:30:00Z',
        totalOrders: 6,
        lifetimeValue: 124600,
        averageOrderValue: 20766,
        refundRate: 0,
        daysSinceLastOrder: 12,
        lastOrderDate: '2026-10-30T11:00:00Z',
        rfmSegment: 'Champions/VIPs',
        rfmScore: { recency: 5, frequency: 5, monetary: 5 },
        discountOrdersCount: 0,
        loyaltyPoints: 3450,
        storeCreditBalance: 5000,
        tags: ['VIP Patron', 'Custom Debossing Patron', 'Transit Collector'],
        utmSource: 'ArchitecturalDigest_Editorial',
        utmMedium: 'Affiliate',
        acquisitionCost: 1850
      },
      {
        id: 'cust_02_recent',
        identityUid: 'uid_patron_02',
        fullName: 'Ananya Deshmukh',
        email: 'ananya.deshmukh@gmail.com',
        phone: '+91 99887 65432',
        role: 'PATRON',
        createdAt: '2026-10-02T12:00:00Z',
        updatedAt: '2026-10-02T12:00:00Z',
        totalOrders: 1,
        lifetimeValue: 14500,
        averageOrderValue: 14500,
        refundRate: 0,
        daysSinceLastOrder: 40,
        lastOrderDate: '2026-10-02T12:00:00Z',
        rfmSegment: 'Promising/Recent',
        rfmScore: { recency: 4, frequency: 2, monetary: 3 },
        discountOrdersCount: 0,
        loyaltyPoints: 300,
        storeCreditBalance: 0,
        tags: ['First Time Buyer', 'Women Luxury Collection'],
        utmSource: 'Instagram_Organics',
        utmMedium: 'Social',
        acquisitionCost: 920
      },
      {
        id: 'cust_03_atrisk',
        identityUid: 'uid_patron_03',
        fullName: 'Karan Mehra',
        email: 'karan.mehra@apextech.co',
        phone: '+91 97112 34567',
        role: 'PATRON',
        createdAt: '2025-01-10T09:30:00Z',
        updatedAt: '2025-11-04T15:00:00Z',
        totalOrders: 2,
        lifetimeValue: 32700,
        averageOrderValue: 16350,
        refundRate: 0,
        daysSinceLastOrder: 142,
        lastOrderDate: '2026-06-22T08:00:00Z',
        rfmSegment: 'At-Risk/Churning',
        rfmScore: { recency: 1, frequency: 3, monetary: 4 },
        discountOrdersCount: 0,
        loyaltyPoints: 850,
        storeCreditBalance: 1200,
        tags: ['Dormant High Value', 'Transit Folio Owner'],
        utmSource: 'Google_Search',
        utmMedium: 'CPC',
        acquisitionCost: 2400
      },
      {
        id: 'cust_04_bargain',
        identityUid: 'uid_patron_04',
        fullName: 'Rohan Gupta',
        email: 'rohan.gupta92@yahoo.com',
        phone: '+91 96543 21098',
        role: 'PATRON',
        createdAt: '2025-11-20T16:00:00Z',
        updatedAt: '2026-09-15T18:00:00Z',
        totalOrders: 3,
        lifetimeValue: 11400,
        averageOrderValue: 3800,
        refundRate: 33.3,
        daysSinceLastOrder: 57,
        lastOrderDate: '2026-09-15T18:00:00Z',
        rfmSegment: 'Bargain Hunters',
        rfmScore: { recency: 3, frequency: 3, monetary: 1 },
        discountOrdersCount: 3,
        loyaltyPoints: 120,
        storeCreditBalance: 0,
        tags: ['Discount Sensitive', 'Belt Collector'],
        utmSource: 'Newsletter_Flash',
        utmMedium: 'Email',
        acquisitionCost: 450
      },
      {
        id: 'cust_00_sunil',
        identityUid: 'uid_admin_sunil',
        fullName: 'Sunil Chainani (Founding Partner)',
        email: 'sunilchain@gmail.com',
        phone: '+91 98200 00001',
        role: 'STORE_MANAGER',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2026-11-11T00:00:00Z',
        totalOrders: 0,
        lifetimeValue: 0,
        averageOrderValue: 0,
        refundRate: 0,
        daysSinceLastOrder: 999,
        rfmSegment: 'Promising/Recent',
        rfmScore: { recency: 1, frequency: 1, monetary: 1 },
        discountOrdersCount: 0,
        loyaltyPoints: 0,
        storeCreditBalance: 0,
        tags: ['Master Store Manager', 'Executive'],
        acquisitionCost: 0
      }
    ];

    const addresses: CustomerAddress[] = [
      {
        id: 'addr_01',
        customerId: 'cust_01_vip',
        recipientName: 'Vikramaditya Singhania',
        phone: '+91 98201 12345',
        street: '42 Singhania Manor, Altamount Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400026',
        country: 'India',
        isDefault: true,
        addressType: 'SHIPPING',
        createdAt: '2025-05-14T10:00:00Z',
        updatedAt: '2026-10-30T11:00:00Z'
      },
      {
        id: 'addr_02',
        customerId: 'cust_02_recent',
        recipientName: 'Ananya Deshmukh',
        phone: '+91 99887 65432',
        street: 'Penthouse 12B, Koregaon Park Plaza',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
        country: 'India',
        isDefault: true,
        addressType: 'SHIPPING',
        createdAt: '2026-10-02T12:00:00Z',
        updatedAt: '2026-11-08T14:20:00Z'
      }
    ];

    const orders: Order[] = [
      {
        id: 'ord_1001',
        orderNumber: 'BVL-2026-1001',
        customerId: 'cust_01_vip',
        customerName: 'Vikramaditya Singhania',
        customerEmail: 'vikram.singhania@heritagecrafts.in',
        customerPhone: '+91 98201 12345',
        status: 'DELIVERED',
        currency: 'INR',
        subtotal: 53700,
        discountAmount: 0,
        taxAmount: 9666,
        shippingFee: 0,
        totalAmount: 63366,
        paymentGateway: 'RAZORPAY',
        paymentId: 'pay_rzp_mock_9921',
        paymentStatus: 'PAID',
        items: [
          {
            id: 'item_101',
            orderId: 'ord_1001',
            productId: 'prod-t-brf-01',
            productName: 'The Viceroy Diplomat Briefcase',
            sku: 'BVL-TRV-BRF-01',
            category: 'travell',
            quantity: 1,
            unitPrice: 28900,
            leatherType: 'VEGETABLE_TANNED_HERITAGE',
            customization: {
              monogramInitials: 'V.A.S',
              foilType: 'GOLD_FOIL',
              placement: 'Top Flap Center'
            },
            hsnCode: '4202',
            gstRate: 0.18,
            taxAmount: 5202,
            lineTotal: 34102
          },
          {
            id: 'item_102',
            orderId: 'ord_1001',
            productId: 'prod-t-bpk-01',
            productName: 'The Himalayan Transit Rucksack',
            sku: 'BVL-TRV-BPK-01',
            category: 'travell',
            quantity: 1,
            unitPrice: 24800,
            leatherType: 'VEGETABLE_TANNED_HERITAGE',
            customization: {
              monogramInitials: 'V.A.S',
              foilType: 'BLIND',
              placement: 'Exterior Leather Tag'
            },
            hsnCode: '4202',
            gstRate: 0.18,
            taxAmount: 4464,
            lineTotal: 29264
          }
        ],
        shippingAddress: addresses[0],
        billingAddress: addresses[0],
        awbNumber: 'SR-PNQ-98442110',
        courierPartner: 'SHIPROCKET',
        courierStatus: 'DELIVERED',
        createdAt: '2026-10-30T11:00:00Z',
        updatedAt: '2026-11-03T16:00:00Z',
        invoiceNumber: 'BVL/INV/26-27/0089',
        isGstInvoiceGenerated: true
      },
      {
        id: 'ord_1002',
        orderNumber: 'BVL-2026-1002',
        customerId: 'cust_02_recent',
        customerName: 'Ananya Deshmukh',
        customerEmail: 'ananya.deshmukh@gmail.com',
        customerPhone: '+91 99887 65432',
        status: 'DISPATCHED',
        currency: 'INR',
        subtotal: 14500,
        discountAmount: 0,
        taxAmount: 2610,
        shippingFee: 0,
        totalAmount: 17110,
        paymentGateway: 'STRIPE',
        paymentId: 'pi_str_mock_4421',
        paymentStatus: 'PAID',
        items: [
          {
            id: 'item_103',
            orderId: 'ord_1002',
            productId: 'prod-w-purse-01',
            productName: 'The Meera Structured Flap Purse',
            sku: 'BVL-WOM-PRS-01',
            category: 'women',
            quantity: 1,
            unitPrice: 14500,
            leatherType: 'VEGETABLE_TANNED_HERITAGE',
            customization: {
              monogramInitials: 'A.D',
              foilType: 'GOLD_FOIL',
              placement: 'Front Flap Clasp'
            },
            hsnCode: '4202',
            gstRate: 0.18,
            taxAmount: 2610,
            lineTotal: 17110
          }
        ],
        shippingAddress: addresses[1],
        billingAddress: addresses[1],
        awbNumber: 'DLV-PNQ-7732190',
        courierPartner: 'DELHIVERY',
        courierStatus: 'IN_TRANSIT',
        createdAt: '2026-11-08T14:20:00Z',
        updatedAt: '2026-11-10T10:00:00Z',
        invoiceNumber: 'BVL/INV/26-27/0090',
        isGstInvoiceGenerated: true
      }
    ];

    const hotStampingVectors: HotStampingVector[] = [
      {
        id: 'hsv_01',
        customerId: 'cust_01_vip',
        orderId: 'ord_1001',
        productId: 'prod-t-brf-01',
        productName: 'The Viceroy Diplomat Briefcase',
        monogramText: 'V.A.S',
        foilStyle: 'GOLD_FOIL',
        fontFamily: 'CINZEL',
        previewImageUrl: '/assets/images/custom_debossing_monogram_1794461810572.jpg',
        recordedAt: '2026-10-30T10:45:00Z'
      },
      {
        id: 'hsv_02',
        customerId: 'cust_02_recent',
        orderId: 'ord_1002',
        productId: 'prod-w-purse-01',
        productName: 'The Meera Structured Flap Purse',
        monogramText: 'A.D',
        foilStyle: 'GOLD_FOIL',
        fontFamily: 'CINZEL',
        previewImageUrl: '/assets/images/custom_debossing_monogram_1794461810572.jpg',
        recordedAt: '2026-11-08T14:05:00Z'
      }
    ];

    const warranties: WarrantyRegistration[] = [
      {
        id: 'war_01',
        customerId: 'cust_01_vip',
        customerName: 'Vikramaditya Singhania',
        orderId: 'ord_1001',
        productId: 'prod-t-brf-01',
        productName: 'The Viceroy Diplomat Briefcase',
        hardwareSerial: 'BRASS-VICEROY-9821A',
        warrantyPeriodYears: 2,
        startDate: '2026-10-30T00:00:00Z',
        expiryDate: '2028-10-30T00:00:00Z',
        status: 'ACTIVE',
        claimCount: 0,
        createdAt: '2026-10-30T11:00:00Z'
      },
      {
        id: 'war_02',
        customerId: 'cust_01_vip',
        customerName: 'Vikramaditya Singhania',
        orderId: 'ord_1001',
        productId: 'prod-t-bpk-01',
        productName: 'The Himalayan Transit Rucksack',
        hardwareSerial: 'BRASS-RUCK-4412B',
        warrantyPeriodYears: 2,
        startDate: '2026-10-30T00:00:00Z',
        expiryDate: '2028-10-30T00:00:00Z',
        status: 'ACTIVE',
        claimCount: 0,
        createdAt: '2026-10-30T11:00:00Z'
      }
    ];

    const careKitDispatches: CareKitDispatch[] = [
      {
        id: 'ck_01',
        customerId: 'cust_01_vip',
        orderId: 'ord_1001',
        kitType: 'ORGANIC_BEESWAX_BALM_BRUSH',
        dispatchDate: '2026-11-01T09:00:00Z',
        awbNumber: 'SR-CARE-10029',
        courier: 'SHIPROCKET',
        status: 'DELIVERED',
        digitalGuideSent: true
      },
      {
        id: 'ck_02',
        customerId: 'cust_02_recent',
        orderId: 'ord_1002',
        kitType: 'HERITAGE_LEATHER_ELIXIR',
        dispatchDate: '2026-11-09T10:00:00Z',
        awbNumber: 'DLV-CARE-5519',
        courier: 'DELHIVERY',
        status: 'DISPATCHED',
        digitalGuideSent: true
      }
    ];

    const corporateGiftingLeads: CorporateGiftingLead[] = [
      {
        id: 'corp_01',
        companyName: 'Kotak Wealth Management Private Client Group',
        contactPerson: 'Meera Nair (Head of Private Gifting)',
        email: 'meera.nair@kotakwealth.in',
        phone: '+91 98190 55432',
        estimatedQuantity: 120,
        budgetRangeInr: '₹15,00,000 - ₹20,00,000',
        interestCategory: 'TRANSIT_FOLIOS',
        status: 'SWATCH_DISPATCHED',
        swatchKitAwb: 'SR-SWATCH-99120',
        notes: 'Requested vegetable-tanned bridle leather folios in London Tan with custom debossed corporate crest in antique gold foil.',
        dealValueInr: 1850000,
        createdAt: '2026-11-05T11:00:00Z'
      },
      {
        id: 'corp_02',
        companyName: 'McKinsey & Co. Mumbai Practice',
        contactPerson: 'Aditya Birla (Alumni Relations)',
        email: 'aditya_birla@mckinsey.com',
        phone: '+91 99200 44321',
        estimatedQuantity: 65,
        budgetRangeInr: '₹6,00,000 - ₹8,00,000',
        interestCategory: 'EVERYDAY_CARRY',
        status: 'QUOTE_ISSUED',
        dealValueInr: 740000,
        notes: 'Selected Bifold Heirloom Folios with personalized individual partner monograms.',
        createdAt: '2026-11-07T14:30:00Z'
      }
    ];

    const supportTickets: SupportTicket[] = [
      {
        id: 'tkt_01',
        ticketNumber: 'TKT-2026-881',
        customerId: 'cust_01_vip',
        customerName: 'Vikramaditya Singhania',
        customerEmail: 'vikram.singhania@heritagecrafts.in',
        channel: 'WHATSAPP',
        subject: 'Bespoke Folio Care & Heirloom Patina Advice',
        category: 'MONOGRAM_REQUEST',
        priority: 'VIP_URGENT',
        status: 'IN_PROGRESS',
        assignedTo: 'support@bharatvarshcrafts.com',
        slaBreachHours: 2,
        createdAt: '2026-11-10T09:15:00Z',
        updatedAt: '2026-11-11T14:00:00Z',
        messages: [
          {
            id: 'm1',
            sender: 'PATRON',
            text: 'Good morning. The Diplomat Briefcase arrived in splendid condition. I wish to know if your master artisan recommends applying the organic beeswax balm before my journey to Geneva next Tuesday?',
            timestamp: '2026-11-10T09:15:00Z',
            channel: 'WHATSAPP'
          },
          {
            id: 'm2',
            sender: 'AGENT',
            text: 'Greetings Mr. Singhania. We are thrilled to hear! For your Geneva trip, our master leathercraftsman recommends a light buff with horsehair brush first. The initial factory coat of beeswax balm will shield against mountain moisture.',
            timestamp: '2026-11-10T09:40:00Z',
            channel: 'WHATSAPP'
          }
        ]
      },
      {
        id: 'tkt_02',
        ticketNumber: 'TKT-2026-882',
        customerId: 'cust_04_bargain',
        customerName: 'Rohan Gupta',
        customerEmail: 'rohan.gupta92@yahoo.com',
        channel: 'EMAIL',
        subject: 'Belt Size Exchange Request (Size 34 to 36)',
        category: 'SIZE_EXCHANGE',
        priority: 'MEDIUM',
        status: 'OPEN',
        assignedTo: 'support@bharatvarshcrafts.com',
        slaBreachHours: 24,
        createdAt: '2026-11-11T08:00:00Z',
        updatedAt: '2026-11-11T08:00:00Z',
        messages: [
          {
            id: 'm3',
            sender: 'PATRON',
            text: 'I ordered the Rajputana Bridle Belt in 34 inch but require a 36 inch waist fit. Please arrange reverse pickup.',
            timestamp: '2026-11-11T08:00:00Z',
            channel: 'EMAIL'
          }
        ]
      }
    ];

    const carts: CartRecord[] = [
      {
        id: 'cart_abandoned_01',
        customerId: 'cust_03_atrisk',
        email: 'karan.mehra@apextech.co',
        phone: '+91 97112 34567',
        items: [
          {
            productId: 'prod-t-bpk-01',
            productName: 'The Himalayan Transit Rucksack',
            sku: 'BVL-TRV-BPK-01',
            unitPrice: 24800,
            quantity: 1,
            leatherType: 'VEGETABLE_TANNED_HERITAGE',
            monogram: 'K.M',
            foilStyle: 'GOLD_FOIL',
            imageUrl: '/assets/images/product_travel_backpack_folio_1794461810700.jpg'
          }
        ],
        subtotal: 24800,
        currency: 'INR',
        isAbandoned: true,
        abandonedAt: '2026-11-11T12:00:00Z',
        recoveryStage: 'DETECTED',
        recoveryAttempts: 1,
        lastRecoveryTriggerAt: '2026-11-11T12:15:00Z',
        checkoutUrl: 'https://bharatvarshcrafts.com/checkout?resume=cart_abandoned_01',
        lastActiveAt: '2026-11-11T11:40:00Z'
      },
      {
        id: 'cart_abandoned_02',
        email: 'priya.sharma_guest@gmail.com',
        phone: '+91 98450 11223',
        items: [
          {
            productId: 'prod-w-purse-01',
            productName: 'The Meera Structured Flap Purse',
            sku: 'BVL-WOM-PRS-01',
            unitPrice: 14500,
            quantity: 1,
            leatherType: 'VEGETABLE_TANNED_HERITAGE',
            monogram: 'P.S',
            foilStyle: 'GOLD_FOIL',
            imageUrl: '/assets/images/product_women_purse_bag_1794461810441.jpg'
          }
        ],
        subtotal: 14500,
        currency: 'INR',
        isAbandoned: true,
        abandonedAt: '2026-11-11T14:30:00Z',
        recoveryStage: 'EMAIL_SENT',
        recoveryAttempts: 1,
        lastRecoveryTriggerAt: '2026-11-11T14:45:00Z',
        checkoutUrl: 'https://bharatvarshcrafts.com/checkout?resume=cart_abandoned_02',
        lastActiveAt: '2026-11-11T14:15:00Z'
      }
    ];

    const inventory: ProductInventory[] = [
      {
        id: 'inv_01',
        productId: 'prod-m-belt-01',
        sku: 'BVL-MEN-BLT-01',
        name: 'The Rajputana Bridle Belt',
        category: 'men',
        stockByLocation: { punePrimaryHub: 24, mumbaiWarehouse: 48 },
        safetyStock: 15,
        reorderPoint: 20,
        unitCost: 1450,
        sellingPrice: 4200,
        batchLotNumber: 'LOT-2026-BLT-04',
        leadTimeDays: 7
      },
      {
        id: 'inv_02',
        productId: 'prod-m-wal-01',
        sku: 'BVL-MEN-WAL-01',
        name: 'The Bifold Heirloom Folio',
        category: 'men',
        stockByLocation: { punePrimaryHub: 32, mumbaiWarehouse: 65 },
        safetyStock: 20,
        reorderPoint: 25,
        unitCost: 1150,
        sellingPrice: 3800,
        batchLotNumber: 'LOT-2026-WAL-02',
        leadTimeDays: 5
      },
      {
        id: 'inv_03',
        productId: 'prod-w-purse-01',
        sku: 'BVL-WOM-PRS-01',
        name: 'The Meera Structured Flap Purse',
        category: 'women',
        stockByLocation: { punePrimaryHub: 8, mumbaiWarehouse: 14 },
        safetyStock: 6,
        reorderPoint: 10,
        unitCost: 5200,
        sellingPrice: 14500,
        batchLotNumber: 'LOT-2026-PRS-09',
        leadTimeDays: 14
      },
      {
        id: 'inv_04',
        productId: 'prod-w-wal-01',
        sku: 'BVL-WOM-WAL-01',
        name: 'The Devika Zip-Around Continental',
        category: 'women',
        stockByLocation: { punePrimaryHub: 14, mumbaiWarehouse: 18 },
        safetyStock: 8,
        reorderPoint: 12,
        unitCost: 2300,
        sellingPrice: 6200,
        batchLotNumber: 'LOT-2026-WWAL-07',
        leadTimeDays: 7
      },
      {
        id: 'inv_05',
        productId: 'prod-w-blt-01',
        sku: 'BVL-WOM-BLT-01',
        name: 'The Padmavati Cinch Belt',
        category: 'women',
        stockByLocation: { punePrimaryHub: 19, mumbaiWarehouse: 22 },
        safetyStock: 8,
        reorderPoint: 12,
        unitCost: 1350,
        sellingPrice: 3600,
        batchLotNumber: 'LOT-2026-WBLT-05',
        leadTimeDays: 6
      },
      {
        id: 'inv_06',
        productId: 'prod-t-bpk-01',
        sku: 'BVL-TRV-BPK-01',
        name: 'The Himalayan Transit Rucksack',
        category: 'travell',
        stockByLocation: { punePrimaryHub: 5, mumbaiWarehouse: 9 },
        safetyStock: 4,
        reorderPoint: 8,
        unitCost: 8900,
        sellingPrice: 24800,
        batchLotNumber: 'LOT-2026-BPK-03',
        leadTimeDays: 18
      },
      {
        id: 'inv_07',
        productId: 'prod-t-brf-01',
        sku: 'BVL-TRV-BRF-01',
        name: 'The Viceroy Diplomat Briefcase',
        category: 'travell',
        stockByLocation: { punePrimaryHub: 4, mumbaiWarehouse: 6 },
        safetyStock: 3,
        reorderPoint: 5,
        unitCost: 10800,
        sellingPrice: 28900,
        batchLotNumber: 'LOT-2026-BRF-01',
        leadTimeDays: 21
      }
    ];

    const billOfMaterials: BillOfMaterialsItem[] = [
      {
        id: 'bom_01',
        parentSku: 'BVL-TRV-BRF-01',
        materialName: 'A-Grade Full Grain Veg-Tanned Steerhide (Kanpur)',
        quantityPerUnit: 18,
        unit: 'SQ_FT',
        inventoryOnHand: 450,
        safetyStock: 100,
        vendorName: 'Ganga Heritage Tanneries Ltd'
      },
      {
        id: 'bom_02',
        parentSku: 'BVL-TRV-BRF-01',
        materialName: 'Sand-Cast Solid Antique Brass Push Locks & Rivets',
        quantityPerUnit: 2,
        unit: 'PIECES',
        inventoryOnHand: 84,
        safetyStock: 20,
        vendorName: 'Aligarh Precision Hardware Guild'
      },
      {
        id: 'bom_03',
        parentSku: 'BVL-TRV-BRF-01',
        materialName: 'Bonded Heavy Nylon Thread (Fil-Au-Chinois match)',
        quantityPerUnit: 45,
        unit: 'METERS',
        inventoryOnHand: 1800,
        safetyStock: 300,
        vendorName: 'Vardhman Specialty Yarns'
      },
      {
        id: 'bom_04',
        parentSku: 'BVL-ALL',
        materialName: 'Organic Beeswax & Jojoba Conditioning Balm (50g jar)',
        quantityPerUnit: 1,
        unit: 'GRAMS',
        inventoryOnHand: 320,
        safetyStock: 50,
        vendorName: 'Himalayan Organic Apiaries'
      }
    ];

    const gstInvoices: GSTInvoice[] = [
      {
        id: 'inv_0089',
        invoiceNumber: 'BVL/INV/26-27/0089',
        orderId: 'ord_1001',
        customerId: 'cust_01_vip',
        supplierGstin: '27AABCB1234F1Z8',
        invoiceDate: '2026-10-30T11:00:00Z',
        supplyState: 'Maharashtra (Pune Primary Hub)',
        placeOfSupply: 'Maharashtra',
        isInterState: false,
        taxableValue: 53700,
        cgstAmount: 4833,
        sgstAmount: 4833,
        igstAmount: 0,
        totalInvoiceAmount: 63366,
        status: 'ISSUED',
        pdfUrl: '/api/erp/invoices/BVL-INV-26-27-0089.pdf'
      },
      {
        id: 'inv_0090',
        invoiceNumber: 'BVL/INV/26-27/0090',
        orderId: 'ord_1002',
        customerId: 'cust_02_recent',
        supplierGstin: '27AABCB1234F1Z8',
        invoiceDate: '2026-11-08T14:20:00Z',
        supplyState: 'Maharashtra (Pune Primary Hub)',
        placeOfSupply: 'Maharashtra',
        isInterState: false,
        taxableValue: 14500,
        cgstAmount: 1305,
        sgstAmount: 1305,
        igstAmount: 0,
        totalInvoiceAmount: 17110,
        status: 'ISSUED',
        pdfUrl: '/api/erp/invoices/BVL-INV-26-27-0090.pdf'
      }
    ];

    const gstCreditNotes: GSTCreditNote[] = [];

    const auditLogs: AuditLogEntry[] = [
      {
        id: 'audit_01',
        actorEmail: 'sunilchain@gmail.com',
        action: 'INITIALIZE_SYSTEM',
        category: 'STORE_MANAGEMENT',
        details: 'Bharatvarsh Leathercrafts LLP CRM & ERP engine bootstrapped with Pune Primary Hub',
        timestamp: '2026-11-01T00:00:00Z'
      },
      {
        id: 'audit_02',
        actorEmail: 'support@bharatvarshcrafts.com',
        action: 'ENABLE_GST_INVOICING',
        category: 'GST_INVOICING',
        details: 'GST Invoicing module active with Maharashtra GSTIN 27AABCB1234F1Z8 (Pune Primary Hub)',
        timestamp: '2026-11-01T00:05:00Z'
      }
    ];

    return {
      customers,
      addresses,
      orders,
      hotStampingVectors,
      warranties,
      careKitDispatches,
      corporateGiftingLeads,
      supportTickets,
      carts,
      inventory,
      billOfMaterials,
      gstInvoices,
      gstCreditNotes,
      auditLogs,
      config,
      patronCredentials: {},
      processedWebhookIds: []
    };
  }

  // --- Audit Logging (Append-Only) ---
  private appendAuditEntry(
    actorEmail: string,
    action: string,
    category: AuditLogEntry['category'],
    details: string,
    ipAddress?: string
  ): AuditLogEntry {
    const entry: AuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      actorEmail,
      action,
      category,
      details,
      timestamp: new Date().toISOString(),
      ipAddress
    };
    this.state.auditLogs.unshift(entry);
    return entry;
  }

  public logAudit(
    actorEmail: string,
    action: string,
    category: AuditLogEntry['category'],
    details: string,
    ipAddress?: string
  ): AuditLogEntry {
    const entry = this.appendAuditEntry(actorEmail, action, category, details, ipAddress);
    this.persistState();
    return entry;
  }

  public getAuditLogs(): AuditLogEntry[] {
    return this.state.auditLogs;
  }

  // --- Store Management & Access Control ---
  public getConfig(): StoreManagementConfig {
    return {
      ...this.state.config,
      // Never leak password hashes to UI
      adminCredentials: (this.state.config.adminCredentials || []).map(a => ({
        ...a,
        passwordHash: undefined
      }))
    };
  }

  public updateGstInvoicing(enabled: boolean, actorEmail: string): boolean {
    if (!this.isMasterAuthorized(actorEmail)) {
      throw new Error(`Unauthorized: ${actorEmail} does not hold Master Super-Admin privileges to update GST settings.`);
    }
    this.state.config.gstInvoicingEnabled = enabled;
    this.state.config.updatedAt = new Date().toISOString();
    this.state.config.lastUpdatedBy = actorEmail;

    this.logAudit(
      actorEmail,
      enabled ? 'ENABLE_GST_INVOICING' : 'DISABLE_GST_INVOICING',
      'GST_INVOICING',
      `GST Invoicing was ${enabled ? 'enabled' : 'suspended'}. Invoice & credit note issuance ${enabled ? 'active' : 'halted'}.`
    );
    this.persistState();
    return true;
  }

  public validatePromoCode(rawCode?: string): PromoCodeRule | null {
    if (!rawCode || typeof rawCode !== 'string') return null;
    const normalized = rawCode.trim().toUpperCase();
    if (!normalized) return null;
    const rules = this.state.config.promoCodes || [];
    return rules.find(r => r.active && r.code.trim().toUpperCase() === normalized) || null;
  }

  public updateOperationalSettings(
    updates: {
      abandonmentThresholdMinutes?: number;
      supplierGstin?: string;
      gstRatePercent?: number;
      promoCodes?: PromoCodeRule[];
    },
    actorEmail: string
  ): StoreManagementConfig {
    if (!this.isStoreManagementAuthorized(actorEmail)) {
      throw new Error(`Access Denied: ${actorEmail} is not authorized to update store operational rules.`);
    }

    if (updates.abandonmentThresholdMinutes !== undefined) {
      const mins = Math.floor(Number(updates.abandonmentThresholdMinutes));
      if (!Number.isFinite(mins) || mins < 1 || mins > 1440) {
        throw new Error('Abandonment threshold must be between 1 and 1440 minutes.');
      }
      this.state.config.abandonmentThresholdMinutes = mins;
    }

    if (updates.supplierGstin !== undefined) {
      const cleanGstin = String(updates.supplierGstin).trim().toUpperCase();
      if (cleanGstin.length < 10 || cleanGstin.length > 15) {
        throw new Error('Supplier GSTIN must be a valid 15-character GSTIN identifier.');
      }
      this.state.config.supplierGstin = cleanGstin;
    }

    if (updates.gstRatePercent !== undefined) {
      const rate = Number(updates.gstRatePercent);
      if (!Number.isFinite(rate) || rate < 0 || rate > 28) {
        throw new Error('GST rate percentage must be between 0% and 28%.');
      }
      this.state.config.gstRatePercent = Number(rate.toFixed(2));
    }

    if (Array.isArray(updates.promoCodes)) {
      const seen = new Set<string>();
      const cleaned: PromoCodeRule[] = [];
      for (const p of updates.promoCodes) {
        const code = String(p.code || '').trim().toUpperCase();
        const discountPercent = Number(p.discountPercent);
        if (!code || !Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 90) {
          throw new Error(`Invalid promo rule "${p.code || ''}" (discount must be between 1% and 90%).`);
        }
        if (seen.has(code)) continue;
        seen.add(code);
        cleaned.push({
          code,
          discountPercent: Number(discountPercent.toFixed(2)),
          active: Boolean(p.active),
          description: p.description ? String(p.description).trim() : `${discountPercent}% bespoke discount`
        });
      }
      this.state.config.promoCodes = cleaned;
    }

    this.state.config.updatedAt = new Date().toISOString();
    this.state.config.lastUpdatedBy = actorEmail;

    this.appendAuditEntry(
      actorEmail,
      'UPDATE_OPERATIONAL_RULES',
      'STORE_MANAGEMENT',
      `Updated operational rules (Abandonment SLA: ${this.state.config.abandonmentThresholdMinutes}m, GST: ${this.state.config.gstRatePercent}%, GSTIN: ${this.state.config.supplierGstin}, Active Promos: ${
        this.state.config.promoCodes.filter(p => p.active).map(p => `${p.code}:${p.discountPercent}%`).join(', ') || 'None'
      })`
    );
    this.persistState();
    return this.getConfig();
  }

  public isMasterAuthorized(email: string): boolean {
    if (!email) return false;
    const cleanEmail = email.trim().toLowerCase();
    return MASTER_AUTHORIZED_ACCOUNTS.map(e => e.toLowerCase()).includes(cleanEmail);
  }

  public isStoreManagementAuthorized(email: string): boolean {
    if (!email) return false;
    const cleanEmail = email.trim().toLowerCase();
    if (this.isMasterAuthorized(cleanEmail)) return true;
    return this.state.config.permittedStoreManagers.map(e => e.toLowerCase()).includes(cleanEmail);
  }

  public getStaffRole(email: string): UserRole {
    if (!email) return 'PATRON';
    const cleanEmail = email.trim().toLowerCase();
    if (this.isMasterAuthorized(cleanEmail)) return 'STORE_MANAGER';
    if (!this.isStoreManagementAuthorized(cleanEmail)) return 'PATRON';
    const cred = (this.state.config.adminCredentials || []).find(c => c.userId.toLowerCase() === cleanEmail);
    const role = cred?.role;
    if (role === 'STORE_MANAGER' || role === 'SUPPORT_AGENT' || role === 'LOGISTICS_COORDINATOR') {
      return role;
    }
    return 'STORE_MANAGER';
  }

  public verifyAdminLogin(userId: string, password?: string): { valid: boolean; reason?: string } {
    const clean = userId.trim().toLowerCase();
    if (!this.isStoreManagementAuthorized(clean)) {
      return { valid: false, reason: 'Not an authorized admin account' };
    }
    const cred = (this.state.config.adminCredentials || []).find(c => c.userId.toLowerCase() === clean);
    if (!cred || !cred.passwordHash || cred.passwordHash.length === 0) {
      return {
        valid: false,
        reason: 'Password login is disabled for this admin account until a password is set. Please continue with Google Sign-In.'
      };
    }
    if (!password) {
      return { valid: false, reason: 'Admin password is required' };
    }

    const check = verifyPassword(password, cred.passwordHash);
    if (!check.valid) {
      return { valid: false, reason: 'Invalid admin credentials' };
    }

    if (check.needsRehash) {
      cred.passwordHash = hashPassword(password);
      this.persistState();
    }

    return { valid: true };
  }

  public verifyPatronLogin(email: string, password?: string): { valid: boolean; reason?: string } {
    const clean = email.trim().toLowerCase();
    if (!clean) {
      return { valid: false, reason: 'Email address is required' };
    }
    if (!password) {
      return { valid: false, reason: 'Password is required' };
    }

    const credsMap = this.state.patronCredentials || {};
    const cred = credsMap[clean];
    if (!cred || !cred.passwordHash) {
      return {
        valid: false,
        reason: 'No password is configured for this account. Please sign in with Google or create a new account.'
      };
    }

    const check = verifyPassword(password, cred.passwordHash);
    if (!check.valid) {
      return { valid: false, reason: 'Invalid email or password' };
    }

    if (check.needsRehash) {
      cred.passwordHash = hashPassword(password);
      cred.updatedAt = new Date().toISOString();
      this.persistState();
    }

    return { valid: true };
  }

  public registerPatronWithPassword(data: {
    email: string;
    password: string;
    fullName: string;
    phone?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      pincode?: string;
      country?: string;
    };
  }): { customer: Customer } {
    const cleanEmail = (data.email || '').trim().toLowerCase();
    const cleanName = (data.fullName || '').trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('A valid email address is required.');
    }
    if (!cleanName) {
      throw new Error('Full name is required.');
    }
    if (!data.password || data.password.length < 8) {
      throw new Error('Password must be at least 8 characters long.');
    }
    if (this.isStoreManagementAuthorized(cleanEmail)) {
      throw new Error('Authorized admin User IDs cannot self-register. Please sign in with Google or contact a Master Admin.');
    }

    if (!this.state.patronCredentials) {
      this.state.patronCredentials = {};
    }

    const existingCred = this.state.patronCredentials[cleanEmail];
    const existingCustomer = this.state.customers.find(c => c.email.toLowerCase() === cleanEmail);
    if (existingCred || existingCustomer) {
      throw new Error('ACCOUNT_EXISTS: An account with this email already exists. Please sign in or continue with Google.');
    }

    const hasAddress =
      data.address &&
      data.address.street &&
      data.address.city &&
      data.address.state &&
      data.address.pincode;

    const { customer } = this.findOrCreateCustomer({
      email: cleanEmail,
      phone: data.phone,
      fullName: cleanName,
      role: 'PATRON',
      address: hasAddress
        ? {
            street: data.address!.street!,
            city: data.address!.city!,
            state: data.address!.state!,
            pincode: data.address!.pincode!,
            country: data.address!.country || 'India'
          }
        : undefined
    });

    this.state.patronCredentials[cleanEmail] = {
      email: cleanEmail,
      passwordHash: hashPassword(data.password),
      updatedAt: new Date().toISOString()
    };

    this.logAudit(cleanEmail, 'PATRON_REGISTERED', 'AUTH_PERMISSION', `Registered new patron account for ${cleanEmail}`);
    this.persistState();
    return { customer };
  }

  public addPermittedManager(
    newUserId: string,
    actorEmail: string,
    displayName?: string,
    password?: string,
    role?: UserRole
  ): boolean {
    if (!this.isMasterAuthorized(actorEmail)) {
      throw new Error(`Access Denied: ${actorEmail} does not hold Master Super-Admin privileges to add admin User IDs.`);
    }
    const clean = newUserId.trim().toLowerCase();
    if (!clean) throw new Error('User ID / Email cannot be empty');

    const isTargetMaster = this.isMasterAuthorized(clean);
    const allowedStaffRoles: UserRole[] = ['STORE_MANAGER', 'SUPPORT_AGENT', 'LOGISTICS_COORDINATOR'];
    const normalizedRole: UserRole = isTargetMaster
      ? 'STORE_MANAGER'
      : role && allowedStaffRoles.includes(role)
      ? role
      : 'STORE_MANAGER';

    if (!this.state.config.permittedStoreManagers.map(e => e.toLowerCase()).includes(clean)) {
      this.state.config.permittedStoreManagers.push(clean);
    }

    const existingCredIdx = (this.state.config.adminCredentials || []).findIndex(c => c.userId.toLowerCase() === clean);
    const credEntry: AdminUserCredential = {
      userId: clean,
      displayName: displayName?.trim() || clean.split('@')[0],
      role: normalizedRole,
      passwordHash: password ? hashPassword(password) : '',
      addedBy: actorEmail,
      addedAt: new Date().toISOString(),
      isMaster: isTargetMaster
    };

    if (!this.state.config.adminCredentials) {
      this.state.config.adminCredentials = [];
    }

    if (existingCredIdx >= 0) {
      const prevCred = this.state.config.adminCredentials[existingCredIdx];
      this.state.config.adminCredentials[existingCredIdx] = {
        ...prevCred,
        displayName: displayName?.trim() ? displayName.trim() : prevCred.displayName,
        role: isTargetMaster ? 'STORE_MANAGER' : role && allowedStaffRoles.includes(role) ? role : prevCred.role || 'STORE_MANAGER',
        ...(password ? { passwordHash: credEntry.passwordHash } : {})
      };
    } else {
      this.state.config.adminCredentials.push(credEntry);
    }

    this.state.config.updatedAt = new Date().toISOString();
    this.state.config.lastUpdatedBy = actorEmail;

    this.logAudit(
      actorEmail,
      'ADD_PERMITTED_MANAGER',
      'AUTH_PERMISSION',
      `Added/updated staff User ID "${clean}" with role ${normalizedRole}`
    );
    this.persistState();
    return true;
  }

  public removePermittedManager(targetEmail: string, actorEmail: string): boolean {
    if (!this.isMasterAuthorized(actorEmail)) {
      throw new Error(`Access Denied: ${actorEmail} does not hold Master Super-Admin privileges to revoke admin User IDs.`);
    }
    const clean = targetEmail.trim().toLowerCase();
    if (MASTER_AUTHORIZED_ACCOUNTS.map(e => e.toLowerCase()).includes(clean)) {
      throw new Error(`Cannot revoke founding master super-admin access for ${clean}`);
    }
    this.state.config.permittedStoreManagers = this.state.config.permittedStoreManagers.filter(
      e => e.toLowerCase() !== clean
    );
    this.state.config.adminCredentials = (this.state.config.adminCredentials || []).filter(
      c => c.userId.toLowerCase() !== clean
    );
    this.state.config.updatedAt = new Date().toISOString();
    this.state.config.lastUpdatedBy = actorEmail;
    this.logAudit(
      actorEmail,
      'REMOVE_PERMITTED_MANAGER',
      'AUTH_PERMISSION',
      `Removed User ID "${clean}" from authorized Admin access list`
    );
    this.persistState();
    return true;
  }

  public async deleteAdminUserAsync(targetEmail: string, actorEmail: string): Promise<boolean> {
    return this.withWriteLock(async () => {
      if (!this.isMasterAuthorized(actorEmail)) {
        throw new Error(`Access Denied: ${actorEmail} does not hold Master Super-Admin privileges to revoke admin User IDs.`);
      }
      const clean = targetEmail.trim().toLowerCase();
      if (!clean) throw new Error('User ID or Email is required');
      if (MASTER_AUTHORIZED_ACCOUNTS.map(e => e.toLowerCase()).includes(clean)) {
        throw new Error(`Cannot revoke founding master super-admin access for ${clean}`);
      }

      const prevState = structuredClone(this.state);
      this.insideAtomicTransaction = true;
      try {
        this.state.config.permittedStoreManagers = this.state.config.permittedStoreManagers.filter(
          e => e.toLowerCase() !== clean
        );
        this.state.config.adminCredentials = (this.state.config.adminCredentials || []).filter(
          c => c.userId.toLowerCase() !== clean
        );
        this.state.config.updatedAt = new Date().toISOString();
        this.state.config.lastUpdatedBy = actorEmail;
        this.appendAuditEntry(
          actorEmail,
          'REMOVE_PERMITTED_MANAGER',
          'AUTH_PERMISSION',
          `Removed User ID "${clean}" from authorized Admin access list`
        );
        this.insideAtomicTransaction = false;

        await mysqlAdapter.deleteAdminUser(clean, this.state);
        this.persistToDiskOnly();
        this.lastPersistError = null;
        return true;
      } catch (err: any) {
        this.insideAtomicTransaction = false;
        this.state = prevState;
        this.persistToDiskOnly();
        this.lastPersistError = err.message;
        throw err;
      }
    });
  }

  // --- Customers & Deduplication ---
  public getCustomers(options?: { includeArchived?: boolean }): Customer[] {
    if (options?.includeArchived) {
      return this.state.customers;
    }
    return this.state.customers.filter(c => c.isActive !== false);
  }

  public getCustomerById(id: string): Customer | undefined {
    return this.state.customers.find(c => c.id === id || c.identityUid === id || c.email.toLowerCase() === id.toLowerCase());
  }

  public async softDeleteCustomerAsync(customerId: string, actorEmail: string): Promise<Customer> {
    return this.withWriteLock(async () => {
      if (!this.isStoreManagementAuthorized(actorEmail)) {
        throw new Error(`Access Denied: ${actorEmail} is not authorized to archive customer records.`);
      }
      const customer = this.state.customers.find(c => c.id === customerId);
      if (!customer) {
        throw new Error(`Customer ${customerId} not found`);
      }
      if (this.isMasterAuthorized(customer.email)) {
        throw new Error(`Cannot archive founding master super-admin identity (${customer.email})`);
      }

      const prevState = structuredClone(this.state);
      this.insideAtomicTransaction = true;
      try {
        const nowIso = new Date().toISOString();
        customer.isActive = false;
        customer.deletedAt = nowIso;
        customer.updatedAt = nowIso;

        this.appendAuditEntry(
          actorEmail,
          'SOFT_DELETE_CUSTOMER',
          'STORE_MANAGEMENT',
          `Archived customer ${customer.fullName} (${customer.email}, ID: ${customer.id}); preserved linked order & audit history.`
        );
        this.insideAtomicTransaction = false;

        await mysqlAdapter.softDeleteCustomer(customer.id, this.state);
        this.persistToDiskOnly();
        this.lastPersistError = null;
        return customer;
      } catch (err: any) {
        this.insideAtomicTransaction = false;
        this.state = prevState;
        this.persistToDiskOnly();
        this.lastPersistError = err.message;
        throw err;
      }
    });
  }

  public getCustomerAddresses(customerId: string): CustomerAddress[] {
    if (!Array.isArray(this.state.addresses)) {
      this.state.addresses = [];
    }
    return this.state.addresses.filter(a => a.customerId === customerId);
  }

  public getDefaultCustomerAddress(customerId: string): CustomerAddress | undefined {
    const list = this.getCustomerAddresses(customerId);
    return list.find(a => a.isDefault) || list[0];
  }

  private reconcileCustomerAddresses(): void {
    if (!Array.isArray(this.state.addresses)) {
      this.state.addresses = [];
    }
    for (const cust of this.state.customers) {
      const custAddrs = this.state.addresses.filter(a => a.customerId === cust.id);
      if (custAddrs.length > 0) {
        const def = custAddrs.find(a => a.isDefault) || custAddrs[0];
        cust.addresses = custAddrs;
        cust.address = def.street;
        cust.city = def.city;
        cust.state = def.state;
        cust.pincode = def.pincode;
        if (!cust.phone && def.phone) {
          cust.phone = def.phone;
        }
      } else if (cust.address && cust.city && cust.state && cust.pincode) {
        this.upsertCustomerAddressInMemory(cust.id, {
          recipientName: cust.fullName,
          phone: cust.phone,
          street: cust.address,
          city: cust.city,
          state: cust.state,
          pincode: cust.pincode,
          country: 'India',
          isDefault: true,
          addressType: 'SHIPPING'
        });
      }
    }
  }

  private upsertCustomerAddressInMemory(
    customerId: string,
    input: {
      recipientName?: string;
      phone?: string;
      street: string;
      city: string;
      state: string;
      pincode: string;
      country?: string;
      addressType?: 'SHIPPING' | 'BILLING';
      isDefault?: boolean;
    }
  ): CustomerAddress {
    if (!Array.isArray(this.state.addresses)) {
      this.state.addresses = [];
    }
    const cleanStreet = String(input.street || '').trim();
    const cleanCity = String(input.city || '').trim();
    const cleanState = String(input.state || '').trim();
    const cleanPincode = String(input.pincode || '').trim();
    const cleanCountry = String(input.country || 'India').trim() || 'India';
    const customer = this.state.customers.find(c => c.id === customerId);
    const cleanRecipient = String(input.recipientName || customer?.fullName || '').trim();
    const cleanPhone = String(input.phone || customer?.phone || '').trim();
    const nowIso = new Date().toISOString();
    const makeDefault = input.isDefault !== false;

    const existing = this.state.addresses.find(
      a =>
        a.customerId === customerId &&
        a.street.trim().toLowerCase() === cleanStreet.toLowerCase() &&
        a.city.trim().toLowerCase() === cleanCity.toLowerCase() &&
        a.state.trim().toLowerCase() === cleanState.toLowerCase() &&
        a.pincode.trim() === cleanPincode
    );

    if (makeDefault) {
      for (const a of this.state.addresses) {
        if (a.customerId === customerId) {
          a.isDefault = false;
        }
      }
    }

    let saved: CustomerAddress;
    if (existing) {
      existing.recipientName = cleanRecipient || existing.recipientName;
      existing.phone = cleanPhone || existing.phone;
      existing.country = cleanCountry;
      existing.isDefault = makeDefault ? true : existing.isDefault;
      existing.updatedAt = nowIso;
      if (!existing.createdAt) existing.createdAt = nowIso;
      saved = existing;
    } else {
      saved = {
        id: `addr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        customerId,
        recipientName: cleanRecipient,
        phone: cleanPhone,
        street: cleanStreet,
        city: cleanCity,
        state: cleanState,
        pincode: cleanPincode,
        country: cleanCountry,
        isDefault: makeDefault,
        addressType: input.addressType === 'BILLING' ? 'BILLING' : 'SHIPPING',
        createdAt: nowIso,
        updatedAt: nowIso
      };
      this.state.addresses.push(saved);
    }

    if (customer) {
      if (cleanPhone) customer.phone = cleanPhone;
      if (saved.isDefault || !customer.address) {
        customer.address = saved.street;
        customer.city = saved.city;
        customer.state = saved.state;
        customer.pincode = saved.pincode;
      }
      customer.addresses = this.state.addresses.filter(a => a.customerId === customer.id);
      customer.updatedAt = nowIso;
    }

    return saved;
  }

  public upsertCustomerAddress(
    customerId: string,
    input: {
      recipientName?: string;
      phone?: string;
      street: string;
      city: string;
      state: string;
      pincode: string;
      country?: string;
      addressType?: 'SHIPPING' | 'BILLING';
      isDefault?: boolean;
    }
  ): CustomerAddress {
    const saved = this.upsertCustomerAddressInMemory(customerId, input);
    this.persistState();
    return saved;
  }

  public findOrCreateCustomer(data: {
    email: string;
    phone?: string;
    fullName: string;
    identityUid?: string;
    role?: UserRole;
    utmSource?: string;
    utmMedium?: string;
    updatePhone?: boolean;
    updateFullName?: boolean;
    address?: {
      street: string;
      city: string;
      state: string;
      pincode: string;
      country?: string;
    };
  }): { customer: Customer; isNew: boolean } {
    const cleanEmail = data.email.trim().toLowerCase();
    const cleanPhone = (data.phone || '').replace(/\s+/g, '');

    let existing = this.state.customers.find(c => {
      if (c.email.toLowerCase() === cleanEmail) return true;
      if (data.identityUid && c.identityUid === data.identityUid) return true;
      if (cleanPhone && c.phone && c.phone.replace(/\s+/g, '') === cleanPhone) return true;
      return false;
    });

    if (existing) {
      if (data.identityUid && !existing.identityUid) existing.identityUid = data.identityUid;
      if (data.phone && (data.updatePhone || !existing.phone)) existing.phone = data.phone;
      if (
        data.fullName &&
        (data.updateFullName || !existing.fullName || existing.fullName === 'Valued Patron')
      ) {
        existing.fullName = data.fullName;
      }
      if (this.isStoreManagementAuthorized(cleanEmail)) {
        existing.role = this.getStaffRole(cleanEmail);
      }
      if (existing.isActive === false) {
        existing.isActive = true;
        existing.deletedAt = null;
      }
      if (data.address?.street && data.address?.city && data.address?.state && data.address?.pincode) {
        this.upsertCustomerAddressInMemory(existing.id, {
          recipientName: existing.fullName,
          phone: data.phone || existing.phone,
          street: data.address.street,
          city: data.address.city,
          state: data.address.state,
          pincode: data.address.pincode,
          country: data.address.country || 'India',
          isDefault: true,
          addressType: 'SHIPPING'
        });
      }
      existing.updatedAt = new Date().toISOString();
      this.persistState();
      return { customer: existing, isNew: false };
    }

    const newCustomer: Customer = {
      id: `cust_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      identityUid: data.identityUid,
      email: cleanEmail,
      phone: data.phone || '',
      fullName: data.fullName,
      role: this.isStoreManagementAuthorized(cleanEmail) ? this.getStaffRole(cleanEmail) : (data.role || 'PATRON'),
      isActive: true,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalOrders: 0,
      lifetimeValue: 0,
      averageOrderValue: 0,
      refundRate: 0,
      daysSinceLastOrder: 0,
      rfmSegment: 'Promising/Recent',
      rfmScore: { recency: 5, frequency: 1, monetary: 1 },
      discountOrdersCount: 0,
      loyaltyPoints: 100,
      storeCreditBalance: 0,
      tags: ['Storefront Registered'],
      utmSource: data.utmSource,
      utmMedium: data.utmMedium,
      acquisitionCost: 500
    };

    this.state.customers.push(newCustomer);
    if (data.address?.street && data.address?.city && data.address?.state && data.address?.pincode) {
      this.upsertCustomerAddressInMemory(newCustomer.id, {
        recipientName: newCustomer.fullName,
        phone: newCustomer.phone,
        street: data.address.street,
        city: data.address.city,
        state: data.address.state,
        pincode: data.address.pincode,
        country: data.address.country || 'India',
        isDefault: true,
        addressType: 'SHIPPING'
      });
    }
    this.logAudit('system', 'CUSTOMER_CREATED', 'STORE_MANAGEMENT', `New customer ${newCustomer.email} registered`);
    this.persistState();
    return { customer: newCustomer, isNew: true };
  }

  // --- Orders & ERP Sales Order Push ---
  public getOrders(): Order[] {
    return this.state.orders;
  }

  public getOrderById(id: string): Order | undefined {
    return this.state.orders.find(o => o.id === id || o.orderNumber === id);
  }

  private buildAndCommitOrderInMemory(
    orderData: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt' | 'isGstInvoiceGenerated'>,
    options?: { skipStockDeduction?: boolean }
  ): Order {
    // Validate stock availability before accepting order
    if (!options?.skipStockDeduction) {
      for (const item of orderData.items) {
        const inv = this.state.inventory.find(i => i.productId === item.productId || i.sku === item.sku);
        if (inv) {
          const totalAvailable = inv.stockByLocation.punePrimaryHub + inv.stockByLocation.mumbaiWarehouse;
          if (totalAvailable <= 0) {
            throw new Error(`${item.productName} is currently out of stock.`);
          }
          if (totalAvailable < item.quantity) {
            throw new Error(`Insufficient stock for ${item.productName}. Only ${totalAvailable} unit(s) available.`);
          }
        }
      }
    }

    const orderNumber = `BVL-${new Date().getFullYear()}-${1000 + this.state.orders.length + 1}`;
    const newOrder: Order = {
      ...orderData,
      id: `ord_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      orderNumber,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isGstInvoiceGenerated: false
    };

    // Deduct finished stock permanently from Pune Primary Hub first, then Mumbai Warehouse,
    // AND deduct matching Bill of Materials raw inputs (plus shared BVL-ALL care/packaging BOMs)
    if (!options?.skipStockDeduction) {
      for (const item of newOrder.items) {
        const inv = this.state.inventory.find(i => i.productId === item.productId || i.sku === item.sku);
        if (inv) {
          if (inv.stockByLocation.punePrimaryHub >= item.quantity) {
            inv.stockByLocation.punePrimaryHub -= item.quantity;
          } else {
            const remaining = item.quantity - inv.stockByLocation.punePrimaryHub;
            inv.stockByLocation.punePrimaryHub = 0;
            inv.stockByLocation.mumbaiWarehouse = Math.max(0, inv.stockByLocation.mumbaiWarehouse - remaining);
          }

          const totalLeft = inv.stockByLocation.punePrimaryHub + inv.stockByLocation.mumbaiWarehouse;
          if (totalLeft <= inv.safetyStock) {
            this.appendAuditEntry(
              'system',
              'SKU_LOW_STOCK_ALERT',
              'INVENTORY_ADJUSTMENT',
              `Reorder alert: ${inv.name} (${inv.sku}) dropped to ${totalLeft} pcs (safety threshold: ${inv.safetyStock} pcs).`
            );
          }
        }

        // BOM Raw Material Consumption for SKU & global BVL-ALL kits
        const matchingBoms = this.state.billOfMaterials.filter(
          b => b.parentSku === item.sku || b.parentSku === 'BVL-ALL'
        );
        for (const bom of matchingBoms) {
          const consumed = bom.quantityPerUnit * item.quantity;
          const prevHand = bom.inventoryOnHand;
          bom.inventoryOnHand = Math.max(0, prevHand - consumed);
          const safety = bom.safetyStock ?? (bom.unit === 'PIECES' ? 20 : 100);
          if (bom.inventoryOnHand <= safety && prevHand > safety) {
            this.appendAuditEntry(
              'system',
              'BOM_LOW_STOCK_ALERT',
              'INVENTORY_ADJUSTMENT',
              `Raw material low-stock alert: ${bom.materialName} (${bom.parentSku}) fell to ${bom.inventoryOnHand} ${bom.unit} (safety threshold: ${safety} ${bom.unit}).`
            );
          }
        }
      }
    }

    for (const item of newOrder.items) {
      if (item.customization && item.customization.monogramInitials) {
        this.state.hotStampingVectors.unshift({
          id: `hsv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          customerId: newOrder.customerId,
          orderId: newOrder.id,
          productId: item.productId,
          productName: item.productName,
          monogramText: item.customization.monogramInitials,
          foilStyle: item.customization.foilType,
          fontFamily: 'CINZEL',
          recordedAt: new Date().toISOString()
        });
      }

      this.state.warranties.push({
        id: `war_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
        customerId: newOrder.customerId,
        customerName: newOrder.customerName,
        orderId: newOrder.id,
        productId: item.productId,
        productName: item.productName,
        hardwareSerial: `BVL-BRASS-${Math.floor(10000 + Math.random() * 90000)}`,
        warrantyPeriodYears: 2,
        startDate: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'ACTIVE',
        claimCount: 0,
        createdAt: new Date().toISOString()
      });
    }

    // Automated Care Kit Dispatch from Pune Primary Hub
    this.state.careKitDispatches.push({
      id: `ck_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      customerId: newOrder.customerId,
      orderId: newOrder.id,
      kitType: 'ORGANIC_BEESWAX_BALM_BRUSH',
      dispatchDate: new Date().toISOString(),
      awbNumber: `SR-PNQ-CARE-${Math.floor(100000 + Math.random() * 900000)}`,
      courier: 'SHIPROCKET',
      status: 'DISPATCHED',
      digitalGuideSent: true
    });

    // GST-Compliant Invoicing (Primary Hub: Pune, Maharashtra)
    if (this.state.config.gstInvoicingEnabled) {
      const invNum = `BVL/INV/26-27/${(this.state.gstInvoices.length + 91).toString().padStart(4, '0')}`;
      const isInterState = newOrder.shippingAddress?.state?.toLowerCase() !== 'maharashtra';
      const taxable = Math.max(0, newOrder.subtotal - (newOrder.discountAmount || 0));
      const fallbackTaxRate = (this.state.config.gstRatePercent || 18) / 100;
      const taxAmt = typeof newOrder.taxAmount === 'number' ? newOrder.taxAmount : Math.round(taxable * fallbackTaxRate);
      const supplierGstin = this.state.config.supplierGstin || '27AABCB1234F1Z8';

      const invoice: GSTInvoice = {
        id: `inv_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
        invoiceNumber: invNum,
        orderId: newOrder.id,
        customerId: newOrder.customerId,
        supplierGstin,
        invoiceDate: new Date().toISOString(),
        supplyState: 'Maharashtra (Pune Primary Hub)',
        placeOfSupply: newOrder.shippingAddress?.state || 'Maharashtra',
        isInterState,
        taxableValue: taxable,
        cgstAmount: isInterState ? 0 : Math.round(taxAmt / 2),
        sgstAmount: isInterState ? 0 : Math.round(taxAmt / 2),
        igstAmount: isInterState ? taxAmt : 0,
        totalInvoiceAmount: taxable + taxAmt + newOrder.shippingFee,
        status: 'ISSUED',
        pdfUrl: `/api/erp/invoices/${invNum.replace(/\//g, '-')}.pdf`
      };
      this.state.gstInvoices.push(invoice);
      newOrder.invoiceNumber = invNum;
      newOrder.isGstInvoiceGenerated = true;
    }

    newOrder.awbNumber = orderData.awbNumber || `SR-PNQ-${Math.floor(10000000 + Math.random() * 90000000)}`;
    newOrder.courierPartner = orderData.courierPartner || 'SHIPROCKET';
    newOrder.courierStatus = orderData.courierStatus || 'IN_TRANSIT';

    this.state.orders.unshift(newOrder);
    if (
      newOrder.shippingAddress?.street &&
      newOrder.shippingAddress?.city &&
      newOrder.shippingAddress?.state &&
      newOrder.shippingAddress?.pincode
    ) {
      this.upsertCustomerAddressInMemory(newOrder.customerId, {
        recipientName: newOrder.customerName,
        phone: newOrder.customerPhone,
        street: newOrder.shippingAddress.street,
        city: newOrder.shippingAddress.city,
        state: newOrder.shippingAddress.state,
        pincode: newOrder.shippingAddress.pincode,
        country: newOrder.shippingAddress.country || 'India',
        isDefault: true,
        addressType: 'SHIPPING'
      });
    }
    this.recalculateCustomerMetrics(newOrder.customerId);

    const openCart = this.state.carts.find(c => c.email.toLowerCase() === newOrder.customerEmail.toLowerCase() && c.isAbandoned);
    if (openCart) {
      openCart.recoveryStage = 'RECOVERED';
      openCart.isAbandoned = false;
    }

    this.appendAuditEntry('system', 'ORDER_CREATED', 'STORE_MANAGEMENT', `Sales order ${newOrder.orderNumber} placed for ₹${newOrder.totalAmount}`);
    return newOrder;
  }

  public createOrder(
    orderData: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt' | 'isGstInvoiceGenerated'>,
    options?: { skipStockDeduction?: boolean }
  ): Order {
    const newOrder = this.buildAndCommitOrderInMemory(orderData, options);
    this.persistState();
    return newOrder;
  }

  /**
   * Atomic, row-locked checkout & order creation (SELECT ... FOR UPDATE in MySQL).
   * Rolls back both MySQL and in-memory/disk state if stock fails or MySQL write errors.
   */
  public async createOrderAsync(
    orderData: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt' | 'isGstInvoiceGenerated'>,
    options?: { skipStockDeduction?: boolean }
  ): Promise<Order> {
    return this.withWriteLock(async () => {
      const prevState = structuredClone(this.state);
      this.insideAtomicTransaction = true;
      try {
        const order = await mysqlAdapter.runLockedStockTransaction(
          orderData.items.map(i => ({
            sku: i.sku,
            productId: i.productId,
            productName: i.productName,
            quantity: i.quantity
          })),
          async ({ lockedRows }) => {
            // Sync authoritative locked MySQL counts before validating & deducting
            for (const row of lockedRows) {
              const inv = this.state.inventory.find(i => i.sku === row.sku || i.productId === row.productId);
              if (inv) {
                inv.stockByLocation.punePrimaryHub = row.punePrimaryHub;
                inv.stockByLocation.mumbaiWarehouse = row.mumbaiWarehouse;
              }
            }
            const created = this.buildAndCommitOrderInMemory(orderData, options);
            return { result: created, nextState: this.state };
          }
        );

        this.persistToDiskOnly();
        this.lastPersistError = null;
        return order;
      } catch (err: any) {
        this.state = prevState;
        this.persistToDiskOnly();
        this.lastPersistError = err.message;
        throw err;
      } finally {
        this.insideAtomicTransaction = false;
      }
    });
  }

  /**
   * Executes a stock-touching mutation (e.g., RMA restock) under an atomic MySQL row lock
   * and rolls back both memory and disk if persistence fails.
   */
  public async runLockedStockMutation<T>(
    items: Array<{ sku?: string; productId?: string; productName?: string; quantity: number }>,
    mutator: () => T
  ): Promise<T> {
    return this.withWriteLock(async () => {
      const prevState = structuredClone(this.state);
      this.insideAtomicTransaction = true;
      try {
        const result = await mysqlAdapter.runLockedStockTransaction(items, async ({ lockedRows }) => {
          for (const row of lockedRows) {
            const inv = this.state.inventory.find(i => i.sku === row.sku || i.productId === row.productId);
            if (inv) {
              inv.stockByLocation.punePrimaryHub = row.punePrimaryHub;
              inv.stockByLocation.mumbaiWarehouse = row.mumbaiWarehouse;
            }
          }
          const res = mutator();
          return { result: res, nextState: this.state };
        });

        this.persistToDiskOnly();
        this.lastPersistError = null;
        return result;
      } catch (err: any) {
        this.state = prevState;
        this.persistToDiskOnly();
        this.lastPersistError = err.message;
        throw err;
      } finally {
        this.insideAtomicTransaction = false;
      }
    });
  }

  public updateOrderStatus(orderId: string, status: OrderStatus, actorEmail: string): Order {
    const order = this.state.orders.find(o => o.id === orderId || o.orderNumber === orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);

    const prev = order.status;
    order.status = status;
    order.updatedAt = new Date().toISOString();

    if (status === 'DELIVERED') {
      order.courierStatus = 'DELIVERED';
    } else if (status === 'DISPATCHED') {
      order.courierStatus = 'IN_TRANSIT';
    }

    this.logAudit(
      actorEmail,
      'UPDATE_ORDER_STATUS',
      'STORE_MANAGEMENT',
      `Order ${order.orderNumber} status changed from ${prev} to ${status}`
    );
    this.persistState();
    return order;
  }

  public recalculateCustomerMetrics(customerId: string) {
    const cust = this.state.customers.find(c => c.id === customerId);
    if (!cust) return;

    const custOrders = this.state.orders.filter(o => o.customerId === customerId && o.paymentStatus === 'PAID');
    cust.totalOrders = custOrders.length;
    cust.lifetimeValue = custOrders.reduce((acc, o) => acc + o.totalAmount, 0);
    cust.averageOrderValue = cust.totalOrders > 0 ? Math.round(cust.lifetimeValue / cust.totalOrders) : 0;

    if (custOrders.length > 0) {
      const sorted = [...custOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      cust.lastOrderDate = sorted[0].createdAt;
      const days = Math.floor((Date.now() - new Date(sorted[0].createdAt).getTime()) / (1000 * 60 * 60 * 24));
      cust.daysSinceLastOrder = days;
    }

    if (cust.totalOrders >= 4 || cust.lifetimeValue >= 50000) {
      cust.rfmSegment = 'Champions/VIPs';
      cust.rfmScore = { recency: 5, frequency: 5, monetary: 5 };
    } else if (cust.daysSinceLastOrder > 90) {
      cust.rfmSegment = 'At-Risk/Churning';
      cust.rfmScore = { recency: 1, frequency: 2, monetary: 3 };
    } else if (cust.discountOrdersCount >= 2 && cust.discountOrdersCount === cust.totalOrders) {
      cust.rfmSegment = 'Bargain Hunters';
      cust.rfmScore = { recency: 3, frequency: 2, monetary: 1 };
    } else {
      cust.rfmSegment = 'Promising/Recent';
      cust.rfmScore = { recency: 4, frequency: 2, monetary: 3 };
    }
  }

  // --- Interaction Logs ---
  public addHotStampingVector(vector: Omit<HotStampingVector, 'id'>): HotStampingVector {
    const item: HotStampingVector = {
      ...vector,
      id: `hsv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
    };
    this.state.hotStampingVectors.unshift(item);
    this.persistState();
    return item;
  }

  public getHotStampingVectors(customerId?: string): HotStampingVector[] {
    if (customerId) {
      return this.state.hotStampingVectors.filter(h => h.customerId === customerId);
    }
    return this.state.hotStampingVectors;
  }

  public getWarranties(customerId?: string): WarrantyRegistration[] {
    if (customerId) {
      return this.state.warranties.filter(w => w.customerId === customerId);
    }
    return this.state.warranties;
  }

  public getCareKits(customerId?: string): CareKitDispatch[] {
    if (customerId) {
      return this.state.careKitDispatches.filter(c => c.customerId === customerId);
    }
    return this.state.careKitDispatches;
  }

  public getCorporateGiftingLeads(): CorporateGiftingLead[] {
    return this.state.corporateGiftingLeads;
  }

  public addCorporateGiftingLead(lead: Omit<CorporateGiftingLead, 'id' | 'createdAt'>): CorporateGiftingLead {
    const newLead: CorporateGiftingLead = {
      ...lead,
      id: `corp_${Date.now()}`,
      createdAt: new Date().toISOString()
    };
    this.state.corporateGiftingLeads.unshift(newLead);
    this.logAudit('sales', 'ADD_CORP_LEAD', 'STORE_MANAGEMENT', `New corporate gifting lead from ${newLead.companyName}`);
    this.persistState();
    return newLead;
  }

  public updateCorporateLeadStatus(
    leadId: string,
    status: CorporateGiftingLead['status'],
    swatchAwb?: string,
    extra?: {
      erpOrderId?: string;
      erpOrderNumber?: string;
      items?: CorporateGiftingLead['items'];
      dealValueInr?: number;
    }
  ): CorporateGiftingLead {
    const lead = this.state.corporateGiftingLeads.find(l => l.id === leadId);
    if (!lead) throw new Error(`Lead ${leadId} not found`);
    lead.status = status;
    if (swatchAwb) lead.swatchKitAwb = swatchAwb;
    if (extra?.erpOrderId) lead.erpOrderId = extra.erpOrderId;
    if (extra?.erpOrderNumber) lead.erpOrderNumber = extra.erpOrderNumber;
    if (Array.isArray(extra?.items) && extra.items.length > 0) {
      lead.items = extra.items;
    }
    if (typeof extra?.dealValueInr === 'number' && extra.dealValueInr > 0) {
      lead.dealValueInr = extra.dealValueInr;
    }
    this.persistState();
    return lead;
  }

  // --- Support Tickets ---
  public getSupportTickets(): SupportTicket[] {
    return this.state.supportTickets.map(ticket => {
      if (ticket.customerPhone) return ticket;
      const matched = this.getCustomerById(ticket.customerId) || this.getCustomerById(ticket.customerEmail);
      return matched?.phone ? { ...ticket, customerPhone: matched.phone } : ticket;
    });
  }

  public getTicketsByCustomer(customerId: string): SupportTicket[] {
    return this.getSupportTickets().filter(t => t.customerId === customerId);
  }

  public addSupportMessage(ticketId: string, text: string, sender: 'PATRON' | 'AGENT' | 'SYSTEM', channel: 'WHATSAPP' | 'EMAIL' | 'LIVE_CHAT') {
    const ticket = this.state.supportTickets.find(t => t.id === ticketId);
    if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
    ticket.messages.push({
      id: `msg_${Date.now()}`,
      sender,
      text,
      timestamp: new Date().toISOString(),
      channel
    });
    ticket.updatedAt = new Date().toISOString();
    this.persistState();
    return ticket;
  }

  // --- Carts & Abandonment State ---
  public getCarts(): CartRecord[] {
    return this.state.carts;
  }

  public getCartById(cartId: string): CartRecord | undefined {
    return this.state.carts.find(c => c.id === cartId);
  }

  public saveCartState(cart: Partial<CartRecord> & { email: string; items: any[]; subtotal: number }): CartRecord {
    const cleanEmail = cart.email.trim().toLowerCase();
    let existing = cart.id ? this.state.carts.find(c => c.id === cart.id) : undefined;
    if (!existing) {
      existing = this.state.carts.find(c => c.email.toLowerCase() === cleanEmail && !c.isAbandoned);
    }

    if (existing) {
      existing.items = cart.items;
      existing.subtotal = cart.subtotal;
      existing.phone = cart.phone || existing.phone;
      existing.lastActiveAt = new Date().toISOString();
      if (!existing.checkoutUrl || existing.checkoutUrl.includes('resume=new')) {
        existing.checkoutUrl = `/?resume=${encodeURIComponent(existing.id)}`;
      }
      this.persistState();
      return existing;
    }

    const resolvedId = cart.id || `cart_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newCart: CartRecord = {
      id: resolvedId,
      customerId: cart.customerId,
      email: cleanEmail,
      phone: cart.phone,
      items: cart.items,
      subtotal: cart.subtotal,
      currency: 'INR',
      isAbandoned: false,
      recoveryStage: 'DETECTED',
      recoveryAttempts: 0,
      checkoutUrl: `/?resume=${encodeURIComponent(resolvedId)}`,
      lastActiveAt: new Date().toISOString()
    };
    this.state.carts.push(newCart);
    this.persistState();
    return newCart;
  }

  public detectAbandonedCarts(thresholdMinutes: number = 15): CartRecord[] {
    const now = Date.now();
    const thresholdMs = thresholdMinutes * 60 * 1000;
    const abandoned: CartRecord[] = [];

    for (const cart of this.state.carts) {
      if (!cart.isAbandoned && cart.items.length > 0 && cart.recoveryStage !== 'RECOVERED') {
        const lastActive = new Date(cart.lastActiveAt).getTime();
        if (now - lastActive >= thresholdMs) {
          cart.isAbandoned = true;
          cart.abandonedAt = new Date().toISOString();
          cart.recoveryStage = 'DETECTED';
          abandoned.push(cart);

          this.logAudit('system', 'CHECKOUT_ABANDONED', 'WEBHOOK_EVENT', `Abandoned checkout detected for ${cart.email} (₹${cart.subtotal})`);
        }
      }
    }
    if (abandoned.length > 0) {
      this.persistState();
    }
    return abandoned;
  }

  public triggerCartRecovery(cartId: string, channel: 'EMAIL' | 'WHATSAPP'): { success: boolean; message: string; cart: CartRecord } {
    const cart = this.state.carts.find(c => c.id === cartId);
    if (!cart) throw new Error(`Cart ${cartId} not found`);

    if (!cart.email && cart.customerId) {
      const cust = this.getCustomerById(cart.customerId);
      if (cust?.email) cart.email = cust.email;
      if (!cart.phone && cust?.phone) cart.phone = cust.phone;
    }

    if (channel === 'EMAIL' && (!cart.email || !cart.email.includes('@'))) {
      throw new Error(`Patron email address is missing or invalid for cart ${cartId}.`);
    }

    const twoHoursMs = 2 * 60 * 60 * 1000;
    if (cart.lastRecoveryTriggerAt && Date.now() - new Date(cart.lastRecoveryTriggerAt).getTime() < twoHoursMs) {
      return {
        success: false,
        message: `Recovery message already dispatched to ${cart.email} within the cooldown window.`,
        cart
      };
    }

    cart.recoveryAttempts += 1;
    cart.lastRecoveryTriggerAt = new Date().toISOString();
    cart.recoveryStage = channel === 'EMAIL' ? 'EMAIL_SENT' : 'WHATSAPP_SENT';

    this.logAudit(
      'marketing_agent',
      'TRIGGER_CART_RECOVERY',
      'STORE_MANAGEMENT',
      `Sent ${channel} cart recovery with 10% bespoke incentive to ${cart.email} (Attempt #${cart.recoveryAttempts})`
    );
    this.persistState();

    return {
      success: true,
      message: `Recovery link successfully dispatched via ${channel} to ${cart.email}.`,
      cart
    };
  }

  // --- ERP Sync Layer (Permanent Inventory Persistence) ---
  public getInventory(): ProductInventory[] {
    return this.state.inventory;
  }

  private applyInventoryAdjustmentInMemory(
    sku: string,
    location: 'punePrimaryHub' | 'mumbaiWarehouse',
    newQty: number,
    actorEmail: string
  ): ProductInventory {
    if (!this.isStoreManagementAuthorized(actorEmail)) {
      throw new Error(`Access Denied: Only authorized admin accounts can modify inventory.`);
    }
    const item = this.state.inventory.find(i => i.sku === sku);
    if (!item) throw new Error(`SKU ${sku} not found`);

    const sanitizedQty = Math.max(0, Math.floor(newQty));
    const prev = item.stockByLocation[location];
    item.stockByLocation[location] = sanitizedQty;

    const totalNow = item.stockByLocation.punePrimaryHub + item.stockByLocation.mumbaiWarehouse;

    this.appendAuditEntry(
      actorEmail,
      'ADJUST_INVENTORY',
      'INVENTORY_ADJUSTMENT',
      `Adjusted ${item.name} (${sku}) at ${location}: ${prev} -> ${sanitizedQty} (Total: ${totalNow}${totalNow === 0 ? ' - PRODUCT DEACTIVATED / OUT OF STOCK' : ''})`
    );
    return item;
  }

  public updateInventoryStock(
    sku: string,
    location: 'punePrimaryHub' | 'mumbaiWarehouse',
    newQty: number,
    actorEmail: string
  ): ProductInventory {
    const item = this.applyInventoryAdjustmentInMemory(sku, location, newQty, actorEmail);
    this.persistState();
    return item;
  }

  /**
   * Atomic, row-locked inventory stock adjustment (SELECT ... FOR UPDATE in MySQL).
   * Rolls back both in-memory/disk state and MySQL if persistence fails.
   */
  public async updateInventoryStockAsync(
    sku: string,
    location: 'punePrimaryHub' | 'mumbaiWarehouse',
    newQty: number,
    actorEmail: string
  ): Promise<ProductInventory> {
    return this.withWriteLock(async () => {
      if (!this.isStoreManagementAuthorized(actorEmail)) {
        throw new Error(`Access Denied: Only authorized admin accounts can modify inventory.`);
      }
      const prevState = structuredClone(this.state);
      this.insideAtomicTransaction = true;
      try {
        const updated = await mysqlAdapter.runLockedInventoryAdjustment(sku, async ({ lockedRow }) => {
          if (lockedRow) {
            const inv = this.state.inventory.find(i => i.sku === lockedRow.sku);
            if (inv) {
              inv.stockByLocation.punePrimaryHub = lockedRow.punePrimaryHub;
              inv.stockByLocation.mumbaiWarehouse = lockedRow.mumbaiWarehouse;
            }
          }
          const item = this.applyInventoryAdjustmentInMemory(sku, location, newQty, actorEmail);
          return { result: item, nextState: this.state };
        });

        this.persistToDiskOnly();
        this.lastPersistError = null;
        return updated;
      } catch (err: any) {
        this.state = prevState;
        this.persistToDiskOnly();
        this.lastPersistError = err.message;
        throw err;
      } finally {
        this.insideAtomicTransaction = false;
      }
    });
  }

  public getBillOfMaterials(): BillOfMaterialsItem[] {
    return this.state.billOfMaterials;
  }

  public addBillOfMaterialsItem(item: Omit<BillOfMaterialsItem, 'id'>, actorEmail: string): BillOfMaterialsItem {
    const newItem: BillOfMaterialsItem = {
      ...item,
      safetyStock: typeof item.safetyStock === 'number' ? item.safetyStock : item.unit === 'PIECES' ? 20 : 50,
      id: `bom_${Date.now()}`
    };
    this.state.billOfMaterials.push(newItem);
    this.logAudit(actorEmail, 'ADD_BOM_ITEM', 'INVENTORY_ADJUSTMENT', `Added raw material ${item.materialName} for ${item.parentSku}`);
    this.persistState();
    return newItem;
  }

  public updateBomItemStock(
    bomId: string,
    inventoryOnHand: number,
    safetyStock: number | undefined,
    actorEmail: string
  ): BillOfMaterialsItem {
    const item = this.state.billOfMaterials.find(b => b.id === bomId);
    if (!item) throw new Error(`BOM material ${bomId} not found`);
    const prev = item.inventoryOnHand;
    item.inventoryOnHand = Math.max(0, Math.floor(Number(inventoryOnHand)));
    if (typeof safetyStock === 'number' && Number.isFinite(safetyStock)) {
      item.safetyStock = Math.max(0, Math.floor(safetyStock));
    }
    this.logAudit(
      actorEmail,
      'ADJUST_BOM_STOCK',
      'INVENTORY_ADJUSTMENT',
      `Adjusted BOM material ${item.materialName} (${item.parentSku}): ${prev} -> ${item.inventoryOnHand} ${item.unit}`
    );
    this.persistState();
    return item;
  }

  public getLowStockAlerts(): {
    lowStockSkus: Array<ProductInventory & { totalStock: number; isOut: boolean }>;
    lowStockBom: Array<BillOfMaterialsItem & { effectiveSafetyStock: number }>;
  } {
    const lowStockSkus = this.state.inventory
      .map(inv => {
        const totalStock = inv.stockByLocation.punePrimaryHub + inv.stockByLocation.mumbaiWarehouse;
        return { ...inv, totalStock, isOut: totalStock <= 0 };
      })
      .filter(inv => inv.totalStock <= inv.safetyStock);

    const lowStockBom = this.state.billOfMaterials
      .map(b => ({
        ...b,
        effectiveSafetyStock: typeof b.safetyStock === 'number' ? b.safetyStock : b.unit === 'PIECES' ? 20 : 100
      }))
      .filter(b => b.inventoryOnHand <= b.effectiveSafetyStock);

    return { lowStockSkus, lowStockBom };
  }

  public getInvoices(): GSTInvoice[] {
    return this.state.gstInvoices;
  }

  public findInvoiceByNumberOrSlug(numOrSlug: string): GSTInvoice | undefined {
    const clean = numOrSlug.replace(/\.pdf$/i, '').trim().toLowerCase();
    return this.state.gstInvoices.find(
      inv =>
        inv.invoiceNumber.toLowerCase() === clean ||
        inv.invoiceNumber.replace(/\//g, '-').toLowerCase() === clean ||
        inv.id.toLowerCase() === clean
    );
  }

  public getCreditNotes(): GSTCreditNote[] {
    return this.state.gstCreditNotes;
  }

  public findCreditNoteByNumberOrSlug(numOrSlug: string): GSTCreditNote | undefined {
    const clean = numOrSlug.replace(/\.pdf$/i, '').trim().toLowerCase();
    return this.state.gstCreditNotes.find(
      cn =>
        cn.creditNoteNumber.toLowerCase() === clean ||
        cn.creditNoteNumber.replace(/\//g, '-').toLowerCase() === clean ||
        cn.id.toLowerCase() === clean
    );
  }

  public issueCreditNote(invoiceNumber: string, reason: GSTCreditNote['reason'], actorEmail: string): GSTCreditNote {
    if (!this.state.config.gstInvoicingEnabled) {
      throw new Error('GST Invoicing & Credit Note module is currently suspended by Store Management.');
    }
    const inv = this.state.gstInvoices.find(i => i.invoiceNumber === invoiceNumber);
    if (!inv) throw new Error(`Invoice ${invoiceNumber} not found`);

    const cnNumber = `BVL/CN/26-27/${(this.state.gstCreditNotes.length + 1).toString().padStart(4, '0')}`;
    const creditNote: GSTCreditNote = {
      id: `cn_${Date.now()}`,
      creditNoteNumber: cnNumber,
      originalInvoiceNumber: invoiceNumber,
      orderId: inv.orderId,
      reason,
      taxableValue: inv.taxableValue,
      cgstAmount: inv.cgstAmount,
      sgstAmount: inv.sgstAmount,
      igstAmount: inv.igstAmount,
      totalCreditAmount: inv.totalInvoiceAmount,
      issuedAt: new Date().toISOString()
    };
    this.state.gstCreditNotes.push(creditNote);

    this.logAudit(
      actorEmail,
      'ISSUE_CREDIT_NOTE',
      'GST_INVOICING',
      `Issued GST Credit Note ${cnNumber} for Invoice ${invoiceNumber} (₹${creditNote.totalCreditAmount})`
    );
    this.persistState();
    return creditNote;
  }

  // --- Webhook Ingestion & Idempotency ---
  public isWebhookProcessed(eventId: string): boolean {
    return this.state.processedWebhookIds.includes(eventId);
  }

  public markWebhookProcessed(eventId: string) {
    if (!this.state.processedWebhookIds.includes(eventId)) {
      this.state.processedWebhookIds.push(eventId);
      this.persistState();
    }
  }
}

export const db = new RelationalDatabase();
