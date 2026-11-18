-- ============================================================================
-- Bharatvarsh Leathercrafts LLP — Production MySQL 8.0 Schema (Hostinger)
-- 1:1 Synchronized with src/types/index.ts & src/server/mysqlAdapter.ts
-- Safe for direct import in Hostinger phpMyAdmin / mysql CLI
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 1. Primary Atomic JSON State Snapshot (cross-entity backup & recovery)
CREATE TABLE IF NOT EXISTS bvl_app_state (
  state_key VARCHAR(64) PRIMARY KEY,
  state_json LONGTEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Normalized Store Operational Configuration
CREATE TABLE IF NOT EXISTS bvl_store_config (
  id VARCHAR(64) PRIMARY KEY,
  gst_invoicing_enabled TINYINT(1) NOT NULL DEFAULT 1,
  abandonment_threshold_minutes INT NOT NULL DEFAULT 15,
  primary_hub_city VARCHAR(64) NOT NULL DEFAULT 'Pune',
  supplier_gstin VARCHAR(32) NOT NULL DEFAULT '27AABCB1234F1Z8',
  gst_rate_percent DECIMAL(5,2) NOT NULL DEFAULT 18.00,
  promo_codes_json LONGTEXT NOT NULL,
  master_super_admins_json TEXT NOT NULL,
  permitted_store_managers_json TEXT NOT NULL,
  updated_at DATETIME NOT NULL,
  last_updated_by VARCHAR(191) NOT NULL DEFAULT 'system'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Authorized Admin & Staff RBAC Accounts
CREATE TABLE IF NOT EXISTS bvl_admin_users (
  user_id VARCHAR(191) PRIMARY KEY,
  display_name VARCHAR(191) NOT NULL,
  role ENUM('PATRON', 'STORE_MANAGER', 'SUPPORT_AGENT', 'LOGISTICS_COORDINATOR') NOT NULL DEFAULT 'STORE_MANAGER',
  password_hash VARCHAR(255) NOT NULL DEFAULT '',
  is_master TINYINT(1) NOT NULL DEFAULT 0,
  added_by VARCHAR(191) NOT NULL DEFAULT 'system',
  added_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Salted Scrypt Patron Password Hashes (isolated from StoreManagementConfig UI responses)
CREATE TABLE IF NOT EXISTS bvl_patron_credentials (
  email VARCHAR(191) PRIMARY KEY,
  password_hash VARCHAR(255) NOT NULL,
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Customers, RFM Analytics & Soft-Delete Ledger
CREATE TABLE IF NOT EXISTS bvl_customers (
  id VARCHAR(64) PRIMARY KEY,
  identity_uid VARCHAR(128) NULL,
  email VARCHAR(191) NOT NULL UNIQUE,
  phone VARCHAR(32) NOT NULL DEFAULT '',
  full_name VARCHAR(191) NOT NULL,
  role ENUM('PATRON', 'STORE_MANAGER', 'SUPPORT_AGENT', 'LOGISTICS_COORDINATOR') NOT NULL DEFAULT 'PATRON',
  total_orders INT NOT NULL DEFAULT 0,
  lifetime_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  average_order_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  refund_rate DECIMAL(6,2) NOT NULL DEFAULT 0,
  days_since_last_order INT NOT NULL DEFAULT 0,
  last_order_date DATETIME NULL,
  rfm_segment VARCHAR(64) NOT NULL DEFAULT 'Promising/Recent',
  rfm_score_json VARCHAR(255) NULL,
  discount_orders_count INT NOT NULL DEFAULT 0,
  loyalty_points INT NOT NULL DEFAULT 0,
  store_credit_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  tags_json TEXT NULL,
  utm_source VARCHAR(191) NULL,
  utm_medium VARCHAR(191) NULL,
  acquisition_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_bvl_customers_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Patron Shipping & Billing Addresses
CREATE TABLE IF NOT EXISTS bvl_customer_addresses (
  id VARCHAR(64) PRIMARY KEY,
  customer_id VARCHAR(64) NOT NULL,
  recipient_name VARCHAR(191) NOT NULL DEFAULT '',
  phone VARCHAR(32) NOT NULL DEFAULT '',
  street TEXT NOT NULL,
  city VARCHAR(128) NOT NULL,
  state VARCHAR(128) NOT NULL,
  pincode VARCHAR(32) NOT NULL,
  country VARCHAR(64) NOT NULL DEFAULT 'India',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  address_type ENUM('SHIPPING', 'BILLING') NOT NULL DEFAULT 'SHIPPING',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_bvl_addr_customer (customer_id),
  CONSTRAINT fk_bvl_addr_customer FOREIGN KEY (customer_id) REFERENCES bvl_customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Storefront Catalogue Categories & Product Types Taxonomy
CREATE TABLE IF NOT EXISTS bvl_catalog_categories (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  slug VARCHAR(191) NOT NULL UNIQUE,
  description TEXT,
  product_types_json LONGTEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Storefront Catalogue Products (nullable gst_rate inherits Store default)
CREATE TABLE IF NOT EXISTS bvl_catalog_products (
  id VARCHAR(64) PRIMARY KEY,
  category VARCHAR(64) NOT NULL,
  product_type VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  sku VARCHAR(64) NOT NULL UNIQUE,
  price DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(16) NOT NULL DEFAULT 'INR',
  description TEXT,
  features_json LONGTEXT,
  images_json LONGTEXT,
  hsn_code VARCHAR(32),
  gst_rate DECIMAL(5,4) NULL DEFAULT NULL,
  solution_engine ENUM('EVERYDAY_CARRY', 'TRANSIT_FOLIOS', 'LIFETIME_HEIRLOOM_CARE') NOT NULL DEFAULT 'EVERYDAY_CARRY',
  allow_customization TINYINT(1) NOT NULL DEFAULT 1,
  care_kit_included TINYINT(1) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Dual-Hub Relational Inventory (Pune Primary Hub & Mumbai Warehouse)
CREATE TABLE IF NOT EXISTS bvl_inventory (
  sku VARCHAR(64) PRIMARY KEY,
  id VARCHAR(64) NOT NULL DEFAULT '',
  product_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(64) NOT NULL,
  pune_primary_hub INT NOT NULL DEFAULT 0,
  mumbai_warehouse INT NOT NULL DEFAULT 0,
  safety_stock INT NOT NULL DEFAULT 5,
  reorder_point INT NOT NULL DEFAULT 10,
  unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  selling_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  batch_lot_number VARCHAR(64),
  lead_time_days INT NOT NULL DEFAULT 7,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_bvl_inventory_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Bill of Materials Raw Material Consumption & Safety Stock Ledger
CREATE TABLE IF NOT EXISTS bvl_bill_of_materials (
  id VARCHAR(64) PRIMARY KEY,
  parent_sku VARCHAR(64) NOT NULL,
  material_name VARCHAR(255) NOT NULL,
  quantity_per_unit DECIMAL(12,2) NOT NULL DEFAULT 1,
  unit ENUM('SQ_FT', 'METERS', 'PIECES', 'GRAMS') NOT NULL DEFAULT 'PIECES',
  inventory_on_hand DECIMAL(12,2) NOT NULL DEFAULT 0,
  safety_stock INT NOT NULL DEFAULT 20,
  vendor_name VARCHAR(191) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_bvl_bom_sku (parent_sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Fullfillment & Payment Orders
CREATE TABLE IF NOT EXISTS bvl_orders (
  id VARCHAR(64) PRIMARY KEY,
  order_number VARCHAR(64) NOT NULL UNIQUE,
  customer_id VARCHAR(64) NOT NULL,
  customer_name VARCHAR(191) NOT NULL DEFAULT '',
  customer_email VARCHAR(191) NOT NULL,
  customer_phone VARCHAR(32) NOT NULL DEFAULT '',
  status ENUM('PROCESSING', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'RETURNED') NOT NULL DEFAULT 'PROCESSING',
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_code VARCHAR(64) NULL,
  tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_gateway ENUM('RAZORPAY', 'STRIPE', 'CASH_ON_DELIVERY') NOT NULL DEFAULT 'RAZORPAY',
  payment_id VARCHAR(128) NULL,
  payment_status ENUM('PAID', 'PENDING', 'REFUNDED', 'FAILED') NOT NULL DEFAULT 'PAID',
  items_json LONGTEXT NULL,
  shipping_address_json TEXT NULL,
  billing_address_json TEXT NULL,
  awb_number VARCHAR(64) NULL,
  courier_partner ENUM('SHIPROCKET', 'DELHIVERY') NULL,
  courier_status ENUM('IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RTO') NULL,
  estimated_delivery_date DATETIME NULL,
  invoice_number VARCHAR(64) NULL,
  is_gst_invoice_generated TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_bvl_orders_customer (customer_id),
  INDEX idx_bvl_orders_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. Hot-Stamping Monogram Atelier Vectors
CREATE TABLE IF NOT EXISTS bvl_hot_stamping_vectors (
  id VARCHAR(64) PRIMARY KEY,
  customer_id VARCHAR(64) NOT NULL,
  order_id VARCHAR(64) NULL,
  product_id VARCHAR(64) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  monogram_text VARCHAR(16) NOT NULL,
  foil_style ENUM('BLIND', 'GOLD_FOIL', 'SILVER_FOIL') NOT NULL DEFAULT 'GOLD_FOIL',
  font_family ENUM('CINZEL', 'SERIF', 'MODERN') NOT NULL DEFAULT 'CINZEL',
  preview_image_url LONGTEXT NULL,
  recorded_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. 2-Year Solid Brass Hardware Warranties
CREATE TABLE IF NOT EXISTS bvl_warranties (
  id VARCHAR(64) PRIMARY KEY,
  customer_id VARCHAR(64) NOT NULL,
  customer_name VARCHAR(191) NOT NULL,
  order_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  hardware_serial VARCHAR(128) NOT NULL,
  warranty_period_years INT NOT NULL DEFAULT 2,
  start_date DATETIME NOT NULL,
  expiry_date DATETIME NOT NULL,
  status ENUM('ACTIVE', 'EXPIRED', 'CLAIMED') NOT NULL DEFAULT 'ACTIVE',
  claim_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. Organic Beeswax Care Kit Dispatches
CREATE TABLE IF NOT EXISTS bvl_care_kits (
  id VARCHAR(64) PRIMARY KEY,
  customer_id VARCHAR(64) NOT NULL,
  order_id VARCHAR(64) NOT NULL,
  kit_type ENUM('ORGANIC_BEESWAX_BALM_BRUSH', 'HERITAGE_LEATHER_ELIXIR') NOT NULL DEFAULT 'ORGANIC_BEESWAX_BALM_BRUSH',
  dispatch_date DATETIME NOT NULL,
  awb_number VARCHAR(64) NOT NULL,
  courier ENUM('SHIPROCKET', 'DELHIVERY') NOT NULL DEFAULT 'SHIPROCKET',
  status ENUM('DISPATCHED', 'DELIVERED') NOT NULL DEFAULT 'DISPATCHED',
  digital_guide_sent TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 15. B2B Corporate Gifting Leads & ERP Order Linkage
CREATE TABLE IF NOT EXISTS bvl_corporate_leads (
  id VARCHAR(64) PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL,
  contact_person VARCHAR(191) NOT NULL,
  email VARCHAR(191) NOT NULL,
  phone VARCHAR(32) NOT NULL DEFAULT '',
  estimated_quantity INT NOT NULL DEFAULT 1,
  budget_range_inr VARCHAR(128) NOT NULL DEFAULT '',
  interest_category ENUM('TRANSIT_FOLIOS', 'EVERYDAY_CARRY', 'CUSTOM_HEIRLOOM_SETS') NOT NULL DEFAULT 'EVERYDAY_CARRY',
  status ENUM('NEW_LEAD', 'SWATCH_DISPATCHED', 'QUOTE_ISSUED', 'ORDER_CONFIRMED', 'FULFILLED') NOT NULL DEFAULT 'NEW_LEAD',
  swatch_kit_awb VARCHAR(64) NULL,
  items_json LONGTEXT NULL,
  erp_order_id VARCHAR(64) NULL,
  erp_order_number VARCHAR(64) NULL,
  notes TEXT NULL,
  deal_value_inr DECIMAL(12,2) NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_bvl_leads_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 16. Omnichannel Patron Support Tickets
CREATE TABLE IF NOT EXISTS bvl_support_tickets (
  id VARCHAR(64) PRIMARY KEY,
  ticket_number VARCHAR(64) NOT NULL UNIQUE,
  customer_id VARCHAR(64) NOT NULL,
  customer_name VARCHAR(191) NOT NULL,
  customer_email VARCHAR(191) NOT NULL,
  customer_phone VARCHAR(32) NULL,
  channel ENUM('WHATSAPP', 'EMAIL', 'LIVE_CHAT') NOT NULL DEFAULT 'WHATSAPP',
  subject VARCHAR(255) NOT NULL,
  category ENUM('DAMAGED_GOODS', 'SIZE_EXCHANGE', 'MISSING_PARCEL', 'MONOGRAM_REQUEST', 'WARRANTY_CLAIM') NOT NULL DEFAULT 'MONOGRAM_REQUEST',
  priority ENUM('LOW', 'MEDIUM', 'HIGH', 'VIP_URGENT') NOT NULL DEFAULT 'MEDIUM',
  status ENUM('OPEN', 'IN_PROGRESS', 'WAITING_ON_PATRON', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
  assigned_to VARCHAR(191) NULL,
  sla_breach_hours INT NOT NULL DEFAULT 24,
  messages_json LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_bvl_tickets_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 17. Persisted & Abandoned Cart Recovery Tracking
CREATE TABLE IF NOT EXISTS bvl_carts (
  id VARCHAR(64) PRIMARY KEY,
  customer_id VARCHAR(64) NULL,
  email VARCHAR(191) NOT NULL,
  phone VARCHAR(32) NULL,
  items_json LONGTEXT NOT NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  is_abandoned TINYINT(1) NOT NULL DEFAULT 0,
  abandoned_at DATETIME NULL,
  recovery_stage ENUM('DETECTED', 'EMAIL_SENT', 'WHATSAPP_SENT', 'RECOVERED', 'EXPIRED') NOT NULL DEFAULT 'DETECTED',
  recovery_attempts INT NOT NULL DEFAULT 0,
  last_recovery_trigger_at DATETIME NULL,
  checkout_url TEXT NOT NULL,
  last_active_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 18. GST Tax Invoices
CREATE TABLE IF NOT EXISTS bvl_gst_invoices (
  id VARCHAR(64) PRIMARY KEY,
  invoice_number VARCHAR(64) NOT NULL UNIQUE,
  order_id VARCHAR(64) NOT NULL,
  customer_id VARCHAR(64) NOT NULL,
  customer_gstin VARCHAR(32) NULL,
  supplier_gstin VARCHAR(32) NOT NULL,
  invoice_date DATETIME NOT NULL,
  supply_state VARCHAR(128) NOT NULL,
  place_of_supply VARCHAR(128) NOT NULL,
  is_inter_state TINYINT(1) NOT NULL DEFAULT 0,
  taxable_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  cgst_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  sgst_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  igst_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_invoice_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status ENUM('ISSUED', 'CANCELLED') NOT NULL DEFAULT 'ISSUED',
  pdf_url VARCHAR(255) NULL,
  INDEX idx_bvl_invoices_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 19. GST Credit Notes (RMAs & Refunds)
CREATE TABLE IF NOT EXISTS bvl_gst_credit_notes (
  id VARCHAR(64) PRIMARY KEY,
  credit_note_number VARCHAR(64) NOT NULL UNIQUE,
  original_invoice_number VARCHAR(64) NOT NULL,
  order_id VARCHAR(64) NOT NULL,
  reason ENUM('GOODS_RETURN', 'DEFECT_REFUND', 'ORDER_CANCELLATION') NOT NULL DEFAULT 'GOODS_RETURN',
  taxable_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  cgst_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  sgst_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  igst_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_credit_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  issued_at DATETIME NOT NULL,
  INDEX idx_bvl_cn_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 20. Append-Only Security & Operational Audit Logs
CREATE TABLE IF NOT EXISTS bvl_audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  actor_email VARCHAR(191) NOT NULL,
  action VARCHAR(64) NOT NULL,
  category ENUM('STORE_MANAGEMENT', 'GST_INVOICING', 'INVENTORY_ADJUSTMENT', 'WEBHOOK_EVENT', 'AUTH_PERMISSION') NOT NULL DEFAULT 'STORE_MANAGEMENT',
  details TEXT NOT NULL,
  ip_address VARCHAR(64) NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_bvl_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 21. Processed Webhook Idempotency Registry
CREATE TABLE IF NOT EXISTS bvl_webhook_events (
  event_id VARCHAR(128) PRIMARY KEY,
  processed_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
