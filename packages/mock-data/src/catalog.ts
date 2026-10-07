import type { Batch, Brand, Category, PriceGroup, Product, SerialNumber, TaxRate, Unit } from '@elixir/contracts';
import { DAY, ean13, isoDay, type Rng } from './rng';
import { TENANT_IDS } from './platform';

export const taxRates: TaxRate[] = [
  { id: 'gst0', name: 'GST 0%', ratePct: 0 },
  { id: 'gst5', name: 'GST 5%', ratePct: 5 },
  { id: 'gst12', name: 'GST 12%', ratePct: 12 },
  { id: 'gst18', name: 'GST 18%', ratePct: 18 },
  { id: 'gst28', name: 'GST 28%', ratePct: 28 },
];

export const priceGroups: PriceGroup[] = [
  { id: 'pg-retail', name: 'Retail', discountPct: 0 },
  { id: 'pg-member', name: 'Member', discountPct: 2 },
  { id: 'pg-dealer', name: 'Dealer', discountPct: 8 },
];

const CAT_COLORS = ['#e8590c', '#2b8a3e', '#1971c2', '#ae3ec9', '#c2255c', '#0c8599', '#5f3dc4', '#e67700', '#495057'];

interface Built {
  categories: Category[];
  brands: Brand[];
  products: Product[];
  batches: Batch[];
  serials: SerialNumber[];
}

const NOW = Date.now();
let barcodeSeq = 100000;

function cats(tenantId: string, names: string[]): Category[] {
  return names.map((n, i) => ({ id: `cat-${tenantId}-${i + 1}`, tenantId, name: n, color: CAT_COLORS[i % CAT_COLORS.length], sortOrder: i }));
}
function brands(tenantId: string, names: string[]): Brand[] {
  return names.map((n, i) => ({ id: `br-${tenantId}-${i + 1}`, tenantId, name: n }));
}

function product(tenantId: string, n: number, o: Partial<Product> & Pick<Product, 'name' | 'categoryId' | 'mrpPaise' | 'salePaise' | 'taxRateId' | 'hsn'>): Product {
  barcodeSeq += 7;
  return {
    id: `p-${tenantId}-${n}`,
    tenantId,
    sku: `${tenantId.slice(2, 5).toUpperCase()}-${String(n).padStart(4, '0')}`,
    barcode: ean13(barcodeSeq),
    taxInclusive: true,
    costPaise: Math.round(o.salePaise * 0.78),
    unit: 'pcs',
    decimalQty: false,
    active: true,
    reorderLevel: 10,
    rack: `${String.fromCharCode(65 + (n % 6))}${(n % 12) + 1}`,
    ...o,
  };
}

