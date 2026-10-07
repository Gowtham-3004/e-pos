import type { Customer, Supplier } from '@elixir/contracts';
import { DAY, iso, isoDay, type Rng } from './rng';
import { DEMO_TENANT_IDS, TENANT_IDS } from './platform';

const FIRST = ['Aarav', 'Ananya', 'Karthik', 'Divya', 'Vikram', 'Sneha', 'Rahul', 'Kavya', 'Arjun', 'Lakshmi', 'Siddharth', 'Meera', 'Harish', 'Pooja', 'Naveen', 'Revathi', 'Gautham', 'Swathi', 'Manoj', 'Deepika', 'Sanjay', 'Nithya', 'Balaji', 'Janani', 'Prakash', 'Fathima', 'Joseph', 'Aishwarya'];
const LAST = ['Krishnan', 'Subramanian', 'Iyer', 'Nair', 'Reddy', 'Pillai', 'Raman', 'Menon', 'Sharma', 'Natarajan', 'Kumar', 'Rao', 'Venkatesh', 'Shah', 'Khan', 'Thomas'];

const SUPPLIERS: Record<string, string[]> = {
  [TENANT_IDS.abc]: ['Hindustan Unilever Distributors', 'Amul Dairy Agency', 'Sri Murugan Traders', 'Koyambedu Fresh Produce', 'ITC Foods Stockist', 'Britannia Super Stockist', 'Tata Consumer Distributors', 'Aavin Milk Depot'],
  [TENANT_IDS.trendz]: ['Tiruppur Knit Exports', 'Erode Textiles', 'Bangalore Denim Co', 'Kanchipuram Silk House', 'StrideOn Footwear'],
  [TENANT_IDS.wellness]: ['MedLife Pharma Distributors', 'Apollo Wholesale Drugs', 'Sun Pharma CFA', 'Cipla Stockist Madurai', 'Abbott Healthcare Agency'],
  [TENANT_IDS.volt]: ['Redington India', 'Ingram Micro', 'Samsung Direct Distribution', 'Apple Authorised Distributor'],
  [TENANT_IDS.spice]: ['Koyambedu Vegetables', 'Fresh Catch Seafood', 'Suguna Chicken', 'Aavin Milk Depot', 'Metro Cash & Carry'],
};

export function buildParties(rng: Rng) {
  const customers: Customer[] = [];
  const suppliers: Supplier[] = [];
  const NOW = Date.now();
  for (const tid of DEMO_TENANT_IDS) {
    const count = tid === TENANT_IDS.spice ? 14 : 26;
    const used = new Set<string>();
    for (let i = 0; i < count; i++) {
      let name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
      while (used.has(name)) name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
      used.add(name);
      const business = i % 9 === 4;
      const credit = i % 4 === 0 || business;
      const points = rng.int(0, 2400);
      customers.push({
        id: `cu-${tid}-${i + 1}`,
        tenantId: tid,
        name: business ? `${name.split(' ')[1]} Enterprises` : name,
        phone: `9${rng.int(100000000, 999999999)}`,
        email: i % 3 === 0 ? `${name.split(' ')[0]!.toLowerCase()}@example.in` : undefined,
        gstin: business ? `33AA${String.fromCharCode(65 + (i % 26))}FB${rng.int(1000, 9999)}C1Z${i % 10}` : undefined,
        stateCode: business && i % 2 ? '29' : '33',
        priceGroupId: business ? 'pg-dealer' : i % 5 === 0 ? 'pg-member' : undefined,
        creditLimitPaise: credit ? rng.pick([1000000, 2500000, 5000000]) : 0,
        creditDays: credit ? 30 : 0,
        outstandingPaise: credit ? rng.int(0, 18000) * 100 : 0,
        loyaltyPoints: points,
        tier: points > 1800 ? 'Platinum' : points > 900 ? 'Gold' : 'Silver',
        createdAt: iso(NOW - rng.int(5, 380) * DAY),
        active: i !== count - 1,
      });
    }
    (SUPPLIERS[tid] ?? []).forEach((name, i) => {
      suppliers.push({
        id: `su-${tid}-${i + 1}`,
        tenantId: tid,
        name,
        phone: `+91 44 ${rng.int(2000, 2999)} ${rng.int(1000, 9999)}`,
        gstin: `33AAC${String.fromCharCode(70 + i)}S${rng.int(1000, 9999)}D1Z${i}`,
        stateCode: i === 2 && tid === TENANT_IDS.trendz ? '29' : '33',
        city: ['Chennai', 'Coimbatore', 'Madurai', 'Bengaluru', 'Tiruppur'][i % 5]!,
        payableDays: rng.pick([15, 30, 45]),
        outstandingPaise: 0,
        licenceNo: tid === TENANT_IDS.wellness ? `TN-MDU-${rng.int(10000, 99999)}` : undefined,
        licenceValidUntil: tid === TENANT_IDS.wellness ? isoDay(NOW + (i === 1 ? 18 : 400) * DAY) : undefined,
        active: true,
      });
    });
  }
  return { customers, suppliers };
}
