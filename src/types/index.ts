/**
 * Bharatvarsh Leathercrafts LLP - Core Type Definitions & Relational Schema
 */

export type UserRole = 'PATRON' | 'STORE_MANAGER' | 'SUPPORT_AGENT' | 'LOGISTICS_COORDINATOR';

export interface AuthUser {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  isMasterAdmin?: boolean;
  isStoreManagementAuthorized?: boolean;
  photoURL?: string;
  authProvider?: 'GOOGLE' | 'FIREBASE' | 'CREDENTIALS';
}

export interface CustomerAddress {
  id: string;
  customerId: string;
  recipientName?: string;
  phone?: string;
  street: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  isDefault: boolean;
  addressType: 'SHIPPING' | 'BILLING';
  createdAt?: string;
  updatedAt?: string;
}

export type RFMSegment = 'Champions/VIPs' | 'Promising/Recent' | 'At-Risk/Churning' | 'Bargain Hunters';

export interface Customer {
  id: string;
  identityUid?: string;
  email: string;
  phone: string;
  fullName: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  addresses?: CustomerAddress[];
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  totalOrders: number;
  lifetimeValue: number;
  averageOrderValue: number;
  refundRate: number;
  daysSinceLastOrder: number;
  lastOrderDate?: string;
  rfmSegment: RFMSegment;
  rfmScore: {
    recency: number;
    frequency: number;
    monetary: number;
  };
  discountOrdersCount: number;
  loyaltyPoints: number;
  storeCreditBalance: number;
  tags: string[];
  utmSource?: string;
  utmMedium?: string;
  acquisitionCost: number;
  isActive?: boolean;
  deletedAt?: string | null;
}

export type OrderStatus = 'PROCESSING' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED' | 'RETURNED';

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  sku: string;
  category: string;
  quantity: number;
  unitPrice: number;
  leatherType: 'VEGETABLE_TANNED_HERITAGE' | 'BIO_SUBSTITUTE_CACTUS';
  customization?: {
    monogramInitials: string;
    foilType: 'BLIND' | 'GOLD_FOIL' | 'SILVER_FOIL';
    placement: string;
  };
  hsnCode: string;
  gstRate: number;
  taxAmount: number;
  lineTotal: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  status: OrderStatus;
  currency: 'INR';
  subtotal: number;
  discountAmount: number;
  discountCode?: string;
  taxAmount: number;
  shippingFee: number;
  totalAmount: number;
  paymentGateway: 'RAZORPAY' | 'STRIPE' | 'CASH_ON_DELIVERY';
  paymentId?: string;
  paymentStatus: 'PAID' | 'PENDING' | 'REFUNDED' | 'FAILED';
  items: OrderItem[];
  shippingAddress: CustomerAddress;
  billingAddress: CustomerAddress;
  awbNumber?: string;
  courierPartner?: 'SHIPROCKET' | 'DELHIVERY';
  courierStatus?: 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'RTO';
  estimatedDeliveryDate?: string;
  createdAt: string;
  updatedAt: string;
  invoiceNumber?: string;
  isGstInvoiceGenerated: boolean;
}

export interface HotStampingVector {
  id: string;
  customerId: string;
  orderId?: string;
  productId: string;
  productName: string;
  monogramText: string;
  foilStyle: 'BLIND' | 'GOLD_FOIL' | 'SILVER_FOIL';
  fontFamily: 'CINZEL' | 'SERIF' | 'MODERN';
  previewImageUrl?: string;
  recordedAt: string;
}

export interface WarrantyRegistration {
  id: string;
  customerId: string;
  customerName: string;
  orderId: string;
  productId: string;
  productName: string;
  hardwareSerial: string;
  warrantyPeriodYears: number;
  startDate: string;
  expiryDate: string;
  status: 'ACTIVE' | 'EXPIRED' | 'CLAIMED';
  claimCount: number;
  createdAt: string;
}

export interface CareKitDispatch {
  id: string;
  customerId: string;
  orderId: string;
  kitType: 'ORGANIC_BEESWAX_BALM_BRUSH' | 'HERITAGE_LEATHER_ELIXIR';
  dispatchDate: string;
  awbNumber: string;
  courier: 'SHIPROCKET' | 'DELHIVERY';
  status: 'DISPATCHED' | 'DELIVERED';
  digitalGuideSent: boolean;
}

export interface CorporateGiftingLeadItem {
  sku: string;
  productId?: string;
  productName?: string;
  quantity: number;
  unitPrice?: number;
  leatherType?: 'VEGETABLE_TANNED_HERITAGE' | 'BIO_SUBSTITUTE_CACTUS';
  monogramInitials?: string;
  foilType?: 'BLIND' | 'GOLD_FOIL' | 'SILVER_FOIL';
}

export interface CorporateGiftingLead {
  id: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  estimatedQuantity: number;
  budgetRangeInr: string;
  interestCategory: 'TRANSIT_FOLIOS' | 'EVERYDAY_CARRY' | 'CUSTOM_HEIRLOOM_SETS';
  status: 'NEW_LEAD' | 'SWATCH_DISPATCHED' | 'QUOTE_ISSUED' | 'ORDER_CONFIRMED' | 'FULFILLED';
  swatchKitAwb?: string;
  items?: CorporateGiftingLeadItem[];
  erpOrderId?: string;
  erpOrderNumber?: string;
  notes: string;
  dealValueInr?: number;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  ticketNumber: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  channel: 'WHATSAPP' | 'EMAIL' | 'LIVE_CHAT';
  subject: string;
  category: 'DAMAGED_GOODS' | 'SIZE_EXCHANGE' | 'MISSING_PARCEL' | 'MONOGRAM_REQUEST' | 'WARRANTY_CLAIM';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'VIP_URGENT';
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_PATRON' | 'RESOLVED';
  assignedTo?: string;
  slaBreachHours: number;
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    id: string;
    sender: 'PATRON' | 'AGENT' | 'SYSTEM';
    text: string;
    timestamp: string;
    channel: 'WHATSAPP' | 'EMAIL' | 'LIVE_CHAT';
  }>;
}