// ───────────── Grocery (ABC Supermarket) ─────────────
type G = [name: string, cat: number, mrp: number, sale: number, tax: string, hsn: string, unit?: Unit, extra?: Partial<Product>];
const GROCERY: G[] = [
  ['Aavin Toned Milk 500ml', 0, 27, 27, 'gst0', '0401', 'pcs', { batchTracked: true }],
  ['Amul Butter 100g', 0, 60, 58, 'gst12', '0405', 'pcs', { batchTracked: true }],
  ['Amul Taaza Curd 400g', 0, 45, 44, 'gst5', '0403', 'pcs', { batchTracked: true }],
  ['Britannia Cheese Slices 200g', 0, 140, 132, 'gst12', '0406', 'pcs', { batchTracked: true }],
  ['Milky Mist Paneer 200g', 0, 95, 90, 'gst5', '0406', 'pcs', { batchTracked: true }],
  ['India Gate Basmati Rice', 1, 125, 119, 'gst5', '1006', 'kg', { weighted: true, decimalQty: true, plu: '2101' }],
  ['Ponni Boiled Rice', 1, 62, 58, 'gst5', '1006', 'kg', { weighted: true, decimalQty: true, plu: '2102' }],
  ['Aashirvaad Atta 5kg', 1, 285, 268, 'gst5', '1101', 'bag'],
  ['Toor Dal', 1, 168, 159, 'gst5', '0713', 'kg', { weighted: true, decimalQty: true, plu: '2103' }],
  ['Fortune Sunflower Oil 1L', 1, 165, 152, 'gst5', '1512', 'pcs'],
  ['Idhayam Gingelly Oil 500ml', 1, 210, 199, 'gst5', '1515', 'pcs'],
  ['Tata Salt 1kg', 1, 28, 28, 'gst0', '2501', 'pcs'],
  ['Sugar', 1, 48, 45, 'gst5', '1701', 'kg', { weighted: true, decimalQty: true, plu: '2104' }],
  ['Tata Tea Gold 500g', 2, 310, 289, 'gst5', '0902', 'pcs'],
  ['Bru Instant Coffee 200g', 2, 420, 399, 'gst18', '2101', 'pcs'],
  ['Narasus Filter Coffee 500g', 2, 280, 265, 'gst5', '0901', 'pcs'],
  ['Coca-Cola 750ml', 2, 45, 45, 'gst28', '2202', 'pcs'],
  ['Tropicana Orange 1L', 2, 130, 118, 'gst12', '2009', 'pcs', { batchTracked: true }],
  ['Bisleri Water 1L', 2, 20, 20, 'gst18', '2201', 'pcs'],
  ['Lays Classic Salted 52g', 3, 20, 20, 'gst12', '2005', 'pcs'],
  ['Haldiram Aloo Bhujia 400g', 3, 110, 104, 'gst12', '2106', 'pcs'],
  ['Britannia Good Day 250g', 3, 50, 48, 'gst18', '1905', 'pcs'],
  ['Parle-G 800g', 3, 90, 88, 'gst18', '1905', 'pcs'],
  ['Cadbury Dairy Milk Silk', 3, 90, 90, 'gst18', '1806', 'pcs'],
  ['Kurkure Masala Munch 90g', 3, 20, 20, 'gst12', '2106', 'pcs'],
  ['Colgate Strong Teeth 200g', 4, 120, 109, 'gst18', '3306', 'pcs'],
  ['Dove Cream Beauty Bar 100g', 4, 65, 60, 'gst18', '3401', 'pcs'],
  ['Head & Shoulders 340ml', 4, 410, 375, 'gst18', '3305', 'pcs'],
  ['Parachute Coconut Oil 500ml', 4, 230, 214, 'gst18', '1513', 'pcs'],
  ['Dettol Handwash 200ml', 4, 99, 92, 'gst18', '3401', 'pcs'],
  ['Surf Excel Easy Wash 1kg', 5, 145, 138, 'gst18', '3402', 'pcs'],
  ['Vim Dishwash Bar 300g', 5, 30, 28, 'gst18', '3402', 'pcs'],
  ['Harpic Power Plus 1L', 5, 215, 199, 'gst18', '3402', 'pcs'],
  ['Lizol Floor Cleaner 975ml', 5, 239, 219, 'gst18', '3808', 'pcs'],
  ['Good Knight Gold Flash Refill', 5, 85, 80, 'gst18', '3808', 'pcs'],
  ['Tomato', 6, 40, 36, 'gst0', '0702', 'kg', { weighted: true, decimalQty: true, plu: '1001' }],
  ['Onion', 6, 45, 42, 'gst0', '0703', 'kg', { weighted: true, decimalQty: true, plu: '1002' }],
  ['Potato', 6, 38, 34, 'gst0', '0701', 'kg', { weighted: true, decimalQty: true, plu: '1003' }],
  ['Banana Robusta', 6, 60, 55, 'gst0', '0803', 'kg', { weighted: true, decimalQty: true, plu: '1004' }],
  ['Apple Shimla', 6, 220, 199, 'gst0', '0808', 'kg', { weighted: true, decimalQty: true, plu: '1005' }],
  ['Carrot Ooty', 6, 70, 64, 'gst0', '0706', 'kg', { weighted: true, decimalQty: true, plu: '1006' }],
  ['Coriander Bunch', 6, 15, 12, 'gst0', '0709', 'pcs'],
  ['Modern White Bread 400g', 7, 45, 45, 'gst0', '1905', 'pcs', { batchTracked: true }],
  ['Britannia Rusk 300g', 7, 70, 66, 'gst18', '1905', 'pcs'],
  ['Brown Bread 400g', 7, 55, 55, 'gst0', '1905', 'pcs', { batchTracked: true }],
  ['Eggs Tray (30)', 0, 210, 195, 'gst0', '0407', 'pcs'],
  ['MTR Rava Idli Mix 500g', 1, 140, 132, 'gst12', '2106', 'pcs'],
  ['Maggi 2-Minute Noodles 12pk', 3, 168, 160, 'gst12', '1902', 'pack'],
  ['Kissan Mixed Fruit Jam 500g', 3, 175, 165, 'gst12', '2007', 'pcs', { batchTracked: true }],
  ['Saffola Gold Oil 1L', 1, 210, 195, 'gst5', '1512', 'pcs'],
];

