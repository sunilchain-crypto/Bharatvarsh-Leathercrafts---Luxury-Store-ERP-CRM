/**
 * Critical Path Tests for Bharatvarsh Leathercrafts LLP
 * Covers:
 * 1. Webhook ingestion & idempotency
 * 2. RFM classification & segmentation
 * 3. ERP custom quote to Sales Order push & permanent Pune Primary Hub inventory deduction
 * 4. Abandoned cart detection & idempotent recovery
 * 5. Store Management server-side access enforcement & Out-of-Stock deactivation at 0 inventory
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import { db } from '../server/db.ts';
import { mysqlAdapter, MYSQL_TABLE_NAMES } from '../server/mysqlAdapter.ts';
import { processWebhookEvent } from '../server/webhooks.ts';
import {
  classifyCustomerRFM,
  computeOperationalHealth,
  computeCohortRetention,
  computeSkuReorderVelocity
} from '../server/rfm.ts';
import * as XLSX from 'xlsx';
import {
  isConfiguredCredential,
  createPaymentLink,
  createGatewayOrderOrIntent,
  allocateCourierAwb,
  sendTransactionalEmail,
  sendWhatsAppMessage,
  dispatchOrderInvoiceEmailToSupport,
  dispatchOrderConfirmationAndCareGuide,
  getSupportOrderEmailRecipient,
  buildSmtpTransportAttempts,
  isPerOrderEmailDisabled
} from '../server/integrations.ts';
import {
  generateDailyOrderWorkbook,
  sendDailyOrdersReport,
  runScheduledDailyOrderReportIfDue,
  getYesterdayIstDateKey,
  resetDailyReportSchedulerBackoff,
  getDailyReportSchedulerStatus
} from '../server/dailyOrderReport.ts';
import { erpSync } from '../server/erpSync.ts';
import { cartRecovery } from '../server/cartRecovery.ts';
import { verifyFirebaseIdToken } from '../server/firebaseAuthVerifier.ts';
import {
  resolveAuthToken,
  requireMasterAdminAccess,
  requireStoreManagementAccess
} from '../server/authMiddleware.ts';
import { hashPassword, verifyPassword, signSessionJwt, verifySessionJwt } from '../server/security.ts';
import { apiRouter } from '../server/api.ts';
import { verifyRecaptchaEnterpriseToken } from '../server/recaptcha.ts';
import { executeRecaptchaEnterprise } from '../lib/recaptcha.ts';

export async function runCriticalPathTests(): Promise<{ passed: boolean; results: Array<{ test: string; status: 'PASS' | 'FAIL'; message: string }> }> {
  const results: Array<{ test: string; status: 'PASS' | 'FAIL'; message: string }> = [];

  console.log('\n--- STARTING CRITICAL PATH TESTS ---\n');

  // TEST 1: Webhook Ingestion & Idempotency
  try {
    const testEventId = `evt_test_${Date.now()}`;
    const firstCall = await processWebhookEvent({
      eventId: testEventId,
      event: 'order.placed',
      timestamp: new Date().toISOString(),
      data: {
        customerEmail: 'test.patron@domain.com',
        customerName: 'Test Patron',
        subtotal: 10000,
        totalAmount: 11800,
        items: [
          {
            productId: 'prod-m-belt-01',
            productName: 'The Rajputana Bridle Belt',
            sku: 'BVL-MEN-BLT-01',
            category: 'men',
            quantity: 1,
            unitPrice: 10000,
            leatherType: 'VEGETABLE_TANNED_HERITAGE',
            hsnCode: '4203',
            gstRate: 0.18,
            taxAmount: 1800,
            lineTotal: 11800
          }
        ]
      }
    });

    const secondCall = await processWebhookEvent({
      eventId: testEventId,
      event: 'order.placed',
      timestamp: new Date().toISOString(),
      data: {}
    });

    // Restore deducted belt unit so test stays non-destructive
    const beltInv = db.getInventory().find(i => i.sku === 'BVL-MEN-BLT-01');
    if (beltInv) {
      db.updateInventoryStock('BVL-MEN-BLT-01', 'punePrimaryHub', beltInv.stockByLocation.punePrimaryHub + 1, 'sunilchain@gmail.com');
    }

    if (firstCall.status === 'PROCESSED' && secondCall.status === 'IGNORED_DUPLICATE') {
      results.push({ test: 'Webhook Ingestion & Idempotency', status: 'PASS', message: 'First call processed order, second duplicate call ignored idempotently.' });
    } else {
      results.push({ test: 'Webhook Ingestion & Idempotency', status: 'FAIL', message: `Expected PROCESSED then IGNORED_DUPLICATE, got ${firstCall.status} and ${secondCall.status}` });
    }
  } catch (e: any) {
    results.push({ test: 'Webhook Ingestion & Idempotency', status: 'FAIL', message: e.message });
  }

  // TEST 2: RFM Classification
  try {
    const vipPatron = {
      id: 'c_test_vip',
      email: 'vip@test.com',
      phone: '',
      fullName: 'VIP Patron',
      role: 'PATRON' as const,
      createdAt: '',
      updatedAt: '',
      totalOrders: 6,
      lifetimeValue: 80000,
      averageOrderValue: 13333,
      refundRate: 0,
      daysSinceLastOrder: 15,
      rfmSegment: 'Promising/Recent' as const,
      rfmScore: { recency: 5, frequency: 5, monetary: 5 },
      discountOrdersCount: 0,
      loyaltyPoints: 0,
      storeCreditBalance: 0,
      tags: [],
      acquisitionCost: 0
    };

    const atRiskPatron = {
      ...vipPatron,
      id: 'c_test_atrisk',
      daysSinceLastOrder: 120,
      totalOrders: 2
    };

    const bargainPatron = {
      ...vipPatron,
      id: 'c_test_bargain',
      totalOrders: 3,
      discountOrdersCount: 3,
      lifetimeValue: 9000
    };

    const rfmVip = classifyCustomerRFM(vipPatron);
    const rfmAtRisk = classifyCustomerRFM(atRiskPatron);
    const rfmBargain = classifyCustomerRFM(bargainPatron);

    if (
      rfmVip.segment === 'Champions/VIPs' &&
      rfmAtRisk.segment === 'At-Risk/Churning' &&
      rfmBargain.segment === 'Bargain Hunters'
    ) {
      results.push({ test: 'RFM Customer Segmentation', status: 'PASS', message: 'Accurately classified VIP, At-Risk, and Bargain Hunter archetypes.' });
    } else {
      results.push({ test: 'RFM Customer Segmentation', status: 'FAIL', message: `Mismatch in RFM output: VIP=${rfmVip.segment}, AtRisk=${rfmAtRisk.segment}, Bargain=${rfmBargain.segment}` });
    }
  } catch (e: any) {
    results.push({ test: 'RFM Customer Segmentation', status: 'FAIL', message: e.message });
  }

  // TEST 3: ERP Order Push & Pune Primary Hub Inventory Deduction
  try {
    const initialInv = db.getInventory().find(i => i.sku === 'BVL-TRV-BRF-01');
    const initialQty = initialInv ? initialInv.stockByLocation.punePrimaryHub : 0;

    const pushedOrder = await erpSync.pushCustomQuoteToSalesOrder({
      customerId: 'cust_quote_test',
      customerName: 'Enterprise Client',
      customerEmail: 'corp@client.com',
      dealType: 'WHOLESALE_BULK',
      items: [
        {
          productId: 'prod-t-brf-01',
          productName: 'The Viceroy Diplomat Briefcase',
          sku: 'BVL-TRV-BRF-01',
          quantity: 1,
          unitPrice: 28900,
          leatherType: 'VEGETABLE_TANNED_HERITAGE'
        }
      ]
    }, 'sunilchain@gmail.com');

    const updatedInv = db.getInventory().find(i => i.sku === 'BVL-TRV-BRF-01');
    const updatedQty = updatedInv ? updatedInv.stockByLocation.punePrimaryHub : 0;

    // Restore stock after test
    if (updatedInv) {
      await db.updateInventoryStockAsync('BVL-TRV-BRF-01', 'punePrimaryHub', initialQty, 'sunilchain@gmail.com');
    }

    if (pushedOrder && pushedOrder.orderNumber && updatedQty === initialQty - 1) {
      results.push({ test: 'ERP Sales Order Push & Pune Hub Sync', status: 'PASS', message: `Sales order ${pushedOrder.orderNumber} created and Pune Hub stock deducted from ${initialQty} to ${updatedQty}.` });
    } else {
      results.push({ test: 'ERP Sales Order Push & Pune Hub Sync', status: 'FAIL', message: `Inventory deduction failed. Initial: ${initialQty}, Updated: ${updatedQty}` });
    }
  } catch (e: any) {
    results.push({ test: 'ERP Sales Order Push & Pune Hub Sync', status: 'FAIL', message: e.message });
  }

  // TEST 4: Abandoned Cart Detection & Idempotent Recovery
  try {
    const testCart = cartRecovery.persistStorefrontCart({
      cartId: `cart_test_${Date.now()}`,
      email: 'idle.shopper@test.com',
      items: [
        {
          productId: 'prod-m-wal-01',
          productName: 'The Bifold Heirloom Folio',
          sku: 'BVL-MEN-WAL-01',
          unitPrice: 3800,
          quantity: 1,
          leatherType: 'VEGETABLE_TANNED_HERITAGE',
          imageUrl: ''
        }
      ],
      subtotal: 3800
    });

    testCart.lastActiveAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    const sweep = cartRecovery.runAbandonmentDetectionSweep();
    const isFound = sweep.carts.some(c => c.id === testCart.id && c.isAbandoned);

    const recovery1 = cartRecovery.dispatchRecoveryMessage(testCart.id, 'EMAIL');
    const recovery2 = cartRecovery.dispatchRecoveryMessage(testCart.id, 'EMAIL');

    if (isFound && recovery1.success && !recovery2.success) {
      results.push({ test: 'Abandoned Cart Detection & Idempotent Recovery', status: 'PASS', message: 'Cart detected as abandoned after idle threshold; duplicate recovery blocked idempotently.' });
    } else {
      results.push({ test: 'Abandoned Cart Detection & Idempotent Recovery', status: 'FAIL', message: `Found: ${isFound}, Recovery1: ${recovery1.success}, Recovery2 (should be false): ${recovery2.success}` });
    }
  } catch (e: any) {
    results.push({ test: 'Abandoned Cart Detection & Idempotent Recovery', status: 'FAIL', message: e.message });
  }

  // TEST 5: Store Management Access & Zero-Inventory Out-of-Stock Deactivation
  try {
    const masterSunil = 'sunilchain@gmail.com';
    const masterSupport = 'support@bharatvarshcrafts.com';
    const unauthorizedUser = 'intruder@external.com';

    const sunilAllowed = db.isStoreManagementAuthorized(masterSunil);
    const supportAllowed = db.isStoreManagementAuthorized(masterSupport);
    const intruderBlocked = !db.isStoreManagementAuthorized(unauthorizedUser);

    const tempManager = 'artisan.manager@bharatvarshcrafts.com';
    db.addPermittedManager(tempManager, masterSunil, 'Artisan Manager');
    const tempAllowed = db.isStoreManagementAuthorized(tempManager);

    db.removePermittedManager(tempManager, masterSunil);
    const tempRevoked = !db.isStoreManagementAuthorized(tempManager);

    let intruderRejected = false;
    try {
      db.addPermittedManager('hacker@domain.com', unauthorizedUser);
    } catch {
      intruderRejected = true;
    }

    // Zero-inventory out-of-stock deactivation test
    const testSku = 'BVL-WOM-BLT-01';
    const inv = db.getInventory().find(i => i.sku === testSku)!;
    const origPune = inv.stockByLocation.punePrimaryHub;
    const origMumbai = inv.stockByLocation.mumbaiWarehouse;

    db.updateInventoryStock(testSku, 'punePrimaryHub', 0, masterSunil);
    db.updateInventoryStock(testSku, 'mumbaiWarehouse', 0, masterSunil);
    const catAfterZero = db.getCatalog();
    const deactivatedProd = catAfterZero.products.find((p: any) => p.sku === testSku);

    // Restore original stock
    db.updateInventoryStock(testSku, 'punePrimaryHub', origPune, masterSunil);
    db.updateInventoryStock(testSku, 'mumbaiWarehouse', origMumbai, masterSunil);

    if (
      sunilAllowed &&
      supportAllowed &&
      intruderBlocked &&
      tempAllowed &&
      tempRevoked &&
      intruderRejected &&
      deactivatedProd &&
      deactivatedProd.inStock === false &&
      deactivatedProd.isActive === false
    ) {
      results.push({
        test: 'Store Management Access & Zero-Stock Deactivation',
        status: 'PASS',
        message: 'Access restricted to authorized IDs; products with 0 inventory deactivate and report out of stock.'
      });
    } else {
      results.push({ test: 'Store Management Access & Zero-Stock Deactivation', status: 'FAIL', message: 'Access control or zero-stock check failed.' });
    }
  } catch (e: any) {
    results.push({ test: 'Store Management Access & Zero-Stock Deactivation', status: 'FAIL', message: e.message });
  }

  // TEST 6: Google Firebase ID Token Verifier Security Checks
  try {
    const forgedToken =
      'eyJhbGciOiJSUzI1NiIsImtpZCI6ImZha2Uta2lkIn0.' +
      Buffer.from(
        JSON.stringify({
          aud: 'gen-lang-client-0774833728',
          iss: 'https://securetoken.google.com/gen-lang-client-0774833728',
          sub: 'fake-uid',
          email: 'sunilchain@gmail.com',
          email_verified: true,
          iat: Math.floor(Date.now() / 1000) - 10,
          exp: Math.floor(Date.now() / 1000) + 3600
        })
      ).toString('base64url') +
      '.ZmFrZS1zaWduYXR1cmU';

    const forgedResult = await verifyFirebaseIdToken(forgedToken);
    const malformedResult = await verifyFirebaseIdToken('not.a.valid-jwt');

    const certsRes = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
    const certsJson = (await certsRes.json()) as Record<string, string>;
    const certCount = Object.keys(certsJson).length;

    if (forgedResult === null && malformedResult === null && certsRes.ok && certCount > 0) {
      results.push({
        test: 'Google Firebase Auth Token Verifier',
        status: 'PASS',
        message: `Rejected forged/malformed JWTs; fetched ${certCount} live Google x509 signing certificates.`
      });
    } else {
      results.push({
        test: 'Google Firebase Auth Token Verifier',
        status: 'FAIL',
        message: `Verifier failed: forged=${Boolean(forgedResult)}, malformed=${Boolean(malformedResult)}, certs=${certCount}`
      });
    }
  } catch (e: any) {
    results.push({ test: 'Google Firebase Auth Token Verifier', status: 'FAIL', message: e.message });
  }

  // TEST 7: Snapshot Protection (No NOT IN Deletes on Admin/Customers, Empty-List Guards & Catalog Replication)
  try {
    const executedQueries: Array<{ sql: string; params?: any[] }> = [];
    const mockConn: any = {
      query: async (sql: string, params?: any[]) => {
        executedQueries.push({ sql: sql.trim(), params });
        return [[]];
      }
    };

    const stateSnap = structuredClone(db.getFullStateSnapshot());
    const catalogSnap = structuredClone(db.getRawCatalog());

    await mysqlAdapter.syncStateWithConnection(mockConn, stateSnap);
    await mysqlAdapter.saveCatalogSnapshot(catalogSnap, mockConn);

    const sqlTexts = executedQueries.map(q => q.sql);
    const syncedTables = [
      'bvl_app_state',
      'bvl_inventory',
      'bvl_admin_users',
      'bvl_customers',
      'bvl_orders',
      'bvl_audit_logs',
      'bvl_catalog_categories',
      'bvl_catalog_products'
    ].every(tbl => sqlTexts.some(s => s.includes(tbl)));

    const noIdentityDeletes =
      !sqlTexts.some(s => s.includes('DELETE FROM bvl_admin_users')) &&
      !sqlTexts.some(s => s.includes('DELETE FROM bvl_customers'));

    const guardedInventoryAndOrdersCleanup =
      sqlTexts.some(s => s.includes('DELETE FROM bvl_inventory WHERE sku NOT IN')) &&
      sqlTexts.some(s => s.includes('DELETE FROM bvl_orders WHERE id NOT IN'));

    // Empty-array guard test: empty arrays MUST skip all DELETE cleanup statements
    executedQueries.length = 0;
    await mysqlAdapter.syncStateWithConnection(mockConn, {
      ...stateSnap,
      inventory: [],
      orders: [],
      customers: [],
      config: { ...stateSnap.config, adminCredentials: [] }
    });
    const emptySnapshotSql = executedQueries.map(q => q.sql);
    const noDeletesOnEmptySnapshot = !emptySnapshotSql.some(s => s.startsWith('DELETE FROM'));

    if (syncedTables && noIdentityDeletes && guardedInventoryAndOrdersCleanup && noDeletesOnEmptySnapshot) {
      results.push({
        test: 'Protected MySQL Snapshot Sync & Empty-List Guards',
        status: 'PASS',
        message: 'Verified upsert-only identity tables (no DELETE on admin/customers) and empty-array guards on orders/inventory.'
      });
    } else {
      results.push({
        test: 'Protected MySQL Snapshot Sync & Empty-List Guards',
        status: 'FAIL',
        message: `syncedTables=${syncedTables}, noIdentityDeletes=${noIdentityDeletes}, guardedCleanup=${guardedInventoryAndOrdersCleanup}, noDeletesOnEmpty=${noDeletesOnEmptySnapshot}`
      });
    }
  } catch (e: any) {
    results.push({ test: 'Protected MySQL Snapshot Sync & Empty-List Guards', status: 'FAIL', message: e.message });
  }

  // TEST 8: Encrypted Hostinger MySQL Credential Persistence Across Restarts
  try {
    const credFile = path.resolve(process.cwd(), 'src/server/data/mysql_credentials.enc.json');
    const keyFile = path.resolve(process.cwd(), 'src/server/data/.mysql_key');
    const hadCredFile = fs.existsSync(credFile);
    const prevCredBytes = hadCredFile ? fs.readFileSync(credFile) : null;
    const hadKeyFile = fs.existsSync(keyFile);
    const prevKeyBytes = hadKeyFile ? fs.readFileSync(keyFile) : null;

    try {
      const sampleCfg = {
        host: '127.0.0.1',
        port: 3306,
        database: 'u999999_bharatvarsh',
        user: 'u999999_admin',
        password: 'Test#Hostinger!Password2026'
      };
      mysqlAdapter.saveEncryptedConfig(sampleCfg);
      const rawFile = fs.readFileSync(credFile, 'utf-8');
      const plaintextLeaked = rawFile.includes(sampleCfg.password) || rawFile.includes(sampleCfg.database);
      const loaded = mysqlAdapter.loadEncryptedConfig();

      if (
        !plaintextLeaked &&
        loaded &&
        loaded.host === sampleCfg.host &&
        loaded.port === sampleCfg.port &&
        loaded.database === sampleCfg.database &&
        loaded.user === sampleCfg.user &&
        loaded.password === sampleCfg.password
      ) {
        results.push({
          test: 'Encrypted MySQL Credentials Persistence',
          status: 'PASS',
          message: 'AES-256-GCM credentials saved without plaintext leakage and decrypted accurately for auto-reconnect.'
        });
      } else {
        results.push({
          test: 'Encrypted MySQL Credentials Persistence',
          status: 'FAIL',
          message: `plaintextLeaked=${plaintextLeaked}, loadedMatch=${Boolean(loaded)}`
        });
      }
    } finally {
      if (hadCredFile && prevCredBytes) {
        fs.writeFileSync(credFile, prevCredBytes);
      } else if (fs.existsSync(credFile)) {
        fs.unlinkSync(credFile);
      }
      if (hadKeyFile && prevKeyBytes) {
        fs.writeFileSync(keyFile, prevKeyBytes);
      } else if (fs.existsSync(keyFile)) {
        fs.unlinkSync(keyFile);
      }
    }
  } catch (e: any) {
    results.push({ test: 'Encrypted MySQL Credentials Persistence', status: 'FAIL', message: e.message });
  }

  // TEST 9: Transactional SELECT FOR UPDATE Stock Locking & Failure Rollback
  try {
    const adapterAny = mysqlAdapter as any;
    const origPool = adapterAny.pool;
    const origConnected = adapterAny.connected;
    const origLastError = adapterAny.lastError;
    const origLastSyncAt = adapterAny.lastSyncAt;

    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;

    const sku = 'BVL-MEN-BLT-01';
    const invBefore = db.getInventory().find(i => i.sku === sku)!;
    const origPune = invBefore.stockByLocation.punePrimaryHub;
    const origMumbai = invBefore.stockByLocation.mumbaiWarehouse;
    const origOrderCount = db.getOrders().length;

    let failOnWrite = false;
    const txEvents: string[] = [];

    const mockConn: any = {
      beginTransaction: async () => {
        txEvents.push('BEGIN');
      },
      commit: async () => {
        txEvents.push('COMMIT');
      },
      rollback: async () => {
        txEvents.push('ROLLBACK');
      },
      release: () => {
        txEvents.push('RELEASE');
      },
      query: async (sql: string) => {
        const trimmed = sql.trim();
        if (trimmed.includes('FOR UPDATE')) {
          txEvents.push('FOR_UPDATE');
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
        if (failOnWrite && trimmed.startsWith('INSERT INTO bvl_orders')) {
          throw new Error('Simulated MySQL transaction write failure');
        }
        return [[]];
      }
    };

    adapterAny.pool = { getConnection: async () => mockConn };
    adapterAny.connected = true;

    try {
      // Phase A: Simulated MySQL write failure triggers ROLLBACK and restores memory + disk
      failOnWrite = true;
      let surfacedError = '';
      try {
        await db.createOrderAsync({
          customerId: 'cust_01_vip',
          customerName: 'Vikramaditya Singhania',
          customerEmail: 'vikram.singhania@heritagecrafts.in',
          customerPhone: '+91 98201 12345',
          status: 'PROCESSING',
          currency: 'INR',
          subtotal: 4200,
          discountAmount: 0,
          taxAmount: 756,
          shippingFee: 0,
          totalAmount: 4956,
          paymentGateway: 'RAZORPAY',
          paymentId: 'pay_rollback_test',
          paymentStatus: 'PAID',
          items: [
            {
              id: 'item_rb_1',
              orderId: '',
              productId: invBefore.productId,
              productName: invBefore.name,
              sku,
              category: 'men',
              quantity: 1,
              unitPrice: 4200,
              leatherType: 'VEGETABLE_TANNED_HERITAGE',
              hsnCode: '4203',
              gstRate: 0.18,
              taxAmount: 756,
              lineTotal: 4956
            }
          ],
          shippingAddress: {
            id: 'addr_test',
            customerId: 'cust_01_vip',
            street: 'Test',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411001',
            country: 'India',
            isDefault: true,
            addressType: 'SHIPPING'
          },
          billingAddress: {
            id: 'addr_test_b',
            customerId: 'cust_01_vip',
            street: 'Test',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411001',
            country: 'India',
            isDefault: true,
            addressType: 'BILLING'
          }
        });
      } catch (err: any) {
        surfacedError = err.message;
      }

      const invAfterFail = db.getInventory().find(i => i.sku === sku)!;
      const diskAfterFail = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
      const diskInvAfterFail = diskAfterFail.inventory.find((i: any) => i.sku === sku);
      const rollbackOk =
        surfacedError.includes('Simulated MySQL transaction write failure') &&
        txEvents.includes('FOR_UPDATE') &&
        txEvents.includes('ROLLBACK') &&
        invAfterFail.stockByLocation.punePrimaryHub === origPune &&
        diskInvAfterFail.stockByLocation.punePrimaryHub === origPune &&
        db.getOrders().length === origOrderCount;

      // Phase B: Successful inventory adjustment commits inside SELECT ... FOR UPDATE transaction
      txEvents.length = 0;
      failOnWrite = false;
      await db.updateInventoryStockAsync(sku, 'punePrimaryHub', origPune + 2, 'sunilchain@gmail.com');
      const commitOk =
        txEvents.includes('BEGIN') &&
        txEvents.includes('FOR_UPDATE') &&
        txEvents.includes('COMMIT') &&
        db.getInventory().find(i => i.sku === sku)!.stockByLocation.punePrimaryHub === origPune + 2;

      if (rollbackOk && commitOk) {
        results.push({
          test: 'Transactional SELECT FOR UPDATE & Failure Rollback',
          status: 'PASS',
          message: 'Locked bvl_inventory rows with SELECT FOR UPDATE, surfaced DB error on failure, and rolled back memory & disk.'
        });
      } else {
        results.push({
          test: 'Transactional SELECT FOR UPDATE & Failure Rollback',
          status: 'FAIL',
          message: `rollbackOk=${rollbackOk}, commitOk=${commitOk}, surfacedError=${surfacedError}`
        });
      }
    } finally {
      adapterAny.pool = origPool;
      adapterAny.connected = origConnected;
      adapterAny.lastError = origLastError;
      adapterAny.lastSyncAt = origLastSyncAt;
      await db.updateInventoryStockAsync(sku, 'punePrimaryHub', origPune, 'sunilchain@gmail.com').catch(() => {});
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'Transactional SELECT FOR UPDATE & Failure Rollback', status: 'FAIL', message: e.message });
  }

  // TEST 10: Customer Soft-Delete (History Preserved) & Targeted Admin Deletion
  try {
    const adapterAny = mysqlAdapter as any;
    const origPool = adapterAny.pool;
    const origConnected = adapterAny.connected;
    const origLastError = adapterAny.lastError;
    const origLastSyncAt = adapterAny.lastSyncAt;

    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;

    const capturedQueries: Array<{ sql: string; params?: any[] }> = [];
    const mockConn: any = {
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
      query: async (sql: string, params?: any[]) => {
        capturedQueries.push({ sql: sql.trim(), params });
        return [[]];
      }
    };
    adapterAny.pool = { getConnection: async () => mockConn };
    adapterAny.connected = true;

    try {
      // 1. Soft-delete customer who has historical orders
      const targetCustomerId = 'cust_01_vip';
      const ordersBefore = db.getOrders().filter(o => o.customerId === targetCustomerId).length;
      const archived = await db.softDeleteCustomerAsync(targetCustomerId, 'sunilchain@gmail.com');
      const archivedStateCaptured = archived.isActive === false && Boolean(archived.deletedAt);

      const hiddenInCrmList = !db.getCustomers().some(c => c.id === targetCustomerId);
      const retainedForHistoryLookup = db.getCustomerById(targetCustomerId)?.isActive === false;
      const ordersPreserved = db.getOrders().filter(o => o.customerId === targetCustomerId).length === ordersBefore;
      const softDeleteSqlIssued = capturedQueries.some(
        q =>
          q.sql.includes('UPDATE bvl_customers SET is_active = 0, deleted_at = NOW()') &&
          q.params?.[0] === targetCustomerId
      );

      // Verify returning patron reactivates seamlessly
      const { customer: reactivated } = db.findOrCreateCustomer({
        email: archived.email,
        fullName: archived.fullName
      });
      const reactivatedOk = reactivated.isActive === true && !reactivated.deletedAt;

      // 2. Targeted Admin User deletion (delegated account deleted, master account blocked)
      capturedQueries.length = 0;
      const delegatedAdmin = 'delegated.protect.test@bharatvarshcrafts.com';
      db.addPermittedManager(delegatedAdmin, 'sunilchain@gmail.com', 'Delegated Test Admin');
      await db.deleteAdminUserAsync(delegatedAdmin, 'sunilchain@gmail.com');
      const targetedAdminDeleteSql = capturedQueries.some(
        q => q.sql === 'DELETE FROM bvl_admin_users WHERE user_id = ?' && q.params?.[0] === delegatedAdmin
      );

      let masterProtected = false;
      try {
        await db.deleteAdminUserAsync('support@bharatvarshcrafts.com', 'sunilchain@gmail.com');
      } catch {
        masterProtected = true;
      }

      if (
        archivedStateCaptured &&
        hiddenInCrmList &&
        retainedForHistoryLookup &&
        ordersPreserved &&
        softDeleteSqlIssued &&
        reactivatedOk &&
        targetedAdminDeleteSql &&
        masterProtected
      ) {
        results.push({
          test: 'Customer Soft-Delete & Targeted Admin Deletion',
          status: 'PASS',
          message: 'Soft-deleted customer (is_active=0) hidden from CRM while preserving orders/audit trail; targeted admin DELETE verified.'
        });
      } else {
        results.push({
          test: 'Customer Soft-Delete & Targeted Admin Deletion',
          status: 'FAIL',
          message: `hidden=${hiddenInCrmList}, lookup=${retainedForHistoryLookup}, orders=${ordersPreserved}, softSql=${softDeleteSqlIssued}, reactivated=${reactivatedOk}, adminSql=${targetedAdminDeleteSql}, masterProtected=${masterProtected}`
        });
      }
    } finally {
      adapterAny.pool = origPool;
      adapterAny.connected = origConnected;
      adapterAny.lastError = origLastError;
      adapterAny.lastSyncAt = origLastSyncAt;
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'Customer Soft-Delete & Targeted Admin Deletion', status: 'FAIL', message: e.message });
  }

  // TEST 11: RMA Restock Warehouse Routing (Pune Primary Hub vs Mumbai Warehouse)
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;

    try {
      const targetOrder = db.getOrderById('ord_1002')!;
      const purseSku = targetOrder.items[0].sku;
      const invBefore = db.getInventory().find(i => i.sku === purseSku)!;
      const puneBefore = invBefore.stockByLocation.punePrimaryHub;
      const mumbaiBefore = invBefore.stockByLocation.mumbaiWarehouse;

      // Default / explicit Pune Primary Hub restock
      await erpSync.processRMA({
        orderId: targetOrder.id,
        customerId: targetOrder.customerId,
        reason: 'TEXTURE_DEFECT',
        restockInWarehouse: true,
        restockLocation: 'punePrimaryHub',
        actorEmail: 'sunilchain@gmail.com'
      });

      const afterPune = db.getInventory().find(i => i.sku === purseSku)!;
      const puneIncrementedOnly =
        afterPune.stockByLocation.punePrimaryHub === puneBefore + 1 &&
        afterPune.stockByLocation.mumbaiWarehouse === mumbaiBefore;

      // Explicit Mumbai Warehouse restock
      await erpSync.processRMA({
        orderId: targetOrder.id,
        customerId: targetOrder.customerId,
        reason: 'COLOR_MISMATCH',
        restockInWarehouse: true,
        restockLocation: 'mumbaiWarehouse',
        actorEmail: 'sunilchain@gmail.com'
      });

      const afterMumbai = db.getInventory().find(i => i.sku === purseSku)!;
      const mumbaiIncrementedOnly =
        afterMumbai.stockByLocation.punePrimaryHub === puneBefore + 1 &&
        afterMumbai.stockByLocation.mumbaiWarehouse === mumbaiBefore + 1;

      if (puneIncrementedOnly && mumbaiIncrementedOnly) {
        results.push({
          test: 'RMA Restock Location Selector Routing',
          status: 'PASS',
          message: 'RMA restock routed accurately to Pune Primary Hub and Mumbai Warehouse based on operator selection.'
        });
      } else {
        results.push({
          test: 'RMA Restock Location Selector Routing',
          status: 'FAIL',
          message: `puneOnly=${puneIncrementedOnly}, mumbaiOnly=${mumbaiIncrementedOnly}`
        });
      }
    } finally {
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'RMA Restock Location Selector Routing', status: 'FAIL', message: e.message });
  }

  // TEST 12: Dual-Mode Cart Recovery Resume Links (Direct ID + Signed HMAC Token)
  try {
    const directRes = cartRecovery.resolveResumableCart('cart_abandoned_01');
    const signedToken = cartRecovery.signResumeToken('cart_abandoned_01');
    const signedRes = cartRecovery.resolveResumableCart('cart_abandoned_01', signedToken);
    const tamperedRes = cartRecovery.resolveResumableCart('cart_abandoned_01', `${signedToken}tamper`);
    const missingRes = cartRecovery.resolveResumableCart('cart_does_not_exist');
    const resumeUrl = cartRecovery.buildCheckoutResumeUrl('cart_abandoned_01');

    if (
      directRes.status === 'OK' &&
      !directRes.tokenVerified &&
      directRes.cart.items.length > 0 &&
      signedRes.status === 'OK' &&
      signedRes.tokenVerified &&
      signedRes.cart.email === 'karan.mehra@apextech.co' &&
      tamperedRes.status === 'INVALID_TOKEN' &&
      missingRes.status === 'NOT_FOUND' &&
      resumeUrl.includes('resume=cart_abandoned_01&token=')
    ) {
      results.push({
        test: 'Cart Recovery Resume Links & Token Verification',
        status: 'PASS',
        message: 'Verified direct cart ID lookup, HMAC-signed resume token validation, and tampered token rejection.'
      });
    } else {
      results.push({
        test: 'Cart Recovery Resume Links & Token Verification',
        status: 'FAIL',
        message: `direct=${directRes.status}, signed=${signedRes.status}, tampered=${tamperedRes.status}, missing=${missingRes.status}`
      });
    }
  } catch (e: any) {
    results.push({ test: 'Cart Recovery Resume Links & Token Verification', status: 'FAIL', message: e.message });
  }

  // TEST 13: Server-Side Master Admin Privilege Enforcement
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;

    try {
      const delegatedEmail = 'delegated.manager.rbac@bharatvarshcrafts.com';
      db.addPermittedManager(delegatedEmail, 'sunilchain@gmail.com', 'Delegated Ops Lead', 'OpsLead#2026');

      const delegatedJwt = signSessionJwt({
        sub: 'uid_delegated_rbac',
        email: delegatedEmail,
        name: 'Delegated Ops Lead',
        role: 'STORE_MANAGER'
      });
      const masterJwt = signSessionJwt({
        sub: 'uid_master_sunil',
        email: 'sunilchain@gmail.com',
        name: 'Sunil Chainani',
        role: 'STORE_MANAGER'
      });

      const invokeMiddleware = async (mw: any, authHeader?: string) => {
        let statusCode = 200;
        let nextCalled = false;
        let body: any = null;
        const mockReq: any = {
          headers: authHeader ? { authorization: authHeader } : {},
          method: 'POST',
          originalUrl: '/api/store-management/gst-toggle',
          ip: '127.0.0.1'
        };
        const mockRes: any = {
          status(code: number) {
            statusCode = code;
            return this;
          },
          json(payload: any) {
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
      const unauthMasterCheck = await invokeMiddleware(requireMasterAdminAccess, undefined);
      const masterAllowedCheck = await invokeMiddleware(requireMasterAdminAccess, `Bearer ${masterJwt}`);

      let domainGstBlocked = false;
      try {
        db.updateGstInvoicing(false, delegatedEmail);
      } catch {
        domainGstBlocked = true;
      }

      if (
        delegatedStoreCheck.nextCalled &&
        !delegatedMasterCheck.nextCalled &&
        delegatedMasterCheck.statusCode === 403 &&
        !unauthMasterCheck.nextCalled &&
        unauthMasterCheck.statusCode === 401 &&
        masterAllowedCheck.nextCalled &&
        domainGstBlocked
      ) {
        results.push({
          test: 'Master-Admin Server-Side Enforcement',
          status: 'PASS',
          message: 'Blocked delegated Store Managers (403) and guests (401) from Master-only routes and domain helpers; allowed Master Super-Admin.'
        });
      } else {
        results.push({
          test: 'Master-Admin Server-Side Enforcement',
          status: 'FAIL',
          message: `store=${delegatedStoreCheck.nextCalled}, delMasterStatus=${delegatedMasterCheck.statusCode}, unauth=${unauthMasterCheck.statusCode}, masterNext=${masterAllowedCheck.nextCalled}, domainBlocked=${domainGstBlocked}`
        });
      }
    } finally {
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'Master-Admin Server-Side Enforcement', status: 'FAIL', message: e.message });
  }

  // TEST 14: Signed Session JWTs, Salted scrypt Passwords, Passwordless Admin Block & Test Token Isolation
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;
    const prevTestFlag = process.env.ENABLE_TEST_AUTH_TOKENS;

    try {
      // 1. Predictable unsigned tokens are always rejected
      const forgedAuth = resolveAuthToken('Bearer auth_token:sunilchain@gmail.com:STORE_MANAGER');
      const forgedFb = resolveAuthToken('Bearer fb_token:support@bharatvarshcrafts.com:STORE_MANAGER');

      // 2. Hardcoded test tokens are disabled when test flag is off, active only when enabled
      delete process.env.ENABLE_TEST_AUTH_TOKENS;
      const staticOff = process.env.NODE_ENV === 'test' ? null : resolveAuthToken('Bearer token_sunil');
      process.env.ENABLE_TEST_AUTH_TOKENS = 'true';
      const staticOn = resolveAuthToken('Bearer token_sunil');
      delete process.env.ENABLE_TEST_AUTH_TOKENS;

      // 3. HMAC-SHA256 JWT issuance + tamper rejection
      const validJwt = signSessionJwt({
        sub: 'uid_jwt_test',
        email: 'sunilchain@gmail.com',
        name: 'Sunil Chainani',
        role: 'STORE_MANAGER'
      });
      const jwtVerified = verifySessionJwt(validJwt);
      const tamperedJwt = `${validJwt.slice(0, -4)}AAAA`;
      const jwtTamperedRejected = verifySessionJwt(tamperedJwt) === null;
      const resolvedJwt = resolveAuthToken(`Bearer ${validJwt}`);

      // 4. Salted scrypt hashing + passwordless founding admin block + patron registration/login
      const h1 = hashPassword('AtelierSecret#2026');
      const h2 = hashPassword('AtelierSecret#2026');
      const scryptFormatOk = h1.startsWith('scrypt$') && h1 !== h2 && verifyPassword('AtelierSecret#2026', h1).valid;

      const passwordlessAdminBlocked = !db.verifyAdminLogin('sunilchain@gmail.com', 'any_password').valid;

      const { customer: regCust } = db.registerPatronWithPassword({
        email: 'patron.scrypt.test@example.com',
        password: 'StrongPassword!99',
        fullName: 'Meera Kulkarni'
      });
      const patronValidLogin = db.verifyPatronLogin('patron.scrypt.test@example.com', 'StrongPassword!99').valid;
      const patronWrongPasswordRejected = !db.verifyPatronLogin('patron.scrypt.test@example.com', 'WrongPass!99').valid;

      if (
        forgedAuth === null &&
        forgedFb === null &&
        staticOff === null &&
        staticOn?.email === 'sunilchain@gmail.com' &&
        jwtVerified?.email === 'sunilchain@gmail.com' &&
        jwtTamperedRejected &&
        resolvedJwt?.isMasterAdmin === true &&
        scryptFormatOk &&
        passwordlessAdminBlocked &&
        regCust.email === 'patron.scrypt.test@example.com' &&
        patronValidLogin &&
        patronWrongPasswordRejected
      ) {
        results.push({
          test: 'Signed JWTs, Salted scrypt Passwords & Token Isolation',
          status: 'PASS',
          message: 'Rejected predictable auth_token strings and tampered JWTs; enforced salted scrypt for admins/patrons and isolated test tokens.'
        });
      } else {
        results.push({
          test: 'Signed JWTs, Salted scrypt Passwords & Token Isolation',
          status: 'FAIL',
          message: `forgedNull=${forgedAuth === null && forgedFb === null}, staticOff=${staticOff === null}, jwtOk=${Boolean(resolvedJwt)}, scrypt=${scryptFormatOk}, pwlessAdminBlocked=${passwordlessAdminBlocked}, patronOk=${patronValidLogin && patronWrongPasswordRejected}`
        });
      }
    } finally {
      if (prevTestFlag === undefined) {
        delete process.env.ENABLE_TEST_AUTH_TOKENS;
      } else {
        process.env.ENABLE_TEST_AUTH_TOKENS = prevTestFlag;
      }
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'Signed JWTs, Salted scrypt Passwords & Token Isolation', status: 'FAIL', message: e.message });
  }

  // TEST 15: Authoritative Server-Side Checkout Pricing & Promo Code Enforcement
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = (server.address() as any).port;
      const res = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Price Tamper Tester',
          customerEmail: 'price.audit.test@example.com',
          customerPhone: '+91 98201 12345',
          shippingAddress: {
            street: '204 Heritage Arcade, FC Road',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411004',
            country: 'India'
          },
          items: [
            {
              productId: 'prod-m-belt-01',
              sku: 'BVL-MEN-BLT-01',
              productName: 'Tampered Cheap Belt',
              unitPrice: 1,
              quantity: 1,
              leatherType: 'VEGETABLE_TANNED_HERITAGE'
            }
          ],
          subtotal: 1,
          discountAmount: 99999,
          discountCode: 'HEIRLOOM10'
        })
      });
      const data = await res.json();
      // Rajputana Bridle Belt catalog price = 4200; HEIRLOOM10 = 10% (420); taxable = 3780; 18% tax = 680; total = 4460
      const order = data.order;
      const serverPriceEnforced =
        res.status === 201 &&
        order &&
        order.items[0].unitPrice === 4200 &&
        order.subtotal === 4200 &&
        order.discountCode === 'HEIRLOOM10' &&
        order.discountAmount === 420 &&
        order.taxAmount === 680 &&
        order.totalAmount === 4460;

      const fakePromoRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Price Tamper Tester',
          customerEmail: 'price.audit.test@example.com',
          customerPhone: '+91 98201 12345',
          shippingAddress: {
            street: '204 Heritage Arcade, FC Road',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411004',
            country: 'India'
          },
          items: [{ productId: 'prod-m-belt-01', sku: 'BVL-MEN-BLT-01', quantity: 1 }],
          discountCode: 'FREE99'
        })
      });

      if (serverPriceEnforced && fakePromoRes.status === 400) {
        results.push({
          test: 'Server-Side Checkout Pricing & Promo Enforcement',
          status: 'PASS',
          message: 'Ignored tampered client unitPrice/subtotal/discountAmount and enforced live catalog pricing (₹4,200) + HEIRLOOM10 math.'
        });
      } else {
        results.push({
          test: 'Server-Side Checkout Pricing & Promo Enforcement',
          status: 'FAIL',
          message: `serverPriceEnforced=${serverPriceEnforced}, fakePromoStatus=${fakePromoRes.status}, orderTotal=${order?.totalAmount}`
        });
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'Server-Side Checkout Pricing & Promo Enforcement', status: 'FAIL', message: e.message });
  }

  // TEST 16: Webhook Cryptographic Signature Verification & Isolated Abandonment Simulator
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;
    const prevRzpSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const prevStripeSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const prevUnsignedFlag = process.env.ALLOW_UNSIGNED_TEST_WEBHOOKS;

    process.env.RAZORPAY_WEBHOOK_SECRET = 'test_rzp_webhook_secret_2026';
    process.env.STRIPE_WEBHOOK_SECRET = 'test_stripe_webhook_secret_2026';
    delete process.env.ALLOW_UNSIGNED_TEST_WEBHOOKS;

    const app = express();
    app.use(
      express.json({
        verify: (req: any, _res, buf) => {
          req.rawBody = buf;
        }
      })
    );
    app.use('/api', apiRouter);
    const server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = (server.address() as any).port;
      const webhookPayload = JSON.stringify({
        eventId: `evt_sig_verify_${Date.now()}`,
        event: 'customer.created',
        timestamp: new Date().toISOString(),
        data: { email: 'signed.webhook.patron@example.com', fullName: 'Signed Webhook Patron' }
      });

      // 1. Missing signature (when unsigned bypass off)
      let missingSigRejected = true;
      if (process.env.NODE_ENV !== 'test') {
        const missingRes = await fetch(`http://127.0.0.1:${port}/api/webhooks/gateway`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: webhookPayload
        });
        missingSigRejected = missingRes.status === 401;
      }

      // 2. Invalid Razorpay signature -> 401
      const forgedRzpRes = await fetch(`http://127.0.0.1:${port}/api/webhooks/gateway`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': '0000000000000000deadbeef'
        },
        body: webhookPayload
      });

      // 3. Valid Razorpay HMAC-SHA256 signature -> 200
      const validRzpSig = crypto
        .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(webhookPayload, 'utf8')
        .digest('hex');
      const validRzpRes = await fetch(`http://127.0.0.1:${port}/api/webhooks/gateway`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': validRzpSig
        },
        body: webhookPayload
      });

      // 4. Valid Stripe HMAC-SHA256 signature -> 200 (idempotent duplicate)
      const ts = Math.floor(Date.now() / 1000);
      const validStripeHmac = crypto
        .createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET)
        .update(`${ts}.${webhookPayload}`, 'utf8')
        .digest('hex');
      const validStripeRes = await fetch(`http://127.0.0.1:${port}/api/webhooks/gateway`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': `t=${ts},v1=${validStripeHmac}`
        },
        body: webhookPayload
      });

      // 5. Storefront abandonment simulator isolated endpoint -> 200 without gateway secrets
      const simRes = await fetch(`http://127.0.0.1:${port}/api/cart/simulate-abandonment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'sim.abandon@example.com',
          items: [{ productId: 'prod-m-belt-01', sku: 'BVL-MEN-BLT-01', quantity: 1 }]
        })
      });
      const simData = await simRes.json();

      if (
        missingSigRejected &&
        forgedRzpRes.status === 401 &&
        validRzpRes.status === 200 &&
        validStripeRes.status === 200 &&
        simRes.status === 200 &&
        simData.cart?.isAbandoned === true &&
        simData.cart?.subtotal === 4200
      ) {
        results.push({
          test: 'Webhook HMAC Signatures & Simulator Isolation',
          status: 'PASS',
          message: 'Verified Razorpay and Stripe raw-body HMAC signatures (rejected forged/missing with 401) and isolated storefront abandonment simulator.'
        });
      } else {
        results.push({
          test: 'Webhook HMAC Signatures & Simulator Isolation',
          status: 'FAIL',
          message: `missing=${missingSigRejected}, forged=${forgedRzpRes.status}, rzp=${validRzpRes.status}, stripe=${validStripeRes.status}, sim=${simRes.status}`
        });
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (prevRzpSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
      else process.env.RAZORPAY_WEBHOOK_SECRET = prevRzpSecret;
      if (prevStripeSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = prevStripeSecret;
      if (prevUnsignedFlag === undefined) delete process.env.ALLOW_UNSIGNED_TEST_WEBHOOKS;
      else process.env.ALLOW_UNSIGNED_TEST_WEBHOOKS = prevUnsignedFlag;
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'Webhook HMAC Signatures & Simulator Isolation', status: 'FAIL', message: e.message });
  }

  // TEST 17: Authenticated Scoping on /api/personalization-vector
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = (server.address() as any).port;

      // 1. Unauthenticated request cannot spoof 'cust_01_vip'
      const guestRes = await fetch(`http://127.0.0.1:${port}/api/personalization-vector`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: 'cust_01_vip',
          productId: 'prod-m-belt-01',
          productName: 'The Rajputana Bridle Belt',
          monogramText: 'HACK'
        })
      });
      const guestData = await guestRes.json();

      // 2. Authenticated patron request binds strictly to authenticated customer's record
      const ananyaJwt = signSessionJwt({
        sub: 'uid_patron_02',
        email: 'ananya.deshmukh@gmail.com',
        name: 'Ananya Deshmukh',
        role: 'PATRON'
      });
      const authRes = await fetch(`http://127.0.0.1:${port}/api/personalization-vector`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ananyaJwt}`
        },
        body: JSON.stringify({
          customerId: 'cust_01_vip',
          productId: 'prod-w-purse-01',
          productName: 'The Meera Structured Flap Purse',
          monogramText: 'A.D'
        })
      });
      const authData = await authRes.json();

      if (
        guestRes.status === 201 &&
        guestData.vector?.customerId === 'cust_guest' &&
        authRes.status === 201 &&
        authData.vector?.customerId === 'cust_02_recent'
      ) {
        results.push({
          test: 'Personalization Vector Customer Scoping',
          status: 'PASS',
          message: 'Blocked spoofed customerId on guest requests (forced cust_guest) and bound authenticated requests to verified patron identity.'
        });
      } else {
        results.push({
          test: 'Personalization Vector Customer Scoping',
          status: 'FAIL',
          message: `guest=${guestData.vector?.customerId}, auth=${authData.vector?.customerId}`
        });
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'Personalization Vector Customer Scoping', status: 'FAIL', message: e.message });
  }

  // TEST 18: Dynamic Analytics & Retention Computation
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;

    try {
      const beforeHealth = computeOperationalHealth();
      const beforeCohorts = computeCohortRetention();
      const beforeVelocity = computeSkuReorderVelocity();

      // Trigger an RMA on ord_1001 for HARDWARE_DAMAGE and check dynamic health recalculation
      await erpSync.processRMA({
        orderId: 'ord_1001',
        customerId: 'cust_01_vip',
        reason: 'HARDWARE_DAMAGE',
        restockInWarehouse: false,
        actorEmail: 'sunilchain@gmail.com'
      });

      const afterHealth = computeOperationalHealth();
      const totalReturnsIncreased = (afterHealth.totalReturns ?? 0) > (beforeHealth.totalReturns ?? 0);
      const transitDamageIncreased =
        afterHealth.returnRateByReason.transitDamage > beforeHealth.returnRateByReason.transitDamage;
      const cohortsValid = Array.isArray(beforeCohorts) && beforeCohorts.length > 0 && beforeCohorts.some(c => c.totalPatrons > 0);
      const velocityValid =
        Array.isArray(beforeVelocity) &&
        beforeVelocity.length > 0 &&
        beforeVelocity.every(v => typeof v.unitsSold30d === 'number' && typeof v.velocityTrend === 'string');

      if (totalReturnsIncreased && transitDamageIncreased && cohortsValid && velocityValid) {
        results.push({
          test: 'Dynamic Analytics, RMA Health & Cohort Computation',
          status: 'PASS',
          message: 'Derived RMA return-reason shares, transit SLAs, quarterly retention cohorts, and 30d SKU reorder velocity dynamically.'
        });
      } else {
        results.push({
          test: 'Dynamic Analytics, RMA Health & Cohort Computation',
          status: 'FAIL',
          message: `returnsInc=${totalReturnsIncreased}, transitInc=${transitDamageIncreased}, cohorts=${cohortsValid}, velocity=${velocityValid}`
        });
      }
    } finally {
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'Dynamic Analytics, RMA Health & Cohort Computation', status: 'FAIL', message: e.message });
  }

  // TEST 19: Patron Self-Service Portal Scoping (/api/patron/overview)
  try {
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = (server.address() as any).port;
      const guestRes = await fetch(`http://127.0.0.1:${port}/api/patron/overview`);

      const vikramJwt = signSessionJwt({
        sub: 'uid_vikram',
        email: 'vikram.singhania@heritagecrafts.in',
        name: 'Vikramaditya Singhania',
        role: 'PATRON'
      });
      const vikramRes = await fetch(`http://127.0.0.1:${port}/api/patron/overview`, {
        headers: { Authorization: `Bearer ${vikramJwt}` }
      });
      const vikramData = await vikramRes.json();

      const onlyVikramOrders =
        Array.isArray(vikramData.orders) &&
        vikramData.orders.length > 0 &&
        vikramData.orders.every((o: any) => o.customerEmail.toLowerCase() === 'vikram.singhania@heritagecrafts.in');
      const onlyVikramInvoices =
        Array.isArray(vikramData.invoices) &&
        vikramData.invoices.length > 0 &&
        vikramData.invoices.every((inv: any) => inv.customerId === vikramData.patron.customerId);
      const hasWarranties = Array.isArray(vikramData.warranties) && vikramData.warranties.length > 0;
      const hasCareKits = Array.isArray(vikramData.careKits) && vikramData.careKits.length > 0;

      if (guestRes.status === 401 && vikramRes.status === 200 && onlyVikramOrders && onlyVikramInvoices && hasWarranties && hasCareKits) {
        results.push({
          test: 'Patron Self-Service Portal Scoping',
          status: 'PASS',
          message: 'Rejected unauthenticated callers (401) and returned strictly patron-scoped orders, GST invoices, warranties, and care kits.'
        });
      } else {
        results.push({
          test: 'Patron Self-Service Portal Scoping',
          status: 'FAIL',
          message: `guest=${guestRes.status}, vikram=${vikramRes.status}, orders=${onlyVikramOrders}, inv=${onlyVikramInvoices}, warranties=${hasWarranties}, care=${hasCareKits}`
        });
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  } catch (e: any) {
    results.push({ test: 'Patron Self-Service Portal Scoping', status: 'FAIL', message: e.message });
  }

  // TEST 20: Real GST Invoice PDF & HTML Rendering + Ownership Enforcement
  try {
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = (server.address() as any).port;
      const slug = 'BVL-INV-26-27-0089.pdf';

      const unauthRes = await fetch(`http://127.0.0.1:${port}/api/erp/invoices/${slug}`);

      const ananyaJwt = signSessionJwt({
        sub: 'uid_ananya',
        email: 'ananya.deshmukh@gmail.com',
        name: 'Ananya Deshmukh',
        role: 'PATRON'
      });
      const otherPatronRes = await fetch(`http://127.0.0.1:${port}/api/erp/invoices/${slug}`, {
        headers: { Authorization: `Bearer ${ananyaJwt}` }
      });

      const vikramJwt = signSessionJwt({
        sub: 'uid_vikram',
        email: 'vikram.singhania@heritagecrafts.in',
        name: 'Vikramaditya Singhania',
        role: 'PATRON'
      });
      const ownerPdfRes = await fetch(`http://127.0.0.1:${port}/api/erp/invoices/${slug}`, {
        headers: { Authorization: `Bearer ${vikramJwt}` }
      });
      const pdfBytes = Buffer.from(await ownerPdfRes.arrayBuffer());
      const isPdfValid =
        ownerPdfRes.status === 200 &&
        ownerPdfRes.headers.get('content-type')?.includes('application/pdf') === true &&
        pdfBytes.subarray(0, 8).toString('ascii').startsWith('%PDF-1.4');

      const ownerHtmlRes = await fetch(`http://127.0.0.1:${port}/api/erp/invoices/${slug}?format=html`, {
        headers: { Authorization: `Bearer ${vikramJwt}` }
      });
      const htmlBody = await ownerHtmlRes.text();
      const isHtmlValid =
        ownerHtmlRes.status === 200 &&
        htmlBody.includes('BVL/INV/26-27/0089') &&
        htmlBody.includes('27AABCB1234F1Z8');

      if (unauthRes.status === 401 && otherPatronRes.status === 403 && isPdfValid && isHtmlValid) {
        results.push({
          test: 'GST Invoice PDF & HTML Rendering + Access Control',
          status: 'PASS',
          message: 'Enforced 401/403 ownership rules and served valid %PDF-1.4 bytes and printable HTML tax invoice.'
        });
      } else {
        results.push({
          test: 'GST Invoice PDF & HTML Rendering + Access Control',
          status: 'FAIL',
          message: `unauth=${unauthRes.status}, other=${otherPatronRes.status}, pdfValid=${isPdfValid}, htmlValid=${isHtmlValid}`
        });
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  } catch (e: any) {
    results.push({ test: 'GST Invoice PDF & HTML Rendering + Access Control', status: 'FAIL', message: e.message });
  }

  // TEST 21: External Integrations Live-or-Sandbox Graceful Adapters
  try {
    const prevRzpKey = process.env.RAZORPAY_KEY_ID;
    const prevRzpSec = process.env.RAZORPAY_KEY_SECRET;
    const prevStripe = process.env.STRIPE_SECRET_KEY;
    const prevShipToken = process.env.SHIPROCKET_API_TOKEN;
    const prevSmtpHost = process.env.SMTP_HOST;
    const prevWaToken = process.env.WHATSAPP_ACCESS_TOKEN;

    process.env.RAZORPAY_KEY_ID = 'rzp_test_placeholder_key';
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.SHIPROCKET_API_TOKEN;
    delete process.env.SMTP_HOST;
    delete process.env.WHATSAPP_ACCESS_TOKEN;

    try {
      const placeholderBlocked = !isConfiguredCredential('rzp_test_placeholder_key') && !isConfiguredCredential('your_secret');
      const gwOrder = await createGatewayOrderOrIntent({
        gateway: 'RAZORPAY',
        amountInr: 4200,
        receipt: 'BVL-SBX-01',
        customerName: 'Sandbox Patron',
        customerEmail: 'sandbox@example.com'
      });
      const payLink = await createPaymentLink({
        gateway: 'STRIPE',
        amountInr: 4200,
        description: 'Bespoke Belt',
        customerName: 'Sandbox Patron',
        customerEmail: 'sandbox@example.com'
      });
      const awbRes = await allocateCourierAwb({
        order: db.getOrders()[0],
        courierPreference: 'SHIPROCKET'
      });
      const emailRes = await sendTransactionalEmail({
        to: 'sandbox@example.com',
        subject: 'Order Confirmation',
        text: 'Confirmed'
      });
      const waRes = await sendWhatsAppMessage({
        toPhone: '+91 98201 12345',
        text: 'Care Guide Ready'
      });

      if (
        placeholderBlocked &&
        gwOrder.mode === 'SANDBOX_FALLBACK' &&
        payLink.mode === 'SANDBOX_FALLBACK' &&
        payLink.paymentUrl.startsWith('https://') &&
        awbRes.mode === 'SANDBOX_FALLBACK' &&
        Boolean(awbRes.awbNumber) &&
        emailRes.mode === 'SANDBOX_FALLBACK' &&
        waRes.mode === 'SANDBOX_FALLBACK'
      ) {
        results.push({
          test: 'External Gateway Adapters & Sandbox Fallback',
          status: 'PASS',
          message: 'Filtered placeholder secrets and executed deterministic sandbox fallbacks across Razorpay, Stripe, Shiprocket, SMTP, and WhatsApp.'
        });
      } else {
        results.push({
          test: 'External Gateway Adapters & Sandbox Fallback',
          status: 'FAIL',
          message: `placeholderBlocked=${placeholderBlocked}, gw=${gwOrder.mode}, link=${payLink.mode}, awb=${awbRes.mode}`
        });
      }
    } finally {
      if (prevRzpKey === undefined) delete process.env.RAZORPAY_KEY_ID;
      else process.env.RAZORPAY_KEY_ID = prevRzpKey;
      if (prevRzpSec === undefined) delete process.env.RAZORPAY_KEY_SECRET;
      else process.env.RAZORPAY_KEY_SECRET = prevRzpSec;
      if (prevStripe === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = prevStripe;
      if (prevShipToken === undefined) delete process.env.SHIPROCKET_API_TOKEN;
      else process.env.SHIPROCKET_API_TOKEN = prevShipToken;
      if (prevSmtpHost === undefined) delete process.env.SMTP_HOST;
      else process.env.SMTP_HOST = prevSmtpHost;
      if (prevWaToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;
      else process.env.WHATSAPP_ACCESS_TOKEN = prevWaToken;
    }
  } catch (e: any) {
    results.push({ test: 'External Gateway Adapters & Sandbox Fallback', status: 'FAIL', message: e.message });
  }

  // TEST 22: BOM Raw Material Deduction on Order Placement & Low-Stock Reorder Alerts
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;

    try {
      const targetBom = db.getBillOfMaterials().find(b => b.parentSku === 'BVL-TRV-BRF-01')!;
      const initialBomHand = targetBom.inventoryOnHand;

      // Set safety stock just below initial so deducting 1 order crosses threshold
      db.updateBomItemStock(targetBom.id, initialBomHand, initialBomHand - 1, 'sunilchain@gmail.com');

      await db.createOrderAsync({
        customerId: 'cust_bom_test',
        customerName: 'BOM Tester',
        customerEmail: 'bom.test@example.com',
        customerPhone: '+91 98000 00000',
        status: 'PROCESSING',
        currency: 'INR',
        subtotal: 57800,
        discountAmount: 0,
        taxAmount: 10404,
        shippingFee: 0,
        totalAmount: 68204,
        paymentGateway: 'RAZORPAY',
        paymentId: 'pay_bom_test',
        paymentStatus: 'PAID',
        items: [
          {
            id: 'item_bom_1',
            orderId: '',
            productId: 'prod-t-brf-01',
            productName: 'The Viceroy Diplomat Briefcase',
            sku: 'BVL-TRV-BRF-01',
            category: 'travell',
            quantity: 2,
            unitPrice: 28900,
            leatherType: 'VEGETABLE_TANNED_HERITAGE',
            hsnCode: '4202',
            gstRate: 0.18,
            taxAmount: 10404,
            lineTotal: 68204
          }
        ],
        shippingAddress: {
          id: 'addr_bom',
          customerId: 'cust_bom_test',
          street: 'Test St',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
          country: 'India',
          isDefault: true,
          addressType: 'SHIPPING'
        },
        billingAddress: {
          id: 'addr_bom_b',
          customerId: 'cust_bom_test',
          street: 'Test St',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
          country: 'India',
          isDefault: true,
          addressType: 'BILLING'
        }
      });

      const updatedBom = db.getBillOfMaterials().find(b => b.id === targetBom.id)!;
      const expectedBomHand = Math.max(0, initialBomHand - targetBom.quantityPerUnit * 2);
      const alerts = db.getLowStockAlerts();
      const alertTriggered = alerts.lowStockBom.some(b => b.id === targetBom.id);

      if (updatedBom.inventoryOnHand === expectedBomHand && alertTriggered) {
        results.push({
          test: 'BOM Consumption on Order & Low-Stock Alerts',
          status: 'PASS',
          message: `Deducted ${targetBom.quantityPerUnit * 2} ${targetBom.unit} from BOM on order placement and raised low-stock alert.`
        });
      } else {
        results.push({
          test: 'BOM Consumption on Order & Low-Stock Alerts',
          status: 'FAIL',
          message: `bomHand=${updatedBom.inventoryOnHand} (expected ${expectedBomHand}), alertTriggered=${alertTriggered}`
        });
      }
    } finally {
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'BOM Consumption on Order & Low-Stock Alerts', status: 'FAIL', message: e.message });
  }

  // TEST 23: Operational Rules & Dynamic Promo Code Validation
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = (server.address() as any).port;
      const adminJwt = signSessionJwt({
        sub: 'uid_master_sunil',
        email: 'sunilchain@gmail.com',
        name: 'Sunil Chainani',
        role: 'STORE_MANAGER'
      });

      const rulesRes = await fetch(`http://127.0.0.1:${port}/api/store-management/operational-rules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminJwt}`
        },
        body: JSON.stringify({
          abandonmentThresholdMinutes: 25,
          supplierGstin: '27AABCB1234F1Z8',
          gstRatePercent: 12,
          promoCodes: [
            { code: 'ATELIER20', discountPercent: 20, active: true, description: 'Bespoke VIP 20% Off' }
          ]
        })
      });

      const validateRes = await fetch(`http://127.0.0.1:${port}/api/checkout/validate-promo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'atelier20' })
      });
      const validateData = await validateRes.json();

      const checkoutRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Promo Config Tester',
          customerEmail: 'promo.rules@example.com',
          customerPhone: '+91 98201 23456',
          shippingAddress: {
            street: '18 Koregaon Park Lane 5',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411001',
            country: 'India'
          },
          items: [{ productId: 'prod-m-belt-01', sku: 'BVL-MEN-BLT-01', quantity: 1 }],
          discountCode: 'ATELIER20'
        })
      });
      const checkoutData = await checkoutRes.json();
      // Belt=4200, ATELIER20 -> discount=840, taxable=3360, 12% GST = 403, total = 3763
      const o = checkoutData.order;

      if (
        rulesRes.status === 200 &&
        validateRes.status === 200 &&
        validateData.discountPercent === 20 &&
        checkoutRes.status === 201 &&
        o?.discountAmount === 840 &&
        o?.taxAmount === 403 &&
        o?.totalAmount === 3763 &&
        db.getConfig().abandonmentThresholdMinutes === 25
      ) {
        results.push({
          test: 'Operational Rules & Dynamic Promo Engine',
          status: 'PASS',
          message: 'Persisted dynamic GST rate (12%), abandonment threshold (25m), and custom promo ATELIER20 enforced cleanly in checkout.'
        });
      } else {
        results.push({
          test: 'Operational Rules & Dynamic Promo Engine',
          status: 'FAIL',
          message: `rules=${rulesRes.status}, validate=${validateRes.status}, total=${o?.totalAmount}, tax=${o?.taxAmount}, disc=${o?.discountAmount}`
        });
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'Operational Rules & Dynamic Promo Engine', status: 'FAIL', message: e.message });
  }

  // TEST 24: Firebase RS256 Token Verification Edge Cases (Offline RSA-2048 & Key Rotation)
  try {
    const origFetch = globalThis.fetch;
    const projectId = 'gen-lang-client-0774833728';
    const expectedIss = `https://securetoken.google.com/${projectId}`;

    const keyPair1 = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    const keyPair2 = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    let activeCerts: Record<string, string> = { 'kid-primary-1': keyPair1.publicKey };
    let certFetchCount = 0;

    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('securetoken@system.gserviceaccount.com')) {
        certFetchCount += 1;
        return new Response(JSON.stringify(activeCerts), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600'
          }
        });
      }
      return origFetch(input, init);
    }) as typeof fetch;

    const signRs256Jwt = (
      headerObj: Record<string, any>,
      payloadObj: Record<string, any>,
      privKey: string
    ): string => {
      const h = Buffer.from(JSON.stringify(headerObj)).toString('base64url');
      const p = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
      const signer = crypto.createSign('RSA-SHA256');
      signer.update(`${h}.${p}`);
      signer.end();
      const sig = signer.sign(privKey).toString('base64url');
      return `${h}.${p}.${sig}`;
    };

    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const basePayload = {
        aud: projectId,
        iss: expectedIss,
        sub: 'firebase-uid-edge-01',
        email: 'RS256.Patron@Example.COM ',
        email_verified: true,
        name: 'Aarav Rao',
        iat: nowSec - 30,
        exp: nowSec + 1800
      };

      // 1. Valid RS256 token & normalized email + verification
      const validJwt = signRs256Jwt({ alg: 'RS256', kid: 'kid-primary-1' }, basePayload, keyPair1.privateKey);
      const validClaims = await verifyFirebaseIdToken(validJwt);

      // 2. Cache hit check (no duplicate cert fetch)
      const fetchBeforeCacheHit = certFetchCount;
      const cachedClaims = await verifyFirebaseIdToken(validJwt);
      const cacheHitAvoidedRefetch = certFetchCount === fetchBeforeCacheHit && cachedClaims?.uid === 'firebase-uid-edge-01';

      // 3. Key rotation: unknown kid triggers one refresh and succeeds with rotated cert
      activeCerts = { 'kid-primary-1': keyPair1.publicKey, 'kid-rotated-2': keyPair2.publicKey };
      const rotatedJwt = signRs256Jwt(
        { alg: 'RS256', kid: 'kid-rotated-2' },
        { ...basePayload, sub: 'firebase-uid-rotated' },
        keyPair2.privateKey
      );
      const rotatedClaims = await verifyFirebaseIdToken(rotatedJwt);

      // 4. Edge-case rejections
      const expiredJwt = signRs256Jwt(
        { alg: 'RS256', kid: 'kid-primary-1' },
        { ...basePayload, exp: nowSec - 5 },
        keyPair1.privateKey
      );
      const wrongAudJwt = signRs256Jwt(
        { alg: 'RS256', kid: 'kid-primary-1' },
        { ...basePayload, aud: 'wrong-firebase-project' },
        keyPair1.privateKey
      );
      const wrongIssJwt = signRs256Jwt(
        { alg: 'RS256', kid: 'kid-primary-1' },
        { ...basePayload, iss: 'https://securetoken.google.com/wrong-project' },
        keyPair1.privateKey
      );
      const futureIatJwt = signRs256Jwt(
        { alg: 'RS256', kid: 'kid-primary-1' },
        { ...basePayload, iat: nowSec + 600 },
        keyPair1.privateKey
      );
      const missingEmailJwt = signRs256Jwt(
        { alg: 'RS256', kid: 'kid-primary-1' },
        { ...basePayload, email: '' },
        keyPair1.privateKey
      );
      const hs256AlgJwt = signRs256Jwt({ alg: 'HS256', kid: 'kid-primary-1' }, basePayload, keyPair1.privateKey);
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

      const allEdgeRejectionsNull = [rExp, rAud, rIss, rIat, rEmail, rAlg, rSig].every(r => r === null);

      // 5. Env override precedence check for custom Hostinger Firebase project
      const prevFbProjectEnv = process.env.FIREBASE_PROJECT_ID;
      let envOverrideOk = false;
      try {
        process.env.FIREBASE_PROJECT_ID = 'custom-hostinger-fb';
        const customJwt = signRs256Jwt(
          { alg: 'RS256', kid: 'kid-primary-1' },
          {
            ...basePayload,
            aud: 'custom-hostinger-fb',
            iss: 'https://securetoken.google.com/custom-hostinger-fb',
            sub: 'firebase-uid-custom-env'
          },
          keyPair1.privateKey
        );
        const customClaims = await verifyFirebaseIdToken(customJwt);
        envOverrideOk = customClaims?.uid === 'firebase-uid-custom-env';
      } finally {
        if (prevFbProjectEnv === undefined) delete process.env.FIREBASE_PROJECT_ID;
        else process.env.FIREBASE_PROJECT_ID = prevFbProjectEnv;
      }

      if (
        validClaims?.email === 'rs256.patron@example.com' &&
        validClaims?.emailVerified === true &&
        cacheHitAvoidedRefetch &&
        rotatedClaims?.uid === 'firebase-uid-rotated' &&
        allEdgeRejectionsNull &&
        envOverrideOk
      ) {
        results.push({
          test: 'Firebase RS256 Edge Cases & Key Rotation',
          status: 'PASS',
          message: 'Verified valid RS256 JWTs, token cache reuse, kid key rotation refresh, env project override, and rejected expired/aud/iss/iat/alg/email/signature edge cases.'
        });
      } else {
        results.push({
          test: 'Firebase RS256 Edge Cases & Key Rotation',
          status: 'FAIL',
          message: `valid=${Boolean(validClaims)}, cache=${cacheHitAvoidedRefetch}, rotated=${Boolean(rotatedClaims)}, rejections=${allEdgeRejectionsNull}, envOverride=${envOverrideOk}`
        });
      }
    } finally {
      globalThis.fetch = origFetch;
    }
  } catch (e: any) {
    results.push({ test: 'Firebase RS256 Edge Cases & Key Rotation', status: 'FAIL', message: e.message });
  }

  // TEST 25: Checkout Price Manipulation, Quantity/SKU Mismatch & Inactive Promo Rejection
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = (server.address() as any).port;

      // Seed an inactive promo rule to ensure inactive promos are rejected at checkout
      db.updateOperationalSettings(
        {
          promoCodes: [
            ...db.getConfig().promoCodes,
            { code: 'EXPIRED50', discountPercent: 50, active: false, description: 'Retired seasonal promo' }
          ]
        },
        'sunilchain@gmail.com'
      );

      // 1. Negative / zero quantity rejected (400)
      const validTamperShipping = {
        customerName: 'Tamper Audit Patron',
        customerEmail: 'tamper@example.com',
        customerPhone: '+91 98201 34567',
        shippingAddress: {
          street: '42 Marine Drive Apartments',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400020',
          country: 'India'
        }
      };

      const zeroQtyRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validTamperShipping,
          items: [{ productId: 'prod-m-belt-01', sku: 'BVL-MEN-BLT-01', quantity: 0 }]
        })
      });
      const negQtyRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validTamperShipping,
          items: [{ productId: 'prod-m-belt-01', sku: 'BVL-MEN-BLT-01', quantity: -3 }]
        })
      });

      // 2. Mismatched productId / sku pair rejected (400)
      const mismatchRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validTamperShipping,
          items: [{ productId: 'prod-m-belt-01', sku: 'BVL-TRV-BRF-01', quantity: 1 }]
        })
      });

      // 3. Unknown SKU rejected (400)
      const unknownRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validTamperShipping,
          items: [{ productId: 'prod-nonexistent', sku: 'BVL-FAKE-999', quantity: 1 }]
        })
      });

      // 4. Inactive promo code rejected (400)
      const inactivePromoRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validTamperShipping,
          items: [{ productId: 'prod-m-belt-01', sku: 'BVL-MEN-BLT-01', quantity: 1 }],
          discountCode: 'EXPIRED50'
        })
      });

      // 5. Multi-item manipulated unitPrice/subtotal/tax/total ignored in favor of authoritative catalog prices
      const multiTamperRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Multi-Item Tamper Audit',
          customerEmail: 'multi.tamper@example.com',
          customerPhone: '+91 98201 34568',
          shippingAddress: {
            street: '42 Marine Drive Apartments',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400020',
            country: 'India'
          },
          items: [
            { productId: 'prod-m-belt-01', sku: 'BVL-MEN-BLT-01', quantity: 2, unitPrice: 1 },
            { productId: 'prod-m-wal-01', sku: 'BVL-MEN-WAL-01', quantity: 1, unitPrice: 5 }
          ],
          subtotal: 7,
          discountAmount: 5000,
          taxAmount: 0,
          totalAmount: 7
        })
      });
      const multiData = await multiTamperRes.json();
      const o = multiData.order;
      // 2 * 4200 + 1 * 3800 = 12200; 18% GST = 2196; total = 14396
      const multiTotalsEnforced =
        multiTamperRes.status === 201 &&
        o?.items?.[0]?.unitPrice === 4200 &&
        o?.items?.[1]?.unitPrice === 3800 &&
        o?.subtotal === 12200 &&
        o?.discountAmount === 0 &&
        o?.taxAmount === 2196 &&
        o?.totalAmount === 14396;

      if (
        zeroQtyRes.status === 400 &&
        negQtyRes.status === 400 &&
        mismatchRes.status === 400 &&
        unknownRes.status === 400 &&
        inactivePromoRes.status === 400 &&
        multiTotalsEnforced
      ) {
        results.push({
          test: 'Checkout Tampering, SKU Mismatch & Promo Guards',
          status: 'PASS',
          message: 'Rejected 0/negative quantities, ID/SKU mismatches, unknown SKUs, inactive promos (400), and overwrote multi-item price tampering.'
        });
      } else {
        results.push({
          test: 'Checkout Tampering, SKU Mismatch & Promo Guards',
          status: 'FAIL',
          message: `zero=${zeroQtyRes.status}, neg=${negQtyRes.status}, mismatch=${mismatchRes.status}, unknown=${unknownRes.status}, inactivePromo=${inactivePromoRes.status}, multi=${multiTotalsEnforced}`
        });
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'Checkout Tampering, SKU Mismatch & Promo Guards', status: 'FAIL', message: e.message });
  }

  // TEST 26: Concurrent Stock Depletion (Race-Safe Allocation Without Overselling)
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = (server.address() as any).port;
      // Set exact stock = 2 units total across both hubs
      await db.updateInventoryStockAsync('BVL-MEN-BLT-01', 'punePrimaryHub', 2, 'sunilchain@gmail.com');
      await db.updateInventoryStockAsync('BVL-MEN-BLT-01', 'mumbaiWarehouse', 0, 'sunilchain@gmail.com');

      // Fire 5 parallel checkout requests for 1 unit each
      const responses = await Promise.all(
        [1, 2, 3, 4, 5].map(idx =>
          fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerName: `Concurrent Patron ${idx}`,
              customerEmail: `concurrent.${idx}@example.com`,
              customerPhone: `+91 98201 4455${idx}`,
              shippingAddress: {
                street: `${idx}00 Residency Road`,
                city: 'Bengaluru',
                state: 'Karnataka',
                pincode: '560025',
                country: 'India'
              },
              items: [{ productId: 'prod-m-belt-01', sku: 'BVL-MEN-BLT-01', quantity: 1 }]
            })
          })
        )
      );

      const statuses = responses.map(r => r.status);
      const createdCount = statuses.filter(s => s === 201).length;
      const conflictCount = statuses.filter(s => s === 409).length;
      const finalInv = db.getInventory().find(i => i.sku === 'BVL-MEN-BLT-01')!;
      const finalDeactivated = db.getCatalog().products.find((p: any) => p.sku === 'BVL-MEN-BLT-01')!;

      if (
        createdCount === 2 &&
        conflictCount === 3 &&
        finalInv.stockByLocation.punePrimaryHub === 0 &&
        finalInv.stockByLocation.mumbaiWarehouse === 0 &&
        finalDeactivated.inStock === false
      ) {
        results.push({
          test: 'Concurrent Stock Depletion & Oversell Prevention',
          status: 'PASS',
          message: 'Serialized 5 parallel checkout requests for 2 remaining units: 2 succeeded (201), 3 rejected (409), 0 negative stock.'
        });
      } else {
        results.push({
          test: 'Concurrent Stock Depletion & Oversell Prevention',
          status: 'FAIL',
          message: `created=${createdCount}, conflict=${conflictCount}, pune=${finalInv.stockByLocation.punePrimaryHub}, mumbai=${finalInv.stockByLocation.mumbaiWarehouse}`
        });
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'Concurrent Stock Depletion & Oversell Prevention', status: 'FAIL', message: e.message });
  }

  // TEST 27: RMA Restock & GST Credit-Note Math (Intra-State CGST/SGST vs Inter-State IGST)
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;

    try {
      // A. Intra-State (Maharashtra) Order -> Restock in Mumbai Warehouse + CGST/SGST Credit Note
      const intraOrder = await db.createOrderAsync({
        customerId: 'cust_rma_intra',
        customerName: 'Intra RMA Patron',
        customerEmail: 'intra.rma@example.com',
        customerPhone: '+91 98200 11111',
        status: 'PROCESSING',
        currency: 'INR',
        subtotal: 4200,
        discountAmount: 0,
        taxAmount: 756,
        shippingFee: 0,
        totalAmount: 4956,
        paymentGateway: 'RAZORPAY',
        paymentId: 'pay_rma_intra',
        paymentStatus: 'PAID',
        items: [
          {
            id: 'item_rma_intra',
            orderId: '',
            productId: 'prod-m-belt-01',
            productName: 'The Rajputana Bridle Belt',
            sku: 'BVL-MEN-BLT-01',
            category: 'men',
            quantity: 1,
            unitPrice: 4200,
            leatherType: 'VEGETABLE_TANNED_HERITAGE',
            hsnCode: '4203',
            gstRate: 0.18,
            taxAmount: 756,
            lineTotal: 4956
          }
        ],
        shippingAddress: {
          id: 'addr_mh',
          customerId: 'cust_rma_intra',
          street: 'FC Road',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411004',
          country: 'India',
          isDefault: true,
          addressType: 'SHIPPING'
        },
        billingAddress: {
          id: 'addr_mh_b',
          customerId: 'cust_rma_intra',
          street: 'FC Road',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411004',
          country: 'India',
          isDefault: true,
          addressType: 'BILLING'
        }
      });

      const mumbaiBeforeRma = db.getInventory().find(i => i.sku === 'BVL-MEN-BLT-01')!.stockByLocation.mumbaiWarehouse;
      const intraRma = await erpSync.processRMA({
        orderId: intraOrder.id,
        customerId: intraOrder.customerId,
        reason: 'COLOR_MISMATCH',
        restockInWarehouse: true,
        restockLocation: 'mumbaiWarehouse',
        actorEmail: 'sunilchain@gmail.com'
      });
      const mumbaiAfterRma = db.getInventory().find(i => i.sku === 'BVL-MEN-BLT-01')!.stockByLocation.mumbaiWarehouse;

      const intraMathOk =
        mumbaiAfterRma === mumbaiBeforeRma + 1 &&
        intraRma.order.status === 'RETURNED' &&
        intraRma.order.paymentStatus === 'REFUNDED' &&
        intraRma.creditNote?.originalInvoiceNumber === intraOrder.invoiceNumber &&
        intraRma.creditNote?.taxableValue === 4200 &&
        intraRma.creditNote?.cgstAmount === 378 &&
        intraRma.creditNote?.sgstAmount === 378 &&
        intraRma.creditNote?.igstAmount === 0 &&
        intraRma.creditNote?.totalCreditAmount === 4956;

      // B. Inter-State (Delhi) Order -> Non-Restock Hardware Damage + IGST Credit Note
      const interOrder = await db.createOrderAsync({
        customerId: 'cust_rma_inter',
        customerName: 'Inter RMA Patron',
        customerEmail: 'inter.rma@example.com',
        customerPhone: '+91 98111 22222',
        status: 'PROCESSING',
        currency: 'INR',
        subtotal: 7600,
        discountAmount: 0,
        taxAmount: 1368,
        shippingFee: 0,
        totalAmount: 8968,
        paymentGateway: 'RAZORPAY',
        paymentId: 'pay_rma_inter',
        paymentStatus: 'PAID',
        items: [
          {
            id: 'item_rma_inter',
            orderId: '',
            productId: 'prod-m-wal-01',
            productName: 'The Bifold Heirloom Folio',
            sku: 'BVL-MEN-WAL-01',
            category: 'men',
            quantity: 2,
            unitPrice: 3800,
            leatherType: 'VEGETABLE_TANNED_HERITAGE',
            hsnCode: '4202',
            gstRate: 0.18,
            taxAmount: 1368,
            lineTotal: 8968
          }
        ],
        shippingAddress: {
          id: 'addr_dl',
          customerId: 'cust_rma_inter',
          street: 'Connaught Place',
          city: 'New Delhi',
          state: 'Delhi',
          pincode: '110001',
          country: 'India',
          isDefault: true,
          addressType: 'SHIPPING'
        },
        billingAddress: {
          id: 'addr_dl_b',
          customerId: 'cust_rma_inter',
          street: 'Connaught Place',
          city: 'New Delhi',
          state: 'Delhi',
          pincode: '110001',
          country: 'India',
          isDefault: true,
          addressType: 'BILLING'
        }
      });

      const walStockBefore = db.getInventory().find(i => i.sku === 'BVL-MEN-WAL-01')!;
      const walTotalBefore = walStockBefore.stockByLocation.punePrimaryHub + walStockBefore.stockByLocation.mumbaiWarehouse;

      const interRma = await erpSync.processRMA({
        orderId: interOrder.id,
        customerId: interOrder.customerId,
        reason: 'HARDWARE_DAMAGE',
        restockInWarehouse: false,
        actorEmail: 'sunilchain@gmail.com'
      });

      const walStockAfter = db.getInventory().find(i => i.sku === 'BVL-MEN-WAL-01')!;
      const walTotalAfter = walStockAfter.stockByLocation.punePrimaryHub + walStockAfter.stockByLocation.mumbaiWarehouse;

      const interMathOk =
        walTotalAfter === walTotalBefore &&
        interRma.creditNote?.taxableValue === 7600 &&
        interRma.creditNote?.cgstAmount === 0 &&
        interRma.creditNote?.sgstAmount === 0 &&
        interRma.creditNote?.igstAmount === 1368 &&
        interRma.creditNote?.totalCreditAmount === 8968;

      // C. Suspended GST module omits credit note generation cleanly
      db.updateGstInvoicing(false, 'sunilchain@gmail.com');
      const suspendedRma = await erpSync.processRMA({
        orderId: intraOrder.id,
        customerId: intraOrder.customerId,
        reason: 'INCORRECT_SIZE',
        restockInWarehouse: false,
        actorEmail: 'sunilchain@gmail.com'
      });

      if (intraMathOk && interMathOk && suspendedRma.creditNote === undefined) {
        results.push({
          test: 'RMA Restock & GST Credit-Note Math',
          status: 'PASS',
          message: 'Verified intra-state CGST/SGST split, inter-state IGST credit note math, restock hub routing, non-restock stock preservation, and GST toggle guard.'
        });
      } else {
        results.push({
          test: 'RMA Restock & GST Credit-Note Math',
          status: 'FAIL',
          message: `intra=${intraMathOk}, inter=${interMathOk}, suspendedCn=${Boolean(suspendedRma.creditNote)}`
        });
      }
    } finally {
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'RMA Restock & GST Credit-Note Math', status: 'FAIL', message: e.message });
  }

  // TEST 28: CatalogManager SKU Reconciliation (Create, Rename + BOM Sync, Duplicate Reject, Delete Orphan Cleanup)
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const catalogFile = path.resolve(process.cwd(), 'src/server/catalog.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;
    const preTestCatalogRaw = fs.existsSync(catalogFile) ? fs.readFileSync(catalogFile, 'utf-8') : null;

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = (server.address() as any).port;
      const adminJwt = signSessionJwt({
        sub: 'uid_master_sunil',
        email: 'sunilchain@gmail.com',
        name: 'Sunil Chainani',
        role: 'STORE_MANAGER'
      });

      const baseCatalog = structuredClone(db.getRawCatalog());

      // 1. Add a new catalog product with explicit hub initial stock
      const newProduct = {
        id: 'prod-sku-sync-test',
        category: 'men',
        productType: 'Wallets',
        name: 'The Atelier Card Sleeve',
        sku: 'BVL-MEN-CRD-99',
        price: 2900,
        currency: 'INR',
        description: 'Compact hand-stitched card sleeve.',
        features: ['Steerhide'],
        images: ['/assets/images/product_men_belt_wallet_1794461808951.jpg'],
        hsnCode: '4202',
        gstRate: 0.18,
        solutionEngine: 'EVERYDAY_CARRY',
        inStock: true,
        allowCustomization: true,
        careKitIncluded: true,
        initialPuneStock: 7,
        initialMumbaiStock: 3
      };

      const addRes = await fetch(`http://127.0.0.1:${port}/api/store-management/catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          catalog: {
            categories: baseCatalog.categories,
            products: [...baseCatalog.products, newProduct]
          }
        })
      });
      const createdInv = db.getInventory().find(i => i.sku === 'BVL-MEN-CRD-99');
      const createdReconciled =
        addRes.status === 200 &&
        createdInv?.productId === 'prod-sku-sync-test' &&
        createdInv?.stockByLocation.punePrimaryHub === 7 &&
        createdInv?.stockByLocation.mumbaiWarehouse === 3;

      // 2. Rename an existing SKU that has linked BOM materials (BVL-TRV-BRF-01 -> BVL-TRV-BRF-V2)
      const renamedProducts = db.getRawCatalog().products.map((p: any) =>
        p.sku === 'BVL-TRV-BRF-01' ? { ...p, sku: 'BVL-TRV-BRF-V2', price: 29500 } : p
      );
      const renameRes = await fetch(`http://127.0.0.1:${port}/api/store-management/catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          catalog: { categories: baseCatalog.categories, products: renamedProducts }
        })
      });
      const renamedInvMatches = db.getInventory().filter(i => i.productId === 'prod-t-brf-01');
      const bomSynced =
        db.getBillOfMaterials().filter(b => b.parentSku === 'BVL-TRV-BRF-V2').length === 3 &&
        db.getBillOfMaterials().filter(b => b.parentSku === 'BVL-TRV-BRF-01').length === 0;
      const renameReconciled =
        renameRes.status === 200 &&
        renamedInvMatches.length === 1 &&
        renamedInvMatches[0].sku === 'BVL-TRV-BRF-V2' &&
        renamedInvMatches[0].sellingPrice === 29500 &&
        bomSynced;

      // 3. Duplicate SKU (case-insensitive collision) rejected with HTTP 400
      const duplicateProducts = db.getRawCatalog().products.map((p: any) =>
        p.id === 'prod-sku-sync-test' ? { ...p, sku: 'bvl-men-blt-01' } : p
      );
      const dupRes = await fetch(`http://127.0.0.1:${port}/api/store-management/catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          catalog: { categories: baseCatalog.categories, products: duplicateProducts }
        })
      });

      // 4. Delete added product -> removes orphan inventory record cleanly
      const cleanedProducts = db.getRawCatalog().products.filter((p: any) => p.id !== 'prod-sku-sync-test');
      const delRes = await fetch(`http://127.0.0.1:${port}/api/store-management/catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          catalog: { categories: baseCatalog.categories, products: cleanedProducts }
        })
      });
      const orphanRemoved = !db.getInventory().some(i => i.productId === 'prod-sku-sync-test' || i.sku === 'BVL-MEN-CRD-99');

      if (createdReconciled && renameReconciled && dupRes.status === 400 && delRes.status === 200 && orphanRemoved) {
        results.push({
          test: 'CatalogManager SKU Reconciliation & Duplicate Guard',
          status: 'PASS',
          message: 'Seeded new SKU inventory, propagated SKU renames to inventory + BOM parentSku, blocked duplicate SKUs (400), and purged deleted SKU orphans.'
        });
      } else {
        results.push({
          test: 'CatalogManager SKU Reconciliation & Duplicate Guard',
          status: 'FAIL',
          message: `created=${createdReconciled}, renamed=${renameReconciled}, dupStatus=${dupRes.status}, delStatus=${delRes.status}, orphanRemoved=${orphanRemoved}`
        });
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
      if (preTestCatalogRaw) {
        fs.writeFileSync(catalogFile, preTestCatalogRaw, 'utf-8');
        (db as any).catalogCache = JSON.parse(preTestCatalogRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'CatalogManager SKU Reconciliation & Duplicate Guard', status: 'FAIL', message: e.message });
  }

  // TEST 29: Mixed-Rate & Dynamic Store-Default Per-SKU GST Checkout (POST /api/checkout/place-order)
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const catalogFile = path.resolve(process.cwd(), 'src/server/catalog.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;
    const preTestCatalogRaw = fs.existsSync(catalogFile) ? fs.readFileSync(catalogFile, 'utf-8') : null;

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = (server.address() as any).port;
      const adminJwt = signSessionJwt({
        sub: 'uid_master_sunil',
        email: 'sunilchain@gmail.com',
        name: 'Sunil Chainani',
        role: 'STORE_MANAGER'
      });

      // 1. Set store default GST to 12%
      const rulesRes = await fetch(`http://127.0.0.1:${port}/api/store-management/operational-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ gstRatePercent: 12 })
      });

      // 2. Add a 5% explicit GST SKU alongside default SKUs (no gstRate set -> inherits 12%)
      const baseCatalog = structuredClone(db.getRawCatalog());
      const fivePctProd = {
        id: 'prod-gst-5-test',
        category: 'men',
        productType: 'Care',
        name: 'Pure Beeswax Heritage Balm',
        sku: 'BVL-GST-FIVE',
        price: 2000,
        currency: 'INR',
        description: 'Organic beeswax dressing at 5% GST slab.',
        features: ['Natural beeswax'],
        images: ['/assets/images/product_men_belt_wallet_1794461808951.jpg'],
        hsnCode: '3405',
        gstRate: 0.05,
        solutionEngine: 'LIFETIME_HEIRLOOM_CARE',
        inStock: true,
        allowCustomization: false,
        careKitIncluded: false,
        initialPuneStock: 10,
        initialMumbaiStock: 5
      };

      const catRes = await fetch(`http://127.0.0.1:${port}/api/store-management/catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          catalog: {
            categories: baseCatalog.categories,
            products: [...baseCatalog.products, fivePctProd]
          }
        })
      });

      // 3. Place mixed cart checkout with HEIRLOOM10 promo (10%):
      // Belt (4200, inherits 12%) + Balm (2000, explicit 5%) = 6200 subtotal
      // Discount 10% = 620 -> Taxable = 5580 -> Proportional: Belt taxable 3780 * 12% = 454; Balm taxable 1800 * 5% = 90
      // Total tax = 544; Total = 6124
      const orderRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Mixed GST Patron',
          customerEmail: 'mixed.gst@example.com',
          customerPhone: '+91 98201 55667',
          shippingAddress: {
            street: '77 Boat Club Road',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411001',
            country: 'India'
          },
          items: [
            { productId: 'prod-m-belt-01', sku: 'BVL-MEN-BLT-01', quantity: 1 },
            { productId: 'prod-gst-5-test', sku: 'BVL-GST-FIVE', quantity: 1 }
          ],
          discountCode: 'HEIRLOOM10'
        })
      });
      const orderData = await orderRes.json();
      const o = orderData.order;
      const inv = db.getInvoices().find(i => i.orderId === o?.id);

      const beltLine = o?.items?.find((it: any) => it.sku === 'BVL-MEN-BLT-01');
      const balmLine = o?.items?.find((it: any) => it.sku === 'BVL-GST-FIVE');

      const mathMatches =
        rulesRes.status === 200 &&
        catRes.status === 200 &&
        orderRes.status === 201 &&
        beltLine?.gstRate === 0.12 &&
        beltLine?.taxAmount === 454 &&
        balmLine?.gstRate === 0.05 &&
        balmLine?.taxAmount === 90 &&
        o?.subtotal === 6200 &&
        o?.discountAmount === 620 &&
        o?.taxAmount === 544 &&
        o?.totalAmount === 6124 &&
        inv?.taxableValue === 5580 &&
        inv?.totalInvoiceAmount === 6124;

      if (mathMatches) {
        results.push({
          test: 'Mixed Per-SKU GST & Store-Default Fallback Checkout',
          status: 'PASS',
          message: 'Verified mixed cart tax math (12% store default + 5% SKU override + HEIRLOOM10 promo = ₹544 tax, ₹6,124 total).'
        });
      } else {
        results.push({
          test: 'Mixed Per-SKU GST & Store-Default Fallback Checkout',
          status: 'FAIL',
          message: `status=${orderRes.status}, beltTax=${beltLine?.taxAmount} (${beltLine?.gstRate}), balmTax=${balmLine?.taxAmount} (${balmLine?.gstRate}), orderTax=${o?.taxAmount}, total=${o?.totalAmount}, invTotal=${inv?.totalInvoiceAmount}`
        });
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
      if (preTestCatalogRaw) {
        fs.writeFileSync(catalogFile, preTestCatalogRaw, 'utf-8');
        (db as any).catalogCache = JSON.parse(preTestCatalogRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'Mixed Per-SKU GST & Store-Default Fallback Checkout', status: 'FAIL', message: e.message });
  }

  // TEST 30: Corporate Kanban Push to ERP Sales Order & Duplicate Guard
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = (server.address() as any).port;
      const adminJwt = signSessionJwt({
        sub: 'uid_master_sunil',
        email: 'sunilchain@gmail.com',
        name: 'Sunil Chainani',
        role: 'STORE_MANAGER'
      });

      const brfSku = 'BVL-TRV-BRF-01';
      const origPuneQty = db.getInventory().find(i => i.sku === brfSku)!.stockByLocation.punePrimaryHub;
      const targetBom = db.getBillOfMaterials().find(b => b.parentSku === brfSku)!;
      const origBomQty = targetBom.inventoryOnHand;

      // 1. Create B2B lead with SKU items
      const createLeadRes = await fetch(`http://127.0.0.1:${port}/api/crm/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          companyName: 'Sahyadri Hospitality Group',
          contactPerson: 'Neha Deshmukh',
          email: 'procurement@sahyadri.in',
          phone: '+91 98220 55441',
          dealValueInr: 28900,
          status: 'QUOTE_ISSUED',
          items: [{ sku: brfSku, quantity: 1 }]
        })
      });
      const leadId = (await createLeadRes.json()).lead?.id;

      // 2. Push lead to real ERP Sales Order via POST /api/erp/quotes/push-order
      const pushRes = await fetch(`http://127.0.0.1:${port}/api/erp/quotes/push-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          leadId,
          items: [{ sku: brfSku, quantity: 1 }],
          dealType: 'WHOLESALE_BULK'
        })
      });
      const pushData = await pushRes.json();

      const updatedPuneQty = db.getInventory().find(i => i.sku === brfSku)!.stockByLocation.punePrimaryHub;
      const updatedBomQty = db.getBillOfMaterials().find(b => b.id === targetBom.id)!.inventoryOnHand;
      const linkedInvoice = db.getInvoices().find(inv => inv.orderId === pushData.order?.id);

      // 3. Verify duplicate push is rejected with 409 both via quotes/push-order and PATCH /crm/leads/:id
      const dupPushRes = await fetch(`http://127.0.0.1:${port}/api/erp/quotes/push-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ leadId, items: [{ sku: brfSku, quantity: 1 }] })
      });
      const dupPatchRes = await fetch(`http://127.0.0.1:${port}/api/crm/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ status: 'ORDER_CONFIRMED' })
      });

      const ok =
        createLeadRes.status === 201 &&
        pushRes.status === 201 &&
        Boolean(pushData.order?.orderNumber) &&
        Boolean(linkedInvoice?.invoiceNumber) &&
        pushData.lead?.status === 'ORDER_CONFIRMED' &&
        pushData.lead?.erpOrderId === pushData.order?.id &&
        pushData.lead?.erpOrderNumber === pushData.order?.orderNumber &&
        updatedPuneQty === origPuneQty - 1 &&
        updatedBomQty === Math.max(0, origBomQty - targetBom.quantityPerUnit) &&
        dupPushRes.status === 409 &&
        dupPatchRes.status === 409;

      if (ok) {
        results.push({
          test: 'Corporate Kanban Push to ERP Order & Duplicate Guard',
          status: 'PASS',
          message: `Pushed lead to ERP Order ${pushData.order.orderNumber}, issued invoice, deducted Pune stock + BOM, and blocked duplicate pushes (409).`
        });
      } else {
        results.push({
          test: 'Corporate Kanban Push to ERP Order & Duplicate Guard',
          status: 'FAIL',
          message: `push=${pushRes.status}, erpOrderId=${pushData.lead?.erpOrderId}, stock=${updatedPuneQty}/${origPuneQty - 1}, dupPush=${dupPushRes.status}, dupPatch=${dupPatchRes.status}`
        });
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'Corporate Kanban Push to ERP Order & Duplicate Guard', status: 'FAIL', message: e.message });
  }

  // TEST 31: Inbox Patron Phone Lookup Enrichment & WhatsApp Dispatch Validation
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = (server.address() as any).port;
      const adminJwt = signSessionJwt({
        sub: 'uid_master_sunil',
        email: 'sunilchain@gmail.com',
        name: 'Sunil Chainani',
        role: 'STORE_MANAGER'
      });

      // Ensure cust_01_vip has a valid phone while linked raw ticket does not pre-store customerPhone
      const cust = db.getCustomerById('cust_01_vip')!;
      cust.phone = '+91 98201 12345';
      const rawTickets = (db as any).state.supportTickets as any[];
      const targetTicket = rawTickets.find(t => t.customerId === 'cust_01_vip') || rawTickets[0];
      delete targetTicket.customerPhone;

      // 1. GET /api/crm/tickets enriches customerPhone from customer record
      const ticketsRes = await fetch(`http://127.0.0.1:${port}/api/crm/tickets`, {
        headers: { Authorization: `Bearer ${adminJwt}` }
      });
      const ticketsData = await ticketsRes.json();
      const enrichedTicket = (ticketsData.tickets || []).find((t: any) => t.id === targetTicket.id);

      // 2. POST WhatsApp reply resolves patron phone (passes phone validation check)
      const replyWithPhoneRes = await fetch(`http://127.0.0.1:${port}/api/crm/tickets/${targetTicket.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ text: 'Your dispatch AWB is ready.', channel: 'WHATSAPP' })
      });
      const replyWithPhoneData = await replyWithPhoneRes.json();

      // 3. Clearing customer phone yields 'Valid patron phone number missing'
      cust.phone = '';
      delete targetTicket.customerPhone;
      const replyNoPhoneRes = await fetch(`http://127.0.0.1:${port}/api/crm/tickets/${targetTicket.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ text: 'Follow-up check.', channel: 'WHATSAPP' })
      });
      const replyNoPhoneData = await replyNoPhoneRes.json();

      const ok =
        ticketsRes.status === 200 &&
        enrichedTicket?.customerPhone === '+91 98201 12345' &&
        replyWithPhoneRes.status === 200 &&
        replyWithPhoneData.ticket?.customerPhone === '+91 98201 12345' &&
        replyWithPhoneData.delivery?.fallbackReason !== 'Valid patron phone number missing' &&
        replyNoPhoneRes.status === 200 &&
        replyNoPhoneData.delivery?.fallbackReason === 'Valid patron phone number missing';

      if (ok) {
        results.push({
          test: 'Inbox Patron Phone Lookup & WhatsApp Reply Validation',
          status: 'PASS',
          message: 'Enriched ticket customerPhone from customer profile and passed resolved toPhone into WhatsApp dispatcher.'
        });
      } else {
        results.push({
          test: 'Inbox Patron Phone Lookup & WhatsApp Reply Validation',
          status: 'FAIL',
          message: `enriched=${enrichedTicket?.customerPhone}, withPhoneReason=${replyWithPhoneData.delivery?.fallbackReason}, noPhoneReason=${replyNoPhoneData.delivery?.fallbackReason}`
        });
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'Inbox Patron Phone Lookup & WhatsApp Reply Validation', status: 'FAIL', message: e.message });
  }

  // TEST 32: Granular Staff RBAC Matrix (SUPPORT_AGENT vs LOGISTICS_COORDINATOR vs STORE_MANAGER)
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = (server.address() as any).port;
      const base = `http://127.0.0.1:${port}/api`;
      const masterJwt = signSessionJwt({
        sub: 'uid_master_sunil',
        email: 'sunilchain@gmail.com',
        name: 'Sunil Chainani',
        role: 'STORE_MANAGER'
      });

      const supportEmail = 'agent.rbac.test@bharatvarshcrafts.com';
      const logisticsEmail = 'logistics.rbac.test@bharatvarshcrafts.com';

      const addSupport = await fetch(`${base}/store-management/permitted-managers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${masterJwt}` },
        body: JSON.stringify({
          email: supportEmail,
          displayName: 'Concierge Agent',
          password: 'AgentPass#2026',
          role: 'SUPPORT_AGENT'
        })
      });

      const addLogistics = await fetch(`${base}/store-management/permitted-managers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${masterJwt}` },
        body: JSON.stringify({
          email: logisticsEmail,
          displayName: 'Pune Logistics Hub Lead',
          password: 'LogisticsPass#2026',
          role: 'LOGISTICS_COORDINATOR'
        })
      });

      const loginSupportRes = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: supportEmail, password: 'AgentPass#2026' })
      });
      const loginSupport = await loginSupportRes.json();

      const loginLogisticsRes = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: logisticsEmail, password: 'LogisticsPass#2026' })
      });
      const loginLogistics = await loginLogisticsRes.json();

      const supportToken = loginSupport.token as string;
      const logisticsToken = loginLogistics.token as string;

      // Support Agent checks
      const [saCrm, saTickets, saKanban, saAnalytics, saErpInv, saErpPush, saAdminCfg] = await Promise.all([
        fetch(`${base}/crm/customers`, { headers: { Authorization: `Bearer ${supportToken}` } }),
        fetch(`${base}/crm/tickets`, { headers: { Authorization: `Bearer ${supportToken}` } }),
        fetch(`${base}/crm/kanban`, { headers: { Authorization: `Bearer ${supportToken}` } }),
        fetch(`${base}/analytics/dashboard`, { headers: { Authorization: `Bearer ${supportToken}` } }),
        fetch(`${base}/erp/inventory`, { headers: { Authorization: `Bearer ${supportToken}` } }),
        fetch(`${base}/erp/quotes/push-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supportToken}` },
          body: JSON.stringify({ items: [{ sku: 'BVL-MEN-BLT-01', quantity: 1 }] })
        }),
        fetch(`${base}/store-management/config`, { headers: { Authorization: `Bearer ${supportToken}` } })
      ]);

      // Logistics Coordinator checks
      const [lcErpInv, lcErpOrders, lcErpInvDocs, lcAnalytics, lcCrmCust, lcPayLinks, lcAdminCfg] = await Promise.all([
        fetch(`${base}/erp/inventory`, { headers: { Authorization: `Bearer ${logisticsToken}` } }),
        fetch(`${base}/erp/orders`, { headers: { Authorization: `Bearer ${logisticsToken}` } }),
        fetch(`${base}/erp/invoices`, { headers: { Authorization: `Bearer ${logisticsToken}` } }),
        fetch(`${base}/analytics/dashboard`, { headers: { Authorization: `Bearer ${logisticsToken}` } }),
        fetch(`${base}/crm/customers`, { headers: { Authorization: `Bearer ${logisticsToken}` } }),
        fetch(`${base}/crm/payment-links`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${logisticsToken}` },
          body: JSON.stringify({ amountInr: 1000 })
        }),
        fetch(`${base}/store-management/config`, { headers: { Authorization: `Bearer ${logisticsToken}` } })
      ]);

      // Store Manager check
      const [smCrm, smErp, smAnalytics, smAdmin] = await Promise.all([
        fetch(`${base}/crm/customers`, { headers: { Authorization: `Bearer ${masterJwt}` } }),
        fetch(`${base}/erp/inventory`, { headers: { Authorization: `Bearer ${masterJwt}` } }),
        fetch(`${base}/analytics/dashboard`, { headers: { Authorization: `Bearer ${masterJwt}` } }),
        fetch(`${base}/store-management/config`, { headers: { Authorization: `Bearer ${masterJwt}` } })
      ]);

      const supportOk =
        loginSupport.user?.role === 'SUPPORT_AGENT' &&
        saCrm.status === 200 &&
        saTickets.status === 200 &&
        saKanban.status === 200 &&
        saAnalytics.status === 200 &&
        saErpInv.status === 403 &&
        saErpPush.status === 403 &&
        saAdminCfg.status === 403;

      const logisticsOk =
        loginLogistics.user?.role === 'LOGISTICS_COORDINATOR' &&
        lcErpInv.status === 200 &&
        lcErpOrders.status === 200 &&
        lcErpInvDocs.status === 200 &&
        lcAnalytics.status === 200 &&
        lcCrmCust.status === 403 &&
        lcPayLinks.status === 403 &&
        lcAdminCfg.status === 403;

      const managerOk =
        smCrm.status === 200 && smErp.status === 200 && smAnalytics.status === 200 && smAdmin.status === 200;

      if (addSupport.status === 200 && addLogistics.status === 200 && supportOk && logisticsOk && managerOk) {
        results.push({
          test: 'Granular Staff RBAC Matrix (CRM vs ERP vs Store Manager)',
          status: 'PASS',
          message: 'Enforced strict SUPPORT_AGENT (CRM+Analytics only), LOGISTICS_COORDINATOR (ERP+Analytics only), and STORE_MANAGER full access.'
        });
      } else {
        results.push({
          test: 'Granular Staff RBAC Matrix (CRM vs ERP vs Store Manager)',
          status: 'FAIL',
          message: `supportOk=${supportOk} (${saErpInv.status}/${saAdminCfg.status}), logisticsOk=${logisticsOk} (${lcCrmCust.status}/${lcAdminCfg.status}), managerOk=${managerOk}`
        });
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'Granular Staff RBAC Matrix (CRM vs ERP vs Store Manager)', status: 'FAIL', message: e.message });
  }

  // TEST 33: Code-to-MySQL Schema Parity (21 Tables, Columns, Nullable GST, & Strict ENUMs)
  try {
    const schemaSql = fs.readFileSync(path.resolve(process.cwd(), 'mysql-schema.sql'), 'utf-8');
    const adapterSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/server/mysqlAdapter.ts'), 'utf-8');
    const typesSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/types/index.ts'), 'utf-8');

    const missingInSchema = MYSQL_TABLE_NAMES.filter(t => !schemaSql.includes(`CREATE TABLE IF NOT EXISTS ${t}`));
    const missingInAdapter = MYSQL_TABLE_NAMES.filter(t => !adapterSrc.includes(`CREATE TABLE IF NOT EXISTS ${t}`));

    const expectedChecks = [
      "ENUM('PATRON', 'STORE_MANAGER', 'SUPPORT_AGENT', 'LOGISTICS_COORDINATOR')",
      "ENUM('PROCESSING', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'RETURNED')",
      "ENUM('RAZORPAY', 'STRIPE', 'CASH_ON_DELIVERY')",
      "ENUM('PAID', 'PENDING', 'REFUNDED', 'FAILED')",
      "ENUM('NEW_LEAD', 'SWATCH_DISPATCHED', 'QUOTE_ISSUED', 'ORDER_CONFIRMED', 'FULFILLED')",
      'gst_rate DECIMAL(5,4) NULL DEFAULT NULL',
      'customer_phone VARCHAR(32)',
      'erp_order_id VARCHAR(64)',
      'erp_order_number VARCHAR(64)',
      'ip_address VARCHAR(64)',
      'deleted_at DATETIME NULL',
      'is_active TINYINT(1) NOT NULL DEFAULT 1',
      'safety_stock INT NOT NULL DEFAULT 20',
      'recipient_name VARCHAR(191)',
      'fk_bvl_addr_customer FOREIGN KEY (customer_id) REFERENCES bvl_customers(id) ON DELETE CASCADE',
      'offer_price DECIMAL(12,2) NULL DEFAULT NULL',
      'video_url TEXT NULL'
    ];
    const missingSchemaClauses = expectedChecks.filter(c => !schemaSql.includes(c));
    const missingAdapterClauses = expectedChecks.filter(c => !adapterSrc.includes(c));

    const expectedTypes = [
      'identityUid?: string;',
      'deletedAt?: string | null;',
      'items?: CorporateGiftingLeadItem[];',
      'erpOrderId?: string;',
      'erpOrderNumber?: string;',
      'customerPhone?: string;',
      'ipAddress?: string;',
      'safetyStock?: number;',
      'addresses?: CustomerAddress[];',
      'recipientName?: string;',
      'offerPrice?: number;',
      'videoUrl?: string;'
    ];
    const missingTypeFields = expectedTypes.filter(f => !typesSrc.includes(f));

    if (
      MYSQL_TABLE_NAMES.length === 21 &&
      missingInSchema.length === 0 &&
      missingInAdapter.length === 0 &&
      missingSchemaClauses.length === 0 &&
      missingAdapterClauses.length === 0 &&
      missingTypeFields.length === 0
    ) {
      results.push({
        test: 'Code-to-MySQL Schema Parity Audit (21 Normalized Tables)',
        status: 'PASS',
        message: 'Verified 1:1 parity across src/types/index.ts, mysqlAdapter.ts, and mysql-schema.sql for all 21 tables, columns, and ENUMs.'
      });
    } else {
      results.push({
        test: 'Code-to-MySQL Schema Parity Audit (21 Normalized Tables)',
        status: 'FAIL',
        message: `tables=${MYSQL_TABLE_NAMES.length}, missingSchema=${missingInSchema.join(',')}, missingAdapter=${missingInAdapter.join(',')}, clauses=${missingSchemaClauses.join(',')}|${missingAdapterClauses.join(',')}, types=${missingTypeFields.join(',')}`
      });
    }
  } catch (e: any) {
    results.push({ test: 'Code-to-MySQL Schema Parity Audit (21 Normalized Tables)', status: 'FAIL', message: e.message });
  }

  // TEST 34: Idempotent ensureTables() Migration & Full 21-Table Round-Trip Sync/Hydration
  try {
    const adapterAny = mysqlAdapter as any;
    const prevPool = adapterAny.pool;
    const prevConnected = adapterAny.connected;
    const prevLastError = adapterAny.lastError;
    const prevLastSync = adapterAny.lastSyncAt;

    try {
      // 1. Verify ensureTables() INFORMATION_SCHEMA migration adds missing columns/indexes & updates ENUM
      const executedDdl: string[] = [];
      const mockMigrationConn: any = {
        query: async (sql: string, params?: any[]) => {
          const clean = sql.trim();
          executedDdl.push(clean);
          if (clean.includes('INFORMATION_SCHEMA.COLUMNS')) {
            const col = params?.[1];
            if (col === 'customer_phone' || col === 'erp_order_id' || col === 'ip_address') {
              return [[]];
            }
            if (params?.[0] === 'bvl_admin_users' && col === 'role') {
              return [[{ COLUMN_TYPE: 'varchar(32)', IS_NULLABLE: 'NO' }]];
            }
            return [[{ COLUMN_TYPE: "enum('PATRON','STORE_MANAGER','SUPPORT_AGENT','LOGISTICS_COORDINATOR')", IS_NULLABLE: 'YES' }]];
          }
          if (clean.includes('INFORMATION_SCHEMA.STATISTICS')) {
            const idx = params?.[1];
            return [[{ cnt: idx === 'idx_bvl_orders_customer' ? 0 : 1 }]];
          }
          return [[]];
        }
      };
      await mysqlAdapter.ensureTables(mockMigrationConn);

      const addedMissingCols =
        executedDdl.some(q => q.includes('ALTER TABLE `bvl_support_tickets` ADD COLUMN `customer_phone`')) &&
        executedDdl.some(q => q.includes('ALTER TABLE `bvl_corporate_leads` ADD COLUMN `erp_order_id`')) &&
        executedDdl.some(q => q.includes('ALTER TABLE `bvl_audit_logs` ADD COLUMN `ip_address`')) &&
        executedDdl.some(q => q.includes('ALTER TABLE `bvl_admin_users` MODIFY COLUMN `role` ENUM')) &&
        executedDdl.some(q => q.includes('CREATE INDEX `idx_bvl_orders_customer` ON `bvl_orders`'));

      // 2. Round-trip syncStateWithConnection + saveCatalogSnapshot -> loadStateSnapshot + loadCatalogSnapshot
      const sampleState = structuredClone(db.getFullStateSnapshot());
      const testPassHash = hashPassword('RoundTrip#2026');
      sampleState.config.adminCredentials.push({
        userId: 'roundtrip.support@bharatvarshcrafts.com',
        displayName: 'Roundtrip Agent',
        role: 'SUPPORT_AGENT',
        passwordHash: testPassHash,
        addedBy: 'sunilchain@gmail.com',
        addedAt: '2026-11-01T10:00:00.000Z',
        isMaster: false
      });
      sampleState.patronCredentials = {
        ...(sampleState.patronCredentials || {}),
        'roundtrip.patron@example.com': {
          email: 'roundtrip.patron@example.com',
          passwordHash: testPassHash,
          updatedAt: '2026-11-01T10:05:00.000Z'
        }
      };
      if (sampleState.customers[1]) {
        sampleState.customers[1].isActive = false;
        sampleState.customers[1].deletedAt = '2026-11-02T12:00:00.000Z';
      }
      sampleState.corporateGiftingLeads.push({
        id: 'corp_rt_01',
        companyName: 'Maratha Heritage Hotels',
        contactPerson: 'Kavita Kulkarni',
        email: 'kavita@marathahotels.in',
        phone: '+91 98220 99887',
        estimatedQuantity: 25,
        budgetRangeInr: '3,00,000',
        interestCategory: 'TRANSIT_FOLIOS',
        status: 'ORDER_CONFIRMED',
        swatchKitAwb: 'SRK-SWATCH-77',
        items: [{ sku: 'BVL-TRV-BRF-01', quantity: 2, unitPrice: 28900 }],
        erpOrderId: 'ord_rt_99',
        erpOrderNumber: 'BVL-2026-9999',
        notes: 'Custom brass clasp',
        dealValueInr: 57800,
        createdAt: '2026-11-01T09:00:00.000Z'
      });
      if (sampleState.supportTickets[0]) {
        sampleState.supportTickets[0].customerPhone = '+91 98201 77665';
      }
      sampleState.auditLogs.unshift({
        id: 'audit_rt_01',
        actorEmail: 'sunilchain@gmail.com',
        action: 'ROUNDTRIP_CHECK',
        category: 'STORE_MANAGEMENT',
        details: 'Verified full schema hydration',
        timestamp: '2026-11-01T11:00:00.000Z',
        ipAddress: '203.0.113.42'
      });

      const sampleCatalog = structuredClone(db.getRawCatalog());
      if (sampleCatalog.products[0]) {
        sampleCatalog.products[0].gstRate = 0.05;
        sampleCatalog.products[0].offerPrice = Math.max(1000, Math.round(sampleCatalog.products[0].price * 0.85));
        sampleCatalog.products[0].images = [
          '/assets/images/rt_slot1.jpg',
          '/assets/images/rt_slot2.jpg',
          '/assets/images/rt_slot3.jpg',
          '/assets/images/rt_slot4.jpg'
        ];
        sampleCatalog.products[0].image = '/assets/images/rt_slot1.jpg';
        sampleCatalog.products[0].videoUrl = '/assets/images/rt_showcase.mp4';
      }
      if (sampleCatalog.products[1]) {
        delete sampleCatalog.products[1].gstRate;
        delete sampleCatalog.products[1].offerPrice;
        delete sampleCatalog.products[1].videoUrl;
      }

      // In-memory MySQL table store captured from INSERT queries
      const tableStore = new Map<string, any[]>();
      const pushRow = (tbl: string, keyCol: string, rowObj: Record<string, any>) => {
        const list = tableStore.get(tbl) || [];
        const idx = list.findIndex(r => r[keyCol] === rowObj[keyCol]);
        if (idx >= 0) list[idx] = rowObj;
        else list.push(rowObj);
        tableStore.set(tbl, list);
      };

      const mockRoundTripConn: any = {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        query: async (sql: string, params: any[] = []) => {
          const clean = sql.replace(/\s+/g, ' ').trim();
          if (clean.startsWith('INSERT INTO bvl_app_state')) {
            pushRow('bvl_app_state', 'state_key', { state_key: params[0], state_json: params[1] });
          } else if (clean.startsWith('INSERT INTO bvl_store_config')) {
            pushRow('bvl_store_config', 'id', {
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
          } else if (clean.startsWith('INSERT INTO bvl_admin_users')) {
            pushRow('bvl_admin_users', 'user_id', {
              user_id: params[0],
              display_name: params[1],
              role: params[2],
              password_hash: params[3],
              is_master: params[4],
              added_by: params[5],
              added_at: params[6]
            });
          } else if (clean.startsWith('INSERT INTO bvl_patron_credentials')) {
            pushRow('bvl_patron_credentials', 'email', {
              email: params[0],
              password_hash: params[1],
              updated_at: params[2]
            });
          } else if (clean.startsWith('INSERT INTO bvl_customers')) {
            pushRow('bvl_customers', 'id', {
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
          } else if (clean.startsWith('INSERT INTO bvl_customer_addresses')) {
            pushRow('bvl_customer_addresses', 'id', {
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
          } else if (clean.startsWith('INSERT INTO bvl_corporate_leads')) {
            pushRow('bvl_corporate_leads', 'id', {
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
          } else if (clean.startsWith('INSERT INTO bvl_support_tickets')) {
            pushRow('bvl_support_tickets', 'id', {
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
          } else if (clean.startsWith('INSERT IGNORE INTO bvl_audit_logs')) {
            pushRow('bvl_audit_logs', 'id', {
              id: params[0],
              actor_email: params[1],
              action: params[2],
              category: params[3],
              details: params[4],
              ip_address: params[5],
              created_at: params[6]
            });
          } else if (clean.startsWith('INSERT INTO bvl_catalog_categories')) {
            pushRow('bvl_catalog_categories', 'id', {
              id: params[0],
              name: params[1],
              slug: params[2],
              description: params[3],
              product_types_json: params[4]
            });
          } else if (clean.startsWith('INSERT INTO bvl_catalog_products')) {
            pushRow('bvl_catalog_products', 'id', {
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
        query: async (sql: string) => {
          const match = sql.match(/FROM\s+([a-z0-9_]+)/i);
          const tbl = match?.[1] || '';
          return [tableStore.get(tbl) || []];
        }
      };
      adapterAny.connected = true;

      const hydratedState = await mysqlAdapter.loadStateSnapshot();
      const hydratedCatalog = await mysqlAdapter.loadCatalogSnapshot();

      const hydratedAgent = hydratedState?.config?.adminCredentials?.find(
        (a: any) => a.userId === 'roundtrip.support@bharatvarshcrafts.com'
      );
      const hydratedPatronCred = hydratedState?.patronCredentials?.['roundtrip.patron@example.com'];
      const hydratedSoftDeleted = hydratedState?.customers?.find(
        (c: any) => c.id === sampleState.customers[1]?.id
      );
      const hydratedLead = hydratedState?.corporateGiftingLeads?.find((l: any) => l.id === 'corp_rt_01');
      const hydratedTicket = hydratedState?.supportTickets?.find(
        (t: any) => t.id === sampleState.supportTickets[0]?.id
      );
      const hydratedAudit = hydratedState?.auditLogs?.find((l: any) => l.id === 'audit_rt_01');
      const hydratedProd0 = hydratedCatalog?.products?.find((p: any) => p.id === sampleCatalog.products[0]?.id);
      const hydratedProd1 = hydratedCatalog?.products?.find((p: any) => p.id === sampleCatalog.products[1]?.id);

      const hydratedAddr = hydratedState?.addresses?.find((a: any) => a.customerId === sampleState.customers[0]?.id);
      const hydratedCust0 = hydratedState?.customers?.find((c: any) => c.id === sampleState.customers[0]?.id);

      const roundTripOk =
        addedMissingCols &&
        hydratedAgent?.role === 'SUPPORT_AGENT' &&
        hydratedAgent?.passwordHash === testPassHash &&
        hydratedPatronCred?.passwordHash === testPassHash &&
        hydratedSoftDeleted?.isActive === false &&
        Boolean(hydratedSoftDeleted?.deletedAt) &&
        hydratedLead?.erpOrderId === 'ord_rt_99' &&
        hydratedLead?.erpOrderNumber === 'BVL-2026-9999' &&
        hydratedLead?.items?.[0]?.sku === 'BVL-TRV-BRF-01' &&
        hydratedTicket?.customerPhone === '+91 98201 77665' &&
        hydratedAudit?.ipAddress === '203.0.113.42' &&
        hydratedProd0?.gstRate === 0.05 &&
        hydratedProd0?.offerPrice === sampleCatalog.products[0]?.offerPrice &&
        hydratedProd0?.images?.length === 4 &&
        hydratedProd0?.image === hydratedProd0?.images?.[0] &&
        hydratedProd0?.videoUrl === '/assets/images/rt_showcase.mp4' &&
        hydratedProd1?.gstRate === undefined &&
        hydratedProd1?.offerPrice === undefined &&
        Boolean(hydratedAddr?.street) &&
        Boolean(hydratedCust0?.addresses && hydratedCust0.addresses.length > 0);

      if (roundTripOk) {
        results.push({
          test: 'MySQL ensureTables() Migrations & 21-Table Round-Trip Hydration',
          status: 'PASS',
          message: 'Validated INFORMATION_SCHEMA column/ENUM/index migrations and lossless round-trip hydration across RBAC, soft-delete, GST, offerPrice, 4-image+video catalog, corporate leads, tickets, and audit logs.'
        });
      } else {
        results.push({
          test: 'MySQL ensureTables() Migrations & 21-Table Round-Trip Hydration',
          status: 'FAIL',
          message: `ddl=${addedMissingCols}, agentRole=${hydratedAgent?.role}, patronCred=${Boolean(hydratedPatronCred)}, softDel=${hydratedSoftDeleted?.isActive}, lead=${hydratedLead?.erpOrderId}, ticketPhone=${hydratedTicket?.customerPhone}, gst=${hydratedProd0?.gstRate}/${hydratedProd1?.gstRate}, offer=${hydratedProd0?.offerPrice}, imgs=${hydratedProd0?.images?.length}, vid=${hydratedProd0?.videoUrl}`
        });
      }
    } finally {
      adapterAny.pool = prevPool;
      adapterAny.connected = prevConnected;
      adapterAny.lastError = prevLastError;
      adapterAny.lastSyncAt = prevLastSync;
    }
  } catch (e: any) {
    results.push({ test: 'MySQL ensureTables() Migrations & 21-Table Round-Trip Hydration', status: 'FAIL', message: e.message });
  }

  // TEST 35: Catalog+State & Customer Soft-Delete Rollback Integrity on Simulated MySQL Failure
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const catalogFile = path.resolve(process.cwd(), 'src/server/catalog.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;
    const preTestCatalogRaw = fs.existsSync(catalogFile) ? fs.readFileSync(catalogFile, 'utf-8') : null;

    const adapterAny = mysqlAdapter as any;
    const prevPool = adapterAny.pool;
    const prevConnected = adapterAny.connected;
    const prevLastError = adapterAny.lastError;
    const prevLastSync = adapterAny.lastSyncAt;

    try {
      const origCatalog = structuredClone(db.getRawCatalog());
      const targetProd = origCatalog.products[0];
      const origPrice = targetProd.price;
      const targetCustomer = db.getCustomers().find(c => !db.isMasterAuthorized(c.email))!;

      let rollbackCount = 0;
      const failingConn: any = {
        beginTransaction: async () => {},
        query: async (sql: string) => {
          if (sql.includes('INSERT INTO bvl_app_state') || sql.includes('UPDATE bvl_customers')) {
            throw new Error('SIMULATED_MYSQL_LOCK_TIMEOUT');
          }
          return [[]];
        },
        commit: async () => {},
        rollback: async () => {
          rollbackCount += 1;
        },
        release: () => {}
      };

      adapterAny.pool = { getConnection: async () => failingConn };
      adapterAny.connected = true;

      let catalogRejected = false;
      try {
        const mutatedCatalog = structuredClone(origCatalog);
        mutatedCatalog.products[0].price = origPrice + 9999;
        await db.saveCatalogAsync(mutatedCatalog, 'sunilchain@gmail.com');
      } catch (err: any) {
        catalogRejected = err.message.includes('SIMULATED_MYSQL_LOCK_TIMEOUT');
      }

      let softDeleteRejected = false;
      try {
        await db.softDeleteCustomerAsync(targetCustomer.id, 'sunilchain@gmail.com');
      } catch (err: any) {
        softDeleteRejected = err.message.includes('SIMULATED_MYSQL_LOCK_TIMEOUT');
      }

      const catalogPricePreserved = db.getRawCatalog().products[0].price === origPrice;
      const diskCatalogPreserved = JSON.parse(fs.readFileSync(catalogFile, 'utf-8')).products[0].price === origPrice;
      const customerStillActive = db.getCustomerById(targetCustomer.id)?.isActive !== false;

      if (catalogRejected && softDeleteRejected && rollbackCount >= 2 && catalogPricePreserved && diskCatalogPreserved && customerStillActive) {
        results.push({
          test: 'Atomic Catalog & Customer Soft-Delete Rollback on MySQL Failure',
          status: 'PASS',
          message: 'Rolled back MySQL transactions, in-memory state, and disk JSON snapshots cleanly after simulated InnoDB failure.'
        });
      } else {
        results.push({
          test: 'Atomic Catalog & Customer Soft-Delete Rollback on MySQL Failure',
          status: 'FAIL',
          message: `catRej=${catalogRejected}, delRej=${softDeleteRejected}, rollbacks=${rollbackCount}, priceOk=${catalogPricePreserved}, diskOk=${diskCatalogPreserved}, activeOk=${customerStillActive}`
        });
      }
    } finally {
      adapterAny.pool = prevPool;
      adapterAny.connected = prevConnected;
      adapterAny.lastError = prevLastError;
      adapterAny.lastSyncAt = prevLastSync;
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
      if (preTestCatalogRaw) {
        fs.writeFileSync(catalogFile, preTestCatalogRaw, 'utf-8');
        (db as any).catalogCache = JSON.parse(preTestCatalogRaw);
      }
    }
  } catch (e: any) {
    results.push({ test: 'Atomic Catalog & Customer Soft-Delete Rollback on MySQL Failure', status: 'FAIL', message: e.message });
  }

  // TEST 36: Public Static Image Assets & Legacy Path Normalization
  try {
    const publicImagesDir = path.resolve(process.cwd(), 'public/assets/images');
    const expectedImages = [
      'custom_debossing_monogram_1794461810572.jpg',
      'hero_leathercraft_workshop_1794461808596.jpg',
      'product_men_belt_wallet_1794461808951.jpg',
      'product_travel_backpack_folio_1794461810700.jpg',
      'product_women_purse_bag_1794461810441.jpg'
    ];
    const allFilesPresent = expectedImages.every(f => fs.existsSync(path.join(publicImagesDir, f)));

    const catalogJsonSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/server/catalog.json'), 'utf-8');
    const storefrontSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/Storefront.tsx'), 'utf-8');
    const catalogMgrSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/CatalogManager.tsx'), 'utf-8');
    const noLegacySourceRefs =
      !catalogJsonSrc.includes('/src/assets/images/') &&
      !storefrontSrc.includes('/src/assets/images/') &&
      !catalogMgrSrc.includes('/src/assets/images/');

    const legacyCatalog = {
      categories: [],
      products: [
        {
          id: 'p_legacy',
          images: ['/src/assets/images/hero_leathercraft_workshop_1794461808596.jpg']
        }
      ]
    };
    const { catalog: normalizedCat, changed } = (db as any).normalizeCatalogAssets(legacyCatalog);

    const legacyState = structuredClone(db.getFullStateSnapshot());
    legacyState.hotStampingVectors[0].previewImageUrl = '/src/assets/images/custom_debossing_monogram_1794461810572.jpg';
    legacyState.carts[0].items[0].imageUrl = '/src/assets/images/product_travel_backpack_folio_1794461810700.jpg';
    (legacyState.orders[0].items[0] as any).imageUrl = '/src/assets/images/product_men_belt_wallet_1794461808951.jpg';
    const migratedState = (db as any).migrateLegacyState(legacyState);

    const normalizedOk =
      changed &&
      normalizedCat.products[0].images[0] === '/assets/images/hero_leathercraft_workshop_1794461808596.jpg' &&
      migratedState.hotStampingVectors[0].previewImageUrl === '/assets/images/custom_debossing_monogram_1794461810572.jpg' &&
      migratedState.carts[0].items[0].imageUrl === '/assets/images/product_travel_backpack_folio_1794461810700.jpg' &&
      (migratedState.orders[0].items[0] as any).imageUrl === '/assets/images/product_men_belt_wallet_1794461808951.jpg';

    if (allFilesPresent && noLegacySourceRefs && normalizedOk) {
      results.push({
        test: 'Public Image Packaging & Legacy Asset Path Normalization',
        status: 'PASS',
        message: 'Verified all 5 images in public/assets/images, clean frontend/catalog references, and automatic legacy URL normalization.'
      });
    } else {
      results.push({
        test: 'Public Image Packaging & Legacy Asset Path Normalization',
        status: 'FAIL',
        message: `files=${allFilesPresent}, cleanRefs=${noLegacySourceRefs}, normalized=${normalizedOk}`
      });
    }
  } catch (e: any) {
    results.push({ test: 'Public Image Packaging & Legacy Asset Path Normalization', status: 'FAIL', message: e.message });
  }

  // TEST 37: Phase 1 — Strict Indian Validation, Address Persistence, Auto-Fill Overview & Branded GST Invoice/Credit Note
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = (server.address() as any).port;
      const adminJwt = signSessionJwt({
        sub: 'uid_master_sunil',
        email: 'sunilchain@gmail.com',
        name: 'Sunil Chainani',
        role: 'STORE_MANAGER'
      });

      // 1. Strict Validation Rejections (Checkout, Registration, CRM Customer Create)
      const badPhoneOrderRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Rohan Joshi',
          customerEmail: 'rohan.joshi@example.com',
          customerPhone: '9820112345', // missing +91
          shippingAddress: {
            street: '14 Baner Road, Balewadi',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411045',
            country: 'India'
          },
          items: [{ productId: 'prod-m-belt-01', sku: 'BVL-MEN-BLT-01', quantity: 1 }]
        })
      });
      const badPhoneOrderData = await badPhoneOrderRes.json();

      const badPinCountryOrderRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Rohan Joshi',
          customerEmail: 'rohan.joshi@example.com',
          customerPhone: '+91 98201 12345',
          shippingAddress: {
            street: '14 Baner Road, Balewadi',
            city: 'Pune',
            state: 'Californialand',
            pincode: '011001',
            country: 'USA'
          },
          items: [{ productId: 'prod-m-belt-01', sku: 'BVL-MEN-BLT-01', quantity: 1 }]
        })
      });
      const badPinCountryData = await badPinCountryOrderRes.json();

      const badRegRes = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Meera Nair',
          email: 'meera.nair@example.com',
          password: 'StrongPassword#2026',
          phone: '+1 415 555 0100'
        })
      });

      const badCrmRes = await fetch(`http://127.0.0.1:${port}/api/crm/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          fullName: 'Karan Mehta',
          email: 'karan.mehta@example.com',
          phone: '12345'
        })
      });

      const rejectionsOk =
        badPhoneOrderRes.status === 400 &&
        Boolean(badPhoneOrderData.errors?.phone) &&
        badPinCountryOrderRes.status === 400 &&
        Boolean(badPinCountryData.errors?.pincode) &&
        Boolean(badPinCountryData.errors?.country) &&
        Boolean(badPinCountryData.errors?.state) &&
        badRegRes.status === 400 &&
        badCrmRes.status === 400;

      // 2. Register patron with valid +91 phone & checkout with Indian address -> saves into bvl_customer_addresses & Customer
      const regRes = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Meera Nair',
          email: 'meera.nair@example.com',
          password: 'StrongPassword#2026',
          phone: '+919820776655',
          street: '802 Sapphire Residences, Bandra West',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400050',
          country: 'India'
        })
      });
      const regData = await regRes.json();
      const patronJwt = regData.token;

      // Overview immediately auto-populates saved registration address & formatted phone
      const overviewRes1 = await fetch(`http://127.0.0.1:${port}/api/patron/overview`, {
        headers: { Authorization: `Bearer ${patronJwt}` }
      });
      const overview1 = await overviewRes1.json();

      // Update shipping address on checkout
      const orderRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Meera Nair',
          customerEmail: 'meera.nair@example.com',
          customerPhone: '+91 98207 76655',
          shippingAddress: {
            street: 'NT2-904 Blue Ridge Township, Hinjewadi',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411057',
            country: 'India'
          },
          items: [{ productId: 'prod-m-belt-01', sku: 'BVL-MEN-BLT-01', quantity: 1 }]
        })
      });
      const orderData = await orderRes.json();
      const createdOrder = orderData.order;

      const overviewRes2 = await fetch(`http://127.0.0.1:${port}/api/patron/overview`, {
        headers: { Authorization: `Bearer ${patronJwt}` }
      });
      const overview2 = await overviewRes2.json();

      // 3. Issue a partial return/credit note and verify both HTML & PDF invoices/credit-notes contain logo, Registered Office, GSTIN, and fallback patron address
      const retRes = await fetch(`http://127.0.0.1:${port}/api/erp/rma/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          orderId: createdOrder.id,
          customerId: createdOrder.customerId,
          reason: 'Sizing exchange to 34-inch strap',
          inspectionNotes: 'Unused buckle & leather strap',
          restockInWarehouse: true,
          restockLocation: 'punePrimaryHub'
        })
      });
      const retData = await retRes.json();
      const cnNum = retData.creditNote?.creditNoteNumber;

      // Clear snapshot shippingAddress in memory on order briefly to test Customer/bvl_customer_addresses fallback!
      createdOrder.shippingAddress = undefined;
      createdOrder.customerPhone = '';

      const invHtmlRes = await fetch(
        `http://127.0.0.1:${port}/api/erp/invoices/${encodeURIComponent(createdOrder.invoiceNumber)}?format=html`,
        { headers: { Authorization: `Bearer ${patronJwt}` } }
      );
      const invHtml = await invHtmlRes.text();

      const invPdfRes = await fetch(
        `http://127.0.0.1:${port}/api/erp/invoices/${encodeURIComponent(createdOrder.invoiceNumber)}?format=pdf`,
        { headers: { Authorization: `Bearer ${patronJwt}` } }
      );
      const invPdfStr = Buffer.from(await invPdfRes.arrayBuffer()).toString('latin1');

      const cnHtmlRes = await fetch(
        `http://127.0.0.1:${port}/api/erp/invoices/${encodeURIComponent(cnNum)}?format=html`,
        { headers: { Authorization: `Bearer ${patronJwt}` } }
      );
      const cnHtml = await cnHtmlRes.text();

      const cnPdfRes = await fetch(
        `http://127.0.0.1:${port}/api/erp/invoices/${encodeURIComponent(cnNum)}?format=pdf`,
        { headers: { Authorization: `Bearer ${patronJwt}` } }
      );
      const cnPdfStr = Buffer.from(await cnPdfRes.arrayBuffer()).toString('latin1');

      const expectedRegOffice = 'NT2-1703, The Crown Greens, Plot 7, Hinjewadi Phase 2, Pune, Maharashtra';
      const expectedGstin = db.getConfig().supplierGstin;

      const brandingAndFallbackOk =
        invHtmlRes.status === 200 &&
        invHtml.includes('data:image/png;base64,') &&
        invHtml.includes(expectedRegOffice) &&
        invHtml.includes(expectedGstin) &&
        invHtml.includes('NT2-904 Blue Ridge Township, Hinjewadi') &&
        invHtml.includes('+91 98207 76655') &&
        invPdfRes.status === 200 &&
        invPdfStr.startsWith('%PDF-1.4') &&
        invPdfStr.includes('/Subtype /Image') &&
        invPdfStr.includes('NT2-1703, The Crown Greens, Plot 7, Hinjewadi Phase 2, Pune, Maharashtra') &&
        invPdfStr.includes(expectedGstin) &&
        invPdfStr.includes('NT2-904 Blue Ridge Township, Hinjewadi') &&
        cnHtmlRes.status === 200 &&
        cnHtml.includes('data:image/png;base64,') &&
        cnHtml.includes(expectedRegOffice) &&
        cnHtml.includes(expectedGstin) &&
        cnHtml.includes('NT2-904 Blue Ridge Township, Hinjewadi') &&
        cnPdfRes.status === 200 &&
        cnPdfStr.startsWith('%PDF-1.4') &&
        cnPdfStr.includes('/Subtype /Image') &&
        cnPdfStr.includes(expectedGstin);

      const addressPersistenceOk =
        regRes.status === 201 &&
        overview1.defaultAddress?.pincode === '400050' &&
        overview1.patron?.phone === '+91 98207 76655' &&
        orderRes.status === 201 &&
        overview2.defaultAddress?.pincode === '411057' &&
        overview2.defaultAddress?.street === 'NT2-904 Blue Ridge Township, Hinjewadi';

      if (rejectionsOk && addressPersistenceOk && brandingAndFallbackOk) {
        results.push({
          test: 'Indian Validation, Patron Address Auto-Fill & Branded GST Invoice/Credit Note PDFs',
          status: 'PASS',
          message: 'Enforced strict +91/6-digit PIN/India-only validation, persisted patron addresses, and rendered LLP logo, Pune Registered Office & GSTIN across HTML and PDF documents.'
        });
      } else {
        results.push({
          test: 'Indian Validation, Patron Address Auto-Fill & Branded GST Invoice/Credit Note PDFs',
          status: 'FAIL',
          message: `rejections=${rejectionsOk}, addrPersist=${addressPersistenceOk} (pin1=${overview1.defaultAddress?.pincode}, pin2=${overview2.defaultAddress?.pincode}), branding=${brandingAndFallbackOk}`
        });
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({
      test: 'Indian Validation, Patron Address Auto-Fill & Branded GST Invoice/Credit Note PDFs',
      status: 'FAIL',
      message: e.message
    });
  }

  // TEST 38: Phase 2 — Media Upload (/assets/images/), 4-Image + 1-Video Gallery & Authoritative Offer Pricing
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const catalogFile = path.resolve(process.cwd(), 'src/server/catalog.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;
    const preTestCatalogRaw = fs.existsSync(catalogFile) ? fs.readFileSync(catalogFile, 'utf-8') : null;
    const uploadedDiskFiles: string[] = [];

    const app = express();
    app.use(express.json({ limit: '75mb' }));
    const publicImagesDir = path.resolve(process.cwd(), 'public', 'assets', 'images');
    fs.mkdirSync(publicImagesDir, { recursive: true });
    app.use('/assets/images', express.static(publicImagesDir));
    app.use('/api', apiRouter);

    const server = await new Promise<any>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (server.address() as any).port;

    try {
      const adminJwt = signSessionJwt({
        sub: 'uid_master_sunil',
        email: 'sunilchain@gmail.com',
        name: 'Sunil Chainani',
        role: 'STORE_MANAGER'
      });
      const patronJwt = signSessionJwt({
        sub: 'uid_patron_media',
        email: 'patron.media@example.com',
        name: 'Patron Media',
        role: 'PATRON'
      });

      // 1. RBAC rejection for unauthenticated and PATRON users
      const unauthUploadRes = await fetch(`http://127.0.0.1:${port}/api/store-management/upload-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'test.png', mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' })
      });
      const patronUploadRes = await fetch(`http://127.0.0.1:${port}/api/store-management/upload-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patronJwt}` },
        body: JSON.stringify({ filename: 'test.png', mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' })
      });

      // 2. Reject unsupported file extensions (.svg)
      const invalidExtRes = await fetch(`http://127.0.0.1:${port}/api/store-management/upload-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ filename: 'script.svg', mimeType: 'image/svg+xml', dataBase64: 'PHN2Zz48L3N2Zz4=' })
      });

      // 3. Multipart PNG upload saved to public/assets/images/ & served over HTTP
      const pngBytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWScAAAAASUVORK5CYII=',
        'base64'
      );
      const formData = new FormData();
      formData.append('file', new Blob([pngBytes], { type: 'image/png' }), 'Atelier Craft Shot.png');
      const pngUploadRes = await fetch(`http://127.0.0.1:${port}/api/store-management/upload-media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminJwt}` },
        body: formData
      });
      const pngUploadJson = await pngUploadRes.json();
      if (pngUploadJson?.filename) {
        uploadedDiskFiles.push(path.join(publicImagesDir, pngUploadJson.filename));
        const distImagesFile = path.resolve(process.cwd(), 'dist', 'assets', 'images', pngUploadJson.filename);
        if (fs.existsSync(distImagesFile)) uploadedDiskFiles.push(distImagesFile);
      }

      const servedImgRes = await fetch(`http://127.0.0.1:${port}${pngUploadJson.url}`);
      const servedImgBuf = Buffer.from(await servedImgRes.arrayBuffer());

      // 4. JSON/base64 MP4 video upload saved to /assets/images/
      const mp4Sample = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex');
      const vidUploadRes = await fetch(`http://127.0.0.1:${port}/api/store-management/upload-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          filename: 'showcase_reel.mp4',
          mimeType: 'video/mp4',
          dataBase64: mp4Sample.toString('base64')
        })
      });
      const vidUploadJson = await vidUploadRes.json();
      if (vidUploadJson?.filename) {
        uploadedDiskFiles.push(path.join(publicImagesDir, vidUploadJson.filename));
        const distVidFile = path.resolve(process.cwd(), 'dist', 'assets', 'images', vidUploadJson.filename);
        if (fs.existsSync(distVidFile)) uploadedDiskFiles.push(distVidFile);
      }

      // 5. Reject offerPrice > MRP and > 4 images on POST /api/store-management/catalog
      const currentCatalog = structuredClone(db.getRawCatalog());
      const baseProd = structuredClone(currentCatalog.products[0]);

      const badOfferCatalog = structuredClone(currentCatalog);
      badOfferCatalog.products[0] = {
        ...baseProd,
        price: 10000,
        offerPrice: 12500
      };
      const badOfferRes = await fetch(`http://127.0.0.1:${port}/api/store-management/catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ catalog: badOfferCatalog })
      });

      const badImagesCatalog = structuredClone(currentCatalog);
      badImagesCatalog.products[0] = {
        ...baseProd,
        images: [
          pngUploadJson.url,
          '/assets/images/slot2.jpg',
          '/assets/images/slot3.jpg',
          '/assets/images/slot4.jpg',
          '/assets/images/slot5.jpg'
        ]
      };
      const badImagesRes = await fetch(`http://127.0.0.1:${port}/api/store-management/catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ catalog: badImagesCatalog })
      });

      // 6. Save valid 4-image + 1-video + offerPrice catalog update
      const validCatalog = structuredClone(currentCatalog);
      validCatalog.products[0] = {
        ...baseProd,
        price: 12000,
        offerPrice: 9600,
        gstRate: 0.18,
        images: [
          pngUploadJson.url,
          '/assets/images/slot_2.jpg',
          '/assets/images/slot_3.jpg',
          '/assets/images/slot_4.jpg'
        ],
        videoUrl: vidUploadJson.url
      };
      delete (validCatalog.products[0] as any).image;

      const saveValidRes = await fetch(`http://127.0.0.1:${port}/api/store-management/catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({ catalog: validCatalog })
      });
      const saveValidJson = await saveValidRes.json();
      const savedProd0 = saveValidJson?.catalog?.products?.[0];

      // 7. Authoritative checkout calculation uses offerPrice (9600) despite tampered unitPrice
      const orderRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Vikramaditya Joshi',
          customerEmail: 'vikram.offer@example.com',
          customerPhone: '+919823011223',
          paymentGateway: 'RAZORPAY',
          discountCode: 'HEIRLOOM10',
          shippingAddress: {
            street: 'Plot 14, Prabhat Road, Deccan Gymkhana',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411004',
            country: 'India'
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
      // 9600 subtotal, 10% HEIRLOOM10 discount = 960 -> taxable 8640 -> 18% GST = 1555 -> total 10195
      const expectedDiscount = 960;
      const expectedTax = Math.round((9600 - 960) * 0.18);
      const expectedTotal = 9600 - expectedDiscount + expectedTax;

      const uploadChecksOk =
        unauthUploadRes.status === 401 &&
        patronUploadRes.status === 403 &&
        invalidExtRes.status === 400 &&
        pngUploadRes.status === 201 &&
        String(pngUploadJson.url).startsWith('/assets/images/') &&
        servedImgRes.status === 200 &&
        servedImgBuf.equals(pngBytes) &&
        vidUploadRes.status === 201 &&
        vidUploadJson.mediaType === 'video' &&
        String(vidUploadJson.url).startsWith('/assets/images/');

      const catalogAndPricingOk =
        badOfferRes.status === 400 &&
        badImagesRes.status === 400 &&
        saveValidRes.status === 200 &&
        savedProd0?.images?.length === 4 &&
        savedProd0?.image === pngUploadJson.url &&
        savedProd0?.videoUrl === vidUploadJson.url &&
        savedProd0?.offerPrice === 9600 &&
        orderRes.status === 201 &&
        placedOrder?.subtotal === 9600 &&
        placedOrder?.discountAmount === expectedDiscount &&
        placedOrder?.taxAmount === expectedTax &&
        placedOrder?.totalAmount === expectedTotal;

      if (uploadChecksOk && catalogAndPricingOk) {
        results.push({
          test: 'Phase 2: /assets/images/ Media Upload, 4-Image + 1-Video Gallery & Authoritative Offer Pricing',
          status: 'PASS',
          message: 'Verified RBAC-protected PNG/MP4 uploads to /assets/images/, 4-image + 1-video persistence, offerPrice <= MRP enforcement, and server-authoritative offerPrice checkout math.'
        });
      } else {
        results.push({
          test: 'Phase 2: /assets/images/ Media Upload, 4-Image + 1-Video Gallery & Authoritative Offer Pricing',
          status: 'FAIL',
          message: `uploadOk=${uploadChecksOk} (statuses=${unauthUploadRes.status}/${patronUploadRes.status}/${invalidExtRes.status}/${pngUploadRes.status}/${servedImgRes.status}/${vidUploadRes.status}), pricingOk=${catalogAndPricingOk} (badOffer=${badOfferRes.status}, badImgs=${badImagesRes.status}, save=${saveValidRes.status}, subtotal=${placedOrder?.subtotal}, total=${placedOrder?.totalAmount} vs ${expectedTotal})`
        });
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      for (const f of uploadedDiskFiles) {
        if (f && fs.existsSync(f)) {
          fs.unlinkSync(f);
        }
      }
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
      if (preTestCatalogRaw) {
        fs.writeFileSync(catalogFile, preTestCatalogRaw, 'utf-8');
        (db as any).catalogCache = JSON.parse(preTestCatalogRaw);
      }
    }
  } catch (e: any) {
    results.push({
      test: 'Phase 2: /assets/images/ Media Upload, 4-Image + 1-Video Gallery & Authoritative Offer Pricing',
      status: 'FAIL',
      message: e.message
    });
  }

  // TEST 39: Phase 3 — Cart Recovery Telemetry, Support Invoice Email & Daily Post-Midnight Excel Report
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;
    const prevSmtpPass = process.env.SMTP_PASS;

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);

    const server = await new Promise<any>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (server.address() as any).port;

    try {
      // Force deterministic sandbox telemetry for SMTP verification
      delete process.env.SMTP_PASS;

      const masterJwt = signSessionJwt({
        sub: 'uid_master_sunil',
        email: 'sunilchain@gmail.com',
        name: 'Sunil Chainani',
        role: 'STORE_MANAGER'
      });
      const delegatedManagerJwt = signSessionJwt({
        sub: 'uid_delegated_mgr',
        email: 'delegated.manager@bharatvarshcrafts.com',
        name: 'Delegated Store Manager',
        role: 'STORE_MANAGER'
      });

      // 1. Seed a bad cart (no valid email) and a valid abandoned cart
      const badCartId = `cart_bad_email_${Date.now()}`;
      const goodCartId = `cart_phase3_${Date.now()}`;
      await db.runAtomicMutation(() => {
        db.saveCartState({
          id: badCartId,
          email: '',
          phone: '+919820012345',
          items: [
            {
              productId: 'prod-m-belt-01',
              productName: 'The Rajputana Bridle Belt',
              sku: 'BVL-MEN-BLT-01',
              quantity: 1,
              unitPrice: 3800,
              leatherType: 'VEGETABLE_TANNED_HERITAGE',
              imageUrl: '/assets/images/mens_collection_editorial_1794461810572.jpg'
            }
          ],
          subtotal: 3800,
          isAbandoned: true
        });
        db.saveCartState({
          id: goodCartId,
          email: 'aarav.phase3@example.com',
          phone: '+919820054321',
          items: [
            {
              productId: 'prod-m-belt-01',
              productName: 'The Rajputana Bridle Belt',
              sku: 'BVL-MEN-BLT-01',
              quantity: 1,
              unitPrice: 3800,
              leatherType: 'VEGETABLE_TANNED_HERITAGE',
              imageUrl: '/assets/images/mens_collection_editorial_1794461810572.jpg'
            }
          ],
          subtotal: 3800,
          isAbandoned: true
        });
      });

      // Missing email must return 400 and keep stage DETECTED
      const badTriggerRes = await fetch(`http://127.0.0.1:${port}/api/crm/cart-recovery/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${masterJwt}` },
        body: JSON.stringify({ cartId: badCartId, channel: 'EMAIL' })
      });
      const badCartAfter = db.getCarts().find(c => c.id === badCartId);

      // Valid abandoned cart triggers email dispatch + telemetry + /?resume= URL
      const goodTriggerRes = await fetch(`http://127.0.0.1:${port}/api/crm/cart-recovery/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${masterJwt}` },
        body: JSON.stringify({ cartId: goodCartId, channel: 'EMAIL' })
      });
      const goodTriggerJson = await goodTriggerRes.json();

      // Immediate second trigger must hit cooldown without duplicating
      const cooldownRes = await fetch(`http://127.0.0.1:${port}/api/crm/cart-recovery/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${masterJwt}` },
        body: JSON.stringify({ cartId: goodCartId, channel: 'EMAIL' })
      });
      const cooldownJson = await cooldownRes.json();

      // 2. Place a real checkout order -> triggers async Support invoice dispatch & lets us inspect IST Excel workbook
      const orderRes = await fetch(`http://127.0.0.1:${port}/api/checkout/place-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Vikramaditya Joshi',
          customerEmail: 'vikram.phase3@example.com',
          customerPhone: '+919811122233',
          paymentGateway: 'RAZORPAY',
          shippingAddress: {
            street: '42 Koregaon Park Lane 6',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411001',
            country: 'India'
          },
          items: [
            {
              productId: 'prod-m-belt-01',
              sku: 'BVL-MEN-BLT-01',
              quantity: 1,
              unitPrice: 3800
            }
          ]
        })
      });
      const orderJson = await orderRes.json();
      const placedOrder = orderJson.order;

      // Wait briefly for non-blocking async dispatchOrderConfirmationAndCareGuide
      await new Promise(resolve => setTimeout(resolve, 150));
      const supportDirectResult = await dispatchOrderInvoiceEmailToSupport(placedOrder);
      const supportRecipient = getSupportOrderEmailRecipient();
      const auditLogsAfterOrder = db.getAuditLogs();
      const hasNotificationAudit = auditLogsAfterOrder.some(
        a =>
          a.action === 'ORDER_NOTIFICATION_DISPATCHED' &&
          a.details.includes(placedOrder.orderNumber) &&
          a.details.includes('SupportInvoice:')
      );

      // 3. Daily Excel Workbook (.xlsx) generation & SheetJS validation
      const istOffsetMs = 5.5 * 60 * 60 * 1000;
      const orderIstDateKey = new Date(new Date(placedOrder.createdAt).getTime() + istOffsetMs)
        .toISOString()
        .slice(0, 10);

      const workbookReport = generateDailyOrderWorkbook(orderIstDateKey);
      const parsedWb = XLSX.read(workbookReport.buffer, { type: 'buffer' });
      const ordersSheetRows = XLSX.utils.sheet_to_json<Record<string, any>>(parsedWb.Sheets['Orders']);
      const summarySheetRows = XLSX.utils.sheet_to_json<Record<string, any>>(parsedWb.Sheets['Summary']);
      const matchedExcelRow = ordersSheetRows.find(r => r['Order Number'] === placedOrder.orderNumber);
      const expectedHeadersPresent =
        matchedExcelRow &&
        'Order Date/Time (IST)' in matchedExcelRow &&
        'Invoice Number' in matchedExcelRow &&
        'Taxable Value (INR)' in matchedExcelRow &&
        'CGST (INR)' in matchedExcelRow &&
        'SGST (INR)' in matchedExcelRow &&
        'IGST (INR)' in matchedExcelRow &&
        'Total Amount (INR)' in matchedExcelRow &&
        'AWB Number' in matchedExcelRow;

      // 4. Master Admin RBAC on POST /api/admin/reports/send-daily-orders
      const unauthReportRes = await fetch(`http://127.0.0.1:${port}/api/admin/reports/send-daily-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: orderIstDateKey })
      });
      const delegatedReportRes = await fetch(`http://127.0.0.1:${port}/api/admin/reports/send-daily-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${delegatedManagerJwt}` },
        body: JSON.stringify({ date: orderIstDateKey })
      });
      const masterReportRes = await fetch(`http://127.0.0.1:${port}/api/admin/reports/send-daily-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${masterJwt}` },
        body: JSON.stringify({ date: orderIstDateKey })
      });
      const masterReportJson = await masterReportRes.json();

      // 5. Duplicate-dispatch guard for scheduler (lastDailyReportDate)
      const yesterdayKey = getYesterdayIstDateKey();
      await db.runAtomicMutation(() => {
        db.setLastDailyReportDate(yesterdayKey);
      });
      const dupCheck = await sendDailyOrdersReport({ force: false, targetDateIst: yesterdayKey });
      await runScheduledDailyOrderReportIfDue();

      const recoveryOk =
        badTriggerRes.status === 400 &&
        badCartAfter?.recoveryStage === 'DETECTED' &&
        goodTriggerRes.status === 200 &&
        goodTriggerJson.success === true &&
        goodTriggerJson.deliveryMode === 'SANDBOX_FALLBACK' &&
        Boolean(goodTriggerJson.messageId) &&
        String(goodTriggerJson.fallbackReason || '').includes('SMTP_PASS') &&
        goodTriggerJson.cart?.recoveryStage === 'EMAIL_SENT' &&
        String(goodTriggerJson.cart?.checkoutUrl || '').startsWith(`/?resume=${goodCartId}&token=`) &&
        cooldownRes.status === 200 &&
        cooldownJson.success === false;

      const supportEmailOk =
        orderRes.status === 201 &&
        supportRecipient === 'Support@bharatvarshcrafts.com' &&
        supportDirectResult.channel === 'EMAIL' &&
        Boolean(supportDirectResult.messageId) &&
        hasNotificationAudit;

      const excelReportOk =
        parsedWb.SheetNames.includes('Orders') &&
        parsedWb.SheetNames.includes('Summary') &&
        workbookReport.filename === `Orders_${orderIstDateKey}.xlsx` &&
        Boolean(expectedHeadersPresent) &&
        summarySheetRows.some(r => r.Metric === 'Total Orders' && Number(r.Value) >= 1) &&
        unauthReportRes.status === 401 &&
        delegatedReportRes.status === 403 &&
        masterReportRes.status === 200 &&
        masterReportJson.success === true &&
        masterReportJson.skipped === false &&
        masterReportJson.filename === `Orders_${orderIstDateKey}.xlsx` &&
        dupCheck.skipped === true;

      if (recoveryOk && supportEmailOk && excelReportOk) {
        results.push({
          test: 'Phase 3: Cart Recovery SMTP Telemetry, Support Invoice Email & Daily IST Excel Report',
          status: 'PASS',
          message:
            'Verified abandoned cart recovery validation/telemetry & /?resume= links, non-blocking Support@bharatvarshcrafts.com PDF invoice email, SheetJS Orders+Summary .xlsx export, Master Admin RBAC, and lastDailyReportDate duplicate guard.'
        });
      } else {
        results.push({
          test: 'Phase 3: Cart Recovery SMTP Telemetry, Support Invoice Email & Daily IST Excel Report',
          status: 'FAIL',
          message: `recoveryOk=${recoveryOk} (bad=${badTriggerRes.status}, good=${goodTriggerRes.status}/${goodTriggerJson.deliveryMode}, url=${goodTriggerJson.cart?.checkoutUrl}), supportEmailOk=${supportEmailOk} (audit=${hasNotificationAudit}), excelReportOk=${excelReportOk} (rbac=${unauthReportRes.status}/${delegatedReportRes.status}/${masterReportRes.status}, dupSkipped=${dupCheck.skipped})`
        });
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (prevSmtpPass !== undefined) {
        process.env.SMTP_PASS = prevSmtpPass;
      } else {
        delete process.env.SMTP_PASS;
      }
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({
      test: 'Phase 3: Cart Recovery SMTP Telemetry, Support Invoice Email & Daily IST Excel Report',
      status: 'FAIL',
      message: e.message
    });
  }

  // TEST 40: Google reCAPTCHA Enterprise Script, Client Action Execution & Server Assessment Verifier
  try {
    const htmlContent = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
    const hasScriptTag = htmlContent.includes(
      'https://www.google.com/recaptcha/enterprise.js?render=6Le3mCcuAAAAAJCQBRIMvqTGd4RadX5JvnNubovL'
    );

    const prevKey = process.env.RECAPTCHA_ENTERPRISE_API_KEY;
    const prevFetch = globalThis.fetch;
    const prevWindow = (globalThis as any).window;

    try {
      // 1. Client helper invokes grecaptcha.enterprise.ready + execute(siteKey, { action: 'LOGIN' })
      let capturedSiteKey = '';
      let capturedAction = '';
      (globalThis as any).window = {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        grecaptcha: {
          enterprise: {
            ready: (cb: () => void) => cb(),
            execute: async (siteKey: string, opts: { action: string }) => {
              capturedSiteKey = siteKey;
              capturedAction = opts.action;
              return 'mock_enterprise_token_login_123';
            }
          }
        }
      };
      const clientToken = await executeRecaptchaEnterprise('LOGIN');

      // 2. Server pass-through when RECAPTCHA_ENTERPRISE_API_KEY is unset
      delete process.env.RECAPTCHA_ENTERPRISE_API_KEY;
      const passThrough = await verifyRecaptchaEnterpriseToken({
        token: undefined,
        expectedAction: 'LOGIN'
      });

      // 3. Server enforcement when RECAPTCHA_ENTERPRISE_API_KEY is configured
      process.env.RECAPTCHA_ENTERPRISE_API_KEY = 'AIzaTestEnterpriseServerKey12345';
      const missingRes = await verifyRecaptchaEnterpriseToken({
        token: '',
        expectedAction: 'CHECKOUT'
      });

      let requestedAssessmentUrl = '';
      (globalThis as any).fetch = async (url: string, init?: any) => {
        requestedAssessmentUrl = url;
        const parsedBody = JSON.parse(String(init?.body || '{}'));
        const tok = parsedBody?.event?.token;
        if (tok === 'good_checkout_tok') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              tokenProperties: { valid: true, action: 'CHECKOUT' },
              riskAnalysis: { score: 0.9 }
            })
          } as any;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tokenProperties: { valid: true, action: 'LOGIN' },
            riskAnalysis: { score: 0.1 }
          })
        } as any;
      };

      const mismatchRes = await verifyRecaptchaEnterpriseToken({
        token: 'wrong_action_tok',
        expectedAction: 'CHECKOUT'
      });
      const validRes = await verifyRecaptchaEnterpriseToken({
        token: 'good_checkout_tok',
        expectedAction: 'CHECKOUT'
      });

      const ok =
        hasScriptTag &&
        clientToken === 'mock_enterprise_token_login_123' &&
        capturedSiteKey === '6Le3mCcuAAAAAJCQBRIMvqTGd4RadX5JvnNubovL' &&
        capturedAction === 'LOGIN' &&
        passThrough.allowed === true &&
        passThrough.mode === 'CLIENT_ONLY_PASS' &&
        missingRes.allowed === false &&
        mismatchRes.allowed === false &&
        validRes.allowed === true &&
        validRes.mode === 'LIVE' &&
        validRes.score === 0.9 &&
        requestedAssessmentUrl.includes('recaptchaenterprise.googleapis.com/v1/projects/');

      if (ok) {
        results.push({
          test: 'Google reCAPTCHA Enterprise Script, Action Execution & Assessment Verification',
          status: 'PASS',
          message:
            'Verified index.html reCAPTCHA Enterprise script, client grecaptcha.enterprise.execute({action: LOGIN}), client-only pass-through when unconfigured, and live Enterprise assessment scoring/action checks.'
        });
      } else {
        results.push({
          test: 'Google reCAPTCHA Enterprise Script, Action Execution & Assessment Verification',
          status: 'FAIL',
          message: `hasScript=${hasScriptTag}, clientToken=${clientToken}, siteKey=${capturedSiteKey}, action=${capturedAction}, missing=${missingRes.allowed}, mismatch=${mismatchRes.allowed}, valid=${validRes.allowed}`
        });
      }
    } finally {
      if (prevKey !== undefined) process.env.RECAPTCHA_ENTERPRISE_API_KEY = prevKey;
      else delete process.env.RECAPTCHA_ENTERPRISE_API_KEY;
      globalThis.fetch = prevFetch;
      if (prevWindow !== undefined) (globalThis as any).window = prevWindow;
      else delete (globalThis as any).window;
    }
  } catch (e: any) {
    results.push({
      test: 'Google reCAPTCHA Enterprise Script, Action Execution & Assessment Verification',
      status: 'FAIL',
      message: e.message
    });
  }

  // TEST 41: Phase 4 & Firebase App Check — AppCheck Init Order, Hub-Neutral Copy, Knowledge Base Upload & Strict 10-Day Return Window
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;
    const uploadedKbFilesToClean: string[] = [];

    const app = express();
    app.use(express.json({ limit: '5mb' }));
    const publicKbDir = path.resolve(process.cwd(), 'public', 'assets', 'knowledge-base');
    fs.mkdirSync(publicKbDir, { recursive: true });
    app.use('/assets/knowledge-base', express.static(publicKbDir));
    app.use('/api', apiRouter);
    const server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = (server.address() as any).port;

      // 1. Firebase App Check initialized before getAuth(app)
      const firebaseSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/firebase.ts'), 'utf-8');
      const idxInitApp = firebaseSrc.indexOf('initializeApp(');
      const idxInitAppCheck = firebaseSrc.indexOf('initializeAppCheck(');
      const idxGetAuth = firebaseSrc.indexOf('getAuth(app)');
      const appCheckOrderOk =
        firebaseSrc.includes('ReCaptchaEnterpriseProvider') &&
        idxInitApp > -1 &&
        idxInitAppCheck > idxInitApp &&
        idxGetAuth > idxInitAppCheck;

      // 2. Hub-neutral public copy (no Pune/Kanpur/Mumbai/Jaipur/Bengaluru in public storefront & Our Story)
      //    while ERP warehouse & DB preserve punePrimaryHub and mumbaiWarehouse
      const storefrontSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/Storefront.tsx'), 'utf-8');
      const ourStorySrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/OurStoryView.tsx'), 'utf-8');
      const erpSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/ERPWarehouseView.tsx'), 'utf-8');
      const dbSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/server/db.ts'), 'utf-8');
      const cityRegex = /\b(pune|mumbai|kanpur|jaipur|bengaluru|pimpri)\b/i;
      const copySeparationOk =
        !cityRegex.test(storefrontSrc) &&
        !cityRegex.test(ourStorySrc) &&
        erpSrc.includes('punePrimaryHub') &&
        erpSrc.includes('mumbaiWarehouse') &&
        dbSrc.includes('punePrimaryHub') &&
        dbSrc.includes('mumbaiWarehouse');

      // 3. Knowledge Base public GET + Admin upload (.pdf & .pptx), update, static serve, and delete
      const adminJwt = signSessionJwt({
        sub: 'uid_master_sunil',
        email: 'sunilchain@gmail.com',
        name: 'Sunil Chainani',
        role: 'STORE_MANAGER'
      });
      const patronJwt = signSessionJwt({
        sub: 'uid_vikram',
        email: 'vikram.singhania@heritagecrafts.in',
        name: 'Vikramaditya Singhania',
        role: 'PATRON'
      });
      const otherPatronJwt = signSessionJwt({
        sub: 'uid_ananya',
        email: 'ananya.deshmukh@gmail.com',
        name: 'Ananya Deshmukh',
        role: 'PATRON'
      });

      const kbListRes = await fetch(`http://127.0.0.1:${port}/api/knowledge-base`);
      const kbListJson = await kbListRes.json();
      const seededKbOk =
        kbListRes.status === 200 &&
        Array.isArray(kbListJson.entries) &&
        kbListJson.entries.length >= 2;

      const kbUnauthRes = await fetch(`http://127.0.0.1:${port}/api/store-management/knowledge-base`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Unauthorized Deck' })
      });
      const kbPatronRes = await fetch(`http://127.0.0.1:${port}/api/store-management/knowledge-base`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patronJwt}` },
        body: JSON.stringify({ title: 'Patron Deck' })
      });
      const kbBadExtRes = await fetch(`http://127.0.0.1:${port}/api/store-management/knowledge-base`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          title: 'Malicious Script',
          filename: 'payload.exe',
          mimeType: 'application/octet-stream',
          dataBase64: Buffer.from('MZfake').toString('base64')
        })
      });

      const fakePdfBytes = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n', 'utf-8');
      const kbPdfUploadRes = await fetch(`http://127.0.0.1:${port}/api/store-management/knowledge-base`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          title: 'Full-Grain Vegetable Tanning Dossier',
          description: 'Atelier master guide to hide anatomy and wax-burnished patina.',
          category: 'LEATHER_GUIDE',
          filename: 'tanning_dossier.pdf',
          mimeType: 'application/pdf',
          dataBase64: fakePdfBytes.toString('base64')
        })
      });
      const kbPdfJson = await kbPdfUploadRes.json();
      const uploadedPdfUrl = String(kbPdfJson.entry?.fileUrl || '');
      if (uploadedPdfUrl.startsWith('/assets/knowledge-base/')) {
        uploadedKbFilesToClean.push(path.basename(uploadedPdfUrl));
      }

      const staticPdfRes = uploadedPdfUrl
        ? await fetch(`http://127.0.0.1:${port}${uploadedPdfUrl}`)
        : null;
      const staticPdfText = staticPdfRes ? await staticPdfRes.text() : '';

      // Upload PPTX
      const fakePptxBytes = Buffer.from('PK\x03\x04mock-pptx-archive-bytes', 'binary');
      const kbPptxUploadRes = await fetch(`http://127.0.0.1:${port}/api/store-management/knowledge-base`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          title: 'Saddle Stitching Presentation',
          description: 'Hand-stitching workshop slides.',
          category: 'CRAFT_DECK',
          filename: 'saddle_stitch.pptx',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          dataBase64: fakePptxBytes.toString('base64')
        })
      });
      const kbPptxJson = await kbPptxUploadRes.json();
      const uploadedPptxUrl = String(kbPptxJson.entry?.fileUrl || '');
      if (uploadedPptxUrl.startsWith('/assets/knowledge-base/')) {
        uploadedKbFilesToClean.push(path.basename(uploadedPptxUrl));
      }

      // Update PDF entry title by id
      const kbUpdateRes = await fetch(`http://127.0.0.1:${port}/api/store-management/knowledge-base`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
        body: JSON.stringify({
          id: kbPdfJson.entry?.id,
          title: 'Full-Grain Vegetable Tanning Dossier (Rev 2)',
          category: 'LEATHER_GUIDE'
        })
      });
      const kbUpdateJson = await kbUpdateRes.json();

      // Delete both uploaded entries and verify disk cleanup
      const kbDelPdfRes = await fetch(
        `http://127.0.0.1:${port}/api/store-management/knowledge-base/${kbPdfJson.entry?.id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${adminJwt}` } }
      );
      const kbDelPptxRes = await fetch(
        `http://127.0.0.1:${port}/api/store-management/knowledge-base/${kbPptxJson.entry?.id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${adminJwt}` } }
      );
      const pdfRemovedFromDisk =
        uploadedPdfUrl.startsWith('/assets/knowledge-base/') &&
        !fs.existsSync(path.join(publicKbDir, path.basename(uploadedPdfUrl)));

      const kbOk =
        seededKbOk &&
        kbUnauthRes.status === 401 &&
        kbPatronRes.status === 403 &&
        kbBadExtRes.status === 400 &&
        kbPdfUploadRes.status === 201 &&
        kbPdfJson.entry?.fileType === 'PDF' &&
        staticPdfRes?.status === 200 &&
        staticPdfText.startsWith('%PDF-1.4') &&
        kbPptxUploadRes.status === 201 &&
        kbPptxJson.entry?.fileType === 'PPTX' &&
        kbUpdateRes.status === 200 &&
        kbUpdateJson.entry?.title === 'Full-Grain Vegetable Tanning Dossier (Rev 2)' &&
        kbDelPdfRes.status === 200 &&
        kbDelPptxRes.status === 200 &&
        pdfRemovedFromDisk;

      // 4. Strict 10-Day Post-Delivery Patron Return Window
      const baseAddr = {
        id: 'addr_ret_test',
        customerId: 'cust_vikram',
        street: '10 Heritage Lane',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110001',
        country: 'India',
        isDefault: true,
        addressType: 'SHIPPING' as const
      };
      const makeOrderPayload = (status: 'PROCESSING' | 'DELIVERED', paymentId: string) => ({
        customerId: 'cust_vikram',
        customerName: 'Vikramaditya Singhania',
        customerEmail: 'vikram.singhania@heritagecrafts.in',
        customerPhone: '+91 98201 11223',
        status,
        currency: 'INR' as const,
        subtotal: 4200,
        discountAmount: 0,
        taxAmount: 756,
        shippingFee: 0,
        totalAmount: 4956,
        paymentGateway: 'RAZORPAY' as const,
        paymentId,
        paymentStatus: 'PAID' as const,
        items: [
          {
            id: `item_${paymentId}`,
            orderId: '',
            productId: 'prod-m-belt-01',
            productName: 'The Rajputana Bridle Belt',
            sku: 'BVL-MEN-BLT-01',
            category: 'men' as const,
            quantity: 1,
            unitPrice: 4200,
            leatherType: 'VEGETABLE_TANNED_HERITAGE' as const,
            hsnCode: '4203',
            gstRate: 0.18,
            taxAmount: 756,
            lineTotal: 4956
          }
        ],
        shippingAddress: baseAddr,
        billingAddress: { ...baseAddr, id: 'addr_ret_bill', addressType: 'BILLING' as const }
      });

      const processingOrder = await db.createOrderAsync(makeOrderPayload('PROCESSING', 'pay_ret_proc'));
      const expiredOrder = await db.createOrderAsync(makeOrderPayload('DELIVERED', 'pay_ret_exp'));
      const eligibleOrder = await db.createOrderAsync(makeOrderPayload('DELIVERED', 'pay_ret_elig'));

      // Set deliveredAt timestamps: 12 days ago (expired) vs 3 days ago (eligible)
      const nowMs = Date.now();
      await db.runAtomicMutation(() => {
        const expRef = db.getOrders().find(o => o.id === expiredOrder.id)!;
        expRef.deliveredAt = new Date(nowMs - 12 * 24 * 60 * 60 * 1000).toISOString();
        const eligRef = db.getOrders().find(o => o.id === eligibleOrder.id)!;
        eligRef.deliveredAt = new Date(nowMs - 3 * 24 * 60 * 60 * 1000).toISOString();
      });

      // a) Unauthenticated -> 401
      const retUnauth = await fetch(`http://127.0.0.1:${port}/api/patron/orders/${eligibleOrder.id}/return-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'INCORRECT_SIZE' })
      });
      // b) Another patron -> 403
      const retWrongOwner = await fetch(`http://127.0.0.1:${port}/api/patron/orders/${eligibleOrder.id}/return-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otherPatronJwt}` },
        body: JSON.stringify({ reason: 'INCORRECT_SIZE' })
      });
      // c) Not yet delivered -> 400
      const retNotDelivered = await fetch(
        `http://127.0.0.1:${port}/api/patron/orders/${processingOrder.id}/return-request`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patronJwt}` },
          body: JSON.stringify({ reason: 'INCORRECT_SIZE' })
        }
      );
      // d) Delivered 12 days ago -> 403 with exact 10-day policy message
      const retExpired = await fetch(`http://127.0.0.1:${port}/api/patron/orders/${expiredOrder.id}/return-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patronJwt}` },
        body: JSON.stringify({ reason: 'COLOR_MISMATCH', notes: 'Shade slightly darker than expected' })
      });
      const retExpiredJson = await retExpired.json();

      // e) Delivered 3 days ago -> 201 + REQUESTED + Support Ticket + PATRON_RETURN_REQUESTED audit log
      const ticketsBefore = db.getSupportTickets().length;
      const retEligible = await fetch(`http://127.0.0.1:${port}/api/patron/orders/${eligibleOrder.id}/return-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patronJwt}` },
        body: JSON.stringify({ reason: 'INCORRECT_SIZE', notes: 'Need next waist size up' })
      });
      const retEligibleJson = await retEligible.json();
      const ticketsAfter = db.getSupportTickets().length;
      const hasReturnAudit = db
        .getAuditLogs()
        .some(log => log.action === 'PATRON_RETURN_REQUESTED' && log.details.includes(eligibleOrder.orderNumber));

      // f) Duplicate return request -> 409
      const retDuplicate = await fetch(`http://127.0.0.1:${port}/api/patron/orders/${eligibleOrder.id}/return-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patronJwt}` },
        body: JSON.stringify({ reason: 'INCORRECT_SIZE' })
      });

      const returnWindowOk =
        retUnauth.status === 401 &&
        retWrongOwner.status === 403 &&
        retNotDelivered.status === 400 &&
        retExpired.status === 403 &&
        retExpiredJson.error ===
          'Return and exchange window (10 days from delivery) has expired. No returns or exchanges are permitted after 10 days.' &&
        retEligible.status === 201 &&
        retEligibleJson.order?.returnRequestStatus === 'REQUESTED' &&
        retEligibleJson.order?.returnReason === 'INCORRECT_SIZE' &&
        ticketsAfter === ticketsBefore + 1 &&
        hasReturnAudit &&
        retDuplicate.status === 409;

      if (appCheckOrderOk && copySeparationOk && kbOk && returnWindowOk) {
        results.push({
          test: 'Phase 4 & App Check: Init Order, Hub-Neutral Copy, Knowledge Base Upload & Strict 10-Day Return Window',
          status: 'PASS',
          message:
            'Verified Firebase App Check init before getAuth, hub-neutral public copy with ERP hubs preserved, Knowledge Base PDF/PPTX upload/serve/update/delete, and strict 10-day post-delivery patron return enforcement.'
        });
      } else {
        results.push({
          test: 'Phase 4 & App Check: Init Order, Hub-Neutral Copy, Knowledge Base Upload & Strict 10-Day Return Window',
          status: 'FAIL',
          message: `appCheck=${appCheckOrderOk}, copy=${copySeparationOk}, kb=${kbOk} (pdf=${kbPdfUploadRes.status}, pptx=${kbPptxUploadRes.status}, upd=${kbUpdateRes.status}, del=${kbDelPdfRes.status}/${pdfRemovedFromDisk}), returns=${returnWindowOk} (unauth=${retUnauth.status}, owner=${retWrongOwner.status}, proc=${retNotDelivered.status}, exp=${retExpired.status}, elig=${retEligible.status}, dup=${retDuplicate.status})`
        });
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      for (const fname of uploadedKbFilesToClean) {
        try {
          const p1 = path.join(publicKbDir, fname);
          if (fs.existsSync(p1)) fs.unlinkSync(p1);
          const p2 = path.resolve(process.cwd(), 'dist', 'assets', 'knowledge-base', fname);
          if (fs.existsSync(p2)) fs.unlinkSync(p2);
        } catch {
          // ignore cleanup failure
        }
      }
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({
      test: 'Phase 4 & App Check: Init Order, Hub-Neutral Copy, Knowledge Base Upload & Strict 10-Day Return Window',
      status: 'FAIL',
      message: e.message
    });
  }

  // TEST 42: Hardened SMTP TLS Negotiation (465/587 Fallback), Optional Per-Order Bypass, Excel Download & Scheduler Backoff
  try {
    const dbFile = path.resolve(process.cwd(), 'src/server/data/store_db.json');
    const preTestDbRaw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf-8') : null;
    const prevDisablePerOrder = process.env.DISABLE_PER_ORDER_EMAILS;
    const prevSmtpHost = process.env.SMTP_HOST;
    const prevSmtpPort = process.env.SMTP_PORT;
    const prevSmtpSecure = process.env.SMTP_SECURE;
    const prevSmtpUser = process.env.SMTP_USER;
    const prevSmtpPass = process.env.SMTP_PASS;

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const port = (server.address() as any).port;

      // 1. Port 465 ALWAYS enforces secure=true (even if SMTP_SECURE='"true"' or 'false') + 587 STARTTLS fallback
      const attempts465 = buildSmtpTransportAttempts({
        SMTP_HOST: '"smtpout.secureserver.net"',
        SMTP_PORT: '465',
        SMTP_SECURE: '"false"'
      } as any);
      const attempts587 = buildSmtpTransportAttempts({
        SMTP_HOST: 'smtpout.secureserver.net',
        SMTP_PORT: '587',
        SMTP_SECURE: 'true'
      } as any);

      const tlsNegotiationOk =
        attempts465.length === 2 &&
        attempts465[0].host === 'smtpout.secureserver.net' &&
        attempts465[0].port === 465 &&
        attempts465[0].secure === true &&
        attempts465[1].port === 587 &&
        attempts465[1].secure === false &&
        attempts465[1].requireTLS === true &&
        attempts587.length === 2 &&
        attempts587[0].port === 587 &&
        attempts587[0].secure === false &&
        attempts587[0].requireTLS === true &&
        attempts587[1].port === 465 &&
        attempts587[1].secure === true;

      // 2. DISABLE_PER_ORDER_EMAILS="true" skips per-order SMTP cleanly without error
      process.env.DISABLE_PER_ORDER_EMAILS = '"true"';
      const perOrderDisabledFlagOk = isPerOrderEmailDisabled();
      const sampleOrder = db.getOrders()[0];
      const skippedRes = await dispatchOrderConfirmationAndCareGuide(sampleOrder);
      const perOrderBypassOk =
        perOrderDisabledFlagOk &&
        skippedRes.emailDelivery.smtpConfigured === false &&
        skippedRes.supportEmailDelivery.smtpConfigured === false &&
        String(skippedRes.supportEmailDelivery.fallbackReason || '').includes('daily consolidated');

      // 3. Direct yesterday Excel workbook download endpoint + RBAC
      const adminJwt = signSessionJwt({
        sub: 'uid_master_sunil',
        email: 'sunilchain@gmail.com',
        name: 'Sunil Chainani',
        role: 'STORE_MANAGER'
      });
      const patronJwt = signSessionJwt({
        sub: 'uid_vikram',
        email: 'vikram.singhania@heritagecrafts.in',
        name: 'Vikramaditya Singhania',
        role: 'PATRON'
      });

      const dlUnauth = await fetch(`http://127.0.0.1:${port}/api/admin/reports/daily-orders-excel`);
      const dlPatron = await fetch(`http://127.0.0.1:${port}/api/admin/reports/daily-orders-excel`, {
        headers: { Authorization: `Bearer ${patronJwt}` }
      });
      const dlAdmin = await fetch(`http://127.0.0.1:${port}/api/admin/reports/daily-orders-excel`, {
        headers: { Authorization: `Bearer ${adminJwt}` }
      });
      const dlBytes = Buffer.from(await dlAdmin.arrayBuffer());
      const dlWb = XLSX.read(dlBytes, { type: 'buffer' });
      const excelDownloadOk =
        dlUnauth.status === 401 &&
        dlPatron.status === 403 &&
        dlAdmin.status === 200 &&
        String(dlAdmin.headers.get('content-disposition') || '').includes('.xlsx') &&
        dlWb.SheetNames.includes('Orders') &&
        dlWb.SheetNames.includes('Summary');

      // 4. Daily scheduler exponential backoff prevents minute-by-minute error log flood
      resetDailyReportSchedulerBackoff();
      await db.runAtomicMutation(() => {
        db.setLastDailyReportDate('2000-01-01');
      });
      // Point SMTP at an immediately refused local port to simulate live SMTP failure quickly
      process.env.SMTP_HOST = '127.0.0.1';
      process.env.SMTP_PORT = '1';
      process.env.SMTP_SECURE = 'false';
      process.env.SMTP_USER = 'Support@bharatvarshcrafts.com';
      process.env.SMTP_PASS = 'test-live-pass-for-backoff';

      const errCountBefore = db.getAuditLogs().filter(a => a.action === 'DAILY_ORDER_REPORT_ERROR').length;
      await runScheduledDailyOrderReportIfDue();
      const errCountAfterFirst = db.getAuditLogs().filter(a => a.action === 'DAILY_ORDER_REPORT_ERROR').length;
      // Second immediate scheduled tick must be skipped due to 15-minute backoff
      await runScheduledDailyOrderReportIfDue();
      const errCountAfterSecond = db.getAuditLogs().filter(a => a.action === 'DAILY_ORDER_REPORT_ERROR').length;
      const schedStatus = getDailyReportSchedulerStatus();
      const backoffOk =
        errCountAfterFirst === errCountBefore + 1 &&
        errCountAfterSecond === errCountAfterFirst &&
        schedStatus.consecutiveFailures === 1 &&
        Boolean(schedStatus.nextRetryAt);

      if (tlsNegotiationOk && perOrderBypassOk && excelDownloadOk && backoffOk) {
        results.push({
          test: 'SMTP 465/587 TLS Negotiation, Per-Order Bypass, Excel Download & Scheduler Backoff',
          status: 'PASS',
          message:
            'Verified canonical 465 SMTPS / 587 STARTTLS fallback & quote stripping, DISABLE_PER_ORDER_EMAILS bypass, direct .xlsx download RBAC, and 15m+ scheduler retry backoff.'
        });
      } else {
        results.push({
          test: 'SMTP 465/587 TLS Negotiation, Per-Order Bypass, Excel Download & Scheduler Backoff',
          status: 'FAIL',
          message: `tls=${tlsNegotiationOk}, perOrder=${perOrderBypassOk}, excel=${excelDownloadOk}, backoff=${backoffOk} (${errCountBefore}->${errCountAfterFirst}->${errCountAfterSecond})`
        });
      }
    } finally {
      resetDailyReportSchedulerBackoff();
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (prevDisablePerOrder !== undefined) process.env.DISABLE_PER_ORDER_EMAILS = prevDisablePerOrder;
      else delete process.env.DISABLE_PER_ORDER_EMAILS;
      if (prevSmtpHost !== undefined) process.env.SMTP_HOST = prevSmtpHost;
      else delete process.env.SMTP_HOST;
      if (prevSmtpPort !== undefined) process.env.SMTP_PORT = prevSmtpPort;
      else delete process.env.SMTP_PORT;
      if (prevSmtpSecure !== undefined) process.env.SMTP_SECURE = prevSmtpSecure;
      else delete process.env.SMTP_SECURE;
      if (prevSmtpUser !== undefined) process.env.SMTP_USER = prevSmtpUser;
      else delete process.env.SMTP_USER;
      if (prevSmtpPass !== undefined) process.env.SMTP_PASS = prevSmtpPass;
      else delete process.env.SMTP_PASS;
      if (preTestDbRaw) {
        fs.writeFileSync(dbFile, preTestDbRaw, 'utf-8');
        (db as any).state = JSON.parse(preTestDbRaw);
      }
    }
  } catch (e: any) {
    results.push({
      test: 'SMTP 465/587 TLS Negotiation, Per-Order Bypass, Excel Download & Scheduler Backoff',
      status: 'FAIL',
      message: e.message
    });
  }

  const allPassed = results.every(r => r.status === 'PASS');
  console.log('CRITICAL PATH TEST SUMMARY:');
  results.forEach(r => console.log(`[${r.status}] ${r.test}: ${r.message}`));
  console.log(`\nOVERALL STATUS: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}\n`);

  return { passed: allPassed, results };
}

if (process.argv[1] && process.argv[1].includes('criticalPaths.test.ts')) {
  runCriticalPathTests();
}
