/**
 * RFM Segmentation & Dynamic Analytics Engine for Bharatvarsh Leathercrafts LLP
 * Derives CAC, ROAS, AOV, operational return rates, transit SLAs, quarterly retention cohorts,
 * and 30-day SKU reorder velocities dynamically from live database records.
 */

import { db } from './db.ts';
import { Customer, RFMSegment, UnitEconomicsMetrics, OperationalHealthMetrics } from '../types/index.ts';

export function classifyCustomerRFM(customer: Customer): { segment: RFMSegment; score: { recency: number; frequency: number; monetary: number } } {
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
  if (lifetimeValue >= 50000) monetaryScore = 5;
  else if (lifetimeValue >= 25000) monetaryScore = 4;
  else if (lifetimeValue >= 10000) monetaryScore = 3;
  else if (lifetimeValue >= 3500) monetaryScore = 2;
  else monetaryScore = 1;

  let segment: RFMSegment = 'Promising/Recent';

  if (totalOrders > 0 && discountOrdersCount >= 2 && discountOrdersCount >= totalOrders) {
    segment = 'Bargain Hunters';
  } else if (daysSinceLastOrder > 90 && totalOrders > 0) {
    segment = 'At-Risk/Churning';
  } else if ((frequencyScore >= 4 && monetaryScore >= 4) || (totalOrders >= 4 && lifetimeValue >= 50000)) {
    segment = 'Champions/VIPs';
  } else {
    segment = 'Promising/Recent';
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

export function computeUnitEconomics(): UnitEconomicsMetrics {
  const orders = db.getOrders().filter(o => o.paymentStatus === 'PAID');
  const customers = db.getCustomers().filter(c => c.role === 'PATRON');

  const totalRevenue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
  const totalOrders = orders.length;
  const aov = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  const totalMarketingSpend = customers.reduce((sum, c) => sum + (c.acquisitionCost || 0), 0);
  const totalAcquiredCustomers = customers.filter(c => (c.acquisitionCost || 0) > 0).length;
  const cac = totalAcquiredCustomers > 0 ? Math.round(totalMarketingSpend / totalAcquiredCustomers) : 0;

  const roas = totalMarketingSpend > 0 ? Number((totalRevenue / totalMarketingSpend).toFixed(2)) : 0;

  const repeatCustomers = customers.filter(c => c.totalOrders > 1).length;
  const repeatPurchaseRate = customers.length > 0 ? Number(((repeatCustomers / customers.length) * 100).toFixed(1)) : 0;

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

export function computeOperationalHealth(): OperationalHealthMetrics {
  const warranties = db.getWarranties();
  const orders = db.getOrders();
  const auditLogs = db.getAuditLogs();
  const totalOrders = orders.length;
  const totalUnitsSold = orders.reduce((acc, o) => acc + o.items.reduce((s, it) => s + it.quantity, 0), 0);
  const totalClaims = warranties.reduce((acc, w) => acc + w.claimCount, 0);

  const warrantyClaimFrequency =
    totalUnitsSold > 0 ? Number(((totalClaims / totalUnitsSold) * 100).toFixed(2)) : 0;

  // Derive return-reason percentages from RMA_PROCESSED audit logs
  const rmaLogs = auditLogs.filter(l => l.action === 'RMA_PROCESSED');
  const reasonCounts = {
    COLOR_MISMATCH: 0,
    TEXTURE_DEFECT: 0,
    INCORRECT_SIZE: 0,
    HARDWARE_DAMAGE: 0
  };

  for (const log of rmaLogs) {
    const match = /\(Reason:\s*(COLOR_MISMATCH|TEXTURE_DEFECT|INCORRECT_SIZE|HARDWARE_DAMAGE)\)/i.exec(log.details);
    if (match) {
      const key = match[1].toUpperCase() as keyof typeof reasonCounts;
      reasonCounts[key] += 1;
    }
  }

  // Also account for RETURNED orders without a matching RMA log entry
  const loggedReturnTotal =
    reasonCounts.COLOR_MISMATCH +
    reasonCounts.TEXTURE_DEFECT +
    reasonCounts.INCORRECT_SIZE +
    reasonCounts.HARDWARE_DAMAGE;
  const returnedOrdersCount = orders.filter(o => o.status === 'RETURNED').length;
  if (returnedOrdersCount > loggedReturnTotal) {
    reasonCounts.TEXTURE_DEFECT += returnedOrdersCount - loggedReturnTotal;
  }

  const denominator = Math.max(1, totalOrders);
  const toPct = (count: number) => Number(((count / denominator) * 100).toFixed(1));

  // Derive transit days & on-time delivery rate from delivered orders
  const deliveredOrders = orders.filter(o => o.status === 'DELIVERED' || o.courierStatus === 'DELIVERED');
  let averageTransitDays = 0;
  let onTimeDeliveryRate = 100;

  if (deliveredOrders.length > 0) {
    let totalDays = 0;
    let onTimeCount = 0;

    for (const ord of deliveredOrders) {
      const startMs = new Date(ord.createdAt).getTime();
      const endMs = new Date(ord.updatedAt).getTime();
      const transitDays = Number.isFinite(startMs) && Number.isFinite(endMs)
        ? Math.max(0.2, (endMs - startMs) / (1000 * 60 * 60 * 24))
        : 2.5;
      totalDays += transitDays;

      if (ord.estimatedDeliveryDate) {
        const etaMs = new Date(ord.estimatedDeliveryDate).getTime();
        if (endMs <= etaMs) onTimeCount += 1;
      } else if (transitDays <= 5) {
        onTimeCount += 1;
      }
    }

    averageTransitDays = Number((totalDays / deliveredOrders.length).toFixed(1));
    onTimeDeliveryRate = Number(((onTimeCount / deliveredOrders.length) * 100).toFixed(1));
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

export function computeCohortRetention() {
  const patrons = db.getCustomers({ includeArchived: true }).filter(c => c.role === 'PATRON');
  const orders = db.getOrders().filter(o => o.paymentStatus === 'PAID');
  const dayMs = 1000 * 60 * 60 * 24;

  const cohortsMap = new Map<
    string,
    { sortKey: number; cohort: string; totalPatrons: number; day30: number; day60: number; day90: number }
  >();

  for (const patron of patrons) {
    const createdDate = new Date(patron.createdAt || Date.now());
    const year = Number.isNaN(createdDate.getTime()) ? new Date().getFullYear() : createdDate.getUTCFullYear();
    const month = Number.isNaN(createdDate.getTime()) ? new Date().getUTCMonth() : createdDate.getUTCMonth();
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
    const bucket = cohortsMap.get(cohortLabel)!;
    bucket.totalPatrons += 1;

    const patronOrders = orders.filter(
      o => o.customerId === patron.id || o.customerEmail.toLowerCase() === patron.email.toLowerCase()
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

  return Array.from(cohortsMap.values())
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ cohort, totalPatrons, day30, day60, day90 }) => ({
      cohort,
      totalPatrons,
      day30,
      day60,
      day90
    }));
}

export function computeSkuReorderVelocity(nowMs: number = Date.now()) {
  const paidOrders = db.getOrders().filter(o => o.paymentStatus === 'PAID');
  const catalogProducts = db.getCatalog().products || [];
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;

  const skuStats = new Map<
    string,
    { sku: string; name: string; unitsSold30d: number; unitsSoldPrev30d: number; stockCount?: number }
  >();

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
      const stat = skuStats.get(item.sku)!;
      if (ageMs <= thirtyDaysMs) {
        stat.unitsSold30d += item.quantity;
      } else if (ageMs <= sixtyDaysMs) {
        stat.unitsSoldPrev30d += item.quantity;
      }
    }
  }

  return Array.from(skuStats.values())
    .sort((a, b) => b.unitsSold30d - a.unitsSold30d || a.name.localeCompare(b.name))
    .slice(0, 6)
    .map(stat => {
      let velocityTrend = '0%';
      if (stat.unitsSoldPrev30d === 0 && stat.unitsSold30d > 0) {
        velocityTrend = '+100%';
      } else if (stat.unitsSoldPrev30d > 0) {
        const pct = Math.round(((stat.unitsSold30d - stat.unitsSoldPrev30d) / stat.unitsSoldPrev30d) * 100);
        velocityTrend = `${pct >= 0 ? '+' : ''}${pct}%`;
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