function buildGrocery(rng: Rng): Built {
  const tid = TENANT_IDS.abc;
  const categories = cats(tid, ['Dairy & Eggs', 'Staples', 'Beverages', 'Snacks', 'Personal Care', 'Household', 'Fruits & Vegetables', 'Bakery']);
  const br = brands(tid, ['Amul', 'Aavin', 'Tata', 'Britannia', 'HUL', 'ITC', 'Parle', 'Fresh Farm']);
  const products: Product[] = [];
  const batches: Batch[] = [];
  GROCERY.forEach(([name, ci, mrp, sale, tax, hsn, unit, extra], i) => {
    const p = product(tid, i + 1, {
      name,
      categoryId: categories[ci]!.id,
      brandId: br[i % br.length]!.id,
      mrpPaise: mrp * 100,
      salePaise: sale * 100,
      taxRateId: tax,
      hsn,
      unit: unit ?? 'pcs',
      reorderLevel: extra?.weighted ? 15 : rng.int(6, 24),
      ...extra,
    });
    if (p.weighted && p.plu) p.barcode = `2${p.plu}000000`.slice(0, 13);
    products.push(p);
    if (p.batchTracked) {
      [12, 3, 45].slice(0, rng.int(2, 3)).forEach((days, bi) => {
        batches.push({ id: `b-${p.id}-${bi + 1}`, productId: p.id, code: `B${rng.int(10, 99)}${String.fromCharCode(65 + bi)}`, mfgDate: isoDay(NOW - 20 * DAY), expiryDate: isoDay(NOW + (days + bi * 5) * DAY), mrpPaise: p.mrpPaise, costPaise: p.costPaise });
      });
    }
  });
  return { categories, brands: br, products, batches, serials: [] };
}

// ───────────── Fashion (Trendz) ─────────────
const STYLES: Array<[name: string, cat: number, mrp: number, sizes: string[], colors: string[], hsn: string]> = [
  ['Classic Oxford Shirt', 0, 1299, ['S', 'M', 'L', 'XL'], ['Blue', 'White'], '6205'],
  ['Slim Fit Chinos', 1, 1799, ['30', '32', '34', '36'], ['Khaki', 'Navy'], '6203'],
  ['Crew Neck Tee', 0, 599, ['S', 'M', 'L', 'XL'], ['Black', 'Olive', 'Grey'], '6109'],
  ['Denim Jacket', 2, 2999, ['M', 'L', 'XL'], ['Indigo'], '6201'],
  ['Cotton Kurta', 3, 1499, ['S', 'M', 'L', 'XL'], ['Maroon', 'Mustard'], '6211'],
  ['Floral Maxi Dress', 4, 2199, ['XS', 'S', 'M', 'L'], ['Peach', 'Teal'], '6204'],
  ['Linen Palazzo', 4, 1199, ['S', 'M', 'L'], ['Beige', 'Black'], '6204'],
  ['Running Sneakers', 5, 3499, ['7', '8', '9', '10'], ['White', 'Black'], '6404'],
  ['Leather Belt', 6, 899, ['Free'], ['Brown', 'Black'], '4203'],
  ['Silk Saree', 3, 5999, ['Free'], ['Red', 'Green'], '5007'],
];

