/**
 * Hostinger Local MySQL Database Adapter for Bharatvarsh Leathercrafts LLP
 * Automatically connects using MYSQL_HOST (localhost on Hostinger), MYSQL_PORT,
 * MYSQL_DATABASE, MYSQL_USER, and MYSQL_PASSWORD, or persisted AES-256-GCM encrypted
 * credentials entered via the Admin Console UI.
 *
 * Manages all 21 normalized InnoDB tables (1:1 parity with mysql-schema.sql and src/types/index.ts),
 * performs idempotent INFORMATION_SCHEMA column/ENUM/index upgrades on existing tables,
 * handles soft-delete customer history and targeted admin deletions, replicates the product catalog,
 * and provides atomic SELECT ... FOR UPDATE transactions for inventory & order placement.
 */

import mysql from 'mysql2/promise';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface MySQLConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface LockedInventoryRow {
  sku: string;
  productId: string;
  name: string;
  punePrimaryHub: number;
  mumbaiWarehouse: number;
}

interface EncryptedCredentialsEnvelope {
  version: number;
  iv: string;
  tag: string;
  ciphertext: string;
  updatedAt: string;
}

export const MYSQL_TABLE_NAMES = [
  'bvl_app_state',
  'bvl_store_config',
  'bvl_admin_users',
  'bvl_patron_credentials',
  'bvl_customers',
  'bvl_customer_addresses',
  'bvl_catalog_categories',
  'bvl_catalog_products',
  'bvl_inventory',
  'bvl_bill_of_materials',
  'bvl_orders',
  'bvl_hot_stamping_vectors',
  'bvl_warranties',
  'bvl_care_kits',
  'bvl_corporate_leads',
  'bvl_support_tickets',
  'bvl_carts',
  'bvl_gst_invoices',
  'bvl_gst_credit_notes',
  'bvl_audit_logs',
  'bvl_webhook_events'
] as const;

function toMySQLDate(iso?: string | null): Date {
  if (!iso) return new Date();
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toIsoString(val: any, fallback?: string): string {
  if (!val) return fallback ?? new Date().toISOString();
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? fallback ?? new Date().toISOString() : val.toISOString();
  }
  const parsed = new Date(val);
  return Number.isNaN(parsed.getTime()) ? String(val) : parsed.toISOString();
}

function makePlaceholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function safeJsonParse<T>(raw: any, fallback: T): T {
  if (raw !== null && typeof raw === 'object') return raw as T;
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

class MySQLAdapter {
  private pool: mysql.Pool | null = null;
  private connected: boolean = false;
  private lastError: string | null = null;
  private lastSyncAt: string | null = null;
  private configSource: 'env' | 'persisted_ui' | 'none' = 'none';
  private config: MySQLConfig;
  private credentialsFilePath: string;
  private keyFilePath: string;

  constructor() {
    this.credentialsFilePath = path.resolve(process.cwd(), 'src/server/data/mysql_credentials.enc.json');
    this.keyFilePath = path.resolve(process.cwd(), 'src/server/data/.mysql_key');

    if (process.env.MYSQL_DATABASE && process.env.MYSQL_USER) {
      this.config = {
        host: process.env.MYSQL_HOST || 'localhost',
        port: parseInt(process.env.MYSQL_PORT || '3306', 10),
        database: process.env.MYSQL_DATABASE,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD || ''
      };
      this.configSource = 'env';
    } else {
      const persisted = this.loadEncryptedConfig();
      if (persisted && persisted.database && persisted.user) {
        this.config = persisted;
        this.configSource = 'persisted_ui';
      } else {
        this.config = {
          host: process.env.MYSQL_HOST || 'localhost',
          port: parseInt(process.env.MYSQL_PORT || '3306', 10),
          database: '',
          user: '',
          password: ''
        };
        this.configSource = 'none';
      }
    }
  }

  public isConnected(): boolean {
    return this.connected && this.pool !== null;
  }

  public getStatus() {
    return {
      connected: this.connected,
      host: this.config.host,
      port: this.config.port,
      database: this.config.database || '(not configured)',
      user: this.config.user || '(not configured)',
      configSource: this.configSource,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError
    };
  }

  // ==========================================
  // ENCRYPTED CREDENTIAL PERSISTENCE (AES-256-GCM)
  // ==========================================

  private getOrCreateEncryptionKey(): Buffer {
    if (process.env.MYSQL_CONFIG_SECRET) {
      return crypto.createHash('sha256').update(process.env.MYSQL_CONFIG_SECRET).digest();
    }

    const dir = path.dirname(this.keyFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.keyFilePath)) {
      const rawHex = fs.readFileSync(this.keyFilePath, 'utf-8').trim();
      if (/^[0-9a-f]{64}$/i.test(rawHex)) {
        return Buffer.from(rawHex, 'hex');
      }
    }

    const key = crypto.randomBytes(32);
    fs.writeFileSync(this.keyFilePath, key.toString('hex'), { encoding: 'utf-8', mode: 0o600 });
    return key;
  }

  public encryptCredentials(cfg: MySQLConfig): EncryptedCredentialsEnvelope {
    const key = this.getOrCreateEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = JSON.stringify(cfg);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      version: 1,
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      ciphertext: encrypted.toString('hex'),
      updatedAt: new Date().toISOString()
    };
  }

  public decryptCredentials(envelope: EncryptedCredentialsEnvelope): MySQLConfig | null {
    try {
      const key = this.getOrCreateEncryptionKey();
      const iv = Buffer.from(envelope.iv, 'hex');
      const tag = Buffer.from(envelope.tag, 'hex');
      const ciphertext = Buffer.from(envelope.ciphertext, 'hex');

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      const parsed = JSON.parse(decrypted) as MySQLConfig;
      return {
        host: parsed.host || 'localhost',
        port: Number(parsed.port) || 3306,
        database: parsed.database || '',
        user: parsed.user || '',
        password: parsed.password || ''
      };
    } catch (err: any) {
      console.warn('[MySQL] Failed to decrypt persisted MySQL credentials:', err.message);
      return null;
    }
  }

  public saveEncryptedConfig(cfg: MySQLConfig): void {
    const dir = path.dirname(this.credentialsFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const envelope = this.encryptCredentials(cfg);
    fs.writeFileSync(this.credentialsFilePath, JSON.stringify(envelope, null, 2), {
      encoding: 'utf-8',
      mode: 0o600
    });
  }

  public loadEncryptedConfig(): MySQLConfig | null {
    try {
      if (!fs.existsSync(this.credentialsFilePath)) return null;
      const raw = fs.readFileSync(this.credentialsFilePath, 'utf-8');
      const envelope = JSON.parse(raw) as EncryptedCredentialsEnvelope;
      return this.decryptCredentials(envelope);
    } catch {
      return null;
    }
  }

  // ==========================================
  // CONNECTION & IDEMPOTENT SCHEMA MIGRATION
  // ==========================================

  public async configureAndConnect(
    newConfig?: Partial<MySQLConfig>,
    options?: { persistCredentials?: boolean }
  ): Promise<{ connected: boolean; message: string }> {
    const candidateConfig: MySQLConfig = newConfig
      ? {
          host: newConfig.host || this.config.host || 'localhost',
          port: newConfig.port || this.config.port || 3306,
          database: newConfig.database ?? this.config.database,
          user: newConfig.user ?? this.config.user,
          password: newConfig.password ?? this.config.password
        }
      : { ...this.config };

    if (!candidateConfig.database || !candidateConfig.user) {
      this.connected = false;
      this.lastError = 'MySQL database name and user ID are not supplied yet. Using local disk persistence.';
      return { connected: false, message: this.lastError };
    }

    let nextPool: mysql.Pool | null = null;
    try {
      nextPool = mysql.createPool({
        host: candidateConfig.host,
        port: candidateConfig.port,
        database: candidateConfig.database,
        user: candidateConfig.user,
        password: candidateConfig.password,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        connectTimeout: 5000
      });

      const conn = await nextPool.getConnection();
      try {
        await this.ensureTables(conn);
      } finally {
        conn.release();
      }

      if (this.pool) {
        await this.pool.end().catch(() => {});
      }

      this.pool = nextPool;
      this.config = candidateConfig;
      this.connected = true;
      this.lastError = null;

      if (options?.persistCredentials) {
        this.saveEncryptedConfig(this.config);
        this.configSource = 'persisted_ui';
      }

      console.log(
        `[MySQL] Connected to Hostinger local MySQL (${this.config.host}:${this.config.port}/${this.config.database}, source=${this.configSource})`
      );
      return {
        connected: true,
        message: `Connected to MySQL database '${this.config.database}' on ${this.config.host}`
      };
    } catch (err: any) {
      if (nextPool) {
        await nextPool.end().catch(() => {});
      }
      this.connected = false;
      this.lastError = err.message;
      console.warn(`[MySQL] Connection unavailable (${err.message}). Using local persistent disk store.`);
      return { connected: false, message: err.message };
    }
  }

  /**
   * Idempotently ensures a column exists and matches expected type/ENUM/nullability via INFORMATION_SCHEMA.
   */
  private async ensureColumn(
    conn: mysql.PoolConnection,
    tableName: string,
    columnName: string,
    definition: string,
    modifyIfDiffers: boolean = false
  ): Promise<void> {
    const [rows]: any = await conn.query(
      `SELECT COLUMN_TYPE, IS_NULLABLE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [tableName, columnName]
    );

    if (!rows || rows.length === 0) {
      await conn.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
      return;
    }

    if (modifyIfDiffers) {
      const currentType = String(rows[0].COLUMN_TYPE || '').toLowerCase();
      const currentNullable = String(rows[0].IS_NULLABLE || '').toUpperCase();
      const targetUpper = definition.toUpperCase();
      const wantsEnum = targetUpper.startsWith('ENUM(');
      const targetToken = definition.split(/\s+/)[0].toLowerCase();
      const wantsNull = targetUpper.includes(' NULL') && !targetUpper.includes('NOT NULL');

      const typeDiffers = wantsEnum
        ? !currentType.startsWith('enum(') ||
          definition.slice(0, definition.indexOf(')') + 1).toLowerCase().replace(/\s+/g, '') !==
            currentType.replace(/\s+/g, '')
        : !currentType.includes(targetToken.split('(')[0]);
      const nullableDiffers = wantsNull ? currentNullable !== 'YES' : false;

      if (typeDiffers || nullableDiffers) {
        try {
          await conn.query(`ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${columnName}\` ${definition}`);
        } catch (err: any) {
          console.warn(`[MySQL] Non-fatal MODIFY COLUMN skipped on ${tableName}.${columnName}:`, err.message);
        }
      }
    }
  }

  /**
   * Idempotently creates non-unique secondary indexes when missing.
   */
  private async ensureIndex(
    conn: mysql.PoolConnection,
    tableName: string,
    indexName: string,
    columnListSql: string
  ): Promise<void> {
    const [rows]: any = await conn.query(
      `SELECT COUNT(*) AS cnt
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [tableName, indexName]
    );
    if (!rows || Number(rows[0]?.cnt || 0) === 0) {
      await conn.query(`CREATE INDEX \`${indexName}\` ON \`${tableName}\` (${columnListSql})`);
    }
  }

  public async ensureTables(conn: mysql.PoolConnection) {
    // 1. Primary JSON State Snapshot table for atomic cross-entity backup
    await conn.query(`
      CREATE TABLE IF NOT EXISTS bvl_app_state (
        state_key VARCHAR(64) PRIMARY KEY,
        state_json LONGTEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Normalized Store Operational Configuration Table
    await conn.query(`
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
    `);

    // 3. Normalized Authorized Admin / Staff User IDs Table (Granular RBAC)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS bvl_admin_users (
        user_id VARCHAR(191) PRIMARY KEY,
        display_name VARCHAR(191) NOT NULL,
        role ENUM('PATRON', 'STORE_MANAGER', 'SUPPORT_AGENT', 'LOGISTICS_COORDINATOR') NOT NULL DEFAULT 'STORE_MANAGER',
        password_hash VARCHAR(255) NOT NULL DEFAULT '',
        is_master TINYINT(1) NOT NULL DEFAULT 0,
        added_by VARCHAR(191) NOT NULL DEFAULT 'system',
        added_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4. Normalized Patron Credential Hashes (salted scrypt hashes isolated from UI config)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS bvl_patron_credentials (
        email VARCHAR(191) PRIMARY KEY,
        password_hash VARCHAR(255) NOT NULL,
        updated_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. Normalized Customers Table (complete Customer interface + soft-delete flags)
    await conn.query(`
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
        updated_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 6. Normalized Customer Shipping / Billing Addresses
    await conn.query(`
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
    `);

    // 7. Normalized Catalogue Categories Table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS bvl_catalog_categories (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(191) NOT NULL,
        slug VARCHAR(191) NOT NULL UNIQUE,
        description TEXT,
        product_types_json LONGTEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 8. Normalized Catalogue Products Table (nullable gst_rate inherits Store default)
    await conn.query(`
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
    `);

    // 9. Normalized Relational Inventory Table (Pune Primary Hub & Mumbai Warehouse)
    await conn.query(`
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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 10. Normalized Bill of Materials Raw Input Inventory Table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS bvl_bill_of_materials (
        id VARCHAR(64) PRIMARY KEY,
        parent_sku VARCHAR(64) NOT NULL,
        material_name VARCHAR(255) NOT NULL,
        quantity_per_unit DECIMAL(12,2) NOT NULL DEFAULT 1,
        unit ENUM('SQ_FT', 'METERS', 'PIECES', 'GRAMS') NOT NULL DEFAULT 'PIECES',
        inventory_on_hand DECIMAL(12,2) NOT NULL DEFAULT 0,
        safety_stock INT NOT NULL DEFAULT 20,
        vendor_name VARCHAR(191) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 11. Normalized Orders Table
    await conn.query(`
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
        updated_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 12. Hot-Stamping Monogram Vectors Table
    await conn.query(`
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
    `);

    // 13. 2-Year Solid Brass Hardware Warranties Table
    await conn.query(`
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
    `);

    // 14. Organic Beeswax Care Kit Dispatches Table
    await conn.query(`
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
    `);

    // 15. B2B Corporate Gifting Leads Table (with items_json & erp_order_id/number)
    await conn.query(`
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
        created_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 16. Omnichannel Support Tickets Table (with customer_phone & messages_json)
    await conn.query(`
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
        updated_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 17. Persisted & Abandoned Carts Table
    await conn.query(`
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
    `);

    // 18. GST Tax Invoices Table
    await conn.query(`
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
        pdf_url VARCHAR(255) NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 19. GST Credit Notes Table
    await conn.query(`
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
        issued_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 20. Append-Only Audit Log Table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS bvl_audit_logs (
        id VARCHAR(64) PRIMARY KEY,
        actor_email VARCHAR(191) NOT NULL,
        action VARCHAR(64) NOT NULL,
        category ENUM('STORE_MANAGEMENT', 'GST_INVOICING', 'INVENTORY_ADJUSTMENT', 'WEBHOOK_EVENT', 'AUTH_PERMISSION') NOT NULL DEFAULT 'STORE_MANAGEMENT',
        details TEXT NOT NULL,
        ip_address VARCHAR(64) NULL,
        created_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 21. Processed Webhook Idempotency Registry Table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS bvl_webhook_events (
        event_id VARCHAR(128) PRIMARY KEY,
        processed_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Idempotent INFORMATION_SCHEMA column & ENUM migrations for pre-existing live Hostinger tables
    await this.ensureColumn(
      conn,
      'bvl_admin_users',
      'role',
      "ENUM('PATRON', 'STORE_MANAGER', 'SUPPORT_AGENT', 'LOGISTICS_COORDINATOR') NOT NULL DEFAULT 'STORE_MANAGER'",
      true
    );
    await this.ensureColumn(conn, 'bvl_admin_users', 'password_hash', "VARCHAR(255) NOT NULL DEFAULT ''");

    // bvl_customers missing analytics & soft-delete columns
    await this.ensureColumn(conn, 'bvl_customers', 'identity_uid', 'VARCHAR(128) NULL');
    await this.ensureColumn(
      conn,
      'bvl_customers',
      'role',
      "ENUM('PATRON', 'STORE_MANAGER', 'SUPPORT_AGENT', 'LOGISTICS_COORDINATOR') NOT NULL DEFAULT 'PATRON'",
      true
    );
    await this.ensureColumn(conn, 'bvl_customers', 'average_order_value', 'DECIMAL(12,2) NOT NULL DEFAULT 0');
    await this.ensureColumn(conn, 'bvl_customers', 'refund_rate', 'DECIMAL(6,2) NOT NULL DEFAULT 0');
    await this.ensureColumn(conn, 'bvl_customers', 'days_since_last_order', 'INT NOT NULL DEFAULT 0');
    await this.ensureColumn(conn, 'bvl_customers', 'last_order_date', 'DATETIME NULL');
    await this.ensureColumn(conn, 'bvl_customers', 'rfm_score_json', 'VARCHAR(255) NULL');
    await this.ensureColumn(conn, 'bvl_customers', 'discount_orders_count', 'INT NOT NULL DEFAULT 0');
    await this.ensureColumn(conn, 'bvl_customers', 'tags_json', 'TEXT NULL');
    await this.ensureColumn(conn, 'bvl_customers', 'utm_source', 'VARCHAR(191) NULL');
    await this.ensureColumn(conn, 'bvl_customers', 'utm_medium', 'VARCHAR(191) NULL');
    await this.ensureColumn(conn, 'bvl_customers', 'acquisition_cost', 'DECIMAL(12,2) NOT NULL DEFAULT 0');
    await this.ensureColumn(conn, 'bvl_customers', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1');
    await this.ensureColumn(conn, 'bvl_customers', 'deleted_at', 'DATETIME NULL');

    // bvl_catalog_products nullable per-SKU GST rate & enum alignment
    await this.ensureColumn(conn, 'bvl_catalog_products', 'gst_rate', 'DECIMAL(5,4) NULL DEFAULT NULL', true);
    await this.ensureColumn(
      conn,
      'bvl_catalog_products',
      'solution_engine',
      "ENUM('EVERYDAY_CARRY', 'TRANSIT_FOLIOS', 'LIFETIME_HEIRLOOM_CARE') NOT NULL DEFAULT 'EVERYDAY_CARRY'",
      true
    );

    // bvl_inventory id column
    await this.ensureColumn(conn, 'bvl_inventory', 'id', "VARCHAR(64) NOT NULL DEFAULT ''");

    // bvl_orders extended order columns & ENUM alignment
    await this.ensureColumn(conn, 'bvl_orders', 'customer_name', "VARCHAR(191) NOT NULL DEFAULT ''");
    await this.ensureColumn(conn, 'bvl_orders', 'customer_phone', "VARCHAR(32) NOT NULL DEFAULT ''");
    await this.ensureColumn(
      conn,
      'bvl_orders',
      'status',
      "ENUM('PROCESSING', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'RETURNED') NOT NULL DEFAULT 'PROCESSING'",
      true
    );
    await this.ensureColumn(conn, 'bvl_orders', 'currency', "VARCHAR(8) NOT NULL DEFAULT 'INR'");
    await this.ensureColumn(conn, 'bvl_orders', 'discount_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0');
    await this.ensureColumn(conn, 'bvl_orders', 'discount_code', 'VARCHAR(64) NULL');
    await this.ensureColumn(conn, 'bvl_orders', 'shipping_fee', 'DECIMAL(12,2) NOT NULL DEFAULT 0');
    await this.ensureColumn(
      conn,
      'bvl_orders',
      'payment_gateway',
      "ENUM('RAZORPAY', 'STRIPE', 'CASH_ON_DELIVERY') NOT NULL DEFAULT 'RAZORPAY'",
      true
    );
    await this.ensureColumn(conn, 'bvl_orders', 'payment_id', 'VARCHAR(128) NULL');
    await this.ensureColumn(
      conn,
      'bvl_orders',
      'payment_status',
      "ENUM('PAID', 'PENDING', 'REFUNDED', 'FAILED') NOT NULL DEFAULT 'PAID'",
      true
    );
    await this.ensureColumn(conn, 'bvl_orders', 'items_json', 'LONGTEXT NULL');
    await this.ensureColumn(conn, 'bvl_orders', 'shipping_address_json', 'TEXT NULL');
    await this.ensureColumn(conn, 'bvl_orders', 'billing_address_json', 'TEXT NULL');
    await this.ensureColumn(conn, 'bvl_orders', 'courier_partner', "ENUM('SHIPROCKET', 'DELHIVERY') NULL");
    await this.ensureColumn(
      conn,
      'bvl_orders',
      'courier_status',
      "ENUM('IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RTO') NULL"
    );
    await this.ensureColumn(conn, 'bvl_orders', 'estimated_delivery_date', 'DATETIME NULL');
    await this.ensureColumn(conn, 'bvl_orders', 'is_gst_invoice_generated', 'TINYINT(1) NOT NULL DEFAULT 0');
    await this.ensureColumn(conn, 'bvl_orders', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');

    // bvl_customer_addresses recipient, phone & timestamp upgrades
    await this.ensureColumn(conn, 'bvl_customer_addresses', 'recipient_name', "VARCHAR(191) NOT NULL DEFAULT ''");
    await this.ensureColumn(conn, 'bvl_customer_addresses', 'phone', "VARCHAR(32) NOT NULL DEFAULT ''");
    await this.ensureColumn(conn, 'bvl_customer_addresses', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
    await this.ensureColumn(
      conn,
      'bvl_customer_addresses',
      'updated_at',
      'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
    );

    // bvl_corporate_leads, bvl_support_tickets, bvl_audit_logs safety upgrades
    await this.ensureColumn(conn, 'bvl_corporate_leads', 'items_json', 'LONGTEXT NULL');
    await this.ensureColumn(conn, 'bvl_corporate_leads', 'erp_order_id', 'VARCHAR(64) NULL');
    await this.ensureColumn(conn, 'bvl_corporate_leads', 'erp_order_number', 'VARCHAR(64) NULL');
    await this.ensureColumn(conn, 'bvl_support_tickets', 'customer_phone', 'VARCHAR(32) NULL');
    await this.ensureColumn(conn, 'bvl_audit_logs', 'ip_address', 'VARCHAR(64) NULL');

    // Performance indexes
    await this.ensureIndex(conn, 'bvl_customers', 'idx_bvl_customers_active', 'is_active');
    await this.ensureIndex(conn, 'bvl_customer_addresses', 'idx_bvl_addr_customer', 'customer_id');
    await this.ensureIndex(conn, 'bvl_inventory', 'idx_bvl_inventory_product', 'product_id');
    await this.ensureIndex(conn, 'bvl_bill_of_materials', 'idx_bvl_bom_sku', 'parent_sku');
    await this.ensureIndex(conn, 'bvl_orders', 'idx_bvl_orders_customer', 'customer_id');
    await this.ensureIndex(conn, 'bvl_orders', 'idx_bvl_orders_created', 'created_at');
    await this.ensureIndex(conn, 'bvl_corporate_leads', 'idx_bvl_leads_status', 'status');
    await this.ensureIndex(conn, 'bvl_support_tickets', 'idx_bvl_tickets_customer', 'customer_id');
    await this.ensureIndex(conn, 'bvl_gst_invoices', 'idx_bvl_invoices_order', 'order_id');
    await this.ensureIndex(conn, 'bvl_gst_credit_notes', 'idx_bvl_cn_order', 'order_id');
    await this.ensureIndex(conn, 'bvl_audit_logs', 'idx_bvl_audit_created', 'created_at');
  }

  // ==========================================
  // LOAD & SAVE STATE SNAPSHOT + ALL 21 NORMALIZED TABLES
  // ==========================================

  /**
   * Hydrates DatabaseState from bvl_app_state AND reconciles normalized relational rows
   * so startup state preserves patron credentials, granular admin roles, soft-deleted customers,
   * corporate lead items, ticket phones, BOM stock, invoices, credit notes, and config accurately.
   */
  public async loadStateSnapshot(): Promise<any | null> {
    if (!this.isConnected()) return null;
    try {
      const [appRows]: any = await this.pool!.query(
        'SELECT state_json FROM bvl_app_state WHERE state_key = ?',
        ['primary_store_state']
      );

      let baseState: any = null;
      if (appRows && appRows.length > 0 && appRows[0].state_json) {
        baseState = JSON.parse(appRows[0].state_json);
      }

      const [
        [cfgRows],
        [adminRows],
        [patronCredRows],
        [custRows],
        [addrRows],
        [invRows],
        [bomRows],
        [ordRows],
        [hsvRows],
        [warRows],
        [ckRows],
        [leadRows],
        [tktRows],
        [cartRows],
        [gstInvRows],
        [cnRows],
        [auditRows],
        [webhookRows]
      ]: any = await Promise.all([
        this.pool!.query('SELECT * FROM bvl_store_config'),
        this.pool!.query('SELECT * FROM bvl_admin_users'),
        this.pool!.query('SELECT * FROM bvl_patron_credentials'),
        this.pool!.query('SELECT * FROM bvl_customers'),
        this.pool!.query('SELECT * FROM bvl_customer_addresses'),
        this.pool!.query('SELECT * FROM bvl_inventory'),
        this.pool!.query('SELECT * FROM bvl_bill_of_materials'),
        this.pool!.query('SELECT * FROM bvl_orders ORDER BY created_at DESC'),
        this.pool!.query('SELECT * FROM bvl_hot_stamping_vectors ORDER BY recorded_at DESC'),
        this.pool!.query('SELECT * FROM bvl_warranties'),
        this.pool!.query('SELECT * FROM bvl_care_kits'),
        this.pool!.query('SELECT * FROM bvl_corporate_leads ORDER BY created_at DESC'),
        this.pool!.query('SELECT * FROM bvl_support_tickets ORDER BY created_at DESC'),
        this.pool!.query('SELECT * FROM bvl_carts'),
        this.pool!.query('SELECT * FROM bvl_gst_invoices'),
        this.pool!.query('SELECT * FROM bvl_gst_credit_notes'),
        this.pool!.query('SELECT * FROM bvl_audit_logs ORDER BY created_at DESC LIMIT 500'),
        this.pool!.query('SELECT event_id FROM bvl_webhook_events')
      ]);

      const hasAnyNormalizedData =
        (cfgRows && cfgRows.length > 0) ||
        (adminRows && adminRows.length > 0) ||
        (custRows && custRows.length > 0) ||
        (invRows && invRows.length > 0);

      if (!baseState && !hasAnyNormalizedData) {
        return null;
      }

      const hydrated: any = baseState ? { ...baseState } : {};

      if (cfgRows && cfgRows.length > 0) {
        const cfgRow = cfgRows[0];
        const prevCfg = hydrated.config || {};
        const adminCredsFromNorm =
          adminRows && adminRows.length > 0
            ? adminRows.map((a: any) => ({
                userId: a.user_id,
                displayName: a.display_name,
                role: a.is_master ? 'STORE_MANAGER' : a.role || 'STORE_MANAGER',
                passwordHash: a.password_hash || '',
                addedBy: a.added_by || 'system',
                addedAt: toIsoString(a.added_at),
                isMaster: Boolean(a.is_master)
              }))
            : prevCfg.adminCredentials || [];

        const parsedMaster = safeJsonParse<string[]>(cfgRow.master_super_admins_json, prevCfg.masterSuperAdmins || []);
        const parsedPermitted = safeJsonParse<string[]>(
          cfgRow.permitted_store_managers_json,
          prevCfg.permittedStoreManagers || adminCredsFromNorm.map((a: any) => a.userId)
        );

        hydrated.config = {
          ...prevCfg,
          id: cfgRow.id,
          gstInvoicingEnabled: Boolean(cfgRow.gst_invoicing_enabled),
          masterSuperAdmins: parsedMaster,
          permittedStoreManagers: parsedPermitted,
          adminCredentials: adminCredsFromNorm,
          abandonmentThresholdMinutes: Number(cfgRow.abandonment_threshold_minutes ?? 15),
          primaryHubCity: cfgRow.primary_hub_city || 'Pune',
          supplierGstin: cfgRow.supplier_gstin || '27AABCB1234F1Z8',
          gstRatePercent: Number(cfgRow.gst_rate_percent ?? 18),
          promoCodes: safeJsonParse(cfgRow.promo_codes_json, prevCfg.promoCodes || []),
          updatedAt: toIsoString(cfgRow.updated_at),
          lastUpdatedBy: cfgRow.last_updated_by || 'system'
        };
      } else if (adminRows && adminRows.length > 0 && hydrated.config) {
        hydrated.config.adminCredentials = adminRows.map((a: any) => ({
          userId: a.user_id,
          displayName: a.display_name,
          role: a.is_master ? 'STORE_MANAGER' : a.role || 'STORE_MANAGER',
          passwordHash: a.password_hash || '',
          addedBy: a.added_by || 'system',
          addedAt: toIsoString(a.added_at),
          isMaster: Boolean(a.is_master)
        }));
      }

      if (patronCredRows && patronCredRows.length > 0) {
        const credsMap: Record<string, any> = { ...(hydrated.patronCredentials || {}) };
        for (const row of patronCredRows) {
          const email = String(row.email).trim().toLowerCase();
          credsMap[email] = {
            email,
            passwordHash: row.password_hash,
            updatedAt: toIsoString(row.updated_at)
          };
        }
        hydrated.patronCredentials = credsMap;
      }

      if (custRows && custRows.length > 0) {
        const prevById = new Map<string, any>(
          (Array.isArray(hydrated.customers) ? hydrated.customers : []).map((c: any) => [c.id, c])
        );
        hydrated.customers = custRows.map((c: any) => {
          const fallback = prevById.get(c.id) || {};
          return {
            ...fallback,
            id: c.id,
            ...(c.identity_uid ? { identityUid: c.identity_uid } : {}),
            email: c.email,
            phone: c.phone || '',
            fullName: c.full_name,
            role: c.role || 'PATRON',
            totalOrders: Number(c.total_orders ?? 0),
            lifetimeValue: Number(c.lifetime_value ?? 0),
            averageOrderValue: Number(c.average_order_value ?? fallback.averageOrderValue ?? 0),
            refundRate: Number(c.refund_rate ?? fallback.refundRate ?? 0),
            daysSinceLastOrder: Number(c.days_since_last_order ?? fallback.daysSinceLastOrder ?? 0),
            ...(c.last_order_date ? { lastOrderDate: toIsoString(c.last_order_date) } : {}),
            rfmSegment: c.rfm_segment || 'Promising/Recent',
            rfmScore: safeJsonParse(c.rfm_score_json, fallback.rfmScore || { recency: 3, frequency: 1, monetary: 1 }),
            discountOrdersCount: Number(c.discount_orders_count ?? fallback.discountOrdersCount ?? 0),
            loyaltyPoints: Number(c.loyalty_points ?? 0),
            storeCreditBalance: Number(c.store_credit_balance ?? 0),
            tags: safeJsonParse(c.tags_json, fallback.tags || []),
            ...(c.utm_source ? { utmSource: c.utm_source } : {}),
            ...(c.utm_medium ? { utmMedium: c.utm_medium } : {}),
            acquisitionCost: Number(c.acquisition_cost ?? fallback.acquisitionCost ?? 0),
            isActive: c.is_active === 0 ? false : true,
            deletedAt: c.deleted_at ? toIsoString(c.deleted_at) : null,
            createdAt: toIsoString(c.created_at),
            updatedAt: toIsoString(c.updated_at)
          };
        });
      }

      if (addrRows && addrRows.length > 0) {
        hydrated.addresses = addrRows.map((a: any) => ({
          id: a.id,
          customerId: a.customer_id,
          ...(a.recipient_name ? { recipientName: a.recipient_name } : {}),
          ...(a.phone ? { phone: a.phone } : {}),
          street: a.street,
          city: a.city,
          state: a.state,
          pincode: a.pincode,
          country: a.country || 'India',
          isDefault: Boolean(a.is_default),
          addressType: a.address_type === 'BILLING' ? 'BILLING' : 'SHIPPING',
          ...(a.created_at ? { createdAt: toIsoString(a.created_at) } : {}),
          ...(a.updated_at ? { updatedAt: toIsoString(a.updated_at) } : {})
        }));
      }

      if (Array.isArray(hydrated.customers) && Array.isArray(hydrated.addresses)) {
        const addrByCust = new Map<string, any[]>();
        for (const a of hydrated.addresses) {
          const list = addrByCust.get(a.customerId) || [];
          list.push(a);
          addrByCust.set(a.customerId, list);
        }
        hydrated.customers = hydrated.customers.map((c: any) => {
          const custAddrs = addrByCust.get(c.id) || c.addresses || [];
          const defAddr = custAddrs.find((a: any) => a.isDefault) || custAddrs[0];
          return {
            ...c,
            ...(defAddr
              ? {
                  phone: c.phone || defAddr.phone || '',
                  address: defAddr.street,
                  city: defAddr.city,
                  state: defAddr.state,
                  pincode: defAddr.pincode
                }
              : {}),
            addresses: custAddrs
          };
        });
      }

      if (invRows && invRows.length > 0) {
        hydrated.inventory = invRows.map((i: any) => ({
          id: i.id || `inv_${String(i.sku).toLowerCase()}`,
          productId: i.product_id,
          sku: i.sku,
          name: i.name,
          category: i.category,
          stockByLocation: {
            punePrimaryHub: Number(i.pune_primary_hub ?? 0),
            mumbaiWarehouse: Number(i.mumbai_warehouse ?? 0)
          },
          safetyStock: Number(i.safety_stock ?? 5),
          reorderPoint: Number(i.reorder_point ?? 10),
          unitCost: Number(i.unit_cost ?? 0),
          sellingPrice: Number(i.selling_price ?? 0),
          batchLotNumber: i.batch_lot_number || '',
          leadTimeDays: Number(i.lead_time_days ?? 7)
        }));
      }

      if (bomRows && bomRows.length > 0) {
        hydrated.billOfMaterials = bomRows.map((b: any) => ({
          id: b.id,
          parentSku: b.parent_sku,
          materialName: b.material_name,
          quantityPerUnit: Number(b.quantity_per_unit),
          unit: b.unit,
          inventoryOnHand: Number(b.inventory_on_hand),
          safetyStock: Number(b.safety_stock ?? 20),
          vendorName: b.vendor_name
        }));
      }

      if (ordRows && ordRows.length > 0) {
        const prevById = new Map<string, any>(
          (Array.isArray(hydrated.orders) ? hydrated.orders : []).map((o: any) => [o.id, o])
        );
        hydrated.orders = ordRows.map((o: any) => {
          const fallback = prevById.get(o.id) || {};
          return {
            ...fallback,
            id: o.id,
            orderNumber: o.order_number,
            customerId: o.customer_id,
            customerName: o.customer_name || fallback.customerName || 'Valued Patron',
            customerEmail: o.customer_email,
            customerPhone: o.customer_phone ?? fallback.customerPhone ?? '',
            status: o.status,
            currency: o.currency || 'INR',
            subtotal: Number(o.subtotal),
            discountAmount: Number(o.discount_amount ?? 0),
            ...(o.discount_code ? { discountCode: o.discount_code } : {}),
            taxAmount: Number(o.tax_amount),
            shippingFee: Number(o.shipping_fee ?? 0),
            totalAmount: Number(o.total_amount),
            paymentGateway: o.payment_gateway,
            ...(o.payment_id ? { paymentId: o.payment_id } : {}),
            paymentStatus: o.payment_status,
            items: safeJsonParse(o.items_json, fallback.items || []),
            shippingAddress: safeJsonParse(o.shipping_address_json, fallback.shippingAddress || {}),
            billingAddress: safeJsonParse(o.billing_address_json, fallback.billingAddress || {}),
            ...(o.awb_number ? { awbNumber: o.awb_number } : {}),
            ...(o.courier_partner ? { courierPartner: o.courier_partner } : {}),
            ...(o.courier_status ? { courierStatus: o.courier_status } : {}),
            ...(o.estimated_delivery_date ? { estimatedDeliveryDate: toIsoString(o.estimated_delivery_date) } : {}),
            ...(o.invoice_number ? { invoiceNumber: o.invoice_number } : {}),
            isGstInvoiceGenerated: Boolean(o.is_gst_invoice_generated ?? Boolean(o.invoice_number)),
            createdAt: toIsoString(o.created_at),
            updatedAt: toIsoString(o.updated_at, toIsoString(o.created_at))
          };
        });
      }

      if (hsvRows && hsvRows.length > 0) {
        hydrated.hotStampingVectors = hsvRows.map((h: any) => ({
          id: h.id,
          customerId: h.customer_id,
          ...(h.order_id ? { orderId: h.order_id } : {}),
          productId: h.product_id,
          productName: h.product_name,
          monogramText: h.monogram_text,
          foilStyle: h.foil_style,
          fontFamily: h.font_family,
          ...(h.preview_image_url ? { previewImageUrl: h.preview_image_url } : {}),
          recordedAt: toIsoString(h.recorded_at)
        }));
      }

      if (warRows && warRows.length > 0) {
        hydrated.warranties = warRows.map((w: any) => ({
          id: w.id,
          customerId: w.customer_id,
          customerName: w.customer_name,
          orderId: w.order_id,
          productId: w.product_id,
          productName: w.product_name,
          hardwareSerial: w.hardware_serial,
          warrantyPeriodYears: Number(w.warranty_period_years),
          startDate: toIsoString(w.start_date),
          expiryDate: toIsoString(w.expiry_date),
          status: w.status,
          claimCount: Number(w.claim_count),
          createdAt: toIsoString(w.created_at)
        }));
      }

      if (ckRows && ckRows.length > 0) {
        hydrated.careKitDispatches = ckRows.map((c: any) => ({
          id: c.id,
          customerId: c.customer_id,
          orderId: c.order_id,
          kitType: c.kit_type,
          dispatchDate: toIsoString(c.dispatch_date),
          awbNumber: c.awb_number,
          courier: c.courier,
          status: c.status,
          digitalGuideSent: Boolean(c.digital_guide_sent)
        }));
      }

      if (leadRows && leadRows.length > 0) {
        hydrated.corporateGiftingLeads = leadRows.map((l: any) => {
          const parsedItems = l.items_json ? safeJsonParse<any[] | undefined>(l.items_json, undefined) : undefined;
          return {
            id: l.id,
            companyName: l.company_name,
            contactPerson: l.contact_person,
            email: l.email,
            phone: l.phone || '',
            estimatedQuantity: Number(l.estimated_quantity),
            budgetRangeInr: l.budget_range_inr || '',
            interestCategory: l.interest_category,
            status: l.status,
            ...(l.swatch_kit_awb ? { swatchKitAwb: l.swatch_kit_awb } : {}),
            ...(Array.isArray(parsedItems) && parsedItems.length > 0 ? { items: parsedItems } : {}),
            ...(l.erp_order_id ? { erpOrderId: l.erp_order_id } : {}),
            ...(l.erp_order_number ? { erpOrderNumber: l.erp_order_number } : {}),
            notes: l.notes || '',
            ...(l.deal_value_inr !== null && l.deal_value_inr !== undefined
              ? { dealValueInr: Number(l.deal_value_inr) }
              : {}),
            createdAt: toIsoString(l.created_at)
          };
        });
      }

      if (tktRows && tktRows.length > 0) {
        hydrated.supportTickets = tktRows.map((t: any) => ({
          id: t.id,
          ticketNumber: t.ticket_number,
          customerId: t.customer_id,
          customerName: t.customer_name,
          customerEmail: t.customer_email,
          ...(t.customer_phone ? { customerPhone: t.customer_phone } : {}),
          channel: t.channel,
          subject: t.subject,
          category: t.category,
          priority: t.priority,
          status: t.status,
          ...(t.assigned_to ? { assignedTo: t.assigned_to } : {}),
          slaBreachHours: Number(t.sla_breach_hours),
          createdAt: toIsoString(t.created_at),
          updatedAt: toIsoString(t.updated_at),
          messages: safeJsonParse(t.messages_json, [])
        }));
      }

      if (cartRows && cartRows.length > 0) {
        hydrated.carts = cartRows.map((c: any) => ({
          id: c.id,
          ...(c.customer_id ? { customerId: c.customer_id } : {}),
          email: c.email,
          ...(c.phone ? { phone: c.phone } : {}),
          items: safeJsonParse(c.items_json, []),
          subtotal: Number(c.subtotal),
          currency: c.currency || 'INR',
          isAbandoned: Boolean(c.is_abandoned),
          ...(c.abandoned_at ? { abandonedAt: toIsoString(c.abandoned_at) } : {}),
          recoveryStage: c.recovery_stage,
          recoveryAttempts: Number(c.recovery_attempts),
          ...(c.last_recovery_trigger_at
            ? { lastRecoveryTriggerAt: toIsoString(c.last_recovery_trigger_at) }
            : {}),
          checkoutUrl: c.checkout_url,
          lastActiveAt: toIsoString(c.last_active_at)
        }));
      }

      if (gstInvRows && gstInvRows.length > 0) {
        hydrated.gstInvoices = gstInvRows.map((i: any) => ({
          id: i.id,
          invoiceNumber: i.invoice_number,
          orderId: i.order_id,
          customerId: i.customer_id,
          ...(i.customer_gstin ? { customerGstin: i.customer_gstin } : {}),
          supplierGstin: i.supplier_gstin,
          invoiceDate: toIsoString(i.invoice_date),
          supplyState: i.supply_state,
          placeOfSupply: i.place_of_supply,
          isInterState: Boolean(i.is_inter_state),
          taxableValue: Number(i.taxable_value),
          cgstAmount: Number(i.cgst_amount),
          sgstAmount: Number(i.sgst_amount),
          igstAmount: Number(i.igst_amount),
          totalInvoiceAmount: Number(i.total_invoice_amount),
          status: i.status,
          ...(i.pdf_url ? { pdfUrl: i.pdf_url } : {})
        }));
      }

      if (cnRows && cnRows.length > 0) {
        hydrated.gstCreditNotes = cnRows.map((cn: any) => ({
          id: cn.id,
          creditNoteNumber: cn.credit_note_number,
          originalInvoiceNumber: cn.original_invoice_number,
          orderId: cn.order_id,
          reason: cn.reason,
          taxableValue: Number(cn.taxable_value),
          cgstAmount: Number(cn.cgst_amount),
          sgstAmount: Number(cn.sgst_amount),
          igstAmount: Number(cn.igst_amount),
          totalCreditAmount: Number(cn.total_credit_amount),
          issuedAt: toIsoString(cn.issued_at)
        }));
      }

      if (auditRows && auditRows.length > 0) {
        hydrated.auditLogs = auditRows.map((a: any) => ({
          id: a.id,
          actorEmail: a.actor_email,
          action: a.action,
          category: a.category,
          details: a.details,
          timestamp: toIsoString(a.created_at),
          ...(a.ip_address ? { ipAddress: a.ip_address } : {})
        }));
      }

      if (webhookRows && webhookRows.length > 0) {
        hydrated.processedWebhookIds = webhookRows.map((w: any) => w.event_id);
      }

      return hydrated;
    } catch (err: any) {
      this.lastError = err.message;
      throw new Error(`MySQL state hydration failed: ${err.message}`);
    }
  }

  /**
   * Builds ordered SQL statements to synchronize bvl_app_state and all 20 normalized
   * relational tables inside a single MySQL transaction (with empty-array & identity safety guards).
   */
  public async syncStateWithConnection(conn: mysql.PoolConnection, state: any): Promise<void> {
    // 1. Atomic JSON Snapshot
    const json = JSON.stringify(state);
    await conn.query(
      `INSERT INTO bvl_app_state (state_key, state_json) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE state_json = VALUES(state_json)`,
      ['primary_store_state', json]
    );

    // 2. Normalized Store Operational Configuration
    if (state.config) {
      const cfg = state.config;
      await conn.query(
        `INSERT INTO bvl_store_config
           (id, gst_invoicing_enabled, abandonment_threshold_minutes, primary_hub_city, supplier_gstin, gst_rate_percent, promo_codes_json, master_super_admins_json, permitted_store_managers_json, updated_at, last_updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           gst_invoicing_enabled = VALUES(gst_invoicing_enabled),
           abandonment_threshold_minutes = VALUES(abandonment_threshold_minutes),
           primary_hub_city = VALUES(primary_hub_city),
           supplier_gstin = VALUES(supplier_gstin),
           gst_rate_percent = VALUES(gst_rate_percent),
           promo_codes_json = VALUES(promo_codes_json),
           master_super_admins_json = VALUES(master_super_admins_json),
           permitted_store_managers_json = VALUES(permitted_store_managers_json),
           updated_at = VALUES(updated_at),
           last_updated_by = VALUES(last_updated_by)`,
        [
          cfg.id || 'cfg_bvl_01',
          cfg.gstInvoicingEnabled !== false ? 1 : 0,
          cfg.abandonmentThresholdMinutes ?? 15,
          cfg.primaryHubCity || 'Pune',
          cfg.supplierGstin || '27AABCB1234F1Z8',
          cfg.gstRatePercent ?? 18,
          JSON.stringify(cfg.promoCodes || []),
          JSON.stringify(cfg.masterSuperAdmins || []),
          JSON.stringify(cfg.permittedStoreManagers || []),
          toMySQLDate(cfg.updatedAt),
          cfg.lastUpdatedBy || 'system'
        ]
      );
    }

    // 3. Normalized Inventory (upsert + guarded cleanup of deleted catalog SKUs)
    const inventoryList = Array.isArray(state.inventory) ? state.inventory : [];
    for (const inv of inventoryList) {
      await conn.query(
        `INSERT INTO bvl_inventory (sku, id, product_id, name, category, pune_primary_hub, mumbai_warehouse, safety_stock, reorder_point, unit_cost, selling_price, batch_lot_number, lead_time_days)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           id = VALUES(id),
           product_id = VALUES(product_id),
           name = VALUES(name),
           category = VALUES(category),
           pune_primary_hub = VALUES(pune_primary_hub),
           mumbai_warehouse = VALUES(mumbai_warehouse),
           safety_stock = VALUES(safety_stock),
           reorder_point = VALUES(reorder_point),
           unit_cost = VALUES(unit_cost),
           selling_price = VALUES(selling_price),
           batch_lot_number = VALUES(batch_lot_number),
           lead_time_days = VALUES(lead_time_days)`,
        [
          inv.sku,
          inv.id || `inv_${String(inv.sku).toLowerCase()}`,
          inv.productId,
          inv.name,
          inv.category,
          inv.stockByLocation?.punePrimaryHub ?? 0,
          inv.stockByLocation?.mumbaiWarehouse ?? 0,
          inv.safetyStock ?? 5,
          inv.reorderPoint ?? 10,
          inv.unitCost ?? 0,
          inv.sellingPrice ?? 0,
          inv.batchLotNumber || '',
          inv.leadTimeDays ?? 7
        ]
      );
    }
    const activeSkus = inventoryList.map((i: any) => i.sku).filter(Boolean);
    if (activeSkus.length > 0) {
      await conn.query(`DELETE FROM bvl_inventory WHERE sku NOT IN (${makePlaceholders(activeSkus.length)})`, activeSkus);
    }

    // 4. Normalized Admin User IDs (Targeted upsert ONLY; never full-table DELETE ... NOT IN)
    const adminList = state.config && Array.isArray(state.config.adminCredentials) ? state.config.adminCredentials : [];
    for (const adm of adminList) {
      await conn.query(
        `INSERT INTO bvl_admin_users (user_id, display_name, role, password_hash, is_master, added_by, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           display_name = VALUES(display_name),
           role = VALUES(role),
           password_hash = VALUES(password_hash),
           is_master = VALUES(is_master),
           added_by = VALUES(added_by)`,
        [
          adm.userId,
          adm.displayName,
          adm.isMaster ? 'STORE_MANAGER' : adm.role || 'STORE_MANAGER',
          adm.passwordHash || '',
          adm.isMaster ? 1 : 0,
          adm.addedBy || 'system',
          toMySQLDate(adm.addedAt)
        ]
      );
    }

    // 5. Normalized Patron Password Hashes (Upsert ONLY)
    const patronCreds = state.patronCredentials && typeof state.patronCredentials === 'object'
      ? Object.values(state.patronCredentials) as Array<any>
      : [];
    for (const pCred of patronCreds) {
      if (!pCred?.email || !pCred?.passwordHash) continue;
      await conn.query(
        `INSERT INTO bvl_patron_credentials (email, password_hash, updated_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           password_hash = VALUES(password_hash),
           updated_at = VALUES(updated_at)`,
        [String(pCred.email).trim().toLowerCase(), pCred.passwordHash, toMySQLDate(pCred.updatedAt)]
      );
    }

    // 6. Normalized Customers (Targeted upsert ONLY with soft-delete flags; never DELETE ... NOT IN)
    const customerList = Array.isArray(state.customers) ? state.customers : [];
    for (const cust of customerList) {
      await conn.query(
        `INSERT INTO bvl_customers (
           id, identity_uid, email, phone, full_name, role, total_orders, lifetime_value,
           average_order_value, refund_rate, days_since_last_order, last_order_date,
           rfm_segment, rfm_score_json, discount_orders_count, loyalty_points,
           store_credit_balance, tags_json, utm_source, utm_medium, acquisition_cost,
           is_active, deleted_at, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           identity_uid = VALUES(identity_uid),
           email = VALUES(email),
           phone = VALUES(phone),
           full_name = VALUES(full_name),
           role = VALUES(role),
           total_orders = VALUES(total_orders),
           lifetime_value = VALUES(lifetime_value),
           average_order_value = VALUES(average_order_value),
           refund_rate = VALUES(refund_rate),
           days_since_last_order = VALUES(days_since_last_order),
           last_order_date = VALUES(last_order_date),
           rfm_segment = VALUES(rfm_segment),
           rfm_score_json = VALUES(rfm_score_json),
           discount_orders_count = VALUES(discount_orders_count),
           loyalty_points = VALUES(loyalty_points),
           store_credit_balance = VALUES(store_credit_balance),
           tags_json = VALUES(tags_json),
           utm_source = VALUES(utm_source),
           utm_medium = VALUES(utm_medium),
           acquisition_cost = VALUES(acquisition_cost),
           is_active = VALUES(is_active),
           deleted_at = VALUES(deleted_at),
           updated_at = VALUES(updated_at)`,
        [
          cust.id,
          cust.identityUid || null,
          cust.email,
          cust.phone || '',
          cust.fullName,
          cust.role || 'PATRON',
          cust.totalOrders ?? 0,
          cust.lifetimeValue ?? 0,
          cust.averageOrderValue ?? 0,
          cust.refundRate ?? 0,
          cust.daysSinceLastOrder ?? 0,
          cust.lastOrderDate ? toMySQLDate(cust.lastOrderDate) : null,
          cust.rfmSegment || 'Promising/Recent',
          JSON.stringify(cust.rfmScore || { recency: 3, frequency: 1, monetary: 1 }),
          cust.discountOrdersCount ?? 0,
          cust.loyaltyPoints ?? 0,
          cust.storeCreditBalance ?? 0,
          JSON.stringify(cust.tags || []),
          cust.utmSource || null,
          cust.utmMedium || null,
          cust.acquisitionCost ?? 0,
          cust.isActive === false ? 0 : 1,
          cust.deletedAt ? toMySQLDate(cust.deletedAt) : null,
          toMySQLDate(cust.createdAt),
          toMySQLDate(cust.updatedAt)
        ]
      );
    }

    // 7. Normalized Customer Addresses
    const addressList = Array.isArray(state.addresses) ? state.addresses : [];
    const customerIdsInState = new Set(customerList.map((c: any) => c.id));
    for (const addr of addressList) {
      if (customerList.length > 0 && !customerIdsInState.has(addr.customerId)) continue;
      await conn.query(
        `INSERT INTO bvl_customer_addresses (id, customer_id, recipient_name, phone, street, city, state, pincode, country, is_default, address_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           recipient_name = VALUES(recipient_name),
           phone = VALUES(phone),
           street = VALUES(street),
           city = VALUES(city),
           state = VALUES(state),
           pincode = VALUES(pincode),
           country = VALUES(country),
           is_default = VALUES(is_default),
           address_type = VALUES(address_type),
           updated_at = VALUES(updated_at)`,
        [
          addr.id,
          addr.customerId,
          addr.recipientName || '',
          addr.phone || '',
          addr.street || '',
          addr.city || '',
          addr.state || '',
          addr.pincode || '',
          addr.country || 'India',
          addr.isDefault ? 1 : 0,
          addr.addressType === 'BILLING' ? 'BILLING' : 'SHIPPING',
          toMySQLDate(addr.createdAt),
          toMySQLDate(addr.updatedAt)
        ]
      );
    }

    // 8. Normalized Bill of Materials Raw Inputs
    const bomList = Array.isArray(state.billOfMaterials) ? state.billOfMaterials : [];
    for (const bom of bomList) {
      await conn.query(
        `INSERT INTO bvl_bill_of_materials (id, parent_sku, material_name, quantity_per_unit, unit, inventory_on_hand, safety_stock, vendor_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           parent_sku = VALUES(parent_sku),
           material_name = VALUES(material_name),
           quantity_per_unit = VALUES(quantity_per_unit),
           unit = VALUES(unit),
           inventory_on_hand = VALUES(inventory_on_hand),
           safety_stock = VALUES(safety_stock),
           vendor_name = VALUES(vendor_name)`,
        [
          bom.id,
          bom.parentSku,
          bom.materialName,
          bom.quantityPerUnit ?? 1,
          bom.unit || 'PIECES',
          bom.inventoryOnHand ?? 0,
          bom.safetyStock ?? 20,
          bom.vendorName || ''
        ]
      );
    }

    // 9. Normalized Orders (upsert + guarded cleanup only when incoming array is non-empty)
    const orderList = Array.isArray(state.orders) ? state.orders : [];
    for (const ord of orderList) {
      await conn.query(
        `INSERT INTO bvl_orders (
           id, order_number, customer_id, customer_name, customer_email, customer_phone,
           status, currency, subtotal, discount_amount, discount_code, tax_amount, shipping_fee,
           total_amount, payment_gateway, payment_id, payment_status, items_json,
           shipping_address_json, billing_address_json, awb_number, courier_partner,
           courier_status, estimated_delivery_date, invoice_number, is_gst_invoice_generated,
           created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           customer_name = VALUES(customer_name),
           customer_email = VALUES(customer_email),
           customer_phone = VALUES(customer_phone),
           status = VALUES(status),
           subtotal = VALUES(subtotal),
           discount_amount = VALUES(discount_amount),
           discount_code = VALUES(discount_code),
           tax_amount = VALUES(tax_amount),
           shipping_fee = VALUES(shipping_fee),
           total_amount = VALUES(total_amount),
           payment_gateway = VALUES(payment_gateway),
           payment_id = VALUES(payment_id),
           payment_status = VALUES(payment_status),
           items_json = VALUES(items_json),
           shipping_address_json = VALUES(shipping_address_json),
           billing_address_json = VALUES(billing_address_json),
           awb_number = VALUES(awb_number),
           courier_partner = VALUES(courier_partner),
           courier_status = VALUES(courier_status),
           estimated_delivery_date = VALUES(estimated_delivery_date),
           invoice_number = VALUES(invoice_number),
           is_gst_invoice_generated = VALUES(is_gst_invoice_generated),
           updated_at = VALUES(updated_at)`,
        [
          ord.id,
          ord.orderNumber,
          ord.customerId,
          ord.customerName || 'Valued Patron',
          ord.customerEmail,
          ord.customerPhone || '',
          ord.status || 'PROCESSING',
          ord.currency || 'INR',
          ord.subtotal ?? 0,
          ord.discountAmount ?? 0,
          ord.discountCode || null,
          ord.taxAmount ?? 0,
          ord.shippingFee ?? 0,
          ord.totalAmount ?? 0,
          ord.paymentGateway || 'RAZORPAY',
          ord.paymentId || null,
          ord.paymentStatus || 'PAID',
          JSON.stringify(ord.items || []),
          JSON.stringify(ord.shippingAddress || {}),
          JSON.stringify(ord.billingAddress || {}),
          ord.awbNumber || null,
          ord.courierPartner || null,
          ord.courierStatus || null,
          ord.estimatedDeliveryDate ? toMySQLDate(ord.estimatedDeliveryDate) : null,
          ord.invoiceNumber || null,
          ord.isGstInvoiceGenerated ? 1 : 0,
          toMySQLDate(ord.createdAt),
          toMySQLDate(ord.updatedAt || ord.createdAt)
        ]
      );
    }
    const activeOrderIds = orderList.map((o: any) => o.id).filter(Boolean);
    if (activeOrderIds.length > 0) {
      await conn.query(
        `DELETE FROM bvl_orders WHERE id NOT IN (${makePlaceholders(activeOrderIds.length)})`,
        activeOrderIds
      );
    }

    // 10. Normalized Hot-Stamping Vectors
    const hsvList = Array.isArray(state.hotStampingVectors) ? state.hotStampingVectors : [];
    for (const hsv of hsvList) {
      await conn.query(
        `INSERT INTO bvl_hot_stamping_vectors
           (id, customer_id, order_id, product_id, product_name, monogram_text, foil_style, font_family, preview_image_url, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           order_id = VALUES(order_id),
           monogram_text = VALUES(monogram_text),
           foil_style = VALUES(foil_style),
           font_family = VALUES(font_family),
           preview_image_url = VALUES(preview_image_url)`,
        [
          hsv.id,
          hsv.customerId,
          hsv.orderId || null,
          hsv.productId,
          hsv.productName || '',
          hsv.monogramText || '',
          hsv.foilStyle || 'GOLD_FOIL',
          hsv.fontFamily || 'CINZEL',
          hsv.previewImageUrl || null,
          toMySQLDate(hsv.recordedAt)
        ]
      );
    }

    // 11. Normalized Warranties
    const warrantyList = Array.isArray(state.warranties) ? state.warranties : [];
    for (const w of warrantyList) {
      await conn.query(
        `INSERT INTO bvl_warranties
           (id, customer_id, customer_name, order_id, product_id, product_name, hardware_serial, warranty_period_years, start_date, expiry_date, status, claim_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           claim_count = VALUES(claim_count)`,
        [
          w.id,
          w.customerId,
          w.customerName || '',
          w.orderId,
          w.productId,
          w.productName || '',
          w.hardwareSerial || '',
          w.warrantyPeriodYears ?? 2,
          toMySQLDate(w.startDate),
          toMySQLDate(w.expiryDate),
          w.status || 'ACTIVE',
          w.claimCount ?? 0,
          toMySQLDate(w.createdAt)
        ]
      );
    }

    // 12. Normalized Care Kits
    const careKitList = Array.isArray(state.careKitDispatches) ? state.careKitDispatches : [];
    for (const ck of careKitList) {
      await conn.query(
        `INSERT INTO bvl_care_kits
           (id, customer_id, order_id, kit_type, dispatch_date, awb_number, courier, status, digital_guide_sent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           awb_number = VALUES(awb_number),
           courier = VALUES(courier),
           status = VALUES(status),
           digital_guide_sent = VALUES(digital_guide_sent)`,
        [
          ck.id,
          ck.customerId,
          ck.orderId,
          ck.kitType || 'ORGANIC_BEESWAX_BALM_BRUSH',
          toMySQLDate(ck.dispatchDate),
          ck.awbNumber || '',
          ck.courier || 'SHIPROCKET',
          ck.status || 'DISPATCHED',
          ck.digitalGuideSent !== false ? 1 : 0
        ]
      );
    }

    // 13. Normalized Corporate Gifting Leads (includes items_json, erp_order_id, erp_order_number)
    const leadList = Array.isArray(state.corporateGiftingLeads) ? state.corporateGiftingLeads : [];
    for (const lead of leadList) {
      await conn.query(
        `INSERT INTO bvl_corporate_leads
           (id, company_name, contact_person, email, phone, estimated_quantity, budget_range_inr, interest_category, status, swatch_kit_awb, items_json, erp_order_id, erp_order_number, notes, deal_value_inr, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           swatch_kit_awb = VALUES(swatch_kit_awb),
           items_json = VALUES(items_json),
           erp_order_id = VALUES(erp_order_id),
           erp_order_number = VALUES(erp_order_number),
           notes = VALUES(notes),
           deal_value_inr = VALUES(deal_value_inr)`,
        [
          lead.id,
          lead.companyName,
          lead.contactPerson,
          lead.email,
          lead.phone || '',
          lead.estimatedQuantity ?? 1,
          lead.budgetRangeInr || '',
          lead.interestCategory || 'EVERYDAY_CARRY',
          lead.status || 'NEW_LEAD',
          lead.swatchKitAwb || null,
          Array.isArray(lead.items) && lead.items.length > 0 ? JSON.stringify(lead.items) : null,
          lead.erpOrderId || null,
          lead.erpOrderNumber || null,
          lead.notes || '',
          typeof lead.dealValueInr === 'number' ? lead.dealValueInr : null,
          toMySQLDate(lead.createdAt)
        ]
      );
    }

    // 14. Normalized Support Tickets (includes customer_phone & messages_json)
    const ticketList = Array.isArray(state.supportTickets) ? state.supportTickets : [];
    for (const tkt of ticketList) {
      await conn.query(
        `INSERT INTO bvl_support_tickets
           (id, ticket_number, customer_id, customer_name, customer_email, customer_phone, channel, subject, category, priority, status, assigned_to, sla_breach_hours, messages_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           customer_phone = VALUES(customer_phone),
           priority = VALUES(priority),
           status = VALUES(status),
           assigned_to = VALUES(assigned_to),
           messages_json = VALUES(messages_json),
           updated_at = VALUES(updated_at)`,
        [
          tkt.id,
          tkt.ticketNumber,
          tkt.customerId,
          tkt.customerName,
          tkt.customerEmail,
          tkt.customerPhone || null,
          tkt.channel || 'WHATSAPP',
          tkt.subject,
          tkt.category || 'MONOGRAM_REQUEST',
          tkt.priority || 'MEDIUM',
          tkt.status || 'OPEN',
          tkt.assignedTo || null,
          tkt.slaBreachHours ?? 24,
          JSON.stringify(tkt.messages || []),
          toMySQLDate(tkt.createdAt),
          toMySQLDate(tkt.updatedAt)
        ]
      );
    }

    // 15. Normalized Carts & Recovery State
    const cartList = Array.isArray(state.carts) ? state.carts : [];
    for (const cart of cartList) {
      await conn.query(
        `INSERT INTO bvl_carts
           (id, customer_id, email, phone, items_json, subtotal, currency, is_abandoned, abandoned_at, recovery_stage, recovery_attempts, last_recovery_trigger_at, checkout_url, last_active_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           customer_id = VALUES(customer_id),
           phone = VALUES(phone),
           items_json = VALUES(items_json),
           subtotal = VALUES(subtotal),
           is_abandoned = VALUES(is_abandoned),
           abandoned_at = VALUES(abandoned_at),
           recovery_stage = VALUES(recovery_stage),
           recovery_attempts = VALUES(recovery_attempts),
           last_recovery_trigger_at = VALUES(last_recovery_trigger_at),
           checkout_url = VALUES(checkout_url),
           last_active_at = VALUES(last_active_at)`,
        [
          cart.id,
          cart.customerId || null,
          cart.email,
          cart.phone || null,
          JSON.stringify(cart.items || []),
          cart.subtotal ?? 0,
          cart.currency || 'INR',
          cart.isAbandoned ? 1 : 0,
          cart.abandonedAt ? toMySQLDate(cart.abandonedAt) : null,
          cart.recoveryStage || 'DETECTED',
          cart.recoveryAttempts ?? 0,
          cart.lastRecoveryTriggerAt ? toMySQLDate(cart.lastRecoveryTriggerAt) : null,
          cart.checkoutUrl || '',
          toMySQLDate(cart.lastActiveAt)
        ]
      );
    }

    // 16. Normalized GST Tax Invoices
    const invoiceList = Array.isArray(state.gstInvoices) ? state.gstInvoices : [];
    for (const inv of invoiceList) {
      await conn.query(
        `INSERT INTO bvl_gst_invoices
           (id, invoice_number, order_id, customer_id, customer_gstin, supplier_gstin, invoice_date, supply_state, place_of_supply, is_inter_state, taxable_value, cgst_amount, sgst_amount, igst_amount, total_invoice_amount, status, pdf_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           pdf_url = VALUES(pdf_url)`,
        [
          inv.id,
          inv.invoiceNumber,
          inv.orderId,
          inv.customerId,
          inv.customerGstin || null,
          inv.supplierGstin,
          toMySQLDate(inv.invoiceDate),
          inv.supplyState,
          inv.placeOfSupply,
          inv.isInterState ? 1 : 0,
          inv.taxableValue ?? 0,
          inv.cgstAmount ?? 0,
          inv.sgstAmount ?? 0,
          inv.igstAmount ?? 0,
          inv.totalInvoiceAmount ?? 0,
          inv.status || 'ISSUED',
          inv.pdfUrl || null
        ]
      );
    }

    // 17. Normalized GST Credit Notes
    const creditNoteList = Array.isArray(state.gstCreditNotes) ? state.gstCreditNotes : [];
    for (const cn of creditNoteList) {
      await conn.query(
        `INSERT IGNORE INTO bvl_gst_credit_notes
           (id, credit_note_number, original_invoice_number, order_id, reason, taxable_value, cgst_amount, sgst_amount, igst_amount, total_credit_amount, issued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cn.id,
          cn.creditNoteNumber,
          cn.originalInvoiceNumber,
          cn.orderId,
          cn.reason || 'GOODS_RETURN',
          cn.taxableValue ?? 0,
          cn.cgstAmount ?? 0,
          cn.sgstAmount ?? 0,
          cn.igstAmount ?? 0,
          cn.totalCreditAmount ?? 0,
          toMySQLDate(cn.issuedAt)
        ]
      );
    }

    // 18. Append-Only Audit Logs
    const auditList = Array.isArray(state.auditLogs) ? state.auditLogs : [];
    for (const log of auditList) {
      await conn.query(
        `INSERT IGNORE INTO bvl_audit_logs (id, actor_email, action, category, details, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          log.id,
          log.actorEmail || 'system',
          log.action,
          log.category,
          log.details || '',
          log.ipAddress || null,
          toMySQLDate(log.timestamp)
        ]
      );
    }

    // 19. Processed Webhook Events
    const webhookList = Array.isArray(state.processedWebhookIds) ? state.processedWebhookIds : [];
    for (const evtId of webhookList) {
      if (!evtId) continue;
      await conn.query(
        `INSERT IGNORE INTO bvl_webhook_events (event_id, processed_at) VALUES (?, ?)`,
        [evtId, new Date()]
      );
    }
  }

  /**
   * Explicitly soft-deletes a customer record in bvl_customers (is_active = 0, deleted_at = NOW())
   * to preserve historical bvl_orders and bvl_audit_logs identity references.
   */
  public async softDeleteCustomer(customerId: string, state: any): Promise<void> {
    if (!this.isConnected()) return;

    const conn = await this.pool!.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE bvl_customers SET is_active = 0, deleted_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [customerId]
      );
      await this.syncStateWithConnection(conn, state);
      await conn.commit();
      this.lastError = null;
      this.lastSyncAt = new Date().toISOString();
    } catch (err: any) {
      await conn.rollback().catch(() => {});
      this.lastError = err.message;
      throw new Error(`MySQL customer soft-delete failed: ${err.message}`);
    } finally {
      conn.release();
    }
  }

  /**
   * Explicitly hard-deletes a single delegated admin user row from bvl_admin_users
   * when invoked via the dedicated DELETE /api/admin-users/:id flow.
   */
  public async deleteAdminUser(userId: string, state: any): Promise<void> {
    if (!this.isConnected()) return;

    const conn = await this.pool!.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM bvl_admin_users WHERE user_id = ?`, [userId]);
      await this.syncStateWithConnection(conn, state);
      await conn.commit();
      this.lastError = null;
      this.lastSyncAt = new Date().toISOString();
    } catch (err: any) {
      await conn.rollback().catch(() => {});
      this.lastError = err.message;
      throw new Error(`MySQL admin user deletion failed: ${err.message}`);
    } finally {
      conn.release();
    }
  }

  public async saveStateSnapshot(state: any, connOverride?: mysql.PoolConnection): Promise<void> {
    if (!connOverride && !this.isConnected()) return;

    if (connOverride) {
      await this.syncStateWithConnection(connOverride, state);
      this.lastError = null;
      this.lastSyncAt = new Date().toISOString();
      return;
    }

    const conn = await this.pool!.getConnection();
    try {
      await conn.beginTransaction();
      await this.syncStateWithConnection(conn, state);
      await conn.commit();
      this.lastError = null;
      this.lastSyncAt = new Date().toISOString();
    } catch (err: any) {
      await conn.rollback().catch(() => {});
      this.lastError = err.message;
      console.error('[MySQL] State snapshot sync failed (rolled back):', err.message);
      throw new Error(`MySQL persistence error: ${err.message}`);
    } finally {
      conn.release();
    }
  }

  // ==========================================
  // CATALOGUE PERSISTENCE IN MYSQL
  // ==========================================

  public async loadCatalogSnapshot(): Promise<{ categories: any[]; products: any[] } | null> {
    if (!this.isConnected()) return null;
    try {
      const [catRows]: any = await this.pool!.query('SELECT * FROM bvl_catalog_categories');
      const [prodRows]: any = await this.pool!.query('SELECT * FROM bvl_catalog_products');

      if ((!catRows || catRows.length === 0) && (!prodRows || prodRows.length === 0)) {
        return null;
      }

      const categories = (catRows || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description || '',
        productTypes: safeJsonParse(row.product_types_json, [])
      }));

      const products = (prodRows || []).map((row: any) => ({
        id: row.id,
        category: row.category,
        productType: row.product_type,
        name: row.name,
        sku: row.sku,
        price: Number(row.price),
        currency: row.currency || 'INR',
        description: row.description || '',
        features: safeJsonParse(row.features_json, []),
        images: safeJsonParse(row.images_json, []),
        hsnCode: row.hsn_code || '4202',
        ...(row.gst_rate !== null && row.gst_rate !== undefined ? { gstRate: Number(row.gst_rate) } : {}),
        solutionEngine: row.solution_engine || 'EVERYDAY_CARRY',
        inStock: true,
        allowCustomization: Boolean(row.allow_customization),
        careKitIncluded: Boolean(row.care_kit_included)
      }));

      return { categories, products };
    } catch (err: any) {
      this.lastError = err.message;
      throw new Error(`MySQL catalog load failed: ${err.message}`);
    }
  }

  public async saveCatalogSnapshot(
    catalog: { categories: any[]; products: any[] },
    connOverride?: mysql.PoolConnection
  ): Promise<void> {
    if (!connOverride && !this.isConnected()) return;

    const execute = async (conn: mysql.PoolConnection) => {
      const categories = Array.isArray(catalog.categories) ? catalog.categories : [];
      for (const cat of categories) {
        await conn.query(
          `INSERT INTO bvl_catalog_categories (id, name, slug, description, product_types_json)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             slug = VALUES(slug),
             description = VALUES(description),
             product_types_json = VALUES(product_types_json)`,
          [cat.id, cat.name, cat.slug || cat.id, cat.description || '', JSON.stringify(cat.productTypes || [])]
        );
      }
      const catIds = categories.map((c: any) => c.id).filter(Boolean);
      if (catIds.length > 0) {
        await conn.query(
          `DELETE FROM bvl_catalog_categories WHERE id NOT IN (${makePlaceholders(catIds.length)})`,
          catIds
        );
      }

      const products = Array.isArray(catalog.products) ? catalog.products : [];
      for (const prod of products) {
        await conn.query(
          `INSERT INTO bvl_catalog_products (id, category, product_type, name, sku, price, currency, description, features_json, images_json, hsn_code, gst_rate, solution_engine, allow_customization, care_kit_included)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             category = VALUES(category),
             product_type = VALUES(product_type),
             name = VALUES(name),
             sku = VALUES(sku),
             price = VALUES(price),
             currency = VALUES(currency),
             description = VALUES(description),
             features_json = VALUES(features_json),
             images_json = VALUES(images_json),
             hsn_code = VALUES(hsn_code),
             gst_rate = VALUES(gst_rate),
             solution_engine = VALUES(solution_engine),
             allow_customization = VALUES(allow_customization),
             care_kit_included = VALUES(care_kit_included)`,
          [
            prod.id,
            prod.category,
            prod.productType,
            prod.name,
            prod.sku,
            prod.price ?? 0,
            prod.currency || 'INR',
            prod.description || '',
            JSON.stringify(prod.features || []),
            JSON.stringify(prod.images || []),
            prod.hsnCode || '4202',
            typeof prod.gstRate === 'number' ? prod.gstRate : null,
            prod.solutionEngine || 'EVERYDAY_CARRY',
            prod.allowCustomization !== false ? 1 : 0,
            prod.careKitIncluded !== false ? 1 : 0
          ]
        );
      }
      const prodIds = products.map((p: any) => p.id).filter(Boolean);
      if (prodIds.length > 0) {
        await conn.query(
          `DELETE FROM bvl_catalog_products WHERE id NOT IN (${makePlaceholders(prodIds.length)})`,
          prodIds
        );
      }
    };

    if (connOverride) {
      await execute(connOverride);
      this.lastError = null;
      this.lastSyncAt = new Date().toISOString();
      return;
    }

    const conn = await this.pool!.getConnection();
    try {
      await conn.beginTransaction();
      await execute(conn);
      await conn.commit();
      this.lastError = null;
      this.lastSyncAt = new Date().toISOString();
    } catch (err: any) {
      await conn.rollback().catch(() => {});
      this.lastError = err.message;
      console.error('[MySQL] Catalog snapshot sync failed (rolled back):', err.message);
      throw new Error(`MySQL catalog persistence error: ${err.message}`);
    } finally {
      conn.release();
    }
  }

  // ==========================================
  // ATOMIC ROW-LOCKED TRANSACTIONS (SELECT ... FOR UPDATE)
  // ==========================================

  /**
   * Executes a stock-mutating workflow (checkout order placement or RMA restock) inside an
   * atomic MySQL transaction with SELECT ... FOR UPDATE row locks on bvl_inventory.
   */
  public async runLockedStockTransaction<T>(
    itemsToLock: Array<{ sku?: string; productId?: string; productName?: string; quantity: number }>,
    work: (ctx: {
      lockedRows: LockedInventoryRow[];
      conn: mysql.PoolConnection | null;
    }) => Promise<{ result: T; nextState: any }>
  ): Promise<T> {
    if (!this.isConnected()) {
      const { result } = await work({ lockedRows: [], conn: null });
      return result;
    }

    const conn = await this.pool!.getConnection();
    try {
      await conn.beginTransaction();

      // Deterministic sort by SKU/productId prevents circular deadlocks under concurrent checkouts
      const sortedKeys = [...itemsToLock].sort((a, b) =>
        (a.sku || a.productId || '').localeCompare(b.sku || b.productId || '')
      );

      const lockedRows: LockedInventoryRow[] = [];
      for (const reqItem of sortedKeys) {
        const lookupSku = reqItem.sku || '';
        const lookupProdId = reqItem.productId || '';
        if (!lookupSku && !lookupProdId) continue;

        const [rows]: any = await conn.query(
          `SELECT sku, product_id, name, pune_primary_hub, mumbai_warehouse
           FROM bvl_inventory
           WHERE sku = ? OR product_id = ?
           FOR UPDATE`,
          [lookupSku, lookupProdId]
        );

        if (rows && rows.length > 0) {
          const row = rows[0];
          lockedRows.push({
            sku: row.sku,
            productId: row.product_id,
            name: row.name,
            punePrimaryHub: Number(row.pune_primary_hub),
            mumbaiWarehouse: Number(row.mumbai_warehouse)
          });
        }
      }

      const { result, nextState } = await work({ lockedRows, conn });
      await this.syncStateWithConnection(conn, nextState);
      await conn.commit();

      this.lastError = null;
      this.lastSyncAt = new Date().toISOString();
      return result;
    } catch (err: any) {
      await conn.rollback().catch(() => {});
      this.lastError = err.message;
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Executes a single-SKU inventory count adjustment inside an atomic SELECT ... FOR UPDATE transaction.
   */
  public async runLockedInventoryAdjustment<T>(
    sku: string,
    work: (ctx: { lockedRow: LockedInventoryRow | null; conn: mysql.PoolConnection | null }) => Promise<{ result: T; nextState: any }>
  ): Promise<T> {
    if (!this.isConnected()) {
      const { result } = await work({ lockedRow: null, conn: null });
      return result;
    }

    const conn = await this.pool!.getConnection();
    try {
      await conn.beginTransaction();
      const [rows]: any = await conn.query(
        `SELECT sku, product_id, name, pune_primary_hub, mumbai_warehouse
         FROM bvl_inventory
         WHERE sku = ?
         FOR UPDATE`,
        [sku]
      );

      const lockedRow: LockedInventoryRow | null =
        rows && rows.length > 0
          ? {
              sku: rows[0].sku,
              productId: rows[0].product_id,
              name: rows[0].name,
              punePrimaryHub: Number(rows[0].pune_primary_hub),
              mumbaiWarehouse: Number(rows[0].mumbai_warehouse)
            }
          : null;

      const { result, nextState } = await work({ lockedRow, conn });
      await this.syncStateWithConnection(conn, nextState);
      await conn.commit();

      this.lastError = null;
      this.lastSyncAt = new Date().toISOString();
      return result;
    } catch (err: any) {
      await conn.rollback().catch(() => {});
      this.lastError = err.message;
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Executes catalog + inventory state save atomically in one MySQL transaction when connected.
   */
  public async saveCatalogAndStateAtomic(
    catalog: { categories: any[]; products: any[] },
    state: any
  ): Promise<void> {
    if (!this.isConnected()) return;

    const conn = await this.pool!.getConnection();
    try {
      await conn.beginTransaction();
      await this.saveCatalogSnapshot(catalog, conn);
      await this.syncStateWithConnection(conn, state);
      await conn.commit();
      this.lastError = null;
      this.lastSyncAt = new Date().toISOString();
    } catch (err: any) {
      await conn.rollback().catch(() => {});
      this.lastError = err.message;
      console.error('[MySQL] Atomic catalog+state sync failed (rolled back):', err.message);
      throw new Error(`MySQL catalog persistence error: ${err.message}`);
    } finally {
      conn.release();
    }
  }
}

export const mysqlAdapter = new MySQLAdapter();