export type SolutionEngine = 'EVERYDAY_CARRY' | 'TRANSIT_FOLIOS' | 'LIFETIME_HEIRLOOM_CARE';

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  productTypes: string[];
}

export interface Product {
  id: string;
  category: string;
  productType: string;
  name: string;
  sku: string;
  price: number;
  offerPrice?: number;
  currency: string;
  description: string;
  features: string[];
  image?: string;
  images: string[];
  videoUrl?: string;
  hsnCode: string;
  gstRate?: number;
  solutionEngine: SolutionEngine;
  inStock?: boolean;
  isActive?: boolean;
  stockCount?: number;
  puneStock?: number;
  mumbaiStock?: number;
  allowCustomization: boolean;
  careKitIncluded: boolean;
}

export interface CartItem {
  productId: string;
  productName: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  leatherType: 'VEGETABLE_TANNED_HERITAGE' | 'BIO_SUBSTITUTE_CACTUS';
  monogram?: string;
  foilStyle?: 'BLIND' | 'GOLD_FOIL' | 'SILVER_FOIL';
  imageUrl: string;
}

export interface CartRecord {
  id: string;
  customerId?: string;
  email: string;
  phone?: string;
  items: CartItem[];
  subtotal: number;
  currency: 'INR';
  isAbandoned: boolean;
  abandonedAt?: string;
  recoveryStage: 'DETECTED' | 'EMAIL_SENT' | 'WHATSAPP_SENT' | 'RECOVERED' | 'EXPIRED';
  recoveryAttempts: number;
  lastRecoveryTriggerAt?: string;
  checkoutUrl: string;
  lastActiveAt: string;
}

export interface UnitEconomicsMetrics {
  cac: number;
  roas: number;
  aov: number;
  totalRevenue: number;
  totalOrders: number;
  activeCustomers: number;
  repeatPurchaseRate: number;
}

export interface OperationalHealthMetrics {
  returnRateByReason: {
    colorExpectation: number;
    textureExpectation: number;
    sizingFit: number;
    transitDamage: number;
  };
  averageTransitDays: number;
  warrantyClaimFrequency: number;
  onTimeDeliveryRate: number;
  totalReturns?: number;
  completedDeliveries?: number;
}

export interface ProductInventory {
  id: string;
  productId: string;
  sku: string;
  name: string;
  category: string;
  stockByLocation: {
    punePrimaryHub: number;
    mumbaiWarehouse: number;
  };
  safetyStock: number;
  reorderPoint: number;
  unitCost: number;
  sellingPrice: number;
  batchLotNumber: string;
  leadTimeDays: number;
}

export interface BillOfMaterialsItem {
  id: string;
  parentSku: string;
  materialName: string;
  quantityPerUnit: number;
  unit: 'SQ_FT' | 'METERS' | 'PIECES' | 'GRAMS';
  inventoryOnHand: number;
  safetyStock?: number;
  vendorName: string;
}

export interface GSTInvoice {
  id: string;
  invoiceNumber: string;
  orderId: string;
  customerId: string;
  customerGstin?: string;
  supplierGstin: string;
  invoiceDate: string;
  supplyState: string;
  placeOfSupply: string;
  isInterState: boolean;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalInvoiceAmount: number;
  status: 'ISSUED' | 'CANCELLED';
  pdfUrl?: string;
}

export interface GSTCreditNote {
  id: string;
  creditNoteNumber: string;
  originalInvoiceNumber: string;
  orderId: string;
  reason: 'GOODS_RETURN' | 'DEFECT_REFUND' | 'ORDER_CANCELLATION';
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalCreditAmount: number;
  issuedAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorEmail: string;
  action: string;
  category: 'STORE_MANAGEMENT' | 'GST_INVOICING' | 'INVENTORY_ADJUSTMENT' | 'WEBHOOK_EVENT' | 'AUTH_PERMISSION';
  details: string;
  timestamp: string;
  ipAddress?: string;
}

export interface AdminUserCredential {
  userId: string;
  displayName: string;
  role?: UserRole;
  passwordHash?: string;
  addedBy: string;
  addedAt: string;
  isMaster: boolean;
}

export interface PromoCodeRule {
  code: string;
  discountPercent: number;
  active: boolean;
  description?: string;
}

export interface StoreManagementConfig {
  id: string;
  gstInvoicingEnabled: boolean;
  masterSuperAdmins: string[];
  permittedStoreManagers: string[];
  adminCredentials: AdminUserCredential[];
  abandonmentThresholdMinutes: number;
  primaryHubCity: string;
  supplierGstin: string;
  gstRatePercent: number;
  promoCodes: PromoCodeRule[];
  updatedAt: string;
  lastUpdatedBy: string;
}

export interface GatewayWebhookPayload {
  eventId: string;
  event: 'customer.created' | 'order.placed' | 'order.fulfilled' | 'checkout.abandoned' | 'refund.processed';
  timestamp: string;
  data: Record<string, any>;
}