function buildFashion(rng: Rng): Built {
  const tid = TENANT_IDS.trendz;
  const categories = cats(tid, ['Shirts & Tees', 'Trousers', 'Jackets', 'Ethnic', 'Womenswear', 'Footwear', 'Accessories']);
  const br = brands(tid, ['Trendz Originals', 'UrbanEdge', 'Desi Loom', 'StrideOn']);
  const products: Product[] = [];
  let n = 0;
  STYLES.forEach(([name, ci, mrp, sizes, colors, hsn], si) => {
    const styleCode = `ST-${String(si + 1).padStart(3, '0')}`;
    for (const color of colors) {
      for (const size of sizes) {
        n += 1;
        const tax = mrp > 1000 ? 'gst12' : 'gst5';
        products.push(
          product(tid, n, {
            name,
            categoryId: categories[ci]!.id,
            brandId: br[si % br.length]!.id,
            mrpPaise: mrp * 100,
            salePaise: mrp * 100,
            taxRateId: tax,
            hsn,
            styleCode,
            variantAttrs: { size, color, season: si % 2 ? 'Festive 26' : 'Summer 26' },
            sku: `${styleCode}-${color.slice(0, 3).toUpperCase()}-${size}`,
            reorderLevel: 2,
          }),
        );
      }
    }
  });
  rng.next();
  return { categories, brands: br, products, batches: [], serials: [] };
}

// ───────────── Pharmacy (Wellness) ─────────────
const MEDS: Array<[name: string, cat: number, mrp: number, mfr: string, molecule: string, schedule: Product['schedule'], tax: string, unit: Unit]> = [
  ['Dolo 650 Tablet', 0, 34, 'Micro Labs', 'Paracetamol 650mg', 'OTC', 'gst12', 'strip'],
  ['Crocin Advance 500mg', 0, 28, 'GSK', 'Paracetamol 500mg', 'OTC', 'gst12', 'strip'],
  ['Azithral 500 Tablet', 1, 119, 'Alembic', 'Azithromycin 500mg', 'H', 'gst12', 'strip'],
  ['Augmentin 625 Duo', 1, 223, 'GSK', 'Amoxicillin + Clavulanic Acid', 'H', 'gst12', 'strip'],
  ['Pan 40 Tablet', 2, 155, 'Alkem', 'Pantoprazole 40mg', 'H', 'gst12', 'strip'],
  ['Digene Gel Mint 200ml', 2, 135, 'Abbott', 'Antacid', 'OTC', 'gst12', 'pcs'],
  ['Glycomet GP 1', 3, 140, 'USV', 'Glimepiride + Metformin', 'H', 'gst12', 'strip'],
  ['Telma 40 Tablet', 3, 245, 'Glenmark', 'Telmisartan 40mg', 'H', 'gst12', 'strip'],
  ['Ecosprin 75', 3, 5, 'USV', 'Aspirin 75mg', 'H', 'gst12', 'strip'],
  ['Atorva 10', 3, 112, 'Zydus', 'Atorvastatin 10mg', 'H', 'gst12', 'strip'],
  ['Cetzine 10mg', 4, 22, 'Dr Reddys', 'Cetirizine 10mg', 'OTC', 'gst12', 'strip'],
  ['Allegra 120mg', 4, 214, 'Sanofi', 'Fexofenadine 120mg', 'H', 'gst12', 'strip'],
  ['Benadryl Cough Syrup 150ml', 4, 145, 'J&J', 'Diphenhydramine', 'OTC', 'gst12', 'pcs'],
  ['Alprax 0.25', 5, 32, 'Torrent', 'Alprazolam 0.25mg', 'H1', 'gst12', 'strip'],
  ['Becosules Capsule', 6, 49, 'Pfizer', 'Vitamin B Complex', 'OTC', 'gst12', 'strip'],
  ['Shelcal 500', 6, 125, 'Torrent', 'Calcium + Vit D3', 'OTC', 'gst12', 'strip'],
  ['Revital H Capsule 30s', 6, 345, 'Sun Pharma', 'Multivitamin', 'OTC', 'gst18', 'pcs'],
  ['Volini Spray 60g', 7, 210, 'Sun Pharma', 'Diclofenac', 'OTC', 'gst12', 'pcs'],
  ['Moov Cream 50g', 7, 165, 'Reckitt', 'Diclofenac', 'OTC', 'gst12', 'pcs'],
  ['Betadine Ointment 20g', 7, 135, 'Win Medicare', 'Povidone Iodine', 'OTC', 'gst12', 'pcs'],
  ['Dettol Antiseptic 250ml', 8, 140, 'Reckitt', 'Chloroxylenol', 'OTC', 'gst18', 'pcs'],
  ['Accu-Chek Active Strips 50', 8, 1195, 'Roche', 'Glucose strips', 'OTC', 'gst12', 'box'],
  ['N95 Mask', 8, 99, 'Venus', 'Mask', 'OTC', 'gst5', 'pcs'],
  ['ORS Electral Powder', 6, 21, 'FDC', 'Oral Rehydration Salts', 'OTC', 'gst12', 'pcs'],
  ['Montair LC Tablet', 4, 245, 'Cipla', 'Montelukast + Levocetirizine', 'H', 'gst12', 'strip'],
  ['Thyronorm 50mcg', 3, 185, 'Abbott', 'Thyroxine 50mcg', 'H', 'gst12', 'box'],
];

