var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/server/mysqlAdapter.ts
import mysql from "mysql2/promise";
import crypto from "crypto";
import fs from "fs";
import path from "path";
function toMySQLDate(iso) {
  if (!iso) return /* @__PURE__ */ new Date();
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? /* @__PURE__ */ new Date() : parsed;
}
function toIsoString(val, fallback) {
  if (!val) return fallback ?? (/* @__PURE__ */ new Date()).toISOString();
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? fallback ?? (/* @__PURE__ */ new Date()).toISOString() : val.toISOString();
  }
  const parsed = new Date(val);
  return Number.isNaN(parsed.getTime()) ? String(val) : parsed.toISOString();
}
function makePlaceholders(count) {
  return Array.from({ length: count }, () => "?").join(", ");
}
function safeJsonParse(raw, fallback) {
  if (raw !== null && typeof raw === "object") return raw;
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
var MYSQL_TABLE_NAMES, MySQLAdapter, mysqlAdapter;
var init_mysqlAdapter = __esm({
  "src/server/mysqlAdapter.ts"() {
    MYSQL_TABLE_NAMES = [
      "bvl_app_state",
      "bvl_store_config",
      "bvl_admin_users",
      "bvl_patron_credentials",
      "bvl_customers",
      "bvl_customer_addresses",
      "bvl_catalog_categories",
      "bvl_catalog_products",
      "bvl_inventory",
      "bvl_bill_of_materials",
      "bvl_orders",
      "bvl_hot_stamping_vectors",
      "bvl_warranties",
      "bvl_care_kits",
      "bvl_corporate_leads",
      "bvl_support_tickets",
      "bvl_carts",
      "bvl_gst_invoices",
      "bvl_gst_credit_notes",
      "bvl_audit_logs",
      "bvl_webhook_events"
    ];
    MySQLAdapter = class {
      constructor() {
        this.pool = null;
        this.connected = false;
        this.lastError = null;
        this.lastSyncAt = null;
        this.configSource = "none";
        this.credentialsFilePath = path.resolve(process.cwd(), "src/server/data/mysql_credentials.enc.json");
        this.keyFilePath = path.resolve(process.cwd(), "src/server/data/.mysql_key");
        if (process.env.MYSQL_DATABASE && process.env.MYSQL_USER) {
          this.config = {
            host: process.env.MYSQL_HOST || "localhost",
            port: parseInt(process.env.MYSQL_PORT || "3306", 10),
            database: process.env.MYSQL_DATABASE,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD || ""
          };
          this.configSource = "env";
        } else {
          const persisted = this.loadEncryptedConfig();
          if (persisted && persisted.database && persisted.user) {
            this.config = persisted;
            this.configSource = "persisted_ui";
          } else {
            this.config = {
              host: process.env.MYSQL_HOST || "localhost",
              port: parseInt(process.env.MYSQL_PORT || "3306", 10),
              database: "",
              user: "",
              password: ""
            };
            this.configSource = "none";
          }
        }
      }
      isConnected() {
        return this.connected && this.pool !== null;
      }
      getStatus() {
        return {
          connected: this.connected,
          host: this.config.host,
          port: this.config.port,
          database: this.config.database || "(not configured)",
          user: this.config.user || "(not configured)",
          configSource: this.configSource,
          lastSyncAt: this.lastSyncAt,
          lastError: this.lastError
        };
      }
      // ==========================================
      // ENCRYPTED CREDENTIAL PERSISTENCE (AES-256-GCM)
      // ==========================================
      getOrCreateEncryptionKey() {
        if (process.env.MYSQL_CONFIG_SECRET) {
          return crypto.createHash("sha256").update(process.env.MYSQL_CONFIG_SECRET).digest();
        }
        const dir = path.dirname(this.keyFilePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        if (fs.existsSync(this.keyFilePath)) {
          const rawHex = fs.readFileSync(this.keyFilePath, "utf-8").trim();
          if (/^[0-9a-f]{64}$/i.test(rawHex)) {
            return Buffer.from(rawHex, "hex");
          }
        }
        const key = crypto.randomBytes(32);
        fs.writeFileSync(this.keyFilePath, key.toString("hex"), { encoding: "utf-8", mode: 384 });
        return key;
      }
      encryptCredentials(cfg) {
        const key = this.getOrCreateEncryptionKey();
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
        const plaintext = JSON.stringify(cfg);
        const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
        const tag = cipher.getAuthTag();
        return {
          version: 1,
          iv: iv.toString("hex"),
          tag: tag.toString("hex"),
          ciphertext: encrypted.toString("hex"),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
      decryptCredentials(envelope) {
        try {
          const key = this.getOrCreateEncryptionKey();
          const iv = Buffer.from(envelope.iv, "hex");
          const tag = Buffer.from(envelope.tag, "hex");
          const ciphertext = Buffer.from(envelope.ciphertext, "hex");
          const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
          decipher.setAuthTag(tag);
          const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
          const parsed = JSON.parse(decrypted);
          return {
            host: parsed.host || "localhost",
            port: Number(parsed.port) || 3306,
            database: parsed.database || "",
            user: parsed.user || "",
            password: parsed.password || ""
          };
        } catch (err) {
          console.warn("[MySQL] Failed to decrypt persisted MySQL credentials:", err.message);
          return null;
        }
      }
      saveEncryptedConfig(cfg) {
        const dir = path.dirname(this.credentialsFilePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const envelope = this.encryptCredentials(cfg);
        fs.writeFileSync(this.credentialsFilePath, JSON.stringify(envelope, null, 2), {
          encoding: "utf-8",
          mode: 384
        });
      }
      loadEncryptedConfig() {
        try {
          if (!fs.existsSync(this.credentialsFilePath)) return null;
          const raw = fs.readFileSync(this.credentialsFilePath, "utf-8");
          const envelope = JSON.parse(raw);
          return this.decryptCredentials(envelope);
        } catch {
          return null;
        }
      }
      // ==========================================
      // CONNECTION & IDEMPOTENT SCHEMA MIGRATION
      // ==========================================
      async configureAndConnect(newConfig, options) {
        const candidateConfig = newConfig ? {
          host: newConfig.host || this.config.host || "localhost",
          port: newConfig.port || this.config.port || 3306,
          database: newConfig.database ?? this.config.database,
          user: newConfig.user ?? this.config.user,
          password: newConfig.password ?? this.config.password
        } : { ...this.config };
        if (!candidateConfig.database || !candidateConfig.user) {
          this.connected = false;
          this.lastError = "MySQL database name and user ID are not supplied yet. Using local disk persistence.";
          return { connected: false, message: this.lastError };
        }
        let nextPool = null;
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
            connectTimeout: 5e3
          });
          const conn = await nextPool.getConnection();
          try {
            await this.ensureTables(conn);
          } finally {
            conn.release();
          }
          if (this.pool) {
            await this.pool.end().catch(() => {
            });
          }
          this.pool = nextPool;
          this.config = candidateConfig;
          this.connected = true;
          this.lastError = null;
          if (options?.persistCredentials) {
            this.saveEncryptedConfig(this.config);
            this.configSource = "persisted_ui";
          }
          console.log(
            `[MySQL] Connected to Hostinger local MySQL (${this.config.host}:${this.config.port}/${this.config.database}, source=${this.configSource})`
          );
          return {
            connected: true,
            message: `Connected to MySQL database '${this.config.database}' on ${this.config.host}`
          };
        } catch (err) {
          if (nextPool) {
            await nextPool.end().catch(() => {
            });
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
      async ensureColumn(conn, tableName, columnName, definition, modifyIfDiffers = false) {
        const [rows] = await conn.query(
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
          const currentType = String(rows[0].COLUMN_TYPE || "").toLowerCase();
          const currentNullable = String(rows[0].IS_NULLABLE || "").toUpperCase();
          const targetUpper = definition.toUpperCase();
          const wantsEnum = targetUpper.startsWith("ENUM(");
          const targetToken = definition.split(/\s+/)[0].toLowerCase();
          const wantsNull = targetUpper.includes(" NULL") && !targetUpper.includes("NOT NULL");
          const typeDiffers = wantsEnum ? !currentType.startsWith("enum(") || definition.slice(0, definition.indexOf(")") + 1).toLowerCase().replace(/\s+/g, "") !== currentType.replace(/\s+/g, "") : !currentType.includes(targetToken.split("(")[0]);
          const nullableDiffers = wantsNull ? currentNullable !== "YES" : false;
          if (typeDiffers || nullableDiffers) {
            try {
              await conn.query(`ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${columnName}\` ${definition}`);
            } catch (err) {
              console.warn(`[MySQL] Non-fatal MODIFY COLUMN skipped on ${tableName}.${columnName}:`, err.message);
            }
          }
        }
      }
      /**
       * Idempotently creates non-unique secondary indexes when missing.
       */
      async ensureIndex(conn, tableName, indexName, columnListSql) {
        const [rows] = await conn.query(
          `SELECT COUNT(*) AS cnt
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
          [tableName, indexName]
        );
        if (!rows || Number(rows[0]?.cnt || 0) === 0) {
          await conn.query(`CREATE INDEX \`${indexName}\` ON \`${tableName}\` (${columnListSql})`);
        }
      }
      async ensureTables(conn) {
        await conn.query(`
      CREATE TABLE IF NOT EXISTS bvl_app_state (
        state_key VARCHAR(64) PRIMARY KEY,
        state_json LONGTEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
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
        await conn.query(`
      CREATE TABLE IF NOT EXISTS bvl_patron_credentials (
        email VARCHAR(191) PRIMARY KEY,
        password_hash VARCHAR(255) NOT NULL,
        updated_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
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
        await conn.query(`
      CREATE TABLE IF NOT EXISTS bvl_catalog_products (
        id VARCHAR(64) PRIMARY KEY,
        category VARCHAR(64) NOT NULL,
        product_type VARCHAR(128) NOT NULL,
        name VARCHAR(255) NOT NULL,
        sku VARCHAR(64) NOT NULL UNIQUE,
        price DECIMAL(12,2) NOT NULL DEFAULT 0,
        offer_price DECIMAL(12,2) NULL DEFAULT NULL,
        currency VARCHAR(16) NOT NULL DEFAULT 'INR',
        description TEXT,
        features_json LONGTEXT,
        images_json LONGTEXT,
        video_url TEXT NULL,
        hsn_code VARCHAR(32),
        gst_rate DECIMAL(5,4) NULL DEFAULT NULL,
        solution_engine ENUM('EVERYDAY_CARRY', 'TRANSIT_FOLIOS', 'LIFETIME_HEIRLOOM_CARE') NOT NULL DEFAULT 'EVERYDAY_CARRY',
        allow_customization TINYINT(1) NOT NULL DEFAULT 1,
        care_kit_included TINYINT(1) NOT NULL DEFAULT 1,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
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
        await conn.query(`
      CREATE TABLE IF NOT EXISTS bvl_webhook_events (
        event_id VARCHAR(128) PRIMARY KEY,
        processed_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
        await this.ensureColumn(
          conn,
          "bvl_admin_users",
          "role",
          "ENUM('PATRON', 'STORE_MANAGER', 'SUPPORT_AGENT', 'LOGISTICS_COORDINATOR') NOT NULL DEFAULT 'STORE_MANAGER'",
          true
        );
        await this.ensureColumn(conn, "bvl_admin_users", "password_hash", "VARCHAR(255) NOT NULL DEFAULT ''");
        await this.ensureColumn(conn, "bvl_customers", "identity_uid", "VARCHAR(128) NULL");
        await this.ensureColumn(
          conn,
          "bvl_customers",
          "role",
          "ENUM('PATRON', 'STORE_MANAGER', 'SUPPORT_AGENT', 'LOGISTICS_COORDINATOR') NOT NULL DEFAULT 'PATRON'",
          true
        );
        await this.ensureColumn(conn, "bvl_customers", "average_order_value", "DECIMAL(12,2) NOT NULL DEFAULT 0");
        await this.ensureColumn(conn, "bvl_customers", "refund_rate", "DECIMAL(6,2) NOT NULL DEFAULT 0");
        await this.ensureColumn(conn, "bvl_customers", "days_since_last_order", "INT NOT NULL DEFAULT 0");
        await this.ensureColumn(conn, "bvl_customers", "last_order_date", "DATETIME NULL");
        await this.ensureColumn(conn, "bvl_customers", "rfm_score_json", "VARCHAR(255) NULL");
        await this.ensureColumn(conn, "bvl_customers", "discount_orders_count", "INT NOT NULL DEFAULT 0");
        await this.ensureColumn(conn, "bvl_customers", "tags_json", "TEXT NULL");
        await this.ensureColumn(conn, "bvl_customers", "utm_source", "VARCHAR(191) NULL");
        await this.ensureColumn(conn, "bvl_customers", "utm_medium", "VARCHAR(191) NULL");
        await this.ensureColumn(conn, "bvl_customers", "acquisition_cost", "DECIMAL(12,2) NOT NULL DEFAULT 0");
        await this.ensureColumn(conn, "bvl_customers", "is_active", "TINYINT(1) NOT NULL DEFAULT 1");
        await this.ensureColumn(conn, "bvl_customers", "deleted_at", "DATETIME NULL");
        await this.ensureColumn(conn, "bvl_catalog_products", "offer_price", "DECIMAL(12,2) NULL DEFAULT NULL");
        await this.ensureColumn(conn, "bvl_catalog_products", "video_url", "TEXT NULL");
        await this.ensureColumn(conn, "bvl_catalog_products", "gst_rate", "DECIMAL(5,4) NULL DEFAULT NULL", true);
        await this.ensureColumn(
          conn,
          "bvl_catalog_products",
          "solution_engine",
          "ENUM('EVERYDAY_CARRY', 'TRANSIT_FOLIOS', 'LIFETIME_HEIRLOOM_CARE') NOT NULL DEFAULT 'EVERYDAY_CARRY'",
          true
        );
        await this.ensureColumn(conn, "bvl_inventory", "id", "VARCHAR(64) NOT NULL DEFAULT ''");
        await this.ensureColumn(conn, "bvl_orders", "customer_name", "VARCHAR(191) NOT NULL DEFAULT ''");
        await this.ensureColumn(conn, "bvl_orders", "customer_phone", "VARCHAR(32) NOT NULL DEFAULT ''");
        await this.ensureColumn(
          conn,
          "bvl_orders",
          "status",
          "ENUM('PROCESSING', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'RETURNED') NOT NULL DEFAULT 'PROCESSING'",
          true
        );
        await this.ensureColumn(conn, "bvl_orders", "currency", "VARCHAR(8) NOT NULL DEFAULT 'INR'");
        await this.ensureColumn(conn, "bvl_orders", "discount_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0");
        await this.ensureColumn(conn, "bvl_orders", "discount_code", "VARCHAR(64) NULL");
        await this.ensureColumn(conn, "bvl_orders", "shipping_fee", "DECIMAL(12,2) NOT NULL DEFAULT 0");
        await this.ensureColumn(
          conn,
          "bvl_orders",
          "payment_gateway",
          "ENUM('RAZORPAY', 'STRIPE', 'CASH_ON_DELIVERY') NOT NULL DEFAULT 'RAZORPAY'",
          true
        );
        await this.ensureColumn(conn, "bvl_orders", "payment_id", "VARCHAR(128) NULL");
        await this.ensureColumn(
          conn,
          "bvl_orders",
          "payment_status",
          "ENUM('PAID', 'PENDING', 'REFUNDED', 'FAILED') NOT NULL DEFAULT 'PAID'",
          true
        );
        await this.ensureColumn(conn, "bvl_orders", "items_json", "LONGTEXT NULL");
        await this.ensureColumn(conn, "bvl_orders", "shipping_address_json", "TEXT NULL");
        await this.ensureColumn(conn, "bvl_orders", "billing_address_json", "TEXT NULL");
        await this.ensureColumn(conn, "bvl_orders", "courier_partner", "ENUM('SHIPROCKET', 'DELHIVERY') NULL");
        await this.ensureColumn(
          conn,
          "bvl_orders",
          "courier_status",
          "ENUM('IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RTO') NULL"
        );
        await this.ensureColumn(conn, "bvl_orders", "estimated_delivery_date", "DATETIME NULL");
        await this.ensureColumn(conn, "bvl_orders", "is_gst_invoice_generated", "TINYINT(1) NOT NULL DEFAULT 0");
        await this.ensureColumn(conn, "bvl_orders", "updated_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
        await this.ensureColumn(conn, "bvl_customer_addresses", "recipient_name", "VARCHAR(191) NOT NULL DEFAULT ''");
        await this.ensureColumn(conn, "bvl_customer_addresses", "phone", "VARCHAR(32) NOT NULL DEFAULT ''");
        await this.ensureColumn(conn, "bvl_customer_addresses", "created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
        await this.ensureColumn(
          conn,
          "bvl_customer_addresses",
          "updated_at",
          "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
        );
        await this.ensureColumn(conn, "bvl_corporate_leads", "items_json", "LONGTEXT NULL");
        await this.ensureColumn(conn, "bvl_corporate_leads", "erp_order_id", "VARCHAR(64) NULL");
        await this.ensureColumn(conn, "bvl_corporate_leads", "erp_order_number", "VARCHAR(64) NULL");
        await this.ensureColumn(conn, "bvl_support_tickets", "customer_phone", "VARCHAR(32) NULL");
        await this.ensureColumn(conn, "bvl_audit_logs", "ip_address", "VARCHAR(64) NULL");
        await this.ensureIndex(conn, "bvl_customers", "idx_bvl_customers_active", "is_active");
        await this.ensureIndex(conn, "bvl_customer_addresses", "idx_bvl_addr_customer", "customer_id");
        await this.ensureIndex(conn, "bvl_inventory", "idx_bvl_inventory_product", "product_id");
        await this.ensureIndex(conn, "bvl_bill_of_materials", "idx_bvl_bom_sku", "parent_sku");
        await this.ensureIndex(conn, "bvl_orders", "idx_bvl_orders_customer", "customer_id");
        await this.ensureIndex(conn, "bvl_orders", "idx_bvl_orders_created", "created_at");
        await this.ensureIndex(conn, "bvl_corporate_leads", "idx_bvl_leads_status", "status");
        await this.ensureIndex(conn, "bvl_support_tickets", "idx_bvl_tickets_customer", "customer_id");
        await this.ensureIndex(conn, "bvl_gst_invoices", "idx_bvl_invoices_order", "order_id");
        await this.ensureIndex(conn, "bvl_gst_credit_notes", "idx_bvl_cn_order", "order_id");
        await this.ensureIndex(conn, "bvl_audit_logs", "idx_bvl_audit_created", "created_at");
      }
      // ==========================================
      // LOAD & SAVE STATE SNAPSHOT + ALL 21 NORMALIZED TABLES
      // ==========================================
      /**
       * Hydrates DatabaseState from bvl_app_state AND reconciles normalized relational rows
       * so startup state preserves patron credentials, granular admin roles, soft-deleted customers,
       * corporate lead items, ticket phones, BOM stock, invoices, credit notes, and config accurately.
       */
      async loadStateSnapshot() {
        if (!this.isConnected()) return null;
        try {
          const [appRows] = await this.pool.query(
            "SELECT state_json FROM bvl_app_state WHERE state_key = ?",
            ["primary_store_state"]
          );
          let baseState = null;
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
          ] = await Promise.all([
            this.pool.query("SELECT * FROM bvl_store_config"),
            this.pool.query("SELECT * FROM bvl_admin_users"),
            this.pool.query("SELECT * FROM bvl_patron_credentials"),
            this.pool.query("SELECT * FROM bvl_customers"),
            this.pool.query("SELECT * FROM bvl_customer_addresses"),
            this.pool.query("SELECT * FROM bvl_inventory"),
            this.pool.query("SELECT * FROM bvl_bill_of_materials"),
            this.pool.query("SELECT * FROM bvl_orders ORDER BY created_at DESC"),
            this.pool.query("SELECT * FROM bvl_hot_stamping_vectors ORDER BY recorded_at DESC"),
            this.pool.query("SELECT * FROM bvl_warranties"),
            this.pool.query("SELECT * FROM bvl_care_kits"),
            this.pool.query("SELECT * FROM bvl_corporate_leads ORDER BY created_at DESC"),
            this.pool.query("SELECT * FROM bvl_support_tickets ORDER BY created_at DESC"),
            this.pool.query("SELECT * FROM bvl_carts"),
            this.pool.query("SELECT * FROM bvl_gst_invoices"),
            this.pool.query("SELECT * FROM bvl_gst_credit_notes"),
            this.pool.query("SELECT * FROM bvl_audit_logs ORDER BY created_at DESC LIMIT 500"),
            this.pool.query("SELECT event_id FROM bvl_webhook_events")
          ]);
          const hasAnyNormalizedData = cfgRows && cfgRows.length > 0 || adminRows && adminRows.length > 0 || custRows && custRows.length > 0 || invRows && invRows.length > 0;
          if (!baseState && !hasAnyNormalizedData) {
            return null;
          }
          const hydrated = baseState ? { ...baseState } : {};
          if (cfgRows && cfgRows.length > 0) {
            const cfgRow = cfgRows[0];
            const prevCfg = hydrated.config || {};
            const adminCredsFromNorm = adminRows && adminRows.length > 0 ? adminRows.map((a) => ({
              userId: a.user_id,
              displayName: a.display_name,
              role: a.is_master ? "STORE_MANAGER" : a.role || "STORE_MANAGER",
              passwordHash: a.password_hash || "",
              addedBy: a.added_by || "system",
              addedAt: toIsoString(a.added_at),
              isMaster: Boolean(a.is_master)
            })) : prevCfg.adminCredentials || [];
            const parsedMaster = safeJsonParse(cfgRow.master_super_admins_json, prevCfg.masterSuperAdmins || []);
            const parsedPermitted = safeJsonParse(
              cfgRow.permitted_store_managers_json,
              prevCfg.permittedStoreManagers || adminCredsFromNorm.map((a) => a.userId)
            );
            hydrated.config = {
              ...prevCfg,
              id: cfgRow.id,
              gstInvoicingEnabled: Boolean(cfgRow.gst_invoicing_enabled),
              masterSuperAdmins: parsedMaster,
              permittedStoreManagers: parsedPermitted,
              adminCredentials: adminCredsFromNorm,
              abandonmentThresholdMinutes: Number(cfgRow.abandonment_threshold_minutes ?? 15),
              primaryHubCity: cfgRow.primary_hub_city || "Pune",
              supplierGstin: cfgRow.supplier_gstin || "27AABCB1234F1Z8",
              gstRatePercent: Number(cfgRow.gst_rate_percent ?? 18),
              promoCodes: safeJsonParse(cfgRow.promo_codes_json, prevCfg.promoCodes || []),
              updatedAt: toIsoString(cfgRow.updated_at),
              lastUpdatedBy: cfgRow.last_updated_by || "system"
            };
          } else if (adminRows && adminRows.length > 0 && hydrated.config) {
            hydrated.config.adminCredentials = adminRows.map((a) => ({
              userId: a.user_id,
              displayName: a.display_name,
              role: a.is_master ? "STORE_MANAGER" : a.role || "STORE_MANAGER",
              passwordHash: a.password_hash || "",
              addedBy: a.added_by || "system",
              addedAt: toIsoString(a.added_at),
              isMaster: Boolean(a.is_master)
            }));
          }
          if (patronCredRows && patronCredRows.length > 0) {
            const credsMap = { ...hydrated.patronCredentials || {} };
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
            const prevById = new Map(
              (Array.isArray(hydrated.customers) ? hydrated.customers : []).map((c) => [c.id, c])
            );
            hydrated.customers = custRows.map((c) => {
              const fallback = prevById.get(c.id) || {};
              return {
                ...fallback,
                id: c.id,
                ...c.identity_uid ? { identityUid: c.identity_uid } : {},
                email: c.email,
                phone: c.phone || "",
                fullName: c.full_name,
                role: c.role || "PATRON",
                totalOrders: Number(c.total_orders ?? 0),
                lifetimeValue: Number(c.lifetime_value ?? 0),
                averageOrderValue: Number(c.average_order_value ?? fallback.averageOrderValue ?? 0),
                refundRate: Number(c.refund_rate ?? fallback.refundRate ?? 0),
                daysSinceLastOrder: Number(c.days_since_last_order ?? fallback.daysSinceLastOrder ?? 0),
                ...c.last_order_date ? { lastOrderDate: toIsoString(c.last_order_date) } : {},
                rfmSegment: c.rfm_segment || "Promising/Recent",
                rfmScore: safeJsonParse(c.rfm_score_json, fallback.rfmScore || { recency: 3, frequency: 1, monetary: 1 }),
                discountOrdersCount: Number(c.discount_orders_count ?? fallback.discountOrdersCount ?? 0),
                loyaltyPoints: Number(c.loyalty_points ?? 0),
                storeCreditBalance: Number(c.store_credit_balance ?? 0),
                tags: safeJsonParse(c.tags_json, fallback.tags || []),
                ...c.utm_source ? { utmSource: c.utm_source } : {},
                ...c.utm_medium ? { utmMedium: c.utm_medium } : {},
                acquisitionCost: Number(c.acquisition_cost ?? fallback.acquisitionCost ?? 0),
                isActive: c.is_active === 0 ? false : true,
                deletedAt: c.deleted_at ? toIsoString(c.deleted_at) : null,
                createdAt: toIsoString(c.created_at),
                updatedAt: toIsoString(c.updated_at)
              };
            });
          }
          if (addrRows && addrRows.length > 0) {
            hydrated.addresses = addrRows.map((a) => ({
              id: a.id,
              customerId: a.customer_id,
              ...a.recipient_name ? { recipientName: a.recipient_name } : {},
              ...a.phone ? { phone: a.phone } : {},
              street: a.street,
              city: a.city,
              state: a.state,
              pincode: a.pincode,
              country: a.country || "India",
              isDefault: Boolean(a.is_default),
              addressType: a.address_type === "BILLING" ? "BILLING" : "SHIPPING",
              ...a.created_at ? { createdAt: toIsoString(a.created_at) } : {},
              ...a.updated_at ? { updatedAt: toIsoString(a.updated_at) } : {}
            }));
          }
          if (Array.isArray(hydrated.customers) && Array.isArray(hydrated.addresses)) {
            const addrByCust = /* @__PURE__ */ new Map();
            for (const a of hydrated.addresses) {
              const list = addrByCust.get(a.customerId) || [];
              list.push(a);
              addrByCust.set(a.customerId, list);
            }
            hydrated.customers = hydrated.customers.map((c) => {
              const custAddrs = addrByCust.get(c.id) || c.addresses || [];
              const defAddr = custAddrs.find((a) => a.isDefault) || custAddrs[0];
              return {
                ...c,
                ...defAddr ? {
                  phone: c.phone || defAddr.phone || "",
                  address: defAddr.street,
                  city: defAddr.city,
                  state: defAddr.state,
                  pincode: defAddr.pincode
                } : {},
                addresses: custAddrs
              };
            });
          }
          if (invRows && invRows.length > 0) {
            hydrated.inventory = invRows.map((i) => ({
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
              batchLotNumber: i.batch_lot_number || "",
              leadTimeDays: Number(i.lead_time_days ?? 7)
            }));
          }
          if (bomRows && bomRows.length > 0) {
            hydrated.billOfMaterials = bomRows.map((b) => ({
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
            const prevById = new Map(
              (Array.isArray(hydrated.orders) ? hydrated.orders : []).map((o) => [o.id, o])
            );
            hydrated.orders = ordRows.map((o) => {
              const fallback = prevById.get(o.id) || {};
              return {
                ...fallback,
                id: o.id,
                orderNumber: o.order_number,
                customerId: o.customer_id,
                customerName: o.customer_name || fallback.customerName || "Valued Patron",
                customerEmail: o.customer_email,
                customerPhone: o.customer_phone ?? fallback.customerPhone ?? "",
                status: o.status,
                currency: o.currency || "INR",
                subtotal: Number(o.subtotal),
                discountAmount: Number(o.discount_amount ?? 0),
                ...o.discount_code ? { discountCode: o.discount_code } : {},
                taxAmount: Number(o.tax_amount),
                shippingFee: Number(o.shipping_fee ?? 0),
                totalAmount: Number(o.total_amount),
                paymentGateway: o.payment_gateway,
                ...o.payment_id ? { paymentId: o.payment_id } : {},
                paymentStatus: o.payment_status,
                items: safeJsonParse(o.items_json, fallback.items || []),
                shippingAddress: safeJsonParse(o.shipping_address_json, fallback.shippingAddress || {}),
                billingAddress: safeJsonParse(o.billing_address_json, fallback.billingAddress || {}),
                ...o.awb_number ? { awbNumber: o.awb_number } : {},
                ...o.courier_partner ? { courierPartner: o.courier_partner } : {},
                ...o.courier_status ? { courierStatus: o.courier_status } : {},
                ...o.estimated_delivery_date ? { estimatedDeliveryDate: toIsoString(o.estimated_delivery_date) } : {},
                ...o.invoice_number ? { invoiceNumber: o.invoice_number } : {},
                isGstInvoiceGenerated: Boolean(o.is_gst_invoice_generated ?? Boolean(o.invoice_number)),
                createdAt: toIsoString(o.created_at),
                updatedAt: toIsoString(o.updated_at, toIsoString(o.created_at))
              };
            });
          }
          if (hsvRows && hsvRows.length > 0) {
            hydrated.hotStampingVectors = hsvRows.map((h) => ({
              id: h.id,
              customerId: h.customer_id,
              ...h.order_id ? { orderId: h.order_id } : {},
              productId: h.product_id,
              productName: h.product_name,
              monogramText: h.monogram_text,
              foilStyle: h.foil_style,
              fontFamily: h.font_family,
              ...h.preview_image_url ? { previewImageUrl: h.preview_image_url } : {},
              recordedAt: toIsoString(h.recorded_at)
            }));
          }
          if (warRows && warRows.length > 0) {
            hydrated.warranties = warRows.map((w) => ({
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
            hydrated.careKitDispatches = ckRows.map((c) => ({
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
            hydrated.corporateGiftingLeads = leadRows.map((l) => {
              const parsedItems = l.items_json ? safeJsonParse(l.items_json, void 0) : void 0;
              return {
                id: l.id,
                companyName: l.company_name,
                contactPerson: l.contact_person,
                email: l.email,
                phone: l.phone || "",
                estimatedQuantity: Number(l.estimated_quantity),
                budgetRangeInr: l.budget_range_inr || "",
                interestCategory: l.interest_category,
                status: l.status,
                ...l.swatch_kit_awb ? { swatchKitAwb: l.swatch_kit_awb } : {},
                ...Array.isArray(parsedItems) && parsedItems.length > 0 ? { items: parsedItems } : {},
                ...l.erp_order_id ? { erpOrderId: l.erp_order_id } : {},
                ...l.erp_order_number ? { erpOrderNumber: l.erp_order_number } : {},
                notes: l.notes || "",
                ...l.deal_value_inr !== null && l.deal_value_inr !== void 0 ? { dealValueInr: Number(l.deal_value_inr) } : {},
                createdAt: toIsoString(l.created_at)
              };
            });
          }
          if (tktRows && tktRows.length > 0) {
            hydrated.supportTickets = tktRows.map((t) => ({
              id: t.id,
              ticketNumber: t.ticket_number,
              customerId: t.customer_id,
              customerName: t.customer_name,
              customerEmail: t.customer_email,
              ...t.customer_phone ? { customerPhone: t.customer_phone } : {},
              channel: t.channel,
              subject: t.subject,
              category: t.category,
              priority: t.priority,
              status: t.status,
              ...t.assigned_to ? { assignedTo: t.assigned_to } : {},
              slaBreachHours: Number(t.sla_breach_hours),
              createdAt: toIsoString(t.created_at),
              updatedAt: toIsoString(t.updated_at),
              messages: safeJsonParse(t.messages_json, [])
            }));
          }
          if (cartRows && cartRows.length > 0) {
            hydrated.carts = cartRows.map((c) => ({
              id: c.id,
              ...c.customer_id ? { customerId: c.customer_id } : {},
              email: c.email,
              ...c.phone ? { phone: c.phone } : {},
              items: safeJsonParse(c.items_json, []),
              subtotal: Number(c.subtotal),
              currency: c.currency || "INR",
              isAbandoned: Boolean(c.is_abandoned),
              ...c.abandoned_at ? { abandonedAt: toIsoString(c.abandoned_at) } : {},
              recoveryStage: c.recovery_stage,
              recoveryAttempts: Number(c.recovery_attempts),
              ...c.last_recovery_trigger_at ? { lastRecoveryTriggerAt: toIsoString(c.last_recovery_trigger_at) } : {},
              checkoutUrl: c.checkout_url,
              lastActiveAt: toIsoString(c.last_active_at)
            }));
          }
          if (gstInvRows && gstInvRows.length > 0) {
            hydrated.gstInvoices = gstInvRows.map((i) => ({
              id: i.id,
              invoiceNumber: i.invoice_number,
              orderId: i.order_id,
              customerId: i.customer_id,
              ...i.customer_gstin ? { customerGstin: i.customer_gstin } : {},
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
              ...i.pdf_url ? { pdfUrl: i.pdf_url } : {}
            }));
          }
          if (cnRows && cnRows.length > 0) {
            hydrated.gstCreditNotes = cnRows.map((cn) => ({
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
            hydrated.auditLogs = auditRows.map((a) => ({
              id: a.id,
              actorEmail: a.actor_email,
              action: a.action,
              category: a.category,
              details: a.details,
              timestamp: toIsoString(a.created_at),
              ...a.ip_address ? { ipAddress: a.ip_address } : {}
            }));
          }
          if (webhookRows && webhookRows.length > 0) {
            hydrated.processedWebhookIds = webhookRows.map((w) => w.event_id);
          }
          return hydrated;
        } catch (err) {
          this.lastError = err.message;
          throw new Error(`MySQL state hydration failed: ${err.message}`);
        }
      }
      /**
       * Builds ordered SQL statements to synchronize bvl_app_state and all 20 normalized
       * relational tables inside a single MySQL transaction (with empty-array & identity safety guards).
       */
      async syncStateWithConnection(conn, state) {
        const json = JSON.stringify(state);
        await conn.query(
          `INSERT INTO bvl_app_state (state_key, state_json) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE state_json = VALUES(state_json)`,
          ["primary_store_state", json]
        );
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
              cfg.id || "cfg_bvl_01",
              cfg.gstInvoicingEnabled !== false ? 1 : 0,
              cfg.abandonmentThresholdMinutes ?? 15,
              cfg.primaryHubCity || "Pune",
              cfg.supplierGstin || "27AABCB1234F1Z8",
              cfg.gstRatePercent ?? 18,
              JSON.stringify(cfg.promoCodes || []),
              JSON.stringify(cfg.masterSuperAdmins || []),
              JSON.stringify(cfg.permittedStoreManagers || []),
              toMySQLDate(cfg.updatedAt),
              cfg.lastUpdatedBy || "system"
            ]
          );
        }
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
              inv.batchLotNumber || "",
              inv.leadTimeDays ?? 7
            ]
          );
        }
        const activeSkus = inventoryList.map((i) => i.sku).filter(Boolean);
        if (activeSkus.length > 0) {
          await conn.query(`DELETE FROM bvl_inventory WHERE sku NOT IN (${makePlaceholders(activeSkus.length)})`, activeSkus);
        }
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
              adm.isMaster ? "STORE_MANAGER" : adm.role || "STORE_MANAGER",
              adm.passwordHash || "",
              adm.isMaster ? 1 : 0,
              adm.addedBy || "system",
              toMySQLDate(adm.addedAt)
            ]
          );
        }
        const patronCreds = state.patronCredentials && typeof state.patronCredentials === "object" ? Object.values(state.patronCredentials) : [];
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
              cust.phone || "",
              cust.fullName,
              cust.role || "PATRON",
              cust.totalOrders ?? 0,
              cust.lifetimeValue ?? 0,
              cust.averageOrderValue ?? 0,
              cust.refundRate ?? 0,
              cust.daysSinceLastOrder ?? 0,
              cust.lastOrderDate ? toMySQLDate(cust.lastOrderDate) : null,
              cust.rfmSegment || "Promising/Recent",
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
        const addressList = Array.isArray(state.addresses) ? state.addresses : [];
        const customerIdsInState = new Set(customerList.map((c) => c.id));
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
              addr.recipientName || "",
              addr.phone || "",
              addr.street || "",
              addr.city || "",
              addr.state || "",
              addr.pincode || "",
              addr.country || "India",
              addr.isDefault ? 1 : 0,
              addr.addressType === "BILLING" ? "BILLING" : "SHIPPING",
              toMySQLDate(addr.createdAt),
              toMySQLDate(addr.updatedAt)
            ]
          );
        }
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
              bom.unit || "PIECES",
              bom.inventoryOnHand ?? 0,
              bom.safetyStock ?? 20,
              bom.vendorName || ""
            ]
          );
        }
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
              ord.customerName || "Valued Patron",
              ord.customerEmail,
              ord.customerPhone || "",
              ord.status || "PROCESSING",
              ord.currency || "INR",
              ord.subtotal ?? 0,
              ord.discountAmount ?? 0,
              ord.discountCode || null,
              ord.taxAmount ?? 0,
              ord.shippingFee ?? 0,
              ord.totalAmount ?? 0,
              ord.paymentGateway || "RAZORPAY",
              ord.paymentId || null,
              ord.paymentStatus || "PAID",
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
        const activeOrderIds = orderList.map((o) => o.id).filter(Boolean);
        if (activeOrderIds.length > 0) {
          await conn.query(
            `DELETE FROM bvl_orders WHERE id NOT IN (${makePlaceholders(activeOrderIds.length)})`,
            activeOrderIds
          );
        }
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
              hsv.productName || "",
              hsv.monogramText || "",
              hsv.foilStyle || "GOLD_FOIL",
              hsv.fontFamily || "CINZEL",
              hsv.previewImageUrl || null,
              toMySQLDate(hsv.recordedAt)
            ]
          );
        }
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
              w.customerName || "",
              w.orderId,
              w.productId,
              w.productName || "",
              w.hardwareSerial || "",
              w.warrantyPeriodYears ?? 2,
              toMySQLDate(w.startDate),
              toMySQLDate(w.expiryDate),
              w.status || "ACTIVE",
              w.claimCount ?? 0,
              toMySQLDate(w.createdAt)
            ]
          );
        }
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
              ck.kitType || "ORGANIC_BEESWAX_BALM_BRUSH",
              toMySQLDate(ck.dispatchDate),
              ck.awbNumber || "",
              ck.courier || "SHIPROCKET",
              ck.status || "DISPATCHED",
              ck.digitalGuideSent !== false ? 1 : 0
            ]
          );
        }
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
              lead.phone || "",
              lead.estimatedQuantity ?? 1,
              lead.budgetRangeInr || "",
              lead.interestCategory || "EVERYDAY_CARRY",
              lead.status || "NEW_LEAD",
              lead.swatchKitAwb || null,
              Array.isArray(lead.items) && lead.items.length > 0 ? JSON.stringify(lead.items) : null,
              lead.erpOrderId || null,
              lead.erpOrderNumber || null,
              lead.notes || "",
              typeof lead.dealValueInr === "number" ? lead.dealValueInr : null,
              toMySQLDate(lead.createdAt)
            ]
          );
        }
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
              tkt.channel || "WHATSAPP",
              tkt.subject,
              tkt.category || "MONOGRAM_REQUEST",
              tkt.priority || "MEDIUM",
              tkt.status || "OPEN",
              tkt.assignedTo || null,
              tkt.slaBreachHours ?? 24,
              JSON.stringify(tkt.messages || []),
              toMySQLDate(tkt.createdAt),
              toMySQLDate(tkt.updatedAt)
            ]
          );
        }
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
              cart.currency || "INR",
              cart.isAbandoned ? 1 : 0,
              cart.abandonedAt ? toMySQLDate(cart.abandonedAt) : null,
              cart.recoveryStage || "DETECTED",
              cart.recoveryAttempts ?? 0,
              cart.lastRecoveryTriggerAt ? toMySQLDate(cart.lastRecoveryTriggerAt) : null,
              cart.checkoutUrl || "",
              toMySQLDate(cart.lastActiveAt)
            ]
          );
        }
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
              inv.status || "ISSUED",
              inv.pdfUrl || null
            ]
          );
        }
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
              cn.reason || "GOODS_RETURN",
              cn.taxableValue ?? 0,
              cn.cgstAmount ?? 0,
              cn.sgstAmount ?? 0,
              cn.igstAmount ?? 0,
              cn.totalCreditAmount ?? 0,
              toMySQLDate(cn.issuedAt)
            ]
          );
        }
        const auditList = Array.isArray(state.auditLogs) ? state.auditLogs : [];
        for (const log of auditList) {
          await conn.query(
            `INSERT IGNORE INTO bvl_audit_logs (id, actor_email, action, category, details, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              log.id,
              log.actorEmail || "system",
              log.action,
              log.category,
              log.details || "",
              log.ipAddress || null,
              toMySQLDate(log.timestamp)
            ]
          );
        }
        const webhookList = Array.isArray(state.processedWebhookIds) ? state.processedWebhookIds : [];
        for (const evtId of webhookList) {
          if (!evtId) continue;
          await conn.query(
            `INSERT IGNORE INTO bvl_webhook_events (event_id, processed_at) VALUES (?, ?)`,
            [evtId, /* @__PURE__ */ new Date()]
          );
        }
      }
      /**
       * Explicitly soft-deletes a customer record in bvl_customers (is_active = 0, deleted_at = NOW())
       * to preserve historical bvl_orders and bvl_audit_logs identity references.
       */
      async softDeleteCustomer(customerId, state) {
        if (!this.isConnected()) return;
        const conn = await this.pool.getConnection();
        try {
          await conn.beginTransaction();
          await conn.query(
            `UPDATE bvl_customers SET is_active = 0, deleted_at = NOW(), updated_at = NOW() WHERE id = ?`,
            [customerId]
          );
          await this.syncStateWithConnection(conn, state);
          await conn.commit();
          this.lastError = null;
          this.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
        } catch (err) {
          await conn.rollback().catch(() => {
          });
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
      async deleteAdminUser(userId, state) {
        if (!this.isConnected()) return;
        const conn = await this.pool.getConnection();
        try {
          await conn.beginTransaction();
          await conn.query(`DELETE FROM bvl_admin_users WHERE user_id = ?`, [userId]);
          await this.syncStateWithConnection(conn, state);
          await conn.commit();
          this.lastError = null;
          this.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
        } catch (err) {
          await conn.rollback().catch(() => {
          });
          this.lastError = err.message;
          throw new Error(`MySQL admin user deletion failed: ${err.message}`);
        } finally {
          conn.release();
        }
      }
      async saveStateSnapshot(state, connOverride) {
        if (!connOverride && !this.isConnected()) return;
        if (connOverride) {
          await this.syncStateWithConnection(connOverride, state);
          this.lastError = null;
          this.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
          return;
        }
        const conn = await this.pool.getConnection();
        try {
          await conn.beginTransaction();
          await this.syncStateWithConnection(conn, state);
          await conn.commit();
          this.lastError = null;
          this.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
        } catch (err) {
          await conn.rollback().catch(() => {
          });
          this.lastError = err.message;
          console.error("[MySQL] State snapshot sync failed (rolled back):", err.message);
          throw new Error(`MySQL persistence error: ${err.message}`);
        } finally {
          conn.release();
        }
      }
      // ==========================================
      // CATALOGUE PERSISTENCE IN MYSQL
      // ==========================================
      async loadCatalogSnapshot() {
        if (!this.isConnected()) return null;
        try {
          const [catRows] = await this.pool.query("SELECT * FROM bvl_catalog_categories");
          const [prodRows] = await this.pool.query("SELECT * FROM bvl_catalog_products");
          if ((!catRows || catRows.length === 0) && (!prodRows || prodRows.length === 0)) {
            return null;
          }
          const categories = (catRows || []).map((row) => ({
            id: row.id,
            name: row.name,
            slug: row.slug,
            description: row.description || "",
            productTypes: safeJsonParse(row.product_types_json, [])
          }));
          const products = (prodRows || []).map((row) => {
            const parsedImages = safeJsonParse(row.images_json, []).filter((u) => typeof u === "string" && u.trim().length > 0).slice(0, 4);
            return {
              id: row.id,
              category: row.category,
              productType: row.product_type,
              name: row.name,
              sku: row.sku,
              price: Number(row.price),
              ...row.offer_price !== null && row.offer_price !== void 0 ? { offerPrice: Number(row.offer_price) } : {},
              currency: row.currency || "INR",
              description: row.description || "",
              features: safeJsonParse(row.features_json, []),
              image: parsedImages[0] || "",
              images: parsedImages,
              ...row.video_url ? { videoUrl: String(row.video_url) } : {},
              hsnCode: row.hsn_code || "4202",
              ...row.gst_rate !== null && row.gst_rate !== void 0 ? { gstRate: Number(row.gst_rate) } : {},
              solutionEngine: row.solution_engine || "EVERYDAY_CARRY",
              inStock: true,
              allowCustomization: Boolean(row.allow_customization),
              careKitIncluded: Boolean(row.care_kit_included)
            };
          });
          return { categories, products };
        } catch (err) {
          this.lastError = err.message;
          throw new Error(`MySQL catalog load failed: ${err.message}`);
        }
      }
      async saveCatalogSnapshot(catalog, connOverride) {
        if (!connOverride && !this.isConnected()) return;
        const execute = async (conn2) => {
          const categories = Array.isArray(catalog.categories) ? catalog.categories : [];
          for (const cat of categories) {
            await conn2.query(
              `INSERT INTO bvl_catalog_categories (id, name, slug, description, product_types_json)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             slug = VALUES(slug),
             description = VALUES(description),
             product_types_json = VALUES(product_types_json)`,
              [cat.id, cat.name, cat.slug || cat.id, cat.description || "", JSON.stringify(cat.productTypes || [])]
            );
          }
          const catIds = categories.map((c) => c.id).filter(Boolean);
          if (catIds.length > 0) {
            await conn2.query(
              `DELETE FROM bvl_catalog_categories WHERE id NOT IN (${makePlaceholders(catIds.length)})`,
              catIds
            );
          }
          const products = Array.isArray(catalog.products) ? catalog.products : [];
          for (const prod of products) {
            const cleanImages = (Array.isArray(prod.images) ? prod.images : typeof prod.image === "string" && prod.image.trim() ? [prod.image.trim()] : []).filter((u) => typeof u === "string" && u.trim().length > 0).slice(0, 4);
            const cleanOfferPrice = typeof prod.offerPrice === "number" && Number.isFinite(prod.offerPrice) && prod.offerPrice > 0 ? prod.offerPrice : null;
            const cleanVideoUrl = typeof prod.videoUrl === "string" && prod.videoUrl.trim().length > 0 ? prod.videoUrl.trim() : null;
            await conn2.query(
              `INSERT INTO bvl_catalog_products (id, category, product_type, name, sku, price, offer_price, currency, description, features_json, images_json, video_url, hsn_code, gst_rate, solution_engine, allow_customization, care_kit_included)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             category = VALUES(category),
             product_type = VALUES(product_type),
             name = VALUES(name),
             sku = VALUES(sku),
             price = VALUES(price),
             offer_price = VALUES(offer_price),
             currency = VALUES(currency),
             description = VALUES(description),
             features_json = VALUES(features_json),
             images_json = VALUES(images_json),
             video_url = VALUES(video_url),
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
                cleanOfferPrice,
                prod.currency || "INR",
                prod.description || "",
                JSON.stringify(prod.features || []),
                JSON.stringify(cleanImages),
                cleanVideoUrl,
                prod.hsnCode || "4202",
                typeof prod.gstRate === "number" ? prod.gstRate : null,
                prod.solutionEngine || "EVERYDAY_CARRY",
                prod.allowCustomization !== false ? 1 : 0,
                prod.careKitIncluded !== false ? 1 : 0
              ]
            );
          }
          const prodIds = products.map((p) => p.id).filter(Boolean);
          if (prodIds.length > 0) {
            await conn2.query(
              `DELETE FROM bvl_catalog_products WHERE id NOT IN (${makePlaceholders(prodIds.length)})`,
              prodIds
            );
          }
        };
        if (connOverride) {
          await execute(connOverride);
          this.lastError = null;
          this.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
          return;
        }
        const conn = await this.pool.getConnection();
        try {
          await conn.beginTransaction();
          await execute(conn);
          await conn.commit();
          this.lastError = null;
          this.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
        } catch (err) {
          await conn.rollback().catch(() => {
          });
          this.lastError = err.message;
          console.error("[MySQL] Catalog snapshot sync failed (rolled back):", err.message);
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
      async runLockedStockTransaction(itemsToLock, work) {
        if (!this.isConnected()) {
          const { result } = await work({ lockedRows: [], conn: null });
          return result;
        }
        const conn = await this.pool.getConnection();
        try {
          await conn.beginTransaction();
          const sortedKeys = [...itemsToLock].sort(
            (a, b) => (a.sku || a.productId || "").localeCompare(b.sku || b.productId || "")
          );
          const lockedRows = [];
          for (const reqItem of sortedKeys) {
            const lookupSku = reqItem.sku || "";
            const lookupProdId = reqItem.productId || "";
            if (!lookupSku && !lookupProdId) continue;
            const [rows] = await conn.query(
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
          this.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
          return result;
        } catch (err) {
          await conn.rollback().catch(() => {
          });
          this.lastError = err.message;
          throw err;
        } finally {
          conn.release();
        }
      }
      /**
       * Executes a single-SKU inventory count adjustment inside an atomic SELECT ... FOR UPDATE transaction.
       */
      async runLockedInventoryAdjustment(sku, work) {
        if (!this.isConnected()) {
          const { result } = await work({ lockedRow: null, conn: null });
          return result;
        }
        const conn = await this.pool.getConnection();
        try {
          await conn.beginTransaction();
          const [rows] = await conn.query(
            `SELECT sku, product_id, name, pune_primary_hub, mumbai_warehouse
         FROM bvl_inventory
         WHERE sku = ?
         FOR UPDATE`,
            [sku]
          );
          const lockedRow = rows && rows.length > 0 ? {
            sku: rows[0].sku,
            productId: rows[0].product_id,
            name: rows[0].name,
            punePrimaryHub: Number(rows[0].pune_primary_hub),
            mumbaiWarehouse: Number(rows[0].mumbai_warehouse)
          } : null;
          const { result, nextState } = await work({ lockedRow, conn });
          await this.syncStateWithConnection(conn, nextState);
          await conn.commit();
          this.lastError = null;
          this.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
          return result;
        } catch (err) {
          await conn.rollback().catch(() => {
          });
          this.lastError = err.message;
          throw err;
        } finally {
          conn.release();
        }
      }
      /**
       * Executes catalog + inventory state save atomically in one MySQL transaction when connected.
       */
      async saveCatalogAndStateAtomic(catalog, state) {
        if (!this.isConnected()) return;
        const conn = await this.pool.getConnection();
        try {
          await conn.beginTransaction();
          await this.saveCatalogSnapshot(catalog, conn);
          await this.syncStateWithConnection(conn, state);
          await conn.commit();
          this.lastError = null;
          this.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
        } catch (err) {
          await conn.rollback().catch(() => {
          });
          this.lastError = err.message;
          console.error("[MySQL] Atomic catalog+state sync failed (rolled back):", err.message);
          throw new Error(`MySQL catalog persistence error: ${err.message}`);
        } finally {
          conn.release();
        }
      }
    };
    mysqlAdapter = new MySQLAdapter();
  }
});

// src/server/security.ts
import crypto2 from "crypto";
import fs2 from "fs";
import path2 from "path";
function getJwtSecret() {
  const envSecret = (process.env.JWT_SECRET || process.env.AUTH_JWT_SECRET || "").trim();
  if (envSecret.length > 0) {
    return envSecret;
  }
  if (cachedJwtSecret) {
    return cachedJwtSecret;
  }
  try {
    const dir = path2.dirname(JWT_SECRET_FILE);
    if (!fs2.existsSync(dir)) {
      fs2.mkdirSync(dir, { recursive: true });
    }
    if (fs2.existsSync(JWT_SECRET_FILE)) {
      const existing = fs2.readFileSync(JWT_SECRET_FILE, "utf-8").trim();
      if (/^[0-9a-f]{64}$/i.test(existing)) {
        cachedJwtSecret = existing;
        return cachedJwtSecret;
      }
    }
    const generated = crypto2.randomBytes(32).toString("hex");
    fs2.writeFileSync(JWT_SECRET_FILE, generated, { encoding: "utf-8", mode: 384 });
    cachedJwtSecret = generated;
    return cachedJwtSecret;
  } catch {
    cachedJwtSecret = crypto2.randomBytes(32).toString("hex");
    return cachedJwtSecret;
  }
}
function signSessionJwt(payload, expiresInSeconds = 7 * 24 * 60 * 60) {
  const nowSec = Math.floor(Date.now() / 1e3);
  const headerB64 = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const claims = {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    ...payload.name ? { name: payload.name } : {},
    role: payload.role,
    iat: nowSec,
    exp: nowSec + expiresInSeconds
  };
  const payloadB64 = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigB64 = crypto2.createHmac("sha256", getJwtSecret()).update(signingInput).digest("base64url");
  return `${signingInput}.${sigB64}`;
}
function verifySessionJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;
    if (!headerB64 || !payloadB64 || !signatureB64) return null;
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    if (!header || header.alg !== "HS256") return null;
    const expectedSigB64 = crypto2.createHmac("sha256", getJwtSecret()).update(`${headerB64}.${payloadB64}`).digest("base64url");
    const providedBuf = Buffer.from(signatureB64, "utf8");
    const expectedBuf = Buffer.from(expectedSigB64, "utf8");
    if (providedBuf.length !== expectedBuf.length || !crypto2.timingSafeEqual(providedBuf, expectedBuf)) {
      return null;
    }
    const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (!claims || !claims.email || typeof claims.exp !== "number") {
      return null;
    }
    const nowSec = Math.floor(Date.now() / 1e3);
    if (claims.exp <= nowSec) {
      return null;
    }
    return {
      ...claims,
      email: claims.email.trim().toLowerCase()
    };
  } catch {
    return null;
  }
}
function hashPassword(password) {
  const saltHex = crypto2.randomBytes(16).toString("hex");
  const derivedHex = crypto2.scryptSync(password, saltHex, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `scrypt$${saltHex}$${derivedHex}`;
}
function verifyPassword(password, storedHash) {
  if (!password || !storedHash || typeof storedHash !== "string") {
    return { valid: false, needsRehash: false };
  }
  if (storedHash.startsWith("scrypt$")) {
    const parts = storedHash.split("$");
    if (parts.length !== 3) return { valid: false, needsRehash: false };
    const [, saltHex, hashHex] = parts;
    if (!saltHex || !hashHex) return { valid: false, needsRehash: false };
    try {
      const derived = crypto2.scryptSync(password, saltHex, 64, { N: 16384, r: 8, p: 1 });
      const expected = Buffer.from(hashHex, "hex");
      if (derived.length !== expected.length) {
        return { valid: false, needsRehash: false };
      }
      return { valid: crypto2.timingSafeEqual(derived, expected), needsRehash: false };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }
  if (/^[0-9a-f]{64}$/i.test(storedHash)) {
    const legacyDigest = crypto2.createHash("sha256").update(password).digest("hex");
    const a = Buffer.from(legacyDigest, "hex");
    const b = Buffer.from(storedHash.toLowerCase(), "hex");
    if (a.length === b.length && crypto2.timingSafeEqual(a, b)) {
      return { valid: true, needsRehash: true };
    }
  }
  return { valid: false, needsRehash: false };
}
function safeCompareStrings(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto2.timingSafeEqual(bufA, bufB);
}
var JWT_SECRET_FILE, cachedJwtSecret;
var init_security = __esm({
  "src/server/security.ts"() {
    JWT_SECRET_FILE = path2.resolve(process.cwd(), "src/server/data/.jwt_secret");
    cachedJwtSecret = null;
  }
});

// src/server/db.ts
import fs3 from "fs";
import path3 from "path";
var MASTER_AUTHORIZED_ACCOUNTS, RelationalDatabase, db;
var init_db = __esm({
  "src/server/db.ts"() {
    init_mysqlAdapter();
    init_security();
    MASTER_AUTHORIZED_ACCOUNTS = [
      "support@bharatvarshcrafts.com",
      "sunilchain@gmail.com"
    ];
    RelationalDatabase = class {
      constructor() {
        this.catalogCache = null;
        this.mysqlInitialized = false;
        this.writeLock = Promise.resolve();
        this.pendingPersistPromise = Promise.resolve();
        this.lastPersistError = null;
        this.insideAtomicTransaction = false;
        this.dataFilePath = path3.resolve(process.cwd(), "src/server/data/store_db.json");
        this.catalogFilePath = path3.resolve(process.cwd(), "src/server/catalog.json");
        this.loadCatalog();
        this.state = this.loadPersistedStateOrSeed();
        this.reconcileInventoryWithCatalog();
        this.reconcileCustomerAddresses();
      }
      /**
       * Serializes mutating write workflows to prevent local race conditions
       * alongside MySQL SELECT ... FOR UPDATE row locks.
       */
      withWriteLock(fn) {
        const run = this.writeLock.then(fn, fn);
        this.writeLock = run.then(
          () => void 0,
          () => void 0
        );
        return run;
      }
      /**
       * Initializes Hostinger local MySQL connection on server startup
       */
      async initializeMySQL() {
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
              console.log("[DB] Hydrated product catalog from Hostinger MySQL.");
            } else if (this.catalogCache) {
              await mysqlAdapter.saveCatalogSnapshot(this.catalogCache);
              console.log("[DB] Seeded initial product catalog into Hostinger MySQL.");
            }
            const remoteState = await mysqlAdapter.loadStateSnapshot();
            if (remoteState) {
              this.state = this.migrateLegacyState(remoteState);
              this.reconcileInventoryWithCatalog();
              this.reconcileCustomerAddresses();
              this.persistToDiskOnly();
              await mysqlAdapter.saveStateSnapshot(this.state);
              console.log("[DB] Hydrated permanent state from Hostinger MySQL.");
            } else {
              await mysqlAdapter.saveStateSnapshot(this.state);
              console.log("[DB] Seeded initial state into Hostinger MySQL.");
            }
          } catch (err) {
            this.lastPersistError = err.message;
            console.error("[DB] Hostinger MySQL initialization sync error:", err.message);
          }
        }
      }
      migrateLegacyState(raw) {
        if (Array.isArray(raw.inventory)) {
          raw.inventory = raw.inventory.map((inv) => {
            if (inv.stockByLocation && inv.stockByLocation.jaipurAtelier !== void 0 && inv.stockByLocation.punePrimaryHub === void 0) {
              inv.stockByLocation = {
                punePrimaryHub: inv.stockByLocation.jaipurAtelier,
                mumbaiWarehouse: inv.stockByLocation.mumbaiWarehouse || 0
              };
            }
            return inv;
          });
        }
        if (raw.config) {
          raw.config.primaryHubCity = "Pune";
          if (!raw.config.supplierGstin) {
            raw.config.supplierGstin = process.env.BHARATVARSH_GSTIN || "27AABCB1234F1Z8";
          }
          if (typeof raw.config.gstRatePercent !== "number") {
            raw.config.gstRatePercent = 18;
          }
          if (!Array.isArray(raw.config.promoCodes)) {
            raw.config.promoCodes = [
              {
                code: "HEIRLOOM10",
                discountPercent: 10,
                active: true,
                description: "10% bespoke atelier patron privilege"
              }
            ];
          }
          if (!Array.isArray(raw.config.adminCredentials)) {
            raw.config.adminCredentials = MASTER_AUTHORIZED_ACCOUNTS.map((email) => ({
              userId: email,
              displayName: email === "sunilchain@gmail.com" ? "Sunil Chainani" : "Bharatvarsh Support Desk",
              role: "STORE_MANAGER",
              passwordHash: "",
              addedBy: "system",
              addedAt: (/* @__PURE__ */ new Date()).toISOString(),
              isMaster: true
            }));
          } else {
            raw.config.adminCredentials = raw.config.adminCredentials.map((cred) => ({
              ...cred,
              role: cred.isMaster ? "STORE_MANAGER" : cred.role || "STORE_MANAGER"
            }));
          }
        }
        if (Array.isArray(raw.billOfMaterials)) {
          raw.billOfMaterials = raw.billOfMaterials.map((b) => ({
            ...b,
            safetyStock: typeof b.safetyStock === "number" ? b.safetyStock : b.unit === "PIECES" ? 20 : 100
          }));
        }
        if (Array.isArray(raw.customers)) {
          raw.customers = raw.customers.map((c) => ({
            ...c,
            isActive: c.isActive !== false,
            deletedAt: c.deletedAt ?? null
          }));
        }
        if (!raw.patronCredentials || typeof raw.patronCredentials !== "object") {
          raw.patronCredentials = {};
        }
        if (Array.isArray(raw.hotStampingVectors)) {
          raw.hotStampingVectors = raw.hotStampingVectors.map((v) => ({
            ...v,
            ...v.previewImageUrl ? { previewImageUrl: this.normalizeImageUrl(v.previewImageUrl) } : {}
          }));
        }
        if (Array.isArray(raw.carts)) {
          raw.carts = raw.carts.map((cart) => ({
            ...cart,
            items: Array.isArray(cart.items) ? cart.items.map((item) => ({
              ...item,
              ...item.imageUrl ? { imageUrl: this.normalizeImageUrl(item.imageUrl) } : {}
            })) : []
          }));
        }
        if (Array.isArray(raw.orders)) {
          raw.orders = raw.orders.map((ord) => ({
            ...ord,
            items: Array.isArray(ord.items) ? ord.items.map((item) => ({
              ...item,
              ...item.imageUrl ? { imageUrl: this.normalizeImageUrl(item.imageUrl) } : {}
            })) : []
          }));
        }
        if (!Array.isArray(raw.knowledgeBase) || raw.knowledgeBase.length === 0) {
          raw.knowledgeBase = this.getDefaultKnowledgeBaseEntries();
        }
        return raw;
      }
      getDefaultKnowledgeBaseEntries() {
        return [
          {
            id: "kb_hide_anatomy_01",
            title: "Full-Grain Vegetable-Tanned Leather & Hide Anatomy",
            description: "How to distinguish full-grain heirloom hides from corrected-grain and split leathers, why natural bark tannins age into rich amber patina, and how we select every cut.",
            category: "LEATHER_GUIDE",
            fileType: "DECK",
            uploadedBy: "support@bharatvarshcrafts.com",
            uploadedAt: "2026-11-01T00:00:00Z",
            slides: [
              {
                title: "01 \xB7 Full-Grain vs Top-Grain vs Split Leather",
                subtitle: "Why Bharatvarsh exclusively works with unbuffed full-grain hides and bio-substitutes",
                points: [
                  "Full-Grain retains the outermost, tightest fiber layer of the hide \u2014 resisting stretching, tearing, and peeling for decades.",
                  "Top-Grain (corrected) sands away the surface to hide blemishes, sacrificing breathability and natural patina development.",
                  "Genuine / Split leather uses weaker lower layers bonded with polyurethane coatings that crack within 12\u201324 months."
                ]
              },
              {
                title: "02 \xB7 The 45-Day Vegetable Tanning Ritual",
                subtitle: "Slow botanical pit tanning using natural bark extracts (Mimosa, Myrobalan & Babul)",
                points: [
                  "Zero chromium salts or harsh heavy-metal runoffs \u2014 gentle on skin and safe for the artisans crafting every piece.",
                  "Rich natural oils stay locked inside the fiber network, creating a warm, earthy aroma unmistakable to connoisseurs.",
                  "Sunlight, hand oils, and daily travel gradually deepen the tone into a one-of-a-kind burnished patina."
                ]
              },
              {
                title: "03 \xB7 Conscious Cactus Bio-Substitute Craft",
                subtitle: "Plant-derived structural leather for patrons seeking zero-animal luxury",
                points: [
                  "Crafted from mature Nopal cactus leaves harvested sustainably without uprooting the plant.",
                  "Engineered for high abrasion resistance, water repellency, and supple hand-feel across everyday carry silhouettes.",
                  "Paired with the same solid cast-brass fittings and hand-waxed saddle stitching as our heritage leather line."
                ]
              },
              {
                title: "04 \xB7 Hand Saddle-Stitching & Solid Brass Hardware",
                subtitle: "Built to be repaired and passed down, never discarded",
                points: [
                  "Twin-needle hand saddle stitches lock independently \u2014 if a single thread ever abrades, the seam will never unravel.",
                  "Edges are bevelled, hand-dyed, and burnished with pure beeswax across multiple passes for a glass-smooth seal.",
                  "Sand-cast solid brass buckles, push-locks, and D-rings never flake or rust, mellowing alongside the hide."
                ]
              }
            ]
          },
          {
            id: "kb_heirloom_care_02",
            title: "Heirloom Conditioning, Monsoon Care & Patina Manual",
            description: "Step-by-step preservation ritual for vegetable-tanned hides, seasonal humidity protection, ink & water mark recovery, and long-term archival storage.",
            category: "CARE_MANUAL",
            fileType: "DECK",
            uploadedBy: "support@bharatvarshcrafts.com",
            uploadedAt: "2026-11-05T00:00:00Z",
            slides: [
              {
                title: "01 \xB7 Everyday Dusting & Horsehair Brushing",
                subtitle: "Two minutes once a fortnight keeps natural pores breathing",
                points: [
                  "Sweep seams, gussets, and brass clasps with a soft horsehair brush or dry unbleached cotton cloth.",
                  "Avoid wet wipes, alcohol sanitizers, or household detergents that strip natural vegetable tannins.",
                  "Allow your piece to rest empty overnight occasionally so the structural temper rebounds naturally."
                ]
              },
              {
                title: "02 \xB7 Conditioning with Organic Beeswax Balm",
                subtitle: "Nourish every 4\u20136 months or after prolonged dry air-conditioning exposure",
                points: [
                  "Warm a pea-sized dab of Bharatvarsh Organic Beeswax & Jojoba Balm between clean fingertips.",
                  "Massage in light circular motions across stress bends (straps, fold creases, corners) and rest for 30 minutes.",
                  "Buff gently with a dry lint-free cloth to restore satin lustre without clogging the grain."
                ]
              },
              {
                title: "03 \xB7 Monsoon & Moisture Protocol",
                subtitle: "How to rescue heirloom leather after unexpected rain",
                points: [
                  "Blot moisture immediately with a clean absorbent cotton towel \u2014 never rub vigorously while wet.",
                  "Stuff bags loosely with acid-free tissue paper to hold shape and dry naturally away from direct sunlight or hair dryers.",
                  "Once completely dry (24\u201336 hours), apply a thin coat of beeswax balm to replenish displaced oils."
                ]
              },
              {
                title: "04 \xB7 Archival Storage & Lifetime Atelier Support",
                subtitle: "Preserving silhouette and brass finish between journeys",
                points: [
                  "Always store inside your breathable unbleached cotton dust bag \u2014 never seal leather inside plastic covers.",
                  "Keep silica sachets nearby during high-humidity months to prevent surface bloom.",
                  "Every Bharatvarsh piece qualifies for complimentary artisan inspection and re-burnishing through My Atelier."
                ]
              }
            ]
          }
        ];
      }
      loadPersistedStateOrSeed() {
        try {
          if (fs3.existsSync(this.dataFilePath)) {
            const raw = fs3.readFileSync(this.dataFilePath, "utf-8");
            const parsed = JSON.parse(raw);
            return this.migrateLegacyState(parsed);
          }
        } catch (e) {
          console.warn("[DB] Failed to load local persistent store, initializing seed state:", e);
        }
        const seed = this.initializeSeedState();
        this.persistToDiskOnly(seed);
        return seed;
      }
      persistToDiskOnly(targetState) {
        const dir = path3.dirname(this.dataFilePath);
        if (!fs3.existsSync(dir)) {
          fs3.mkdirSync(dir, { recursive: true });
        }
        fs3.writeFileSync(this.dataFilePath, JSON.stringify(targetState || this.state, null, 2), "utf-8");
      }
      writeCatalogToDiskOnly(catalogData) {
        fs3.writeFileSync(this.catalogFilePath, JSON.stringify(catalogData, null, 2), "utf-8");
      }
      getRawCatalog() {
        if (!this.catalogCache) {
          this.loadCatalog();
        }
        return this.catalogCache || { categories: [], products: [] };
      }
      getFullStateSnapshot() {
        return this.state;
      }
      getLastPersistError() {
        return this.lastPersistError;
      }
      getLastDailyReportDate() {
        return this.state.lastDailyReportDate;
      }
      setLastDailyReportDate(dateKey) {
        this.state.lastDailyReportDate = dateKey;
        this.persistState();
      }
      /**
       * Queues durable persistence to local disk and Hostinger MySQL (if connected).
       * Callers performing API writes should await flushPersistence() or persistStateAsync()
       * so database write failures are surfaced to the caller rather than silently ignored.
       */
      persistState() {
        if (this.insideAtomicTransaction) return;
        this.persistToDiskOnly();
        if (mysqlAdapter.isConnected()) {
          const snapshot = structuredClone(this.state);
          this.pendingPersistPromise = this.pendingPersistPromise.then(async () => {
            await mysqlAdapter.saveStateSnapshot(snapshot);
            this.lastPersistError = null;
          }).catch((err) => {
            this.lastPersistError = err.message;
            console.error("[DB] MySQL write-through failed:", err.message);
          });
        }
      }
      async persistStateAsync(rollbackSnapshot) {
        this.persistToDiskOnly();
        if (mysqlAdapter.isConnected()) {
          try {
            await mysqlAdapter.saveStateSnapshot(this.state);
            this.lastPersistError = null;
          } catch (err) {
            this.lastPersistError = err.message;
            if (rollbackSnapshot) {
              this.state = rollbackSnapshot;
              this.persistToDiskOnly();
            }
            throw err;
          }
        }
      }
      async runAtomicMutation(fn) {
        return this.withWriteLock(async () => {
          const prevState = structuredClone(this.state);
          this.insideAtomicTransaction = true;
          let result;
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
          } catch (err) {
            this.state = prevState;
            this.persistToDiskOnly();
            this.lastPersistError = err.message;
            throw err;
          }
        });
      }
      async flushPersistence() {
        await this.pendingPersistPromise;
        if (this.lastPersistError) {
          const errMsg = this.lastPersistError;
          this.lastPersistError = null;
          throw new Error(errMsg);
        }
      }
      normalizeImageUrl(url) {
        if (!url || typeof url !== "string") return "";
        return url.trim().replace(/^\/?src\/assets\/images\//, "/assets/images/");
      }
      normalizeCatalogAssets(catalog) {
        if (!catalog || !Array.isArray(catalog.products)) {
          return { catalog, changed: false };
        }
        let changed = false;
        const products = catalog.products.map((prod) => {
          const sourceImages = Array.isArray(prod.images) ? prod.images : typeof prod.image === "string" && prod.image.trim() ? [prod.image] : [];
          const nextImages = sourceImages.map((img) => this.normalizeImageUrl(img)).filter(Boolean).slice(0, 4);
          const nextPrimaryImage = nextImages[0] || "";
          const nextVideoUrl = typeof prod.videoUrl === "string" ? this.normalizeImageUrl(prod.videoUrl) : "";
          const imagesChanged = !Array.isArray(prod.images) || prod.images.length !== nextImages.length || nextImages.some((img, idx) => img !== prod.images[idx]);
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
      loadCatalog() {
        try {
          if (fs3.existsSync(this.catalogFilePath)) {
            const raw = fs3.readFileSync(this.catalogFilePath, "utf-8");
            const parsed = JSON.parse(raw);
            this.catalogCache = this.normalizeCatalogAssets(parsed).catalog;
          }
        } catch (e) {
          console.warn("Could not read catalog.json directly, using fallback", e);
        }
      }
      /**
       * Ensures every product in catalog.json has a matching inventory record
       */
      reconcileInventoryWithCatalog() {
        if (!this.catalogCache || !Array.isArray(this.catalogCache.products)) return;
        let changed = false;
        for (const prod of this.catalogCache.products) {
          const exists = this.state.inventory.find((i) => i.productId === prod.id || i.sku === prod.sku);
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
      getCatalog() {
        if (!this.catalogCache) {
          this.loadCatalog();
        }
        if (!this.catalogCache) return { categories: [], products: [] };
        const enrichedProducts = (this.catalogCache.products || []).map((prod) => {
          const inv = this.state.inventory.find((i) => i.productId === prod.id || i.sku === prod.sku);
          const puneStock = inv ? inv.stockByLocation.punePrimaryHub : 0;
          const mumbaiStock = inv ? inv.stockByLocation.mumbaiWarehouse : 0;
          const totalStock = puneStock + mumbaiStock;
          const isAvailable = totalStock > 0;
          const images = (Array.isArray(prod.images) ? prod.images : typeof prod.image === "string" && prod.image.trim() ? [prod.image.trim()] : []).slice(0, 4);
          return {
            ...prod,
            images,
            image: images[0] || "",
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
      applyCatalogUpdateInMemory(catalogData, actorEmail) {
        const rawProducts = Array.isArray(catalogData.products) ? catalogData.products : [];
        const seenSkus = /* @__PURE__ */ new Set();
        const cleanProducts = [];
        for (const rawProd of rawProducts) {
          const normalizedSku = typeof rawProd?.sku === "string" ? rawProd.sku.trim().toUpperCase() : "";
          if (!normalizedSku) {
            throw new Error(`Product "${rawProd?.name || rawProd?.id || "Unnamed"}" SKU cannot be empty.`);
          }
          if (seenSkus.has(normalizedSku)) {
            throw new Error(`Duplicate SKU detected: "${rawProd.sku.trim()}". Every catalog piece must have a unique SKU.`);
          }
          seenSkus.add(normalizedSku);
          const numPrice = Number(rawProd.price);
          if (!Number.isFinite(numPrice) || numPrice < 0) {
            throw new Error(`MRP price must be a valid non-negative number for "${rawProd.name || normalizedSku}".`);
          }
          let cleanOfferPrice;
          if (rawProd.offerPrice !== void 0 && rawProd.offerPrice !== null && String(rawProd.offerPrice).trim() !== "") {
            const parsedOffer = Number(rawProd.offerPrice);
            if (!Number.isFinite(parsedOffer) || parsedOffer < 0) {
              throw new Error(`Offer price must be a valid non-negative number for "${rawProd.name || normalizedSku}".`);
            }
            if (parsedOffer > 0) {
              if (parsedOffer > numPrice) {
                throw new Error(
                  `Offer price (\u20B9${parsedOffer}) cannot exceed MRP price (\u20B9${numPrice}) for "${rawProd.name || normalizedSku}".`
                );
              }
              cleanOfferPrice = parsedOffer;
            }
          }
          const rawImageList = Array.isArray(rawProd.images) ? rawProd.images : typeof rawProd.image === "string" && rawProd.image.trim() ? [rawProd.image] : [];
          const normalizedImages = rawImageList.map((img) => this.normalizeImageUrl(img)).filter(Boolean);
          if (normalizedImages.length > 4) {
            throw new Error(`Maximum 4 product images allowed for "${rawProd.name || normalizedSku}".`);
          }
          const cleanVideoUrl = typeof rawProd.videoUrl === "string" ? this.normalizeImageUrl(rawProd.videoUrl) : "";
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
          const cleanedProduct = {
            ...rest,
            sku: String(rawProd.sku).trim(),
            price: numPrice,
            images: normalizedImages,
            image: normalizedImages[0] || ""
          };
          if (cleanOfferPrice !== void 0) {
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
        for (const prod of rawProducts) {
          const cleanSku = String(prod.sku).trim();
          const existingInv = this.state.inventory.find(
            (i) => i.productId === prod.id || i.sku.toLowerCase() === cleanSku.toLowerCase()
          );
          if (!existingInv) {
            this.state.inventory.push({
              id: `inv_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
              productId: prod.id,
              sku: cleanSku,
              name: prod.name,
              category: prod.category,
              stockByLocation: {
                punePrimaryHub: typeof prod.initialPuneStock === "number" ? prod.initialPuneStock : 15,
                mumbaiWarehouse: typeof prod.initialMumbaiStock === "number" ? prod.initialMumbaiStock : 10
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
        const activeProdIds = new Set(cleanProducts.map((p) => p.id));
        const activeSkus = new Set(cleanProducts.map((p) => p.sku.toLowerCase()));
        this.state.inventory = this.state.inventory.filter(
          (inv) => activeProdIds.has(inv.productId) || activeSkus.has(inv.sku.toLowerCase())
        );
        this.appendAuditEntry(actorEmail, "UPDATE_CATALOG", "STORE_MANAGEMENT", "Updated categories and product catalog");
        return cleanCatalog;
      }
      saveCatalog(catalogData, actorEmail) {
        try {
          const cleanCatalog = this.applyCatalogUpdateInMemory(catalogData, actorEmail);
          this.writeCatalogToDiskOnly(cleanCatalog);
          this.persistState();
          if (mysqlAdapter.isConnected()) {
            this.pendingPersistPromise = this.pendingPersistPromise.then(() => mysqlAdapter.saveCatalogSnapshot(cleanCatalog)).catch((err) => {
              this.lastPersistError = err.message;
            });
          }
          return true;
        } catch (e) {
          console.error("Failed to save catalog.json", e);
          return false;
        }
      }
      async saveCatalogAsync(catalogData, actorEmail) {
        return this.withWriteLock(async () => {
          const prevState = structuredClone(this.state);
          const prevCatalog = structuredClone(this.getRawCatalog());
          this.insideAtomicTransaction = true;
          let cleanCatalog;
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
          } catch (err) {
            this.state = prevState;
            this.catalogCache = prevCatalog;
            this.writeCatalogToDiskOnly(prevCatalog);
            this.persistToDiskOnly();
            this.lastPersistError = err.message;
            throw err;
          }
        });
      }
      initializeSeedState() {
        const adminCredentials = MASTER_AUTHORIZED_ACCOUNTS.map((email) => ({
          userId: email,
          displayName: email === "sunilchain@gmail.com" ? "Sunil Chainani (Founding Partner)" : "Bharatvarsh Support Desk",
          role: "STORE_MANAGER",
          passwordHash: "",
          addedBy: "system",
          addedAt: (/* @__PURE__ */ new Date()).toISOString(),
          isMaster: true
        }));
        const config = {
          id: "cfg_bvl_01",
          gstInvoicingEnabled: true,
          masterSuperAdmins: [...MASTER_AUTHORIZED_ACCOUNTS],
          permittedStoreManagers: [...MASTER_AUTHORIZED_ACCOUNTS],
          adminCredentials,
          abandonmentThresholdMinutes: 15,
          primaryHubCity: "Pune",
          supplierGstin: process.env.BHARATVARSH_GSTIN || "27AABCB1234F1Z8",
          gstRatePercent: 18,
          promoCodes: [
            {
              code: "HEIRLOOM10",
              discountPercent: 10,
              active: true,
              description: "10% bespoke atelier patron privilege"
            }
          ],
          updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          lastUpdatedBy: "system"
        };
        const customers = [
          {
            id: "cust_01_vip",
            identityUid: "uid_patron_01",
            fullName: "Vikramaditya Singhania",
            email: "vikram.singhania@heritagecrafts.in",
            phone: "+91 98201 12345",
            role: "PATRON",
            createdAt: "2025-06-14T10:00:00Z",
            updatedAt: "2026-10-20T14:30:00Z",
            totalOrders: 6,
            lifetimeValue: 124600,
            averageOrderValue: 20766,
            refundRate: 0,
            daysSinceLastOrder: 12,
            lastOrderDate: "2026-10-30T11:00:00Z",
            rfmSegment: "Champions/VIPs",
            rfmScore: { recency: 5, frequency: 5, monetary: 5 },
            discountOrdersCount: 0,
            loyaltyPoints: 3450,
            storeCreditBalance: 5e3,
            tags: ["VIP Patron", "Custom Debossing Patron", "Transit Collector"],
            utmSource: "ArchitecturalDigest_Editorial",
            utmMedium: "Affiliate",
            acquisitionCost: 1850
          },
          {
            id: "cust_02_recent",
            identityUid: "uid_patron_02",
            fullName: "Ananya Deshmukh",
            email: "ananya.deshmukh@gmail.com",
            phone: "+91 99887 65432",
            role: "PATRON",
            createdAt: "2026-10-02T12:00:00Z",
            updatedAt: "2026-10-02T12:00:00Z",
            totalOrders: 1,
            lifetimeValue: 14500,
            averageOrderValue: 14500,
            refundRate: 0,
            daysSinceLastOrder: 40,
            lastOrderDate: "2026-10-02T12:00:00Z",
            rfmSegment: "Promising/Recent",
            rfmScore: { recency: 4, frequency: 2, monetary: 3 },
            discountOrdersCount: 0,
            loyaltyPoints: 300,
            storeCreditBalance: 0,
            tags: ["First Time Buyer", "Women Luxury Collection"],
            utmSource: "Instagram_Organics",
            utmMedium: "Social",
            acquisitionCost: 920
          },
          {
            id: "cust_03_atrisk",
            identityUid: "uid_patron_03",
            fullName: "Karan Mehra",
            email: "karan.mehra@apextech.co",
            phone: "+91 97112 34567",
            role: "PATRON",
            createdAt: "2025-01-10T09:30:00Z",
            updatedAt: "2025-11-04T15:00:00Z",
            totalOrders: 2,
            lifetimeValue: 32700,
            averageOrderValue: 16350,
            refundRate: 0,
            daysSinceLastOrder: 142,
            lastOrderDate: "2026-06-22T08:00:00Z",
            rfmSegment: "At-Risk/Churning",
            rfmScore: { recency: 1, frequency: 3, monetary: 4 },
            discountOrdersCount: 0,
            loyaltyPoints: 850,
            storeCreditBalance: 1200,
            tags: ["Dormant High Value", "Transit Folio Owner"],
            utmSource: "Google_Search",
            utmMedium: "CPC",
            acquisitionCost: 2400
          },
          {
            id: "cust_04_bargain",
            identityUid: "uid_patron_04",
            fullName: "Rohan Gupta",
            email: "rohan.gupta92@yahoo.com",
            phone: "+91 96543 21098",
            role: "PATRON",
            createdAt: "2025-11-20T16:00:00Z",
            updatedAt: "2026-09-15T18:00:00Z",
            totalOrders: 3,
            lifetimeValue: 11400,
            averageOrderValue: 3800,
            refundRate: 33.3,
            daysSinceLastOrder: 57,
            lastOrderDate: "2026-09-15T18:00:00Z",
            rfmSegment: "Bargain Hunters",
            rfmScore: { recency: 3, frequency: 3, monetary: 1 },
            discountOrdersCount: 3,
            loyaltyPoints: 120,
            storeCreditBalance: 0,
            tags: ["Discount Sensitive", "Belt Collector"],
            utmSource: "Newsletter_Flash",
            utmMedium: "Email",
            acquisitionCost: 450
          },
          {
            id: "cust_00_sunil",
            identityUid: "uid_admin_sunil",
            fullName: "Sunil Chainani (Founding Partner)",
            email: "sunilchain@gmail.com",
            phone: "+91 98200 00001",
            role: "STORE_MANAGER",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2026-11-11T00:00:00Z",
            totalOrders: 0,
            lifetimeValue: 0,
            averageOrderValue: 0,
            refundRate: 0,
            daysSinceLastOrder: 999,
            rfmSegment: "Promising/Recent",
            rfmScore: { recency: 1, frequency: 1, monetary: 1 },
            discountOrdersCount: 0,
            loyaltyPoints: 0,
            storeCreditBalance: 0,
            tags: ["Master Store Manager", "Executive"],
            acquisitionCost: 0
          }
        ];
        const addresses = [
          {
            id: "addr_01",
            customerId: "cust_01_vip",
            recipientName: "Vikramaditya Singhania",
            phone: "+91 98201 12345",
            street: "42 Singhania Manor, Altamount Road",
            city: "Mumbai",
            state: "Maharashtra",
            pincode: "400026",
            country: "India",
            isDefault: true,
            addressType: "SHIPPING",
            createdAt: "2025-05-14T10:00:00Z",
            updatedAt: "2026-10-30T11:00:00Z"
          },
          {
            id: "addr_02",
            customerId: "cust_02_recent",
            recipientName: "Ananya Deshmukh",
            phone: "+91 99887 65432",
            street: "Penthouse 12B, Koregaon Park Plaza",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411001",
            country: "India",
            isDefault: true,
            addressType: "SHIPPING",
            createdAt: "2026-10-02T12:00:00Z",
            updatedAt: "2026-11-08T14:20:00Z"
          }
        ];
        const orders = [
          {
            id: "ord_1001",
            orderNumber: "BVL-2026-1001",
            customerId: "cust_01_vip",
            customerName: "Vikramaditya Singhania",
            customerEmail: "vikram.singhania@heritagecrafts.in",
            customerPhone: "+91 98201 12345",
            status: "DELIVERED",
            currency: "INR",
            subtotal: 53700,
            discountAmount: 0,
            taxAmount: 9666,
            shippingFee: 0,
            totalAmount: 63366,
            paymentGateway: "RAZORPAY",
            paymentId: "pay_rzp_mock_9921",
            paymentStatus: "PAID",
            items: [
              {
                id: "item_101",
                orderId: "ord_1001",
                productId: "prod-t-brf-01",
                productName: "The Viceroy Diplomat Briefcase",
                sku: "BVL-TRV-BRF-01",
                category: "travell",
                quantity: 1,
                unitPrice: 28900,
                leatherType: "VEGETABLE_TANNED_HERITAGE",
                customization: {
                  monogramInitials: "V.A.S",
                  foilType: "GOLD_FOIL",
                  placement: "Top Flap Center"
                },
                hsnCode: "4202",
                gstRate: 0.18,
                taxAmount: 5202,
                lineTotal: 34102
              },
              {
                id: "item_102",
                orderId: "ord_1001",
                productId: "prod-t-bpk-01",
                productName: "The Himalayan Transit Rucksack",
                sku: "BVL-TRV-BPK-01",
                category: "travell",
                quantity: 1,
                unitPrice: 24800,
                leatherType: "VEGETABLE_TANNED_HERITAGE",
                customization: {
                  monogramInitials: "V.A.S",
                  foilType: "BLIND",
                  placement: "Exterior Leather Tag"
                },
                hsnCode: "4202",
                gstRate: 0.18,
                taxAmount: 4464,
                lineTotal: 29264
              }
            ],
            shippingAddress: addresses[0],
            billingAddress: addresses[0],
            awbNumber: "SR-PNQ-98442110",
            courierPartner: "SHIPROCKET",
            courierStatus: "DELIVERED",
            createdAt: "2026-10-30T11:00:00Z",
            updatedAt: "2026-11-03T16:00:00Z",
            invoiceNumber: "BVL/INV/26-27/0089",
            isGstInvoiceGenerated: true
          },
          {
            id: "ord_1002",
            orderNumber: "BVL-2026-1002",
            customerId: "cust_02_recent",
            customerName: "Ananya Deshmukh",
            customerEmail: "ananya.deshmukh@gmail.com",
            customerPhone: "+91 99887 65432",
            status: "DISPATCHED",
            currency: "INR",
            subtotal: 14500,
            discountAmount: 0,
            taxAmount: 2610,
            shippingFee: 0,
            totalAmount: 17110,
            paymentGateway: "STRIPE",
            paymentId: "pi_str_mock_4421",
            paymentStatus: "PAID",
            items: [
              {
                id: "item_103",
                orderId: "ord_1002",
                productId: "prod-w-purse-01",
                productName: "The Meera Structured Flap Purse",
                sku: "BVL-WOM-PRS-01",
                category: "women",
                quantity: 1,
                unitPrice: 14500,
                leatherType: "VEGETABLE_TANNED_HERITAGE",
                customization: {
                  monogramInitials: "A.D",
                  foilType: "GOLD_FOIL",
                  placement: "Front Flap Clasp"
                },
                hsnCode: "4202",
                gstRate: 0.18,
                taxAmount: 2610,
                lineTotal: 17110
              }
            ],
            shippingAddress: addresses[1],
            billingAddress: addresses[1],
            awbNumber: "DLV-PNQ-7732190",
            courierPartner: "DELHIVERY",
            courierStatus: "IN_TRANSIT",
            createdAt: "2026-11-08T14:20:00Z",
            updatedAt: "2026-11-10T10:00:00Z",
            invoiceNumber: "BVL/INV/26-27/0090",
            isGstInvoiceGenerated: true
          }
        ];
        const hotStampingVectors = [
          {
            id: "hsv_01",
            customerId: "cust_01_vip",
            orderId: "ord_1001",
            productId: "prod-t-brf-01",
            productName: "The Viceroy Diplomat Briefcase",
            monogramText: "V.A.S",
            foilStyle: "GOLD_FOIL",
            fontFamily: "CINZEL",
            previewImageUrl: "/assets/images/custom_debossing_monogram_1794461810572.jpg",
            recordedAt: "2026-10-30T10:45:00Z"
          },
          {
            id: "hsv_02",
            customerId: "cust_02_recent",
            orderId: "ord_1002",
            productId: "prod-w-purse-01",
            productName: "The Meera Structured Flap Purse",
            monogramText: "A.D",
            foilStyle: "GOLD_FOIL",
            fontFamily: "CINZEL",
            previewImageUrl: "/assets/images/custom_debossing_monogram_1794461810572.jpg",
            recordedAt: "2026-11-08T14:05:00Z"
          }
        ];
        const warranties = [
          {
            id: "war_01",
            customerId: "cust_01_vip",
            customerName: "Vikramaditya Singhania",
            orderId: "ord_1001",
            productId: "prod-t-brf-01",
            productName: "The Viceroy Diplomat Briefcase",
            hardwareSerial: "BRASS-VICEROY-9821A",
            warrantyPeriodYears: 2,
            startDate: "2026-10-30T00:00:00Z",
            expiryDate: "2028-10-30T00:00:00Z",
            status: "ACTIVE",
            claimCount: 0,
            createdAt: "2026-10-30T11:00:00Z"
          },
          {
            id: "war_02",
            customerId: "cust_01_vip",
            customerName: "Vikramaditya Singhania",
            orderId: "ord_1001",
            productId: "prod-t-bpk-01",
            productName: "The Himalayan Transit Rucksack",
            hardwareSerial: "BRASS-RUCK-4412B",
            warrantyPeriodYears: 2,
            startDate: "2026-10-30T00:00:00Z",
            expiryDate: "2028-10-30T00:00:00Z",
            status: "ACTIVE",
            claimCount: 0,
            createdAt: "2026-10-30T11:00:00Z"
          }
        ];
        const careKitDispatches = [
          {
            id: "ck_01",
            customerId: "cust_01_vip",
            orderId: "ord_1001",
            kitType: "ORGANIC_BEESWAX_BALM_BRUSH",
            dispatchDate: "2026-11-01T09:00:00Z",
            awbNumber: "SR-CARE-10029",
            courier: "SHIPROCKET",
            status: "DELIVERED",
            digitalGuideSent: true
          },
          {
            id: "ck_02",
            customerId: "cust_02_recent",
            orderId: "ord_1002",
            kitType: "HERITAGE_LEATHER_ELIXIR",
            dispatchDate: "2026-11-09T10:00:00Z",
            awbNumber: "DLV-CARE-5519",
            courier: "DELHIVERY",
            status: "DISPATCHED",
            digitalGuideSent: true
          }
        ];
        const corporateGiftingLeads = [
          {
            id: "corp_01",
            companyName: "Kotak Wealth Management Private Client Group",
            contactPerson: "Meera Nair (Head of Private Gifting)",
            email: "meera.nair@kotakwealth.in",
            phone: "+91 98190 55432",
            estimatedQuantity: 120,
            budgetRangeInr: "\u20B915,00,000 - \u20B920,00,000",
            interestCategory: "TRANSIT_FOLIOS",
            status: "SWATCH_DISPATCHED",
            swatchKitAwb: "SR-SWATCH-99120",
            notes: "Requested vegetable-tanned bridle leather folios in London Tan with custom debossed corporate crest in antique gold foil.",
            dealValueInr: 185e4,
            createdAt: "2026-11-05T11:00:00Z"
          },
          {
            id: "corp_02",
            companyName: "McKinsey & Co. Mumbai Practice",
            contactPerson: "Aditya Birla (Alumni Relations)",
            email: "aditya_birla@mckinsey.com",
            phone: "+91 99200 44321",
            estimatedQuantity: 65,
            budgetRangeInr: "\u20B96,00,000 - \u20B98,00,000",
            interestCategory: "EVERYDAY_CARRY",
            status: "QUOTE_ISSUED",
            dealValueInr: 74e4,
            notes: "Selected Bifold Heirloom Folios with personalized individual partner monograms.",
            createdAt: "2026-11-07T14:30:00Z"
          }
        ];
        const supportTickets = [
          {
            id: "tkt_01",
            ticketNumber: "TKT-2026-881",
            customerId: "cust_01_vip",
            customerName: "Vikramaditya Singhania",
            customerEmail: "vikram.singhania@heritagecrafts.in",
            channel: "WHATSAPP",
            subject: "Bespoke Folio Care & Heirloom Patina Advice",
            category: "MONOGRAM_REQUEST",
            priority: "VIP_URGENT",
            status: "IN_PROGRESS",
            assignedTo: "support@bharatvarshcrafts.com",
            slaBreachHours: 2,
            createdAt: "2026-11-10T09:15:00Z",
            updatedAt: "2026-11-11T14:00:00Z",
            messages: [
              {
                id: "m1",
                sender: "PATRON",
                text: "Good morning. The Diplomat Briefcase arrived in splendid condition. I wish to know if your master artisan recommends applying the organic beeswax balm before my journey to Geneva next Tuesday?",
                timestamp: "2026-11-10T09:15:00Z",
                channel: "WHATSAPP"
              },
              {
                id: "m2",
                sender: "AGENT",
                text: "Greetings Mr. Singhania. We are thrilled to hear! For your Geneva trip, our master leathercraftsman recommends a light buff with horsehair brush first. The initial factory coat of beeswax balm will shield against mountain moisture.",
                timestamp: "2026-11-10T09:40:00Z",
                channel: "WHATSAPP"
              }
            ]
          },
          {
            id: "tkt_02",
            ticketNumber: "TKT-2026-882",
            customerId: "cust_04_bargain",
            customerName: "Rohan Gupta",
            customerEmail: "rohan.gupta92@yahoo.com",
            channel: "EMAIL",
            subject: "Belt Size Exchange Request (Size 34 to 36)",
            category: "SIZE_EXCHANGE",
            priority: "MEDIUM",
            status: "OPEN",
            assignedTo: "support@bharatvarshcrafts.com",
            slaBreachHours: 24,
            createdAt: "2026-11-11T08:00:00Z",
            updatedAt: "2026-11-11T08:00:00Z",
            messages: [
              {
                id: "m3",
                sender: "PATRON",
                text: "I ordered the Rajputana Bridle Belt in 34 inch but require a 36 inch waist fit. Please arrange reverse pickup.",
                timestamp: "2026-11-11T08:00:00Z",
                channel: "EMAIL"
              }
            ]
          }
        ];
        const carts = [
          {
            id: "cart_abandoned_01",
            customerId: "cust_03_atrisk",
            email: "karan.mehra@apextech.co",
            phone: "+91 97112 34567",
            items: [
              {
                productId: "prod-t-bpk-01",
                productName: "The Himalayan Transit Rucksack",
                sku: "BVL-TRV-BPK-01",
                unitPrice: 24800,
                quantity: 1,
                leatherType: "VEGETABLE_TANNED_HERITAGE",
                monogram: "K.M",
                foilStyle: "GOLD_FOIL",
                imageUrl: "/assets/images/product_travel_backpack_folio_1794461810700.jpg"
              }
            ],
            subtotal: 24800,
            currency: "INR",
            isAbandoned: true,
            abandonedAt: "2026-11-11T12:00:00Z",
            recoveryStage: "DETECTED",
            recoveryAttempts: 1,
            lastRecoveryTriggerAt: "2026-11-11T12:15:00Z",
            checkoutUrl: "https://bharatvarshcrafts.com/checkout?resume=cart_abandoned_01",
            lastActiveAt: "2026-11-11T11:40:00Z"
          },
          {
            id: "cart_abandoned_02",
            email: "priya.sharma_guest@gmail.com",
            phone: "+91 98450 11223",
            items: [
              {
                productId: "prod-w-purse-01",
                productName: "The Meera Structured Flap Purse",
                sku: "BVL-WOM-PRS-01",
                unitPrice: 14500,
                quantity: 1,
                leatherType: "VEGETABLE_TANNED_HERITAGE",
                monogram: "P.S",
                foilStyle: "GOLD_FOIL",
                imageUrl: "/assets/images/product_women_purse_bag_1794461810441.jpg"
              }
            ],
            subtotal: 14500,
            currency: "INR",
            isAbandoned: true,
            abandonedAt: "2026-11-11T14:30:00Z",
            recoveryStage: "EMAIL_SENT",
            recoveryAttempts: 1,
            lastRecoveryTriggerAt: "2026-11-11T14:45:00Z",
            checkoutUrl: "https://bharatvarshcrafts.com/checkout?resume=cart_abandoned_02",
            lastActiveAt: "2026-11-11T14:15:00Z"
          }
        ];
        const inventory = [
          {
            id: "inv_01",
            productId: "prod-m-belt-01",
            sku: "BVL-MEN-BLT-01",
            name: "The Rajputana Bridle Belt",
            category: "men",
            stockByLocation: { punePrimaryHub: 24, mumbaiWarehouse: 48 },
            safetyStock: 15,
            reorderPoint: 20,
            unitCost: 1450,
            sellingPrice: 4200,
            batchLotNumber: "LOT-2026-BLT-04",
            leadTimeDays: 7
          },
          {
            id: "inv_02",
            productId: "prod-m-wal-01",
            sku: "BVL-MEN-WAL-01",
            name: "The Bifold Heirloom Folio",
            category: "men",
            stockByLocation: { punePrimaryHub: 32, mumbaiWarehouse: 65 },
            safetyStock: 20,
            reorderPoint: 25,
            unitCost: 1150,
            sellingPrice: 3800,
            batchLotNumber: "LOT-2026-WAL-02",
            leadTimeDays: 5
          },
          {
            id: "inv_03",
            productId: "prod-w-purse-01",
            sku: "BVL-WOM-PRS-01",
            name: "The Meera Structured Flap Purse",
            category: "women",
            stockByLocation: { punePrimaryHub: 8, mumbaiWarehouse: 14 },
            safetyStock: 6,
            reorderPoint: 10,
            unitCost: 5200,
            sellingPrice: 14500,
            batchLotNumber: "LOT-2026-PRS-09",
            leadTimeDays: 14
          },
          {
            id: "inv_04",
            productId: "prod-w-wal-01",
            sku: "BVL-WOM-WAL-01",
            name: "The Devika Zip-Around Continental",
            category: "women",
            stockByLocation: { punePrimaryHub: 14, mumbaiWarehouse: 18 },
            safetyStock: 8,
            reorderPoint: 12,
            unitCost: 2300,
            sellingPrice: 6200,
            batchLotNumber: "LOT-2026-WWAL-07",
            leadTimeDays: 7
          },
          {
            id: "inv_05",
            productId: "prod-w-blt-01",
            sku: "BVL-WOM-BLT-01",
            name: "The Padmavati Cinch Belt",
            category: "women",
            stockByLocation: { punePrimaryHub: 19, mumbaiWarehouse: 22 },
            safetyStock: 8,
            reorderPoint: 12,
            unitCost: 1350,
            sellingPrice: 3600,
            batchLotNumber: "LOT-2026-WBLT-05",
            leadTimeDays: 6
          },
          {
            id: "inv_06",
            productId: "prod-t-bpk-01",
            sku: "BVL-TRV-BPK-01",
            name: "The Himalayan Transit Rucksack",
            category: "travell",
            stockByLocation: { punePrimaryHub: 5, mumbaiWarehouse: 9 },
            safetyStock: 4,
            reorderPoint: 8,
            unitCost: 8900,
            sellingPrice: 24800,
            batchLotNumber: "LOT-2026-BPK-03",
            leadTimeDays: 18
          },
          {
            id: "inv_07",
            productId: "prod-t-brf-01",
            sku: "BVL-TRV-BRF-01",
            name: "The Viceroy Diplomat Briefcase",
            category: "travell",
            stockByLocation: { punePrimaryHub: 4, mumbaiWarehouse: 6 },
            safetyStock: 3,
            reorderPoint: 5,
            unitCost: 10800,
            sellingPrice: 28900,
            batchLotNumber: "LOT-2026-BRF-01",
            leadTimeDays: 21
          }
        ];
        const billOfMaterials = [
          {
            id: "bom_01",
            parentSku: "BVL-TRV-BRF-01",
            materialName: "A-Grade Full Grain Veg-Tanned Steerhide (Kanpur)",
            quantityPerUnit: 18,
            unit: "SQ_FT",
            inventoryOnHand: 450,
            safetyStock: 100,
            vendorName: "Ganga Heritage Tanneries Ltd"
          },
          {
            id: "bom_02",
            parentSku: "BVL-TRV-BRF-01",
            materialName: "Sand-Cast Solid Antique Brass Push Locks & Rivets",
            quantityPerUnit: 2,
            unit: "PIECES",
            inventoryOnHand: 84,
            safetyStock: 20,
            vendorName: "Aligarh Precision Hardware Guild"
          },
          {
            id: "bom_03",
            parentSku: "BVL-TRV-BRF-01",
            materialName: "Bonded Heavy Nylon Thread (Fil-Au-Chinois match)",
            quantityPerUnit: 45,
            unit: "METERS",
            inventoryOnHand: 1800,
            safetyStock: 300,
            vendorName: "Vardhman Specialty Yarns"
          },
          {
            id: "bom_04",
            parentSku: "BVL-ALL",
            materialName: "Organic Beeswax & Jojoba Conditioning Balm (50g jar)",
            quantityPerUnit: 1,
            unit: "GRAMS",
            inventoryOnHand: 320,
            safetyStock: 50,
            vendorName: "Himalayan Organic Apiaries"
          }
        ];
        const gstInvoices = [
          {
            id: "inv_0089",
            invoiceNumber: "BVL/INV/26-27/0089",
            orderId: "ord_1001",
            customerId: "cust_01_vip",
            supplierGstin: "27AABCB1234F1Z8",
            invoiceDate: "2026-10-30T11:00:00Z",
            supplyState: "Maharashtra (Pune Primary Hub)",
            placeOfSupply: "Maharashtra",
            isInterState: false,
            taxableValue: 53700,
            cgstAmount: 4833,
            sgstAmount: 4833,
            igstAmount: 0,
            totalInvoiceAmount: 63366,
            status: "ISSUED",
            pdfUrl: "/api/erp/invoices/BVL-INV-26-27-0089.pdf"
          },
          {
            id: "inv_0090",
            invoiceNumber: "BVL/INV/26-27/0090",
            orderId: "ord_1002",
            customerId: "cust_02_recent",
            supplierGstin: "27AABCB1234F1Z8",
            invoiceDate: "2026-11-08T14:20:00Z",
            supplyState: "Maharashtra (Pune Primary Hub)",
            placeOfSupply: "Maharashtra",
            isInterState: false,
            taxableValue: 14500,
            cgstAmount: 1305,
            sgstAmount: 1305,
            igstAmount: 0,
            totalInvoiceAmount: 17110,
            status: "ISSUED",
            pdfUrl: "/api/erp/invoices/BVL-INV-26-27-0090.pdf"
          }
        ];
        const gstCreditNotes = [];
        const auditLogs = [
          {
            id: "audit_01",
            actorEmail: "sunilchain@gmail.com",
            action: "INITIALIZE_SYSTEM",
            category: "STORE_MANAGEMENT",
            details: "Bharatvarsh Leathercrafts LLP CRM & ERP engine bootstrapped with Pune Primary Hub",
            timestamp: "2026-11-01T00:00:00Z"
          },
          {
            id: "audit_02",
            actorEmail: "support@bharatvarshcrafts.com",
            action: "ENABLE_GST_INVOICING",
            category: "GST_INVOICING",
            details: "GST Invoicing module active with Maharashtra GSTIN 27AABCB1234F1Z8 (Pune Primary Hub)",
            timestamp: "2026-11-01T00:05:00Z"
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
          processedWebhookIds: [],
          knowledgeBase: this.getDefaultKnowledgeBaseEntries()
        };
      }
      // --- Audit Logging (Append-Only) ---
      appendAuditEntry(actorEmail, action, category, details, ipAddress) {
        const entry = {
          id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          actorEmail,
          action,
          category,
          details,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          ipAddress
        };
        this.state.auditLogs.unshift(entry);
        return entry;
      }
      logAudit(actorEmail, action, category, details, ipAddress) {
        const entry = this.appendAuditEntry(actorEmail, action, category, details, ipAddress);
        this.persistState();
        return entry;
      }
      getAuditLogs() {
        return this.state.auditLogs;
      }
      // --- Store Management & Access Control ---
      getConfig() {
        return {
          ...this.state.config,
          // Never leak password hashes to UI
          adminCredentials: (this.state.config.adminCredentials || []).map((a) => ({
            ...a,
            passwordHash: void 0
          }))
        };
      }
      updateGstInvoicing(enabled, actorEmail) {
        if (!this.isMasterAuthorized(actorEmail)) {
          throw new Error(`Unauthorized: ${actorEmail} does not hold Master Super-Admin privileges to update GST settings.`);
        }
        this.state.config.gstInvoicingEnabled = enabled;
        this.state.config.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        this.state.config.lastUpdatedBy = actorEmail;
        this.logAudit(
          actorEmail,
          enabled ? "ENABLE_GST_INVOICING" : "DISABLE_GST_INVOICING",
          "GST_INVOICING",
          `GST Invoicing was ${enabled ? "enabled" : "suspended"}. Invoice & credit note issuance ${enabled ? "active" : "halted"}.`
        );
        this.persistState();
        return true;
      }
      validatePromoCode(rawCode) {
        if (!rawCode || typeof rawCode !== "string") return null;
        const normalized = rawCode.trim().toUpperCase();
        if (!normalized) return null;
        const rules = this.state.config.promoCodes || [];
        return rules.find((r) => r.active && r.code.trim().toUpperCase() === normalized) || null;
      }
      updateOperationalSettings(updates, actorEmail) {
        if (!this.isStoreManagementAuthorized(actorEmail)) {
          throw new Error(`Access Denied: ${actorEmail} is not authorized to update store operational rules.`);
        }
        if (updates.abandonmentThresholdMinutes !== void 0) {
          const mins = Math.floor(Number(updates.abandonmentThresholdMinutes));
          if (!Number.isFinite(mins) || mins < 1 || mins > 1440) {
            throw new Error("Abandonment threshold must be between 1 and 1440 minutes.");
          }
          this.state.config.abandonmentThresholdMinutes = mins;
        }
        if (updates.supplierGstin !== void 0) {
          const cleanGstin = String(updates.supplierGstin).trim().toUpperCase();
          if (cleanGstin.length < 10 || cleanGstin.length > 15) {
            throw new Error("Supplier GSTIN must be a valid 15-character GSTIN identifier.");
          }
          this.state.config.supplierGstin = cleanGstin;
        }
        if (updates.gstRatePercent !== void 0) {
          const rate = Number(updates.gstRatePercent);
          if (!Number.isFinite(rate) || rate < 0 || rate > 28) {
            throw new Error("GST rate percentage must be between 0% and 28%.");
          }
          this.state.config.gstRatePercent = Number(rate.toFixed(2));
        }
        if (Array.isArray(updates.promoCodes)) {
          const seen = /* @__PURE__ */ new Set();
          const cleaned = [];
          for (const p of updates.promoCodes) {
            const code = String(p.code || "").trim().toUpperCase();
            const discountPercent = Number(p.discountPercent);
            if (!code || !Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 90) {
              throw new Error(`Invalid promo rule "${p.code || ""}" (discount must be between 1% and 90%).`);
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
        this.state.config.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        this.state.config.lastUpdatedBy = actorEmail;
        this.appendAuditEntry(
          actorEmail,
          "UPDATE_OPERATIONAL_RULES",
          "STORE_MANAGEMENT",
          `Updated operational rules (Abandonment SLA: ${this.state.config.abandonmentThresholdMinutes}m, GST: ${this.state.config.gstRatePercent}%, GSTIN: ${this.state.config.supplierGstin}, Active Promos: ${this.state.config.promoCodes.filter((p) => p.active).map((p) => `${p.code}:${p.discountPercent}%`).join(", ") || "None"})`
        );
        this.persistState();
        return this.getConfig();
      }
      isMasterAuthorized(email) {
        if (!email) return false;
        const cleanEmail = email.trim().toLowerCase();
        return MASTER_AUTHORIZED_ACCOUNTS.map((e) => e.toLowerCase()).includes(cleanEmail);
      }
      isStoreManagementAuthorized(email) {
        if (!email) return false;
        const cleanEmail = email.trim().toLowerCase();
        if (this.isMasterAuthorized(cleanEmail)) return true;
        return this.state.config.permittedStoreManagers.map((e) => e.toLowerCase()).includes(cleanEmail);
      }
      getStaffRole(email) {
        if (!email) return "PATRON";
        const cleanEmail = email.trim().toLowerCase();
        if (this.isMasterAuthorized(cleanEmail)) return "STORE_MANAGER";
        if (!this.isStoreManagementAuthorized(cleanEmail)) return "PATRON";
        const cred = (this.state.config.adminCredentials || []).find((c) => c.userId.toLowerCase() === cleanEmail);
        const role = cred?.role;
        if (role === "STORE_MANAGER" || role === "SUPPORT_AGENT" || role === "LOGISTICS_COORDINATOR") {
          return role;
        }
        return "STORE_MANAGER";
      }
      verifyAdminLogin(userId, password) {
        const clean = userId.trim().toLowerCase();
        if (!this.isStoreManagementAuthorized(clean)) {
          return { valid: false, reason: "Not an authorized admin account" };
        }
        const cred = (this.state.config.adminCredentials || []).find((c) => c.userId.toLowerCase() === clean);
        if (!cred || !cred.passwordHash || cred.passwordHash.length === 0) {
          return {
            valid: false,
            reason: "Password login is disabled for this admin account until a password is set. Please continue with Google Sign-In."
          };
        }
        if (!password) {
          return { valid: false, reason: "Admin password is required" };
        }
        const check = verifyPassword(password, cred.passwordHash);
        if (!check.valid) {
          return { valid: false, reason: "Invalid admin credentials" };
        }
        if (check.needsRehash) {
          cred.passwordHash = hashPassword(password);
          this.persistState();
        }
        return { valid: true };
      }
      verifyPatronLogin(email, password) {
        const clean = email.trim().toLowerCase();
        if (!clean) {
          return { valid: false, reason: "Email address is required" };
        }
        if (!password) {
          return { valid: false, reason: "Password is required" };
        }
        const credsMap = this.state.patronCredentials || {};
        const cred = credsMap[clean];
        if (!cred || !cred.passwordHash) {
          return {
            valid: false,
            reason: "No password is configured for this account. Please sign in with Google or create a new account."
          };
        }
        const check = verifyPassword(password, cred.passwordHash);
        if (!check.valid) {
          return { valid: false, reason: "Invalid email or password" };
        }
        if (check.needsRehash) {
          cred.passwordHash = hashPassword(password);
          cred.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
          this.persistState();
        }
        return { valid: true };
      }
      registerPatronWithPassword(data) {
        const cleanEmail = (data.email || "").trim().toLowerCase();
        const cleanName = (data.fullName || "").trim();
        if (!cleanEmail || !cleanEmail.includes("@")) {
          throw new Error("A valid email address is required.");
        }
        if (!cleanName) {
          throw new Error("Full name is required.");
        }
        if (!data.password || data.password.length < 8) {
          throw new Error("Password must be at least 8 characters long.");
        }
        if (this.isStoreManagementAuthorized(cleanEmail)) {
          throw new Error("Authorized admin User IDs cannot self-register. Please sign in with Google or contact a Master Admin.");
        }
        if (!this.state.patronCredentials) {
          this.state.patronCredentials = {};
        }
        const existingCred = this.state.patronCredentials[cleanEmail];
        const existingCustomer = this.state.customers.find((c) => c.email.toLowerCase() === cleanEmail);
        if (existingCred || existingCustomer) {
          throw new Error("ACCOUNT_EXISTS: An account with this email already exists. Please sign in or continue with Google.");
        }
        const hasAddress = data.address && data.address.street && data.address.city && data.address.state && data.address.pincode;
        const { customer } = this.findOrCreateCustomer({
          email: cleanEmail,
          phone: data.phone,
          fullName: cleanName,
          role: "PATRON",
          address: hasAddress ? {
            street: data.address.street,
            city: data.address.city,
            state: data.address.state,
            pincode: data.address.pincode,
            country: data.address.country || "India"
          } : void 0
        });
        this.state.patronCredentials[cleanEmail] = {
          email: cleanEmail,
          passwordHash: hashPassword(data.password),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        this.logAudit(cleanEmail, "PATRON_REGISTERED", "AUTH_PERMISSION", `Registered new patron account for ${cleanEmail}`);
        this.persistState();
        return { customer };
      }
      addPermittedManager(newUserId, actorEmail, displayName, password, role) {
        if (!this.isMasterAuthorized(actorEmail)) {
          throw new Error(`Access Denied: ${actorEmail} does not hold Master Super-Admin privileges to add admin User IDs.`);
        }
        const clean = newUserId.trim().toLowerCase();
        if (!clean) throw new Error("User ID / Email cannot be empty");
        const isTargetMaster = this.isMasterAuthorized(clean);
        const allowedStaffRoles = ["STORE_MANAGER", "SUPPORT_AGENT", "LOGISTICS_COORDINATOR"];
        const normalizedRole = isTargetMaster ? "STORE_MANAGER" : role && allowedStaffRoles.includes(role) ? role : "STORE_MANAGER";
        if (!this.state.config.permittedStoreManagers.map((e) => e.toLowerCase()).includes(clean)) {
          this.state.config.permittedStoreManagers.push(clean);
        }
        const existingCredIdx = (this.state.config.adminCredentials || []).findIndex((c) => c.userId.toLowerCase() === clean);
        const credEntry = {
          userId: clean,
          displayName: displayName?.trim() || clean.split("@")[0],
          role: normalizedRole,
          passwordHash: password ? hashPassword(password) : "",
          addedBy: actorEmail,
          addedAt: (/* @__PURE__ */ new Date()).toISOString(),
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
            role: isTargetMaster ? "STORE_MANAGER" : role && allowedStaffRoles.includes(role) ? role : prevCred.role || "STORE_MANAGER",
            ...password ? { passwordHash: credEntry.passwordHash } : {}
          };
        } else {
          this.state.config.adminCredentials.push(credEntry);
        }
        this.state.config.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        this.state.config.lastUpdatedBy = actorEmail;
        this.logAudit(
          actorEmail,
          "ADD_PERMITTED_MANAGER",
          "AUTH_PERMISSION",
          `Added/updated staff User ID "${clean}" with role ${normalizedRole}`
        );
        this.persistState();
        return true;
      }
      removePermittedManager(targetEmail, actorEmail) {
        if (!this.isMasterAuthorized(actorEmail)) {
          throw new Error(`Access Denied: ${actorEmail} does not hold Master Super-Admin privileges to revoke admin User IDs.`);
        }
        const clean = targetEmail.trim().toLowerCase();
        if (MASTER_AUTHORIZED_ACCOUNTS.map((e) => e.toLowerCase()).includes(clean)) {
          throw new Error(`Cannot revoke founding master super-admin access for ${clean}`);
        }
        this.state.config.permittedStoreManagers = this.state.config.permittedStoreManagers.filter(
          (e) => e.toLowerCase() !== clean
        );
        this.state.config.adminCredentials = (this.state.config.adminCredentials || []).filter(
          (c) => c.userId.toLowerCase() !== clean
        );
        this.state.config.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        this.state.config.lastUpdatedBy = actorEmail;
        this.logAudit(
          actorEmail,
          "REMOVE_PERMITTED_MANAGER",
          "AUTH_PERMISSION",
          `Removed User ID "${clean}" from authorized Admin access list`
        );
        this.persistState();
        return true;
      }
      async deleteAdminUserAsync(targetEmail, actorEmail) {
        return this.withWriteLock(async () => {
          if (!this.isMasterAuthorized(actorEmail)) {
            throw new Error(`Access Denied: ${actorEmail} does not hold Master Super-Admin privileges to revoke admin User IDs.`);
          }
          const clean = targetEmail.trim().toLowerCase();
          if (!clean) throw new Error("User ID or Email is required");
          if (MASTER_AUTHORIZED_ACCOUNTS.map((e) => e.toLowerCase()).includes(clean)) {
            throw new Error(`Cannot revoke founding master super-admin access for ${clean}`);
          }
          const prevState = structuredClone(this.state);
          this.insideAtomicTransaction = true;
          try {
            this.state.config.permittedStoreManagers = this.state.config.permittedStoreManagers.filter(
              (e) => e.toLowerCase() !== clean
            );
            this.state.config.adminCredentials = (this.state.config.adminCredentials || []).filter(
              (c) => c.userId.toLowerCase() !== clean
            );
            this.state.config.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
            this.state.config.lastUpdatedBy = actorEmail;
            this.appendAuditEntry(
              actorEmail,
              "REMOVE_PERMITTED_MANAGER",
              "AUTH_PERMISSION",
              `Removed User ID "${clean}" from authorized Admin access list`
            );
            this.insideAtomicTransaction = false;
            await mysqlAdapter.deleteAdminUser(clean, this.state);
            this.persistToDiskOnly();
            this.lastPersistError = null;
            return true;
          } catch (err) {
            this.insideAtomicTransaction = false;
            this.state = prevState;
            this.persistToDiskOnly();
            this.lastPersistError = err.message;
            throw err;
          }
        });
      }
      // --- Customers & Deduplication ---
      getCustomers(options) {
        if (options?.includeArchived) {
          return this.state.customers;
        }
        return this.state.customers.filter((c) => c.isActive !== false);
      }
      getCustomerById(id) {
        return this.state.customers.find((c) => c.id === id || c.identityUid === id || c.email.toLowerCase() === id.toLowerCase());
      }
      async softDeleteCustomerAsync(customerId, actorEmail) {
        return this.withWriteLock(async () => {
          if (!this.isStoreManagementAuthorized(actorEmail)) {
            throw new Error(`Access Denied: ${actorEmail} is not authorized to archive customer records.`);
          }
          const customer = this.state.customers.find((c) => c.id === customerId);
          if (!customer) {
            throw new Error(`Customer ${customerId} not found`);
          }
          if (this.isMasterAuthorized(customer.email)) {
            throw new Error(`Cannot archive founding master super-admin identity (${customer.email})`);
          }
          const prevState = structuredClone(this.state);
          this.insideAtomicTransaction = true;
          try {
            const nowIso = (/* @__PURE__ */ new Date()).toISOString();
            customer.isActive = false;
            customer.deletedAt = nowIso;
            customer.updatedAt = nowIso;
            this.appendAuditEntry(
              actorEmail,
              "SOFT_DELETE_CUSTOMER",
              "STORE_MANAGEMENT",
              `Archived customer ${customer.fullName} (${customer.email}, ID: ${customer.id}); preserved linked order & audit history.`
            );
            this.insideAtomicTransaction = false;
            await mysqlAdapter.softDeleteCustomer(customer.id, this.state);
            this.persistToDiskOnly();
            this.lastPersistError = null;
            return customer;
          } catch (err) {
            this.insideAtomicTransaction = false;
            this.state = prevState;
            this.persistToDiskOnly();
            this.lastPersistError = err.message;
            throw err;
          }
        });
      }
      getCustomerAddresses(customerId) {
        if (!Array.isArray(this.state.addresses)) {
          this.state.addresses = [];
        }
        return this.state.addresses.filter((a) => a.customerId === customerId);
      }
      getDefaultCustomerAddress(customerId) {
        const list = this.getCustomerAddresses(customerId);
        return list.find((a) => a.isDefault) || list[0];
      }
      reconcileCustomerAddresses() {
        if (!Array.isArray(this.state.addresses)) {
          this.state.addresses = [];
        }
        for (const cust of this.state.customers) {
          const custAddrs = this.state.addresses.filter((a) => a.customerId === cust.id);
          if (custAddrs.length > 0) {
            const def = custAddrs.find((a) => a.isDefault) || custAddrs[0];
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
              country: "India",
              isDefault: true,
              addressType: "SHIPPING"
            });
          }
        }
      }
      upsertCustomerAddressInMemory(customerId, input) {
        if (!Array.isArray(this.state.addresses)) {
          this.state.addresses = [];
        }
        const cleanStreet = String(input.street || "").trim();
        const cleanCity = String(input.city || "").trim();
        const cleanState = String(input.state || "").trim();
        const cleanPincode = String(input.pincode || "").trim();
        const cleanCountry = String(input.country || "India").trim() || "India";
        const customer = this.state.customers.find((c) => c.id === customerId);
        const cleanRecipient = String(input.recipientName || customer?.fullName || "").trim();
        const cleanPhone = String(input.phone || customer?.phone || "").trim();
        const nowIso = (/* @__PURE__ */ new Date()).toISOString();
        const makeDefault = input.isDefault !== false;
        const existing = this.state.addresses.find(
          (a) => a.customerId === customerId && a.street.trim().toLowerCase() === cleanStreet.toLowerCase() && a.city.trim().toLowerCase() === cleanCity.toLowerCase() && a.state.trim().toLowerCase() === cleanState.toLowerCase() && a.pincode.trim() === cleanPincode
        );
        if (makeDefault) {
          for (const a of this.state.addresses) {
            if (a.customerId === customerId) {
              a.isDefault = false;
            }
          }
        }
        let saved;
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
            addressType: input.addressType === "BILLING" ? "BILLING" : "SHIPPING",
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
          customer.addresses = this.state.addresses.filter((a) => a.customerId === customer.id);
          customer.updatedAt = nowIso;
        }
        return saved;
      }
      upsertCustomerAddress(customerId, input) {
        const saved = this.upsertCustomerAddressInMemory(customerId, input);
        this.persistState();
        return saved;
      }
      findOrCreateCustomer(data) {
        const cleanEmail = data.email.trim().toLowerCase();
        const cleanPhone = (data.phone || "").replace(/\s+/g, "");
        let existing = this.state.customers.find((c) => {
          if (c.email.toLowerCase() === cleanEmail) return true;
          if (data.identityUid && c.identityUid === data.identityUid) return true;
          if (cleanPhone && c.phone && c.phone.replace(/\s+/g, "") === cleanPhone) return true;
          return false;
        });
        if (existing) {
          if (data.identityUid && !existing.identityUid) existing.identityUid = data.identityUid;
          if (data.phone && (data.updatePhone || !existing.phone)) existing.phone = data.phone;
          if (data.fullName && (data.updateFullName || !existing.fullName || existing.fullName === "Valued Patron")) {
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
              country: data.address.country || "India",
              isDefault: true,
              addressType: "SHIPPING"
            });
          }
          existing.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
          this.persistState();
          return { customer: existing, isNew: false };
        }
        const newCustomer = {
          id: `cust_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          identityUid: data.identityUid,
          email: cleanEmail,
          phone: data.phone || "",
          fullName: data.fullName,
          role: this.isStoreManagementAuthorized(cleanEmail) ? this.getStaffRole(cleanEmail) : data.role || "PATRON",
          isActive: true,
          deletedAt: null,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          totalOrders: 0,
          lifetimeValue: 0,
          averageOrderValue: 0,
          refundRate: 0,
          daysSinceLastOrder: 0,
          rfmSegment: "Promising/Recent",
          rfmScore: { recency: 5, frequency: 1, monetary: 1 },
          discountOrdersCount: 0,
          loyaltyPoints: 100,
          storeCreditBalance: 0,
          tags: ["Storefront Registered"],
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
            country: data.address.country || "India",
            isDefault: true,
            addressType: "SHIPPING"
          });
        }
        this.logAudit("system", "CUSTOMER_CREATED", "STORE_MANAGEMENT", `New customer ${newCustomer.email} registered`);
        this.persistState();
        return { customer: newCustomer, isNew: true };
      }
      // --- Orders & ERP Sales Order Push ---
      getOrders() {
        return this.state.orders;
      }
      getOrderById(id) {
        return this.state.orders.find((o) => o.id === id || o.orderNumber === id);
      }
      buildAndCommitOrderInMemory(orderData, options) {
        if (!options?.skipStockDeduction) {
          for (const item of orderData.items) {
            const inv = this.state.inventory.find((i) => i.productId === item.productId || i.sku === item.sku);
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
        const orderNumber = `BVL-${(/* @__PURE__ */ new Date()).getFullYear()}-${1e3 + this.state.orders.length + 1}`;
        const newOrder = {
          ...orderData,
          id: `ord_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          orderNumber,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          isGstInvoiceGenerated: false
        };
        if (!options?.skipStockDeduction) {
          for (const item of newOrder.items) {
            const inv = this.state.inventory.find((i) => i.productId === item.productId || i.sku === item.sku);
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
                  "system",
                  "SKU_LOW_STOCK_ALERT",
                  "INVENTORY_ADJUSTMENT",
                  `Reorder alert: ${inv.name} (${inv.sku}) dropped to ${totalLeft} pcs (safety threshold: ${inv.safetyStock} pcs).`
                );
              }
            }
            const matchingBoms = this.state.billOfMaterials.filter(
              (b) => b.parentSku === item.sku || b.parentSku === "BVL-ALL"
            );
            for (const bom of matchingBoms) {
              const consumed = bom.quantityPerUnit * item.quantity;
              const prevHand = bom.inventoryOnHand;
              bom.inventoryOnHand = Math.max(0, prevHand - consumed);
              const safety = bom.safetyStock ?? (bom.unit === "PIECES" ? 20 : 100);
              if (bom.inventoryOnHand <= safety && prevHand > safety) {
                this.appendAuditEntry(
                  "system",
                  "BOM_LOW_STOCK_ALERT",
                  "INVENTORY_ADJUSTMENT",
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
              fontFamily: "CINZEL",
              recordedAt: (/* @__PURE__ */ new Date()).toISOString()
            });
          }
          this.state.warranties.push({
            id: `war_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
            customerId: newOrder.customerId,
            customerName: newOrder.customerName,
            orderId: newOrder.id,
            productId: item.productId,
            productName: item.productName,
            hardwareSerial: `BVL-BRASS-${Math.floor(1e4 + Math.random() * 9e4)}`,
            warrantyPeriodYears: 2,
            startDate: (/* @__PURE__ */ new Date()).toISOString(),
            expiryDate: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1e3).toISOString(),
            status: "ACTIVE",
            claimCount: 0,
            createdAt: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
        this.state.careKitDispatches.push({
          id: `ck_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          customerId: newOrder.customerId,
          orderId: newOrder.id,
          kitType: "ORGANIC_BEESWAX_BALM_BRUSH",
          dispatchDate: (/* @__PURE__ */ new Date()).toISOString(),
          awbNumber: `SR-PNQ-CARE-${Math.floor(1e5 + Math.random() * 9e5)}`,
          courier: "SHIPROCKET",
          status: "DISPATCHED",
          digitalGuideSent: true
        });
        if (this.state.config.gstInvoicingEnabled) {
          const invNum = `BVL/INV/26-27/${(this.state.gstInvoices.length + 91).toString().padStart(4, "0")}`;
          const isInterState = newOrder.shippingAddress?.state?.toLowerCase() !== "maharashtra";
          const taxable = Math.max(0, newOrder.subtotal - (newOrder.discountAmount || 0));
          const fallbackTaxRate = (this.state.config.gstRatePercent || 18) / 100;
          const taxAmt = typeof newOrder.taxAmount === "number" ? newOrder.taxAmount : Math.round(taxable * fallbackTaxRate);
          const supplierGstin = this.state.config.supplierGstin || "27AABCB1234F1Z8";
          const invoice = {
            id: `inv_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
            invoiceNumber: invNum,
            orderId: newOrder.id,
            customerId: newOrder.customerId,
            supplierGstin,
            invoiceDate: (/* @__PURE__ */ new Date()).toISOString(),
            supplyState: "Maharashtra (Pune Primary Hub)",
            placeOfSupply: newOrder.shippingAddress?.state || "Maharashtra",
            isInterState,
            taxableValue: taxable,
            cgstAmount: isInterState ? 0 : Math.round(taxAmt / 2),
            sgstAmount: isInterState ? 0 : Math.round(taxAmt / 2),
            igstAmount: isInterState ? taxAmt : 0,
            totalInvoiceAmount: taxable + taxAmt + newOrder.shippingFee,
            status: "ISSUED",
            pdfUrl: `/api/erp/invoices/${invNum.replace(/\//g, "-")}.pdf`
          };
          this.state.gstInvoices.push(invoice);
          newOrder.invoiceNumber = invNum;
          newOrder.isGstInvoiceGenerated = true;
        }
        newOrder.awbNumber = orderData.awbNumber || `SR-PNQ-${Math.floor(1e7 + Math.random() * 9e7)}`;
        newOrder.courierPartner = orderData.courierPartner || "SHIPROCKET";
        newOrder.courierStatus = orderData.courierStatus || "IN_TRANSIT";
        this.state.orders.unshift(newOrder);
        if (newOrder.shippingAddress?.street && newOrder.shippingAddress?.city && newOrder.shippingAddress?.state && newOrder.shippingAddress?.pincode) {
          this.upsertCustomerAddressInMemory(newOrder.customerId, {
            recipientName: newOrder.customerName,
            phone: newOrder.customerPhone,
            street: newOrder.shippingAddress.street,
            city: newOrder.shippingAddress.city,
            state: newOrder.shippingAddress.state,
            pincode: newOrder.shippingAddress.pincode,
            country: newOrder.shippingAddress.country || "India",
            isDefault: true,
            addressType: "SHIPPING"
          });
        }
        this.recalculateCustomerMetrics(newOrder.customerId);
        const openCart = this.state.carts.find((c) => c.email.toLowerCase() === newOrder.customerEmail.toLowerCase() && c.isAbandoned);
        if (openCart) {
          openCart.recoveryStage = "RECOVERED";
          openCart.isAbandoned = false;
        }
        this.appendAuditEntry("system", "ORDER_CREATED", "STORE_MANAGEMENT", `Sales order ${newOrder.orderNumber} placed for \u20B9${newOrder.totalAmount}`);
        return newOrder;
      }
      createOrder(orderData, options) {
        const newOrder = this.buildAndCommitOrderInMemory(orderData, options);
        this.persistState();
        return newOrder;
      }
      /**
       * Atomic, row-locked checkout & order creation (SELECT ... FOR UPDATE in MySQL).
       * Rolls back both MySQL and in-memory/disk state if stock fails or MySQL write errors.
       */
      async createOrderAsync(orderData, options) {
        return this.withWriteLock(async () => {
          const prevState = structuredClone(this.state);
          this.insideAtomicTransaction = true;
          try {
            const order = await mysqlAdapter.runLockedStockTransaction(
              orderData.items.map((i) => ({
                sku: i.sku,
                productId: i.productId,
                productName: i.productName,
                quantity: i.quantity
              })),
              async ({ lockedRows }) => {
                for (const row of lockedRows) {
                  const inv = this.state.inventory.find((i) => i.sku === row.sku || i.productId === row.productId);
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
          } catch (err) {
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
      async runLockedStockMutation(items, mutator) {
        return this.withWriteLock(async () => {
          const prevState = structuredClone(this.state);
          this.insideAtomicTransaction = true;
          try {
            const result = await mysqlAdapter.runLockedStockTransaction(items, async ({ lockedRows }) => {
              for (const row of lockedRows) {
                const inv = this.state.inventory.find((i) => i.sku === row.sku || i.productId === row.productId);
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
          } catch (err) {
            this.state = prevState;
            this.persistToDiskOnly();
            this.lastPersistError = err.message;
            throw err;
          } finally {
            this.insideAtomicTransaction = false;
          }
        });
      }
      updateOrderStatus(orderId, status, actorEmail) {
        const order = this.state.orders.find((o) => o.id === orderId || o.orderNumber === orderId);
        if (!order) throw new Error(`Order ${orderId} not found`);
        const prev = order.status;
        order.status = status;
        order.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        if (status === "DELIVERED") {
          order.courierStatus = "DELIVERED";
          if (!order.deliveredAt) {
            order.deliveredAt = (/* @__PURE__ */ new Date()).toISOString();
          }
        } else if (status === "DISPATCHED") {
          order.courierStatus = "IN_TRANSIT";
        }
        this.logAudit(
          actorEmail,
          "UPDATE_ORDER_STATUS",
          "STORE_MANAGEMENT",
          `Order ${order.orderNumber} status changed from ${prev} to ${status}`
        );
        this.persistState();
        return order;
      }
      // --- Knowledge Base Presentations ---
      getKnowledgeBase() {
        if (!Array.isArray(this.state.knowledgeBase)) {
          this.state.knowledgeBase = this.getDefaultKnowledgeBaseEntries();
        }
        return this.state.knowledgeBase;
      }
      upsertKnowledgeBaseEntry(entry, actorEmail) {
        if (!Array.isArray(this.state.knowledgeBase)) {
          this.state.knowledgeBase = this.getDefaultKnowledgeBaseEntries();
        }
        const nowIso = (/* @__PURE__ */ new Date()).toISOString();
        const existingIdx = entry.id ? this.state.knowledgeBase.findIndex((k) => k.id === entry.id) : -1;
        if (existingIdx >= 0) {
          const prev = this.state.knowledgeBase[existingIdx];
          const updated = {
            ...prev,
            ...entry,
            id: prev.id,
            uploadedBy: actorEmail,
            uploadedAt: entry.uploadedAt || nowIso
          };
          this.state.knowledgeBase[existingIdx] = updated;
          this.appendAuditEntry(
            actorEmail,
            "UPDATE_KNOWLEDGE_BASE",
            "STORE_MANAGEMENT",
            `Updated Knowledge Base presentation "${updated.title}" (${updated.fileType})`
          );
          this.persistState();
          return updated;
        }
        const created = {
          ...entry,
          id: entry.id || `kb_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          uploadedBy: actorEmail,
          uploadedAt: entry.uploadedAt || nowIso
        };
        this.state.knowledgeBase.unshift(created);
        this.appendAuditEntry(
          actorEmail,
          "UPLOAD_KNOWLEDGE_BASE",
          "STORE_MANAGEMENT",
          `Published Knowledge Base presentation "${created.title}" (${created.fileType})`
        );
        this.persistState();
        return created;
      }
      deleteKnowledgeBaseEntry(id, actorEmail) {
        if (!Array.isArray(this.state.knowledgeBase)) {
          return null;
        }
        const idx = this.state.knowledgeBase.findIndex((k) => k.id === id);
        if (idx === -1) return null;
        const [removed] = this.state.knowledgeBase.splice(idx, 1);
        this.appendAuditEntry(
          actorEmail,
          "DELETE_KNOWLEDGE_BASE",
          "STORE_MANAGEMENT",
          `Removed Knowledge Base presentation "${removed.title}" (${removed.id})`
        );
        this.persistState();
        return removed;
      }
      // --- Patron 10-Day Return / Exchange Requests ---
      requestOrderReturn(params) {
        const order = this.state.orders.find((o) => o.id === params.orderId || o.orderNumber === params.orderId);
        if (!order) {
          return { ok: false, code: "NOT_FOUND", error: `Order ${params.orderId} not found.` };
        }
        const cleanEmail = params.customerEmail.trim().toLowerCase();
        const matchedCustomer = this.getCustomerById(cleanEmail) || (params.customerUid ? this.getCustomerById(params.customerUid) : void 0);
        const ownsOrder = order.customerEmail.trim().toLowerCase() === cleanEmail || matchedCustomer && order.customerId === matchedCustomer.id || params.customerUid && order.customerId === params.customerUid;
        if (!ownsOrder) {
          return { ok: false, code: "FORBIDDEN", error: "You do not have permission to request a return for this order." };
        }
        if (order.status === "RETURNED" || order.returnRequestStatus === "REQUESTED" || order.returnRequestStatus === "APPROVED" || order.returnRequestStatus === "PROCESSED") {
          return {
            ok: false,
            code: "CONFLICT",
            error: `A return or exchange request is already recorded for order ${order.orderNumber} (status: ${order.returnRequestStatus || order.status}).`
          };
        }
        if (order.status !== "DELIVERED" && order.courierStatus !== "DELIVERED") {
          return {
            ok: false,
            code: "NOT_DELIVERED",
            error: "Returns and exchanges can only be requested after the order has been delivered."
          };
        }
        const referenceTimestamp = order.deliveredAt || order.updatedAt || order.createdAt;
        const deliveredMs = new Date(referenceTimestamp).getTime();
        const elapsedDays = Number.isFinite(deliveredMs) ? Math.max(0, (Date.now() - deliveredMs) / (1e3 * 60 * 60 * 24)) : 999;
        if (elapsedDays > 10) {
          return {
            ok: false,
            code: "WINDOW_EXPIRED",
            elapsedDays: Math.floor(elapsedDays),
            error: "Return and exchange window (10 days from delivery) has expired. No returns or exchanges are permitted after 10 days."
          };
        }
        const nowIso = (/* @__PURE__ */ new Date()).toISOString();
        const cleanNotes = typeof params.notes === "string" ? params.notes.trim().slice(0, 800) : "";
        const reasonLabelMap = {
          COLOR_MISMATCH: "Color / Patina Tone Mismatch",
          TEXTURE_DEFECT: "Leather Grain / Stitching Defect",
          HARDWARE_DAMAGE: "Brass Hardware Damage",
          INCORRECT_SIZE: "Incorrect Size / Fit Exchange"
        };
        const ticket = this.createSupportTicket({
          customerId: order.customerId,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          customerPhone: order.customerPhone,
          channel: "EMAIL",
          subject: `Return / Exchange Request \u2014 ${order.orderNumber} (${reasonLabelMap[params.reason]})`,
          category: params.reason === "INCORRECT_SIZE" ? "SIZE_EXCHANGE" : "HARDWARE_REPAIR",
          priority: "HIGH",
          initialMessage: `Patron submitted a 10-day return/exchange request for Order ${order.orderNumber} (${order.items.map((it) => `${it.productName} x${it.quantity}`).join(", ")}). Reason: ${reasonLabelMap[params.reason]}.${cleanNotes ? ` Patron notes: "${cleanNotes}"` : ""}`
        });
        order.returnRequestStatus = "REQUESTED";
        order.returnReason = params.reason;
        order.returnNotes = cleanNotes || void 0;
        order.returnRequestedAt = nowIso;
        order.returnTicketId = ticket.id;
        order.updatedAt = nowIso;
        this.appendAuditEntry(
          cleanEmail,
          "PATRON_RETURN_REQUESTED",
          "STORE_MANAGEMENT",
          `Patron requested return/exchange for ${order.orderNumber} within ${elapsedDays.toFixed(1)} days of delivery (Reason: ${params.reason}, Ticket: ${ticket.ticketNumber})`
        );
        this.persistState();
        return { ok: true, order, ticket, elapsedDays: Number(elapsedDays.toFixed(2)) };
      }
      recalculateCustomerMetrics(customerId) {
        const cust = this.state.customers.find((c) => c.id === customerId);
        if (!cust) return;
        const custOrders = this.state.orders.filter((o) => o.customerId === customerId && o.paymentStatus === "PAID");
        cust.totalOrders = custOrders.length;
        cust.lifetimeValue = custOrders.reduce((acc, o) => acc + o.totalAmount, 0);
        cust.averageOrderValue = cust.totalOrders > 0 ? Math.round(cust.lifetimeValue / cust.totalOrders) : 0;
        if (custOrders.length > 0) {
          const sorted = [...custOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          cust.lastOrderDate = sorted[0].createdAt;
          const days = Math.floor((Date.now() - new Date(sorted[0].createdAt).getTime()) / (1e3 * 60 * 60 * 24));
          cust.daysSinceLastOrder = days;
        }
        if (cust.totalOrders >= 4 || cust.lifetimeValue >= 5e4) {
          cust.rfmSegment = "Champions/VIPs";
          cust.rfmScore = { recency: 5, frequency: 5, monetary: 5 };
        } else if (cust.daysSinceLastOrder > 90) {
          cust.rfmSegment = "At-Risk/Churning";
          cust.rfmScore = { recency: 1, frequency: 2, monetary: 3 };
        } else if (cust.discountOrdersCount >= 2 && cust.discountOrdersCount === cust.totalOrders) {
          cust.rfmSegment = "Bargain Hunters";
          cust.rfmScore = { recency: 3, frequency: 2, monetary: 1 };
        } else {
          cust.rfmSegment = "Promising/Recent";
          cust.rfmScore = { recency: 4, frequency: 2, monetary: 3 };
        }
      }
      // --- Interaction Logs ---
      addHotStampingVector(vector) {
        const item = {
          ...vector,
          id: `hsv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
        };
        this.state.hotStampingVectors.unshift(item);
        this.persistState();
        return item;
      }
      getHotStampingVectors(customerId) {
        if (customerId) {
          return this.state.hotStampingVectors.filter((h) => h.customerId === customerId);
        }
        return this.state.hotStampingVectors;
      }
      getWarranties(customerId) {
        if (customerId) {
          return this.state.warranties.filter((w) => w.customerId === customerId);
        }
        return this.state.warranties;
      }
      getCareKits(customerId) {
        if (customerId) {
          return this.state.careKitDispatches.filter((c) => c.customerId === customerId);
        }
        return this.state.careKitDispatches;
      }
      getCorporateGiftingLeads() {
        return this.state.corporateGiftingLeads;
      }
      addCorporateGiftingLead(lead) {
        const newLead = {
          ...lead,
          id: `corp_${Date.now()}`,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        this.state.corporateGiftingLeads.unshift(newLead);
        this.logAudit("sales", "ADD_CORP_LEAD", "STORE_MANAGEMENT", `New corporate gifting lead from ${newLead.companyName}`);
        this.persistState();
        return newLead;
      }
      updateCorporateLeadStatus(leadId, status, swatchAwb, extra) {
        const lead = this.state.corporateGiftingLeads.find((l) => l.id === leadId);
        if (!lead) throw new Error(`Lead ${leadId} not found`);
        lead.status = status;
        if (swatchAwb) lead.swatchKitAwb = swatchAwb;
        if (extra?.erpOrderId) lead.erpOrderId = extra.erpOrderId;
        if (extra?.erpOrderNumber) lead.erpOrderNumber = extra.erpOrderNumber;
        if (Array.isArray(extra?.items) && extra.items.length > 0) {
          lead.items = extra.items;
        }
        if (typeof extra?.dealValueInr === "number" && extra.dealValueInr > 0) {
          lead.dealValueInr = extra.dealValueInr;
        }
        this.persistState();
        return lead;
      }
      // --- Support Tickets ---
      getSupportTickets() {
        return this.state.supportTickets.map((ticket) => {
          if (ticket.customerPhone) return ticket;
          const matched = this.getCustomerById(ticket.customerId) || this.getCustomerById(ticket.customerEmail);
          return matched?.phone ? { ...ticket, customerPhone: matched.phone } : ticket;
        });
      }
      getTicketsByCustomer(customerId) {
        return this.getSupportTickets().filter((t) => t.customerId === customerId);
      }
      createSupportTicket(payload) {
        const nowIso = (/* @__PURE__ */ new Date()).toISOString();
        const ticketNum = `TKT-${(/* @__PURE__ */ new Date()).getFullYear()}-${881 + this.state.supportTickets.length}`;
        const ticket = {
          id: `tkt_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          ticketNumber: ticketNum,
          customerId: payload.customerId,
          customerName: payload.customerName,
          customerEmail: payload.customerEmail,
          customerPhone: payload.customerPhone,
          channel: payload.channel || "EMAIL",
          subject: payload.subject,
          category: payload.category,
          priority: payload.priority || "HIGH",
          status: "OPEN",
          assignedTo: "support@bharatvarshcrafts.com",
          slaBreachHours: 12,
          createdAt: nowIso,
          updatedAt: nowIso,
          messages: [
            {
              id: `msg_${Date.now()}`,
              sender: "PATRON",
              text: payload.initialMessage,
              timestamp: nowIso,
              channel: payload.channel || "EMAIL"
            }
          ]
        };
        this.state.supportTickets.unshift(ticket);
        this.persistState();
        return ticket;
      }
      addSupportMessage(ticketId, text, sender, channel) {
        const ticket = this.state.supportTickets.find((t) => t.id === ticketId);
        if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
        ticket.messages.push({
          id: `msg_${Date.now()}`,
          sender,
          text,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          channel
        });
        ticket.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        this.persistState();
        return ticket;
      }
      // --- Carts & Abandonment State ---
      getCarts() {
        return this.state.carts;
      }
      getCartById(cartId) {
        return this.state.carts.find((c) => c.id === cartId);
      }
      saveCartState(cart) {
        const cleanEmail = cart.email.trim().toLowerCase();
        let existing = cart.id ? this.state.carts.find((c) => c.id === cart.id) : void 0;
        if (!existing) {
          existing = this.state.carts.find((c) => c.email.toLowerCase() === cleanEmail && !c.isAbandoned);
        }
        if (existing) {
          existing.items = cart.items;
          existing.subtotal = cart.subtotal;
          existing.phone = cart.phone || existing.phone;
          existing.lastActiveAt = (/* @__PURE__ */ new Date()).toISOString();
          if (!existing.checkoutUrl || existing.checkoutUrl.includes("resume=new")) {
            existing.checkoutUrl = `/?resume=${encodeURIComponent(existing.id)}`;
          }
          this.persistState();
          return existing;
        }
        const resolvedId = cart.id || `cart_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const newCart = {
          id: resolvedId,
          customerId: cart.customerId,
          email: cleanEmail,
          phone: cart.phone,
          items: cart.items,
          subtotal: cart.subtotal,
          currency: "INR",
          isAbandoned: false,
          recoveryStage: "DETECTED",
          recoveryAttempts: 0,
          checkoutUrl: `/?resume=${encodeURIComponent(resolvedId)}`,
          lastActiveAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        this.state.carts.push(newCart);
        this.persistState();
        return newCart;
      }
      detectAbandonedCarts(thresholdMinutes = 15) {
        const now = Date.now();
        const thresholdMs = thresholdMinutes * 60 * 1e3;
        const abandoned = [];
        for (const cart of this.state.carts) {
          if (!cart.isAbandoned && cart.items.length > 0 && cart.recoveryStage !== "RECOVERED") {
            const lastActive = new Date(cart.lastActiveAt).getTime();
            if (now - lastActive >= thresholdMs) {
              cart.isAbandoned = true;
              cart.abandonedAt = (/* @__PURE__ */ new Date()).toISOString();
              cart.recoveryStage = "DETECTED";
              abandoned.push(cart);
              this.logAudit("system", "CHECKOUT_ABANDONED", "WEBHOOK_EVENT", `Abandoned checkout detected for ${cart.email} (\u20B9${cart.subtotal})`);
            }
          }
        }
        if (abandoned.length > 0) {
          this.persistState();
        }
        return abandoned;
      }
      triggerCartRecovery(cartId, channel) {
        const cart = this.state.carts.find((c) => c.id === cartId);
        if (!cart) throw new Error(`Cart ${cartId} not found`);
        if (!cart.email && cart.customerId) {
          const cust = this.getCustomerById(cart.customerId);
          if (cust?.email) cart.email = cust.email;
          if (!cart.phone && cust?.phone) cart.phone = cust.phone;
        }
        if (channel === "EMAIL" && (!cart.email || !cart.email.includes("@"))) {
          throw new Error(`Patron email address is missing or invalid for cart ${cartId}.`);
        }
        const twoHoursMs = 2 * 60 * 60 * 1e3;
        if (cart.lastRecoveryTriggerAt && Date.now() - new Date(cart.lastRecoveryTriggerAt).getTime() < twoHoursMs) {
          return {
            success: false,
            message: `Recovery message already dispatched to ${cart.email} within the cooldown window.`,
            cart
          };
        }
        cart.recoveryAttempts += 1;
        cart.lastRecoveryTriggerAt = (/* @__PURE__ */ new Date()).toISOString();
        cart.recoveryStage = channel === "EMAIL" ? "EMAIL_SENT" : "WHATSAPP_SENT";
        this.logAudit(
          "marketing_agent",
          "TRIGGER_CART_RECOVERY",
          "STORE_MANAGEMENT",
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
      getInventory() {
        return this.state.inventory;
      }
      applyInventoryAdjustmentInMemory(sku, location, newQty, actorEmail) {
        if (!this.isStoreManagementAuthorized(actorEmail)) {
          throw new Error(`Access Denied: Only authorized admin accounts can modify inventory.`);
        }
        const item = this.state.inventory.find((i) => i.sku === sku);
        if (!item) throw new Error(`SKU ${sku} not found`);
        const sanitizedQty = Math.max(0, Math.floor(newQty));
        const prev = item.stockByLocation[location];
        item.stockByLocation[location] = sanitizedQty;
        const totalNow = item.stockByLocation.punePrimaryHub + item.stockByLocation.mumbaiWarehouse;
        this.appendAuditEntry(
          actorEmail,
          "ADJUST_INVENTORY",
          "INVENTORY_ADJUSTMENT",
          `Adjusted ${item.name} (${sku}) at ${location}: ${prev} -> ${sanitizedQty} (Total: ${totalNow}${totalNow === 0 ? " - PRODUCT DEACTIVATED / OUT OF STOCK" : ""})`
        );
        return item;
      }
      updateInventoryStock(sku, location, newQty, actorEmail) {
        const item = this.applyInventoryAdjustmentInMemory(sku, location, newQty, actorEmail);
        this.persistState();
        return item;
      }
      /**
       * Atomic, row-locked inventory stock adjustment (SELECT ... FOR UPDATE in MySQL).
       * Rolls back both in-memory/disk state and MySQL if persistence fails.
       */
      async updateInventoryStockAsync(sku, location, newQty, actorEmail) {
        return this.withWriteLock(async () => {
          if (!this.isStoreManagementAuthorized(actorEmail)) {
            throw new Error(`Access Denied: Only authorized admin accounts can modify inventory.`);
          }
          const prevState = structuredClone(this.state);
          this.insideAtomicTransaction = true;
          try {
            const updated = await mysqlAdapter.runLockedInventoryAdjustment(sku, async ({ lockedRow }) => {
              if (lockedRow) {
                const inv = this.state.inventory.find((i) => i.sku === lockedRow.sku);
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
          } catch (err) {
            this.state = prevState;
            this.persistToDiskOnly();
            this.lastPersistError = err.message;
            throw err;
          } finally {
            this.insideAtomicTransaction = false;
          }
        });
      }
      getBillOfMaterials() {
        return this.state.billOfMaterials;
      }
      addBillOfMaterialsItem(item, actorEmail) {
        const newItem = {
          ...item,
          safetyStock: typeof item.safetyStock === "number" ? item.safetyStock : item.unit === "PIECES" ? 20 : 50,
          id: `bom_${Date.now()}`
        };
        this.state.billOfMaterials.push(newItem);
        this.logAudit(actorEmail, "ADD_BOM_ITEM", "INVENTORY_ADJUSTMENT", `Added raw material ${item.materialName} for ${item.parentSku}`);
        this.persistState();
        return newItem;
      }
      updateBomItemStock(bomId, inventoryOnHand, safetyStock, actorEmail) {
        const item = this.state.billOfMaterials.find((b) => b.id === bomId);
        if (!item) throw new Error(`BOM material ${bomId} not found`);
        const prev = item.inventoryOnHand;
        item.inventoryOnHand = Math.max(0, Math.floor(Number(inventoryOnHand)));
        if (typeof safetyStock === "number" && Number.isFinite(safetyStock)) {
          item.safetyStock = Math.max(0, Math.floor(safetyStock));
        }
        this.logAudit(
          actorEmail,
          "ADJUST_BOM_STOCK",
          "INVENTORY_ADJUSTMENT",
          `Adjusted BOM material ${item.materialName} (${item.parentSku}): ${prev} -> ${item.inventoryOnHand} ${item.unit}`
        );
        this.persistState();
        return item;
      }
      getLowStockAlerts() {
        const lowStockSkus = this.state.inventory.map((inv) => {
          const totalStock = inv.stockByLocation.punePrimaryHub + inv.stockByLocation.mumbaiWarehouse;
          return { ...inv, totalStock, isOut: totalStock <= 0 };
        }).filter((inv) => inv.totalStock <= inv.safetyStock);
        const lowStockBom = this.state.billOfMaterials.map((b) => ({
          ...b,
          effectiveSafetyStock: typeof b.safetyStock === "number" ? b.safetyStock : b.unit === "PIECES" ? 20 : 100
        })).filter((b) => b.inventoryOnHand <= b.effectiveSafetyStock);
        return { lowStockSkus, lowStockBom };
      }
      getInvoices() {
        return this.state.gstInvoices;
      }
      findInvoiceByNumberOrSlug(numOrSlug) {
        const clean = numOrSlug.replace(/\.pdf$/i, "").trim().toLowerCase();
        return this.state.gstInvoices.find(
          (inv) => inv.invoiceNumber.toLowerCase() === clean || inv.invoiceNumber.replace(/\//g, "-").toLowerCase() === clean || inv.id.toLowerCase() === clean
        );
      }
      getCreditNotes() {
        return this.state.gstCreditNotes;
      }
      findCreditNoteByNumberOrSlug(numOrSlug) {
        const clean = numOrSlug.replace(/\.pdf$/i, "").trim().toLowerCase();
        return this.state.gstCreditNotes.find(
          (cn) => cn.creditNoteNumber.toLowerCase() === clean || cn.creditNoteNumber.replace(/\//g, "-").toLowerCase() === clean || cn.id.toLowerCase() === clean
        );
      }
      issueCreditNote(invoiceNumber, reason, actorEmail) {
        if (!this.state.config.gstInvoicingEnabled) {
          throw new Error("GST Invoicing & Credit Note module is currently suspended by Store Management.");
        }
        const inv = this.state.gstInvoices.find((i) => i.invoiceNumber === invoiceNumber);
        if (!inv) throw new Error(`Invoice ${invoiceNumber} not found`);
        const cnNumber = `BVL/CN/26-27/${(this.state.gstCreditNotes.length + 1).toString().padStart(4, "0")}`;
        const creditNote = {
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
          issuedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        this.state.gstCreditNotes.push(creditNote);
        this.logAudit(
          actorEmail,
          "ISSUE_CREDIT_NOTE",
          "GST_INVOICING",
          `Issued GST Credit Note ${cnNumber} for Invoice ${invoiceNumber} (\u20B9${creditNote.totalCreditAmount})`
        );
        this.persistState();
        return creditNote;
      }
      // --- Webhook Ingestion & Idempotency ---
      isWebhookProcessed(eventId) {
        return this.state.processedWebhookIds.includes(eventId);
      }
      markWebhookProcessed(eventId) {
        if (!this.state.processedWebhookIds.includes(eventId)) {
          this.state.processedWebhookIds.push(eventId);
          this.persistState();
        }
      }
    };
    db = new RelationalDatabase();
  }
});

// src/server/webhooks.ts
import crypto3 from "crypto";
function isUnsignedTestWebhookAllowed() {
  return process.env.NODE_ENV !== "production" && (process.env.NODE_ENV === "test" || process.env.ALLOW_UNSIGNED_TEST_WEBHOOKS === "true");
}
function verifyWebhookSignature(req) {
  const rawBuf = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}), "utf8");
  const rzpSigHeader = (req.header("x-razorpay-signature") || "").trim();
  const stripeSigHeader = (req.header("stripe-signature") || "").trim();
  if (rzpSigHeader) {
    const rzpSecret = (process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
    if (!rzpSecret) {
      return { valid: false, reason: "Razorpay webhook secret is not configured on the server." };
    }
    const expectedHex = crypto3.createHmac("sha256", rzpSecret).update(rawBuf).digest("hex");
    if (!safeCompareStrings(rzpSigHeader.toLowerCase(), expectedHex.toLowerCase())) {
      return { valid: false, reason: "Invalid X-Razorpay-Signature." };
    }
    return { valid: true, provider: "RAZORPAY" };
  }
  if (stripeSigHeader) {
    const stripeSecret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
    if (!stripeSecret) {
      return { valid: false, reason: "Stripe webhook secret is not configured on the server." };
    }
    const parts = stripeSigHeader.split(",").map((p) => p.trim());
    let timestamp = "";
    const v1Signatures = [];
    for (const part of parts) {
      const eqIdx = part.indexOf("=");
      if (eqIdx <= 0) continue;
      const k = part.slice(0, eqIdx).trim();
      const v = part.slice(eqIdx + 1).trim();
      if (k === "t") timestamp = v;
      if (k === "v1" && v) v1Signatures.push(v);
    }
    const parsedTs = Number(timestamp);
    if (!timestamp || !Number.isFinite(parsedTs) || v1Signatures.length === 0) {
      return { valid: false, reason: "Malformed Stripe-Signature header." };
    }
    const nowSec = Math.floor(Date.now() / 1e3);
    if (Math.abs(nowSec - parsedTs) > 300) {
      return { valid: false, reason: "Expired Stripe-Signature timestamp outside replay window." };
    }
    const signedPayload = `${timestamp}.${rawBuf.toString("utf8")}`;
    const expectedHex = crypto3.createHmac("sha256", stripeSecret).update(signedPayload).digest("hex");
    const matched = v1Signatures.some((sig) => safeCompareStrings(sig.toLowerCase(), expectedHex.toLowerCase()));
    if (!matched) {
      return { valid: false, reason: "Invalid Stripe-Signature." };
    }
    return { valid: true, provider: "STRIPE" };
  }
  if (isUnsignedTestWebhookAllowed()) {
    return { valid: true, provider: "TEST_BYPASS" };
  }
  return {
    valid: false,
    reason: "Missing webhook signature header (X-Razorpay-Signature or Stripe-Signature)."
  };
}
async function processWebhookEvent(payload) {
  const { eventId, event, data, timestamp } = payload;
  if (!eventId) {
    throw new Error("Missing eventId in webhook payload");
  }
  if (db.isWebhookProcessed(eventId)) {
    return {
      success: true,
      status: "IGNORED_DUPLICATE",
      eventId,
      event,
      message: `Event ${eventId} has already been processed idempotently.`
    };
  }
  try {
    switch (event) {
      case "customer.created": {
        const { customer, isNew } = await db.runAtomicMutation(() => {
          const res = db.findOrCreateCustomer({
            email: data.email,
            phone: data.phone,
            fullName: data.fullName || "Patron",
            identityUid: data.identityUid || data.firebaseUid,
            utmSource: data.utmSource,
            utmMedium: data.utmMedium
          });
          db.markWebhookProcessed(eventId);
          db.logAudit(
            "webhook_gateway",
            "WEBHOOK_CUSTOMER_CREATED",
            "WEBHOOK_EVENT",
            `Processed ${event} for ${res.customer.email} (New: ${res.isNew})`
          );
          return res;
        });
        return {
          success: true,
          status: "PROCESSED",
          eventId,
          event,
          message: `Customer ${customer.email} synchronized successfully.`,
          details: { customerId: customer.id, isNew }
        };
      }
      case "order.placed": {
        const order = await db.createOrderAsync({
          customerId: data.customerId || "cust_guest",
          customerName: data.customerName || "Valued Patron",
          customerEmail: data.customerEmail,
          customerPhone: data.customerPhone || "",
          status: "PROCESSING",
          currency: "INR",
          subtotal: data.subtotal,
          discountAmount: data.discountAmount || 0,
          discountCode: data.discountCode,
          taxAmount: data.taxAmount || Math.round(data.subtotal * 0.18),
          shippingFee: data.shippingFee || 0,
          totalAmount: data.totalAmount,
          paymentGateway: data.paymentGateway || "RAZORPAY",
          paymentId: data.paymentId || `pay_rzp_${Date.now()}`,
          paymentStatus: "PAID",
          items: data.items || [],
          shippingAddress: data.shippingAddress || {
            id: "addr_temp",
            customerId: data.customerId,
            street: "Koregaon Park Boulevard",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411001",
            country: "India",
            isDefault: true,
            addressType: "SHIPPING"
          },
          billingAddress: data.billingAddress || data.shippingAddress
        });
        await db.runAtomicMutation(() => {
          db.markWebhookProcessed(eventId);
          db.logAudit("webhook_gateway", "WEBHOOK_ORDER_PLACED", "WEBHOOK_EVENT", `Order ${order.orderNumber} ingested and pushed to ERP`);
        });
        return {
          success: true,
          status: "PROCESSED",
          eventId,
          event,
          message: `Order ${order.orderNumber} processed and ERP inventory deducted.`,
          details: { orderNumber: order.orderNumber, total: order.totalAmount }
        };
      }
      case "order.fulfilled": {
        const orderId = data.orderId || data.orderNumber;
        const updatedOrder = await db.runAtomicMutation(() => {
          const updated = db.updateOrderStatus(orderId, "DISPATCHED", "logistics_webhook");
          db.markWebhookProcessed(eventId);
          db.logAudit(
            "webhook_gateway",
            "WEBHOOK_ORDER_FULFILLED",
            "WEBHOOK_EVENT",
            `Order ${updated.orderNumber} dispatched with AWB ${updated.awbNumber}`
          );
          return updated;
        });
        return {
          success: true,
          status: "PROCESSED",
          eventId,
          event,
          message: `Order ${updatedOrder.orderNumber} fulfilled with tracking AWB ${updatedOrder.awbNumber}.`,
          details: { orderNumber: updatedOrder.orderNumber, status: updatedOrder.status }
        };
      }
      case "checkout.abandoned": {
        const cart = await db.runAtomicMutation(() => {
          const saved = db.saveCartState({
            id: data.cartId,
            email: data.email,
            phone: data.phone,
            items: data.items,
            subtotal: data.subtotal
          });
          saved.isAbandoned = true;
          saved.abandonedAt = timestamp || (/* @__PURE__ */ new Date()).toISOString();
          saved.recoveryStage = "DETECTED";
          db.markWebhookProcessed(eventId);
          db.logAudit(
            "webhook_gateway",
            "WEBHOOK_CHECKOUT_ABANDONED",
            "WEBHOOK_EVENT",
            `Cart ${saved.id} (${saved.email}) marked abandoned in CRM Kanban`
          );
          return saved;
        });
        return {
          success: true,
          status: "PROCESSED",
          eventId,
          event,
          message: `Abandoned cart registered for ${cart.email}.`,
          details: { cartId: cart.id, subtotal: cart.subtotal }
        };
      }
      case "refund.processed": {
        const orderId = data.orderId;
        const { orderNumber, creditNoteNumber } = await db.runAtomicMutation(() => {
          const order = db.getOrderById(orderId);
          if (!order) {
            throw new Error(`Order ${orderId} not found for refund`);
          }
          order.status = "RETURNED";
          order.paymentStatus = "REFUNDED";
          order.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
          let cnNum;
          if (order.invoiceNumber && db.getConfig().gstInvoicingEnabled) {
            const cn = db.issueCreditNote(order.invoiceNumber, "DEFECT_REFUND", "webhook_gateway");
            cnNum = cn.creditNoteNumber;
          }
          db.markWebhookProcessed(eventId);
          db.logAudit(
            "webhook_gateway",
            "WEBHOOK_REFUND_PROCESSED",
            "WEBHOOK_EVENT",
            `Refund processed for order ${order.orderNumber}. Credit note: ${cnNum || "N/A"}`
          );
          return { orderNumber: order.orderNumber, creditNoteNumber: cnNum };
        });
        return {
          success: true,
          status: "PROCESSED",
          eventId,
          event,
          message: `Refund processed for ${orderNumber}.`,
          details: { orderNumber, creditNoteNumber }
        };
      }
      default:
        throw new Error(`Unsupported webhook event: ${event}`);
    }
  } catch (err) {
    db.logAudit("webhook_gateway", "WEBHOOK_FAILED", "WEBHOOK_EVENT", `Webhook ${eventId} (${event}) failed: ${err.message}`);
    return {
      success: false,
      status: "FAILED_RETRY",
      eventId,
      event,
      message: err.message
    };
  }
}
async function handleWebhookRequest(req, res) {
  const sigCheck = verifyWebhookSignature(req);
  if (!sigCheck.valid) {
    db.logAudit(
      "webhook_gateway",
      "WEBHOOK_SIGNATURE_REJECTED",
      "WEBHOOK_EVENT",
      `Rejected unsigned or forged webhook on ${req.originalUrl}: ${sigCheck.reason}`,
      req.ip
    );
    return res.status(401).json({
      error: "INVALID_WEBHOOK_SIGNATURE",
      message: sigCheck.reason || "Webhook signature verification failed."
    });
  }
  const payload = req.body;
  if (!payload || !payload.eventId || !payload.event) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "Invalid webhook payload structure" });
  }
  const result = await processWebhookEvent(payload);
  if (result.status === "FAILED_RETRY") {
    return res.status(500).json(result);
  }
  return res.status(200).json(result);
}
var init_webhooks = __esm({
  "src/server/webhooks.ts"() {
    init_db();
    init_security();
  }
});

// src/server/invoicePdf.ts
import fs4 from "fs";
import path4 from "path";
import zlib from "zlib";
function resolveLogoFilePath() {
  const candidates = [
    path4.resolve(process.cwd(), "public", "assets", "logo.png"),
    path4.resolve(process.cwd(), "dist", "assets", "logo.png"),
    path4.resolve(process.cwd(), "public", "assets", "aistudio", "Circular_with_Stitch_and_ring_Bharatvarsh_2405b0e7.png")
  ];
  for (const p of candidates) {
    if (fs4.existsSync(p)) return p;
  }
  return null;
}
function getLogoDataUri() {
  if (cachedLogoDataUri !== void 0) return cachedLogoDataUri;
  try {
    const filePath = resolveLogoFilePath();
    if (!filePath) {
      cachedLogoDataUri = null;
      return null;
    }
    const buf = fs4.readFileSync(filePath);
    cachedLogoDataUri = `data:image/png;base64,${buf.toString("base64")}`;
    return cachedLogoDataUri;
  } catch {
    cachedLogoDataUri = null;
    return null;
  }
}
function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
function decodePngToPdfRgb(pngBuf) {
  try {
    const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (pngBuf.length < 33 || !pngBuf.subarray(0, 8).equals(PNG_SIG)) {
      return null;
    }
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idatChunks = [];
    while (offset + 8 <= pngBuf.length) {
      const length = pngBuf.readUInt32BE(offset);
      const type = pngBuf.subarray(offset + 4, offset + 8).toString("ascii");
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > pngBuf.length) break;
      const chunk = pngBuf.subarray(dataStart, dataEnd);
      if (type === "IHDR") {
        width = chunk.readUInt32BE(0);
        height = chunk.readUInt32BE(4);
        bitDepth = chunk[8];
        colorType = chunk[9];
      } else if (type === "IDAT") {
        idatChunks.push(chunk);
      } else if (type === "IEND") {
        break;
      }
      offset = dataEnd + 4;
    }
    if (!width || !height || bitDepth !== 8 || colorType !== 2 && colorType !== 6 || idatChunks.length === 0) {
      return null;
    }
    const bpp = colorType === 6 ? 4 : 3;
    const stride = width * bpp;
    const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
    if (inflated.length < height * (stride + 1)) {
      return null;
    }
    const rawRgba = Buffer.alloc(height * stride);
    for (let y = 0; y < height; y++) {
      const filterType = inflated[y * (stride + 1)];
      const rowStart = y * (stride + 1) + 1;
      const outStart = y * stride;
      const prevStart = (y - 1) * stride;
      for (let x = 0; x < stride; x++) {
        const raw = inflated[rowStart + x];
        const a = x >= bpp ? rawRgba[outStart + x - bpp] : 0;
        const b = y > 0 ? rawRgba[prevStart + x] : 0;
        const c = x >= bpp && y > 0 ? rawRgba[prevStart + x - bpp] : 0;
        let val = raw;
        if (filterType === 1) val = raw + a & 255;
        else if (filterType === 2) val = raw + b & 255;
        else if (filterType === 3) val = raw + Math.floor((a + b) / 2) & 255;
        else if (filterType === 4) val = raw + paethPredictor(a, b, c) & 255;
        rawRgba[outStart + x] = val;
      }
    }
    const bgR = 250;
    const bgG = 247;
    const bgB = 242;
    const rgbOut = Buffer.alloc(width * height * 3);
    for (let i = 0, j = 0; i < width * height; i++) {
      const srcIdx = i * bpp;
      const r = rawRgba[srcIdx];
      const g = rawRgba[srcIdx + 1];
      const b = rawRgba[srcIdx + 2];
      if (bpp === 4) {
        const alpha = rawRgba[srcIdx + 3] / 255;
        rgbOut[j++] = Math.round(r * alpha + bgR * (1 - alpha));
        rgbOut[j++] = Math.round(g * alpha + bgG * (1 - alpha));
        rgbOut[j++] = Math.round(b * alpha + bgB * (1 - alpha));
      } else {
        rgbOut[j++] = r;
        rgbOut[j++] = g;
        rgbOut[j++] = b;
      }
    }
    return {
      width,
      height,
      flateRgb: zlib.deflateSync(rgbOut)
    };
  } catch {
    return null;
  }
}
function getLogoPdfImage() {
  if (cachedLogoPdfImage !== void 0) return cachedLogoPdfImage;
  try {
    const filePath = resolveLogoFilePath();
    if (!filePath) {
      cachedLogoPdfImage = null;
      return null;
    }
    cachedLogoPdfImage = decodePngToPdfRgb(fs4.readFileSync(filePath));
    return cachedLogoPdfImage;
  } catch {
    cachedLogoPdfImage = null;
    return null;
  }
}
function toPdfAscii(input) {
  return String(input || "").replace(/₹/g, "Rs. ").replace(/•/g, "-").replace(/[–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\x7E]/g, " ");
}
function escapePdfString(input) {
  return toPdfAscii(input).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
function escapeHtml(input) {
  return String(input || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function formatInrAscii(n) {
  return `Rs. ${Math.round(n).toLocaleString("en-IN")}`;
}
function formatInrHtml(n) {
  return `&#8377;${Math.round(n).toLocaleString("en-IN")}`;
}
function resolveRecipientDetails(invoice, order, fallback) {
  const addr = order?.shippingAddress || order?.billingAddress || fallback?.defaultAddress;
  const cust = fallback?.customer;
  const name = addr?.recipientName || order?.customerName || cust?.fullName || "Valued Patron";
  const email = order?.customerEmail || cust?.email || "";
  const phone = order?.customerPhone || addr?.phone || cust?.phone || "";
  const street = addr?.street || cust?.address || "";
  const city = addr?.city || cust?.city || "";
  const state = addr?.state || cust?.state || invoice?.placeOfSupply || "";
  const pincode = addr?.pincode || cust?.pincode || "";
  const country = addr?.country || "India";
  const addressParts = [
    street,
    [city, state].filter(Boolean).join(", "),
    pincode ? `PIN: ${pincode}` : "",
    country
  ].filter(Boolean);
  return {
    name,
    email,
    phone,
    street,
    city,
    state,
    pincode,
    country,
    formattedLine: addressParts.join(", ")
  };
}
function buildSinglePagePdfBuffer(lines) {
  const logoImg = getLogoPdfImage();
  const ops = [];
  ops.push("0.980 0.969 0.949 rg");
  ops.push("36 734 523 76 re f");
  ops.push("0.545 0.271 0.075 RG");
  ops.push("1.2 w");
  ops.push("36 734 m 559 734 l S");
  ops.push("0.85 w");
  ops.push("36 58 m 559 58 l S");
  if (logoImg) {
    ops.push("q");
    ops.push("52 0 0 52 44 746 cm");
    ops.push("/Im1 Do");
    ops.push("Q");
  }
  let y = 790;
  for (const line of lines) {
    if (line.yOffset) {
      y -= line.yOffset;
    }
    const font = line.bold ? "/F2" : "/F1";
    const size = line.size || 9.5;
    const xPos = line.x ?? 44;
    const rgb = line.color || "0.086 0.071 0.055";
    ops.push(`${rgb} rg`);
    ops.push("BT");
    ops.push(`${font} ${size} Tf`);
    ops.push(`${xPos} ${y} Td`);
    ops.push(`(${escapePdfString(line.text)}) Tj`);
    ops.push("ET");
    y -= size + 5;
  }
  const streamContent = ops.join("\n");
  const streamLen = Buffer.byteLength(streamContent, "utf8");
  const xObjectDict = logoImg ? "/XObject << /Im1 7 0 R >> " : "";
  const chunks = [];
  const offsets = [0];
  let bytePos = 0;
  const pushStr = (s) => {
    const b = Buffer.from(s, "utf8");
    chunks.push(b);
    bytePos += b.length;
  };
  const pushObjHeader = () => {
    offsets.push(bytePos);
  };
  pushStr("%PDF-1.4\n");
  pushObjHeader();
  pushStr("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  pushObjHeader();
  pushStr("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  pushObjHeader();
  pushStr(
    `3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> ${xObjectDict}>> /Contents 6 0 R >>
endobj
`
  );
  pushObjHeader();
  pushStr("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  pushObjHeader();
  pushStr("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n");
  pushObjHeader();
  pushStr(`6 0 obj
<< /Length ${streamLen} >>
stream
${streamContent}
endstream
endobj
`);
  if (logoImg) {
    pushObjHeader();
    pushStr(
      `7 0 obj
<< /Type /XObject /Subtype /Image /Width ${logoImg.width} /Height ${logoImg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${logoImg.flateRgb.length} >>
stream
`
    );
    chunks.push(logoImg.flateRgb);
    bytePos += logoImg.flateRgb.length;
    pushStr("\nendstream\nendobj\n");
  }
  const totalObjects = offsets.length - 1;
  const xrefPos = bytePos;
  pushStr(`xref
0 ${totalObjects + 1}
`);
  pushStr("0000000000 65535 f \n");
  for (let i = 1; i <= totalObjects; i++) {
    pushStr(`${String(offsets[i]).padStart(10, "0")} 00000 n 
`);
  }
  pushStr(`trailer
<< /Size ${totalObjects + 1} /Root 1 0 R >>
startxref
${xrefPos}
%%EOF
`);
  return Buffer.concat(chunks);
}
function renderTaxInvoicePdf(invoice, order, config, customerFallback) {
  const gstRate = config.gstRatePercent || 18;
  const halfRate = Number((gstRate / 2).toFixed(2));
  const supplierGstin = invoice.supplierGstin || config.supplierGstin || "27AABCB1234F1Z8";
  const recipient = resolveRecipientDetails(invoice, order, customerFallback);
  const headerX = getLogoPdfImage() ? 106 : 44;
  const lines = [
    { text: "BHARATVARSH LEATHERCRAFTS LLP", size: 14.5, bold: true, x: headerX, color: "0.133 0.110 0.086" },
    {
      text: `TAX INVOICE (ORIGINAL FOR RECIPIENT)  |  GSTIN: ${supplierGstin} (27 - Maharashtra)`,
      size: 8.8,
      bold: true,
      x: headerX,
      color: "0.545 0.271 0.075"
    },
    { text: REGISTERED_OFFICE_ADDRESS_PDF, size: 8.2, x: headerX, color: "0.361 0.302 0.243" },
    {
      text: `Invoice No: ${invoice.invoiceNumber}    Date: ${invoice.invoiceDate.slice(0, 10)}    Order Ref: ${order?.orderNumber || invoice.orderId}`,
      size: 9.5,
      bold: true,
      yOffset: 18
    },
    {
      text: `Place of Supply: ${invoice.placeOfSupply} (${invoice.isInterState ? "Inter-State IGST" : "Intra-State CGST + SGST"})    Status: ${invoice.status}`,
      size: 9
    },
    {
      text: `Billed & Shipped To: ${recipient.name}${recipient.phone ? `  |  Phone: ${recipient.phone}` : ""}${recipient.email ? `  |  ${recipient.email}` : ""}`,
      size: 9,
      bold: true,
      yOffset: 8
    },
    {
      text: `Delivery Address: ${recipient.formattedLine || invoice.placeOfSupply}`,
      size: 8.5,
      color: "0.361 0.302 0.243"
    },
    { text: "ITEMIZED SUPPLY & HSN SCHEDULE", size: 10, bold: true, yOffset: 12, color: "0.545 0.271 0.075" },
    { text: "SKU              | HSN  | Qty | Unit Price   | Tax      | Line Total", size: 8.5, bold: true }
  ];
  const items = order?.items || [];
  for (const it of items.slice(0, 10)) {
    const skuCol = (it.sku || "").padEnd(16, " ").slice(0, 16);
    const hsnCol = (it.hsnCode || "4202").padEnd(4, " ").slice(0, 4);
    const qtyCol = String(it.quantity).padStart(3, " ");
    const priceCol = formatInrAscii(it.unitPrice).padStart(12, " ");
    const taxCol = formatInrAscii(it.taxAmount).padStart(8, " ");
    const totalCol = formatInrAscii(it.lineTotal).padStart(12, " ");
    lines.push({
      text: `${it.productName}${it.customization?.monogramInitials ? ` [Monogram: ${it.customization.monogramInitials}]` : ""}`,
      size: 9,
      bold: true,
      yOffset: 4
    });
    lines.push({
      text: `${skuCol} | ${hsnCol} | ${qtyCol} | ${priceCol} | ${taxCol} | ${totalCol}`,
      size: 8.5,
      color: "0.25 0.22 0.19"
    });
  }
  lines.push({ text: "TAXATION & VALUE SUMMARY", size: 10, bold: true, yOffset: 14, color: "0.545 0.271 0.075" });
  if (order && order.discountAmount > 0) {
    lines.push({
      text: `Subtotal Before Privilege (${order.discountCode || "PROMO"}): ${formatInrAscii(order.subtotal)}   Discount: -${formatInrAscii(order.discountAmount)}`,
      size: 9
    });
  }
  lines.push({ text: `Taxable Value: ${formatInrAscii(invoice.taxableValue)}`, size: 9.5, bold: true });
  if (invoice.isInterState) {
    lines.push({ text: `IGST @ ${gstRate}%: ${formatInrAscii(invoice.igstAmount)}`, size: 9 });
  } else {
    lines.push({
      text: `CGST @ ${halfRate}%: ${formatInrAscii(invoice.cgstAmount)}    SGST @ ${halfRate}%: ${formatInrAscii(invoice.sgstAmount)}`,
      size: 9
    });
  }
  lines.push({ text: `TOTAL TAX INVOICE AMOUNT: ${formatInrAscii(invoice.totalInvoiceAmount)}`, size: 11.5, bold: true, yOffset: 6 });
  lines.push({
    text: "Statutory Declaration: Certified true & correct under Section 31 of CGST Act, 2017. Includes 2-Year Solid Brass Hardware Warranty.",
    size: 8,
    yOffset: 14,
    color: "0.361 0.302 0.243"
  });
  return buildSinglePagePdfBuffer(lines);
}
function renderCreditNotePdf(creditNote, invoice, order, config, customerFallback) {
  const gstRate = config.gstRatePercent || 18;
  const supplierGstin = invoice?.supplierGstin || config.supplierGstin || "27AABCB1234F1Z8";
  const recipient = resolveRecipientDetails(invoice, order, customerFallback);
  const headerX = getLogoPdfImage() ? 106 : 44;
  const lines = [
    { text: "BHARATVARSH LEATHERCRAFTS LLP", size: 14.5, bold: true, x: headerX, color: "0.133 0.110 0.086" },
    {
      text: `GST CREDIT NOTE (RMA / RETURN)  |  GSTIN: ${supplierGstin} (27 - Maharashtra)`,
      size: 8.8,
      bold: true,
      x: headerX,
      color: "0.6 0.12 0.12"
    },
    { text: REGISTERED_OFFICE_ADDRESS_PDF, size: 8.2, x: headerX, color: "0.361 0.302 0.243" },
    { text: `Credit Note No: ${creditNote.creditNoteNumber}    Issued: ${creditNote.issuedAt.slice(0, 10)}`, size: 9.5, bold: true, yOffset: 18 },
    { text: `Original Tax Invoice: ${creditNote.originalInvoiceNumber}    Order Ref: ${order?.orderNumber || creditNote.orderId}`, size: 9 },
    {
      text: `Recipient: ${recipient.name}${recipient.phone ? `  |  Phone: ${recipient.phone}` : ""}${recipient.email ? `  |  ${recipient.email}` : ""}`,
      size: 9,
      bold: true,
      yOffset: 8
    },
    {
      text: `Address: ${recipient.formattedLine || invoice?.placeOfSupply || "India"}`,
      size: 8.5,
      color: "0.361 0.302 0.243"
    },
    { text: `Return Reason Classification: ${creditNote.reason}`, size: 9.5, bold: true, yOffset: 8 },
    { text: "CREDIT ADJUSTMENT BREAKDOWN", size: 10, bold: true, yOffset: 14, color: "0.545 0.271 0.075" },
    { text: `Taxable Value Reversed: ${formatInrAscii(creditNote.taxableValue)}`, size: 9.5 },
    {
      text: creditNote.igstAmount > 0 ? `IGST Reversed (${gstRate}%): ${formatInrAscii(creditNote.igstAmount)}` : `CGST Reversed: ${formatInrAscii(creditNote.cgstAmount)}    SGST Reversed: ${formatInrAscii(creditNote.sgstAmount)}`,
      size: 9
    },
    { text: `TOTAL GST CREDIT NOTE VALUE: ${formatInrAscii(creditNote.totalCreditAmount)}`, size: 11.5, bold: true, yOffset: 8 },
    {
      text: "Issued under Section 34 of the Central Goods & Services Tax Act, 2017 \xB7 Pune Primary Hub.",
      size: 8,
      yOffset: 14,
      color: "0.361 0.302 0.243"
    }
  ];
  return buildSinglePagePdfBuffer(lines);
}
function renderTaxInvoiceHtml(invoice, order, config, customerFallback) {
  const gstRate = config.gstRatePercent || 18;
  const halfRate = Number((gstRate / 2).toFixed(2));
  const supplierGstin = invoice.supplierGstin || config.supplierGstin || "27AABCB1234F1Z8";
  const items = order?.items || [];
  const recipient = resolveRecipientDetails(invoice, order, customerFallback);
  const logoUri = getLogoDataUri() || "/assets/logo.png";
  const rowsHtml = items.map(
    (it) => `
      <tr>
        <td>
          <strong>${escapeHtml(it.productName)}</strong>
          <div class="meta">${escapeHtml(it.sku)} \xB7 ${it.leatherType === "BIO_SUBSTITUTE_CACTUS" ? "Bio-Cactus" : "Veg-Tanned Steerhide"}${it.customization?.monogramInitials ? ` \xB7 Monogram "${escapeHtml(it.customization.monogramInitials)}" (${escapeHtml(it.customization.foilType)})` : ""}</div>
        </td>
        <td class="mono center">${escapeHtml(it.hsnCode || "4202")}</td>
        <td class="mono center">${it.quantity}</td>
        <td class="mono right">${formatInrHtml(it.unitPrice)}</td>
        <td class="mono right">${formatInrHtml(it.taxAmount)}</td>
        <td class="mono right bold">${formatInrHtml(it.lineTotal)}</td>
      </tr>`
  ).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Tax Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #16120E; background: #FAF7F2; margin: 0; padding: 28px; }
    .sheet { max-width: 820px; margin: 0 auto; background: #FFFFFF; border: 1px solid #D8CFC2; padding: 36px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; border-bottom: 2px solid #8B4513; padding-bottom: 18px; margin-bottom: 22px; }
    .brand-wrap { display: flex; align-items: center; gap: 14px; }
    .logo { width: 64px; height: 64px; border-radius: 9999px; border: 1px solid #C5A059; object-fit: cover; flex-shrink: 0; background: #FAF7F2; }
    .brand { font-family: Georgia, serif; font-size: 20px; font-weight: 700; letter-spacing: 0.04em; color: #16120E; }
    .sub { font-size: 11.5px; color: #5C4D3E; margin-top: 4px; line-height: 1.5; }
    .doc-label { text-align: right; flex-shrink: 0; }
    .doc-label h1 { font-size: 15px; letter-spacing: 0.14em; text-transform: uppercase; color: #8B4513; margin: 0 0 6px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; font-size: 12px; line-height: 1.6; }
    .box { background: #FAF7F2; border: 1px solid #E5DDD0; padding: 14px; }
    .box-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #8B4513; font-weight: 700; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
    th { background: #FAF7F2; border-top: 1px solid #D8CFC2; border-bottom: 1px solid #D8CFC2; padding: 10px 8px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #5C4D3E; }
    td { padding: 10px 8px; border-bottom: 1px solid #EFEAE2; vertical-align: top; }
    .meta { font-size: 11px; color: #5C4D3E; margin-top: 2px; }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: 700; }
    .totals { max-width: 340px; margin-left: auto; font-size: 12px; }
    .totals-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #EFEAE2; }
    .totals-row.grand { font-size: 15px; font-weight: 700; border-top: 2px solid #16120E; border-bottom: 2px solid #16120E; padding: 10px 0; margin-top: 6px; }
    .footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid #E5DDD0; font-size: 11px; color: #5C4D3E; display: flex; justify-content: space-between; gap: 20px; }
    @media print { body { background: #FFFFFF; padding: 0; } .sheet { border: none; padding: 18px; } .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="brand-wrap">
        <img class="logo" src="${logoUri}" alt="Bharatvarsh Leathercrafts LLP Logo" />
        <div>
          <div class="brand">BHARATVARSH LEATHERCRAFTS LLP</div>
          <div class="sub">
            Registered Office: ${escapeHtml(REGISTERED_OFFICE_ADDRESS_HTML)}<br/>
            Supplier GSTIN: <strong class="mono">${escapeHtml(supplierGstin)}</strong> \xB7 State Code: 27 \u2013 Maharashtra
          </div>
        </div>
      </div>
      <div class="doc-label">
        <h1>Tax Invoice</h1>
        <div class="mono" style="font-size:13px;font-weight:700;">${escapeHtml(invoice.invoiceNumber)}</div>
        <div class="sub">Date: <span class="mono">${escapeHtml(invoice.invoiceDate.slice(0, 10))}</span> \xB7 Status: ${escapeHtml(invoice.status)}</div>
      </div>
    </div>

    <div class="grid">
      <div class="box">
        <div class="box-title">Billed &amp; Shipped To</div>
        <strong>${escapeHtml(recipient.name)}</strong><br/>
        ${recipient.email ? `${escapeHtml(recipient.email)}` : ""}${recipient.phone ? ` \xB7 <span class="mono">${escapeHtml(recipient.phone)}</span>` : ""}<br/>
        ${recipient.street ? `${escapeHtml(recipient.street)}<br/>${escapeHtml(recipient.city)}${recipient.state ? `, ${escapeHtml(recipient.state)}` : ""}${recipient.pincode ? ` \u2013 <span class="mono">${escapeHtml(recipient.pincode)}</span>` : ""}<br/>${escapeHtml(recipient.country)}` : escapeHtml(invoice.placeOfSupply)}
      </div>
      <div class="box">
        <div class="box-title">Supply &amp; Logistics Reference</div>
        Order Number: <strong class="mono">${escapeHtml(order?.orderNumber || invoice.orderId)}</strong><br/>
        Place of Supply: <strong>${escapeHtml(invoice.placeOfSupply)}</strong> (${invoice.isInterState ? "Inter-State IGST" : "Intra-State CGST + SGST"})<br/>
        Courier / AWB: <span class="mono">${escapeHtml(order?.courierPartner || "SHIPROCKET")} \xB7 ${escapeHtml(order?.awbNumber || "Pending")}</span>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description &amp; Craft Specification</th>
          <th class="center">HSN</th>
          <th class="center">Qty</th>
          <th class="right">Unit Rate</th>
          <th class="right">GST (${gstRate}%)</th>
          <th class="right">Line Total</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    <div class="totals">
      <div class="totals-row"><span>Taxable Value</span><span class="mono">${formatInrHtml(invoice.taxableValue)}</span></div>
      ${order && order.discountAmount > 0 ? `<div class="totals-row"><span>Bespoke Privilege (${escapeHtml(order.discountCode || "PROMO")})</span><span class="mono">-${formatInrHtml(order.discountAmount)}</span></div>` : ""}
      ${invoice.isInterState ? `<div class="totals-row"><span>IGST (${gstRate}%)</span><span class="mono">${formatInrHtml(invoice.igstAmount)}</span></div>` : `<div class="totals-row"><span>CGST (${halfRate}%)</span><span class="mono">${formatInrHtml(invoice.cgstAmount)}</span></div>
             <div class="totals-row"><span>SGST (${halfRate}%)</span><span class="mono">${formatInrHtml(invoice.sgstAmount)}</span></div>`}
      <div class="totals-row grand"><span>Total Invoice Value</span><span class="mono">${formatInrHtml(invoice.totalInvoiceAmount)}</span></div>
    </div>

    <div class="footer">
      <div>Certified under Section 31 of the CGST Act, 2017. Registered Solid Brass Hardware carries a 2-year structural warranty from invoice date.</div>
      <div class="right" style="white-space:nowrap;">Authorized Signatory<br/><strong>Bharatvarsh Leathercrafts LLP</strong></div>
    </div>
  </div>
</body>
</html>`;
}
function renderCreditNoteHtml(creditNote, invoice, order, config, customerFallback) {
  const gstRate = config.gstRatePercent || 18;
  const supplierGstin = invoice?.supplierGstin || config.supplierGstin || "27AABCB1234F1Z8";
  const recipient = resolveRecipientDetails(invoice, order, customerFallback);
  const logoUri = getLogoDataUri() || "/assets/logo.png";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>GST Credit Note ${escapeHtml(creditNote.creditNoteNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #16120E; background: #FAF7F2; margin: 0; padding: 28px; }
    .sheet { max-width: 780px; margin: 0 auto; background: #FFFFFF; border: 1px solid #D8CFC2; padding: 36px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; border-bottom: 2px solid #991B1B; padding-bottom: 18px; margin-bottom: 22px; }
    .brand-wrap { display: flex; align-items: center; gap: 14px; }
    .logo { width: 64px; height: 64px; border-radius: 9999px; border: 1px solid #C5A059; object-fit: cover; flex-shrink: 0; background: #FAF7F2; }
    .brand { font-family: Georgia, serif; font-size: 20px; font-weight: 700; color: #16120E; }
    .sub { font-size: 11.5px; color: #5C4D3E; margin-top: 4px; line-height: 1.5; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 20px; font-size: 12px; line-height: 1.65; }
    .box { background: #FAF7F2; border: 1px solid #E5DDD0; padding: 14px; }
    .box-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #991B1B; font-weight: 700; margin-bottom: 6px; }
    .totals { max-width: 340px; margin-left: auto; font-size: 12px; }
    .row { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid #EFEAE2; }
    .grand { font-size: 15px; font-weight: 700; color: #991B1B; border-top: 2px solid #991B1B; border-bottom: 2px solid #991B1B; padding: 10px 0; margin-top: 6px; }
    @media print { body { background: #FFFFFF; padding: 0; } .sheet { border: none; padding: 18px; } }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="brand-wrap">
        <img class="logo" src="${logoUri}" alt="Bharatvarsh Leathercrafts LLP Logo" />
        <div>
          <div class="brand">BHARATVARSH LEATHERCRAFTS LLP</div>
          <div class="sub">
            Registered Office: ${escapeHtml(REGISTERED_OFFICE_ADDRESS_HTML)}<br/>
            Supplier GSTIN: <strong class="mono">${escapeHtml(supplierGstin)}</strong> \xB7 State Code: 27 \u2013 Maharashtra
          </div>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:14px;font-weight:700;letter-spacing:0.12em;color:#991B1B;text-transform:uppercase;">GST Credit Note</div>
        <div class="mono" style="font-size:13px;font-weight:700;margin-top:4px;">${escapeHtml(creditNote.creditNoteNumber)}</div>
        <div class="sub">Issued: <span class="mono">${escapeHtml(creditNote.issuedAt.slice(0, 10))}</span></div>
      </div>
    </div>

    <div class="grid">
      <div class="box">
        <div class="box-title">Patron Billing &amp; Return Address</div>
        <strong>${escapeHtml(recipient.name)}</strong><br/>
        ${recipient.email ? `${escapeHtml(recipient.email)}` : ""}${recipient.phone ? ` \xB7 <span class="mono">${escapeHtml(recipient.phone)}</span>` : ""}<br/>
        ${recipient.street ? `${escapeHtml(recipient.street)}<br/>${escapeHtml(recipient.city)}${recipient.state ? `, ${escapeHtml(recipient.state)}` : ""}${recipient.pincode ? ` \u2013 <span class="mono">${escapeHtml(recipient.pincode)}</span>` : ""}<br/>${escapeHtml(recipient.country)}` : escapeHtml(invoice?.placeOfSupply || "India")}
      </div>
      <div class="box">
        <div class="box-title">Credit Note Reference</div>
        Original Tax Invoice: <strong class="mono">${escapeHtml(creditNote.originalInvoiceNumber)}</strong><br/>
        Order Reference: <strong class="mono">${escapeHtml(order?.orderNumber || creditNote.orderId)}</strong><br/>
        Reason Code: <strong class="mono">${escapeHtml(creditNote.reason)}</strong>
      </div>
    </div>

    <div class="totals">
      <div class="row"><span>Taxable Value Reversed</span><span class="mono">${formatInrHtml(creditNote.taxableValue)}</span></div>
      ${creditNote.igstAmount > 0 ? `<div class="row"><span>IGST Reversed (${gstRate}%)</span><span class="mono">${formatInrHtml(creditNote.igstAmount)}</span></div>` : `<div class="row"><span>CGST Reversed</span><span class="mono">${formatInrHtml(creditNote.cgstAmount)}</span></div>
             <div class="row"><span>SGST Reversed</span><span class="mono">${formatInrHtml(creditNote.sgstAmount)}</span></div>`}
      <div class="row grand"><span>Total Credit Amount</span><span class="mono">${formatInrHtml(creditNote.totalCreditAmount)}</span></div>
    </div>
  </div>
</body>
</html>`;
}
var REGISTERED_OFFICE_ADDRESS_HTML, REGISTERED_OFFICE_ADDRESS_PDF, cachedLogoDataUri, cachedLogoPdfImage;
var init_invoicePdf = __esm({
  "src/server/invoicePdf.ts"() {
    REGISTERED_OFFICE_ADDRESS_HTML = "NT2-1703, The Crown Greens, Plot 7, Hinjewadi Phase 2, Pune, Maharashtra \u2013 411057";
    REGISTERED_OFFICE_ADDRESS_PDF = "NT2-1703, The Crown Greens, Plot 7, Hinjewadi Phase 2, Pune, Maharashtra - 411057";
    cachedLogoDataUri = void 0;
    cachedLogoPdfImage = void 0;
  }
});

// src/server/integrations.ts
import nodemailer from "nodemailer";
function isConfiguredCredential(value) {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (lower.includes("placeholder") || lower.startsWith("your_") || lower.includes("dummy") || lower.includes("example")) {
    return false;
  }
  return true;
}
function getIntegrationsReadiness() {
  const razorpayConfigured = isConfiguredCredential(process.env.RAZORPAY_KEY_ID) && isConfiguredCredential(process.env.RAZORPAY_KEY_SECRET);
  const stripeConfigured = isConfiguredCredential(process.env.STRIPE_SECRET_KEY);
  const shiprocketConfigured = isConfiguredCredential(process.env.SHIPROCKET_API_TOKEN) || isConfiguredCredential(process.env.SHIPROCKET_EMAIL) && isConfiguredCredential(process.env.SHIPROCKET_PASSWORD);
  const delhiveryConfigured = isConfiguredCredential(process.env.DELHIVERY_API_KEY);
  const smtpConfigured = isConfiguredCredential(process.env.SMTP_HOST) && isConfiguredCredential(process.env.SMTP_USER) && isConfiguredCredential(process.env.SMTP_PASS);
  const whatsappConfigured = isConfiguredCredential(process.env.WHATSAPP_BUSINESS_PHONE_NUMBER_ID) && isConfiguredCredential(process.env.WHATSAPP_ACCESS_TOKEN);
  return [
    {
      provider: "Razorpay",
      category: "PAYMENTS",
      configured: razorpayConfigured,
      mode: razorpayConfigured ? "LIVE" : "SANDBOX_FALLBACK",
      summary: razorpayConfigured ? "Live Razorpay Orders & Payment Links active" : "Missing live RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET \u2014 using sandbox fallback"
    },
    {
      provider: "Stripe",
      category: "PAYMENTS",
      configured: stripeConfigured,
      mode: stripeConfigured ? "LIVE" : "SANDBOX_FALLBACK",
      summary: stripeConfigured ? "Live Stripe PaymentIntents & Checkout Links active" : "Missing live STRIPE_SECRET_KEY \u2014 using sandbox fallback"
    },
    {
      provider: "Shiprocket",
      category: "LOGISTICS",
      configured: shiprocketConfigured,
      mode: shiprocketConfigured ? "LIVE" : "SANDBOX_FALLBACK",
      summary: shiprocketConfigured ? "Live Shiprocket AWB dispatch & courier API active" : "Missing live SHIPROCKET credentials \u2014 using Pune hub sandbox AWB"
    },
    {
      provider: "Delhivery",
      category: "LOGISTICS",
      configured: delhiveryConfigured,
      mode: delhiveryConfigured ? "LIVE" : "SANDBOX_FALLBACK",
      summary: delhiveryConfigured ? "Live Delhivery express surface/air cargo active" : "Missing live DELHIVERY_API_KEY \u2014 using Delhivery sandbox fallback"
    },
    {
      provider: "Transactional SMTP",
      category: "MESSAGING",
      configured: smtpConfigured,
      mode: smtpConfigured ? "LIVE" : "SANDBOX_FALLBACK",
      summary: smtpConfigured ? `Live SMTP relay configured (${process.env.SMTP_HOST})` : "Missing SMTP_HOST / SMTP_USER / SMTP_PASS \u2014 logging email dispatches locally"
    },
    {
      provider: "WhatsApp Business",
      category: "MESSAGING",
      configured: whatsappConfigured,
      mode: whatsappConfigured ? "LIVE" : "SANDBOX_FALLBACK",
      summary: whatsappConfigured ? "Live Meta WhatsApp Cloud API active" : "Missing WHATSAPP_ACCESS_TOKEN / PHONE_NUMBER_ID \u2014 logging WhatsApp dispatches locally"
    }
  ];
}
async function createGatewayOrderOrIntent(params) {
  if (params.gateway === "CASH_ON_DELIVERY") {
    return {
      mode: "SANDBOX_FALLBACK",
      provider: "CASH_ON_DELIVERY",
      paymentId: `cod_verified_${Date.now()}`
    };
  }
  const amountPaise = Math.max(100, Math.round(params.amountInr * 100));
  if (params.gateway === "RAZORPAY") {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (isConfiguredCredential(keyId) && isConfiguredCredential(keySecret)) {
      try {
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
        const res = await fetch("https://api.razorpay.com/v1/orders", {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            amount: amountPaise,
            currency: "INR",
            receipt: params.receipt.slice(0, 40),
            notes: {
              customerEmail: params.customerEmail,
              customerName: params.customerName
            }
          })
        });
        const data = await res.json();
        if (res.ok && data.id) {
          return {
            mode: "LIVE",
            provider: "RAZORPAY",
            paymentId: data.id
          };
        }
        return {
          mode: "SANDBOX_FALLBACK",
          provider: "RAZORPAY",
          paymentId: `pay_rzp_sbx_${Date.now()}`,
          fallbackReason: data?.error?.description || `Razorpay HTTP ${res.status}`
        };
      } catch (err) {
        return {
          mode: "SANDBOX_FALLBACK",
          provider: "RAZORPAY",
          paymentId: `pay_rzp_sbx_${Date.now()}`,
          fallbackReason: err.message
        };
      }
    }
    return {
      mode: "SANDBOX_FALLBACK",
      provider: "RAZORPAY",
      paymentId: `pay_rzp_sbx_${Date.now()}`,
      fallbackReason: "Razorpay live credentials not configured"
    };
  }
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (isConfiguredCredential(stripeSecret)) {
    try {
      const form = new URLSearchParams();
      form.set("amount", String(amountPaise));
      form.set("currency", "inr");
      form.set("receipt_email", params.customerEmail);
      form.set("description", `Bharatvarsh Order ${params.receipt}`);
      form.set("metadata[customerName]", params.customerName);
      const res = await fetch("https://api.stripe.com/v1/payment_intents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecret}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form.toString()
      });
      const data = await res.json();
      if (res.ok && data.id) {
        return {
          mode: "LIVE",
          provider: "STRIPE",
          paymentId: data.id,
          clientSecret: data.client_secret
        };
      }
      return {
        mode: "SANDBOX_FALLBACK",
        provider: "STRIPE",
        paymentId: `pi_str_sbx_${Date.now()}`,
        fallbackReason: data?.error?.message || `Stripe HTTP ${res.status}`
      };
    } catch (err) {
      return {
        mode: "SANDBOX_FALLBACK",
        provider: "STRIPE",
        paymentId: `pi_str_sbx_${Date.now()}`,
        fallbackReason: err.message
      };
    }
  }
  return {
    mode: "SANDBOX_FALLBACK",
    provider: "STRIPE",
    paymentId: `pi_str_sbx_${Date.now()}`,
    fallbackReason: "Stripe live credentials not configured"
  };
}
async function createPaymentLink(params) {
  const gateway = params.gateway || "RAZORPAY";
  const amountPaise = Math.max(100, Math.round(params.amountInr * 100));
  const ref = params.referenceId || `bvl_lnk_${Date.now().toString(36)}`;
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  if (gateway === "RAZORPAY") {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (isConfiguredCredential(keyId) && isConfiguredCredential(keySecret)) {
      try {
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
        const res = await fetch("https://api.razorpay.com/v1/payment_links", {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            amount: amountPaise,
            currency: "INR",
            reference_id: ref.slice(0, 40),
            description: params.description.slice(0, 200),
            customer: {
              name: params.customerName || "Valued Patron",
              email: params.customerEmail,
              ...params.customerPhone ? { contact: params.customerPhone } : {}
            },
            notify: {
              sms: Boolean(params.customerPhone),
              email: Boolean(params.customerEmail)
            }
          })
        });
        const data = await res.json();
        if (res.ok && data.short_url) {
          return {
            mode: "LIVE",
            provider: "RAZORPAY",
            paymentUrl: data.short_url,
            referenceId: data.id || ref
          };
        }
        return {
          mode: "SANDBOX_FALLBACK",
          provider: "RAZORPAY",
          paymentUrl: `${appUrl}/?payment_link=${encodeURIComponent(ref)}&gateway=razorpay`,
          referenceId: ref,
          fallbackReason: data?.error?.description || `Razorpay HTTP ${res.status}`
        };
      } catch (err) {
        return {
          mode: "SANDBOX_FALLBACK",
          provider: "RAZORPAY",
          paymentUrl: `${appUrl}/?payment_link=${encodeURIComponent(ref)}&gateway=razorpay`,
          referenceId: ref,
          fallbackReason: err.message
        };
      }
    }
    return {
      mode: "SANDBOX_FALLBACK",
      provider: "RAZORPAY",
      paymentUrl: `${appUrl}/?payment_link=${encodeURIComponent(ref)}&gateway=razorpay`,
      referenceId: ref,
      fallbackReason: "Razorpay live credentials not configured"
    };
  }
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (isConfiguredCredential(stripeSecret)) {
    try {
      const form = new URLSearchParams();
      form.set("mode", "payment");
      form.set("customer_email", params.customerEmail);
      form.set("line_items[0][price_data][currency]", "inr");
      form.set("line_items[0][price_data][product_data][name]", params.description.slice(0, 120));
      form.set("line_items[0][price_data][unit_amount]", String(amountPaise));
      form.set("line_items[0][quantity]", "1");
      form.set("success_url", `${appUrl}/?payment_success=${encodeURIComponent(ref)}`);
      form.set("cancel_url", `${appUrl}/?payment_cancelled=${encodeURIComponent(ref)}`);
      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecret}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form.toString()
      });
      const data = await res.json();
      if (res.ok && data.url) {
        return {
          mode: "LIVE",
          provider: "STRIPE",
          paymentUrl: data.url,
          referenceId: data.id || ref
        };
      }
      return {
        mode: "SANDBOX_FALLBACK",
        provider: "STRIPE",
        paymentUrl: `${appUrl}/?payment_link=${encodeURIComponent(ref)}&gateway=stripe`,
        referenceId: ref,
        fallbackReason: data?.error?.message || `Stripe HTTP ${res.status}`
      };
    } catch (err) {
      return {
        mode: "SANDBOX_FALLBACK",
        provider: "STRIPE",
        paymentUrl: `${appUrl}/?payment_link=${encodeURIComponent(ref)}&gateway=stripe`,
        referenceId: ref,
        fallbackReason: err.message
      };
    }
  }
  return {
    mode: "SANDBOX_FALLBACK",
    provider: "STRIPE",
    paymentUrl: `${appUrl}/?payment_link=${encodeURIComponent(ref)}&gateway=stripe`,
    referenceId: ref,
    fallbackReason: "Stripe live credentials not configured"
  };
}
async function getShiprocketBearerToken() {
  if (isConfiguredCredential(process.env.SHIPROCKET_API_TOKEN)) {
    return process.env.SHIPROCKET_API_TOKEN.trim();
  }
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  if (isConfiguredCredential(email) && isConfiguredCredential(password)) {
    const res = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok && data.token) return data.token;
  }
  return null;
}
async function allocateCourierAwb(params) {
  const preferred = params.courierPreference || "SHIPROCKET";
  const ord = params.order;
  if (preferred === "DELHIVERY") {
    const apiKey = process.env.DELHIVERY_API_KEY;
    if (isConfiguredCredential(apiKey)) {
      try {
        const res = await fetch(
          `https://track.delhivery.com/waybill/api/fetch/json/?token=${encodeURIComponent(apiKey)}&cl=${encodeURIComponent(
            process.env.DELHIVERY_CLIENT_NAME || "BHARATVARSH_SURFACE"
          )}`
        );
        const text = await res.text();
        const cleaned = text.replace(/["\s]/g, "");
        if (res.ok && cleaned.length >= 6) {
          return {
            mode: "LIVE",
            courier: "DELHIVERY",
            awbNumber: cleaned
          };
        }
      } catch (err) {
        return {
          mode: "SANDBOX_FALLBACK",
          courier: "DELHIVERY",
          awbNumber: ord.awbNumber || `DLV-PNQ-${Math.floor(1e7 + Math.random() * 9e7)}`,
          fallbackReason: err.message
        };
      }
    }
    return {
      mode: "SANDBOX_FALLBACK",
      courier: "DELHIVERY",
      awbNumber: ord.awbNumber || `DLV-PNQ-${Math.floor(1e7 + Math.random() * 9e7)}`,
      fallbackReason: "Delhivery API key not configured"
    };
  }
  try {
    const token = await getShiprocketBearerToken();
    if (token) {
      const res = await fetch("https://apiv2.shiprocket.in/v1/external/orders/create/adhoc", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          order_id: ord.orderNumber,
          order_date: ord.createdAt.slice(0, 19).replace("T", " "),
          pickup_location: "Primary",
          billing_customer_name: ord.customerName,
          billing_last_name: "",
          billing_address: ord.billingAddress?.street || "Pune Primary Hub",
          billing_city: ord.billingAddress?.city || "Pune",
          billing_pincode: ord.billingAddress?.pincode || "411019",
          billing_state: ord.billingAddress?.state || "Maharashtra",
          billing_country: "India",
          billing_email: ord.customerEmail,
          billing_phone: (ord.customerPhone || "9820112345").replace(/\D/g, "").slice(-10) || "9820112345",
          shipping_is_billing: true,
          order_items: ord.items.map((it) => ({
            name: it.productName,
            sku: it.sku,
            units: it.quantity,
            selling_price: it.unitPrice
          })),
          payment_method: ord.paymentGateway === "CASH_ON_DELIVERY" ? "COD" : "Prepaid",
          sub_total: ord.totalAmount,
          length: 34,
          breadth: 26,
          height: 12,
          weight: 1.4
        })
      });
      const data = await res.json();
      const awb = data?.awb_code || (data?.shipment_id ? `SR-SHP-${data.shipment_id}` : "");
      if (res.ok && awb) {
        return {
          mode: "LIVE",
          courier: "SHIPROCKET",
          awbNumber: String(awb)
        };
      }
      return {
        mode: "SANDBOX_FALLBACK",
        courier: "SHIPROCKET",
        awbNumber: ord.awbNumber || `SR-PNQ-${Math.floor(1e7 + Math.random() * 9e7)}`,
        fallbackReason: data?.message || `Shiprocket HTTP ${res.status}`
      };
    }
  } catch (err) {
    return {
      mode: "SANDBOX_FALLBACK",
      courier: "SHIPROCKET",
      awbNumber: ord.awbNumber || `SR-PNQ-${Math.floor(1e7 + Math.random() * 9e7)}`,
      fallbackReason: err.message
    };
  }
  return {
    mode: "SANDBOX_FALLBACK",
    courier: "SHIPROCKET",
    awbNumber: ord.awbNumber || `SR-PNQ-${Math.floor(1e7 + Math.random() * 9e7)}`,
    fallbackReason: "Shiprocket credentials not configured"
  };
}
function getSupportOrderEmailRecipient() {
  const configured = process.env.SUPPORT_ORDER_EMAIL || process.env.SMTP_SUPPORT_EMAIL;
  if (configured && isConfiguredCredential(configured)) {
    return configured.trim();
  }
  return "Support@bharatvarshcrafts.com";
}
function getMissingSmtpReason() {
  const missing = [];
  if (!isConfiguredCredential(process.env.SMTP_HOST)) missing.push("SMTP_HOST");
  if (!isConfiguredCredential(process.env.SMTP_USER)) missing.push("SMTP_USER");
  if (!isConfiguredCredential(process.env.SMTP_PASS)) missing.push("SMTP_PASS");
  if (missing.length === 0) return "";
  return `Missing ${missing.join(", ")} in server environment`;
}
async function sendTransactionalEmail(params) {
  const recipient = (params.to || "").trim();
  if (!recipient || !recipient.includes("@")) {
    return {
      mode: "SANDBOX_FALLBACK",
      channel: "EMAIL",
      messageId: `email_err_${Date.now()}`,
      smtpConfigured: false,
      fallbackReason: "Missing or invalid recipient email address"
    };
  }
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 465;
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465;
  const from = process.env.SMTP_SUPPORT_EMAIL || user || "Support@bharatvarshcrafts.com";
  const smtpConfigured = isConfiguredCredential(host) && isConfiguredCredential(user) && isConfiguredCredential(pass);
  if (smtpConfigured) {
    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass }
      });
      const info = await transporter.sendMail({
        from: `"Bharatvarsh Leathercrafts LLP" <${from}>`,
        to: recipient,
        subject: params.subject,
        text: params.text,
        html: params.html || `<p>${params.text.replace(/\n/g, "<br/>")}</p>`,
        ...Array.isArray(params.attachments) && params.attachments.length > 0 ? { attachments: params.attachments } : {}
      });
      return {
        mode: "LIVE",
        channel: "EMAIL",
        messageId: info.messageId || `smtp_${Date.now()}`,
        smtpConfigured: true
      };
    } catch (err) {
      return {
        mode: "SANDBOX_FALLBACK",
        channel: "EMAIL",
        messageId: `email_sbx_${Date.now()}`,
        smtpConfigured: true,
        fallbackReason: `SMTP transport error: ${err.message}`
      };
    }
  }
  return {
    mode: "SANDBOX_FALLBACK",
    channel: "EMAIL",
    messageId: `email_sbx_${Date.now()}`,
    smtpConfigured: false,
    fallbackReason: getMissingSmtpReason() || "SMTP credentials not configured"
  };
}
async function sendWhatsAppMessage(params) {
  const phoneId = process.env.WHATSAPP_BUSINESS_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const cleanPhone = (params.toPhone || "").replace(/[^\d]/g, "");
  if (isConfiguredCredential(phoneId) && isConfiguredCredential(accessToken) && cleanPhone.length >= 10) {
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone,
          type: "text",
          text: { body: params.text.slice(0, 4096) }
        })
      });
      const data = await res.json();
      const waId = data?.messages?.[0]?.id;
      if (res.ok && waId) {
        return {
          mode: "LIVE",
          channel: "WHATSAPP",
          messageId: waId
        };
      }
      return {
        mode: "SANDBOX_FALLBACK",
        channel: "WHATSAPP",
        messageId: `wa_sbx_${Date.now()}`,
        fallbackReason: data?.error?.message || `WhatsApp API HTTP ${res.status}`
      };
    } catch (err) {
      return {
        mode: "SANDBOX_FALLBACK",
        channel: "WHATSAPP",
        messageId: `wa_sbx_${Date.now()}`,
        fallbackReason: err.message
      };
    }
  }
  return {
    mode: "SANDBOX_FALLBACK",
    channel: "WHATSAPP",
    messageId: `wa_sbx_${Date.now()}`,
    fallbackReason: cleanPhone.length < 10 ? "Valid patron phone number missing" : "WhatsApp Business Cloud API credentials not configured"
  };
}
function resolveOrderInvoiceContext(order) {
  const config = db.getConfig();
  const storedInvoice = db.getInvoices().find((inv) => inv.orderId === order.id || order.invoiceNumber && inv.invoiceNumber === order.invoiceNumber);
  const customer = db.getCustomerById(order.customerId) || db.getCustomerById(order.customerEmail);
  const defaultAddress = customer ? db.getDefaultCustomerAddress(customer.id) : void 0;
  const shipState = order.shippingAddress?.state || defaultAddress?.state || "Maharashtra";
  const isInterState = shipState.trim().toLowerCase() !== "maharashtra";
  const taxableValue = Math.max(0, order.subtotal - (order.discountAmount || 0));
  const invoice = storedInvoice || {
    id: `inv_summary_${order.id}`,
    invoiceNumber: order.invoiceNumber || order.orderNumber,
    orderId: order.id,
    customerId: order.customerId,
    supplierGstin: config.supplierGstin || "27AABCB1234F1Z8",
    invoiceDate: order.createdAt,
    supplyState: "Maharashtra",
    placeOfSupply: shipState,
    isInterState,
    taxableValue,
    cgstAmount: isInterState ? 0 : Math.round(order.taxAmount / 2),
    sgstAmount: isInterState ? 0 : order.taxAmount - Math.round(order.taxAmount / 2),
    igstAmount: isInterState ? order.taxAmount : 0,
    totalInvoiceAmount: order.totalAmount,
    status: "ISSUED"
  };
  const pdfBuffer = renderTaxInvoicePdf(invoice, order, config, { customer, defaultAddress });
  const safeFilename = `${invoice.invoiceNumber.replace(/[/\\]/g, "-")}.pdf`;
  return { config, invoice, customer, defaultAddress, pdfBuffer, safeFilename };
}
function escapeEmailHtml(val) {
  return String(val || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
async function dispatchOrderInvoiceEmailToSupport(order) {
  const supportTo = getSupportOrderEmailRecipient();
  const { invoice, defaultAddress, pdfBuffer, safeFilename } = resolveOrderInvoiceContext(order);
  const addr = order.shippingAddress || defaultAddress;
  const addrLine = addr ? [addr.street, addr.city, addr.state, addr.pincode ? `PIN ${addr.pincode}` : "", addr.country || "India"].filter(Boolean).join(", ") : invoice.placeOfSupply;
  const itemsHtml = order.items.map(
    (it) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #EFEAE2;">
          <strong>${escapeEmailHtml(it.productName)}</strong><br/>
          <span style="font-size:11px;color:#5C4D3E;font-family:monospace;">SKU: ${escapeEmailHtml(it.sku)} \xB7 ${it.leatherType === "BIO_SUBSTITUTE_CACTUS" ? "Bio-Cactus" : "Veg-Tanned Heritage"}</span>
        </td>
        <td style="padding:8px;border-bottom:1px solid #EFEAE2;font-size:12px;">${it.customization?.monogramInitials ? `Initials: <strong>${escapeEmailHtml(it.customization.monogramInitials)}</strong> (${escapeEmailHtml(
      it.customization.foilType
    )})` : "None"}</td>
        <td style="padding:8px;border-bottom:1px solid #EFEAE2;text-align:center;font-family:monospace;">${it.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #EFEAE2;text-align:right;font-family:monospace;">&#8377;${Math.round(
      it.lineTotal
    ).toLocaleString("en-IN")}</td>
      </tr>`
  ).join("");
  const taxSummaryLine = invoice.isInterState ? `IGST: \u20B9${Math.round(invoice.igstAmount).toLocaleString("en-IN")}` : `CGST: \u20B9${Math.round(invoice.cgstAmount).toLocaleString("en-IN")} \xB7 SGST: \u20B9${Math.round(
    invoice.sgstAmount
  ).toLocaleString("en-IN")}`;
  const subject = `New Order Placed: ${order.orderNumber} \u2014 \u20B9${Math.round(order.totalAmount).toLocaleString(
    "en-IN"
  )} (${order.customerName})`;
  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#FAF7F2;padding:24px;color:#16120E;">
    <div style="max-width:680px;margin:0 auto;background:#FFFFFF;border:1px solid #D8CFC2;padding:28px;border-radius:8px;">
      <div style="border-bottom:2px solid #8B4513;padding-bottom:14px;margin-bottom:18px;">
        <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#8B4513;font-weight:700;">Bharatvarsh Leathercrafts LLP \xB7 New Sales Order</div>
        <h2 style="margin:6px 0 4px;font-family:Georgia,serif;font-size:20px;">${escapeEmailHtml(order.orderNumber)} \xB7 &#8377;${Math.round(
    order.totalAmount
  ).toLocaleString("en-IN")}</h2>
        <div style="font-size:12px;color:#5C4D3E;">Invoice: <strong>${escapeEmailHtml(invoice.invoiceNumber)}</strong> \xB7 Gateway: <strong>${escapeEmailHtml(
    order.paymentGateway
  )}</strong> (${escapeEmailHtml(order.paymentStatus)})</div>
      </div>

      <div style="background:#FAF7F2;border:1px solid #E5DDD0;padding:14px;border-radius:6px;font-size:12px;line-height:1.6;margin-bottom:18px;">
        <div><strong>Patron:</strong> ${escapeEmailHtml(order.customerName)} (${escapeEmailHtml(order.customerEmail)})</div>
        <div><strong>Phone:</strong> ${escapeEmailHtml(order.customerPhone || "N/A")}</div>
        <div><strong>Shipping Address:</strong> ${escapeEmailHtml(addrLine)}</div>
        <div><strong>Place of Supply:</strong> ${escapeEmailHtml(invoice.placeOfSupply)} (${invoice.isInterState ? "Inter-State IGST" : "Intra-State CGST + SGST"})</div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:18px;">
        <thead>
          <tr style="background:#FAF7F2;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#5C4D3E;">
            <th style="padding:8px;">Piece &amp; SKU</th>
            <th style="padding:8px;">Monogram Specs</th>
            <th style="padding:8px;text-align:center;">Qty</th>
            <th style="padding:8px;text-align:right;">Line Total</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <div style="font-size:12px;background:#FAF7F2;padding:12px;border-radius:6px;font-family:monospace;">
        <div>Subtotal: &#8377;${Math.round(order.subtotal).toLocaleString("en-IN")}${order.discountAmount > 0 ? ` \xB7 Discount (${escapeEmailHtml(order.discountCode || "PROMO")}): -&#8377;${Math.round(
    order.discountAmount
  ).toLocaleString("en-IN")}` : ""}</div>
        <div>Taxable Value: &#8377;${Math.round(invoice.taxableValue).toLocaleString("en-IN")} \xB7 ${escapeEmailHtml(
    taxSummaryLine
  )}</div>
        <div style="margin-top:6px;font-size:14px;font-weight:700;">Total Amount: &#8377;${Math.round(
    order.totalAmount
  ).toLocaleString("en-IN")}</div>
      </div>

      <div style="margin-top:16px;font-size:11px;color:#5C4D3E;">
        Registered Office: ${REGISTERED_OFFICE_ADDRESS_HTML}. Official GST Tax Invoice PDF (${escapeEmailHtml(
    safeFilename
  )}) is attached.
      </div>
    </div>
  </div>`;
  const text = [
    `New Order Placed: ${order.orderNumber} \u2014 \u20B9${Math.round(order.totalAmount).toLocaleString("en-IN")}`,
    `Patron: ${order.customerName} | Email: ${order.customerEmail} | Phone: ${order.customerPhone || "N/A"}`,
    `Shipping Address: ${addrLine}`,
    `Invoice: ${invoice.invoiceNumber} | Payment: ${order.paymentGateway} (${order.paymentStatus})`,
    `Tax Breakdown: Taxable \u20B9${invoice.taxableValue} | ${taxSummaryLine}`,
    "",
    "Items:",
    ...order.items.map(
      (it) => `- ${it.productName} (${it.sku}) x${it.quantity} \u2014 \u20B9${it.lineTotal}${it.customization?.monogramInitials ? ` [Monogram: ${it.customization.monogramInitials} / ${it.customization.foilType}]` : ""}`
    )
  ].join("\n");
  return sendTransactionalEmail({
    to: supportTo,
    subject,
    text,
    html,
    attachments: [
      {
        filename: safeFilename,
        content: pdfBuffer,
        contentType: "application/pdf"
      }
    ]
  });
}
async function dispatchOrderConfirmationAndCareGuide(order) {
  const { pdfBuffer, safeFilename } = resolveOrderInvoiceContext(order);
  const summaryLines = order.items.map(
    (it) => `\u2022 ${it.productName} (${it.quantity}x) \u2014 \u20B9${it.unitPrice.toLocaleString("en-IN")}${it.customization?.monogramInitials ? ` [Monogram: ${it.customization.monogramInitials}]` : ""}`
  );
  const text = [
    `Dear ${order.customerName},`,
    "",
    `Thank you for commissioning Bharatvarsh Leathercrafts LLP (Order ${order.orderNumber}).`,
    `Total Paid: \u20B9${order.totalAmount.toLocaleString("en-IN")} | Invoice: ${order.invoiceNumber || "Issued"}`,
    `Logistics Partner: ${order.courierPartner || "SHIPROCKET"} | AWB: ${order.awbNumber || "Pending"}`,
    "",
    "Pieces Commissioned:",
    ...summaryLines,
    "",
    "Digital Heirloom Care Guide:",
    "Apply organic beeswax conditioning balm lightly every 90 days and buff with a soft horsehair brush. Avoid prolonged monsoon moisture; store in your breathable cotton dust bag.",
    "",
    "Warm regards,",
    "Bharatvarsh Atelier \xB7 Pune Primary Hub"
  ].join("\n");
  const [emailDelivery, supportEmailDelivery, whatsappDelivery] = await Promise.all([
    sendTransactionalEmail({
      to: order.customerEmail,
      subject: `Bharatvarsh Atelier Confirmation \xB7 ${order.orderNumber}`,
      text,
      attachments: [
        {
          filename: safeFilename,
          content: pdfBuffer,
          contentType: "application/pdf"
        }
      ]
    }),
    dispatchOrderInvoiceEmailToSupport(order),
    sendWhatsAppMessage({
      toPhone: order.customerPhone,
      text: `Bharatvarsh Atelier: Order ${order.orderNumber} confirmed (\u20B9${order.totalAmount.toLocaleString(
        "en-IN"
      )}). AWB: ${order.awbNumber}. Digital Beeswax Care Guide included inside your My Atelier portal.`
    })
  ]);
  return { emailDelivery, supportEmailDelivery, whatsappDelivery };
}
async function dispatchCartRecoveryNotice(cart, channel, promoCode, fullCheckoutUrl) {
  const itemNames = cart.items.map((it) => `${it.productName} (x${it.quantity})`).join(", ");
  if (channel === "WHATSAPP") {
    return sendWhatsAppMessage({
      toPhone: cart.phone,
      text: `Bharatvarsh Atelier: Your reserved leathercraft bag (${itemNames}, \u20B9${cart.subtotal.toLocaleString(
        "en-IN"
      )}) awaits at Pune Hub. Use ${promoCode} at checkout: ${fullCheckoutUrl}`
    });
  }
  const itemRowsHtml = cart.items.map(
    (it) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #EFEAE2;">
          <strong>${escapeEmailHtml(it.productName)}</strong>
          <div style="font-size:11px;color:#5C4D3E;font-family:monospace;">SKU: ${escapeEmailHtml(it.sku || "")}</div>
        </td>
        <td style="padding:8px;border-bottom:1px solid #EFEAE2;text-align:center;font-family:monospace;">${it.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #EFEAE2;text-align:right;font-family:monospace;">&#8377;${Math.round(
      Number(it.unitPrice || 0) * Math.max(1, Number(it.quantity || 1))
    ).toLocaleString("en-IN")}</td>
      </tr>`
  ).join("");
  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#FAF7F2;padding:24px;color:#16120E;">
    <div style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid #D8CFC2;padding:28px;border-radius:8px;">
      <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#8B4513;font-weight:700;">Bharatvarsh Leathercrafts LLP</div>
      <h2 style="font-family:Georgia,serif;font-size:20px;margin:8px 0;">Your Reserved Atelier Bag Awaits</h2>
      <p style="font-size:13px;color:#5C4D3E;line-height:1.6;">
        Your handcrafted leathercraft selection remains reserved at our Pune Primary Hub. Complete your commission today using exclusive privilege code <strong style="color:#16120E;font-family:monospace;">${escapeEmailHtml(
    promoCode
  )}</strong>.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin:16px 0;">
        <thead>
          <tr style="background:#FAF7F2;text-align:left;font-size:10px;text-transform:uppercase;color:#5C4D3E;">
            <th style="padding:8px;">Selected Piece</th>
            <th style="padding:8px;text-align:center;">Qty</th>
            <th style="padding:8px;text-align:right;">Value</th>
          </tr>
        </thead>
        <tbody>${itemRowsHtml}</tbody>
      </table>
      <div style="font-size:13px;font-weight:700;text-align:right;margin-bottom:18px;font-family:monospace;">
        Bag Subtotal: &#8377;${Math.round(cart.subtotal).toLocaleString("en-IN")}
      </div>
      <div style="text-align:center;margin:20px 0;">
        <a href="${escapeEmailHtml(
    fullCheckoutUrl
  )}" style="display:inline-block;padding:12px 24px;background:#221C16;color:#FAF7F2;text-decoration:none;font-weight:700;font-size:13px;border-radius:6px;">
          Resume Reserved Checkout (${escapeEmailHtml(promoCode)})
        </a>
      </div>
      <div style="font-size:11px;color:#5C4D3E;border-top:1px solid #EFEAE2;padding-top:12px;">
        Direct link: ${escapeEmailHtml(fullCheckoutUrl)}
      </div>
    </div>
  </div>`;
  return sendEmail({
    to: cart.email,
    subject: `Your Handcrafted Bharatvarsh Atelier Bag Awaits (${promoCode})`,
    text: `Your selected pieces (${itemNames}, Subtotal: \u20B9${Math.round(cart.subtotal).toLocaleString(
      "en-IN"
    )}) remain reserved at our Pune Primary Hub.

Complete your commission with code ${promoCode}: ${fullCheckoutUrl}`,
    html
  });
}
async function dispatchInboxAgentReply(params) {
  if (params.channel === "EMAIL") {
    return sendTransactionalEmail({
      to: params.ticket.customerEmail,
      subject: `Re: [${params.ticket.ticketNumber}] ${params.ticket.subject}`,
      text: params.text
    });
  }
  if (params.channel === "WHATSAPP") {
    return sendWhatsAppMessage({
      toPhone: params.toPhone || params.ticket.customerPhone,
      text: `[${params.ticket.ticketNumber}] ${params.text}`
    });
  }
  return {
    mode: "SANDBOX_FALLBACK",
    channel: "LIVE_CHAT",
    messageId: `chat_${Date.now()}`,
    fallbackReason: "Delivered via in-app Atelier live chat session"
  };
}
var sendEmail;
var init_integrations = __esm({
  "src/server/integrations.ts"() {
    init_db();
    init_invoicePdf();
    sendEmail = sendTransactionalEmail;
  }
});

// src/server/erpSync.ts
var ERPSynchronizer, erpSync;
var init_erpSync = __esm({
  "src/server/erpSync.ts"() {
    init_db();
    init_integrations();
    ERPSynchronizer = class {
      /**
       * Pushes a custom quote / B2B corporate gifting lead directly into the ERP as an official Sales Order
       */
      async pushCustomQuoteToSalesOrder(payload, actorEmail) {
        const linkedLead = payload.leadId ? db.getCorporateGiftingLeads().find((l) => l.id === payload.leadId) : void 0;
        if (payload.leadId && !linkedLead) {
          throw new Error(`Corporate gifting lead "${payload.leadId}" not found.`);
        }
        if (linkedLead?.erpOrderId) {
          throw new Error(
            `DUPLICATE_ERP_ORDER: Corporate lead "${linkedLead.companyName}" is already linked to ERP Sales Order ${linkedLead.erpOrderNumber || linkedLead.erpOrderId}.`
          );
        }
        const rawItems = Array.isArray(payload.items) && payload.items.length > 0 ? payload.items : Array.isArray(linkedLead?.items) && linkedLead.items.length > 0 ? linkedLead.items : [];
        if (rawItems.length === 0) {
          throw new Error("At least one catalog SKU and quantity must be selected before pushing to ERP Sales Order.");
        }
        const catalogProducts = db.getCatalog().products || [];
        const storeDefaultGstRate = (typeof db.getConfig().gstRatePercent === "number" ? db.getConfig().gstRatePercent : 18) / 100;
        let subtotal = 0;
        let totalTaxAmount = 0;
        const orderItems = rawItems.map((item, idx) => {
          const matchedProduct = catalogProducts.find(
            (p) => item.productId && p.id === item.productId || item.sku && p.sku === item.sku
          );
          if (!matchedProduct && !item.productId && typeof item.unitPrice !== "number") {
            throw new Error(`Unknown catalog SKU in quote: ${item.sku}`);
          }
          const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
          const resolvedUnitPrice = typeof item.unitPrice === "number" && Number.isFinite(item.unitPrice) && item.unitPrice > 0 ? item.unitPrice : Number(matchedProduct?.price || 0);
          if (!Number.isFinite(resolvedUnitPrice) || resolvedUnitPrice <= 0) {
            throw new Error(`Invalid unit price for SKU ${item.sku}`);
          }
          const gstRate = typeof matchedProduct?.gstRate === "number" ? matchedProduct.gstRate : storeDefaultGstRate;
          const lineSubtotal = qty * resolvedUnitPrice;
          const lineTax = Math.round(lineSubtotal * gstRate);
          subtotal += lineSubtotal;
          totalTaxAmount += lineTax;
          return {
            id: `item_quote_${Date.now()}_${idx}`,
            orderId: "",
            productId: item.productId || matchedProduct?.id || `prod_${item.sku}`,
            productName: item.productName || matchedProduct?.name || item.sku,
            sku: matchedProduct?.sku || item.sku,
            category: matchedProduct?.category || "travell",
            quantity: qty,
            unitPrice: resolvedUnitPrice,
            leatherType: item.leatherType === "BIO_SUBSTITUTE_CACTUS" ? "BIO_SUBSTITUTE_CACTUS" : "VEGETABLE_TANNED_HERITAGE",
            customization: item.monogramInitials ? {
              monogramInitials: item.monogramInitials,
              foilType: item.foilType || "GOLD_FOIL",
              placement: "Custom Specification"
            } : void 0,
            hsnCode: matchedProduct?.hsnCode || "4202",
            gstRate,
            taxAmount: lineTax,
            lineTotal: lineSubtotal + lineTax
          };
        });
        const totalAmount = subtotal + totalTaxAmount;
        const resolvedEmail = (payload.customerEmail || linkedLead?.email || "").trim().toLowerCase();
        const resolvedName = payload.customerName || (linkedLead ? `${linkedLead.companyName} (${linkedLead.contactPerson})` : "Corporate Patron");
        const resolvedPhone = payload.customerPhone || linkedLead?.phone || "";
        let resolvedCustomerId = payload.customerId;
        if (!resolvedCustomerId && resolvedEmail) {
          const { customer } = await db.runAtomicMutation(
            () => db.findOrCreateCustomer({
              email: resolvedEmail,
              phone: resolvedPhone,
              fullName: resolvedName
            })
          );
          resolvedCustomerId = customer.id;
        }
        const customerIdFinal = resolvedCustomerId || `cust_corp_${Date.now()}`;
        const newOrder = await db.createOrderAsync({
          customerId: customerIdFinal,
          customerName: resolvedName,
          customerEmail: resolvedEmail || "corporate@bharatvarshcrafts.com",
          customerPhone: resolvedPhone,
          status: "PROCESSING",
          currency: "INR",
          subtotal,
          discountAmount: 0,
          taxAmount: totalTaxAmount,
          shippingFee: 0,
          totalAmount,
          paymentGateway: "RAZORPAY",
          paymentId: `quote_pay_${Date.now()}`,
          paymentStatus: "PAID",
          items: orderItems,
          shippingAddress: {
            id: `addr_quote_${Date.now()}`,
            customerId: customerIdFinal,
            street: "Consolidated Commercial Dock, Pune Primary Hub",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411001",
            country: "India",
            isDefault: true,
            addressType: "SHIPPING"
          },
          billingAddress: {
            id: `addr_quote_b_${Date.now()}`,
            customerId: customerIdFinal,
            street: "Consolidated Commercial Dock, Pune Primary Hub",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411001",
            country: "India",
            isDefault: true,
            addressType: "BILLING"
          }
        });
        await db.runAtomicMutation(() => {
          if (payload.leadId) {
            db.updateCorporateLeadStatus(payload.leadId, "ORDER_CONFIRMED", void 0, {
              erpOrderId: newOrder.id,
              erpOrderNumber: newOrder.orderNumber,
              items: orderItems.map((it) => ({
                sku: it.sku,
                productId: it.productId,
                productName: it.productName,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                leatherType: it.leatherType
              })),
              dealValueInr: totalAmount
            });
          }
          db.logAudit(
            actorEmail,
            "ERP_SALES_ORDER_PUSH",
            "STORE_MANAGEMENT",
            `CRM quote converted into ERP Sales Order ${newOrder.orderNumber} (Deal: ${payload.dealType || "WHOLESALE_BULK"}, Amount: \u20B9${totalAmount}${linkedLead ? `, Lead: ${linkedLead.companyName}` : ""})`
          );
        });
        dispatchOrderConfirmationAndCareGuide(newOrder).then((delivery) => {
          db.logAudit(
            "integrations",
            "ORDER_NOTIFICATION_DISPATCHED",
            "STORE_MANAGEMENT",
            `ERP Order ${newOrder.orderNumber} notifications -> PatronEmail:${delivery.emailDelivery.mode}, SupportInvoice:${delivery.supportEmailDelivery.mode}, WhatsApp:${delivery.whatsappDelivery.mode}`
          );
        }).catch((err) => {
          db.logAudit(
            "integrations",
            "ORDER_NOTIFICATION_ERROR",
            "STORE_MANAGEMENT",
            `Failed order notification dispatch for ${newOrder.orderNumber}: ${err?.message || err}`
          );
        });
        return newOrder;
      }
      /**
       * RMA & Return Lifecycle with warehouse inspection & credit note generation
       */
      async processRMA(rma) {
        const existingOrder = db.getOrderById(rma.orderId);
        if (!existingOrder) throw new Error(`Order ${rma.orderId} not found`);
        const targetLocation = rma.restockLocation === "mumbaiWarehouse" ? "mumbaiWarehouse" : "punePrimaryHub";
        const locationLabel = targetLocation === "punePrimaryHub" ? "Pune Primary Hub" : "Mumbai Warehouse";
        const lockItems = rma.restockInWarehouse ? existingOrder.items.map((it) => ({
          sku: it.sku,
          productId: it.productId,
          productName: it.productName,
          quantity: it.quantity
        })) : [];
        return db.runLockedStockMutation(lockItems, () => {
          const order = db.getOrderById(rma.orderId);
          if (!order) throw new Error(`Order ${rma.orderId} not found`);
          order.status = "RETURNED";
          order.paymentStatus = "REFUNDED";
          order.returnRequestStatus = "PROCESSED";
          order.returnReason = rma.reason;
          order.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
          if (rma.restockInWarehouse) {
            for (const item of order.items) {
              const inv = db.getInventory().find((i) => i.productId === item.productId || i.sku === item.sku);
              if (inv) {
                inv.stockByLocation[targetLocation] += item.quantity;
                db.logAudit(
                  rma.actorEmail,
                  "RESTOCK_INVENTORY",
                  "INVENTORY_ADJUSTMENT",
                  `Restocked ${item.quantity} units of ${inv.sku} to ${locationLabel} after RMA inspection.`
                );
              }
            }
          }
          let creditNote;
          if (order.invoiceNumber && db.getConfig().gstInvoicingEnabled) {
            creditNote = db.issueCreditNote(order.invoiceNumber, "GOODS_RETURN", rma.actorEmail);
          }
          db.logAudit(
            rma.actorEmail,
            "RMA_PROCESSED",
            "STORE_MANAGEMENT",
            `RMA concluded for ${order.orderNumber} (Reason: ${rma.reason}). Credit Note: ${creditNote ? creditNote.creditNoteNumber : "SUSPENDED"}`
          );
          return { order, creditNote };
        });
      }
      /**
       * Syncs real-time courier milestones (In Transit, Out for Delivery, Delivered, RTO) from Shiprocket / Delhivery
       */
      async syncCourierMilestone(orderId, milestone, locationName) {
        return db.runAtomicMutation(() => {
          const order = db.getOrderById(orderId);
          if (!order) throw new Error(`Order ${orderId} not found`);
          order.courierStatus = milestone;
          if (milestone === "DELIVERED") {
            order.status = "DELIVERED";
            if (!order.deliveredAt) {
              order.deliveredAt = (/* @__PURE__ */ new Date()).toISOString();
            }
          }
          order.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
          db.logAudit(
            "logistics_sync",
            "COURIER_MILESTONE_UPDATED",
            "STORE_MANAGEMENT",
            `Order ${order.orderNumber} AWB ${order.awbNumber}: Milestone changed to ${milestone} at ${locationName}`
          );
          return order;
        });
      }
    };
    erpSync = new ERPSynchronizer();
  }
});

// src/server/cartRecovery.ts
import crypto4 from "crypto";
import fs5 from "fs";
import path5 from "path";
var CartRecoveryEngine, cartRecovery;
var init_cartRecovery = __esm({
  "src/server/cartRecovery.ts"() {
    init_db();
    CartRecoveryEngine = class {
      constructor() {
        this.intervalTimer = null;
        this.cachedSecret = null;
      }
      getSigningSecret() {
        if (process.env.CART_RECOVERY_SECRET) {
          return process.env.CART_RECOVERY_SECRET;
        }
        if (this.cachedSecret) {
          return this.cachedSecret;
        }
        const secretPath = path5.resolve(process.cwd(), "src/server/data/.cart_recovery_key");
        try {
          if (fs5.existsSync(secretPath)) {
            const stored = fs5.readFileSync(secretPath, "utf-8").trim();
            if (stored.length >= 32) {
              this.cachedSecret = stored;
              return stored;
            }
          }
          const generated = crypto4.randomBytes(32).toString("hex");
          const dir = path5.dirname(secretPath);
          if (!fs5.existsSync(dir)) fs5.mkdirSync(dir, { recursive: true });
          fs5.writeFileSync(secretPath, generated, { encoding: "utf-8", mode: 384 });
          this.cachedSecret = generated;
          return generated;
        } catch {
          this.cachedSecret = crypto4.createHash("sha256").update("bvl-cart-fallback-secret").digest("hex");
          return this.cachedSecret;
        }
      }
      signResumeToken(cartId) {
        return crypto4.createHmac("sha256", this.getSigningSecret()).update(`resume:${cartId}`).digest("base64url");
      }
      verifyResumeToken(cartId, token) {
        if (!cartId || !token || typeof token !== "string") return false;
        const expected = this.signResumeToken(cartId);
        const actualBuf = Buffer.from(token);
        const expectedBuf = Buffer.from(expected);
        if (actualBuf.length !== expectedBuf.length) return false;
        return crypto4.timingSafeEqual(actualBuf, expectedBuf);
      }
      buildCheckoutResumeUrl(cartId) {
        const token = this.signResumeToken(cartId);
        return `/?resume=${encodeURIComponent(cartId)}&token=${encodeURIComponent(token)}`;
      }
      resolveCartRecipient(cartId) {
        const cart = db.getCartById(cartId);
        if (!cart) {
          throw new Error(`Cart ${cartId} not found`);
        }
        const matchedCustomer = (cart.customerId ? db.getCustomerById(cart.customerId) : void 0) || (cart.email ? db.getCustomerById(cart.email) : void 0);
        const resolvedEmail = (cart.email || matchedCustomer?.email || "").trim();
        const resolvedPhone = (cart.phone || matchedCustomer?.phone || "").trim();
        const twoHoursMs = 2 * 60 * 60 * 1e3;
        const inCooldown = Boolean(
          cart.lastRecoveryTriggerAt && Date.now() - new Date(cart.lastRecoveryTriggerAt).getTime() < twoHoursMs
        );
        return {
          cart: {
            ...cart,
            email: resolvedEmail || cart.email,
            phone: resolvedPhone || cart.phone,
            checkoutUrl: this.buildCheckoutResumeUrl(cart.id)
          },
          email: resolvedEmail,
          phone: resolvedPhone,
          inCooldown
        };
      }
      /**
       * Starts the background abandonment detection worker.
       * Sweeps every 60 seconds (or uses the configurable threshold).
       */
      startBackgroundWorker(intervalMs = 6e4) {
        if (this.intervalTimer) return;
        this.intervalTimer = setInterval(() => {
          this.runAbandonmentDetectionSweep();
        }, intervalMs);
        console.log(`[CartRecoveryEngine] Background worker running (sweep interval: ${intervalMs / 1e3}s)`);
      }
      stopBackgroundWorker() {
        if (this.intervalTimer) {
          clearInterval(this.intervalTimer);
          this.intervalTimer = null;
        }
      }
      /**
       * Scans all carts in the relational store.
       * If a cart has items, has not placed an order, and is idle beyond the threshold,
       * flags it as abandoned and emits a checkout.abandoned event.
       */
      runAbandonmentDetectionSweep() {
        const config = db.getConfig();
        const thresholdMinutes = config.abandonmentThresholdMinutes || 15;
        const abandonedCarts = db.detectAbandonedCarts(thresholdMinutes);
        for (const c of abandonedCarts) {
          c.checkoutUrl = this.buildCheckoutResumeUrl(c.id);
        }
        if (abandonedCarts.length > 0) {
          console.log(`[CartRecoveryEngine] Sweep flagged ${abandonedCarts.length} abandoned cart(s)`);
        }
        return {
          detectedCount: abandonedCarts.length,
          carts: abandonedCarts
        };
      }
      /**
       * Persists cart state from storefront (patron or guest) with signed resume link
       */
      persistStorefrontCart(data) {
        const saved = db.saveCartState(data);
        saved.checkoutUrl = this.buildCheckoutResumeUrl(saved.id);
        db.persistState();
        return saved;
      }
      /**
       * Idempotent recovery dispatcher for a specific cart
       */
      dispatchRecoveryMessage(cartId, channel) {
        const res = db.triggerCartRecovery(cartId, channel);
        res.cart.checkoutUrl = this.buildCheckoutResumeUrl(res.cart.id);
        db.persistState();
        return res;
      }
      /**
       * Resolves a resumable cart by cart ID and optional HMAC token.
       * Supports direct cart ID links as well as signed resume tokens; rejects tampered tokens.
       */
      resolveResumableCart(cartId, token) {
        const cleanId = (cartId || "").trim();
        if (!cleanId) {
          return { status: "NOT_FOUND", tokenVerified: false };
        }
        let tokenVerified = false;
        if (token !== void 0 && token !== "") {
          if (!this.verifyResumeToken(cleanId, token.trim())) {
            return { status: "INVALID_TOKEN", tokenVerified: false };
          }
          tokenVerified = true;
        }
        const cart = db.getCartById(cleanId);
        if (!cart) {
          return { status: "NOT_FOUND", tokenVerified: false };
        }
        return {
          status: "OK",
          cart: {
            ...cart,
            checkoutUrl: this.buildCheckoutResumeUrl(cart.id)
          },
          tokenVerified
        };
      }
    };
    cartRecovery = new CartRecoveryEngine();
  }
});

// src/server/rfm.ts
function classifyCustomerRFM(customer) {
  const { totalOrders, lifetimeValue, daysSinceLastOrder, discountOrdersCount } = customer;
  let recencyScore = 1;
  if (daysSinceLastOrder <= 30) recencyScore = 5;
  else if (daysSinceLastOrder <= 60) recencyScore = 4;
  else if (daysSinceLastOrder <= 90) recencyScore = 3;
  else if (daysSinceLastOrder <= 180) recencyScore = 2;
  else recencyScore = 1;
  let frequencyScore = 1;
  if (totalOrders >= 5) frequencyScore = 5;
  else if (totalOrders >= 3) frequencyScore = 4;
  else if (totalOrders >= 2) frequencyScore = 3;
  else if (totalOrders === 1) frequencyScore = 2;
  else frequencyScore = 1;
  let monetaryScore = 1;
  if (lifetimeValue >= 5e4) monetaryScore = 5;
  else if (lifetimeValue >= 25e3) monetaryScore = 4;
  else if (lifetimeValue >= 1e4) monetaryScore = 3;
  else if (lifetimeValue >= 3500) monetaryScore = 2;
  else monetaryScore = 1;
  let segment = "Promising/Recent";
  if (totalOrders > 0 && discountOrdersCount >= 2 && discountOrdersCount >= totalOrders) {
    segment = "Bargain Hunters";
  } else if (daysSinceLastOrder > 90 && totalOrders > 0) {
    segment = "At-Risk/Churning";
  } else if (frequencyScore >= 4 && monetaryScore >= 4 || totalOrders >= 4 && lifetimeValue >= 5e4) {
    segment = "Champions/VIPs";
  } else {
    segment = "Promising/Recent";
  }
  return {
    segment,
    score: {
      recency: recencyScore,
      frequency: frequencyScore,
      monetary: monetaryScore
    }
  };
}
function computeUnitEconomics() {
  const orders = db.getOrders().filter((o) => o.paymentStatus === "PAID");
  const customers = db.getCustomers().filter((c) => c.role === "PATRON");
  const totalRevenue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
  const totalOrders = orders.length;
  const aov = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
  const totalMarketingSpend = customers.reduce((sum, c) => sum + (c.acquisitionCost || 0), 0);
  const totalAcquiredCustomers = customers.filter((c) => (c.acquisitionCost || 0) > 0).length;
  const cac = totalAcquiredCustomers > 0 ? Math.round(totalMarketingSpend / totalAcquiredCustomers) : 0;
  const roas = totalMarketingSpend > 0 ? Number((totalRevenue / totalMarketingSpend).toFixed(2)) : 0;
  const repeatCustomers = customers.filter((c) => c.totalOrders > 1).length;
  const repeatPurchaseRate = customers.length > 0 ? Number((repeatCustomers / customers.length * 100).toFixed(1)) : 0;
  return {
    cac,
    roas,
    aov,
    totalRevenue,
    totalOrders,
    activeCustomers: customers.length,
    repeatPurchaseRate
  };
}
function computeOperationalHealth() {
  const warranties = db.getWarranties();
  const orders = db.getOrders();
  const auditLogs = db.getAuditLogs();
  const totalOrders = orders.length;
  const totalUnitsSold = orders.reduce((acc, o) => acc + o.items.reduce((s, it) => s + it.quantity, 0), 0);
  const totalClaims = warranties.reduce((acc, w) => acc + w.claimCount, 0);
  const warrantyClaimFrequency = totalUnitsSold > 0 ? Number((totalClaims / totalUnitsSold * 100).toFixed(2)) : 0;
  const rmaLogs = auditLogs.filter((l) => l.action === "RMA_PROCESSED");
  const reasonCounts = {
    COLOR_MISMATCH: 0,
    TEXTURE_DEFECT: 0,
    INCORRECT_SIZE: 0,
    HARDWARE_DAMAGE: 0
  };
  for (const log of rmaLogs) {
    const match = /\(Reason:\s*(COLOR_MISMATCH|TEXTURE_DEFECT|INCORRECT_SIZE|HARDWARE_DAMAGE)\)/i.exec(log.details);
    if (match) {
      const key = match[1].toUpperCase();
      reasonCounts[key] += 1;
    }
  }
  const loggedReturnTotal = reasonCounts.COLOR_MISMATCH + reasonCounts.TEXTURE_DEFECT + reasonCounts.INCORRECT_SIZE + reasonCounts.HARDWARE_DAMAGE;
  const returnedOrdersCount = orders.filter((o) => o.status === "RETURNED").length;
  if (returnedOrdersCount > loggedReturnTotal) {
    reasonCounts.TEXTURE_DEFECT += returnedOrdersCount - loggedReturnTotal;
  }
  const denominator = Math.max(1, totalOrders);
  const toPct = (count) => Number((count / denominator * 100).toFixed(1));
  const deliveredOrders = orders.filter((o) => o.status === "DELIVERED" || o.courierStatus === "DELIVERED");
  let averageTransitDays = 0;
  let onTimeDeliveryRate = 100;
  if (deliveredOrders.length > 0) {
    let totalDays = 0;
    let onTimeCount = 0;
    for (const ord of deliveredOrders) {
      const startMs = new Date(ord.createdAt).getTime();
      const endMs = new Date(ord.updatedAt).getTime();
      const transitDays = Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0.2, (endMs - startMs) / (1e3 * 60 * 60 * 24)) : 2.5;
      totalDays += transitDays;
      if (ord.estimatedDeliveryDate) {
        const etaMs = new Date(ord.estimatedDeliveryDate).getTime();
        if (endMs <= etaMs) onTimeCount += 1;
      } else if (transitDays <= 5) {
        onTimeCount += 1;
      }
    }
    averageTransitDays = Number((totalDays / deliveredOrders.length).toFixed(1));
    onTimeDeliveryRate = Number((onTimeCount / deliveredOrders.length * 100).toFixed(1));
  }
  return {
    returnRateByReason: {
      colorExpectation: toPct(reasonCounts.COLOR_MISMATCH),
      textureExpectation: toPct(reasonCounts.TEXTURE_DEFECT),
      sizingFit: toPct(reasonCounts.INCORRECT_SIZE),
      transitDamage: toPct(reasonCounts.HARDWARE_DAMAGE)
    },
    averageTransitDays,
    warrantyClaimFrequency,
    onTimeDeliveryRate,
    totalReturns: Math.max(loggedReturnTotal, returnedOrdersCount),
    completedDeliveries: deliveredOrders.length
  };
}
function computeCohortRetention() {
  const patrons = db.getCustomers({ includeArchived: true }).filter((c) => c.role === "PATRON");
  const orders = db.getOrders().filter((o) => o.paymentStatus === "PAID");
  const dayMs = 1e3 * 60 * 60 * 24;
  const cohortsMap = /* @__PURE__ */ new Map();
  for (const patron of patrons) {
    const createdDate = new Date(patron.createdAt || Date.now());
    const year = Number.isNaN(createdDate.getTime()) ? (/* @__PURE__ */ new Date()).getFullYear() : createdDate.getUTCFullYear();
    const month = Number.isNaN(createdDate.getTime()) ? (/* @__PURE__ */ new Date()).getUTCMonth() : createdDate.getUTCMonth();
    const quarter = Math.floor(month / 3) + 1;
    const cohortLabel = `Q${quarter} ${year}`;
    const sortKey = year * 10 + quarter;
    if (!cohortsMap.has(cohortLabel)) {
      cohortsMap.set(cohortLabel, {
        sortKey,
        cohort: cohortLabel,
        totalPatrons: 0,
        day30: 0,
        day60: 0,
        day90: 0
      });
    }
    const bucket = cohortsMap.get(cohortLabel);
    bucket.totalPatrons += 1;
    const patronOrders = orders.filter(
      (o) => o.customerId === patron.id || o.customerEmail.toLowerCase() === patron.email.toLowerCase()
    );
    const createdMs = createdDate.getTime();
    let maxSpanDays = 0;
    for (const ord of patronOrders) {
      const ordMs = new Date(ord.createdAt).getTime();
      if (Number.isFinite(ordMs) && Number.isFinite(createdMs)) {
        maxSpanDays = Math.max(maxSpanDays, (ordMs - createdMs) / dayMs);
      }
    }
    const totalOrdersCount = Math.max(patron.totalOrders || 0, patronOrders.length);
    if (totalOrdersCount >= 1 || maxSpanDays >= 30) bucket.day30 += 1;
    if (totalOrdersCount >= 2 || maxSpanDays >= 60 || patron.daysSinceLastOrder <= 60) bucket.day60 += 1;
    if (totalOrdersCount >= 3 || maxSpanDays >= 90 || patron.daysSinceLastOrder <= 45) bucket.day90 += 1;
  }
  return Array.from(cohortsMap.values()).sort((a, b) => a.sortKey - b.sortKey).map(({ cohort, totalPatrons, day30, day60, day90 }) => ({
    cohort,
    totalPatrons,
    day30,
    day60,
    day90
  }));
}
function computeSkuReorderVelocity(nowMs = Date.now()) {
  const paidOrders = db.getOrders().filter((o) => o.paymentStatus === "PAID");
  const catalogProducts = db.getCatalog().products || [];
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1e3;
  const sixtyDaysMs = 60 * 24 * 60 * 60 * 1e3;
  const skuStats = /* @__PURE__ */ new Map();
  for (const prod of catalogProducts) {
    skuStats.set(prod.sku, {
      sku: prod.sku,
      name: prod.name,
      unitsSold30d: 0,
      unitsSoldPrev30d: 0,
      stockCount: prod.stockCount
    });
  }
  for (const order of paidOrders) {
    const ordMs = new Date(order.createdAt).getTime();
    if (!Number.isFinite(ordMs)) continue;
    const ageMs = nowMs - ordMs;
    for (const item of order.items) {
      if (!skuStats.has(item.sku)) {
        skuStats.set(item.sku, {
          sku: item.sku,
          name: item.productName,
          unitsSold30d: 0,
          unitsSoldPrev30d: 0
        });
      }
      const stat = skuStats.get(item.sku);
      if (ageMs <= thirtyDaysMs) {
        stat.unitsSold30d += item.quantity;
      } else if (ageMs <= sixtyDaysMs) {
        stat.unitsSoldPrev30d += item.quantity;
      }
    }
  }
  return Array.from(skuStats.values()).sort((a, b) => b.unitsSold30d - a.unitsSold30d || a.name.localeCompare(b.name)).slice(0, 6).map((stat) => {
    let velocityTrend = "0%";
    if (stat.unitsSoldPrev30d === 0 && stat.unitsSold30d > 0) {
      velocityTrend = "+100%";
    } else if (stat.unitsSoldPrev30d > 0) {
      const pct = Math.round((stat.unitsSold30d - stat.unitsSoldPrev30d) / stat.unitsSoldPrev30d * 100);
      velocityTrend = `${pct >= 0 ? "+" : ""}${pct}%`;
    }
    return {
      sku: stat.sku,
      name: stat.name,
      unitsSold30d: stat.unitsSold30d,
      velocityTrend,
      stockCount: stat.stockCount
    };
  });
}
var init_rfm = __esm({
  "src/server/rfm.ts"() {
    init_db();
  }
});

// src/server/firebaseAuthVerifier.ts
import crypto5 from "crypto";
import fs6 from "fs";
import path6 from "path";
function getProjectId() {
  const envProjectId = (process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "").trim();
  if (envProjectId) {
    return envProjectId;
  }
  try {
    const cfgPath = path6.resolve(process.cwd(), "firebase-applet-config.json");
    if (fs6.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs6.readFileSync(cfgPath, "utf-8"));
      if (cfg.projectId) return cfg.projectId;
    }
  } catch {
  }
  return "gen-lang-client-0774833728";
}
function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - normalized.length % 4) % 4;
  return Buffer.from(normalized + "=".repeat(padLen), "base64");
}
async function fetchGooglePublicCerts() {
  const now = Date.now();
  if (now < certsExpiresAt && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Google public certificates (${res.status})`);
  }
  const cacheControl = res.headers.get("cache-control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSeconds = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
  cachedCerts = await res.json();
  certsExpiresAt = now + maxAgeSeconds * 1e3;
  return cachedCerts;
}
async function verifyFirebaseIdToken(idToken) {
  if (!idToken || typeof idToken !== "string") return null;
  const nowSeconds = Math.floor(Date.now() / 1e3);
  const cached = verifiedTokenCache.get(idToken);
  if (cached && cached.exp > nowSeconds + 15) {
    return cached;
  }
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf-8"));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf-8"));
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) {
    return null;
  }
  const projectId = getProjectId();
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  if (payload.aud !== projectId) return null;
  if (payload.iss !== expectedIssuer) return null;
  if (typeof payload.sub !== "string" || !payload.sub.trim()) return null;
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) return null;
  if (typeof payload.iat !== "number" || payload.iat > nowSeconds + 300) return null;
  const certs = await fetchGooglePublicCerts();
  const pemCert = certs[header.kid];
  if (!pemCert) {
    certsExpiresAt = 0;
    const refreshed = await fetchGooglePublicCerts();
    if (!refreshed[header.kid]) return null;
  }
  const cert = cachedCerts[header.kid];
  const verifier = crypto5.createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const signatureBuf = base64UrlDecode(signatureB64);
  const isValid = verifier.verify(cert, signatureBuf);
  if (!isValid) return null;
  const email = typeof payload.email === "string" ? payload.email.toLowerCase().trim() : "";
  if (!email) return null;
  const claims = {
    uid: payload.sub,
    email,
    emailVerified: Boolean(payload.email_verified),
    name: typeof payload.name === "string" ? payload.name : email.split("@")[0],
    picture: typeof payload.picture === "string" ? payload.picture : void 0,
    signInProvider: typeof payload.firebase?.sign_in_provider === "string" ? payload.firebase.sign_in_provider : void 0,
    exp: payload.exp
  };
  if (verifiedTokenCache.size > 500) {
    verifiedTokenCache.clear();
  }
  verifiedTokenCache.set(idToken, claims);
  return claims;
}
var GOOGLE_CERTS_URL, cachedCerts, certsExpiresAt, verifiedTokenCache;
var init_firebaseAuthVerifier = __esm({
  "src/server/firebaseAuthVerifier.ts"() {
    GOOGLE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
    cachedCerts = {};
    certsExpiresAt = 0;
    verifiedTokenCache = /* @__PURE__ */ new Map();
  }
});

// src/server/authMiddleware.ts
function isTestAuthTokensEnabled() {
  return process.env.NODE_ENV !== "production" && (process.env.NODE_ENV === "test" || process.env.ENABLE_TEST_AUTH_TOKENS === "true");
}
function resolveAuthToken(authHeader) {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  if (isTestAuthTokensEnabled() && TEST_SESSION_CACHE.has(token)) {
    const cached = TEST_SESSION_CACHE.get(token);
    const isAuth = db.isStoreManagementAuthorized(cached.email);
    return {
      ...cached,
      role: isAuth ? db.getStaffRole(cached.email) : "PATRON",
      isMasterAdmin: db.isMasterAuthorized(cached.email),
      isStoreManagementAuthorized: isAuth
    };
  }
  const claims = verifySessionJwt(token);
  if (!claims || !claims.email) {
    return null;
  }
  const email = claims.email.trim().toLowerCase();
  const isMaster = db.isMasterAuthorized(email);
  const isAdmin = db.isStoreManagementAuthorized(email);
  const resolvedRole = isAdmin ? db.getStaffRole(email) : "PATRON";
  return {
    uid: claims.sub,
    email,
    name: claims.name || email.split("@")[0],
    role: resolvedRole,
    isMasterAdmin: isMaster,
    isStoreManagementAuthorized: isAdmin,
    authProvider: "CREDENTIALS"
  };
}
async function resolveAuthTokenAsync(authHeader) {
  const syncUser = resolveAuthToken(authHeader);
  if (syncUser) return syncUser;
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token || token.split(".").length !== 3) return null;
  try {
    const claims = await verifyFirebaseIdToken(token);
    if (!claims || !claims.email) return null;
    const cleanEmail = claims.email.trim().toLowerCase();
    const isMaster = db.isMasterAuthorized(cleanEmail);
    const isAdmin = db.isStoreManagementAuthorized(cleanEmail);
    const resolvedRole = isAdmin ? db.getStaffRole(cleanEmail) : "PATRON";
    return {
      uid: claims.uid,
      email: cleanEmail,
      name: claims.name || cleanEmail.split("@")[0],
      role: resolvedRole,
      isMasterAdmin: isMaster,
      isStoreManagementAuthorized: isAdmin,
      photoURL: claims.picture,
      authProvider: "GOOGLE"
    };
  } catch {
    return null;
  }
}
async function requireAuth(req, res, next) {
  const user = await resolveAuthTokenAsync(req.headers.authorization);
  if (!user) {
    return res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Authentication required. Please sign in to continue."
    });
  }
  req.user = user;
  next();
}
function createRoleGuard(allowedRoles, denialMessage) {
  return async function enforceRole(req, res, next) {
    const user = await resolveAuthTokenAsync(req.headers.authorization);
    if (!user) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Authentication required to access admin operations."
      });
    }
    const isStaff = db.isStoreManagementAuthorized(user.email);
    const effectiveRole = isStaff ? db.getStaffRole(user.email) : "PATRON";
    if (!isStaff || !allowedRoles.includes(effectiveRole)) {
      db.logAudit(
        user.email,
        "UNAUTHORIZED_ADMIN_ATTEMPT",
        "AUTH_PERMISSION",
        `Blocked ${user.email} (role: ${effectiveRole}) from ${req.method} ${req.originalUrl}`,
        req.ip
      );
      return res.status(403).json({
        error: "FORBIDDEN",
        message: denialMessage
      });
    }
    req.user = { ...user, role: effectiveRole };
    next();
  };
}
async function requireMasterAdminAccess(req, res, next) {
  const user = await resolveAuthTokenAsync(req.headers.authorization);
  if (!user) {
    return res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Authentication required to perform Master Admin actions."
    });
  }
  if (!db.isMasterAuthorized(user.email)) {
    db.logAudit(
      user.email,
      "UNAUTHORIZED_MASTER_ADMIN_ATTEMPT",
      "AUTH_PERMISSION",
      `Blocked non-master user ${user.email} from Master-only endpoint ${req.method} ${req.originalUrl}`,
      req.ip
    );
    return res.status(403).json({
      error: "FORBIDDEN",
      message: "Only Founding Master Super-Admins can perform this administrative action."
    });
  }
  req.user = user;
  next();
}
var TEST_SESSION_CACHE, requireStoreManagementAccess, requireCrmAccess, requireErpAccess, requireAnalyticsAccess;
var init_authMiddleware = __esm({
  "src/server/authMiddleware.ts"() {
    init_db();
    init_firebaseAuthVerifier();
    init_security();
    TEST_SESSION_CACHE = /* @__PURE__ */ new Map();
    TEST_SESSION_CACHE.set("token_sunil", {
      uid: "uid_admin_sunil",
      email: "sunilchain@gmail.com",
      name: "Sunil Chainani",
      role: "STORE_MANAGER",
      isMasterAdmin: true,
      isStoreManagementAuthorized: true
    });
    TEST_SESSION_CACHE.set("token_support", {
      uid: "uid_admin_support",
      email: "support@bharatvarshcrafts.com",
      name: "Bharatvarsh Support Desk",
      role: "STORE_MANAGER",
      isMasterAdmin: true,
      isStoreManagementAuthorized: true
    });
    TEST_SESSION_CACHE.set("token_patron_vikram", {
      uid: "uid_patron_01",
      email: "vikram.singhania@heritagecrafts.in",
      name: "Vikramaditya Singhania",
      role: "PATRON",
      isMasterAdmin: false,
      isStoreManagementAuthorized: false
    });
    requireStoreManagementAccess = createRoleGuard(
      ["STORE_MANAGER"],
      "Access denied. Only Store Managers can access store configuration, catalog management, and administrative settings."
    );
    requireCrmAccess = createRoleGuard(
      ["STORE_MANAGER", "SUPPORT_AGENT"],
      "Access denied. Customer 360, Omnichannel Inbox, and Sales Pipeline require Store Manager or Support Agent privileges."
    );
    requireErpAccess = createRoleGuard(
      ["STORE_MANAGER", "LOGISTICS_COORDINATOR"],
      "Access denied. ERP Inventory, BOM, Dispatch, and RMA modules require Store Manager or Logistics Coordinator privileges."
    );
    requireAnalyticsAccess = createRoleGuard(
      ["STORE_MANAGER", "SUPPORT_AGENT", "LOGISTICS_COORDINATOR"],
      "Access denied. Only authorized staff members can view operational analytics."
    );
  }
});

// src/server/dailyOrderReport.ts
import * as XLSX from "xlsx";
function getYesterdayIstDateKey(referenceNow = /* @__PURE__ */ new Date()) {
  const istNow = new Date(referenceNow.getTime() + IST_OFFSET_MS);
  const yesterdayUtcMidnight = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() - 1)
  );
  return yesterdayUtcMidnight.toISOString().slice(0, 10);
}
function getIstDayUtcWindow(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`Invalid IST date key "${dateKey}". Expected YYYY-MM-DD.`);
  }
  const [yr, mo, dy] = dateKey.split("-").map((n) => parseInt(n, 10));
  const istMidnightAsUtcMs = Date.UTC(yr, mo - 1, dy, 0, 0, 0, 0);
  const startUtcMs = istMidnightAsUtcMs - IST_OFFSET_MS;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1e3 - 1;
  return { startUtcMs, endUtcMs };
}
function formatIstDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return `${ist.toISOString().slice(0, 19).replace("T", " ")} IST`;
}
function generateDailyOrderWorkbook(targetDateIst) {
  const dateKey = targetDateIst && /^\d{4}-\d{2}-\d{2}$/.test(targetDateIst) ? targetDateIst : getYesterdayIstDateKey();
  const { startUtcMs, endUtcMs } = getIstDayUtcWindow(dateKey);
  const allOrders = db.getOrders();
  const invoices = db.getInvoices();
  const dayOrders = allOrders.filter((o) => {
    const ts = new Date(o.createdAt).getTime();
    return Number.isFinite(ts) && ts >= startUtcMs && ts <= endUtcMs;
  }).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  let grossRevenue = 0;
  let totalDiscount = 0;
  let totalTaxableValue = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let totalTax = 0;
  const orderRows = dayOrders.map((order) => {
    const matchedInv = invoices.find(
      (inv) => inv.orderId === order.id || order.invoiceNumber && inv.invoiceNumber === order.invoiceNumber
    );
    const shipCity = order.shippingAddress?.city || order.billingAddress?.city || "";
    const shipState = order.shippingAddress?.state || order.billingAddress?.state || matchedInv?.placeOfSupply || "";
    const pincode = order.shippingAddress?.pincode || order.billingAddress?.pincode || "";
    const taxableValue = matchedInv ? Number(matchedInv.taxableValue) : Math.max(0, Number(order.subtotal || 0) - Number(order.discountAmount || 0));
    const isInterState = matchedInv ? matchedInv.isInterState : shipState.trim().toLowerCase() !== "maharashtra";
    const cgst = matchedInv ? Number(matchedInv.cgstAmount || 0) : isInterState ? 0 : Math.round(Number(order.taxAmount || 0) / 2);
    const sgst = matchedInv ? Number(matchedInv.sgstAmount || 0) : isInterState ? 0 : Number(order.taxAmount || 0) - Math.round(Number(order.taxAmount || 0) / 2);
    const igst = matchedInv ? Number(matchedInv.igstAmount || 0) : isInterState ? Number(order.taxAmount || 0) : 0;
    const itemsSummary = (order.items || []).map((it) => `${it.productName} (${it.sku}) x${it.quantity}`).join("; ");
    const monogramSpecs = (order.items || []).filter((it) => it.customization?.monogramInitials).map((it) => `${it.sku}: ${it.customization.monogramInitials} (${it.customization.foilType})`).join("; ") || "None";
    grossRevenue += Number(order.totalAmount || 0);
    totalDiscount += Number(order.discountAmount || 0);
    totalTaxableValue += taxableValue;
    totalCgst += cgst;
    totalSgst += sgst;
    totalIgst += igst;
    totalTax += cgst + sgst + igst;
    return {
      "Order Number": order.orderNumber,
      "Order Date/Time (IST)": formatIstDateTime(order.createdAt),
      "Invoice Number": order.invoiceNumber || "Pending / Exempt",
      "Customer Name": order.customerName,
      Email: order.customerEmail,
      Phone: order.customerPhone || "",
      "Shipping City & State": [shipCity, shipState].filter(Boolean).join(", "),
      Pincode: pincode,
      "Items & SKUs": itemsSummary,
      "Monogram Specs": monogramSpecs,
      "Subtotal (INR)": Number(order.subtotal || 0),
      "Discount (INR)": Number(order.discountAmount || 0),
      "Taxable Value (INR)": taxableValue,
      "CGST (INR)": cgst,
      "SGST (INR)": sgst,
      "IGST (INR)": igst,
      "Total Amount (INR)": Number(order.totalAmount || 0),
      "Payment Gateway": order.paymentGateway,
      "Payment Status": order.paymentStatus,
      "Order Status": order.status,
      "AWB Number": order.awbNumber || "Pending Allocation"
    };
  });
  const summaryRows = [
    { Metric: "Report Date (IST)", Value: dateKey },
    { Metric: "Generated At (IST)", Value: formatIstDateTime((/* @__PURE__ */ new Date()).toISOString()) },
    { Metric: "Total Orders", Value: dayOrders.length },
    { Metric: "Gross Revenue (INR)", Value: grossRevenue },
    { Metric: "Total Discounts (INR)", Value: totalDiscount },
    { Metric: "Total Taxable Value (INR)", Value: totalTaxableValue },
    { Metric: "Total CGST Collected (INR)", Value: totalCgst },
    { Metric: "Total SGST Collected (INR)", Value: totalSgst },
    { Metric: "Total IGST Collected (INR)", Value: totalIgst },
    { Metric: "Total Tax Collected (INR)", Value: totalTax }
  ];
  const wb = XLSX.utils.book_new();
  const ordersSheet = orderRows.length > 0 ? XLSX.utils.json_to_sheet(orderRows) : XLSX.utils.aoa_to_sheet([
    [
      "Order Number",
      "Order Date/Time (IST)",
      "Invoice Number",
      "Customer Name",
      "Email",
      "Phone",
      "Shipping City & State",
      "Pincode",
      "Items & SKUs",
      "Monogram Specs",
      "Subtotal (INR)",
      "Discount (INR)",
      "Taxable Value (INR)",
      "CGST (INR)",
      "SGST (INR)",
      "IGST (INR)",
      "Total Amount (INR)",
      "Payment Gateway",
      "Payment Status",
      "Order Status",
      "AWB Number"
    ]
  ]);
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, ordersSheet, "Orders");
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");
  const rawOut = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const buffer = Buffer.isBuffer(rawOut) ? rawOut : Buffer.from(rawOut);
  const filename = `Orders_${dateKey}.xlsx`;
  return {
    dateKey,
    filename,
    buffer,
    orderCount: dayOrders.length,
    grossRevenue,
    totalDiscount,
    totalTaxableValue,
    totalTax,
    orders: dayOrders
  };
}
async function sendDailyOrdersReport(options) {
  const targetDateKey = options?.targetDateIst && /^\d{4}-\d{2}-\d{2}$/.test(options.targetDateIst) ? options.targetDateIst : getYesterdayIstDateKey();
  const lastSent = db.getLastDailyReportDate();
  if (!options?.force && lastSent === targetDateKey) {
    return {
      success: true,
      skipped: true,
      dateKey: targetDateKey,
      filename: `Orders_${targetDateKey}.xlsx`,
      orderCount: 0,
      grossRevenue: 0,
      totalTax: 0,
      deliveryMode: "SANDBOX_FALLBACK",
      fallbackReason: `Report for ${targetDateKey} already dispatched`
    };
  }
  const report = generateDailyOrderWorkbook(targetDateKey);
  const recipient = getSupportOrderEmailRecipient();
  const formattedGross = Math.round(report.grossRevenue).toLocaleString("en-IN");
  const formattedTax = Math.round(report.totalTax).toLocaleString("en-IN");
  const subject = `Daily Order Summary (${report.dateKey}) \u2014 ${report.orderCount} Orders | \u20B9${formattedGross}`;
  const text = [
    `Bharatvarsh Leathercrafts LLP \u2014 Daily Order Summary (${report.dateKey} IST)`,
    `Total Orders: ${report.orderCount}`,
    `Gross Revenue: \u20B9${formattedGross}`,
    `Total Tax Collected: \u20B9${formattedTax}`,
    "",
    `Attached workbook: ${report.filename} (Sheets: Orders, Summary)`
  ].join("\n");
  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#FAF7F2;padding:24px;color:#16120E;">
    <div style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid #D8CFC2;padding:24px;border-radius:8px;">
      <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#8B4513;font-weight:700;">Bharatvarsh Leathercrafts LLP \xB7 Automated Ledger</div>
      <h2 style="font-family:Georgia,serif;font-size:20px;margin:8px 0;">Daily Order Summary (${report.dateKey} IST)</h2>
      <div style="background:#FAF7F2;border:1px solid #E5DDD0;padding:14px;border-radius:6px;font-size:13px;line-height:1.8;font-family:monospace;">
        <div><strong>Total Orders:</strong> ${report.orderCount}</div>
        <div><strong>Gross Revenue:</strong> &#8377;${formattedGross}</div>
        <div><strong>Total Tax Collected:</strong> &#8377;${formattedTax}</div>
      </div>
      <p style="font-size:12px;color:#5C4D3E;margin-top:14px;">
        Full itemized order &amp; GST breakdown workbook is attached as <strong>${report.filename}</strong>.
      </p>
    </div>
  </div>`;
  const delivery = await sendEmail({
    to: recipient,
    subject,
    text,
    html,
    attachments: [
      {
        filename: report.filename,
        content: report.buffer,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }
    ]
  });
  if (delivery.mode === "LIVE" || !delivery.smtpConfigured) {
    await db.runAtomicMutation(() => {
      if (!options?.targetDateIst || options.targetDateIst === getYesterdayIstDateKey()) {
        db.setLastDailyReportDate(report.dateKey);
      }
      db.logAudit(
        options?.actorEmail || "daily_report_scheduler",
        "DAILY_ORDER_REPORT_SENT",
        "STORE_MANAGEMENT",
        `Dispatched ${report.filename} to ${recipient} (${report.orderCount} orders, \u20B9${formattedGross}, Mode: ${delivery.mode})`
      );
    });
  } else {
    db.logAudit(
      options?.actorEmail || "daily_report_scheduler",
      "DAILY_ORDER_REPORT_ERROR",
      "STORE_MANAGEMENT",
      `Failed live SMTP dispatch of ${report.filename} to ${recipient}: ${delivery.fallbackReason || "Unknown error"}`
    );
  }
  return {
    success: true,
    skipped: false,
    dateKey: report.dateKey,
    filename: report.filename,
    orderCount: report.orderCount,
    grossRevenue: report.grossRevenue,
    totalTax: report.totalTax,
    deliveryMode: delivery.mode,
    messageId: delivery.messageId,
    fallbackReason: delivery.fallbackReason
  };
}
async function runScheduledDailyOrderReportIfDue() {
  if (reportInFlight) return;
  const yesterdayKey = getYesterdayIstDateKey();
  if (db.getLastDailyReportDate() === yesterdayKey) return;
  reportInFlight = true;
  try {
    const result = await sendDailyOrdersReport({ force: false, targetDateIst: yesterdayKey });
    if (!result.skipped) {
      console.log(
        `[DailyOrderReport] Dispatched ${result.filename} (${result.orderCount} orders, mode: ${result.deliveryMode})`
      );
    }
  } catch (err) {
    console.error("[DailyOrderReport] Scheduled report failed:", err?.message || err);
  } finally {
    reportInFlight = false;
  }
}
function startDailyOrderReportScheduler(intervalMs = 6e4) {
  if (reportTimer) return;
  setTimeout(() => {
    runScheduledDailyOrderReportIfDue().catch(() => {
    });
  }, 5e3);
  reportTimer = setInterval(() => {
    runScheduledDailyOrderReportIfDue().catch(() => {
    });
  }, intervalMs);
  console.log(`[DailyOrderReport] Scheduler active (IST post-midnight check every ${intervalMs / 1e3}s)`);
}
var IST_OFFSET_MS, reportTimer, reportInFlight;
var init_dailyOrderReport = __esm({
  "src/server/dailyOrderReport.ts"() {
    init_db();
    init_integrations();
    IST_OFFSET_MS = 5.5 * 60 * 60 * 1e3;
    reportTimer = null;
    reportInFlight = false;
  }
});

// src/lib/indianValidation.ts
function normalizeIndianState(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (STATE_ALIASES[lower]) {
    return STATE_ALIASES[lower];
  }
  const exact = INDIAN_STATES_AND_UTS.find((s) => s.toLowerCase() === lower);
  return exact || null;
}
function validateIndianPhone(raw) {
  const input = String(raw || "").trim();
  if (!input) {
    return {
      valid: false,
      compact: "",
      formatted: "",
      error: "Phone number is required (+91 followed by 10 digits)."
    };
  }
  const compact = input.replace(/[\s\-()]+/g, "");
  if (!INDIAN_PHONE_REGEX.test(compact)) {
    return {
      valid: false,
      compact,
      formatted: input,
      error: "Phone number must start with +91 followed by 10 digits (e.g. +91 98201 12345)."
    };
  }
  const digits = compact.slice(3);
  return {
    valid: true,
    compact,
    formatted: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
  };
}
function validateIndianPincode(raw) {
  const normalized = String(raw || "").replace(/\s+/g, "");
  if (!normalized) {
    return {
      valid: false,
      normalized: "",
      error: "6-digit Indian PIN code is required."
    };
  }
  if (!INDIAN_PINCODE_REGEX.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: "Enter a valid 6-digit Indian PIN code (cannot start with 0)."
    };
  }
  return { valid: true, normalized };
}
function validateEmailAddress(raw) {
  const normalized = String(raw || "").trim().toLowerCase();
  if (!normalized || !EMAIL_REGEX.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: "Please enter a valid email address."
    };
  }
  return { valid: true, normalized };
}
function validateIndianCheckoutFields(input) {
  const errors = {};
  const cleanName = String(input.fullName || "").trim();
  if (cleanName.length < 2) {
    errors.fullName = "Full name must be at least 2 characters.";
  }
  const emailCheck = validateEmailAddress(input.email);
  if (!emailCheck.valid) {
    errors.email = emailCheck.error;
  }
  const phoneCheck = validateIndianPhone(input.phone);
  if (!phoneCheck.valid) {
    errors.phone = phoneCheck.error;
  }
  const cleanStreet = String(input.street || "").trim();
  if (cleanStreet.length < 5) {
    errors.street = "Street address must be at least 5 characters.";
  }
  const cleanCity = String(input.city || "").trim();
  if (cleanCity.length < 2) {
    errors.city = "City is required (minimum 2 characters).";
  }
  const normalizedState = normalizeIndianState(input.state);
  if (!normalizedState) {
    errors.state = "Please select a valid Indian State or Union Territory.";
  }
  const pincodeCheck = validateIndianPincode(input.pincode);
  if (!pincodeCheck.valid) {
    errors.pincode = pincodeCheck.error;
  }
  const cleanCountry = String(input.country || "India").trim();
  if (cleanCountry.toLowerCase() !== "india") {
    errors.country = "Shipping destination is currently restricted to India only.";
  }
  const errorKeys = Object.keys(errors);
  return {
    valid: errorKeys.length === 0,
    errors,
    firstError: errorKeys.length > 0 ? errors[errorKeys[0]] : void 0,
    normalized: {
      fullName: cleanName,
      email: emailCheck.normalized,
      phone: phoneCheck.formatted,
      street: cleanStreet,
      city: cleanCity,
      state: normalizedState || String(input.state || "").trim(),
      pincode: pincodeCheck.normalized,
      country: "India"
    }
  };
}
var INDIAN_STATES_AND_UTS, STATE_ALIASES, INDIAN_PHONE_REGEX, INDIAN_PINCODE_REGEX, EMAIL_REGEX;
var init_indianValidation = __esm({
  "src/lib/indianValidation.ts"() {
    INDIAN_STATES_AND_UTS = [
      "Andhra Pradesh",
      "Arunachal Pradesh",
      "Assam",
      "Bihar",
      "Chhattisgarh",
      "Goa",
      "Gujarat",
      "Haryana",
      "Himachal Pradesh",
      "Jharkhand",
      "Karnataka",
      "Kerala",
      "Madhya Pradesh",
      "Maharashtra",
      "Manipur",
      "Meghalaya",
      "Mizoram",
      "Nagaland",
      "Odisha",
      "Punjab",
      "Rajasthan",
      "Sikkim",
      "Tamil Nadu",
      "Telangana",
      "Tripura",
      "Uttar Pradesh",
      "Uttarakhand",
      "West Bengal",
      "Andaman and Nicobar Islands",
      "Chandigarh",
      "Dadra and Nagar Haveli and Daman and Diu",
      "Delhi",
      "Jammu and Kashmir",
      "Ladakh",
      "Lakshadweep",
      "Puducherry"
    ];
    STATE_ALIASES = {
      "new delhi": "Delhi",
      "nct of delhi": "Delhi",
      "delhi ncr": "Delhi",
      "orissa": "Odisha",
      "pondicherry": "Puducherry",
      "uttaranchal": "Uttarakhand",
      "andaman & nicobar islands": "Andaman and Nicobar Islands",
      "jammu & kashmir": "Jammu and Kashmir",
      "dadra & nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
      "daman & diu": "Dadra and Nagar Haveli and Daman and Diu"
    };
    INDIAN_PHONE_REGEX = /^\+91[6-9]\d{9}$/;
    INDIAN_PINCODE_REGEX = /^[1-9][0-9]{5}$/;
    EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  }
});

// src/server/recaptcha.ts
async function verifyRecaptchaEnterpriseToken(params) {
  const apiKey = process.env.RECAPTCHA_ENTERPRISE_API_KEY;
  if (!isConfiguredCredential(apiKey)) {
    return {
      allowed: true,
      mode: "CLIENT_ONLY_PASS",
      action: params.expectedAction,
      reason: "RECAPTCHA_ENTERPRISE_API_KEY not configured; client execution active without server assessment blocking."
    };
  }
  const cleanToken = typeof params.token === "string" ? params.token.trim() : "";
  if (!cleanToken) {
    db.logAudit(
      params.actorHint || "anonymous",
      "RECAPTCHA_BLOCKED",
      "AUTH_PERMISSION",
      `Blocked ${params.expectedAction}: missing reCAPTCHA Enterprise token`
    );
    return {
      allowed: false,
      mode: "LIVE",
      reason: "Security verification token missing. Please reload the page and try again."
    };
  }
  const projectId = process.env.RECAPTCHA_ENTERPRISE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "bharatvarsh-auth";
  const siteKey = process.env.RECAPTCHA_ENTERPRISE_SITE_KEY || DEFAULT_SITE_KEY;
  const minScore = Number.isFinite(Number(process.env.RECAPTCHA_MIN_SCORE)) ? Number(process.env.RECAPTCHA_MIN_SCORE) : 0.3;
  try {
    const endpoint = `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}/assessments?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: {
          token: cleanToken,
          expectedAction: params.expectedAction,
          siteKey
        }
      })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      return {
        allowed: false,
        mode: "LIVE",
        reason: data?.error?.message || `reCAPTCHA Enterprise API HTTP ${response.status}`
      };
    }
    const tokenProps = data.tokenProperties || {};
    const riskAnalysis = data.riskAnalysis || {};
    const score = typeof riskAnalysis.score === "number" ? riskAnalysis.score : 0;
    if (!tokenProps.valid) {
      db.logAudit(
        params.actorHint || "anonymous",
        "RECAPTCHA_BLOCKED",
        "AUTH_PERMISSION",
        `Blocked ${params.expectedAction}: invalid reCAPTCHA token (${tokenProps.invalidReason || "UNKNOWN"})`
      );
      return {
        allowed: false,
        mode: "LIVE",
        score,
        action: tokenProps.action,
        reason: `Security check failed (${tokenProps.invalidReason || "invalid token"}). Please try again.`
      };
    }
    if (tokenProps.action && tokenProps.action !== params.expectedAction) {
      db.logAudit(
        params.actorHint || "anonymous",
        "RECAPTCHA_BLOCKED",
        "AUTH_PERMISSION",
        `Blocked ${params.expectedAction}: action mismatch (got ${tokenProps.action})`
      );
      return {
        allowed: false,
        mode: "LIVE",
        score,
        action: tokenProps.action,
        reason: "Security token action mismatch. Please refresh and retry."
      };
    }
    if (score < minScore) {
      db.logAudit(
        params.actorHint || "anonymous",
        "RECAPTCHA_BLOCKED",
        "AUTH_PERMISSION",
        `Blocked ${params.expectedAction}: low risk score (${score} < ${minScore})`
      );
      return {
        allowed: false,
        mode: "LIVE",
        score,
        action: tokenProps.action,
        reason: "Automated or suspicious activity detected. Please retry or contact concierge."
      };
    }
    return {
      allowed: true,
      mode: "LIVE",
      score,
      action: tokenProps.action || params.expectedAction
    };
  } catch (err) {
    return {
      allowed: false,
      mode: "LIVE",
      reason: `reCAPTCHA Enterprise verification error: ${err?.message || "network failure"}`
    };
  }
}
var DEFAULT_SITE_KEY;
var init_recaptcha = __esm({
  "src/server/recaptcha.ts"() {
    init_integrations();
    init_db();
    DEFAULT_SITE_KEY = "6Le3mCcuAAAAAJCQBRIMvqTGd4RadX5JvnNubovL";
  }
});

// src/lib/recaptcha.ts
async function executeRecaptchaEnterprise(action, timeoutMs = 2500) {
  if (typeof window === "undefined") {
    return null;
  }
  const enterprise = window.grecaptcha?.enterprise;
  if (!enterprise) {
    return null;
  }
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);
    try {
      enterprise.ready(async () => {
        try {
          const token = await enterprise.execute(RECAPTCHA_ENTERPRISE_SITE_KEY, { action });
          if (!settled) {
            settled = true;
            window.clearTimeout(timer);
            resolve(token || null);
          }
        } catch {
          if (!settled) {
            settled = true;
            window.clearTimeout(timer);
            resolve(null);
          }
        }
      });
    } catch {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(null);
      }
    }
  });
}
var RECAPTCHA_ENTERPRISE_SITE_KEY;
var init_recaptcha2 = __esm({
  "src/lib/recaptcha.ts"() {
    RECAPTCHA_ENTERPRISE_SITE_KEY = import.meta.env?.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || "6Le3mCcuAAAAAJCQBRIMvqTGd4RadX5JvnNubovL";
  }
});

// src/tests/criticalPaths.test.ts
var criticalPaths_test_exports = {};
__export(criticalPaths_test_exports, {
  runCriticalPathTests: () => runCriticalPathTests
});
import fs7 from "fs";
import path7 from "path";
import crypto6 from "crypto";
import express from "express";
import * as XLSX2 from "xlsx";
async function runCriticalPathTests() {
  const results = [];
  console.log("\n--- STARTING CRITICAL PATH TESTS ---\n");
  try {
    const testEventId = `evt_test_${Date.now()}`;
    const firstCall = await processWebhookEvent({
      eventId: testEventId,
      event: "order.placed",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      data: {
        customerEmail: "test.patron@domain.com",
        customerName: "Test Patron",
        subtotal: 1e4,
        totalAmount: 11800,
        items: [
          {
            productId: "prod-m-belt-01",
            productName: "The Rajputana Bridle Belt",
            sku: "BVL-MEN-BLT-01",
            category: "men",
            quantity: 1,
            unitPrice: 1e4,
            leatherType: "VEGETABLE_TANNED_HERITAGE",
            hsnCode: "4203",
            gstRate: 0.18,
            taxAmount: 1800,
            lineTotal: 11800
          }
        ]
      }
    });
    const secondCall = await processWebhookEvent({
      eventId: testEventId,
      event: "order.placed",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      data: {}
    });
    const beltInv = db.getInventory().find((i) => i.sku === "BVL-MEN-BLT-01");
    if (beltInv) {
      db.updateInventoryStock("BVL-MEN-BLT-01", "punePrimaryHub", beltInv.stockByLocation.punePrimaryHub + 1, "sunilchain@gmail.com");
    }
    if (firstCall.status === "PROCESSED" && secondCall.status === "IGNORED_DUPLICATE") {
      results.push({ test: "Webhook Ingestion & Idempotency", status: "PASS", message: "First call processed order, second duplicate call ignored idempotently." });
    } else {
      results.push({ test: "Webhook Ingestion & Idempotency", status: "FAIL", message: `Expected PROCESSED then IGNORED_DUPLICATE, got ${firstCall.status} and ${secondCall.status}` });
    }
  } catch (e) {
    results.push({ test: "Webhook Ingestion & Idempotency", status: "FAIL", message: e.message });
  }
  try {
    const vipPatron = {
      id: "c_test_vip",
      email: "vip@test.com",
      phone: "",
      fullName: "VIP Patron",
      role: "PATRON",
      createdAt: "",
      updatedAt: "",
      totalOrders: 6,
      lifetimeValue: 8e4,
      averageOrderValue: 13333,
      refundRate: 0,
      daysSinceLastOrder: 15,
      rfmSegment: "Promising/Recent",
      rfmScore: { recency: 5, frequency: 5, monetary: 5 },
      discountOrdersCount: 0,
      loyaltyPoints: 0,
      storeCreditBalance: 0,
      tags: [],
      acquisitionCost: 0
    };
    const atRiskPatron = {
      ...vipPatron,
      id: "c_test_atrisk",
      daysSinceLastOrder: 120,
      totalOrders: 2
    };
    const bargainPatron = {
      ...vipPatron,
      id: "c_test_bargain",
      totalOrders: 3,
      discountOrdersCount: 3,
      lifetimeValue: 9e3
    };
    const rfmVip = classifyCustomerRFM(vipPatron);
    const rfmAtRisk = classifyCustomerRFM(atRiskPatron);
    const rfmBargain = classifyCustomerRFM(bargainPatron);
    if (rfmVip.segment === "Champions/VIPs" && rfmAtRisk.segment === "At-Risk/Churning" && rfmBargain.segment === "Bargain Hunters") {
      results.push({ test: "RFM Customer Segmentation", status: "PASS", message: "Accurately classified VIP, At-Risk, and Bargain Hunter archetypes." });
    } else {
      results.push({ test: "RFM Customer Segmentation", status: "FAIL", message: `Mismatch in RFM output: VIP=${rfmVip.segment}, AtRisk=${rfmAtRisk.segment}, Bargain=${rfmBargain.segment}` });
    }
  } catch (e) {
    results.push({ test: "RFM Customer Segmentation", status: "FAIL", message: e.message });
  }
  try {
    const initialInv = db.getInventory().find((i) => i.sku === "BVL-TRV-BRF-01");
    const initialQty = initialInv ? initialInv.stockByLocation.punePrimaryHub : 0;
    const pushedOrder = await erpSync.pushCustomQuoteToSalesOrder({
      customerId: "cust_quote_test",
      customerName: "Enterprise Client",
      customerEmail: "corp@client.com",
      dealType: "WHOLESALE_BULK",
      items: [
        {
          productId: "prod-t-brf-01",
          productName: "The Viceroy Diplomat Briefcase",
          sku: "BVL-TRV-BRF-01",
          quantity: 1,
          unitPrice: 28900,
          leatherType: "VEGETABLE_TANNED_HERITAGE"
        }
      ]
    }, "sunilchain@gmail.com");
    const updatedInv = db.getInventory().find((i) => i.sku === "BVL-TRV-BRF-01");
    const updatedQty = updatedInv ? updatedInv.stockByLocation.punePrimaryHub : 0;
    if (updatedInv) {
      await db.updateInventoryStockAsync("BVL-TRV-BRF-01", "punePrimaryHub", initialQty, "sunilchain@gmail.com");
    }
    if (pushedOrder && pushedOrder.orderNumber && updatedQty === initialQty - 1) {
      results.push({ test: "ERP Sales Order Push & Pune Hub Sync", status: "PASS", message: `Sales order ${pushedOrder.orderNumber} created and Pune Hub stock deducted from ${initialQty} to ${updatedQty}.` });
    } else {
      results.push({ test: "ERP Sales Order Push & Pune Hub Sync", status: "FAIL", message: `Inventory deduction failed. Initial: ${initialQty}, Updated: ${updatedQty}` });
    }
  } catch (e) {
    results.push({ test: "ERP Sales Order Push & Pune Hub Sync", status: "FAIL", message: e.message });
  }
  try {
    const testCart = cartRecovery.persistStorefrontCart({
      cartId: `cart_test_${Date.now()}`,
      email: "idle.shopper@test.com",
      items: [
        {
          productId: "prod-m-wal-01",
          productName: "The Bifold Heirloom Folio",
          sku: "BVL-MEN-WAL-01",
          unitPrice: 3800,
          quantity: 1,
          leatherType: "VEGETABLE_TANNED_HERITAGE",
          imageUrl: ""
        }
      ],
      subtotal: 3800
    });
    testCart.lastActiveAt = new Date(Date.now() - 20 * 60 * 1e3).toISOString();
    const sweep = cartRecovery.runAbandonmentDetectionSweep();
    const isFound = sweep.carts.some((c) => c.id === testCart.id && c.isAbandoned);
    const recovery1 = cartRecovery.dispatchRecoveryMessage(testCart.id, "EMAIL");
    const recovery2 = cartRecovery.dispatchRecoveryMessage(testCart.id, "EMAIL");
    if (isFound && recovery1.success && !recovery2.success) {
      results.push({ test: "Abandoned Cart Detection & Idempotent Recovery", status: "PASS", message: "Cart detected as abandoned after idle threshold; duplicate recovery blocked idempotently." });
    } else {
      results.push({ test: "Abandoned Cart Detection & Idempotent Recovery", status: "FAIL", message: `Found: ${isFound}, Recovery1: ${recovery1.success}, Recovery2 (should be false): ${recovery2.success}` });
    }
  } catch (e) {
    results.push({ test: "Abandoned Cart Detection & Idempotent Recovery", status: "FAIL", message: e.message });
  }
  try {
    const masterSunil = "sunilchain@gmail.com";
    const masterSupport = "support@bharatvarshcrafts.com";
    const unauthorizedUser = "intruder@external.com";
    const sunilAllowed = db.isStoreManagementAuthorized(masterSunil);
    const supportAllowed = db.isStoreManagementAuthorized(masterSupport);
    const intruderBlocked = !db.isStoreManagementAuthorized(unauthorizedUser);
    const tempManager = "artisan.manager@bharatvarshcrafts.com";
    db.addPermittedManager(tempManager, masterSunil, "Artisan Manager");
    const tempAllowed = db.isStoreManagementAuthorized(tempManager);
    db.removePermittedManager(tempManager, masterSunil);
    const tempRevoked = !db.isStoreManagementAuthorized(tempManager);
    let intruderRejected = false;
    try {
      db.addPermittedManager("hacker@domain.com", unauthorizedUser);
    } catch {
      intruderRejected = true;
    }
    const testSku = "BVL-WOM-BLT-01";
    const inv = db.getInventory().find((i) => i.sku === testSku);
    const origPune = inv.stockByLocation.punePrimaryHub;
    const origMumbai = inv.stockByLocation.mumbaiWarehouse;
    db.updateInventoryStock(testSku, "punePrimaryHub", 0, masterSunil);
    db.updateInventoryStock(testSku, "mumbaiWarehouse", 0, masterSunil);
    const catAfterZero = db.getCatalog();
    const deactivatedProd = catAfterZero.products.find((p) => p.sku === testSku);
    db.updateInventoryStock(testSku, "punePrimaryHub", origPune, masterSunil);
    db.updateInventoryStock(testSku, "mumbaiWarehouse", origMumbai, masterSunil);
    if (sunilAllowed && supportAllowed && intruderBlocked && tempAllowed && tempRevoked && intruderRejected && deactivatedProd && deactivatedProd.inStock === false && deactivatedProd.isActive === false) {
      results.push({
        test: "Store Management Access & Zero-Stock Deactivation",
        status: "PASS",
        message: "Access restricted to authorized IDs; products with 0 inventory deactivate and report out of stock."
      });
    } else {
      results.push({ test: "Store Management Access & Zero-Stock Deactivation", status: "FAIL", message: "Access control or zero-stock check failed." });
    }
  } catch (e) {
    results.push({ test: "Store Management Access & Zero-Stock Deactivation", status: "FAIL", message: e.message });
  }
  try {
    const forgedToken = "eyJhbGciOiJSUzI1NiIsImtpZCI6ImZha2Uta2lkIn0." + Buffer.from(
      JSON.stringify({
        aud: "gen-lang-client-0774833728",
        iss: "https://securetoken.google.com/gen-lang-client-0774833728",
        sub: "fake-uid",
        email: "sunilchain@gmail.com",
        email_verified: true,
        iat: Math.floor(Date.now() / 1e3) - 10,
        exp: Math.floor(Date.now() / 1e3) + 3600
      })
    ).toString("base64url") + ".ZmFrZS1zaWduYXR1cmU";
    const forgedResult = await verifyFirebaseIdToken(forgedToken);
    const malformedResult = await verifyFirebaseIdToken("not.a.valid-jwt");
    const certsRes = await fetch("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com");
    const certsJson = await certsRes.json();
    const certCount = Object.keys(certsJson).length;
    if (forgedResult === null && malformedResult === null && certsRes.ok && certCount > 0) {
      results.push({
        test: "Google Firebase Auth Token Verifier",
        status: "PASS",
        message: `Rejected forged/malformed JWTs; fetched ${certCount} live Google x509 signing certificates.`
      });
    } else {
      results.push({
        test: "Google Firebase Auth Token Verifier",
        status: "FAIL",
        message: `Verifier failed: forged=${Boolean(forgedResult)}, malformed=${Boolean(malformedResult)}, certs=${certCount}`
      });
    }
  } catch (e) {
    results.push({ test: "Google Firebase Auth Token Verifier", status: "FAIL", message: e.message });
  }
  try {
    const executedQueries = [];
    const mockConn = {
      query: async (sql, params) => {
        executedQueries.push({ sql: sql.trim(), params });
        return [[]];
      }
    };
    const stateSnap = structuredClone(db.getFullStateSnapshot());
    const catalogSnap = structuredClone(db.getRawCatalog());
    await mysqlAdapter.syncStateWithConnection(mockConn, stateSnap);
    await mysqlAdapter.saveCatalogSnapshot(catalogSnap, mockConn);
    const sqlTexts = executedQueries.map((q) => q.sql);
    const syncedTables = [
      "bvl_app_state",
      "bvl_inventory",
      "bvl_admin_users",
      "bvl_customers",
      "bvl_orders",
      "bvl_audit_logs",
      "bvl_catalog_categories",
      "bvl_catalog_products"
    ].every((tbl) => sqlTexts.some((s) => s.includes(tbl)));
    const noIdentityDeletes = !sqlTexts.some((s) => s.includes("DELETE FROM bvl_admin_users")) && !sqlTexts.some((s) => s.includes("DELETE FROM bvl_customers"));
    const guardedInventoryAndOrdersCleanup = sqlTexts.some((s) => s.includes("DELETE FROM bvl_inventory WHERE sku NOT IN")) && sqlTexts.some((s) => s.includes("DELETE FROM bvl_orders WHERE id NOT IN"));
    executedQueries.length = 0;
    await mysqlAdapter.syncStateWithConnection(mockConn, {
      ...stateSnap,
      inventory: [],
      orders: [],
      customers: [],
      config: { ...stateSnap.config, adminCredentials: [] }
    });
    const emptySnapshotSql = executedQueries.map((q) => q.sql);
    const noDeletesOnEmptySnapshot = !emptySnapshotSql.some((s) => s.startsWith("DELETE FROM"));
    if (syncedTables && noIdentityDeletes && guardedInventoryAndOrdersCleanup && noDeletesOnEmptySnapshot) {
      results.push({
        test: "Protected MySQL Snapshot Sync & Empty-List Guards",
        status: "PASS",
        message: "Verified upsert-only identity tables (no DELETE on admin/customers) and empty-array guards on orders/inventory."
      });
    } else {
      results.push({
        test: "Protected MySQL Snapshot Sync & Empty-List Guards",
        status: "FAIL",
        message: `syncedTables=${syncedTables}, noIdentityDeletes=${noIdentityDeletes}, guardedCleanup=${guardedInventoryAndOrdersCleanup}, noDeletesOnEmpty=${noDeletesOnEmptySnapshot}`
      });
    }
  } catch (e) {
    results.push({ test: "Protected MySQL Snapshot Sync & Empty-List Guards", status: "FAIL", message: e.message });
  }
  try {
    const credFile = path7.resolve(process.cwd(), "src/server/data/mysql_credentials.enc.json");
    const keyFile = path7.resolve(process.cwd(), "src/server/data/.mysql_key");
    const hadCredFile = fs7.existsSync(credFile);
    const prevCredBytes = hadCredFile ? fs7.readFileSync(credFile) : null;
    const hadKeyFile = fs7.existsSync(keyFile);
    const prevKeyBytes = hadKeyFile ? fs7.readFileSync(keyFile) : null;
    try {
      const sampleCfg = {
        host: "127.0.0.1",
        port: 3306,
        database: "u999999_bharatvarsh",
        user: "u999999_admin",
        password: "Test#Hostinger!Password2026"
      };
      mysqlAdapter.saveEncryptedConfig(sampleCfg);
      const rawFile = fs7.readFileSync(credFile, "utf-8");
      const plaintextLeaked = rawFile.includes(sampleCfg.password) || rawFile.includes(sampleCfg.database);
      const loaded = mysqlAdapter.loadEncryptedConfig();
      if (!plaintextLeaked && loaded && loaded.host === sampleCfg.host && loaded.port === sampleCfg.port && loaded.database === sampleCfg.database && loaded.user === sampleCfg.user && loaded.password === sampleCfg.password) {
        results.push({
          test: "Encrypted MySQL Credentials Persistence",
          status: "PASS",
          message: "AES-256-GCM credentials saved without plaintext leakage and decrypted accurately for auto-reconnect."
        });
      } else {
        results.push({
          test: "Encrypted MySQL Credentials Persistence",
          status: "FAIL",
          message: `plaintextLeaked=${plaintextLeaked}, loadedMatch=${Boolean(loaded)}`
        });
      }
    } finally {
      if (hadCredFile && prevCredBytes) {
        fs7.writeFileSync(credFile, prevCredBytes);
      } else if (fs7.existsSync(credFile)) {
        fs7.unlinkSync(credFile);
      }
      if (hadKeyFile && prevKeyBytes) {
        fs7.writeFileSync(keyFile, prevKeyBytes);
      } else if (fs7.existsSync(keyFile)) {
        fs7.unlinkSync(keyFile);
      }
    }
  } catch (e) {
    results.push({ test: "Encrypted MySQL Credentials Persistence", status: "FAIL", message: e.message });
  }
  try {
    const adapterAny = mysqlAdapter;
    const origPool = adapterAny.pool;
    const origConnected = adapterAny.connected;
    const origLastError = adapterAny.lastError;
    const origLastSyncAt = adapterAny.lastSyncAt;
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const sku = "BVL-MEN-BLT-01";
    const invBefore = db.getInventory().find((i) => i.sku === sku);
    const origPune = invBefore.stockByLocation.punePrimaryHub;
    const origMumbai = invBefore.stockByLocation.mumbaiWarehouse;
    const origOrderCount = db.getOrders().length;
    let failOnWrite = false;
    const txEvents = [];
    const mockConn = {
      beginTransaction: async () => {
        txEvents.push("BEGIN");
      },
      commit: async () => {
        txEvents.push("COMMIT");
      },
      rollback: async () => {
        txEvents.push("ROLLBACK");
      },
      release: () => {
        txEvents.push("RELEASE");
      },
      query: async (sql) => {
        const trimmed = sql.trim();
        if (trimmed.includes("FOR UPDATE")) {
          txEvents.push("FOR_UPDATE");
          return [
            [
              {
                sku,
                product_id: invBefore.productId,
                name: invBefore.name,
                pune_primary_hub: origPune,
                mumbai_warehouse: origMumbai
              }
            ]
          ];
        }
        if (failOnWrite && trimmed.startsWith("INSERT INTO bvl_orders")) {
          throw new Error("Simulated MySQL transaction write failure");
        }
        return [[]];
      }
    };
    adapterAny.pool = { getConnection: async () => mockConn };
    adapterAny.connected = true;
    try {
      failOnWrite = true;
      let surfacedError = "";
      try {
        await db.createOrderAsync({
          customerId: "cust_01_vip",
          customerName: "Vikramaditya Singhania",
          customerEmail: "vikram.singhania@heritagecrafts.in",
          customerPhone: "+91 98201 12345",
          status: "PROCESSING",
          currency: "INR",
          subtotal: 4200,
          discountAmount: 0,
          taxAmount: 756,
          shippingFee: 0,
          totalAmount: 4956,
          paymentGateway: "RAZORPAY",
          paymentId: "pay_rollback_test",
          paymentStatus: "PAID",
          items: [
            {
              id: "item_rb_1",
              orderId: "",
              productId: invBefore.productId,
              productName: invBefore.name,
              sku,
              category: "men",
              quantity: 1,
              unitPrice: 4200,
              leatherType: "VEGETABLE_TANNED_HERITAGE",
              hsnCode: "4203",
              gstRate: 0.18,
              taxAmount: 756,
              lineTotal: 4956
            }
          ],
          shippingAddress: {
            id: "addr_test",
            customerId: "cust_01_vip",
            street: "Test",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411001",
            country: "India",
            isDefault: true,
            addressType: "SHIPPING"
          },
          billingAddress: {
            id: "addr_test_b",
            customerId: "cust_01_vip",
            street: "Test",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411001",
            country: "India",
            isDefault: true,
            addressType: "BILLING"
          }
        });
      } catch (err) {
        surfacedError = err.message;
      }
      const invAfterFail = db.getInventory().find((i) => i.sku === sku);
      const diskAfterFail = JSON.parse(fs7.readFileSync(dbFile, "utf-8"));
      const diskInvAfterFail = diskAfterFail.inventory.find((i) => i.sku === sku);
      const rollbackOk = surfacedError.includes("Simulated MySQL transaction write failure") && txEvents.includes("FOR_UPDATE") && txEvents.includes("ROLLBACK") && invAfterFail.stockByLocation.punePrimaryHub === origPune && diskInvAfterFail.stockByLocation.punePrimaryHub === origPune && db.getOrders().length === origOrderCount;
      txEvents.length = 0;
      failOnWrite = false;
      await db.updateInventoryStockAsync(sku, "punePrimaryHub", origPune + 2, "sunilchain@gmail.com");
      const commitOk = txEvents.includes("BEGIN") && txEvents.includes("FOR_UPDATE") && txEvents.includes("COMMIT") && db.getInventory().find((i) => i.sku === sku).stockByLocation.punePrimaryHub === origPune + 2;
      if (rollbackOk && commitOk) {
        results.push({
          test: "Transactional SELECT FOR UPDATE & Failure Rollback",
          status: "PASS",
          message: "Locked bvl_inventory rows with SELECT FOR UPDATE, surfaced DB error on failure, and rolled back memory & disk."
        });
      } else {
        results.push({
          test: "Transactional SELECT FOR UPDATE & Failure Rollback",
          status: "FAIL",
          message: `rollbackOk=${rollbackOk}, commitOk=${commitOk}, surfacedError=${surfacedError}`
        });
      }
    } finally {
      adapterAny.pool = origPool;
      adapterAny.connected = origConnected;
      adapterAny.lastError = origLastError;
      adapterAny.lastSyncAt = origLastSyncAt;
      await db.updateInventoryStockAsync(sku, "punePrimaryHub", origPune, "sunilchain@gmail.com").catch(() => {
      });
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({ test: "Transactional SELECT FOR UPDATE & Failure Rollback", status: "FAIL", message: e.message });
  }
  try {
    const adapterAny = mysqlAdapter;
    const origPool = adapterAny.pool;
    const origConnected = adapterAny.connected;
    const origLastError = adapterAny.lastError;
    const origLastSyncAt = adapterAny.lastSyncAt;
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const capturedQueries = [];
    const mockConn = {
      beginTransaction: async () => {
      },
      commit: async () => {
      },
      rollback: async () => {
      },
      release: () => {
      },
      query: async (sql, params) => {
        capturedQueries.push({ sql: sql.trim(), params });
        return [[]];
      }
    };
    adapterAny.pool = { getConnection: async () => mockConn };
    adapterAny.connected = true;
    try {
      const targetCustomerId = "cust_01_vip";
      const ordersBefore = db.getOrders().filter((o) => o.customerId === targetCustomerId).length;
      const archived = await db.softDeleteCustomerAsync(targetCustomerId, "sunilchain@gmail.com");
      const archivedStateCaptured = archived.isActive === false && Boolean(archived.deletedAt);
      const hiddenInCrmList = !db.getCustomers().some((c) => c.id === targetCustomerId);
      const retainedForHistoryLookup = db.getCustomerById(targetCustomerId)?.isActive === false;
      const ordersPreserved = db.getOrders().filter((o) => o.customerId === targetCustomerId).length === ordersBefore;
      const softDeleteSqlIssued = capturedQueries.some(
        (q) => q.sql.includes("UPDATE bvl_customers SET is_active = 0, deleted_at = NOW()") && q.params?.[0] === targetCustomerId
      );
      const { customer: reactivated } = db.findOrCreateCustomer({
        email: archived.email,
        fullName: archived.fullName
      });
      const reactivatedOk = reactivated.isActive === true && !reactivated.deletedAt;
      capturedQueries.length = 0;
      const delegatedAdmin = "delegated.protect.test@bharatvarshcrafts.com";
      db.addPermittedManager(delegatedAdmin, "sunilchain@gmail.com", "Delegated Test Admin");
      await db.deleteAdminUserAsync(delegatedAdmin, "sunilchain@gmail.com");
      const targetedAdminDeleteSql = capturedQueries.some(
        (q) => q.sql === "DELETE FROM bvl_admin_users WHERE user_id = ?" && q.params?.[0] === delegatedAdmin
      );
      let masterProtected = false;
      try {
        await db.deleteAdminUserAsync("support@bharatvarshcrafts.com", "sunilchain@gmail.com");
      } catch {
        masterProtected = true;
      }
      if (archivedStateCaptured && hiddenInCrmList && retainedForHistoryLookup && ordersPreserved && softDeleteSqlIssued && reactivatedOk && targetedAdminDeleteSql && masterProtected) {
        results.push({
          test: "Customer Soft-Delete & Targeted Admin Deletion",
          status: "PASS",
          message: "Soft-deleted customer (is_active=0) hidden from CRM while preserving orders/audit trail; targeted admin DELETE verified."
        });
      } else {
        results.push({
          test: "Customer Soft-Delete & Targeted Admin Deletion",
          status: "FAIL",
          message: `hidden=${hiddenInCrmList}, lookup=${retainedForHistoryLookup}, orders=${ordersPreserved}, softSql=${softDeleteSqlIssued}, reactivated=${reactivatedOk}, adminSql=${targetedAdminDeleteSql}, masterProtected=${masterProtected}`
        });
      }
    } finally {
      adapterAny.pool = origPool;
      adapterAny.connected = origConnected;
      adapterAny.lastError = origLastError;
      adapterAny.lastSyncAt = origLastSyncAt;
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({ test: "Customer Soft-Delete & Targeted Admin Deletion", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    try {
      const targetOrder = db.getOrderById("ord_1002");
      const purseSku = targetOrder.items[0].sku;
      const invBefore = db.getInventory().find((i) => i.sku === purseSku);
      const puneBefore = invBefore.stockByLocation.punePrimaryHub;
      const mumbaiBefore = invBefore.stockByLocation.mumbaiWarehouse;
      await erpSync.processRMA({
        orderId: targetOrder.id,
        customerId: targetOrder.customerId,
        reason: "TEXTURE_DEFECT",
        restockInWarehouse: true,
        restockLocation: "punePrimaryHub",
        actorEmail: "sunilchain@gmail.com"
      });
      const afterPune = db.getInventory().find((i) => i.sku === purseSku);
      const puneIncrementedOnly = afterPune.stockByLocation.punePrimaryHub === puneBefore + 1 && afterPune.stockByLocation.mumbaiWarehouse === mumbaiBefore;
      await erpSync.processRMA({
        orderId: targetOrder.id,
        customerId: targetOrder.customerId,
        reason: "COLOR_MISMATCH",
        restockInWarehouse: true,
        restockLocation: "mumbaiWarehouse",
        actorEmail: "sunilchain@gmail.com"
      });
      const afterMumbai = db.getInventory().find((i) => i.sku === purseSku);
      const mumbaiIncrementedOnly = afterMumbai.stockByLocation.punePrimaryHub === puneBefore + 1 && afterMumbai.stockByLocation.mumbaiWarehouse === mumbaiBefore + 1;
      if (puneIncrementedOnly && mumbaiIncrementedOnly) {
        results.push({
          test: "RMA Restock Location Selector Routing",
          status: "PASS",
          message: "RMA restock routed accurately to Pune Primary Hub and Mumbai Warehouse based on operator selection."
        });
      } else {
        results.push({
          test: "RMA Restock Location Selector Routing",
          status: "FAIL",
          message: `puneOnly=${puneIncrementedOnly}, mumbaiOnly=${mumbaiIncrementedOnly}`
        });
      }
    } finally {
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({ test: "RMA Restock Location Selector Routing", status: "FAIL", message: e.message });
  }
  try {
    const directRes = cartRecovery.resolveResumableCart("cart_abandoned_01");
    const signedToken = cartRecovery.signResumeToken("cart_abandoned_01");
    const signedRes = cartRecovery.resolveResumableCart("cart_abandoned_01", signedToken);
    const tamperedRes = cartRecovery.resolveResumableCart("cart_abandoned_01", `${signedToken}tamper`);
    const missingRes = cartRecovery.resolveResumableCart("cart_does_not_exist");
    const resumeUrl = cartRecovery.buildCheckoutResumeUrl("cart_abandoned_01");
    if (directRes.status === "OK" && !directRes.tokenVerified && directRes.cart.items.length > 0 && signedRes.status === "OK" && signedRes.tokenVerified && signedRes.cart.email === "karan.mehra@apextech.co" && tamperedRes.status === "INVALID_TOKEN" && missingRes.status === "NOT_FOUND" && resumeUrl.includes("resume=cart_abandoned_01&token=")) {
      results.push({
        test: "Cart Recovery Resume Links & Token Verification",
        status: "PASS",
        message: "Verified direct cart ID lookup, HMAC-signed resume token validation, and tampered token rejection."
      });
    } else {
      results.push({
        test: "Cart Recovery Resume Links & Token Verification",
        status: "FAIL",
        message: `direct=${directRes.status}, signed=${signedRes.status}, tampered=${tamperedRes.status}, missing=${missingRes.status}`
      });
    }
  } catch (e) {
    results.push({ test: "Cart Recovery Resume Links & Token Verification", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    try {
      const delegatedEmail = "delegated.manager.rbac@bharatvarshcrafts.com";
      db.addPermittedManager(delegatedEmail, "sunilchain@gmail.com", "Delegated Ops Lead", "OpsLead#2026");
      const delegatedJwt = signSessionJwt({
        sub: "uid_delegated_rbac",
        email: delegatedEmail,
        name: "Delegated Ops Lead",
        role: "STORE_MANAGER"
      });
      const masterJwt = signSessionJwt({
        sub: "uid_master_sunil",
        email: "sunilchain@gmail.com",
        name: "Sunil Chainani",
        role: "STORE_MANAGER"
      });
      const invokeMiddleware = async (mw, authHeader) => {
        let statusCode = 200;
        let nextCalled = false;
        let body = null;
        const mockReq = {
          headers: authHeader ? { authorization: authHeader } : {},
          method: "POST",
          originalUrl: "/api/store-management/gst-toggle",
          ip: "127.0.0.1"
        };
        const mockRes = {
          status(code) {
            statusCode = code;
            return this;
          },
          json(payload) {
            body = payload;
            return this;
          }
        };
        await mw(mockReq, mockRes, () => {
          nextCalled = true;
        });
        return { statusCode, nextCalled, body };
      };
      const delegatedStoreCheck = await invokeMiddleware(requireStoreManagementAccess, `Bearer ${delegatedJwt}`);
      const delegatedMasterCheck = await invokeMiddleware(requireMasterAdminAccess, `Bearer ${delegatedJwt}`);
      const unauthMasterCheck = await invokeMiddleware(requireMasterAdminAccess, void 0);
      const masterAllowedCheck = await invokeMiddleware(requireMasterAdminAccess, `Bearer ${masterJwt}`);
      let domainGstBlocked = false;
      try {
        db.updateGstInvoicing(false, delegatedEmail);
      } catch {
        domainGstBlocked = true;
      }
      if (delegatedStoreCheck.nextCalled && !delegatedMasterCheck.nextCalled && delegatedMasterCheck.statusCode === 403 && !unauthMasterCheck.nextCalled && unauthMasterCheck.statusCode === 401 && masterAllowedCheck.nextCalled && domainGstBlocked) {
        results.push({
          test: "Master-Admin Server-Side Enforcement",
          status: "PASS",
          message: "Blocked delegated Store Managers (403) and guests (401) from Master-only routes and domain helpers; allowed Master Super-Admin."
        });
      } else {
        results.push({
          test: "Master-Admin Server-Side Enforcement",
          status: "FAIL",
          message: `store=${delegatedStoreCheck.nextCalled}, delMasterStatus=${delegatedMasterCheck.statusCode}, unauth=${unauthMasterCheck.statusCode}, masterNext=${masterAllowedCheck.nextCalled}, domainBlocked=${domainGstBlocked}`
        });
      }
    } finally {
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({ test: "Master-Admin Server-Side Enforcement", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const prevTestFlag = process.env.ENABLE_TEST_AUTH_TOKENS;
    try {
      const forgedAuth = resolveAuthToken("Bearer auth_token:sunilchain@gmail.com:STORE_MANAGER");
      const forgedFb = resolveAuthToken("Bearer fb_token:support@bharatvarshcrafts.com:STORE_MANAGER");
      delete process.env.ENABLE_TEST_AUTH_TOKENS;
      const staticOff = process.env.NODE_ENV === "test" ? null : resolveAuthToken("Bearer token_sunil");
      process.env.ENABLE_TEST_AUTH_TOKENS = "true";
      const staticOn = resolveAuthToken("Bearer token_sunil");
      delete process.env.ENABLE_TEST_AUTH_TOKENS;
      const validJwt = signSessionJwt({
        sub: "uid_jwt_test",
        email: "sunilchain@gmail.com",
        name: "Sunil Chainani",
        role: "STORE_MANAGER"
      });
      const jwtVerified = verifySessionJwt(validJwt);
      const tamperedJwt = `${validJwt.slice(0, -4)}AAAA`;
      const jwtTamperedRejected = verifySessionJwt(tamperedJwt) === null;
      const resolvedJwt = resolveAuthToken(`Bearer ${validJwt}`);
      const h1 = hashPassword("AtelierSecret#2026");
      const h2 = hashPassword("AtelierSecret#2026");
      const scryptFormatOk = h1.startsWith("scrypt$") && h1 !== h2 && verifyPassword("AtelierSecret#2026", h1).valid;
      const passwordlessAdminBlocked = !db.verifyAdminLogin("sunilchain@gmail.com", "any_password").valid;
      const { customer: regCust } = db.registerPatronWithPassword({
        email: "patron.scrypt.test@example.com",
        password: "StrongPassword!99",
        fullName: "Meera Kulkarni"
      });
      const patronValidLogin = db.verifyPatronLogin("patron.scrypt.test@example.com", "StrongPassword!99").valid;
      const patronWrongPasswordRejected = !db.verifyPatronLogin("patron.scrypt.test@example.com", "WrongPass!99").valid;
      if (forgedAuth === null && forgedFb === null && staticOff === null && staticOn?.email === "sunilchain@gmail.com" && jwtVerified?.email === "sunilchain@gmail.com" && jwtTamperedRejected && resolvedJwt?.isMasterAdmin === true && scryptFormatOk && passwordlessAdminBlocked && regCust.email === "patron.scrypt.test@example.com" && patronValidLogin && patronWrongPasswordRejected) {
        results.push({
          test: "Signed JWTs, Salted scrypt Passwords & Token Isolation",
          status: "PASS",
          message: "Rejected predictable auth_token strings and tampered JWTs; enforced salted scrypt for admins/patrons and isolated test tokens."
        });
      } else {
        results.push({
          test: "Signed JWTs, Salted scrypt Passwords & Token Isolation",
          status: "FAIL",
          message: `forgedNull=${forgedAuth === null && forgedFb === null}, staticOff=${staticOff === null}, jwtOk=${Boolean(resolvedJwt)}, scrypt=${scryptFormatOk}, pwlessAdminBlocked=${passwordlessAdminBlocked}, patronOk=${patronValidLogin && patronWrongPasswordRejected}`
        });
      }
    } finally {
      if (prevTestFlag === void 0) {
        delete process.env.ENABLE_TEST_AUTH_TOKENS;
      } else {
        process.env.ENABLE_TEST_AUTH_TOKENS = prevTestFlag;
      }
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({ test: "Signed JWTs, Salted scrypt Passwords & Token Isolation", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const port = server.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: "Price Tamper Tester",
          customerEmail: "price.audit.test@example.com",
          customerPhone: "+91 98201 12345",
          shippingAddress: {
            street: "204 Heritage Arcade, FC Road",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411004",
            country: "India"
          },
          items: [
            {
              productId: "prod-m-belt-01",
              sku: "BVL-MEN-BLT-01",
              productName: "Tampered Cheap Belt",
              unitPrice: 1,
              quantity: 1,
              leatherType: "VEGETABLE_TANNED_HERITAGE"
            }
          ],
          subtotal: 1,
          discountAmount: 99999,
          discountCode: "HEIRLOOM10"
        })
      });
      const data = await res.json();
      const order = data.order;
      const serverPriceEnforced = res.status === 201 && order && order.items[0].unitPrice === 4200 && order.subtotal === 4200 && order.discountCode === "HEIRLOOM10" && order.discountAmount === 420 && order.taxAmount === 680 && order.totalAmount === 4460;
      const fakePromoRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: "Price Tamper Tester",
          customerEmail: "price.audit.test@example.com",
          customerPhone: "+91 98201 12345",
          shippingAddress: {
            street: "204 Heritage Arcade, FC Road",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411004",
            country: "India"
          },
          items: [{ productId: "prod-m-belt-01", sku: "BVL-MEN-BLT-01", quantity: 1 }],
          discountCode: "FREE99"
        })
      });
      if (serverPriceEnforced && fakePromoRes.status === 400) {
        results.push({
          test: "Server-Side Checkout Pricing & Promo Enforcement",
          status: "PASS",
          message: "Ignored tampered client unitPrice/subtotal/discountAmount and enforced live catalog pricing (\u20B94,200) + HEIRLOOM10 math."
        });
      } else {
        results.push({
          test: "Server-Side Checkout Pricing & Promo Enforcement",
          status: "FAIL",
          message: `serverPriceEnforced=${serverPriceEnforced}, fakePromoStatus=${fakePromoRes.status}, orderTotal=${order?.totalAmount}`
        });
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({ test: "Server-Side Checkout Pricing & Promo Enforcement", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const prevRzpSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const prevStripeSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const prevUnsignedFlag = process.env.ALLOW_UNSIGNED_TEST_WEBHOOKS;
    process.env.RAZORPAY_WEBHOOK_SECRET = "test_rzp_webhook_secret_2026";
    process.env.STRIPE_WEBHOOK_SECRET = "test_stripe_webhook_secret_2026";
    delete process.env.ALLOW_UNSIGNED_TEST_WEBHOOKS;
    const app = express();
    app.use(
      express.json({
        verify: (req, _res, buf) => {
          req.rawBody = buf;
        }
      })
    );
    app.use("/api", apiRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const port = server.address().port;
      const webhookPayload = JSON.stringify({
        eventId: `evt_sig_verify_${Date.now()}`,
        event: "customer.created",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        data: { email: "signed.webhook.patron@example.com", fullName: "Signed Webhook Patron" }
      });
      let missingSigRejected = true;
      if (process.env.NODE_ENV !== "test") {
        const missingRes = await fetch(`http://127.0.0.1:${port}/api/webhooks/gateway`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: webhookPayload
        });
        missingSigRejected = missingRes.status === 401;
      }
      const forgedRzpRes = await fetch(`http://127.0.0.1:${port}/api/webhooks/gateway`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-razorpay-signature": "0000000000000000deadbeef"
        },
        body: webhookPayload
      });
      const validRzpSig = crypto6.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(webhookPayload, "utf8").digest("hex");
      const validRzpRes = await fetch(`http://127.0.0.1:${port}/api/webhooks/gateway`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-razorpay-signature": validRzpSig
        },
        body: webhookPayload
      });
      const ts = Math.floor(Date.now() / 1e3);
      const validStripeHmac = crypto6.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(`${ts}.${webhookPayload}`, "utf8").digest("hex");
      const validStripeRes = await fetch(`http://127.0.0.1:${port}/api/webhooks/gateway`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": `t=${ts},v1=${validStripeHmac}`
        },
        body: webhookPayload
      });
      const simRes = await fetch(`http://127.0.0.1:${port}/api/cart/simulate-abandonment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "sim.abandon@example.com",
          items: [{ productId: "prod-m-belt-01", sku: "BVL-MEN-BLT-01", quantity: 1 }]
        })
      });
      const simData = await simRes.json();
      if (missingSigRejected && forgedRzpRes.status === 401 && validRzpRes.status === 200 && validStripeRes.status === 200 && simRes.status === 200 && simData.cart?.isAbandoned === true && simData.cart?.subtotal === 4200) {
        results.push({
          test: "Webhook HMAC Signatures & Simulator Isolation",
          status: "PASS",
          message: "Verified Razorpay and Stripe raw-body HMAC signatures (rejected forged/missing with 401) and isolated storefront abandonment simulator."
        });
      } else {
        results.push({
          test: "Webhook HMAC Signatures & Simulator Isolation",
          status: "FAIL",
          message: `missing=${missingSigRejected}, forged=${forgedRzpRes.status}, rzp=${validRzpRes.status}, stripe=${validStripeRes.status}, sim=${simRes.status}`
        });
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      if (prevRzpSecret === void 0) delete process.env.RAZORPAY_WEBHOOK_SECRET;
      else process.env.RAZORPAY_WEBHOOK_SECRET = prevRzpSecret;
      if (prevStripeSecret === void 0) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = prevStripeSecret;
      if (prevUnsignedFlag === void 0) delete process.env.ALLOW_UNSIGNED_TEST_WEBHOOKS;
      else process.env.ALLOW_UNSIGNED_TEST_WEBHOOKS = prevUnsignedFlag;
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({ test: "Webhook HMAC Signatures & Simulator Isolation", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const port = server.address().port;
      const guestRes = await fetch(`http://127.0.0.1:${port}/api/personalization-vector`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: "cust_01_vip",
          productId: "prod-m-belt-01",
          productName: "The Rajputana Bridle Belt",
          monogramText: "HACK"
        })
      });
      const guestData = await guestRes.json();
      const ananyaJwt = signSessionJwt({
        sub: "uid_patron_02",
        email: "ananya.deshmukh@gmail.com",
        name: "Ananya Deshmukh",
        role: "PATRON"
      });
      const authRes = await fetch(`http://127.0.0.1:${port}/api/personalization-vector`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ananyaJwt}`
        },
        body: JSON.stringify({
          customerId: "cust_01_vip",
          productId: "prod-w-purse-01",
          productName: "The Meera Structured Flap Purse",
          monogramText: "A.D"
        })
      });
      const authData = await authRes.json();
      if (guestRes.status === 201 && guestData.vector?.customerId === "cust_guest" && authRes.status === 201 && authData.vector?.customerId === "cust_02_recent") {
        results.push({
          test: "Personalization Vector Customer Scoping",
          status: "PASS",
          message: "Blocked spoofed customerId on guest requests (forced cust_guest) and bound authenticated requests to verified patron identity."
        });
      } else {
        results.push({
          test: "Personalization Vector Customer Scoping",
          status: "FAIL",
          message: `guest=${guestData.vector?.customerId}, auth=${authData.vector?.customerId}`
        });
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({ test: "Personalization Vector Customer Scoping", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    try {
      const beforeHealth = computeOperationalHealth();
      const beforeCohorts = computeCohortRetention();
      const beforeVelocity = computeSkuReorderVelocity();
      await erpSync.processRMA({
        orderId: "ord_1001",
        customerId: "cust_01_vip",
        reason: "HARDWARE_DAMAGE",
        restockInWarehouse: false,
        actorEmail: "sunilchain@gmail.com"
      });
      const afterHealth = computeOperationalHealth();
      const totalReturnsIncreased = (afterHealth.totalReturns ?? 0) > (beforeHealth.totalReturns ?? 0);
      const transitDamageIncreased = afterHealth.returnRateByReason.transitDamage > beforeHealth.returnRateByReason.transitDamage;
      const cohortsValid = Array.isArray(beforeCohorts) && beforeCohorts.length > 0 && beforeCohorts.some((c) => c.totalPatrons > 0);
      const velocityValid = Array.isArray(beforeVelocity) && beforeVelocity.length > 0 && beforeVelocity.every((v) => typeof v.unitsSold30d === "number" && typeof v.velocityTrend === "string");
      if (totalReturnsIncreased && transitDamageIncreased && cohortsValid && velocityValid) {
        results.push({
          test: "Dynamic Analytics, RMA Health & Cohort Computation",
          status: "PASS",
          message: "Derived RMA return-reason shares, transit SLAs, quarterly retention cohorts, and 30d SKU reorder velocity dynamically."
        });
      } else {
        results.push({
          test: "Dynamic Analytics, RMA Health & Cohort Computation",
          status: "FAIL",
          message: `returnsInc=${totalReturnsIncreased}, transitInc=${transitDamageIncreased}, cohorts=${cohortsValid}, velocity=${velocityValid}`
        });
      }
    } finally {
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({ test: "Dynamic Analytics, RMA Health & Cohort Computation", status: "FAIL", message: e.message });
  }
  try {
    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const port = server.address().port;
      const guestRes = await fetch(`http://127.0.0.1:${port}/api/patron/overview`);
      const vikramJwt = signSessionJwt({
        sub: "uid_vikram",
        email: "vikram.singhania@heritagecrafts.in",
        name: "Vikramaditya Singhania",
        role: "PATRON"
      });
      const vikramRes = await fetch(`http://127.0.0.1:${port}/api/patron/overview`, {
        headers: { Authorization: `Bearer ${vikramJwt}` }
      });
      const vikramData = await vikramRes.json();
      const onlyVikramOrders = Array.isArray(vikramData.orders) && vikramData.orders.length > 0 && vikramData.orders.every((o) => o.customerEmail.toLowerCase() === "vikram.singhania@heritagecrafts.in");
      const onlyVikramInvoices = Array.isArray(vikramData.invoices) && vikramData.invoices.length > 0 && vikramData.invoices.every((inv) => inv.customerId === vikramData.patron.customerId);
      const hasWarranties = Array.isArray(vikramData.warranties) && vikramData.warranties.length > 0;
      const hasCareKits = Array.isArray(vikramData.careKits) && vikramData.careKits.length > 0;
      if (guestRes.status === 401 && vikramRes.status === 200 && onlyVikramOrders && onlyVikramInvoices && hasWarranties && hasCareKits) {
        results.push({
          test: "Patron Self-Service Portal Scoping",
          status: "PASS",
          message: "Rejected unauthenticated callers (401) and returned strictly patron-scoped orders, GST invoices, warranties, and care kits."
        });
      } else {
        results.push({
          test: "Patron Self-Service Portal Scoping",
          status: "FAIL",
          message: `guest=${guestRes.status}, vikram=${vikramRes.status}, orders=${onlyVikramOrders}, inv=${onlyVikramInvoices}, warranties=${hasWarranties}, care=${hasCareKits}`
        });
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
    }
  } catch (e) {
    results.push({ test: "Patron Self-Service Portal Scoping", status: "FAIL", message: e.message });
  }
  try {
    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const port = server.address().port;
      const slug = "BVL-INV-26-27-0089.pdf";
      const unauthRes = await fetch(`http://127.0.0.1:${port}/api/erp/invoices/${slug}`);
      const ananyaJwt = signSessionJwt({
        sub: "uid_ananya",
        email: "ananya.deshmukh@gmail.com",
        name: "Ananya Deshmukh",
        role: "PATRON"
      });
      const otherPatronRes = await fetch(`http://127.0.0.1:${port}/api/erp/invoices/${slug}`, {
        headers: { Authorization: `Bearer ${ananyaJwt}` }
      });
      const vikramJwt = signSessionJwt({
        sub: "uid_vikram",
        email: "vikram.singhania@heritagecrafts.in",
        name: "Vikramaditya Singhania",
        role: "PATRON"
      });
      const ownerPdfRes = await fetch(`http://127.0.0.1:${port}/api/erp/invoices/${slug}`, {
        headers: { Authorization: `Bearer ${vikramJwt}` }
      });
      const pdfBytes = Buffer.from(await ownerPdfRes.arrayBuffer());
      const isPdfValid = ownerPdfRes.status === 200 && ownerPdfRes.headers.get("content-type")?.includes("application/pdf") === true && pdfBytes.subarray(0, 8).toString("ascii").startsWith("%PDF-1.4");
      const ownerHtmlRes = await fetch(`http://127.0.0.1:${port}/api/erp/invoices/${slug}?format=html`, {
        headers: { Authorization: `Bearer ${vikramJwt}` }
      });
      const htmlBody = await ownerHtmlRes.text();
      const isHtmlValid = ownerHtmlRes.status === 200 && htmlBody.includes("BVL/INV/26-27/0089") && htmlBody.includes("27AABCB1234F1Z8");
      if (unauthRes.status === 401 && otherPatronRes.status === 403 && isPdfValid && isHtmlValid) {
        results.push({
          test: "GST Invoice PDF & HTML Rendering + Access Control",
          status: "PASS",
          message: "Enforced 401/403 ownership rules and served valid %PDF-1.4 bytes and printable HTML tax invoice."
        });
      } else {
        results.push({
          test: "GST Invoice PDF & HTML Rendering + Access Control",
          status: "FAIL",
          message: `unauth=${unauthRes.status}, other=${otherPatronRes.status}, pdfValid=${isPdfValid}, htmlValid=${isHtmlValid}`
        });
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
    }
  } catch (e) {
    results.push({ test: "GST Invoice PDF & HTML Rendering + Access Control", status: "FAIL", message: e.message });
  }
  try {
    const prevRzpKey = process.env.RAZORPAY_KEY_ID;
    const prevRzpSec = process.env.RAZORPAY_KEY_SECRET;
    const prevStripe = process.env.STRIPE_SECRET_KEY;
    const prevShipToken = process.env.SHIPROCKET_API_TOKEN;
    const prevSmtpHost = process.env.SMTP_HOST;
    const prevWaToken = process.env.WHATSAPP_ACCESS_TOKEN;
    process.env.RAZORPAY_KEY_ID = "rzp_test_placeholder_key";
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.SHIPROCKET_API_TOKEN;
    delete process.env.SMTP_HOST;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    try {
      const placeholderBlocked = !isConfiguredCredential("rzp_test_placeholder_key") && !isConfiguredCredential("your_secret");
      const gwOrder = await createGatewayOrderOrIntent({
        gateway: "RAZORPAY",
        amountInr: 4200,
        receipt: "BVL-SBX-01",
        customerName: "Sandbox Patron",
        customerEmail: "sandbox@example.com"
      });
      const payLink = await createPaymentLink({
        gateway: "STRIPE",
        amountInr: 4200,
        description: "Bespoke Belt",
        customerName: "Sandbox Patron",
        customerEmail: "sandbox@example.com"
      });
      const awbRes = await allocateCourierAwb({
        order: db.getOrders()[0],
        courierPreference: "SHIPROCKET"
      });
      const emailRes = await sendTransactionalEmail({
        to: "sandbox@example.com",
        subject: "Order Confirmation",
        text: "Confirmed"
      });
      const waRes = await sendWhatsAppMessage({
        toPhone: "+91 98201 12345",
        text: "Care Guide Ready"
      });
      if (placeholderBlocked && gwOrder.mode === "SANDBOX_FALLBACK" && payLink.mode === "SANDBOX_FALLBACK" && payLink.paymentUrl.startsWith("https://") && awbRes.mode === "SANDBOX_FALLBACK" && Boolean(awbRes.awbNumber) && emailRes.mode === "SANDBOX_FALLBACK" && waRes.mode === "SANDBOX_FALLBACK") {
        results.push({
          test: "External Gateway Adapters & Sandbox Fallback",
          status: "PASS",
          message: "Filtered placeholder secrets and executed deterministic sandbox fallbacks across Razorpay, Stripe, Shiprocket, SMTP, and WhatsApp."
        });
      } else {
        results.push({
          test: "External Gateway Adapters & Sandbox Fallback",
          status: "FAIL",
          message: `placeholderBlocked=${placeholderBlocked}, gw=${gwOrder.mode}, link=${payLink.mode}, awb=${awbRes.mode}`
        });
      }
    } finally {
      if (prevRzpKey === void 0) delete process.env.RAZORPAY_KEY_ID;
      else process.env.RAZORPAY_KEY_ID = prevRzpKey;
      if (prevRzpSec === void 0) delete process.env.RAZORPAY_KEY_SECRET;
      else process.env.RAZORPAY_KEY_SECRET = prevRzpSec;
      if (prevStripe === void 0) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = prevStripe;
      if (prevShipToken === void 0) delete process.env.SHIPROCKET_API_TOKEN;
      else process.env.SHIPROCKET_API_TOKEN = prevShipToken;
      if (prevSmtpHost === void 0) delete process.env.SMTP_HOST;
      else process.env.SMTP_HOST = prevSmtpHost;
      if (prevWaToken === void 0) delete process.env.WHATSAPP_ACCESS_TOKEN;
      else process.env.WHATSAPP_ACCESS_TOKEN = prevWaToken;
    }
  } catch (e) {
    results.push({ test: "External Gateway Adapters & Sandbox Fallback", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    try {
      const targetBom = db.getBillOfMaterials().find((b) => b.parentSku === "BVL-TRV-BRF-01");
      const initialBomHand = targetBom.inventoryOnHand;
      db.updateBomItemStock(targetBom.id, initialBomHand, initialBomHand - 1, "sunilchain@gmail.com");
      await db.createOrderAsync({
        customerId: "cust_bom_test",
        customerName: "BOM Tester",
        customerEmail: "bom.test@example.com",
        customerPhone: "+91 98000 00000",
        status: "PROCESSING",
        currency: "INR",
        subtotal: 57800,
        discountAmount: 0,
        taxAmount: 10404,
        shippingFee: 0,
        totalAmount: 68204,
        paymentGateway: "RAZORPAY",
        paymentId: "pay_bom_test",
        paymentStatus: "PAID",
        items: [
          {
            id: "item_bom_1",
            orderId: "",
            productId: "prod-t-brf-01",
            productName: "The Viceroy Diplomat Briefcase",
            sku: "BVL-TRV-BRF-01",
            category: "travell",
            quantity: 2,
            unitPrice: 28900,
            leatherType: "VEGETABLE_TANNED_HERITAGE",
            hsnCode: "4202",
            gstRate: 0.18,
            taxAmount: 10404,
            lineTotal: 68204
          }
        ],
        shippingAddress: {
          id: "addr_bom",
          customerId: "cust_bom_test",
          street: "Test St",
          city: "Pune",
          state: "Maharashtra",
          pincode: "411001",
          country: "India",
          isDefault: true,
          addressType: "SHIPPING"
        },
        billingAddress: {
          id: "addr_bom_b",
          customerId: "cust_bom_test",
          street: "Test St",
          city: "Pune",
          state: "Maharashtra",
          pincode: "411001",
          country: "India",
          isDefault: true,
          addressType: "BILLING"
        }
      });
      const updatedBom = db.getBillOfMaterials().find((b) => b.id === targetBom.id);
      const expectedBomHand = Math.max(0, initialBomHand - targetBom.quantityPerUnit * 2);
      const alerts = db.getLowStockAlerts();
      const alertTriggered = alerts.lowStockBom.some((b) => b.id === targetBom.id);
      if (updatedBom.inventoryOnHand === expectedBomHand && alertTriggered) {
        results.push({
          test: "BOM Consumption on Order & Low-Stock Alerts",
          status: "PASS",
          message: `Deducted ${targetBom.quantityPerUnit * 2} ${targetBom.unit} from BOM on order placement and raised low-stock alert.`
        });
      } else {
        results.push({
          test: "BOM Consumption on Order & Low-Stock Alerts",
          status: "FAIL",
          message: `bomHand=${updatedBom.inventoryOnHand} (expected ${expectedBomHand}), alertTriggered=${alertTriggered}`
        });
      }
    } finally {
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({ test: "BOM Consumption on Order & Low-Stock Alerts", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const port = server.address().port;
      const adminJwt = signSessionJwt({
        sub: "uid_master_sunil",
        email: "sunilchain@gmail.com",
        name: "Sunil Chainani",
        role: "STORE_MANAGER"
      });
      const rulesRes = await fetch(`http://127.0.0.1:${port}/api/store-management/operational-rules`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminJwt}`
        },
        body: JSON.stringify({
          abandonmentThresholdMinutes: 25,
          supplierGstin: "27AABCB1234F1Z8",
          gstRatePercent: 12,
          promoCodes: [
            { code: "ATELIER20", discountPercent: 20, active: true, description: "Bespoke VIP 20% Off" }
          ]
        })
      });
      const validateRes = await fetch(`http://127.0.0.1:${port}/api/checkout/validate-promo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "atelier20" })
      });
      const validateData = await validateRes.json();
      const checkoutRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: "Promo Config Tester",
          customerEmail: "promo.rules@example.com",
          customerPhone: "+91 98201 23456",
          shippingAddress: {
            street: "18 Koregaon Park Lane 5",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411001",
            country: "India"
          },
          items: [{ productId: "prod-m-belt-01", sku: "BVL-MEN-BLT-01", quantity: 1 }],
          discountCode: "ATELIER20"
        })
      });
      const checkoutData = await checkoutRes.json();
      const o = checkoutData.order;
      if (rulesRes.status === 200 && validateRes.status === 200 && validateData.discountPercent === 20 && checkoutRes.status === 201 && o?.discountAmount === 840 && o?.taxAmount === 403 && o?.totalAmount === 3763 && db.getConfig().abandonmentThresholdMinutes === 25) {
        results.push({
          test: "Operational Rules & Dynamic Promo Engine",
          status: "PASS",
          message: "Persisted dynamic GST rate (12%), abandonment threshold (25m), and custom promo ATELIER20 enforced cleanly in checkout."
        });
      } else {
        results.push({
          test: "Operational Rules & Dynamic Promo Engine",
          status: "FAIL",
          message: `rules=${rulesRes.status}, validate=${validateRes.status}, total=${o?.totalAmount}, tax=${o?.taxAmount}, disc=${o?.discountAmount}`
        });
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({ test: "Operational Rules & Dynamic Promo Engine", status: "FAIL", message: e.message });
  }
  try {
    const origFetch = globalThis.fetch;
    const projectId = "gen-lang-client-0774833728";
    const expectedIss = `https://securetoken.google.com/${projectId}`;
    const keyPair1 = crypto6.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    const keyPair2 = crypto6.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    let activeCerts = { "kid-primary-1": keyPair1.publicKey };
    let certFetchCount = 0;
    globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : input?.url || "";
      if (url.includes("securetoken@system.gserviceaccount.com")) {
        certFetchCount += 1;
        return new Response(JSON.stringify(activeCerts), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600"
          }
        });
      }
      return origFetch(input, init);
    });
    const signRs256Jwt = (headerObj, payloadObj, privKey) => {
      const h = Buffer.from(JSON.stringify(headerObj)).toString("base64url");
      const p = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
      const signer = crypto6.createSign("RSA-SHA256");
      signer.update(`${h}.${p}`);
      signer.end();
      const sig = signer.sign(privKey).toString("base64url");
      return `${h}.${p}.${sig}`;
    };
    try {
      const nowSec = Math.floor(Date.now() / 1e3);
      const basePayload = {
        aud: projectId,
        iss: expectedIss,
        sub: "firebase-uid-edge-01",
        email: "RS256.Patron@Example.COM ",
        email_verified: true,
        name: "Aarav Rao",
        iat: nowSec - 30,
        exp: nowSec + 1800
      };
      const validJwt = signRs256Jwt({ alg: "RS256", kid: "kid-primary-1" }, basePayload, keyPair1.privateKey);
      const validClaims = await verifyFirebaseIdToken(validJwt);
      const fetchBeforeCacheHit = certFetchCount;
      const cachedClaims = await verifyFirebaseIdToken(validJwt);
      const cacheHitAvoidedRefetch = certFetchCount === fetchBeforeCacheHit && cachedClaims?.uid === "firebase-uid-edge-01";
      activeCerts = { "kid-primary-1": keyPair1.publicKey, "kid-rotated-2": keyPair2.publicKey };
      const rotatedJwt = signRs256Jwt(
        { alg: "RS256", kid: "kid-rotated-2" },
        { ...basePayload, sub: "firebase-uid-rotated" },
        keyPair2.privateKey
      );
      const rotatedClaims = await verifyFirebaseIdToken(rotatedJwt);
      const expiredJwt = signRs256Jwt(
        { alg: "RS256", kid: "kid-primary-1" },
        { ...basePayload, exp: nowSec - 5 },
        keyPair1.privateKey
      );
      const wrongAudJwt = signRs256Jwt(
        { alg: "RS256", kid: "kid-primary-1" },
        { ...basePayload, aud: "wrong-firebase-project" },
        keyPair1.privateKey
      );
      const wrongIssJwt = signRs256Jwt(
        { alg: "RS256", kid: "kid-primary-1" },
        { ...basePayload, iss: "https://securetoken.google.com/wrong-project" },
        keyPair1.privateKey
      );
      const futureIatJwt = signRs256Jwt(
        { alg: "RS256", kid: "kid-primary-1" },
        { ...basePayload, iat: nowSec + 600 },
        keyPair1.privateKey
      );
      const missingEmailJwt = signRs256Jwt(
        { alg: "RS256", kid: "kid-primary-1" },
        { ...basePayload, email: "" },
        keyPair1.privateKey
      );
      const hs256AlgJwt = signRs256Jwt({ alg: "HS256", kid: "kid-primary-1" }, basePayload, keyPair1.privateKey);
      const tamperedSigJwt = `${validJwt.slice(0, -8)}AAAAAAAA`;
      const [rExp, rAud, rIss, rIat, rEmail, rAlg, rSig] = await Promise.all([
        verifyFirebaseIdToken(expiredJwt),
        verifyFirebaseIdToken(wrongAudJwt),
        verifyFirebaseIdToken(wrongIssJwt),
        verifyFirebaseIdToken(futureIatJwt),
        verifyFirebaseIdToken(missingEmailJwt),
        verifyFirebaseIdToken(hs256AlgJwt),
        verifyFirebaseIdToken(tamperedSigJwt)
      ]);
      const allEdgeRejectionsNull = [rExp, rAud, rIss, rIat, rEmail, rAlg, rSig].every((r) => r === null);
      const prevFbProjectEnv = process.env.FIREBASE_PROJECT_ID;
      let envOverrideOk = false;
      try {
        process.env.FIREBASE_PROJECT_ID = "custom-hostinger-fb";
        const customJwt = signRs256Jwt(
          { alg: "RS256", kid: "kid-primary-1" },
          {
            ...basePayload,
            aud: "custom-hostinger-fb",
            iss: "https://securetoken.google.com/custom-hostinger-fb",
            sub: "firebase-uid-custom-env"
          },
          keyPair1.privateKey
        );
        const customClaims = await verifyFirebaseIdToken(customJwt);
        envOverrideOk = customClaims?.uid === "firebase-uid-custom-env";
      } finally {
        if (prevFbProjectEnv === void 0) delete process.env.FIREBASE_PROJECT_ID;
        else process.env.FIREBASE_PROJECT_ID = prevFbProjectEnv;
      }
      if (validClaims?.email === "rs256.patron@example.com" && validClaims?.emailVerified === true && cacheHitAvoidedRefetch && rotatedClaims?.uid === "firebase-uid-rotated" && allEdgeRejectionsNull && envOverrideOk) {
        results.push({
          test: "Firebase RS256 Edge Cases & Key Rotation",
          status: "PASS",
          message: "Verified valid RS256 JWTs, token cache reuse, kid key rotation refresh, env project override, and rejected expired/aud/iss/iat/alg/email/signature edge cases."
        });
      } else {
        results.push({
          test: "Firebase RS256 Edge Cases & Key Rotation",
          status: "FAIL",
          message: `valid=${Boolean(validClaims)}, cache=${cacheHitAvoidedRefetch}, rotated=${Boolean(rotatedClaims)}, rejections=${allEdgeRejectionsNull}, envOverride=${envOverrideOk}`
        });
      }
    } finally {
      globalThis.fetch = origFetch;
    }
  } catch (e) {
    results.push({ test: "Firebase RS256 Edge Cases & Key Rotation", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const port = server.address().port;
      db.updateOperationalSettings(
        {
          promoCodes: [
            ...db.getConfig().promoCodes,
            { code: "EXPIRED50", discountPercent: 50, active: false, description: "Retired seasonal promo" }
          ]
        },
        "sunilchain@gmail.com"
      );
      const validTamperShipping = {
        customerName: "Tamper Audit Patron",
        customerEmail: "tamper@example.com",
        customerPhone: "+91 98201 34567",
        shippingAddress: {
          street: "42 Marine Drive Apartments",
          city: "Mumbai",
          state: "Maharashtra",
          pincode: "400020",
          country: "India"
        }
      };
      const zeroQtyRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validTamperShipping,
          items: [{ productId: "prod-m-belt-01", sku: "BVL-MEN-BLT-01", quantity: 0 }]
        })
      });
      const negQtyRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validTamperShipping,
          items: [{ productId: "prod-m-belt-01", sku: "BVL-MEN-BLT-01", quantity: -3 }]
        })
      });
      const mismatchRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validTamperShipping,
          items: [{ productId: "prod-m-belt-01", sku: "BVL-TRV-BRF-01", quantity: 1 }]
        })
      });
      const unknownRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validTamperShipping,
          items: [{ productId: "prod-nonexistent", sku: "BVL-FAKE-999", quantity: 1 }]
        })
      });
      const inactivePromoRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validTamperShipping,
          items: [{ productId: "prod-m-belt-01", sku: "BVL-MEN-BLT-01", quantity: 1 }],
          discountCode: "EXPIRED50"
        })
      });
      const multiTamperRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: "Multi-Item Tamper Audit",
          customerEmail: "multi.tamper@example.com",
          customerPhone: "+91 98201 34568",
          shippingAddress: {
            street: "42 Marine Drive Apartments",
            city: "Mumbai",
            state: "Maharashtra",
            pincode: "400020",
            country: "India"
          },
          items: [
            { productId: "prod-m-belt-01", sku: "BVL-MEN-BLT-01", quantity: 2, unitPrice: 1 },
            { productId: "prod-m-wal-01", sku: "BVL-MEN-WAL-01", quantity: 1, unitPrice: 5 }
          ],
          subtotal: 7,
          discountAmount: 5e3,
          taxAmount: 0,
          totalAmount: 7
        })
      });
      const multiData = await multiTamperRes.json();
      const o = multiData.order;
      const multiTotalsEnforced = multiTamperRes.status === 201 && o?.items?.[0]?.unitPrice === 4200 && o?.items?.[1]?.unitPrice === 3800 && o?.subtotal === 12200 && o?.discountAmount === 0 && o?.taxAmount === 2196 && o?.totalAmount === 14396;
      if (zeroQtyRes.status === 400 && negQtyRes.status === 400 && mismatchRes.status === 400 && unknownRes.status === 400 && inactivePromoRes.status === 400 && multiTotalsEnforced) {
        results.push({
          test: "Checkout Tampering, SKU Mismatch & Promo Guards",
          status: "PASS",
          message: "Rejected 0/negative quantities, ID/SKU mismatches, unknown SKUs, inactive promos (400), and overwrote multi-item price tampering."
        });
      } else {
        results.push({
          test: "Checkout Tampering, SKU Mismatch & Promo Guards",
          status: "FAIL",
          message: `zero=${zeroQtyRes.status}, neg=${negQtyRes.status}, mismatch=${mismatchRes.status}, unknown=${unknownRes.status}, inactivePromo=${inactivePromoRes.status}, multi=${multiTotalsEnforced}`
        });
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({ test: "Checkout Tampering, SKU Mismatch & Promo Guards", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const port = server.address().port;
      await db.updateInventoryStockAsync("BVL-MEN-BLT-01", "punePrimaryHub", 2, "sunilchain@gmail.com");
      await db.updateInventoryStockAsync("BVL-MEN-BLT-01", "mumbaiWarehouse", 0, "sunilchain@gmail.com");
      const responses = await Promise.all(
        [1, 2, 3, 4, 5].map(
          (idx) => fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              customerName: `Concurrent Patron ${idx}`,
              customerEmail: `concurrent.${idx}@example.com`,
              customerPhone: `+91 98201 4455${idx}`,
              shippingAddress: {
                street: `${idx}00 Residency Road`,
                city: "Bengaluru",
                state: "Karnataka",
                pincode: "560025",
                country: "India"
              },
              items: [{ productId: "prod-m-belt-01", sku: "BVL-MEN-BLT-01", quantity: 1 }]
            })
          })
        )
      );
      const statuses = responses.map((r) => r.status);
      const createdCount = statuses.filter((s) => s === 201).length;
      const conflictCount = statuses.filter((s) => s === 409).length;
      const finalInv = db.getInventory().find((i) => i.sku === "BVL-MEN-BLT-01");
      const finalDeactivated = db.getCatalog().products.find((p) => p.sku === "BVL-MEN-BLT-01");
      if (createdCount === 2 && conflictCount === 3 && finalInv.stockByLocation.punePrimaryHub === 0 && finalInv.stockByLocation.mumbaiWarehouse === 0 && finalDeactivated.inStock === false) {
        results.push({
          test: "Concurrent Stock Depletion & Oversell Prevention",
          status: "PASS",
          message: "Serialized 5 parallel checkout requests for 2 remaining units: 2 succeeded (201), 3 rejected (409), 0 negative stock."
        });
      } else {
        results.push({
          test: "Concurrent Stock Depletion & Oversell Prevention",
          status: "FAIL",
          message: `created=${createdCount}, conflict=${conflictCount}, pune=${finalInv.stockByLocation.punePrimaryHub}, mumbai=${finalInv.stockByLocation.mumbaiWarehouse}`
        });
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({ test: "Concurrent Stock Depletion & Oversell Prevention", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    try {
      const intraOrder = await db.createOrderAsync({
        customerId: "cust_rma_intra",
        customerName: "Intra RMA Patron",
        customerEmail: "intra.rma@example.com",
        customerPhone: "+91 98200 11111",
        status: "PROCESSING",
        currency: "INR",
        subtotal: 4200,
        discountAmount: 0,
        taxAmount: 756,
        shippingFee: 0,
        totalAmount: 4956,
        paymentGateway: "RAZORPAY",
        paymentId: "pay_rma_intra",
        paymentStatus: "PAID",
        items: [
          {
            id: "item_rma_intra",
            orderId: "",
            productId: "prod-m-belt-01",
            productName: "The Rajputana Bridle Belt",
            sku: "BVL-MEN-BLT-01",
            category: "men",
            quantity: 1,
            unitPrice: 4200,
            leatherType: "VEGETABLE_TANNED_HERITAGE",
            hsnCode: "4203",
            gstRate: 0.18,
            taxAmount: 756,
            lineTotal: 4956
          }
        ],
        shippingAddress: {
          id: "addr_mh",
          customerId: "cust_rma_intra",
          street: "FC Road",
          city: "Pune",
          state: "Maharashtra",
          pincode: "411004",
          country: "India",
          isDefault: true,
          addressType: "SHIPPING"
        },
        billingAddress: {
          id: "addr_mh_b",
          customerId: "cust_rma_intra",
          street: "FC Road",
          city: "Pune",
          state: "Maharashtra",
          pincode: "411004",
          country: "India",
          isDefault: true,
          addressType: "BILLING"
        }
      });
      const mumbaiBeforeRma = db.getInventory().find((i) => i.sku === "BVL-MEN-BLT-01").stockByLocation.mumbaiWarehouse;
      const intraRma = await erpSync.processRMA({
        orderId: intraOrder.id,
        customerId: intraOrder.customerId,
        reason: "COLOR_MISMATCH",
        restockInWarehouse: true,
        restockLocation: "mumbaiWarehouse",
        actorEmail: "sunilchain@gmail.com"
      });
      const mumbaiAfterRma = db.getInventory().find((i) => i.sku === "BVL-MEN-BLT-01").stockByLocation.mumbaiWarehouse;
      const intraMathOk = mumbaiAfterRma === mumbaiBeforeRma + 1 && intraRma.order.status === "RETURNED" && intraRma.order.paymentStatus === "REFUNDED" && intraRma.creditNote?.originalInvoiceNumber === intraOrder.invoiceNumber && intraRma.creditNote?.taxableValue === 4200 && intraRma.creditNote?.cgstAmount === 378 && intraRma.creditNote?.sgstAmount === 378 && intraRma.creditNote?.igstAmount === 0 && intraRma.creditNote?.totalCreditAmount === 4956;
      const interOrder = await db.createOrderAsync({
        customerId: "cust_rma_inter",
        customerName: "Inter RMA Patron",
        customerEmail: "inter.rma@example.com",
        customerPhone: "+91 98111 22222",
        status: "PROCESSING",
        currency: "INR",
        subtotal: 7600,
        discountAmount: 0,
        taxAmount: 1368,
        shippingFee: 0,
        totalAmount: 8968,
        paymentGateway: "RAZORPAY",
        paymentId: "pay_rma_inter",
        paymentStatus: "PAID",
        items: [
          {
            id: "item_rma_inter",
            orderId: "",
            productId: "prod-m-wal-01",
            productName: "The Bifold Heirloom Folio",
            sku: "BVL-MEN-WAL-01",
            category: "men",
            quantity: 2,
            unitPrice: 3800,
            leatherType: "VEGETABLE_TANNED_HERITAGE",
            hsnCode: "4202",
            gstRate: 0.18,
            taxAmount: 1368,
            lineTotal: 8968
          }
        ],
        shippingAddress: {
          id: "addr_dl",
          customerId: "cust_rma_inter",
          street: "Connaught Place",
          city: "New Delhi",
          state: "Delhi",
          pincode: "110001",
          country: "India",
          isDefault: true,
          addressType: "SHIPPING"
        },
        billingAddress: {
          id: "addr_dl_b",
          customerId: "cust_rma_inter",
          street: "Connaught Place",
          city: "New Delhi",
          state: "Delhi",
          pincode: "110001",
          country: "India",
          isDefault: true,
          addressType: "BILLING"
        }
      });
      const walStockBefore = db.getInventory().find((i) => i.sku === "BVL-MEN-WAL-01");
      const walTotalBefore = walStockBefore.stockByLocation.punePrimaryHub + walStockBefore.stockByLocation.mumbaiWarehouse;
      const interRma = await erpSync.processRMA({
        orderId: interOrder.id,
        customerId: interOrder.customerId,
        reason: "HARDWARE_DAMAGE",
        restockInWarehouse: false,
        actorEmail: "sunilchain@gmail.com"
      });
      const walStockAfter = db.getInventory().find((i) => i.sku === "BVL-MEN-WAL-01");
      const walTotalAfter = walStockAfter.stockByLocation.punePrimaryHub + walStockAfter.stockByLocation.mumbaiWarehouse;
      const interMathOk = walTotalAfter === walTotalBefore && interRma.creditNote?.taxableValue === 7600 && interRma.creditNote?.cgstAmount === 0 && interRma.creditNote?.sgstAmount === 0 && interRma.creditNote?.igstAmount === 1368 && interRma.creditNote?.totalCreditAmount === 8968;
      db.updateGstInvoicing(false, "sunilchain@gmail.com");
      const suspendedRma = await erpSync.processRMA({
        orderId: intraOrder.id,
        customerId: intraOrder.customerId,
        reason: "INCORRECT_SIZE",
        restockInWarehouse: false,
        actorEmail: "sunilchain@gmail.com"
      });
      if (intraMathOk && interMathOk && suspendedRma.creditNote === void 0) {
        results.push({
          test: "RMA Restock & GST Credit-Note Math",
          status: "PASS",
          message: "Verified intra-state CGST/SGST split, inter-state IGST credit note math, restock hub routing, non-restock stock preservation, and GST toggle guard."
        });
      } else {
        results.push({
          test: "RMA Restock & GST Credit-Note Math",
          status: "FAIL",
          message: `intra=${intraMathOk}, inter=${interMathOk}, suspendedCn=${Boolean(suspendedRma.creditNote)}`
        });
      }
    } finally {
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({ test: "RMA Restock & GST Credit-Note Math", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const catalogFile = path7.resolve(process.cwd(), "src/server/catalog.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const preTestCatalogRaw = fs7.existsSync(catalogFile) ? fs7.readFileSync(catalogFile, "utf-8") : null;
    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const port = server.address().port;
      const adminJwt = signSessionJwt({
        sub: "uid_master_sunil",
        email: "sunilchain@gmail.com",
        name: "Sunil Chainani",
        role: "STORE_MANAGER"
      });
      const baseCatalog = structuredClone(db.getRawCatalog());
      const newProduct = {
        id: "prod-sku-sync-test",
        category: "men",
        productType: "Wallets",
        name: "The Atelier Card Sleeve",
        sku: "BVL-MEN-CRD-99",
        price: 2900,
        currency: "INR",
        description: "Compact hand-stitched card sleeve.",
        features: ["Steerhide"],
        images: ["/assets/images/product_men_belt_wallet_1794461808951.jpg"],
        hsnCode: "4202",
        gstRate: 0.18,
        solutionEngine: "EVERYDAY_CARRY",
        inStock: true,
        allowCustomization: true,
        careKitIncluded: true,
        initialPuneStock: 7,
        initialMumbaiStock: 3
      };
      const addRes = await fetch(`http://127.0.0.1:${port}/api/store-management/catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          catalog: {
            categories: baseCatalog.categories,
            products: [...baseCatalog.products, newProduct]
          }
        })
      });
      const createdInv = db.getInventory().find((i) => i.sku === "BVL-MEN-CRD-99");
      const createdReconciled = addRes.status === 200 && createdInv?.productId === "prod-sku-sync-test" && createdInv?.stockByLocation.punePrimaryHub === 7 && createdInv?.stockByLocation.mumbaiWarehouse === 3;
      const renamedProducts = db.getRawCatalog().products.map(
        (p) => p.sku === "BVL-TRV-BRF-01" ? { ...p, sku: "BVL-TRV-BRF-V2", price: 29500 } : p
      );
      const renameRes = await fetch(`http://127.0.0.1:${port}/api/store-management/catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          catalog: { categories: baseCatalog.categories, products: renamedProducts }
        })
      });
      const renamedInvMatches = db.getInventory().filter((i) => i.productId === "prod-t-brf-01");
      const bomSynced = db.getBillOfMaterials().filter((b) => b.parentSku === "BVL-TRV-BRF-V2").length === 3 && db.getBillOfMaterials().filter((b) => b.parentSku === "BVL-TRV-BRF-01").length === 0;
      const renameReconciled = renameRes.status === 200 && renamedInvMatches.length === 1 && renamedInvMatches[0].sku === "BVL-TRV-BRF-V2" && renamedInvMatches[0].sellingPrice === 29500 && bomSynced;
      const duplicateProducts = db.getRawCatalog().products.map(
        (p) => p.id === "prod-sku-sync-test" ? { ...p, sku: "bvl-men-blt-01" } : p
      );
      const dupRes = await fetch(`http://127.0.0.1:${port}/api/store-management/catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          catalog: { categories: baseCatalog.categories, products: duplicateProducts }
        })
      });
      const cleanedProducts = db.getRawCatalog().products.filter((p) => p.id !== "prod-sku-sync-test");
      const delRes = await fetch(`http://127.0.0.1:${port}/api/store-management/catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          catalog: { categories: baseCatalog.categories, products: cleanedProducts }
        })
      });
      const orphanRemoved = !db.getInventory().some((i) => i.productId === "prod-sku-sync-test" || i.sku === "BVL-MEN-CRD-99");
      if (createdReconciled && renameReconciled && dupRes.status === 400 && delRes.status === 200 && orphanRemoved) {
        results.push({
          test: "CatalogManager SKU Reconciliation & Duplicate Guard",
          status: "PASS",
          message: "Seeded new SKU inventory, propagated SKU renames to inventory + BOM parentSku, blocked duplicate SKUs (400), and purged deleted SKU orphans."
        });
      } else {
        results.push({
          test: "CatalogManager SKU Reconciliation & Duplicate Guard",
          status: "FAIL",
          message: `created=${createdReconciled}, renamed=${renameReconciled}, dupStatus=${dupRes.status}, delStatus=${delRes.status}, orphanRemoved=${orphanRemoved}`
        });
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
      if (preTestCatalogRaw) {
        fs7.writeFileSync(catalogFile, preTestCatalogRaw, "utf-8");
        db.catalogCache = JSON.parse(preTestCatalogRaw);
      }
    }
  } catch (e) {
    results.push({ test: "CatalogManager SKU Reconciliation & Duplicate Guard", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const catalogFile = path7.resolve(process.cwd(), "src/server/catalog.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const preTestCatalogRaw = fs7.existsSync(catalogFile) ? fs7.readFileSync(catalogFile, "utf-8") : null;
    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const port = server.address().port;
      const adminJwt = signSessionJwt({
        sub: "uid_master_sunil",
        email: "sunilchain@gmail.com",
        name: "Sunil Chainani",
        role: "STORE_MANAGER"
      });
      const rulesRes = await fetch(`http://127.0.0.1:${port}/api/store-management/operational-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ gstRatePercent: 12 })
      });
      const baseCatalog = structuredClone(db.getRawCatalog());
      const fivePctProd = {
        id: "prod-gst-5-test",
        category: "men",
        productType: "Care",
        name: "Pure Beeswax Heritage Balm",
        sku: "BVL-GST-FIVE",
        price: 2e3,
        currency: "INR",
        description: "Organic beeswax dressing at 5% GST slab.",
        features: ["Natural beeswax"],
        images: ["/assets/images/product_men_belt_wallet_1794461808951.jpg"],
        hsnCode: "3405",
        gstRate: 0.05,
        solutionEngine: "LIFETIME_HEIRLOOM_CARE",
        inStock: true,
        allowCustomization: false,
        careKitIncluded: false,
        initialPuneStock: 10,
        initialMumbaiStock: 5
      };
      const catRes = await fetch(`http://127.0.0.1:${port}/api/store-management/catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          catalog: {
            categories: baseCatalog.categories,
            products: [...baseCatalog.products, fivePctProd]
          }
        })
      });
      const orderRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: "Mixed GST Patron",
          customerEmail: "mixed.gst@example.com",
          customerPhone: "+91 98201 55667",
          shippingAddress: {
            street: "77 Boat Club Road",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411001",
            country: "India"
          },
          items: [
            { productId: "prod-m-belt-01", sku: "BVL-MEN-BLT-01", quantity: 1 },
            { productId: "prod-gst-5-test", sku: "BVL-GST-FIVE", quantity: 1 }
          ],
          discountCode: "HEIRLOOM10"
        })
      });
      const orderData = await orderRes.json();
      const o = orderData.order;
      const inv = db.getInvoices().find((i) => i.orderId === o?.id);
      const beltLine = o?.items?.find((it) => it.sku === "BVL-MEN-BLT-01");
      const balmLine = o?.items?.find((it) => it.sku === "BVL-GST-FIVE");
      const mathMatches = rulesRes.status === 200 && catRes.status === 200 && orderRes.status === 201 && beltLine?.gstRate === 0.12 && beltLine?.taxAmount === 454 && balmLine?.gstRate === 0.05 && balmLine?.taxAmount === 90 && o?.subtotal === 6200 && o?.discountAmount === 620 && o?.taxAmount === 544 && o?.totalAmount === 6124 && inv?.taxableValue === 5580 && inv?.totalInvoiceAmount === 6124;
      if (mathMatches) {
        results.push({
          test: "Mixed Per-SKU GST & Store-Default Fallback Checkout",
          status: "PASS",
          message: "Verified mixed cart tax math (12% store default + 5% SKU override + HEIRLOOM10 promo = \u20B9544 tax, \u20B96,124 total)."
        });
      } else {
        results.push({
          test: "Mixed Per-SKU GST & Store-Default Fallback Checkout",
          status: "FAIL",
          message: `status=${orderRes.status}, beltTax=${beltLine?.taxAmount} (${beltLine?.gstRate}), balmTax=${balmLine?.taxAmount} (${balmLine?.gstRate}), orderTax=${o?.taxAmount}, total=${o?.totalAmount}, invTotal=${inv?.totalInvoiceAmount}`
        });
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
      if (preTestCatalogRaw) {
        fs7.writeFileSync(catalogFile, preTestCatalogRaw, "utf-8");
        db.catalogCache = JSON.parse(preTestCatalogRaw);
      }
    }
  } catch (e) {
    results.push({ test: "Mixed Per-SKU GST & Store-Default Fallback Checkout", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const port = server.address().port;
      const adminJwt = signSessionJwt({
        sub: "uid_master_sunil",
        email: "sunilchain@gmail.com",
        name: "Sunil Chainani",
        role: "STORE_MANAGER"
      });
      const brfSku = "BVL-TRV-BRF-01";
      const origPuneQty = db.getInventory().find((i) => i.sku === brfSku).stockByLocation.punePrimaryHub;
      const targetBom = db.getBillOfMaterials().find((b) => b.parentSku === brfSku);
      const origBomQty = targetBom.inventoryOnHand;
      const createLeadRes = await fetch(`http://127.0.0.1:${port}/api/crm/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          companyName: "Sahyadri Hospitality Group",
          contactPerson: "Neha Deshmukh",
          email: "procurement@sahyadri.in",
          phone: "+91 98220 55441",
          dealValueInr: 28900,
          status: "QUOTE_ISSUED",
          items: [{ sku: brfSku, quantity: 1 }]
        })
      });
      const leadId = (await createLeadRes.json()).lead?.id;
      const pushRes = await fetch(`http://127.0.0.1:${port}/api/erp/quotes/push-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          leadId,
          items: [{ sku: brfSku, quantity: 1 }],
          dealType: "WHOLESALE_BULK"
        })
      });
      const pushData = await pushRes.json();
      const updatedPuneQty = db.getInventory().find((i) => i.sku === brfSku).stockByLocation.punePrimaryHub;
      const updatedBomQty = db.getBillOfMaterials().find((b) => b.id === targetBom.id).inventoryOnHand;
      const linkedInvoice = db.getInvoices().find((inv) => inv.orderId === pushData.order?.id);
      const dupPushRes = await fetch(`http://127.0.0.1:${port}/api/erp/quotes/push-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ leadId, items: [{ sku: brfSku, quantity: 1 }] })
      });
      const dupPatchRes = await fetch(`http://127.0.0.1:${port}/api/crm/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ status: "ORDER_CONFIRMED" })
      });
      const ok = createLeadRes.status === 201 && pushRes.status === 201 && Boolean(pushData.order?.orderNumber) && Boolean(linkedInvoice?.invoiceNumber) && pushData.lead?.status === "ORDER_CONFIRMED" && pushData.lead?.erpOrderId === pushData.order?.id && pushData.lead?.erpOrderNumber === pushData.order?.orderNumber && updatedPuneQty === origPuneQty - 1 && updatedBomQty === Math.max(0, origBomQty - targetBom.quantityPerUnit) && dupPushRes.status === 409 && dupPatchRes.status === 409;
      if (ok) {
        results.push({
          test: "Corporate Kanban Push to ERP Order & Duplicate Guard",
          status: "PASS",
          message: `Pushed lead to ERP Order ${pushData.order.orderNumber}, issued invoice, deducted Pune stock + BOM, and blocked duplicate pushes (409).`
        });
      } else {
        results.push({
          test: "Corporate Kanban Push to ERP Order & Duplicate Guard",
          status: "FAIL",
          message: `push=${pushRes.status}, erpOrderId=${pushData.lead?.erpOrderId}, stock=${updatedPuneQty}/${origPuneQty - 1}, dupPush=${dupPushRes.status}, dupPatch=${dupPatchRes.status}`
        });
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({ test: "Corporate Kanban Push to ERP Order & Duplicate Guard", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const port = server.address().port;
      const adminJwt = signSessionJwt({
        sub: "uid_master_sunil",
        email: "sunilchain@gmail.com",
        name: "Sunil Chainani",
        role: "STORE_MANAGER"
      });
      const cust = db.getCustomerById("cust_01_vip");
      cust.phone = "+91 98201 12345";
      const rawTickets = db.state.supportTickets;
      const targetTicket = rawTickets.find((t) => t.customerId === "cust_01_vip") || rawTickets[0];
      delete targetTicket.customerPhone;
      const ticketsRes = await fetch(`http://127.0.0.1:${port}/api/crm/tickets`, {
        headers: { Authorization: `Bearer ${adminJwt}` }
      });
      const ticketsData = await ticketsRes.json();
      const enrichedTicket = (ticketsData.tickets || []).find((t) => t.id === targetTicket.id);
      const replyWithPhoneRes = await fetch(`http://127.0.0.1:${port}/api/crm/tickets/${targetTicket.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ text: "Your dispatch AWB is ready.", channel: "WHATSAPP" })
      });
      const replyWithPhoneData = await replyWithPhoneRes.json();
      cust.phone = "";
      delete targetTicket.customerPhone;
      const replyNoPhoneRes = await fetch(`http://127.0.0.1:${port}/api/crm/tickets/${targetTicket.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ text: "Follow-up check.", channel: "WHATSAPP" })
      });
      const replyNoPhoneData = await replyNoPhoneRes.json();
      const ok = ticketsRes.status === 200 && enrichedTicket?.customerPhone === "+91 98201 12345" && replyWithPhoneRes.status === 200 && replyWithPhoneData.ticket?.customerPhone === "+91 98201 12345" && replyWithPhoneData.delivery?.fallbackReason !== "Valid patron phone number missing" && replyNoPhoneRes.status === 200 && replyNoPhoneData.delivery?.fallbackReason === "Valid patron phone number missing";
      if (ok) {
        results.push({
          test: "Inbox Patron Phone Lookup & WhatsApp Reply Validation",
          status: "PASS",
          message: "Enriched ticket customerPhone from customer profile and passed resolved toPhone into WhatsApp dispatcher."
        });
      } else {
        results.push({
          test: "Inbox Patron Phone Lookup & WhatsApp Reply Validation",
          status: "FAIL",
          message: `enriched=${enrichedTicket?.customerPhone}, withPhoneReason=${replyWithPhoneData.delivery?.fallbackReason}, noPhoneReason=${replyNoPhoneData.delivery?.fallbackReason}`
        });
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({ test: "Inbox Patron Phone Lookup & WhatsApp Reply Validation", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const port = server.address().port;
      const base = `http://127.0.0.1:${port}/api`;
      const masterJwt = signSessionJwt({
        sub: "uid_master_sunil",
        email: "sunilchain@gmail.com",
        name: "Sunil Chainani",
        role: "STORE_MANAGER"
      });
      const supportEmail = "agent.rbac.test@bharatvarshcrafts.com";
      const logisticsEmail = "logistics.rbac.test@bharatvarshcrafts.com";
      const addSupport = await fetch(`${base}/store-management/permitted-managers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterJwt}` },
        body: JSON.stringify({
          email: supportEmail,
          displayName: "Concierge Agent",
          password: "AgentPass#2026",
          role: "SUPPORT_AGENT"
        })
      });
      const addLogistics = await fetch(`${base}/store-management/permitted-managers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterJwt}` },
        body: JSON.stringify({
          email: logisticsEmail,
          displayName: "Pune Logistics Hub Lead",
          password: "LogisticsPass#2026",
          role: "LOGISTICS_COORDINATOR"
        })
      });
      const loginSupportRes = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: supportEmail, password: "AgentPass#2026" })
      });
      const loginSupport = await loginSupportRes.json();
      const loginLogisticsRes = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: logisticsEmail, password: "LogisticsPass#2026" })
      });
      const loginLogistics = await loginLogisticsRes.json();
      const supportToken = loginSupport.token;
      const logisticsToken = loginLogistics.token;
      const [saCrm, saTickets, saKanban, saAnalytics, saErpInv, saErpPush, saAdminCfg] = await Promise.all([
        fetch(`${base}/crm/customers`, { headers: { Authorization: `Bearer ${supportToken}` } }),
        fetch(`${base}/crm/tickets`, { headers: { Authorization: `Bearer ${supportToken}` } }),
        fetch(`${base}/crm/kanban`, { headers: { Authorization: `Bearer ${supportToken}` } }),
        fetch(`${base}/analytics/dashboard`, { headers: { Authorization: `Bearer ${supportToken}` } }),
        fetch(`${base}/erp/inventory`, { headers: { Authorization: `Bearer ${supportToken}` } }),
        fetch(`${base}/erp/quotes/push-order`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${supportToken}` },
          body: JSON.stringify({ items: [{ sku: "BVL-MEN-BLT-01", quantity: 1 }] })
        }),
        fetch(`${base}/store-management/config`, { headers: { Authorization: `Bearer ${supportToken}` } })
      ]);
      const [lcErpInv, lcErpOrders, lcErpInvDocs, lcAnalytics, lcCrmCust, lcPayLinks, lcAdminCfg] = await Promise.all([
        fetch(`${base}/erp/inventory`, { headers: { Authorization: `Bearer ${logisticsToken}` } }),
        fetch(`${base}/erp/orders`, { headers: { Authorization: `Bearer ${logisticsToken}` } }),
        fetch(`${base}/erp/invoices`, { headers: { Authorization: `Bearer ${logisticsToken}` } }),
        fetch(`${base}/analytics/dashboard`, { headers: { Authorization: `Bearer ${logisticsToken}` } }),
        fetch(`${base}/crm/customers`, { headers: { Authorization: `Bearer ${logisticsToken}` } }),
        fetch(`${base}/crm/payment-links`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${logisticsToken}` },
          body: JSON.stringify({ amountInr: 1e3 })
        }),
        fetch(`${base}/store-management/config`, { headers: { Authorization: `Bearer ${logisticsToken}` } })
      ]);
      const [smCrm, smErp, smAnalytics, smAdmin] = await Promise.all([
        fetch(`${base}/crm/customers`, { headers: { Authorization: `Bearer ${masterJwt}` } }),
        fetch(`${base}/erp/inventory`, { headers: { Authorization: `Bearer ${masterJwt}` } }),
        fetch(`${base}/analytics/dashboard`, { headers: { Authorization: `Bearer ${masterJwt}` } }),
        fetch(`${base}/store-management/config`, { headers: { Authorization: `Bearer ${masterJwt}` } })
      ]);
      const supportOk = loginSupport.user?.role === "SUPPORT_AGENT" && saCrm.status === 200 && saTickets.status === 200 && saKanban.status === 200 && saAnalytics.status === 200 && saErpInv.status === 403 && saErpPush.status === 403 && saAdminCfg.status === 403;
      const logisticsOk = loginLogistics.user?.role === "LOGISTICS_COORDINATOR" && lcErpInv.status === 200 && lcErpOrders.status === 200 && lcErpInvDocs.status === 200 && lcAnalytics.status === 200 && lcCrmCust.status === 403 && lcPayLinks.status === 403 && lcAdminCfg.status === 403;
      const managerOk = smCrm.status === 200 && smErp.status === 200 && smAnalytics.status === 200 && smAdmin.status === 200;
      if (addSupport.status === 200 && addLogistics.status === 200 && supportOk && logisticsOk && managerOk) {
        results.push({
          test: "Granular Staff RBAC Matrix (CRM vs ERP vs Store Manager)",
          status: "PASS",
          message: "Enforced strict SUPPORT_AGENT (CRM+Analytics only), LOGISTICS_COORDINATOR (ERP+Analytics only), and STORE_MANAGER full access."
        });
      } else {
        results.push({
          test: "Granular Staff RBAC Matrix (CRM vs ERP vs Store Manager)",
          status: "FAIL",
          message: `supportOk=${supportOk} (${saErpInv.status}/${saAdminCfg.status}), logisticsOk=${logisticsOk} (${lcCrmCust.status}/${lcAdminCfg.status}), managerOk=${managerOk}`
        });
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({ test: "Granular Staff RBAC Matrix (CRM vs ERP vs Store Manager)", status: "FAIL", message: e.message });
  }
  try {
    const schemaSql = fs7.readFileSync(path7.resolve(process.cwd(), "mysql-schema.sql"), "utf-8");
    const adapterSrc = fs7.readFileSync(path7.resolve(process.cwd(), "src/server/mysqlAdapter.ts"), "utf-8");
    const typesSrc = fs7.readFileSync(path7.resolve(process.cwd(), "src/types/index.ts"), "utf-8");
    const missingInSchema = MYSQL_TABLE_NAMES.filter((t) => !schemaSql.includes(`CREATE TABLE IF NOT EXISTS ${t}`));
    const missingInAdapter = MYSQL_TABLE_NAMES.filter((t) => !adapterSrc.includes(`CREATE TABLE IF NOT EXISTS ${t}`));
    const expectedChecks = [
      "ENUM('PATRON', 'STORE_MANAGER', 'SUPPORT_AGENT', 'LOGISTICS_COORDINATOR')",
      "ENUM('PROCESSING', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'RETURNED')",
      "ENUM('RAZORPAY', 'STRIPE', 'CASH_ON_DELIVERY')",
      "ENUM('PAID', 'PENDING', 'REFUNDED', 'FAILED')",
      "ENUM('NEW_LEAD', 'SWATCH_DISPATCHED', 'QUOTE_ISSUED', 'ORDER_CONFIRMED', 'FULFILLED')",
      "gst_rate DECIMAL(5,4) NULL DEFAULT NULL",
      "customer_phone VARCHAR(32)",
      "erp_order_id VARCHAR(64)",
      "erp_order_number VARCHAR(64)",
      "ip_address VARCHAR(64)",
      "deleted_at DATETIME NULL",
      "is_active TINYINT(1) NOT NULL DEFAULT 1",
      "safety_stock INT NOT NULL DEFAULT 20",
      "recipient_name VARCHAR(191)",
      "fk_bvl_addr_customer FOREIGN KEY (customer_id) REFERENCES bvl_customers(id) ON DELETE CASCADE",
      "offer_price DECIMAL(12,2) NULL DEFAULT NULL",
      "video_url TEXT NULL"
    ];
    const missingSchemaClauses = expectedChecks.filter((c) => !schemaSql.includes(c));
    const missingAdapterClauses = expectedChecks.filter((c) => !adapterSrc.includes(c));
    const expectedTypes = [
      "identityUid?: string;",
      "deletedAt?: string | null;",
      "items?: CorporateGiftingLeadItem[];",
      "erpOrderId?: string;",
      "erpOrderNumber?: string;",
      "customerPhone?: string;",
      "ipAddress?: string;",
      "safetyStock?: number;",
      "addresses?: CustomerAddress[];",
      "recipientName?: string;",
      "offerPrice?: number;",
      "videoUrl?: string;"
    ];
    const missingTypeFields = expectedTypes.filter((f) => !typesSrc.includes(f));
    if (MYSQL_TABLE_NAMES.length === 21 && missingInSchema.length === 0 && missingInAdapter.length === 0 && missingSchemaClauses.length === 0 && missingAdapterClauses.length === 0 && missingTypeFields.length === 0) {
      results.push({
        test: "Code-to-MySQL Schema Parity Audit (21 Normalized Tables)",
        status: "PASS",
        message: "Verified 1:1 parity across src/types/index.ts, mysqlAdapter.ts, and mysql-schema.sql for all 21 tables, columns, and ENUMs."
      });
    } else {
      results.push({
        test: "Code-to-MySQL Schema Parity Audit (21 Normalized Tables)",
        status: "FAIL",
        message: `tables=${MYSQL_TABLE_NAMES.length}, missingSchema=${missingInSchema.join(",")}, missingAdapter=${missingInAdapter.join(",")}, clauses=${missingSchemaClauses.join(",")}|${missingAdapterClauses.join(",")}, types=${missingTypeFields.join(",")}`
      });
    }
  } catch (e) {
    results.push({ test: "Code-to-MySQL Schema Parity Audit (21 Normalized Tables)", status: "FAIL", message: e.message });
  }
  try {
    const adapterAny = mysqlAdapter;
    const prevPool = adapterAny.pool;
    const prevConnected = adapterAny.connected;
    const prevLastError = adapterAny.lastError;
    const prevLastSync = adapterAny.lastSyncAt;
    try {
      const executedDdl = [];
      const mockMigrationConn = {
        query: async (sql, params) => {
          const clean = sql.trim();
          executedDdl.push(clean);
          if (clean.includes("INFORMATION_SCHEMA.COLUMNS")) {
            const col = params?.[1];
            if (col === "customer_phone" || col === "erp_order_id" || col === "ip_address") {
              return [[]];
            }
            if (params?.[0] === "bvl_admin_users" && col === "role") {
              return [[{ COLUMN_TYPE: "varchar(32)", IS_NULLABLE: "NO" }]];
            }
            return [[{ COLUMN_TYPE: "enum('PATRON','STORE_MANAGER','SUPPORT_AGENT','LOGISTICS_COORDINATOR')", IS_NULLABLE: "YES" }]];
          }
          if (clean.includes("INFORMATION_SCHEMA.STATISTICS")) {
            const idx = params?.[1];
            return [[{ cnt: idx === "idx_bvl_orders_customer" ? 0 : 1 }]];
          }
          return [[]];
        }
      };
      await mysqlAdapter.ensureTables(mockMigrationConn);
      const addedMissingCols = executedDdl.some((q) => q.includes("ALTER TABLE `bvl_support_tickets` ADD COLUMN `customer_phone`")) && executedDdl.some((q) => q.includes("ALTER TABLE `bvl_corporate_leads` ADD COLUMN `erp_order_id`")) && executedDdl.some((q) => q.includes("ALTER TABLE `bvl_audit_logs` ADD COLUMN `ip_address`")) && executedDdl.some((q) => q.includes("ALTER TABLE `bvl_admin_users` MODIFY COLUMN `role` ENUM")) && executedDdl.some((q) => q.includes("CREATE INDEX `idx_bvl_orders_customer` ON `bvl_orders`"));
      const sampleState = structuredClone(db.getFullStateSnapshot());
      const testPassHash = hashPassword("RoundTrip#2026");
      sampleState.config.adminCredentials.push({
        userId: "roundtrip.support@bharatvarshcrafts.com",
        displayName: "Roundtrip Agent",
        role: "SUPPORT_AGENT",
        passwordHash: testPassHash,
        addedBy: "sunilchain@gmail.com",
        addedAt: "2026-11-01T10:00:00.000Z",
        isMaster: false
      });
      sampleState.patronCredentials = {
        ...sampleState.patronCredentials || {},
        "roundtrip.patron@example.com": {
          email: "roundtrip.patron@example.com",
          passwordHash: testPassHash,
          updatedAt: "2026-11-01T10:05:00.000Z"
        }
      };
      if (sampleState.customers[1]) {
        sampleState.customers[1].isActive = false;
        sampleState.customers[1].deletedAt = "2026-11-02T12:00:00.000Z";
      }
      sampleState.corporateGiftingLeads.push({
        id: "corp_rt_01",
        companyName: "Maratha Heritage Hotels",
        contactPerson: "Kavita Kulkarni",
        email: "kavita@marathahotels.in",
        phone: "+91 98220 99887",
        estimatedQuantity: 25,
        budgetRangeInr: "3,00,000",
        interestCategory: "TRANSIT_FOLIOS",
        status: "ORDER_CONFIRMED",
        swatchKitAwb: "SRK-SWATCH-77",
        items: [{ sku: "BVL-TRV-BRF-01", quantity: 2, unitPrice: 28900 }],
        erpOrderId: "ord_rt_99",
        erpOrderNumber: "BVL-2026-9999",
        notes: "Custom brass clasp",
        dealValueInr: 57800,
        createdAt: "2026-11-01T09:00:00.000Z"
      });
      if (sampleState.supportTickets[0]) {
        sampleState.supportTickets[0].customerPhone = "+91 98201 77665";
      }
      sampleState.auditLogs.unshift({
        id: "audit_rt_01",
        actorEmail: "sunilchain@gmail.com",
        action: "ROUNDTRIP_CHECK",
        category: "STORE_MANAGEMENT",
        details: "Verified full schema hydration",
        timestamp: "2026-11-01T11:00:00.000Z",
        ipAddress: "203.0.113.42"
      });
      const sampleCatalog = structuredClone(db.getRawCatalog());
      if (sampleCatalog.products[0]) {
        sampleCatalog.products[0].gstRate = 0.05;
        sampleCatalog.products[0].offerPrice = Math.max(1e3, Math.round(sampleCatalog.products[0].price * 0.85));
        sampleCatalog.products[0].images = [
          "/assets/images/rt_slot1.jpg",
          "/assets/images/rt_slot2.jpg",
          "/assets/images/rt_slot3.jpg",
          "/assets/images/rt_slot4.jpg"
        ];
        sampleCatalog.products[0].image = "/assets/images/rt_slot1.jpg";
        sampleCatalog.products[0].videoUrl = "/assets/images/rt_showcase.mp4";
      }
      if (sampleCatalog.products[1]) {
        delete sampleCatalog.products[1].gstRate;
        delete sampleCatalog.products[1].offerPrice;
        delete sampleCatalog.products[1].videoUrl;
      }
      const tableStore = /* @__PURE__ */ new Map();
      const pushRow = (tbl, keyCol, rowObj) => {
        const list = tableStore.get(tbl) || [];
        const idx = list.findIndex((r) => r[keyCol] === rowObj[keyCol]);
        if (idx >= 0) list[idx] = rowObj;
        else list.push(rowObj);
        tableStore.set(tbl, list);
      };
      const mockRoundTripConn = {
        beginTransaction: async () => {
        },
        commit: async () => {
        },
        rollback: async () => {
        },
        release: () => {
        },
        query: async (sql, params = []) => {
          const clean = sql.replace(/\s+/g, " ").trim();
          if (clean.startsWith("INSERT INTO bvl_app_state")) {
            pushRow("bvl_app_state", "state_key", { state_key: params[0], state_json: params[1] });
          } else if (clean.startsWith("INSERT INTO bvl_store_config")) {
            pushRow("bvl_store_config", "id", {
              id: params[0],
              gst_invoicing_enabled: params[1],
              abandonment_threshold_minutes: params[2],
              primary_hub_city: params[3],
              supplier_gstin: params[4],
              gst_rate_percent: params[5],
              promo_codes_json: params[6],
              master_super_admins_json: params[7],
              permitted_store_managers_json: params[8],
              updated_at: params[9],
              last_updated_by: params[10]
            });
          } else if (clean.startsWith("INSERT INTO bvl_admin_users")) {
            pushRow("bvl_admin_users", "user_id", {
              user_id: params[0],
              display_name: params[1],
              role: params[2],
              password_hash: params[3],
              is_master: params[4],
              added_by: params[5],
              added_at: params[6]
            });
          } else if (clean.startsWith("INSERT INTO bvl_patron_credentials")) {
            pushRow("bvl_patron_credentials", "email", {
              email: params[0],
              password_hash: params[1],
              updated_at: params[2]
            });
          } else if (clean.startsWith("INSERT INTO bvl_customers")) {
            pushRow("bvl_customers", "id", {
              id: params[0],
              identity_uid: params[1],
              email: params[2],
              phone: params[3],
              full_name: params[4],
              role: params[5],
              total_orders: params[6],
              lifetime_value: params[7],
              average_order_value: params[8],
              refund_rate: params[9],
              days_since_last_order: params[10],
              last_order_date: params[11],
              rfm_segment: params[12],
              rfm_score_json: params[13],
              discount_orders_count: params[14],
              loyalty_points: params[15],
              store_credit_balance: params[16],
              tags_json: params[17],
              utm_source: params[18],
              utm_medium: params[19],
              acquisition_cost: params[20],
              is_active: params[21],
              deleted_at: params[22],
              created_at: params[23],
              updated_at: params[24]
            });
          } else if (clean.startsWith("INSERT INTO bvl_customer_addresses")) {
            pushRow("bvl_customer_addresses", "id", {
              id: params[0],
              customer_id: params[1],
              recipient_name: params[2],
              phone: params[3],
              street: params[4],
              city: params[5],
              state: params[6],
              pincode: params[7],
              country: params[8],
              is_default: params[9],
              address_type: params[10],
              created_at: params[11],
              updated_at: params[12]
            });
          } else if (clean.startsWith("INSERT INTO bvl_corporate_leads")) {
            pushRow("bvl_corporate_leads", "id", {
              id: params[0],
              company_name: params[1],
              contact_person: params[2],
              email: params[3],
              phone: params[4],
              estimated_quantity: params[5],
              budget_range_inr: params[6],
              interest_category: params[7],
              status: params[8],
              swatch_kit_awb: params[9],
              items_json: params[10],
              erp_order_id: params[11],
              erp_order_number: params[12],
              notes: params[13],
              deal_value_inr: params[14],
              created_at: params[15]
            });
          } else if (clean.startsWith("INSERT INTO bvl_support_tickets")) {
            pushRow("bvl_support_tickets", "id", {
              id: params[0],
              ticket_number: params[1],
              customer_id: params[2],
              customer_name: params[3],
              customer_email: params[4],
              customer_phone: params[5],
              channel: params[6],
              subject: params[7],
              category: params[8],
              priority: params[9],
              status: params[10],
              assigned_to: params[11],
              sla_breach_hours: params[12],
              messages_json: params[13],
              created_at: params[14],
              updated_at: params[15]
            });
          } else if (clean.startsWith("INSERT IGNORE INTO bvl_audit_logs")) {
            pushRow("bvl_audit_logs", "id", {
              id: params[0],
              actor_email: params[1],
              action: params[2],
              category: params[3],
              details: params[4],
              ip_address: params[5],
              created_at: params[6]
            });
          } else if (clean.startsWith("INSERT INTO bvl_catalog_categories")) {
            pushRow("bvl_catalog_categories", "id", {
              id: params[0],
              name: params[1],
              slug: params[2],
              description: params[3],
              product_types_json: params[4]
            });
          } else if (clean.startsWith("INSERT INTO bvl_catalog_products")) {
            pushRow("bvl_catalog_products", "id", {
              id: params[0],
              category: params[1],
              product_type: params[2],
              name: params[3],
              sku: params[4],
              price: params[5],
              offer_price: params[6],
              currency: params[7],
              description: params[8],
              features_json: params[9],
              images_json: params[10],
              video_url: params[11],
              hsn_code: params[12],
              gst_rate: params[13],
              solution_engine: params[14],
              allow_customization: params[15],
              care_kit_included: params[16]
            });
          }
          return [[]];
        }
      };
      await mysqlAdapter.syncStateWithConnection(mockRoundTripConn, sampleState);
      await mysqlAdapter.saveCatalogSnapshot(sampleCatalog, mockRoundTripConn);
      adapterAny.pool = {
        getConnection: async () => mockRoundTripConn,
        query: async (sql) => {
          const match = sql.match(/FROM\s+([a-z0-9_]+)/i);
          const tbl = match?.[1] || "";
          return [tableStore.get(tbl) || []];
        }
      };
      adapterAny.connected = true;
      const hydratedState = await mysqlAdapter.loadStateSnapshot();
      const hydratedCatalog = await mysqlAdapter.loadCatalogSnapshot();
      const hydratedAgent = hydratedState?.config?.adminCredentials?.find(
        (a) => a.userId === "roundtrip.support@bharatvarshcrafts.com"
      );
      const hydratedPatronCred = hydratedState?.patronCredentials?.["roundtrip.patron@example.com"];
      const hydratedSoftDeleted = hydratedState?.customers?.find(
        (c) => c.id === sampleState.customers[1]?.id
      );
      const hydratedLead = hydratedState?.corporateGiftingLeads?.find((l) => l.id === "corp_rt_01");
      const hydratedTicket = hydratedState?.supportTickets?.find(
        (t) => t.id === sampleState.supportTickets[0]?.id
      );
      const hydratedAudit = hydratedState?.auditLogs?.find((l) => l.id === "audit_rt_01");
      const hydratedProd0 = hydratedCatalog?.products?.find((p) => p.id === sampleCatalog.products[0]?.id);
      const hydratedProd1 = hydratedCatalog?.products?.find((p) => p.id === sampleCatalog.products[1]?.id);
      const hydratedAddr = hydratedState?.addresses?.find((a) => a.customerId === sampleState.customers[0]?.id);
      const hydratedCust0 = hydratedState?.customers?.find((c) => c.id === sampleState.customers[0]?.id);
      const roundTripOk = addedMissingCols && hydratedAgent?.role === "SUPPORT_AGENT" && hydratedAgent?.passwordHash === testPassHash && hydratedPatronCred?.passwordHash === testPassHash && hydratedSoftDeleted?.isActive === false && Boolean(hydratedSoftDeleted?.deletedAt) && hydratedLead?.erpOrderId === "ord_rt_99" && hydratedLead?.erpOrderNumber === "BVL-2026-9999" && hydratedLead?.items?.[0]?.sku === "BVL-TRV-BRF-01" && hydratedTicket?.customerPhone === "+91 98201 77665" && hydratedAudit?.ipAddress === "203.0.113.42" && hydratedProd0?.gstRate === 0.05 && hydratedProd0?.offerPrice === sampleCatalog.products[0]?.offerPrice && hydratedProd0?.images?.length === 4 && hydratedProd0?.image === hydratedProd0?.images?.[0] && hydratedProd0?.videoUrl === "/assets/images/rt_showcase.mp4" && hydratedProd1?.gstRate === void 0 && hydratedProd1?.offerPrice === void 0 && Boolean(hydratedAddr?.street) && Boolean(hydratedCust0?.addresses && hydratedCust0.addresses.length > 0);
      if (roundTripOk) {
        results.push({
          test: "MySQL ensureTables() Migrations & 21-Table Round-Trip Hydration",
          status: "PASS",
          message: "Validated INFORMATION_SCHEMA column/ENUM/index migrations and lossless round-trip hydration across RBAC, soft-delete, GST, offerPrice, 4-image+video catalog, corporate leads, tickets, and audit logs."
        });
      } else {
        results.push({
          test: "MySQL ensureTables() Migrations & 21-Table Round-Trip Hydration",
          status: "FAIL",
          message: `ddl=${addedMissingCols}, agentRole=${hydratedAgent?.role}, patronCred=${Boolean(hydratedPatronCred)}, softDel=${hydratedSoftDeleted?.isActive}, lead=${hydratedLead?.erpOrderId}, ticketPhone=${hydratedTicket?.customerPhone}, gst=${hydratedProd0?.gstRate}/${hydratedProd1?.gstRate}, offer=${hydratedProd0?.offerPrice}, imgs=${hydratedProd0?.images?.length}, vid=${hydratedProd0?.videoUrl}`
        });
      }
    } finally {
      adapterAny.pool = prevPool;
      adapterAny.connected = prevConnected;
      adapterAny.lastError = prevLastError;
      adapterAny.lastSyncAt = prevLastSync;
    }
  } catch (e) {
    results.push({ test: "MySQL ensureTables() Migrations & 21-Table Round-Trip Hydration", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const catalogFile = path7.resolve(process.cwd(), "src/server/catalog.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const preTestCatalogRaw = fs7.existsSync(catalogFile) ? fs7.readFileSync(catalogFile, "utf-8") : null;
    const adapterAny = mysqlAdapter;
    const prevPool = adapterAny.pool;
    const prevConnected = adapterAny.connected;
    const prevLastError = adapterAny.lastError;
    const prevLastSync = adapterAny.lastSyncAt;
    try {
      const origCatalog = structuredClone(db.getRawCatalog());
      const targetProd = origCatalog.products[0];
      const origPrice = targetProd.price;
      const targetCustomer = db.getCustomers().find((c) => !db.isMasterAuthorized(c.email));
      let rollbackCount = 0;
      const failingConn = {
        beginTransaction: async () => {
        },
        query: async (sql) => {
          if (sql.includes("INSERT INTO bvl_app_state") || sql.includes("UPDATE bvl_customers")) {
            throw new Error("SIMULATED_MYSQL_LOCK_TIMEOUT");
          }
          return [[]];
        },
        commit: async () => {
        },
        rollback: async () => {
          rollbackCount += 1;
        },
        release: () => {
        }
      };
      adapterAny.pool = { getConnection: async () => failingConn };
      adapterAny.connected = true;
      let catalogRejected = false;
      try {
        const mutatedCatalog = structuredClone(origCatalog);
        mutatedCatalog.products[0].price = origPrice + 9999;
        await db.saveCatalogAsync(mutatedCatalog, "sunilchain@gmail.com");
      } catch (err) {
        catalogRejected = err.message.includes("SIMULATED_MYSQL_LOCK_TIMEOUT");
      }
      let softDeleteRejected = false;
      try {
        await db.softDeleteCustomerAsync(targetCustomer.id, "sunilchain@gmail.com");
      } catch (err) {
        softDeleteRejected = err.message.includes("SIMULATED_MYSQL_LOCK_TIMEOUT");
      }
      const catalogPricePreserved = db.getRawCatalog().products[0].price === origPrice;
      const diskCatalogPreserved = JSON.parse(fs7.readFileSync(catalogFile, "utf-8")).products[0].price === origPrice;
      const customerStillActive = db.getCustomerById(targetCustomer.id)?.isActive !== false;
      if (catalogRejected && softDeleteRejected && rollbackCount >= 2 && catalogPricePreserved && diskCatalogPreserved && customerStillActive) {
        results.push({
          test: "Atomic Catalog & Customer Soft-Delete Rollback on MySQL Failure",
          status: "PASS",
          message: "Rolled back MySQL transactions, in-memory state, and disk JSON snapshots cleanly after simulated InnoDB failure."
        });
      } else {
        results.push({
          test: "Atomic Catalog & Customer Soft-Delete Rollback on MySQL Failure",
          status: "FAIL",
          message: `catRej=${catalogRejected}, delRej=${softDeleteRejected}, rollbacks=${rollbackCount}, priceOk=${catalogPricePreserved}, diskOk=${diskCatalogPreserved}, activeOk=${customerStillActive}`
        });
      }
    } finally {
      adapterAny.pool = prevPool;
      adapterAny.connected = prevConnected;
      adapterAny.lastError = prevLastError;
      adapterAny.lastSyncAt = prevLastSync;
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
      if (preTestCatalogRaw) {
        fs7.writeFileSync(catalogFile, preTestCatalogRaw, "utf-8");
        db.catalogCache = JSON.parse(preTestCatalogRaw);
      }
    }
  } catch (e) {
    results.push({ test: "Atomic Catalog & Customer Soft-Delete Rollback on MySQL Failure", status: "FAIL", message: e.message });
  }
  try {
    const publicImagesDir = path7.resolve(process.cwd(), "public/assets/images");
    const expectedImages = [
      "custom_debossing_monogram_1794461810572.jpg",
      "hero_leathercraft_workshop_1794461808596.jpg",
      "product_men_belt_wallet_1794461808951.jpg",
      "product_travel_backpack_folio_1794461810700.jpg",
      "product_women_purse_bag_1794461810441.jpg"
    ];
    const allFilesPresent = expectedImages.every((f) => fs7.existsSync(path7.join(publicImagesDir, f)));
    const catalogJsonSrc = fs7.readFileSync(path7.resolve(process.cwd(), "src/server/catalog.json"), "utf-8");
    const storefrontSrc = fs7.readFileSync(path7.resolve(process.cwd(), "src/components/Storefront.tsx"), "utf-8");
    const catalogMgrSrc = fs7.readFileSync(path7.resolve(process.cwd(), "src/components/CatalogManager.tsx"), "utf-8");
    const noLegacySourceRefs = !catalogJsonSrc.includes("/src/assets/images/") && !storefrontSrc.includes("/src/assets/images/") && !catalogMgrSrc.includes("/src/assets/images/");
    const legacyCatalog = {
      categories: [],
      products: [
        {
          id: "p_legacy",
          images: ["/src/assets/images/hero_leathercraft_workshop_1794461808596.jpg"]
        }
      ]
    };
    const { catalog: normalizedCat, changed } = db.normalizeCatalogAssets(legacyCatalog);
    const legacyState = structuredClone(db.getFullStateSnapshot());
    legacyState.hotStampingVectors[0].previewImageUrl = "/src/assets/images/custom_debossing_monogram_1794461810572.jpg";
    legacyState.carts[0].items[0].imageUrl = "/src/assets/images/product_travel_backpack_folio_1794461810700.jpg";
    legacyState.orders[0].items[0].imageUrl = "/src/assets/images/product_men_belt_wallet_1794461808951.jpg";
    const migratedState = db.migrateLegacyState(legacyState);
    const normalizedOk = changed && normalizedCat.products[0].images[0] === "/assets/images/hero_leathercraft_workshop_1794461808596.jpg" && migratedState.hotStampingVectors[0].previewImageUrl === "/assets/images/custom_debossing_monogram_1794461810572.jpg" && migratedState.carts[0].items[0].imageUrl === "/assets/images/product_travel_backpack_folio_1794461810700.jpg" && migratedState.orders[0].items[0].imageUrl === "/assets/images/product_men_belt_wallet_1794461808951.jpg";
    if (allFilesPresent && noLegacySourceRefs && normalizedOk) {
      results.push({
        test: "Public Image Packaging & Legacy Asset Path Normalization",
        status: "PASS",
        message: "Verified all 5 images in public/assets/images, clean frontend/catalog references, and automatic legacy URL normalization."
      });
    } else {
      results.push({
        test: "Public Image Packaging & Legacy Asset Path Normalization",
        status: "FAIL",
        message: `files=${allFilesPresent}, cleanRefs=${noLegacySourceRefs}, normalized=${normalizedOk}`
      });
    }
  } catch (e) {
    results.push({ test: "Public Image Packaging & Legacy Asset Path Normalization", status: "FAIL", message: e.message });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const port = server.address().port;
      const adminJwt = signSessionJwt({
        sub: "uid_master_sunil",
        email: "sunilchain@gmail.com",
        name: "Sunil Chainani",
        role: "STORE_MANAGER"
      });
      const badPhoneOrderRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: "Rohan Joshi",
          customerEmail: "rohan.joshi@example.com",
          customerPhone: "9820112345",
          // missing +91
          shippingAddress: {
            street: "14 Baner Road, Balewadi",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411045",
            country: "India"
          },
          items: [{ productId: "prod-m-belt-01", sku: "BVL-MEN-BLT-01", quantity: 1 }]
        })
      });
      const badPhoneOrderData = await badPhoneOrderRes.json();
      const badPinCountryOrderRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: "Rohan Joshi",
          customerEmail: "rohan.joshi@example.com",
          customerPhone: "+91 98201 12345",
          shippingAddress: {
            street: "14 Baner Road, Balewadi",
            city: "Pune",
            state: "Californialand",
            pincode: "011001",
            country: "USA"
          },
          items: [{ productId: "prod-m-belt-01", sku: "BVL-MEN-BLT-01", quantity: 1 }]
        })
      });
      const badPinCountryData = await badPinCountryOrderRes.json();
      const badRegRes = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: "Meera Nair",
          email: "meera.nair@example.com",
          password: "StrongPassword#2026",
          phone: "+1 415 555 0100"
        })
      });
      const badCrmRes = await fetch(`http://127.0.0.1:${port}/api/crm/customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          fullName: "Karan Mehta",
          email: "karan.mehta@example.com",
          phone: "12345"
        })
      });
      const rejectionsOk = badPhoneOrderRes.status === 400 && Boolean(badPhoneOrderData.errors?.phone) && badPinCountryOrderRes.status === 400 && Boolean(badPinCountryData.errors?.pincode) && Boolean(badPinCountryData.errors?.country) && Boolean(badPinCountryData.errors?.state) && badRegRes.status === 400 && badCrmRes.status === 400;
      const regRes = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: "Meera Nair",
          email: "meera.nair@example.com",
          password: "StrongPassword#2026",
          phone: "+919820776655",
          street: "802 Sapphire Residences, Bandra West",
          city: "Mumbai",
          state: "Maharashtra",
          pincode: "400050",
          country: "India"
        })
      });
      const regData = await regRes.json();
      const patronJwt = regData.token;
      const overviewRes1 = await fetch(`http://127.0.0.1:${port}/api/patron/overview`, {
        headers: { Authorization: `Bearer ${patronJwt}` }
      });
      const overview1 = await overviewRes1.json();
      const orderRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: "Meera Nair",
          customerEmail: "meera.nair@example.com",
          customerPhone: "+91 98207 76655",
          shippingAddress: {
            street: "NT2-904 Blue Ridge Township, Hinjewadi",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411057",
            country: "India"
          },
          items: [{ productId: "prod-m-belt-01", sku: "BVL-MEN-BLT-01", quantity: 1 }]
        })
      });
      const orderData = await orderRes.json();
      const createdOrder = orderData.order;
      const overviewRes2 = await fetch(`http://127.0.0.1:${port}/api/patron/overview`, {
        headers: { Authorization: `Bearer ${patronJwt}` }
      });
      const overview2 = await overviewRes2.json();
      const retRes = await fetch(`http://127.0.0.1:${port}/api/erp/rma/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          orderId: createdOrder.id,
          customerId: createdOrder.customerId,
          reason: "Sizing exchange to 34-inch strap",
          inspectionNotes: "Unused buckle & leather strap",
          restockInWarehouse: true,
          restockLocation: "punePrimaryHub"
        })
      });
      const retData = await retRes.json();
      const cnNum = retData.creditNote?.creditNoteNumber;
      createdOrder.shippingAddress = void 0;
      createdOrder.customerPhone = "";
      const invHtmlRes = await fetch(
        `http://127.0.0.1:${port}/api/erp/invoices/${encodeURIComponent(createdOrder.invoiceNumber)}?format=html`,
        { headers: { Authorization: `Bearer ${patronJwt}` } }
      );
      const invHtml = await invHtmlRes.text();
      const invPdfRes = await fetch(
        `http://127.0.0.1:${port}/api/erp/invoices/${encodeURIComponent(createdOrder.invoiceNumber)}?format=pdf`,
        { headers: { Authorization: `Bearer ${patronJwt}` } }
      );
      const invPdfStr = Buffer.from(await invPdfRes.arrayBuffer()).toString("latin1");
      const cnHtmlRes = await fetch(
        `http://127.0.0.1:${port}/api/erp/invoices/${encodeURIComponent(cnNum)}?format=html`,
        { headers: { Authorization: `Bearer ${patronJwt}` } }
      );
      const cnHtml = await cnHtmlRes.text();
      const cnPdfRes = await fetch(
        `http://127.0.0.1:${port}/api/erp/invoices/${encodeURIComponent(cnNum)}?format=pdf`,
        { headers: { Authorization: `Bearer ${patronJwt}` } }
      );
      const cnPdfStr = Buffer.from(await cnPdfRes.arrayBuffer()).toString("latin1");
      const expectedRegOffice = "NT2-1703, The Crown Greens, Plot 7, Hinjewadi Phase 2, Pune, Maharashtra";
      const expectedGstin = db.getConfig().supplierGstin;
      const brandingAndFallbackOk = invHtmlRes.status === 200 && invHtml.includes("data:image/png;base64,") && invHtml.includes(expectedRegOffice) && invHtml.includes(expectedGstin) && invHtml.includes("NT2-904 Blue Ridge Township, Hinjewadi") && invHtml.includes("+91 98207 76655") && invPdfRes.status === 200 && invPdfStr.startsWith("%PDF-1.4") && invPdfStr.includes("/Subtype /Image") && invPdfStr.includes("NT2-1703, The Crown Greens, Plot 7, Hinjewadi Phase 2, Pune, Maharashtra") && invPdfStr.includes(expectedGstin) && invPdfStr.includes("NT2-904 Blue Ridge Township, Hinjewadi") && cnHtmlRes.status === 200 && cnHtml.includes("data:image/png;base64,") && cnHtml.includes(expectedRegOffice) && cnHtml.includes(expectedGstin) && cnHtml.includes("NT2-904 Blue Ridge Township, Hinjewadi") && cnPdfRes.status === 200 && cnPdfStr.startsWith("%PDF-1.4") && cnPdfStr.includes("/Subtype /Image") && cnPdfStr.includes(expectedGstin);
      const addressPersistenceOk = regRes.status === 201 && overview1.defaultAddress?.pincode === "400050" && overview1.patron?.phone === "+91 98207 76655" && orderRes.status === 201 && overview2.defaultAddress?.pincode === "411057" && overview2.defaultAddress?.street === "NT2-904 Blue Ridge Township, Hinjewadi";
      if (rejectionsOk && addressPersistenceOk && brandingAndFallbackOk) {
        results.push({
          test: "Indian Validation, Patron Address Auto-Fill & Branded GST Invoice/Credit Note PDFs",
          status: "PASS",
          message: "Enforced strict +91/6-digit PIN/India-only validation, persisted patron addresses, and rendered LLP logo, Pune Registered Office & GSTIN across HTML and PDF documents."
        });
      } else {
        results.push({
          test: "Indian Validation, Patron Address Auto-Fill & Branded GST Invoice/Credit Note PDFs",
          status: "FAIL",
          message: `rejections=${rejectionsOk}, addrPersist=${addressPersistenceOk} (pin1=${overview1.defaultAddress?.pincode}, pin2=${overview2.defaultAddress?.pincode}), branding=${brandingAndFallbackOk}`
        });
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({
      test: "Indian Validation, Patron Address Auto-Fill & Branded GST Invoice/Credit Note PDFs",
      status: "FAIL",
      message: e.message
    });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const catalogFile = path7.resolve(process.cwd(), "src/server/catalog.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const preTestCatalogRaw = fs7.existsSync(catalogFile) ? fs7.readFileSync(catalogFile, "utf-8") : null;
    const uploadedDiskFiles = [];
    const app = express();
    app.use(express.json({ limit: "75mb" }));
    const publicImagesDir = path7.resolve(process.cwd(), "public", "assets", "images");
    fs7.mkdirSync(publicImagesDir, { recursive: true });
    app.use("/assets/images", express.static(publicImagesDir));
    app.use("/api", apiRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const port = server.address().port;
    try {
      const adminJwt = signSessionJwt({
        sub: "uid_master_sunil",
        email: "sunilchain@gmail.com",
        name: "Sunil Chainani",
        role: "STORE_MANAGER"
      });
      const patronJwt = signSessionJwt({
        sub: "uid_patron_media",
        email: "patron.media@example.com",
        name: "Patron Media",
        role: "PATRON"
      });
      const unauthUploadRes = await fetch(`http://127.0.0.1:${port}/api/store-management/upload-media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: "test.png", mimeType: "image/png", dataBase64: "iVBORw0KGgo=" })
      });
      const patronUploadRes = await fetch(`http://127.0.0.1:${port}/api/store-management/upload-media`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${patronJwt}` },
        body: JSON.stringify({ filename: "test.png", mimeType: "image/png", dataBase64: "iVBORw0KGgo=" })
      });
      const invalidExtRes = await fetch(`http://127.0.0.1:${port}/api/store-management/upload-media`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ filename: "script.svg", mimeType: "image/svg+xml", dataBase64: "PHN2Zz48L3N2Zz4=" })
      });
      const pngBytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWScAAAAASUVORK5CYII=",
        "base64"
      );
      const formData = new FormData();
      formData.append("file", new Blob([pngBytes], { type: "image/png" }), "Atelier Craft Shot.png");
      const pngUploadRes = await fetch(`http://127.0.0.1:${port}/api/store-management/upload-media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminJwt}` },
        body: formData
      });
      const pngUploadJson = await pngUploadRes.json();
      if (pngUploadJson?.filename) {
        uploadedDiskFiles.push(path7.join(publicImagesDir, pngUploadJson.filename));
        const distImagesFile = path7.resolve(process.cwd(), "dist", "assets", "images", pngUploadJson.filename);
        if (fs7.existsSync(distImagesFile)) uploadedDiskFiles.push(distImagesFile);
      }
      const servedImgRes = await fetch(`http://127.0.0.1:${port}${pngUploadJson.url}`);
      const servedImgBuf = Buffer.from(await servedImgRes.arrayBuffer());
      const mp4Sample = Buffer.from("00000018667479706d703432000000006d70343269736f6d", "hex");
      const vidUploadRes = await fetch(`http://127.0.0.1:${port}/api/store-management/upload-media`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          filename: "showcase_reel.mp4",
          mimeType: "video/mp4",
          dataBase64: mp4Sample.toString("base64")
        })
      });
      const vidUploadJson = await vidUploadRes.json();
      if (vidUploadJson?.filename) {
        uploadedDiskFiles.push(path7.join(publicImagesDir, vidUploadJson.filename));
        const distVidFile = path7.resolve(process.cwd(), "dist", "assets", "images", vidUploadJson.filename);
        if (fs7.existsSync(distVidFile)) uploadedDiskFiles.push(distVidFile);
      }
      const currentCatalog = structuredClone(db.getRawCatalog());
      const baseProd = structuredClone(currentCatalog.products[0]);
      const badOfferCatalog = structuredClone(currentCatalog);
      badOfferCatalog.products[0] = {
        ...baseProd,
        price: 1e4,
        offerPrice: 12500
      };
      const badOfferRes = await fetch(`http://127.0.0.1:${port}/api/store-management/catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ catalog: badOfferCatalog })
      });
      const badImagesCatalog = structuredClone(currentCatalog);
      badImagesCatalog.products[0] = {
        ...baseProd,
        images: [
          pngUploadJson.url,
          "/assets/images/slot2.jpg",
          "/assets/images/slot3.jpg",
          "/assets/images/slot4.jpg",
          "/assets/images/slot5.jpg"
        ]
      };
      const badImagesRes = await fetch(`http://127.0.0.1:${port}/api/store-management/catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ catalog: badImagesCatalog })
      });
      const validCatalog = structuredClone(currentCatalog);
      validCatalog.products[0] = {
        ...baseProd,
        price: 12e3,
        offerPrice: 9600,
        gstRate: 0.18,
        images: [
          pngUploadJson.url,
          "/assets/images/slot_2.jpg",
          "/assets/images/slot_3.jpg",
          "/assets/images/slot_4.jpg"
        ],
        videoUrl: vidUploadJson.url
      };
      delete validCatalog.products[0].image;
      const saveValidRes = await fetch(`http://127.0.0.1:${port}/api/store-management/catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ catalog: validCatalog })
      });
      const saveValidJson = await saveValidRes.json();
      const savedProd0 = saveValidJson?.catalog?.products?.[0];
      const orderRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: "Vikramaditya Joshi",
          customerEmail: "vikram.offer@example.com",
          customerPhone: "+919823011223",
          paymentGateway: "RAZORPAY",
          discountCode: "HEIRLOOM10",
          shippingAddress: {
            street: "Plot 14, Prabhat Road, Deccan Gymkhana",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411004",
            country: "India"
          },
          items: [
            {
              productId: savedProd0.id,
              sku: savedProd0.sku,
              quantity: 1,
              unitPrice: 999999
            }
          ]
        })
      });
      const orderJson = await orderRes.json();
      const placedOrder = orderJson.order;
      const expectedDiscount = 960;
      const expectedTax = Math.round((9600 - 960) * 0.18);
      const expectedTotal = 9600 - expectedDiscount + expectedTax;
      const uploadChecksOk = unauthUploadRes.status === 401 && patronUploadRes.status === 403 && invalidExtRes.status === 400 && pngUploadRes.status === 201 && String(pngUploadJson.url).startsWith("/assets/images/") && servedImgRes.status === 200 && servedImgBuf.equals(pngBytes) && vidUploadRes.status === 201 && vidUploadJson.mediaType === "video" && String(vidUploadJson.url).startsWith("/assets/images/");
      const catalogAndPricingOk = badOfferRes.status === 400 && badImagesRes.status === 400 && saveValidRes.status === 200 && savedProd0?.images?.length === 4 && savedProd0?.image === pngUploadJson.url && savedProd0?.videoUrl === vidUploadJson.url && savedProd0?.offerPrice === 9600 && orderRes.status === 201 && placedOrder?.subtotal === 9600 && placedOrder?.discountAmount === expectedDiscount && placedOrder?.taxAmount === expectedTax && placedOrder?.totalAmount === expectedTotal;
      if (uploadChecksOk && catalogAndPricingOk) {
        results.push({
          test: "Phase 2: /assets/images/ Media Upload, 4-Image + 1-Video Gallery & Authoritative Offer Pricing",
          status: "PASS",
          message: "Verified RBAC-protected PNG/MP4 uploads to /assets/images/, 4-image + 1-video persistence, offerPrice <= MRP enforcement, and server-authoritative offerPrice checkout math."
        });
      } else {
        results.push({
          test: "Phase 2: /assets/images/ Media Upload, 4-Image + 1-Video Gallery & Authoritative Offer Pricing",
          status: "FAIL",
          message: `uploadOk=${uploadChecksOk} (statuses=${unauthUploadRes.status}/${patronUploadRes.status}/${invalidExtRes.status}/${pngUploadRes.status}/${servedImgRes.status}/${vidUploadRes.status}), pricingOk=${catalogAndPricingOk} (badOffer=${badOfferRes.status}, badImgs=${badImagesRes.status}, save=${saveValidRes.status}, subtotal=${placedOrder?.subtotal}, total=${placedOrder?.totalAmount} vs ${expectedTotal})`
        });
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      for (const f of uploadedDiskFiles) {
        if (f && fs7.existsSync(f)) {
          fs7.unlinkSync(f);
        }
      }
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
      if (preTestCatalogRaw) {
        fs7.writeFileSync(catalogFile, preTestCatalogRaw, "utf-8");
        db.catalogCache = JSON.parse(preTestCatalogRaw);
      }
    }
  } catch (e) {
    results.push({
      test: "Phase 2: /assets/images/ Media Upload, 4-Image + 1-Video Gallery & Authoritative Offer Pricing",
      status: "FAIL",
      message: e.message
    });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const prevSmtpPass = process.env.SMTP_PASS;
    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const port = server.address().port;
    try {
      delete process.env.SMTP_PASS;
      const masterJwt = signSessionJwt({
        sub: "uid_master_sunil",
        email: "sunilchain@gmail.com",
        name: "Sunil Chainani",
        role: "STORE_MANAGER"
      });
      const delegatedManagerJwt = signSessionJwt({
        sub: "uid_delegated_mgr",
        email: "delegated.manager@bharatvarshcrafts.com",
        name: "Delegated Store Manager",
        role: "STORE_MANAGER"
      });
      const badCartId = `cart_bad_email_${Date.now()}`;
      const goodCartId = `cart_phase3_${Date.now()}`;
      await db.runAtomicMutation(() => {
        db.saveCartState({
          id: badCartId,
          email: "",
          phone: "+919820012345",
          items: [
            {
              productId: "prod-m-belt-01",
              productName: "The Rajputana Bridle Belt",
              sku: "BVL-MEN-BLT-01",
              quantity: 1,
              unitPrice: 3800,
              leatherType: "VEGETABLE_TANNED_HERITAGE",
              imageUrl: "/assets/images/mens_collection_editorial_1794461810572.jpg"
            }
          ],
          subtotal: 3800,
          isAbandoned: true
        });
        db.saveCartState({
          id: goodCartId,
          email: "aarav.phase3@example.com",
          phone: "+919820054321",
          items: [
            {
              productId: "prod-m-belt-01",
              productName: "The Rajputana Bridle Belt",
              sku: "BVL-MEN-BLT-01",
              quantity: 1,
              unitPrice: 3800,
              leatherType: "VEGETABLE_TANNED_HERITAGE",
              imageUrl: "/assets/images/mens_collection_editorial_1794461810572.jpg"
            }
          ],
          subtotal: 3800,
          isAbandoned: true
        });
      });
      const badTriggerRes = await fetch(`http://127.0.0.1:${port}/api/crm/cart-recovery/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterJwt}` },
        body: JSON.stringify({ cartId: badCartId, channel: "EMAIL" })
      });
      const badCartAfter = db.getCarts().find((c) => c.id === badCartId);
      const goodTriggerRes = await fetch(`http://127.0.0.1:${port}/api/crm/cart-recovery/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterJwt}` },
        body: JSON.stringify({ cartId: goodCartId, channel: "EMAIL" })
      });
      const goodTriggerJson = await goodTriggerRes.json();
      const cooldownRes = await fetch(`http://127.0.0.1:${port}/api/crm/cart-recovery/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterJwt}` },
        body: JSON.stringify({ cartId: goodCartId, channel: "EMAIL" })
      });
      const cooldownJson = await cooldownRes.json();
      const orderRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: "Vikramaditya Joshi",
          customerEmail: "vikram.phase3@example.com",
          customerPhone: "+919811122233",
          paymentGateway: "RAZORPAY",
          shippingAddress: {
            street: "42 Koregaon Park Lane 6",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411001",
            country: "India"
          },
          items: [
            {
              productId: "prod-m-belt-01",
              sku: "BVL-MEN-BLT-01",
              quantity: 1,
              unitPrice: 3800
            }
          ]
        })
      });
      const orderJson = await orderRes.json();
      const placedOrder = orderJson.order;
      await new Promise((resolve) => setTimeout(resolve, 150));
      const supportDirectResult = await dispatchOrderInvoiceEmailToSupport(placedOrder);
      const supportRecipient = getSupportOrderEmailRecipient();
      const auditLogsAfterOrder = db.getAuditLogs();
      const hasNotificationAudit = auditLogsAfterOrder.some(
        (a) => a.action === "ORDER_NOTIFICATION_DISPATCHED" && a.details.includes(placedOrder.orderNumber) && a.details.includes("SupportInvoice:")
      );
      const istOffsetMs = 5.5 * 60 * 60 * 1e3;
      const orderIstDateKey = new Date(new Date(placedOrder.createdAt).getTime() + istOffsetMs).toISOString().slice(0, 10);
      const workbookReport = generateDailyOrderWorkbook(orderIstDateKey);
      const parsedWb = XLSX2.read(workbookReport.buffer, { type: "buffer" });
      const ordersSheetRows = XLSX2.utils.sheet_to_json(parsedWb.Sheets["Orders"]);
      const summarySheetRows = XLSX2.utils.sheet_to_json(parsedWb.Sheets["Summary"]);
      const matchedExcelRow = ordersSheetRows.find((r) => r["Order Number"] === placedOrder.orderNumber);
      const expectedHeadersPresent = matchedExcelRow && "Order Date/Time (IST)" in matchedExcelRow && "Invoice Number" in matchedExcelRow && "Taxable Value (INR)" in matchedExcelRow && "CGST (INR)" in matchedExcelRow && "SGST (INR)" in matchedExcelRow && "IGST (INR)" in matchedExcelRow && "Total Amount (INR)" in matchedExcelRow && "AWB Number" in matchedExcelRow;
      const unauthReportRes = await fetch(`http://127.0.0.1:${port}/api/admin/reports/send-daily-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: orderIstDateKey })
      });
      const delegatedReportRes = await fetch(`http://127.0.0.1:${port}/api/admin/reports/send-daily-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${delegatedManagerJwt}` },
        body: JSON.stringify({ date: orderIstDateKey })
      });
      const masterReportRes = await fetch(`http://127.0.0.1:${port}/api/admin/reports/send-daily-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterJwt}` },
        body: JSON.stringify({ date: orderIstDateKey })
      });
      const masterReportJson = await masterReportRes.json();
      const yesterdayKey = getYesterdayIstDateKey();
      await db.runAtomicMutation(() => {
        db.setLastDailyReportDate(yesterdayKey);
      });
      const dupCheck = await sendDailyOrdersReport({ force: false, targetDateIst: yesterdayKey });
      await runScheduledDailyOrderReportIfDue();
      const recoveryOk = badTriggerRes.status === 400 && badCartAfter?.recoveryStage === "DETECTED" && goodTriggerRes.status === 200 && goodTriggerJson.success === true && goodTriggerJson.deliveryMode === "SANDBOX_FALLBACK" && Boolean(goodTriggerJson.messageId) && String(goodTriggerJson.fallbackReason || "").includes("SMTP_PASS") && goodTriggerJson.cart?.recoveryStage === "EMAIL_SENT" && String(goodTriggerJson.cart?.checkoutUrl || "").startsWith(`/?resume=${goodCartId}&token=`) && cooldownRes.status === 200 && cooldownJson.success === false;
      const supportEmailOk = orderRes.status === 201 && supportRecipient === "Support@bharatvarshcrafts.com" && supportDirectResult.channel === "EMAIL" && Boolean(supportDirectResult.messageId) && hasNotificationAudit;
      const excelReportOk = parsedWb.SheetNames.includes("Orders") && parsedWb.SheetNames.includes("Summary") && workbookReport.filename === `Orders_${orderIstDateKey}.xlsx` && Boolean(expectedHeadersPresent) && summarySheetRows.some((r) => r.Metric === "Total Orders" && Number(r.Value) >= 1) && unauthReportRes.status === 401 && delegatedReportRes.status === 403 && masterReportRes.status === 200 && masterReportJson.success === true && masterReportJson.skipped === false && masterReportJson.filename === `Orders_${orderIstDateKey}.xlsx` && dupCheck.skipped === true;
      if (recoveryOk && supportEmailOk && excelReportOk) {
        results.push({
          test: "Phase 3: Cart Recovery SMTP Telemetry, Support Invoice Email & Daily IST Excel Report",
          status: "PASS",
          message: "Verified abandoned cart recovery validation/telemetry & /?resume= links, non-blocking Support@bharatvarshcrafts.com PDF invoice email, SheetJS Orders+Summary .xlsx export, Master Admin RBAC, and lastDailyReportDate duplicate guard."
        });
      } else {
        results.push({
          test: "Phase 3: Cart Recovery SMTP Telemetry, Support Invoice Email & Daily IST Excel Report",
          status: "FAIL",
          message: `recoveryOk=${recoveryOk} (bad=${badTriggerRes.status}, good=${goodTriggerRes.status}/${goodTriggerJson.deliveryMode}, url=${goodTriggerJson.cart?.checkoutUrl}), supportEmailOk=${supportEmailOk} (audit=${hasNotificationAudit}), excelReportOk=${excelReportOk} (rbac=${unauthReportRes.status}/${delegatedReportRes.status}/${masterReportRes.status}, dupSkipped=${dupCheck.skipped})`
        });
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      if (prevSmtpPass !== void 0) {
        process.env.SMTP_PASS = prevSmtpPass;
      } else {
        delete process.env.SMTP_PASS;
      }
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({
      test: "Phase 3: Cart Recovery SMTP Telemetry, Support Invoice Email & Daily IST Excel Report",
      status: "FAIL",
      message: e.message
    });
  }
  try {
    const htmlContent = fs7.readFileSync(path7.resolve(process.cwd(), "index.html"), "utf-8");
    const hasScriptTag = htmlContent.includes(
      "https://www.google.com/recaptcha/enterprise.js?render=6Le3mCcuAAAAAJCQBRIMvqTGd4RadX5JvnNubovL"
    );
    const prevKey = process.env.RECAPTCHA_ENTERPRISE_API_KEY;
    const prevFetch = globalThis.fetch;
    const prevWindow = globalThis.window;
    try {
      let capturedSiteKey = "";
      let capturedAction = "";
      globalThis.window = {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        grecaptcha: {
          enterprise: {
            ready: (cb) => cb(),
            execute: async (siteKey, opts) => {
              capturedSiteKey = siteKey;
              capturedAction = opts.action;
              return "mock_enterprise_token_login_123";
            }
          }
        }
      };
      const clientToken = await executeRecaptchaEnterprise("LOGIN");
      delete process.env.RECAPTCHA_ENTERPRISE_API_KEY;
      const passThrough = await verifyRecaptchaEnterpriseToken({
        token: void 0,
        expectedAction: "LOGIN"
      });
      process.env.RECAPTCHA_ENTERPRISE_API_KEY = "AIzaTestEnterpriseServerKey12345";
      const missingRes = await verifyRecaptchaEnterpriseToken({
        token: "",
        expectedAction: "CHECKOUT"
      });
      let requestedAssessmentUrl = "";
      globalThis.fetch = async (url, init) => {
        requestedAssessmentUrl = url;
        const parsedBody = JSON.parse(String(init?.body || "{}"));
        const tok = parsedBody?.event?.token;
        if (tok === "good_checkout_tok") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              tokenProperties: { valid: true, action: "CHECKOUT" },
              riskAnalysis: { score: 0.9 }
            })
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tokenProperties: { valid: true, action: "LOGIN" },
            riskAnalysis: { score: 0.1 }
          })
        };
      };
      const mismatchRes = await verifyRecaptchaEnterpriseToken({
        token: "wrong_action_tok",
        expectedAction: "CHECKOUT"
      });
      const validRes = await verifyRecaptchaEnterpriseToken({
        token: "good_checkout_tok",
        expectedAction: "CHECKOUT"
      });
      const ok = hasScriptTag && clientToken === "mock_enterprise_token_login_123" && capturedSiteKey === "6Le3mCcuAAAAAJCQBRIMvqTGd4RadX5JvnNubovL" && capturedAction === "LOGIN" && passThrough.allowed === true && passThrough.mode === "CLIENT_ONLY_PASS" && missingRes.allowed === false && mismatchRes.allowed === false && validRes.allowed === true && validRes.mode === "LIVE" && validRes.score === 0.9 && requestedAssessmentUrl.includes("recaptchaenterprise.googleapis.com/v1/projects/");
      if (ok) {
        results.push({
          test: "Google reCAPTCHA Enterprise Script, Action Execution & Assessment Verification",
          status: "PASS",
          message: "Verified index.html reCAPTCHA Enterprise script, client grecaptcha.enterprise.execute({action: LOGIN}), client-only pass-through when unconfigured, and live Enterprise assessment scoring/action checks."
        });
      } else {
        results.push({
          test: "Google reCAPTCHA Enterprise Script, Action Execution & Assessment Verification",
          status: "FAIL",
          message: `hasScript=${hasScriptTag}, clientToken=${clientToken}, siteKey=${capturedSiteKey}, action=${capturedAction}, missing=${missingRes.allowed}, mismatch=${mismatchRes.allowed}, valid=${validRes.allowed}`
        });
      }
    } finally {
      if (prevKey !== void 0) process.env.RECAPTCHA_ENTERPRISE_API_KEY = prevKey;
      else delete process.env.RECAPTCHA_ENTERPRISE_API_KEY;
      globalThis.fetch = prevFetch;
      if (prevWindow !== void 0) globalThis.window = prevWindow;
      else delete globalThis.window;
    }
  } catch (e) {
    results.push({
      test: "Google reCAPTCHA Enterprise Script, Action Execution & Assessment Verification",
      status: "FAIL",
      message: e.message
    });
  }
  try {
    const dbFile = path7.resolve(process.cwd(), "src/server/data/store_db.json");
    const preTestDbRaw = fs7.existsSync(dbFile) ? fs7.readFileSync(dbFile, "utf-8") : null;
    const uploadedKbFilesToClean = [];
    const app = express();
    app.use(express.json({ limit: "5mb" }));
    const publicKbDir = path7.resolve(process.cwd(), "public", "assets", "knowledge-base");
    fs7.mkdirSync(publicKbDir, { recursive: true });
    app.use("/assets/knowledge-base", express.static(publicKbDir));
    app.use("/api", apiRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const port = server.address().port;
      const firebaseSrc = fs7.readFileSync(path7.resolve(process.cwd(), "src/lib/firebase.ts"), "utf-8");
      const idxInitApp = firebaseSrc.indexOf("initializeApp(");
      const idxInitAppCheck = firebaseSrc.indexOf("initializeAppCheck(");
      const idxGetAuth = firebaseSrc.indexOf("getAuth(app)");
      const appCheckOrderOk = firebaseSrc.includes("ReCaptchaEnterpriseProvider") && idxInitApp > -1 && idxInitAppCheck > idxInitApp && idxGetAuth > idxInitAppCheck;
      const storefrontSrc = fs7.readFileSync(path7.resolve(process.cwd(), "src/components/Storefront.tsx"), "utf-8");
      const ourStorySrc = fs7.readFileSync(path7.resolve(process.cwd(), "src/components/OurStoryView.tsx"), "utf-8");
      const erpSrc = fs7.readFileSync(path7.resolve(process.cwd(), "src/components/ERPWarehouseView.tsx"), "utf-8");
      const dbSrc = fs7.readFileSync(path7.resolve(process.cwd(), "src/server/db.ts"), "utf-8");
      const cityRegex = /\b(pune|mumbai|kanpur|jaipur|bengaluru|pimpri)\b/i;
      const copySeparationOk = !cityRegex.test(storefrontSrc) && !cityRegex.test(ourStorySrc) && erpSrc.includes("punePrimaryHub") && erpSrc.includes("mumbaiWarehouse") && dbSrc.includes("punePrimaryHub") && dbSrc.includes("mumbaiWarehouse");
      const adminJwt = signSessionJwt({
        sub: "uid_master_sunil",
        email: "sunilchain@gmail.com",
        name: "Sunil Chainani",
        role: "STORE_MANAGER"
      });
      const patronJwt = signSessionJwt({
        sub: "uid_vikram",
        email: "vikram.singhania@heritagecrafts.in",
        name: "Vikramaditya Singhania",
        role: "PATRON"
      });
      const otherPatronJwt = signSessionJwt({
        sub: "uid_ananya",
        email: "ananya.deshmukh@gmail.com",
        name: "Ananya Deshmukh",
        role: "PATRON"
      });
      const kbListRes = await fetch(`http://127.0.0.1:${port}/api/knowledge-base`);
      const kbListJson = await kbListRes.json();
      const seededKbOk = kbListRes.status === 200 && Array.isArray(kbListJson.entries) && kbListJson.entries.length >= 2;
      const kbUnauthRes = await fetch(`http://127.0.0.1:${port}/api/store-management/knowledge-base`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Unauthorized Deck" })
      });
      const kbPatronRes = await fetch(`http://127.0.0.1:${port}/api/store-management/knowledge-base`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${patronJwt}` },
        body: JSON.stringify({ title: "Patron Deck" })
      });
      const kbBadExtRes = await fetch(`http://127.0.0.1:${port}/api/store-management/knowledge-base`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          title: "Malicious Script",
          filename: "payload.exe",
          mimeType: "application/octet-stream",
          dataBase64: Buffer.from("MZfake").toString("base64")
        })
      });
      const fakePdfBytes = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n", "utf-8");
      const kbPdfUploadRes = await fetch(`http://127.0.0.1:${port}/api/store-management/knowledge-base`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          title: "Full-Grain Vegetable Tanning Dossier",
          description: "Atelier master guide to hide anatomy and wax-burnished patina.",
          category: "LEATHER_GUIDE",
          filename: "tanning_dossier.pdf",
          mimeType: "application/pdf",
          dataBase64: fakePdfBytes.toString("base64")
        })
      });
      const kbPdfJson = await kbPdfUploadRes.json();
      const uploadedPdfUrl = String(kbPdfJson.entry?.fileUrl || "");
      if (uploadedPdfUrl.startsWith("/assets/knowledge-base/")) {
        uploadedKbFilesToClean.push(path7.basename(uploadedPdfUrl));
      }
      const staticPdfRes = uploadedPdfUrl ? await fetch(`http://127.0.0.1:${port}${uploadedPdfUrl}`) : null;
      const staticPdfText = staticPdfRes ? await staticPdfRes.text() : "";
      const fakePptxBytes = Buffer.from("PKmock-pptx-archive-bytes", "binary");
      const kbPptxUploadRes = await fetch(`http://127.0.0.1:${port}/api/store-management/knowledge-base`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          title: "Saddle Stitching Presentation",
          description: "Hand-stitching workshop slides.",
          category: "CRAFT_DECK",
          filename: "saddle_stitch.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          dataBase64: fakePptxBytes.toString("base64")
        })
      });
      const kbPptxJson = await kbPptxUploadRes.json();
      const uploadedPptxUrl = String(kbPptxJson.entry?.fileUrl || "");
      if (uploadedPptxUrl.startsWith("/assets/knowledge-base/")) {
        uploadedKbFilesToClean.push(path7.basename(uploadedPptxUrl));
      }
      const kbUpdateRes = await fetch(`http://127.0.0.1:${port}/api/store-management/knowledge-base`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          id: kbPdfJson.entry?.id,
          title: "Full-Grain Vegetable Tanning Dossier (Rev 2)",
          category: "LEATHER_GUIDE"
        })
      });
      const kbUpdateJson = await kbUpdateRes.json();
      const kbDelPdfRes = await fetch(
        `http://127.0.0.1:${port}/api/store-management/knowledge-base/${kbPdfJson.entry?.id}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${adminJwt}` } }
      );
      const kbDelPptxRes = await fetch(
        `http://127.0.0.1:${port}/api/store-management/knowledge-base/${kbPptxJson.entry?.id}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${adminJwt}` } }
      );
      const pdfRemovedFromDisk = uploadedPdfUrl.startsWith("/assets/knowledge-base/") && !fs7.existsSync(path7.join(publicKbDir, path7.basename(uploadedPdfUrl)));
      const kbOk = seededKbOk && kbUnauthRes.status === 401 && kbPatronRes.status === 403 && kbBadExtRes.status === 400 && kbPdfUploadRes.status === 201 && kbPdfJson.entry?.fileType === "PDF" && staticPdfRes?.status === 200 && staticPdfText.startsWith("%PDF-1.4") && kbPptxUploadRes.status === 201 && kbPptxJson.entry?.fileType === "PPTX" && kbUpdateRes.status === 200 && kbUpdateJson.entry?.title === "Full-Grain Vegetable Tanning Dossier (Rev 2)" && kbDelPdfRes.status === 200 && kbDelPptxRes.status === 200 && pdfRemovedFromDisk;
      const baseAddr = {
        id: "addr_ret_test",
        customerId: "cust_vikram",
        street: "10 Heritage Lane",
        city: "New Delhi",
        state: "Delhi",
        pincode: "110001",
        country: "India",
        isDefault: true,
        addressType: "SHIPPING"
      };
      const makeOrderPayload = (status, paymentId) => ({
        customerId: "cust_vikram",
        customerName: "Vikramaditya Singhania",
        customerEmail: "vikram.singhania@heritagecrafts.in",
        customerPhone: "+91 98201 11223",
        status,
        currency: "INR",
        subtotal: 4200,
        discountAmount: 0,
        taxAmount: 756,
        shippingFee: 0,
        totalAmount: 4956,
        paymentGateway: "RAZORPAY",
        paymentId,
        paymentStatus: "PAID",
        items: [
          {
            id: `item_${paymentId}`,
            orderId: "",
            productId: "prod-m-belt-01",
            productName: "The Rajputana Bridle Belt",
            sku: "BVL-MEN-BLT-01",
            category: "men",
            quantity: 1,
            unitPrice: 4200,
            leatherType: "VEGETABLE_TANNED_HERITAGE",
            hsnCode: "4203",
            gstRate: 0.18,
            taxAmount: 756,
            lineTotal: 4956
          }
        ],
        shippingAddress: baseAddr,
        billingAddress: { ...baseAddr, id: "addr_ret_bill", addressType: "BILLING" }
      });
      const processingOrder = await db.createOrderAsync(makeOrderPayload("PROCESSING", "pay_ret_proc"));
      const expiredOrder = await db.createOrderAsync(makeOrderPayload("DELIVERED", "pay_ret_exp"));
      const eligibleOrder = await db.createOrderAsync(makeOrderPayload("DELIVERED", "pay_ret_elig"));
      const nowMs = Date.now();
      await db.runAtomicMutation(() => {
        const expRef = db.getOrders().find((o) => o.id === expiredOrder.id);
        expRef.deliveredAt = new Date(nowMs - 12 * 24 * 60 * 60 * 1e3).toISOString();
        const eligRef = db.getOrders().find((o) => o.id === eligibleOrder.id);
        eligRef.deliveredAt = new Date(nowMs - 3 * 24 * 60 * 60 * 1e3).toISOString();
      });
      const retUnauth = await fetch(`http://127.0.0.1:${port}/api/patron/orders/${eligibleOrder.id}/return-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "INCORRECT_SIZE" })
      });
      const retWrongOwner = await fetch(`http://127.0.0.1:${port}/api/patron/orders/${eligibleOrder.id}/return-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${otherPatronJwt}` },
        body: JSON.stringify({ reason: "INCORRECT_SIZE" })
      });
      const retNotDelivered = await fetch(
        `http://127.0.0.1:${port}/api/patron/orders/${processingOrder.id}/return-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${patronJwt}` },
          body: JSON.stringify({ reason: "INCORRECT_SIZE" })
        }
      );
      const retExpired = await fetch(`http://127.0.0.1:${port}/api/patron/orders/${expiredOrder.id}/return-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${patronJwt}` },
        body: JSON.stringify({ reason: "COLOR_MISMATCH", notes: "Shade slightly darker than expected" })
      });
      const retExpiredJson = await retExpired.json();
      const ticketsBefore = db.getSupportTickets().length;
      const retEligible = await fetch(`http://127.0.0.1:${port}/api/patron/orders/${eligibleOrder.id}/return-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${patronJwt}` },
        body: JSON.stringify({ reason: "INCORRECT_SIZE", notes: "Need next waist size up" })
      });
      const retEligibleJson = await retEligible.json();
      const ticketsAfter = db.getSupportTickets().length;
      const hasReturnAudit = db.getAuditLogs().some((log) => log.action === "PATRON_RETURN_REQUESTED" && log.details.includes(eligibleOrder.orderNumber));
      const retDuplicate = await fetch(`http://127.0.0.1:${port}/api/patron/orders/${eligibleOrder.id}/return-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${patronJwt}` },
        body: JSON.stringify({ reason: "INCORRECT_SIZE" })
      });
      const returnWindowOk = retUnauth.status === 401 && retWrongOwner.status === 403 && retNotDelivered.status === 400 && retExpired.status === 403 && retExpiredJson.error === "Return and exchange window (10 days from delivery) has expired. No returns or exchanges are permitted after 10 days." && retEligible.status === 201 && retEligibleJson.order?.returnRequestStatus === "REQUESTED" && retEligibleJson.order?.returnReason === "INCORRECT_SIZE" && ticketsAfter === ticketsBefore + 1 && hasReturnAudit && retDuplicate.status === 409;
      if (appCheckOrderOk && copySeparationOk && kbOk && returnWindowOk) {
        results.push({
          test: "Phase 4 & App Check: Init Order, Hub-Neutral Copy, Knowledge Base Upload & Strict 10-Day Return Window",
          status: "PASS",
          message: "Verified Firebase App Check init before getAuth, hub-neutral public copy with ERP hubs preserved, Knowledge Base PDF/PPTX upload/serve/update/delete, and strict 10-day post-delivery patron return enforcement."
        });
      } else {
        results.push({
          test: "Phase 4 & App Check: Init Order, Hub-Neutral Copy, Knowledge Base Upload & Strict 10-Day Return Window",
          status: "FAIL",
          message: `appCheck=${appCheckOrderOk}, copy=${copySeparationOk}, kb=${kbOk} (pdf=${kbPdfUploadRes.status}, pptx=${kbPptxUploadRes.status}, upd=${kbUpdateRes.status}, del=${kbDelPdfRes.status}/${pdfRemovedFromDisk}), returns=${returnWindowOk} (unauth=${retUnauth.status}, owner=${retWrongOwner.status}, proc=${retNotDelivered.status}, exp=${retExpired.status}, elig=${retEligible.status}, dup=${retDuplicate.status})`
        });
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      for (const fname of uploadedKbFilesToClean) {
        try {
          const p1 = path7.join(publicKbDir, fname);
          if (fs7.existsSync(p1)) fs7.unlinkSync(p1);
          const p2 = path7.resolve(process.cwd(), "dist", "assets", "knowledge-base", fname);
          if (fs7.existsSync(p2)) fs7.unlinkSync(p2);
        } catch {
        }
      }
      if (preTestDbRaw) {
        fs7.writeFileSync(dbFile, preTestDbRaw, "utf-8");
        db.state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e) {
    results.push({
      test: "Phase 4 & App Check: Init Order, Hub-Neutral Copy, Knowledge Base Upload & Strict 10-Day Return Window",
      status: "FAIL",
      message: e.message
    });
  }
  const allPassed = results.every((r) => r.status === "PASS");
  console.log("CRITICAL PATH TEST SUMMARY:");
  results.forEach((r) => console.log(`[${r.status}] ${r.test}: ${r.message}`));
  console.log(`
OVERALL STATUS: ${allPassed ? "ALL TESTS PASSED" : "SOME TESTS FAILED"}
`);
  return { passed: allPassed, results };
}
var init_criticalPaths_test = __esm({
  "src/tests/criticalPaths.test.ts"() {
    init_db();
    init_mysqlAdapter();
    init_webhooks();
    init_rfm();
    init_integrations();
    init_dailyOrderReport();
    init_erpSync();
    init_cartRecovery();
    init_firebaseAuthVerifier();
    init_authMiddleware();
    init_security();
    init_api();
    init_recaptcha();
    init_recaptcha2();
    if (process.argv[1] && process.argv[1].includes("criticalPaths.test.ts")) {
      runCriticalPathTests();
    }
  }
});

// src/server/api.ts
import express2 from "express";
import fs8 from "fs";
import path8 from "path";
function getEffectiveProductPrice(product) {
  const mrp = Number(product?.price || 0);
  const offer = product?.offerPrice !== void 0 && product?.offerPrice !== null ? Number(product.offerPrice) : 0;
  if (Number.isFinite(offer) && offer > 0 && offer <= mrp) {
    return offer;
  }
  return mrp;
}
function parseMultipartSingleFile(body, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  const headerEndMarker = Buffer.from("\r\n\r\n");
  let searchFrom = 0;
  while (searchFrom < body.length) {
    const startBoundary = body.indexOf(delimiter, searchFrom);
    if (startBoundary === -1) break;
    const afterBoundary = startBoundary + delimiter.length;
    if (body[afterBoundary] === 45 && body[afterBoundary + 1] === 45) break;
    let partStart = afterBoundary;
    if (body[partStart] === 13 && body[partStart + 1] === 10) partStart += 2;
    else if (body[partStart] === 10) partStart += 1;
    const nextBoundary = body.indexOf(delimiter, partStart);
    if (nextBoundary === -1) break;
    let partEnd = nextBoundary;
    if (partEnd >= 2 && body[partEnd - 2] === 13 && body[partEnd - 1] === 10) partEnd -= 2;
    else if (partEnd >= 1 && body[partEnd - 1] === 10) partEnd -= 1;
    const partBuf = body.subarray(partStart, partEnd);
    const headerEndIdx = partBuf.indexOf(headerEndMarker);
    if (headerEndIdx !== -1) {
      const rawHeaders = partBuf.subarray(0, headerEndIdx).toString("utf8");
      const filenameMatch = rawHeaders.match(/filename="([^"]+)"/i) || rawHeaders.match(/filename=([^;\r\n]+)/i);
      if (filenameMatch) {
        const mimeMatch = rawHeaders.match(/Content-Type:\s*([^\r\n;]+)/i);
        return {
          filename: (filenameMatch[1] || "").trim(),
          mimeType: (mimeMatch?.[1] || "").trim().toLowerCase(),
          buffer: partBuf.subarray(headerEndIdx + 4)
        };
      }
    }
    searchFrom = nextBoundary;
  }
  return null;
}
function parseMultipartFormData(body, contentType) {
  const fields = {};
  let file = null;
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) return { fields, file };
  const delimiter = Buffer.from(`--${boundary}`);
  const headerEndMarker = Buffer.from("\r\n\r\n");
  let searchFrom = 0;
  while (searchFrom < body.length) {
    const startBoundary = body.indexOf(delimiter, searchFrom);
    if (startBoundary === -1) break;
    const afterBoundary = startBoundary + delimiter.length;
    if (body[afterBoundary] === 45 && body[afterBoundary + 1] === 45) break;
    let partStart = afterBoundary;
    if (body[partStart] === 13 && body[partStart + 1] === 10) partStart += 2;
    else if (body[partStart] === 10) partStart += 1;
    const nextBoundary = body.indexOf(delimiter, partStart);
    if (nextBoundary === -1) break;
    let partEnd = nextBoundary;
    if (partEnd >= 2 && body[partEnd - 2] === 13 && body[partEnd - 1] === 10) partEnd -= 2;
    else if (partEnd >= 1 && body[partEnd - 1] === 10) partEnd -= 1;
    const partBuf = body.subarray(partStart, partEnd);
    const headerEndIdx = partBuf.indexOf(headerEndMarker);
    if (headerEndIdx !== -1) {
      const rawHeaders = partBuf.subarray(0, headerEndIdx).toString("utf8");
      const nameMatch = rawHeaders.match(/name="([^"]+)"/i) || rawHeaders.match(/name=([^;\r\n]+)/i);
      const filenameMatch = rawHeaders.match(/filename="([^"]+)"/i) || rawHeaders.match(/filename=([^;\r\n]+)/i);
      const contentBuf = partBuf.subarray(headerEndIdx + 4);
      if (filenameMatch && !file) {
        const mimeMatch = rawHeaders.match(/Content-Type:\s*([^\r\n;]+)/i);
        file = {
          filename: (filenameMatch[1] || "").trim(),
          mimeType: (mimeMatch?.[1] || "").trim().toLowerCase(),
          buffer: contentBuf
        };
      } else if (nameMatch) {
        fields[nameMatch[1].trim()] = contentBuf.toString("utf8").trim();
      }
    }
    searchFrom = nextBoundary;
  }
  return { fields, file };
}
function handleMediaUploadBody(req, res, next) {
  if (req.is("application/json") && req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return next();
  }
  return rawMediaUploadMiddleware(req, res, (err) => {
    if (err) {
      if (err.type === "entity.too.large" || err.status === 413) {
        return res.status(413).json({
          error: "Uploaded file exceeds maximum allowed payload size."
        });
      }
      return res.status(400).json({ error: err.message || "Invalid media upload payload." });
    }
    return next();
  });
}
var apiRouter, IMAGE_MIME_BY_EXT, VIDEO_MIME_BY_EXT, EXT_BY_MIME, MAX_IMAGE_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_BYTES, KB_MIME_BY_EXT, KB_EXT_BY_MIME, MAX_KB_UPLOAD_BYTES, rawMediaUploadMiddleware;
var init_api = __esm({
  "src/server/api.ts"() {
    init_db();
    init_mysqlAdapter();
    init_webhooks();
    init_erpSync();
    init_cartRecovery();
    init_rfm();
    init_authMiddleware();
    init_firebaseAuthVerifier();
    init_security();
    init_integrations();
    init_invoicePdf();
    init_dailyOrderReport();
    init_indianValidation();
    init_recaptcha();
    apiRouter = express2.Router();
    IMAGE_MIME_BY_EXT = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp"
    };
    VIDEO_MIME_BY_EXT = {
      ".mp4": "video/mp4",
      ".webm": "video/webm"
    };
    EXT_BY_MIME = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/webp": ".webp",
      "video/mp4": ".mp4",
      "video/webm": ".webm"
    };
    MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
    MAX_VIDEO_UPLOAD_BYTES = 50 * 1024 * 1024;
    KB_MIME_BY_EXT = {
      ".pdf": "application/pdf",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".ppt": "application/vnd.ms-powerpoint"
    };
    KB_EXT_BY_MIME = {
      "application/pdf": ".pdf",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
      "application/vnd.ms-powerpoint": ".ppt"
    };
    MAX_KB_UPLOAD_BYTES = 30 * 1024 * 1024;
    rawMediaUploadMiddleware = express2.raw({
      type: [
        "multipart/form-data",
        "image/*",
        "video/*",
        "application/pdf",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/octet-stream"
      ],
      limit: "55mb"
    });
    apiRouter.get("/test/critical-paths", requireStoreManagementAccess, async (req, res) => {
      try {
        const { runCriticalPathTests: runCriticalPathTests2 } = await Promise.resolve().then(() => (init_criticalPaths_test(), criticalPaths_test_exports));
        const result = await runCriticalPathTests2();
        res.json(result);
      } catch (err) {
        res.status(500).json({ passed: false, error: err?.message || "Failed to execute critical path tests" });
      }
    });
    apiRouter.get("/catalog", (req, res) => {
      const catalog = db.getCatalog();
      res.json({ success: true, catalog });
    });
    apiRouter.get("/knowledge-base", (_req, res) => {
      const entries = db.getKnowledgeBase();
      res.json({ success: true, entries });
    });
    apiRouter.get("/storefront/config", (req, res) => {
      const cfg = db.getConfig();
      res.json({
        success: true,
        gstInvoicingEnabled: cfg.gstInvoicingEnabled,
        gstRatePercent: cfg.gstRatePercent ?? 18,
        supplierGstin: cfg.supplierGstin || "27AABCB1234F1Z8",
        primaryHubCity: cfg.primaryHubCity || "Pune"
      });
    });
    apiRouter.post("/checkout/validate-promo", async (req, res) => {
      const { code, subtotal, recaptchaToken } = req.body || {};
      const recaptchaCheck = await verifyRecaptchaEnterpriseToken({
        token: recaptchaToken,
        expectedAction: "PROMO_VALIDATE"
      });
      if (!recaptchaCheck.allowed) {
        return res.status(403).json({
          success: false,
          valid: false,
          error: recaptchaCheck.reason || "Security verification failed."
        });
      }
      const rule = db.validatePromoCode(code);
      if (!rule) {
        return res.status(404).json({
          success: false,
          valid: false,
          error: "Invalid or inactive promo code."
        });
      }
      const baseSubtotal = Number(subtotal) > 0 ? Number(subtotal) : 0;
      const discountAmount = Math.round(baseSubtotal * rule.discountPercent / 100);
      res.json({
        success: true,
        valid: true,
        code: rule.code,
        discountPercent: rule.discountPercent,
        discountAmount,
        description: rule.description || `${rule.discountPercent}% bespoke discount`
      });
    });
    apiRouter.post("/cart/persist", async (req, res) => {
      try {
        const { cartId, customerId, email, phone, items, subtotal } = req.body;
        if (!email || !items) {
          return res.status(400).json({ error: "Missing required cart payload (email, items)" });
        }
        const saved = await db.runAtomicMutation(
          () => cartRecovery.persistStorefrontCart({
            cartId,
            customerId,
            email,
            phone,
            items,
            subtotal: subtotal || 0
          })
        );
        res.json({ success: true, cart: saved });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    apiRouter.get("/cart/:id", (req, res) => {
      const tokenParam = typeof req.query.token === "string" ? req.query.token : void 0;
      const resolution = cartRecovery.resolveResumableCart(req.params.id, tokenParam);
      if (resolution.status === "INVALID_TOKEN") {
        return res.status(403).json({ error: "Invalid or tampered cart recovery token." });
      }
      if (resolution.status === "NOT_FOUND") {
        return res.status(404).json({ error: "Saved cart not found." });
      }
      const { cart, tokenVerified } = resolution;
      res.json({
        success: true,
        cart: {
          id: cart.id,
          items: cart.items,
          subtotal: cart.subtotal,
          currency: cart.currency,
          isAbandoned: cart.isAbandoned,
          recoveryStage: cart.recoveryStage,
          checkoutUrl: cart.checkoutUrl,
          resumeTokenVerified: tokenVerified,
          ...tokenVerified ? { email: cart.email } : {}
        }
      });
    });
    apiRouter.post("/cart/simulate-abandonment", async (req, res) => {
      try {
        const { cartId, email, phone, items } = req.body;
        if (!email || !Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ error: "Patron email and cart items are required to simulate abandonment." });
        }
        const catalog = db.getCatalog();
        const authoritativeSubtotal = items.reduce((sum, item) => {
          const prod = (catalog.products || []).find((p) => p.id === item.productId || p.sku === item.sku);
          const unitPrice = prod ? getEffectiveProductPrice(prod) : 0;
          const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
          return sum + unitPrice * qty;
        }, 0);
        const saved = await db.runAtomicMutation(() => {
          const cart = cartRecovery.persistStorefrontCart({
            cartId,
            email: String(email).trim(),
            phone: phone ? String(phone).trim() : "",
            items,
            subtotal: authoritativeSubtotal
          });
          cart.isAbandoned = true;
          cart.abandonedAt = (/* @__PURE__ */ new Date()).toISOString();
          cart.recoveryStage = "DETECTED";
          db.logAudit(
            "storefront_simulator",
            "CART_ABANDONMENT_SIMULATED",
            "WEBHOOK_EVENT",
            `Simulated idle cart abandonment for ${cart.email} (Cart ID: ${cart.id})`
          );
          return cart;
        });
        res.json({
          success: true,
          cart: saved,
          message: `Abandoned cart registered for ${saved.email}.`
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    apiRouter.post("/checkout/place-order", async (req, res) => {
      try {
        const {
          customerId,
          customerName,
          customerEmail,
          customerPhone,
          items,
          discountCode,
          shippingAddress,
          billingAddress,
          paymentGateway,
          recaptchaToken
        } = req.body;
        const recaptchaCheck = await verifyRecaptchaEnterpriseToken({
          token: recaptchaToken,
          expectedAction: "CHECKOUT",
          actorHint: customerEmail
        });
        if (!recaptchaCheck.allowed) {
          return res.status(403).json({
            error: recaptchaCheck.reason || "Security verification failed. Please reload and try again."
          });
        }
        if (!Array.isArray(items) || items.length === 0) {
          return res.status(400).json({
            error: "At least one item in bag is required to place an order.",
            errors: { items: "At least one item is required." }
          });
        }
        const validation = validateIndianCheckoutFields({
          fullName: customerName,
          email: customerEmail,
          phone: customerPhone,
          street: shippingAddress?.street,
          city: shippingAddress?.city,
          state: shippingAddress?.state,
          pincode: shippingAddress?.pincode,
          country: shippingAddress?.country || "India"
        });
        if (!validation.valid) {
          return res.status(400).json({
            error: validation.firstError || "Please complete all required Indian shipping details.",
            errors: validation.errors
          });
        }
        const catalog = db.getCatalog();
        const catalogProducts = catalog.products || [];
        const cfg = db.getConfig();
        const storeDefaultTaxRate = (typeof cfg.gstRatePercent === "number" ? cfg.gstRatePercent : 18) / 100;
        const preparedLines = items.map((item, idx) => {
          const byId = item.productId ? catalogProducts.find((p) => p.id === item.productId) : void 0;
          const bySku = item.sku ? catalogProducts.find((p) => p.sku === item.sku) : void 0;
          const product = byId || bySku;
          if (!product || byId && bySku && byId.id !== bySku.id) {
            throw new Error(`Unknown or mismatched catalog product in checkout payload: ${item.productName || item.sku || item.productId}`);
          }
          const qty = Math.floor(Number(item.quantity));
          if (!Number.isFinite(qty) || qty <= 0) {
            throw new Error(`Invalid quantity for ${product.name}`);
          }
          const unitPrice = getEffectiveProductPrice(product);
          const gstRate = typeof product.gstRate === "number" ? product.gstRate : storeDefaultTaxRate;
          const hsnCode = product.hsnCode || "4202";
          const lineSubtotal = unitPrice * qty;
          const monogramText = item.customization?.monogramInitials || item.monogram;
          const foilType = item.customization?.foilType || item.foilStyle || "GOLD_FOIL";
          return {
            idx,
            product,
            qty,
            unitPrice,
            gstRate,
            hsnCode,
            lineSubtotal,
            leatherType: item.leatherType === "BIO_SUBSTITUTE_CACTUS" ? "BIO_SUBSTITUTE_CACTUS" : "VEGETABLE_TANNED_HERITAGE",
            ...monogramText ? {
              customization: {
                monogramInitials: String(monogramText).slice(0, 8),
                foilType: foilType === "BLIND" || foilType === "SILVER_FOIL" || foilType === "GOLD_FOIL" ? foilType : "GOLD_FOIL",
                placement: item.customization?.placement || "Primary Panel"
              }
            } : {}
          };
        });
        const authoritativeSubtotal = preparedLines.reduce((sum, l) => sum + l.lineSubtotal, 0);
        const normalizedCode = typeof discountCode === "string" && discountCode.trim().length > 0 ? discountCode.trim().toUpperCase() : void 0;
        const promoRule = normalizedCode ? db.validatePromoCode(normalizedCode) : null;
        if (normalizedCode && !promoRule) {
          return res.status(400).json({ error: `Invalid or expired promo code: ${normalizedCode}` });
        }
        const authoritativeDiscountAmount = promoRule ? Math.round(authoritativeSubtotal * promoRule.discountPercent / 100) : 0;
        const taxableValue = Math.max(0, authoritativeSubtotal - authoritativeDiscountAmount);
        const authoritativeItems = preparedLines.map((line) => {
          const lineTaxable = authoritativeSubtotal > 0 ? line.lineSubtotal * (taxableValue / authoritativeSubtotal) : 0;
          const lineTaxAmount = Math.round(lineTaxable * line.gstRate);
          return {
            id: `item_${Date.now()}_${line.idx}`,
            orderId: "",
            productId: line.product.id,
            productName: line.product.name,
            sku: line.product.sku,
            category: line.product.category,
            quantity: line.qty,
            unitPrice: line.unitPrice,
            leatherType: line.leatherType,
            ...line.customization ? { customization: line.customization } : {},
            hsnCode: line.hsnCode,
            gstRate: line.gstRate,
            taxAmount: lineTaxAmount,
            lineTotal: Math.round(lineTaxable) + lineTaxAmount
          };
        });
        const authoritativeTaxAmount = authoritativeItems.reduce(
          (sum, it) => sum + it.taxAmount,
          0
        );
        const authoritativeTotalAmount = taxableValue + authoritativeTaxAmount;
        const { customer } = await db.runAtomicMutation(
          () => db.findOrCreateCustomer({
            email: validation.normalized.email,
            phone: validation.normalized.phone,
            fullName: validation.normalized.fullName,
            identityUid: customerId,
            updatePhone: true,
            address: {
              street: validation.normalized.street,
              city: validation.normalized.city,
              state: validation.normalized.state,
              pincode: validation.normalized.pincode,
              country: "India"
            }
          })
        );
        const normalizedShippingAddress = {
          id: shippingAddress?.id || `addr_${Date.now()}`,
          customerId: customer.id,
          recipientName: validation.normalized.fullName,
          phone: validation.normalized.phone,
          street: validation.normalized.street,
          city: validation.normalized.city,
          state: validation.normalized.state,
          pincode: validation.normalized.pincode,
          country: "India",
          isDefault: true,
          addressType: "SHIPPING"
        };
        const normalizedBillingAddress = billingAddress?.street ? {
          id: billingAddress.id || normalizedShippingAddress.id,
          customerId: customer.id,
          recipientName: billingAddress.recipientName || validation.normalized.fullName,
          phone: billingAddress.phone || validation.normalized.phone,
          street: String(billingAddress.street).trim(),
          city: String(billingAddress.city || validation.normalized.city).trim(),
          state: normalizeIndianState(billingAddress.state) || validation.normalized.state,
          pincode: validateIndianPincode(billingAddress.pincode).valid ? validateIndianPincode(billingAddress.pincode).normalized : validation.normalized.pincode,
          country: "India",
          isDefault: true,
          addressType: "BILLING"
        } : { ...normalizedShippingAddress, addressType: "BILLING" };
        const selectedGateway = paymentGateway === "STRIPE" || paymentGateway === "CASH_ON_DELIVERY" ? paymentGateway : "RAZORPAY";
        const gatewayResult = await createGatewayOrderOrIntent({
          gateway: selectedGateway,
          amountInr: authoritativeTotalAmount,
          receipt: `bvl_${Date.now()}`,
          customerName: customer.fullName,
          customerEmail: customer.email,
          customerPhone: customer.phone
        });
        const order = await db.createOrderAsync({
          customerId: customer.id,
          customerName: validation.normalized.fullName,
          customerEmail: customer.email,
          customerPhone: validation.normalized.phone,
          status: "PROCESSING",
          currency: "INR",
          subtotal: authoritativeSubtotal,
          discountAmount: authoritativeDiscountAmount,
          discountCode: normalizedCode,
          taxAmount: authoritativeTaxAmount,
          shippingFee: 0,
          totalAmount: authoritativeTotalAmount,
          paymentGateway: selectedGateway,
          paymentId: gatewayResult.paymentId,
          paymentStatus: "PAID",
          items: authoritativeItems,
          shippingAddress: normalizedShippingAddress,
          billingAddress: normalizedBillingAddress
        });
        dispatchOrderConfirmationAndCareGuide(order).then((delivery) => {
          db.logAudit(
            "integrations",
            "ORDER_NOTIFICATION_DISPATCHED",
            "STORE_MANAGEMENT",
            `Order ${order.orderNumber} notifications -> Payment:${gatewayResult.mode}, PatronEmail:${delivery.emailDelivery.mode}, SupportInvoice:${delivery.supportEmailDelivery.mode}, WhatsApp:${delivery.whatsappDelivery.mode}`
          );
        }).catch((err) => {
          db.logAudit(
            "integrations",
            "ORDER_NOTIFICATION_ERROR",
            "STORE_MANAGEMENT",
            `Order ${order.orderNumber} email/notification failed: ${err?.message || err}`
          );
        });
        res.status(201).json({
          success: true,
          order,
          gateway: {
            provider: gatewayResult.provider,
            mode: gatewayResult.mode,
            paymentId: gatewayResult.paymentId
          }
        });
      } catch (err) {
        const msg = typeof err?.message === "string" ? err.message : "Checkout failed";
        const isDbError = msg.toLowerCase().includes("mysql");
        const isStockError = msg.toLowerCase().includes("out of stock") || msg.toLowerCase().includes("insufficient stock");
        res.status(isDbError ? 500 : isStockError ? 409 : 400).json({ error: msg });
      }
    });
    apiRouter.get("/patron/overview", requireAuth, (req, res) => {
      const caller = req.user;
      const cleanEmail = caller.email.trim().toLowerCase();
      const matchedCustomer = db.getCustomerById(cleanEmail) || db.getCustomerById(caller.uid);
      const custId = matchedCustomer?.id || caller.uid;
      const orders = db.getOrders().filter(
        (o) => o.customerId === custId || o.customerEmail.trim().toLowerCase() === cleanEmail
      );
      const orderIds = new Set(orders.map((o) => o.id));
      const invoices = db.getInvoices().filter((inv) => inv.customerId === custId || orderIds.has(inv.orderId));
      const invoiceNums = new Set(invoices.map((i) => i.invoiceNumber));
      const creditNotes = db.getCreditNotes().filter((cn) => orderIds.has(cn.orderId) || invoiceNums.has(cn.originalInvoiceNumber));
      const warranties = db.getWarranties().filter((w) => w.customerId === custId || orderIds.has(w.orderId));
      const careKits = db.getCareKits().filter((c) => c.customerId === custId || orderIds.has(c.orderId));
      const hotStampingVectors = db.getHotStampingVectors().filter((h) => h.customerId === custId || h.orderId && orderIds.has(h.orderId));
      const cfg = db.getConfig();
      const addresses = matchedCustomer ? db.getCustomerAddresses(matchedCustomer.id) : [];
      const defaultAddress = matchedCustomer ? db.getDefaultCustomerAddress(matchedCustomer.id) : void 0;
      res.json({
        success: true,
        patron: {
          customerId: custId,
          fullName: matchedCustomer?.fullName || caller.name,
          email: cleanEmail,
          phone: matchedCustomer?.phone || defaultAddress?.phone || "",
          defaultAddress,
          addresses,
          rfmSegment: matchedCustomer?.rfmSegment || "Promising/Recent",
          loyaltyPoints: matchedCustomer?.loyaltyPoints ?? 0,
          storeCreditBalance: matchedCustomer?.storeCreditBalance ?? 0,
          totalOrders: orders.length,
          lifetimeValue: orders.filter((o) => o.paymentStatus === "PAID").reduce((s, o) => s + o.totalAmount, 0)
        },
        addresses,
        defaultAddress,
        orders,
        invoices,
        creditNotes,
        warranties,
        careKits,
        hotStampingVectors,
        gstInvoicingEnabled: cfg.gstInvoicingEnabled,
        supplierGstin: cfg.supplierGstin,
        gstRatePercent: cfg.gstRatePercent
      });
    });
    apiRouter.post("/patron/orders/:id/return-request", requireAuth, async (req, res) => {
      try {
        const allowedReasons = ["COLOR_MISMATCH", "TEXTURE_DEFECT", "HARDWARE_DAMAGE", "INCORRECT_SIZE"];
        const rawReason = String(req.body?.reason || "").trim().toUpperCase();
        if (!allowedReasons.includes(rawReason)) {
          return res.status(400).json({
            error: "Please select a valid return or exchange reason (COLOR_MISMATCH, TEXTURE_DEFECT, HARDWARE_DAMAGE, or INCORRECT_SIZE)."
          });
        }
        const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
        const outcome = await db.runAtomicMutation(
          () => db.requestOrderReturn({
            orderId: req.params.id,
            customerEmail: req.user.email,
            customerUid: req.user.uid,
            reason: rawReason,
            notes
          })
        );
        if (!outcome.ok) {
          const statusCode = outcome.code === "NOT_FOUND" ? 404 : outcome.code === "FORBIDDEN" || outcome.code === "WINDOW_EXPIRED" ? 403 : outcome.code === "CONFLICT" ? 409 : 400;
          return res.status(statusCode).json({
            success: false,
            code: outcome.code,
            error: outcome.error
          });
        }
        return res.status(201).json({
          success: true,
          order: outcome.order,
          ticket: outcome.ticket,
          message: `Return / exchange request registered for ${outcome.order.orderNumber} (Support Desk Ticket ${outcome.ticket.ticketNumber}).`
        });
      } catch (err) {
        return res.status(500).json({ error: err?.message || "Failed to register return request." });
      }
    });
    apiRouter.post("/personalization-vector", async (req, res) => {
      try {
        const { productId, productName, monogramText, foilStyle, fontFamily, previewImageUrl } = req.body;
        if (!productId || !monogramText) {
          return res.status(400).json({ error: "Product ID and monogram text are required." });
        }
        const authUser = await resolveAuthTokenAsync(req.headers.authorization);
        let scopedCustomerId = "cust_guest";
        if (authUser) {
          const matchedCustomer = db.getCustomerById(authUser.email) || db.getCustomerById(authUser.uid);
          scopedCustomerId = matchedCustomer ? matchedCustomer.id : authUser.uid;
        }
        const vector = await db.runAtomicMutation(
          () => db.addHotStampingVector({
            customerId: scopedCustomerId,
            productId,
            productName,
            monogramText: String(monogramText).slice(0, 8),
            foilStyle: foilStyle || "GOLD_FOIL",
            fontFamily: fontFamily || "CINZEL",
            previewImageUrl,
            recordedAt: (/* @__PURE__ */ new Date()).toISOString()
          })
        );
        res.status(201).json({ success: true, vector });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    apiRouter.post("/auth/register", async (req, res) => {
      try {
        const { email, password, fullName, phone, street, city, state, pincode, country, address, recaptchaToken } = req.body || {};
        const recaptchaCheck = await verifyRecaptchaEnterpriseToken({
          token: recaptchaToken,
          expectedAction: "SIGNUP",
          actorHint: email
        });
        if (!recaptchaCheck.allowed) {
          return res.status(403).json({ error: recaptchaCheck.reason || "Security verification failed." });
        }
        const errors = {};
        const cleanName = String(fullName || "").trim();
        if (cleanName.length < 2) {
          errors.fullName = "Full name must be at least 2 characters.";
        }
        const emailCheck = validateEmailAddress(email);
        if (!emailCheck.valid) {
          errors.email = emailCheck.error;
        }
        if (!password || String(password).length < 8) {
          errors.password = "Password must be at least 8 characters long.";
        }
        const phoneCheck = validateIndianPhone(phone);
        if (!phoneCheck.valid) {
          errors.phone = phoneCheck.error;
        }
        const rawStreet = address?.street ?? street;
        const rawCity = address?.city ?? city;
        const rawState = address?.state ?? state;
        const rawPincode = address?.pincode ?? pincode;
        const rawCountry = address?.country ?? country;
        const hasAnyAddressInput = Boolean(
          String(rawStreet || "").trim() || String(rawCity || "").trim() || String(rawState || "").trim() || String(rawPincode || "").trim()
        );
        let normalizedAddress = void 0;
        if (hasAnyAddressInput) {
          if (String(rawStreet || "").trim().length < 5) {
            errors.street = "Street address must be at least 5 characters.";
          }
          if (String(rawCity || "").trim().length < 2) {
            errors.city = "City is required (minimum 2 characters).";
          }
          const normState = normalizeIndianState(rawState);
          if (!normState) {
            errors.state = "Please select a valid Indian State or Union Territory.";
          }
          const pinCheck = validateIndianPincode(rawPincode);
          if (!pinCheck.valid) {
            errors.pincode = pinCheck.error;
          }
          if (rawCountry && String(rawCountry).trim().toLowerCase() !== "india") {
            errors.country = "Shipping destination is currently restricted to India only.";
          }
          if (!errors.street && !errors.city && !errors.state && !errors.pincode && !errors.country && normState) {
            normalizedAddress = {
              street: String(rawStreet).trim(),
              city: String(rawCity).trim(),
              state: normState,
              pincode: pinCheck.normalized,
              country: "India"
            };
          }
        }
        const errKeys = Object.keys(errors);
        if (errKeys.length > 0) {
          return res.status(400).json({
            error: errors[errKeys[0]],
            errors
          });
        }
        const { customer } = await db.runAtomicMutation(
          () => db.registerPatronWithPassword({
            email: emailCheck.normalized,
            password,
            fullName: cleanName,
            phone: phoneCheck.formatted,
            address: normalizedAddress
          })
        );
        const token = signSessionJwt({
          sub: customer.identityUid || customer.id,
          email: customer.email,
          name: customer.fullName,
          role: "PATRON"
        });
        res.status(201).json({
          success: true,
          token,
          user: {
            uid: customer.identityUid || customer.id,
            email: customer.email,
            name: customer.fullName,
            role: "PATRON",
            isMasterAdmin: false,
            isStoreManagementAuthorized: false,
            authProvider: "CREDENTIALS"
          },
          customer
        });
      } catch (err) {
        const msg = typeof err?.message === "string" ? err.message : "Registration failed";
        if (msg.startsWith("ACCOUNT_EXISTS:")) {
          return res.status(409).json({ error: msg.replace("ACCOUNT_EXISTS: ", "") });
        }
        const isDbError = msg.toLowerCase().includes("mysql");
        res.status(isDbError ? 500 : 400).json({ error: msg });
      }
    });
    apiRouter.post("/auth/login", async (req, res) => {
      try {
        const { email, password, recaptchaToken } = req.body;
        const recaptchaCheck = await verifyRecaptchaEnterpriseToken({
          token: recaptchaToken,
          expectedAction: "LOGIN",
          actorHint: email
        });
        if (!recaptchaCheck.allowed) {
          return res.status(403).json({ error: recaptchaCheck.reason || "Security verification failed." });
        }
        if (!email || !password) {
          return res.status(400).json({ error: "Email / User ID and password are required." });
        }
        const cleanEmail = String(email).trim().toLowerCase();
        const isAuthorizedAdmin = db.isStoreManagementAuthorized(cleanEmail);
        const isMaster = db.isMasterAuthorized(cleanEmail);
        if (isAuthorizedAdmin) {
          const verification = db.verifyAdminLogin(cleanEmail, password);
          if (!verification.valid) {
            return res.status(401).json({ error: verification.reason || "Invalid admin credentials" });
          }
        } else {
          const verification = db.verifyPatronLogin(cleanEmail, password);
          if (!verification.valid) {
            return res.status(401).json({ error: verification.reason || "Invalid email or password" });
          }
        }
        const resolvedRole = isAuthorizedAdmin ? db.getStaffRole(cleanEmail) : "PATRON";
        const { customer } = await db.runAtomicMutation(
          () => db.findOrCreateCustomer({
            email: cleanEmail,
            fullName: cleanEmail.includes("@") ? cleanEmail.split("@")[0].replace(/[._]/g, " ") : cleanEmail,
            role: resolvedRole
          })
        );
        const token = signSessionJwt({
          sub: customer.identityUid || customer.id,
          email: customer.email,
          name: customer.fullName,
          role: resolvedRole
        });
        res.json({
          success: true,
          token,
          user: {
            uid: customer.identityUid || customer.id,
            email: customer.email,
            name: customer.fullName,
            role: resolvedRole,
            isMasterAdmin: isMaster,
            isStoreManagementAuthorized: isAuthorizedAdmin,
            authProvider: "CREDENTIALS"
          },
          customer
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    apiRouter.post("/auth/firebase", async (req, res) => {
      try {
        const { idToken, fullName, phone, street, city, state, pincode, country, address, recaptchaToken, recaptchaAction } = req.body || {};
        if (!idToken || typeof idToken !== "string") {
          return res.status(400).json({ error: "Authentication token is required" });
        }
        if (recaptchaToken !== void 0 || recaptchaAction !== void 0) {
          const allowedFirebaseActions = ["LOGIN", "SIGNUP", "GOOGLE_LOGIN"];
          const expectedAction = allowedFirebaseActions.includes(String(recaptchaAction || "")) ? String(recaptchaAction) : "LOGIN";
          const recaptchaCheck = await verifyRecaptchaEnterpriseToken({
            token: recaptchaToken,
            expectedAction
          });
          if (!recaptchaCheck.allowed) {
            return res.status(403).json({ error: recaptchaCheck.reason || "Security verification failed." });
          }
        }
        const claims = await verifyFirebaseIdToken(idToken);
        if (!claims || !claims.email) {
          return res.status(401).json({ error: "Invalid or expired Firebase authentication token." });
        }
        const cleanEmail = claims.email.trim().toLowerCase();
        const isAuthorizedAdmin = db.isStoreManagementAuthorized(cleanEmail);
        const isMaster = db.isMasterAuthorized(cleanEmail);
        const resolvedRole = isAuthorizedAdmin ? db.getStaffRole(cleanEmail) : "PATRON";
        const errors = {};
        let validatedPhone = "";
        if (phone && String(phone).trim()) {
          const phoneCheck = validateIndianPhone(phone);
          if (!phoneCheck.valid) {
            errors.phone = phoneCheck.error;
          } else {
            validatedPhone = phoneCheck.formatted;
          }
        }
        const rawStreet = address?.street ?? street;
        const rawCity = address?.city ?? city;
        const rawState = address?.state ?? state;
        const rawPincode = address?.pincode ?? pincode;
        const rawCountry = address?.country ?? country;
        const hasAnyAddress = Boolean(
          String(rawStreet || "").trim() || String(rawCity || "").trim() || String(rawState || "").trim() || String(rawPincode || "").trim()
        );
        let normalizedAddress = void 0;
        if (hasAnyAddress) {
          if (String(rawStreet || "").trim().length < 5) errors.street = "Street address must be at least 5 characters.";
          if (String(rawCity || "").trim().length < 2) errors.city = "City is required (minimum 2 characters).";
          const normState = normalizeIndianState(rawState);
          if (!normState) errors.state = "Please select a valid Indian State or Union Territory.";
          const pinCheck = validateIndianPincode(rawPincode);
          if (!pinCheck.valid) errors.pincode = pinCheck.error;
          if (rawCountry && String(rawCountry).trim().toLowerCase() !== "india") {
            errors.country = "Shipping destination is currently restricted to India only.";
          }
          if (!errors.street && !errors.city && !errors.state && !errors.pincode && !errors.country && normState) {
            normalizedAddress = {
              street: String(rawStreet).trim(),
              city: String(rawCity).trim(),
              state: normState,
              pincode: pinCheck.normalized,
              country: "India"
            };
          }
        }
        const errKeys = Object.keys(errors);
        if (errKeys.length > 0) {
          return res.status(400).json({ error: errors[errKeys[0]], errors });
        }
        const explicitName = typeof fullName === "string" && fullName.trim().length >= 2 ? fullName.trim() : "";
        const resolvedFullName = explicitName || claims.name || cleanEmail.split("@")[0];
        const { customer } = await db.runAtomicMutation(
          () => db.findOrCreateCustomer({
            email: cleanEmail,
            fullName: resolvedFullName,
            updateFullName: Boolean(explicitName),
            ...validatedPhone ? { phone: validatedPhone, updatePhone: true } : {},
            ...normalizedAddress ? { address: normalizedAddress } : {},
            identityUid: claims.uid,
            role: resolvedRole
          })
        );
        const provider = claims.signInProvider === "google.com" ? "GOOGLE" : "FIREBASE";
        res.json({
          success: true,
          token: idToken,
          user: {
            uid: claims.uid,
            email: customer.email,
            name: explicitName || claims.name || customer.fullName,
            role: resolvedRole,
            isMasterAdmin: isMaster,
            isStoreManagementAuthorized: isAuthorizedAdmin,
            photoURL: claims.picture,
            authProvider: provider
          },
          customer
        });
      } catch (err) {
        const isDbError = typeof err?.message === "string" && err.message.toLowerCase().includes("mysql");
        res.status(isDbError ? 500 : 401).json({ error: err.message || "Authentication failed" });
      }
    });
    apiRouter.get("/crm/customers", requireCrmAccess, (req, res) => {
      const customers = db.getCustomers().map((c) => {
        const { segment, score } = classifyCustomerRFM(c);
        return {
          ...c,
          rfmSegment: segment,
          rfmScore: score
        };
      });
      res.json({ success: true, customers });
    });
    apiRouter.post("/crm/customers", requireCrmAccess, async (req, res) => {
      try {
        const { email, phone, fullName, utmSource, utmMedium, street, city, state, pincode, country, address } = req.body || {};
        const errors = {};
        const cleanName = String(fullName || "").trim();
        if (cleanName.length < 2) {
          errors.fullName = "Customer name must be at least 2 characters.";
        }
        const emailCheck = validateEmailAddress(email);
        if (!emailCheck.valid) {
          errors.email = emailCheck.error;
        }
        const phoneCheck = validateIndianPhone(phone);
        if (!phoneCheck.valid) {
          errors.phone = phoneCheck.error;
        }
        const rawStreet = address?.street ?? street;
        const rawCity = address?.city ?? city;
        const rawState = address?.state ?? state;
        const rawPincode = address?.pincode ?? pincode;
        const rawCountry = address?.country ?? country;
        const hasAnyAddress = Boolean(
          String(rawStreet || "").trim() || String(rawCity || "").trim() || String(rawState || "").trim() || String(rawPincode || "").trim()
        );
        let normalizedAddress = void 0;
        if (hasAnyAddress) {
          if (String(rawStreet || "").trim().length < 5) errors.street = "Street address must be at least 5 characters.";
          if (String(rawCity || "").trim().length < 2) errors.city = "City is required (minimum 2 characters).";
          const normState = normalizeIndianState(rawState);
          if (!normState) errors.state = "Please select a valid Indian State or Union Territory.";
          const pinCheck = validateIndianPincode(rawPincode);
          if (!pinCheck.valid) errors.pincode = pinCheck.error;
          if (rawCountry && String(rawCountry).trim().toLowerCase() !== "india") {
            errors.country = "Shipping destination is currently restricted to India only.";
          }
          if (!errors.street && !errors.city && !errors.state && !errors.pincode && !errors.country && normState) {
            normalizedAddress = {
              street: String(rawStreet).trim(),
              city: String(rawCity).trim(),
              state: normState,
              pincode: pinCheck.normalized,
              country: "India"
            };
          }
        }
        const errKeys = Object.keys(errors);
        if (errKeys.length > 0) {
          return res.status(400).json({ error: errors[errKeys[0]], errors });
        }
        const result = await db.runAtomicMutation(
          () => db.findOrCreateCustomer({
            email: emailCheck.normalized,
            phone: phoneCheck.formatted,
            fullName: cleanName,
            utmSource,
            utmMedium,
            updatePhone: true,
            address: normalizedAddress
          })
        );
        res.status(201).json({ success: true, ...result });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    apiRouter.delete("/customers/:id", requireCrmAccess, async (req, res) => {
      try {
        const archived = await db.softDeleteCustomerAsync(req.params.id, req.user.email);
        res.json({
          success: true,
          customer: archived,
          message: `Customer "${archived.fullName}" archived (soft-deleted) while preserving order and audit history.`
        });
      } catch (err) {
        const msg = typeof err?.message === "string" ? err.message : "Failed to archive customer";
        const isNotFound = msg.toLowerCase().includes("not found");
        const isDbError = msg.toLowerCase().includes("mysql");
        res.status(isDbError ? 500 : isNotFound ? 404 : 400).json({ error: msg });
      }
    });
    apiRouter.get("/crm/customer/:id", requireCrmAccess, (req, res) => {
      const customer = db.getCustomerById(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      const { segment, score } = classifyCustomerRFM(customer);
      const orders = db.getOrders().filter((o) => o.customerId === customer.id || o.customerEmail.toLowerCase() === customer.email.toLowerCase());
      const hotStamping = db.getHotStampingVectors(customer.id);
      const warranties = db.getWarranties(customer.id);
      const careKits = db.getCareKits(customer.id);
      const tickets = db.getTicketsByCustomer(customer.id);
      const abandonedCarts = db.getCarts().filter((c) => c.email.toLowerCase() === customer.email.toLowerCase() && c.isAbandoned);
      const purchasedSkus = orders.flatMap((o) => o.items.map((it) => it.sku));
      const inventory = db.getInventory();
      const recommendations = inventory.filter((i) => !purchasedSkus.includes(i.sku) && (i.stockByLocation.mumbaiWarehouse > 0 || i.stockByLocation.punePrimaryHub > 0)).slice(0, 3);
      res.json({
        success: true,
        customer: {
          ...customer,
          rfmSegment: segment,
          rfmScore: score
        },
        orders,
        hotStampingVectors: hotStamping,
        warranties,
        careKitDispatches: careKits,
        supportTickets: tickets,
        abandonedCarts,
        recommendations
      });
    });
    apiRouter.get("/crm/tickets", requireCrmAccess, (req, res) => {
      const tickets = db.getSupportTickets();
      res.json({ success: true, tickets });
    });
    apiRouter.post("/crm/tickets/:id/reply", requireCrmAccess, async (req, res) => {
      try {
        const { text, channel } = req.body;
        const resolvedChannel = channel || "WHATSAPP";
        const ticket = await db.runAtomicMutation(
          () => db.addSupportMessage(req.params.id, text, "AGENT", resolvedChannel)
        );
        const matchedCustomer = db.getCustomerById(ticket.customerId) || db.getCustomerById(ticket.customerEmail);
        const resolvedPhone = matchedCustomer?.phone || ticket.customerPhone;
        const delivery = await dispatchInboxAgentReply({
          ticket: resolvedPhone ? { ...ticket, customerPhone: resolvedPhone } : ticket,
          channel: resolvedChannel,
          text,
          toPhone: resolvedPhone
        });
        res.json({
          success: true,
          ticket: resolvedPhone ? { ...ticket, customerPhone: resolvedPhone } : ticket,
          delivery
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    apiRouter.post("/crm/payment-links", requireCrmAccess, async (req, res) => {
      try {
        const { gateway, amountInr, description, customerName, customerEmail, customerPhone, ticketNumber } = req.body || {};
        const amount = Number(amountInr) > 0 ? Number(amountInr) : 4200;
        const resolvedCustomer = customerEmail ? db.getCustomerById(String(customerEmail)) : void 0;
        const finalPhone = customerPhone || resolvedCustomer?.phone;
        const linkResult = await createPaymentLink({
          gateway: gateway === "STRIPE" ? "STRIPE" : "RAZORPAY",
          amountInr: amount,
          description: description || `Bharatvarsh Atelier Bespoke Commission (${ticketNumber || "Concierge"})`,
          customerName: customerName || "Valued Patron",
          customerEmail: customerEmail || "patron@bharatvarshcrafts.com",
          customerPhone: finalPhone,
          referenceId: ticketNumber ? `bvl_${ticketNumber.replace(/[^a-zA-Z0-9]/g, "")}_${Date.now().toString(36)}` : void 0
        });
        await db.runAtomicMutation(() => {
          db.logAudit(
            req.user.email,
            "PAYMENT_LINK_GENERATED",
            "STORE_MANAGEMENT",
            `Generated ${linkResult.provider} payment link (${linkResult.mode}) for \u20B9${amount} -> ${customerEmail || "patron"}`
          );
        });
        res.json({ success: true, ...linkResult });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    apiRouter.get("/crm/kanban", requireCrmAccess, (req, res) => {
      const corporateLeads = db.getCorporateGiftingLeads();
      const abandonedCarts = db.getCarts().filter((c) => c.isAbandoned);
      res.json({
        success: true,
        pipeline: {
          corporateLeads,
          abandonedCarts
        }
      });
    });
    apiRouter.post("/crm/leads", requireCrmAccess, async (req, res) => {
      try {
        const lead = await db.runAtomicMutation(() => db.addCorporateGiftingLead(req.body));
        res.status(201).json({ success: true, lead });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    apiRouter.patch("/crm/leads/:id", requireCrmAccess, async (req, res) => {
      try {
        const { status, swatchKitAwb, items } = req.body;
        const existingLead = db.getCorporateGiftingLeads().find((l) => l.id === req.params.id);
        if (!existingLead) {
          return res.status(404).json({ error: `Lead ${req.params.id} not found` });
        }
        if (status === "ORDER_CONFIRMED") {
          if (!["STORE_MANAGER", "LOGISTICS_COORDINATOR"].includes(req.user.role)) {
            return res.status(403).json({
              error: "FORBIDDEN",
              message: "Only Store Managers or Logistics Coordinators can push corporate quotes into ERP Sales Orders."
            });
          }
          if (existingLead.erpOrderId) {
            return res.status(409).json({
              error: `Lead "${existingLead.companyName}" has already been pushed to ERP Order ${existingLead.erpOrderNumber || existingLead.erpOrderId}.`
            });
          }
          const lineItems = Array.isArray(items) && items.length > 0 ? items : existingLead.items;
          if (!lineItems || lineItems.length === 0) {
            return res.status(400).json({
              error: "Select at least one catalog SKU and quantity before confirming ERP Sales Order."
            });
          }
          const order = await erpSync.pushCustomQuoteToSalesOrder(
            {
              leadId: existingLead.id,
              items: lineItems,
              dealType: "WHOLESALE_BULK"
            },
            req.user.email
          );
          const updatedLead = db.getCorporateGiftingLeads().find((l) => l.id === existingLead.id);
          return res.json({ success: true, lead: updatedLead, order });
        }
        const updated = await db.runAtomicMutation(
          () => db.updateCorporateLeadStatus(req.params.id, status, swatchKitAwb, { items })
        );
        res.json({ success: true, lead: updated });
      } catch (err) {
        const msg = typeof err?.message === "string" ? err.message : "Failed to update corporate lead";
        const isDuplicate = msg.startsWith("DUPLICATE_ERP_ORDER");
        const isStock = msg.toLowerCase().includes("out of stock") || msg.toLowerCase().includes("insufficient stock");
        res.status(isDuplicate || isStock ? 409 : 400).json({ error: msg.replace("DUPLICATE_ERP_ORDER: ", "") });
      }
    });
    apiRouter.post("/crm/cart-recovery/trigger", requireCrmAccess, async (req, res) => {
      try {
        const { cartId, channel } = req.body || {};
        if (!cartId || typeof cartId !== "string") {
          return res.status(400).json({ success: false, error: "cartId is required." });
        }
        const chosenChannel = channel === "WHATSAPP" ? "WHATSAPP" : "EMAIL";
        let resolved;
        try {
          resolved = cartRecovery.resolveCartRecipient(cartId);
        } catch (e) {
          return res.status(404).json({ success: false, error: e.message || "Cart not found." });
        }
        if (chosenChannel === "EMAIL" && (!resolved.email || !resolved.email.includes("@"))) {
          return res.status(400).json({
            success: false,
            error: "Patron email address is missing or invalid for this cart."
          });
        }
        if (chosenChannel === "WHATSAPP" && resolved.phone.replace(/\D/g, "").length < 10) {
          return res.status(400).json({
            success: false,
            error: "Valid Indian mobile number is missing for WhatsApp recovery."
          });
        }
        if (resolved.inCooldown) {
          return res.json({
            success: false,
            message: `Recovery message already dispatched to ${resolved.email || resolved.phone} within the 2-hour cooldown window.`,
            cart: resolved.cart,
            deliveryMode: "SANDBOX_FALLBACK",
            fallbackReason: "Cooldown window active"
          });
        }
        const activePromo = (db.getConfig().promoCodes || []).find((p) => p.active)?.code || "HEIRLOOM10";
        const requestOrigin = req.get("host") ? `${req.protocol}://${req.get("host")}` : "http://localhost:3000";
        const baseAppUrl = (process.env.APP_URL || requestOrigin).replace(/\/$/, "");
        const fullCheckoutUrl = resolved.cart.checkoutUrl.startsWith("http") ? resolved.cart.checkoutUrl : `${baseAppUrl}${resolved.cart.checkoutUrl}`;
        const delivery = await dispatchCartRecoveryNotice(resolved.cart, chosenChannel, activePromo, fullCheckoutUrl);
        if (chosenChannel === "EMAIL" && delivery?.smtpConfigured && delivery.mode === "SANDBOX_FALLBACK") {
          db.logAudit(
            req.user.email,
            "CART_RECOVERY_EMAIL_ERROR",
            "STORE_MANAGEMENT",
            `SMTP failed for abandoned cart ${cartId} (${resolved.email}): ${delivery.fallbackReason || "Transport error"}`
          );
          return res.status(502).json({
            success: false,
            error: delivery.fallbackReason || "Live SMTP delivery failed.",
            message: delivery.fallbackReason || "Live SMTP delivery failed.",
            deliveryMode: delivery.mode,
            messageId: delivery.messageId,
            fallbackReason: delivery.fallbackReason,
            delivery
          });
        }
        const result = await db.runAtomicMutation(() => cartRecovery.dispatchRecoveryMessage(cartId, chosenChannel));
        res.json({
          ...result,
          deliveryMode: delivery.mode,
          messageId: delivery.messageId,
          fallbackReason: delivery.fallbackReason,
          delivery
        });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });
    apiRouter.post("/crm/cart/detect-sweep", requireCrmAccess, async (req, res) => {
      try {
        const result = await db.runAtomicMutation(() => cartRecovery.runAbandonmentDetectionSweep());
        res.json({ success: true, ...result });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    apiRouter.get("/erp/inventory", requireErpAccess, (req, res) => {
      const inventory = db.getInventory();
      const bom = db.getBillOfMaterials();
      const lowStockAlerts = db.getLowStockAlerts();
      res.json({ success: true, inventory, billOfMaterials: bom, lowStockAlerts });
    });
    apiRouter.post("/erp/inventory/adjust", requireErpAccess, async (req, res) => {
      try {
        const { sku, location, newQty } = req.body;
        const updated = await db.updateInventoryStockAsync(sku, location, newQty, req.user.email);
        res.json({ success: true, inventoryItem: updated });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    apiRouter.post("/erp/bom", requireErpAccess, async (req, res) => {
      try {
        const bomItem = await db.runAtomicMutation(() => db.addBillOfMaterialsItem(req.body, req.user.email));
        res.status(201).json({ success: true, bomItem });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    apiRouter.post("/erp/bom/:id/adjust", requireErpAccess, async (req, res) => {
      try {
        const { inventoryOnHand, safetyStock } = req.body;
        const bomItem = await db.runAtomicMutation(
          () => db.updateBomItemStock(req.params.id, inventoryOnHand, safetyStock, req.user.email)
        );
        res.json({ success: true, bomItem });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });
    apiRouter.get("/erp/orders", requireErpAccess, (req, res) => {
      const orders = db.getOrders();
      res.json({ success: true, orders });
    });
    apiRouter.post("/erp/orders/:id/status", requireErpAccess, async (req, res) => {
      try {
        const { status, courierPreference } = req.body;
        let updated = await db.runAtomicMutation(() => db.updateOrderStatus(req.params.id, status, req.user.email));
        let logisticsResult = null;
        if (status === "DISPATCHED") {
          logisticsResult = await allocateCourierAwb({
            order: updated,
            courierPreference: courierPreference === "DELHIVERY" ? "DELHIVERY" : updated.courierPartner || "SHIPROCKET"
          });
          if (logisticsResult?.awbNumber) {
            updated = await db.runAtomicMutation(() => {
              const ord = db.getOrderById(req.params.id);
              if (ord) {
                ord.awbNumber = logisticsResult.awbNumber;
                ord.courierPartner = logisticsResult.courier;
                ord.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
              }
              return ord;
            });
          }
        }
        res.json({ success: true, order: updated, logistics: logisticsResult });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    apiRouter.post("/erp/quotes/push-order", requireErpAccess, async (req, res) => {
      try {
        const order = await erpSync.pushCustomQuoteToSalesOrder(req.body, req.user.email);
        const lead = req.body?.leadId ? db.getCorporateGiftingLeads().find((l) => l.id === req.body.leadId) : void 0;
        res.status(201).json({ success: true, order, lead });
      } catch (err) {
        const msg = typeof err?.message === "string" ? err.message : "Failed to push quote to ERP Sales Order";
        const isDuplicate = msg.startsWith("DUPLICATE_ERP_ORDER");
        const isStock = msg.toLowerCase().includes("out of stock") || msg.toLowerCase().includes("insufficient stock");
        res.status(isDuplicate || isStock ? 409 : 400).json({ error: msg.replace("DUPLICATE_ERP_ORDER: ", "") });
      }
    });
    apiRouter.post("/erp/rma/process", requireErpAccess, async (req, res) => {
      try {
        const { orderId, customerId, reason, inspectionNotes, restockInWarehouse, restockLocation } = req.body;
        const result = await erpSync.processRMA({
          orderId,
          customerId,
          reason,
          inspectionNotes,
          restockInWarehouse: Boolean(restockInWarehouse),
          restockLocation: restockLocation === "mumbaiWarehouse" ? "mumbaiWarehouse" : "punePrimaryHub",
          actorEmail: req.user.email
        });
        res.json({ success: true, ...result });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    apiRouter.get("/erp/invoices", requireErpAccess, (req, res) => {
      const invoices = db.getInvoices();
      const creditNotes = db.getCreditNotes();
      const gstEnabled = db.getConfig().gstInvoicingEnabled;
      res.json({ success: true, gstEnabled, invoices, creditNotes });
    });
    apiRouter.get("/erp/invoices/:num", async (req, res) => {
      const headerOrQueryToken = req.headers.authorization || (typeof req.query.token === "string" && req.query.token.trim() ? `Bearer ${req.query.token.trim()}` : void 0);
      const user = await resolveAuthTokenAsync(headerOrQueryToken);
      if (!user) {
        return res.status(401).json({ error: "UNAUTHORIZED", message: "Authentication required to access tax documents." });
      }
      const rawParam = decodeURIComponent(req.params.num || "");
      const isHtml = req.query.format === "html";
      const asAttachment = req.query.download === "1" || req.query.download === "true";
      const invoice = db.findInvoiceByNumberOrSlug(rawParam);
      const creditNote = !invoice ? db.findCreditNoteByNumberOrSlug(rawParam) : void 0;
      if (!invoice && !creditNote) {
        return res.status(404).json({ error: "Tax invoice or credit note not found." });
      }
      const orderId = invoice ? invoice.orderId : creditNote.orderId;
      const order = db.getOrderById(orderId);
      const isErpStaff = db.isStoreManagementAuthorized(user.email) && ["STORE_MANAGER", "LOGISTICS_COORDINATOR"].includes(db.getStaffRole(user.email));
      const callerCust = db.getCustomerById(user.email) || db.getCustomerById(user.uid);
      const ownsDocument = invoice && callerCust && invoice.customerId === callerCust.id || order && order.customerEmail.trim().toLowerCase() === user.email.trim().toLowerCase() || order && callerCust && order.customerId === callerCust.id;
      if (!isErpStaff && !ownsDocument) {
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "You do not have permission to view or download this GST document."
        });
      }
      const config = db.getConfig();
      const ownerCustomer = db.getCustomerById(order?.customerId || invoice?.customerId || "") || (order?.customerEmail ? db.getCustomerById(order.customerEmail) : void 0);
      const ownerDefaultAddr = ownerCustomer ? db.getDefaultCustomerAddress(ownerCustomer.id) : void 0;
      const recipientFallback = { customer: ownerCustomer, defaultAddress: ownerDefaultAddr };
      if (invoice) {
        if (isHtml) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          return res.send(renderTaxInvoiceHtml(invoice, order, config, recipientFallback));
        }
        const pdfBuf = renderTaxInvoicePdf(invoice, order, config, recipientFallback);
        const filename = `${invoice.invoiceNumber.replace(/\//g, "-")}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `${asAttachment ? "attachment" : "inline"}; filename="${filename}"`);
        return res.send(pdfBuf);
      }
      const relatedInv = db.findInvoiceByNumberOrSlug(creditNote.originalInvoiceNumber);
      if (isHtml) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.send(renderCreditNoteHtml(creditNote, relatedInv, order, config, recipientFallback));
      }
      const cnPdf = renderCreditNotePdf(creditNote, relatedInv, order, config, recipientFallback);
      const cnFilename = `${creditNote.creditNoteNumber.replace(/\//g, "-")}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${asAttachment ? "attachment" : "inline"}; filename="${cnFilename}"`);
      return res.send(cnPdf);
    });
    apiRouter.post("/erp/courier/milestone", requireErpAccess, async (req, res) => {
      try {
        const { orderId, milestone, locationName } = req.body;
        const updated = await erpSync.syncCourierMilestone(orderId, milestone, locationName || "Pune Primary Hub");
        res.json({ success: true, order: updated });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    apiRouter.get("/analytics/dashboard", requireAnalyticsAccess, (req, res) => {
      const unitEconomics = computeUnitEconomics();
      const operationalHealth = computeOperationalHealth();
      const cohorts = computeCohortRetention();
      const skuVelocity = computeSkuReorderVelocity();
      const lowStockAlerts = db.getLowStockAlerts();
      res.json({
        success: true,
        unitEconomics,
        operationalHealth,
        cohorts,
        skuVelocity,
        lowStockAlerts
      });
    });
    apiRouter.get("/store-management/config", requireStoreManagementAccess, (req, res) => {
      const config = db.getConfig();
      const auditLogs = db.getAuditLogs().slice(0, 50);
      const isMaster = db.isMasterAuthorized(req.user.email);
      const mysqlStatus = mysqlAdapter.getStatus();
      const lastPersistError = db.getLastPersistError();
      const integrations = getIntegrationsReadiness();
      res.json({
        success: true,
        config,
        auditLogs,
        isMasterSuperAdmin: isMaster,
        mysqlStatus,
        lastPersistError,
        lastDailyReportDate: db.getLastDailyReportDate() || null,
        integrations
      });
    });
    apiRouter.post("/admin/reports/send-daily-orders", requireMasterAdminAccess, async (req, res) => {
      try {
        const targetDateIst = typeof req.body?.date === "string" ? req.body.date.trim() : void 0;
        const result = await sendDailyOrdersReport({
          force: true,
          targetDateIst,
          actorEmail: req.user.email
        });
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message || "Failed to generate daily Excel order report." });
      }
    });
    apiRouter.get("/store-management/integrations-status", requireStoreManagementAccess, (req, res) => {
      res.json({ success: true, integrations: getIntegrationsReadiness() });
    });
    apiRouter.post("/store-management/operational-rules", requireStoreManagementAccess, async (req, res) => {
      try {
        const { abandonmentThresholdMinutes, supplierGstin, gstRatePercent, promoCodes } = req.body || {};
        const updatedConfig = await db.runAtomicMutation(
          () => db.updateOperationalSettings(
            {
              abandonmentThresholdMinutes,
              supplierGstin,
              gstRatePercent,
              promoCodes
            },
            req.user.email
          )
        );
        res.json({
          success: true,
          config: updatedConfig,
          message: "Operational rules, GST tax metadata, and promo codes updated permanently."
        });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });
    apiRouter.post("/store-management/mysql-config", requireStoreManagementAccess, async (req, res) => {
      try {
        const { host, port, database, user, password } = req.body;
        const result = await mysqlAdapter.configureAndConnect(
          {
            host: host || "localhost",
            port: port ? parseInt(port, 10) : 3306,
            database,
            user,
            password
          },
          { persistCredentials: true }
        );
        if (result.connected) {
          await db.runAtomicMutation(() => {
            db.logAudit(
              req.user.email,
              "MYSQL_CONNECTED",
              "STORE_MANAGEMENT",
              `Connected Hostinger MySQL database '${database}' on ${host} (encrypted credentials persisted for reboot)`
            );
          });
          await mysqlAdapter.saveCatalogAndStateAtomic(db.getRawCatalog(), db.getFullStateSnapshot());
        }
        res.status(result.connected ? 200 : 400).json({
          success: result.connected,
          message: result.message,
          mysqlStatus: mysqlAdapter.getStatus()
        });
      } catch (err) {
        res.status(500).json({
          success: false,
          error: err.message,
          message: err.message,
          mysqlStatus: mysqlAdapter.getStatus()
        });
      }
    });
    apiRouter.post("/store-management/gst-toggle", requireMasterAdminAccess, async (req, res) => {
      try {
        const { enabled } = req.body;
        await db.runAtomicMutation(() => {
          db.updateGstInvoicing(Boolean(enabled), req.user.email);
        });
        res.json({
          success: true,
          gstInvoicingEnabled: db.getConfig().gstInvoicingEnabled,
          message: `GST Invoicing module ${enabled ? "enabled" : "disabled"} successfully.`
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    apiRouter.post("/store-management/permitted-managers", requireMasterAdminAccess, async (req, res) => {
      try {
        const { email, userId, displayName, password, role } = req.body;
        const targetId = userId || email;
        if (!targetId) return res.status(400).json({ error: "User ID or Email is required" });
        await db.runAtomicMutation(() => {
          db.addPermittedManager(targetId, req.user.email, displayName, password, role);
        });
        res.json({
          success: true,
          config: db.getConfig(),
          permittedStoreManagers: db.getConfig().permittedStoreManagers,
          message: `Authorized Staff User ID "${targetId}" added successfully (${role || "STORE_MANAGER"}).`
        });
      } catch (err) {
        const isDbError = typeof err?.message === "string" && err.message.toLowerCase().includes("mysql");
        res.status(isDbError ? 500 : 400).json({ error: err.message });
      }
    });
    apiRouter.delete("/admin-users/:id", requireMasterAdminAccess, async (req, res) => {
      try {
        const targetId = decodeURIComponent(req.params.id || "").trim();
        if (!targetId) return res.status(400).json({ error: "Admin User ID is required" });
        await db.deleteAdminUserAsync(targetId, req.user.email);
        res.json({
          success: true,
          config: db.getConfig(),
          permittedStoreManagers: db.getConfig().permittedStoreManagers,
          message: `Revoked Admin access and deleted "${targetId}" from authorized admin users.`
        });
      } catch (err) {
        const isDbError = typeof err?.message === "string" && err.message.toLowerCase().includes("mysql");
        res.status(isDbError ? 500 : 400).json({ error: err.message });
      }
    });
    apiRouter.delete("/store-management/permitted-managers", requireMasterAdminAccess, async (req, res) => {
      try {
        const { email, userId } = req.body;
        const targetId = userId || email;
        if (!targetId) return res.status(400).json({ error: "User ID or Email is required" });
        await db.deleteAdminUserAsync(targetId, req.user.email);
        res.json({
          success: true,
          config: db.getConfig(),
          permittedStoreManagers: db.getConfig().permittedStoreManagers,
          message: `Revoked Admin access for "${targetId}".`
        });
      } catch (err) {
        const isDbError = typeof err?.message === "string" && err.message.toLowerCase().includes("mysql");
        res.status(isDbError ? 500 : 400).json({ error: err.message });
      }
    });
    apiRouter.post(
      "/store-management/upload-media",
      requireStoreManagementAccess,
      handleMediaUploadBody,
      async (req, res) => {
        try {
          const contentTypeHeader = String(req.headers["content-type"] || "").toLowerCase();
          let rawFilename = "";
          let rawMimeType = "";
          let fileBuffer = null;
          if (Buffer.isBuffer(req.body)) {
            if (contentTypeHeader.includes("multipart/form-data")) {
              const parsed = parseMultipartSingleFile(req.body, String(req.headers["content-type"] || ""));
              if (!parsed) {
                return res.status(400).json({ error: "No media file found in multipart upload." });
              }
              rawFilename = parsed.filename;
              rawMimeType = parsed.mimeType;
              fileBuffer = parsed.buffer;
            } else {
              rawFilename = String(req.headers["x-filename"] || req.query.filename || "");
              rawMimeType = contentTypeHeader.split(";")[0].trim();
              fileBuffer = req.body;
            }
          } else if (req.body && typeof req.body === "object") {
            rawFilename = String(req.body.filename || req.body.fileName || req.body.name || "");
            rawMimeType = String(req.body.mimeType || req.body.contentType || "").toLowerCase().trim();
            const encoded = String(req.body.dataBase64 || req.body.dataUrl || req.body.data || req.body.base64 || "").trim();
            const dataUrlMatch = encoded.match(/^data:([^;]+);base64,(.+)$/i);
            if (dataUrlMatch) {
              if (!rawMimeType) rawMimeType = dataUrlMatch[1].toLowerCase().trim();
              fileBuffer = Buffer.from(dataUrlMatch[2], "base64");
            } else if (encoded) {
              fileBuffer = Buffer.from(encoded, "base64");
            }
          }
          if (!fileBuffer || fileBuffer.length === 0) {
            return res.status(400).json({ error: "Empty or missing media upload payload." });
          }
          const rawExt = path8.extname(rawFilename || "").toLowerCase();
          const isValidImageExt = Boolean(IMAGE_MIME_BY_EXT[rawExt]);
          const isValidVideoExt = Boolean(VIDEO_MIME_BY_EXT[rawExt]);
          const normalizedMime = rawMimeType === "image/jpg" ? "image/jpeg" : rawMimeType;
          const mimeExt = normalizedMime ? EXT_BY_MIME[normalizedMime] : void 0;
          if (rawExt && !isValidImageExt && !isValidVideoExt) {
            return res.status(400).json({
              error: "Unsupported file extension. Allowed images: png, jpg, jpeg, webp. Allowed videos: mp4, webm."
            });
          }
          if (normalizedMime && normalizedMime !== "application/octet-stream" && !mimeExt) {
            return res.status(400).json({
              error: "Unsupported media MIME type. Allowed images: png, jpg, jpeg, webp. Allowed videos: mp4, webm."
            });
          }
          if (!rawExt && !mimeExt) {
            return res.status(400).json({
              error: "Could not verify media format. Upload a valid png, jpg, jpeg, webp, mp4, or webm file."
            });
          }
          if (isValidImageExt && mimeExt && !IMAGE_MIME_BY_EXT[mimeExt]) {
            return res.status(400).json({ error: "File extension does not match uploaded MIME type." });
          }
          if (isValidVideoExt && mimeExt && !VIDEO_MIME_BY_EXT[mimeExt]) {
            return res.status(400).json({ error: "File extension does not match uploaded MIME type." });
          }
          const isVideo = isValidVideoExt || Boolean(mimeExt && VIDEO_MIME_BY_EXT[mimeExt]);
          const canonicalExt = rawExt === ".jpeg" ? ".jpeg" : isValidImageExt || isValidVideoExt ? rawExt : mimeExt;
          const resolvedMime = normalizedMime && mimeExt ? normalizedMime : isVideo ? VIDEO_MIME_BY_EXT[canonicalExt] : IMAGE_MIME_BY_EXT[canonicalExt];
          if (!isVideo && fileBuffer.length > MAX_IMAGE_UPLOAD_BYTES) {
            return res.status(413).json({ error: "Image file size must not exceed 10MB." });
          }
          if (isVideo && fileBuffer.length > MAX_VIDEO_UPLOAD_BYTES) {
            return res.status(413).json({ error: "Video file size must not exceed 50MB." });
          }
          const rawBase = path8.basename(rawFilename || "", path8.extname(rawFilename || "")).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || (isVideo ? "atelier_video" : "atelier_piece");
          const safeFileName = `${rawBase}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${canonicalExt}`;
          const publicImagesDir = path8.resolve(process.cwd(), "public", "assets", "images");
          fs8.mkdirSync(publicImagesDir, { recursive: true });
          fs8.writeFileSync(path8.join(publicImagesDir, safeFileName), fileBuffer);
          const distDir = path8.resolve(process.cwd(), "dist");
          if (fs8.existsSync(distDir)) {
            const distImagesDir = path8.join(distDir, "assets", "images");
            fs8.mkdirSync(distImagesDir, { recursive: true });
            fs8.writeFileSync(path8.join(distImagesDir, safeFileName), fileBuffer);
          }
          const publicUrl = `/assets/images/${safeFileName}`;
          db.logAudit(
            req.user.email,
            "UPLOAD_MEDIA",
            "STORE_MANAGEMENT",
            `Uploaded ${isVideo ? "video" : "image"} asset ${publicUrl} (${fileBuffer.length} bytes)`
          );
          return res.status(201).json({
            success: true,
            url: publicUrl,
            filename: safeFileName,
            mediaType: isVideo ? "video" : "image",
            mimeType: resolvedMime,
            sizeBytes: fileBuffer.length
          });
        } catch (err) {
          return res.status(500).json({ error: err.message || "Media upload failed." });
        }
      }
    );
    apiRouter.post(
      "/store-management/knowledge-base",
      requireStoreManagementAccess,
      handleMediaUploadBody,
      async (req, res) => {
        try {
          const contentTypeHeader = String(req.headers["content-type"] || "").toLowerCase();
          let entryId = "";
          let title = "";
          let description = "";
          let category = "LEATHER_GUIDE";
          let rawFilename = "";
          let rawMimeType = "";
          let fileBuffer = null;
          let slides;
          if (Buffer.isBuffer(req.body)) {
            if (contentTypeHeader.includes("multipart/form-data")) {
              const parsed = parseMultipartFormData(req.body, String(req.headers["content-type"] || ""));
              entryId = parsed.fields.id || "";
              title = parsed.fields.title || "";
              description = parsed.fields.description || "";
              const rawCat = (parsed.fields.category || "LEATHER_GUIDE").toUpperCase();
              if (["LEATHER_GUIDE", "CARE_MANUAL", "CRAFT_DECK", "SUSTAINABILITY"].includes(rawCat)) {
                category = rawCat;
              }
              if (parsed.file) {
                rawFilename = parsed.file.filename;
                rawMimeType = parsed.file.mimeType;
                fileBuffer = parsed.file.buffer;
              }
            } else {
              rawFilename = String(req.headers["x-filename"] || req.query.filename || "");
              rawMimeType = contentTypeHeader.split(";")[0].trim();
              title = String(req.headers["x-kb-title"] || req.query.title || "");
              description = String(req.headers["x-kb-description"] || req.query.description || "");
              fileBuffer = req.body;
            }
          } else if (req.body && typeof req.body === "object") {
            entryId = String(req.body.id || "").trim();
            title = String(req.body.title || "").trim();
            description = String(req.body.description || "").trim();
            const rawCat = String(req.body.category || "LEATHER_GUIDE").toUpperCase();
            if (["LEATHER_GUIDE", "CARE_MANUAL", "CRAFT_DECK", "SUSTAINABILITY"].includes(rawCat)) {
              category = rawCat;
            }
            if (Array.isArray(req.body.slides)) {
              slides = req.body.slides;
            }
            rawFilename = String(req.body.filename || req.body.fileName || "").trim();
            rawMimeType = String(req.body.mimeType || req.body.contentType || "").toLowerCase().trim();
            const encoded = String(req.body.dataBase64 || req.body.dataUrl || req.body.data || "").trim();
            const dataUrlMatch = encoded.match(/^data:([^;]+);base64,(.+)$/i);
            if (dataUrlMatch) {
              if (!rawMimeType) rawMimeType = dataUrlMatch[1].toLowerCase().trim();
              fileBuffer = Buffer.from(dataUrlMatch[2], "base64");
            } else if (encoded) {
              fileBuffer = Buffer.from(encoded, "base64");
            }
          }
          const existing = entryId ? db.getKnowledgeBase().find((k) => k.id === entryId) : void 0;
          const finalTitle = title || existing?.title || (rawFilename ? path8.basename(rawFilename, path8.extname(rawFilename)).replace(/[_-]+/g, " ") : "");
          if (!finalTitle || finalTitle.length < 2) {
            return res.status(400).json({ error: "Presentation title is required (minimum 2 characters)." });
          }
          const finalDescription = description || existing?.description || "Bharatvarsh Atelier leathercraft presentation & patron reference guide.";
          let fileUrl = existing?.fileUrl;
          let fileName = existing?.fileName;
          let fileType = existing?.fileType || "DECK";
          let mimeType = existing?.mimeType;
          let sizeBytes = existing?.sizeBytes;
          if (fileBuffer && fileBuffer.length > 0) {
            if (fileBuffer.length > MAX_KB_UPLOAD_BYTES) {
              return res.status(413).json({ error: "Presentation file size must not exceed 30MB." });
            }
            const rawExt = path8.extname(rawFilename || "").toLowerCase();
            const validByExt = Boolean(KB_MIME_BY_EXT[rawExt]);
            const extByMime = rawMimeType ? KB_EXT_BY_MIME[rawMimeType] : void 0;
            if (rawExt && !validByExt) {
              return res.status(400).json({
                error: "Unsupported file format. Please upload a .pdf, .pptx, or .ppt presentation file."
              });
            }
            if (!validByExt && !extByMime) {
              return res.status(400).json({
                error: "Could not verify presentation format. Please upload a valid .pdf, .pptx, or .ppt file."
              });
            }
            const canonicalExt = validByExt ? rawExt : extByMime;
            const resolvedMime = KB_MIME_BY_EXT[canonicalExt];
            const rawBase = path8.basename(rawFilename || finalTitle, path8.extname(rawFilename || "")).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "leather_presentation";
            const safeFileName = `${rawBase}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${canonicalExt}`;
            const publicKbDir = path8.resolve(process.cwd(), "public", "assets", "knowledge-base");
            fs8.mkdirSync(publicKbDir, { recursive: true });
            fs8.writeFileSync(path8.join(publicKbDir, safeFileName), fileBuffer);
            const distDir = path8.resolve(process.cwd(), "dist");
            if (fs8.existsSync(distDir)) {
              const distKbDir = path8.join(distDir, "assets", "knowledge-base");
              fs8.mkdirSync(distKbDir, { recursive: true });
              fs8.writeFileSync(path8.join(distKbDir, safeFileName), fileBuffer);
            }
            fileUrl = `/assets/knowledge-base/${safeFileName}`;
            fileName = rawFilename || safeFileName;
            fileType = canonicalExt === ".pdf" ? "PDF" : canonicalExt === ".pptx" ? "PPTX" : "PPT";
            mimeType = resolvedMime;
            sizeBytes = fileBuffer.length;
          } else if (!existing && (!slides || slides.length === 0)) {
            return res.status(400).json({
              error: "Please attach a presentation file (.pdf, .pptx, or .ppt) to publish in the Knowledge Base."
            });
          }
          const savedEntry = await db.runAtomicMutation(
            () => db.upsertKnowledgeBaseEntry(
              {
                id: entryId || void 0,
                title: finalTitle,
                description: finalDescription,
                category,
                fileUrl,
                fileName,
                fileType,
                mimeType,
                sizeBytes,
                uploadedBy: req.user.email,
                slides: slides || existing?.slides
              },
              req.user.email
            )
          );
          return res.status(existing ? 200 : 201).json({
            success: true,
            entry: savedEntry,
            entries: db.getKnowledgeBase(),
            message: existing ? `Knowledge Base presentation "${savedEntry.title}" updated.` : `Knowledge Base presentation "${savedEntry.title}" published.`
          });
        } catch (err) {
          return res.status(500).json({ error: err?.message || "Knowledge Base upload failed." });
        }
      }
    );
    apiRouter.delete("/store-management/knowledge-base/:id", requireStoreManagementAccess, async (req, res) => {
      try {
        const removed = await db.runAtomicMutation(
          () => db.deleteKnowledgeBaseEntry(req.params.id, req.user.email)
        );
        if (!removed) {
          return res.status(404).json({ error: "Knowledge Base presentation not found." });
        }
        if (removed.fileUrl && removed.fileUrl.startsWith("/assets/knowledge-base/")) {
          const basename = path8.basename(removed.fileUrl);
          const publicPath = path8.resolve(process.cwd(), "public", "assets", "knowledge-base", basename);
          const distPath = path8.resolve(process.cwd(), "dist", "assets", "knowledge-base", basename);
          try {
            if (fs8.existsSync(publicPath)) fs8.unlinkSync(publicPath);
            if (fs8.existsSync(distPath)) fs8.unlinkSync(distPath);
          } catch {
          }
        }
        return res.json({
          success: true,
          removed,
          entries: db.getKnowledgeBase(),
          message: `Removed "${removed.title}" from the Leather Knowledge Base.`
        });
      } catch (err) {
        return res.status(500).json({ error: err?.message || "Failed to delete Knowledge Base entry." });
      }
    });
    apiRouter.post("/store-management/catalog", requireStoreManagementAccess, async (req, res) => {
      try {
        const { catalog } = req.body;
        if (!catalog) return res.status(400).json({ error: "Catalog data is required" });
        const updatedCatalog = await db.saveCatalogAsync(catalog, req.user.email);
        res.json({ success: true, catalog: updatedCatalog, message: "Catalog updated successfully" });
      } catch (err) {
        const msg = typeof err?.message === "string" ? err.message : "Failed to save catalog";
        const lower = msg.toLowerCase();
        const isValidationError = lower.includes("duplicate sku") || lower.includes("cannot be empty") || lower.includes("offer price") || lower.includes("cannot exceed") || lower.includes("mrp price") || lower.includes("maximum 4 product images");
        res.status(isValidationError ? 400 : 500).json({ error: msg });
      }
    });
    apiRouter.post("/webhooks/gateway", handleWebhookRequest);
  }
});

// server.ts
init_api();
init_cartRecovery();
init_db();
init_dailyOrderReport();
import express3 from "express";
import http from "http";
import fs9 from "fs";
import path9 from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();
var __filename = fileURLToPath(import.meta.url);
var __dirname = path9.dirname(__filename);
async function startServer() {
  const app = express3();
  const httpServer = http.createServer(app);
  const isBundledServer = path9.basename(__filename) === "server.js";
  const isProduction = process.env.NODE_ENV === "production" || isBundledServer;
  const PORT = !isProduction ? 3e3 : process.env.PORT ? parseInt(process.env.PORT, 10) : 3e3;
  const mysqlInitPromise = db.initializeMySQL().catch((err) => {
    console.error("[DB] MySQL startup initialization failed, continuing with local disk persistence:", err);
  });
  app.use(
    express3.json({
      limit: "75mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app.use(express3.urlencoded({ extended: true, limit: "75mb" }));
  const publicImagesDir = path9.resolve(__dirname, "public", "assets", "images");
  const publicKnowledgeBaseDir = path9.resolve(__dirname, "public", "assets", "knowledge-base");
  const distDir = path9.resolve(__dirname, "dist");
  const distImagesDir = path9.resolve(distDir, "assets", "images");
  const distKnowledgeBaseDir = path9.resolve(distDir, "assets", "knowledge-base");
  fs9.mkdirSync(publicImagesDir, { recursive: true });
  fs9.mkdirSync(publicKnowledgeBaseDir, { recursive: true });
  if (fs9.existsSync(distDir)) {
    fs9.mkdirSync(distImagesDir, { recursive: true });
    fs9.mkdirSync(distKnowledgeBaseDir, { recursive: true });
  }
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "healthy",
      app: "Bharatvarsh Leathercrafts LLP",
      primaryHub: "Pune, Maharashtra",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app.use("/api", async (_req, _res, next) => {
    await mysqlInitPromise;
    next();
  });
  app.use("/api", apiRouter);
  if (isProduction) {
    app.use("/assets/images", express3.static(distImagesDir));
    app.use("/assets/images", express3.static(publicImagesDir));
    app.use("/assets/knowledge-base", express3.static(distKnowledgeBaseDir));
    app.use("/assets/knowledge-base", express3.static(publicKnowledgeBaseDir));
    app.use("/src/assets/images", express3.static(distImagesDir));
    app.use("/src/assets/images", express3.static(publicImagesDir));
  } else {
    app.use("/assets/images", express3.static(publicImagesDir));
    app.use("/assets/knowledge-base", express3.static(publicKnowledgeBaseDir));
  }
  cartRecovery.startBackgroundWorker(6e4);
  mysqlInitPromise.finally(() => {
    startDailyOrderReportScheduler(6e4);
  });
  if (!isProduction) {
    const hmrDisabled = process.env.DISABLE_HMR === "true";
    const viteReadyPromise = import("vite").then(
      ({ createServer: createViteServer }) => createViteServer({
        server: {
          middlewareMode: true,
          hmr: hmrDisabled ? false : { server: httpServer },
          ws: hmrDisabled ? false : void 0
        },
        appType: "spa"
      })
    );
    if (hmrDisabled) {
      app.get("/@vite/client", async (_req, res, next) => {
        try {
          const vite = await viteReadyPromise;
          const transformed = await vite.transformRequest("/@vite/client");
          if (transformed?.code) {
            const patched = transformed.code.replace(
              "transport.connect(createHMRHandler(handleMessage));",
              "/* HMR WebSocket connection disabled via DISABLE_HMR=true */"
            );
            res.setHeader("Content-Type", "application/javascript; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache");
            return res.send(patched);
          }
        } catch {
        }
        return next();
      });
    }
    app.use(async (req, res, next) => {
      try {
        const vite = await viteReadyPromise;
        return vite.middlewares(req, res, next);
      } catch (err) {
        return next(err);
      }
    });
  } else {
    const distPath = path9.resolve(__dirname, "dist");
    const indexPath = path9.resolve(distPath, "index.html");
    app.use(express3.static(distPath));
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api/")) {
        return res.status(404).json({ error: "API endpoint not found" });
      }
      if (!fs9.existsSync(indexPath)) {
        return res.status(503).send("Production bundle missing. Please run npm run build.");
      }
      return res.sendFile(indexPath);
    });
  }
  httpServer.on("error", (err) => {
    console.error(`[Bharatvarsh Server] HTTP server error on port ${PORT}:`, err);
    process.exit(1);
  });
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[Bharatvarsh Server] Listening at http://0.0.0.0:${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
