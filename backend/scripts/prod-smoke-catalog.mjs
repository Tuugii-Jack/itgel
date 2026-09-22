#!/usr/bin/env node
/**
 * [TEST] SMOKE каталогийн idempotent upsert.
 *
 * Анхдагч: зөвхөн хэвлэнэ / шалгана. Төлбөр, захиалга, тохиргоо, эрх хөндөхгүй.
 *
 *   node scripts/prod-smoke-catalog.mjs
 *   node scripts/prod-smoke-catalog.mjs --check
 *
 * Бичих зөвхөн хоёр env + --apply байвал:
 *   ITGEL_PROD_SMOKE_APPLY=1
 *   ITGEL_PROD_SMOKE_ALLOW_PRODUCTION=I-CONFIRM   (itgelshop.mn үед)
 *   API_URL=... ADMIN_TOKEN=... LEASING_A_ADMIN_ID=... LEASING_B_ADMIN_ID=...
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(root, 'prod-smoke-fixtures.json'), 'utf8'));

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const check = args.has('--check') || apply;
const apiUrl = (process.env.API_URL ?? 'https://api.itgelshop.mn/api').replace(/\/$/, '');
const token = process.env.ADMIN_TOKEN ?? '';

function skuKeyOf(selections) {
  return Object.keys(selections)
    .sort((a, b) => a.localeCompare(b, 'mn'))
    .map((k) => `${k}=${selections[k]}`)
    .join('|');
}

function isProductionApi(url) {
  return /itgelshop\.mn/i.test(url);
}

function assertApplyAllowed() {
  if (process.env.ITGEL_PROD_SMOKE_APPLY !== '1') {
    throw new Error('Бичихийн тулд ITGEL_PROD_SMOKE_APPLY=1 хэрэгтэй.');
  }
  if (isProductionApi(apiUrl) && process.env.ITGEL_PROD_SMOKE_ALLOW_PRODUCTION !== 'I-CONFIRM') {
    throw new Error('Production API. ITGEL_PROD_SMOKE_ALLOW_PRODUCTION=I-CONFIRM байх ёстой.');
  }
  if (!token) throw new Error('ADMIN_TOKEN дутуу.');
}

async function api(method, path, body) {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

function printSpec() {
  console.log(JSON.stringify({
    mode: apply ? 'APPLY' : check ? 'CHECK' : 'PRINT',
    apiUrl,
    category: fixtures.category.name,
    products: fixtures.products.map((p) => ({
      code: p.code,
      name: p.name,
      ownerKind: p.ownerKind,
      type: p.type,
      sellPrice: p.sellPrice,
      stock: p.stock ?? p.skuStocks,
    })),
    skuKeys: {
      blackM: skuKeyOf({ Өнгө: 'Хар', Хэмжээ: 'M' }),
      whiteL: skuKeyOf({ Өнгө: 'Цагаан', Хэмжээ: 'L' }),
    },
    expectedMath: fixtures.expectedMath,
    writesPayments: false,
    writesSettings: false,
  }, null, 2));
}

async function listByQuery(path, q) {
  const res = await api('GET', `${path}?q=${encodeURIComponent(q)}&pageSize=50`);
  const rows = res.json?.data ?? res.json?.items ?? [];
  return Array.isArray(rows) ? rows : [];
}

async function main() {
  printSpec();
  if (!check && !apply) return;

  if (!token) {
    console.error('CHECK/APPLY-д ADMIN_TOKEN хэрэгтэй. Production-д бичээгүй.');
    process.exitCode = 1;
    return;
  }
  if (apply) assertApplyAllowed();

  const found = [];
  for (const product of fixtures.products) {
    const path = product.ownerKind === 'LEASING' ? '/leasing/products' : '/admin/products';
    const rows = await listByQuery(path, product.name);
    const hit = rows.find((row) => row.name === product.name);
    found.push({ name: product.name, exists: Boolean(hit), id: hit?.id ?? null });
  }
  console.log(JSON.stringify({ existing: found }, null, 2));

  if (!apply) return;

  console.error('APPLY горим идэвхтэй — зөвхөн каталог (ангилал/бараа). Захиалга/төлбөр үүсгэхгүй.');
  const cats = await api('GET', '/admin/categories');
  const catList = cats.json?.data ?? [];
  let categoryId = catList.find((c) => c.name === fixtures.category.name)?.id;
  if (!categoryId) {
    const created = await api('POST', '/admin/categories', fixtures.category);
    if (created.status >= 300) throw new Error(`category ${created.status}`);
    categoryId = created.json?.data?.id;
  }

  for (const product of fixtures.products) {
    if (found.find((f) => f.name === product.name)?.exists) {
      console.log('skip existing', product.name);
      continue;
    }
    if (product.ownerKind === 'LEASING') {
      const ownerAdminId = product.code === 'SMOKE-LA'
        ? process.env.LEASING_A_ADMIN_ID
        : process.env.LEASING_B_ADMIN_ID;
      if (!ownerAdminId) throw new Error(`${product.code} owner id дутуу`);
      const body = {
        name: product.name,
        categoryId,
        images: [],
        options: product.options ?? [],
        sellPrice: product.sellPrice,
        costPrice: product.costPrice,
        stock: product.stock ?? 0,
        status: product.status,
        ownerAdminId,
      };
      const res = await api('POST', '/leasing/products', body);
      if (res.status >= 300) throw new Error(`${product.name} ${res.status} ${JSON.stringify(res.json)}`);
      continue;
    }

    const created = await api('POST', '/admin/products', {
      name: product.name,
      categoryId,
      images: [],
      options: product.options ?? [],
    });
    if (created.status >= 300) throw new Error(`${product.name} ${created.status}`);
    const productId = created.json?.data?.id;
    const closeAt = product.type === 'order'
      ? new Date(Date.now() + product.closeAtDays * 86400000).toISOString()
      : null;
    const round = await api('POST', `/admin/products/${productId}/rounds`, {
      costPrice: product.costPrice,
      sellPrice: product.sellPrice,
      stock: product.stock ?? 0,
      closeAt,
      leadMinDays: product.leadMinDays,
      leadMaxDays: product.leadMaxDays,
      status: product.status,
      optionPrices: product.optionPrices,
      skuStocks: product.skuStocks,
    });
    if (round.status >= 300) throw new Error(`round ${product.name} ${round.status}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