function buildPharmacy(rng: Rng): Built {
  const tid = TENANT_IDS.wellness;
  const categories = cats(tid, ['Pain & Fever', 'Antibiotics', 'Gastro', 'Chronic Care', 'Allergy & Cold', 'Neuro', 'Vitamins', 'Topicals', 'Devices & Hygiene']);
  const products: Product[] = [];
  const batches: Batch[] = [];
  MEDS.forEach(([name, ci, mrp, mfr, molecule, schedule, tax, unit], i) => {
    const p = product(tid, i + 1, {
      name,
      categoryId: categories[ci]!.id,
      mrpPaise: mrp * 100,
      salePaise: mrp * 100,
      taxRateId: tax,
      hsn: '3004',
      unit,
      manufacturer: mfr,
      molecule,
      schedule,
      prescriptionRequired: schedule === 'H' || schedule === 'H1' || schedule === 'X',
      batchTracked: true,
      reorderLevel: rng.int(5, 20),
    });
    products.push(p);
    const expiries = [i % 5 === 0 ? -6 : i % 4 === 0 ? 25 : 180, 420, 700];
    expiries.slice(0, rng.int(2, 3)).forEach((days, bi) => {
      batches.push({ id: `b-${p.id}-${bi + 1}`, productId: p.id, code: `${mfr.slice(0, 2).toUpperCase()}${rng.int(1000, 9999)}`, mfgDate: isoDay(NOW - 200 * DAY), expiryDate: isoDay(NOW + days * DAY), mrpPaise: p.mrpPaise, costPaise: p.costPaise });
    });
  });
  return { categories, brands: [], products, batches, serials: [] };
}

// ───────────── Electronics (Volt) ─────────────
const ELEC: Array<[name: string, cat: number, mrp: number, sale: number, brand: string, model: string, warranty: number, tax: string, serial: boolean]> = [
  ['Samsung Galaxy S26 256GB', 0, 89999, 84999, 'Samsung', 'SM-S946', 12, 'gst18', true],
  ['iPhone 17 128GB', 0, 79900, 79900, 'Apple', 'A3101', 12, 'gst18', true],
  ['Redmi Note 15 Pro', 0, 26999, 24999, 'Xiaomi', '24117RN', 12, 'gst18', true],
  ['OnePlus Nord 5', 0, 32999, 31499, 'OnePlus', 'CPH2701', 12, 'gst18', true],
  ['Dell Inspiron 15 i5', 1, 68990, 62990, 'Dell', '3530', 12, 'gst18', true],
  ['HP Pavilion x360', 1, 74999, 69999, 'HP', '14-ek2', 12, 'gst18', true],
  ['MacBook Air M4', 1, 114900, 109900, 'Apple', 'A3240', 12, 'gst18', true],
  ['Sony WH-1000XM6', 2, 34990, 29990, 'Sony', 'WH1000XM6', 12, 'gst18', true],
  ['boAt Airdopes 141', 2, 4490, 1299, 'boAt', 'AD141', 12, 'gst18', false],
  ['JBL Flip 6 Speaker', 2, 14999, 9999, 'JBL', 'FLIP6', 12, 'gst18', true],
  ['LG 55" 4K OLED TV', 3, 159990, 139990, 'LG', 'OLED55C4', 24, 'gst28', true],
  ['Samsung 43" Crystal 4K', 3, 47900, 33990, 'Samsung', 'UA43CU', 12, 'gst28', true],
  ['Apple Watch Series 11', 4, 46900, 46900, 'Apple', 'A3001', 12, 'gst18', true],
  ['Anker 20W USB-C Charger', 5, 1999, 1299, 'Anker', 'A2633', 18, 'gst18', false],
  ['SanDisk 128GB Pendrive', 5, 1899, 899, 'SanDisk', 'SDCZ73', 60, 'gst18', false],
  ['Logitech MX Master 3S', 5, 10995, 8995, 'Logitech', '910-006', 12, 'gst18', true],
];

function buildElectronics(rng: Rng): Built {
  const tid = TENANT_IDS.volt;
  const categories = cats(tid, ['Mobiles', 'Laptops', 'Audio', 'Televisions', 'Wearables', 'Accessories']);
  const brandNames = [...new Set(ELEC.map((e) => e[4]))];
  const br = brands(tid, brandNames);
  const products: Product[] = [];
  const serials: SerialNumber[] = [];
  ELEC.forEach(([name, ci, mrp, sale, brand, model, warranty, tax, serial], i) => {
    const p = product(tid, i + 1, {
      name,
      categoryId: categories[ci]!.id,
      brandId: br.find((b) => b.name === brand)!.id,
      mrpPaise: mrp * 100,
      salePaise: sale * 100,
      taxRateId: tax,
      hsn: ci === 0 ? '8517' : ci === 1 ? '8471' : ci === 3 ? '8528' : '8518',
      serialTracked: serial,
      warrantyMonths: warranty,
      model,
      reorderLevel: serial ? 2 : 10,
    });
    products.push(p);
    if (serial) {
      for (let k = 0; k < 6; k++) {
        const s = ci === 0 ? `35${rng.int(1000000, 9999999)}${rng.int(100000, 999999)}` : `${model.replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase()}${rng.int(100000, 999999)}`;
        serials.push({ id: `sn-${p.id}-${k}`, productId: p.id, serial: s, status: 'in-stock' });
      }
    }
  });
  return { categories, brands: br, products, batches: [], serials };
}

export function buildCatalogs(rng: Rng): Built {
  const parts = [buildGrocery(rng), buildFashion(rng), buildPharmacy(rng), buildElectronics(rng)];
  return {
    categories: parts.flatMap((p) => p.categories),
    brands: parts.flatMap((p) => p.brands),
    products: parts.flatMap((p) => p.products),
    batches: parts.flatMap((p) => p.batches),
    serials: parts.flatMap((p) => p.serials),
  };
}
