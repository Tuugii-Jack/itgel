import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma.js';
import { seedAdmin, seedCatalog } from './helpers/seedAdmin.js';
import { startApp } from './helpers/httpApp.js';

let server: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => { server = await startApp(); });
afterAll(async () => { await server.close(); });

describe('lightweight product template list', () => {
  it('preserves every editor field while leaving release stock and pricing to the full detail endpoint', async () => {
    const admin = await seedAdmin('ADMIN');
    const c = await seedCatalog();
    await prisma.product.update({ where: { id: c.product.id }, data: {
      description: 'Editable description', images: ['https://example.test/one.webp'],
      variants: { create: [{ kind: 'Хэмжээ', value: 'S', sortOrder: 0 }, { kind: 'Хэмжээ', value: 'M', sortOrder: 1 }] },
      sizeChart: { create: { size: 'S', heightRange: '160-170', chestCm: '90', sortOrder: 0 } },
    } });
    await prisma.roundSkuStock.createMany({ data: Array.from({ length: 40 }, (_, i) => ({
      roundId: c.round.id, skuKey: `size-${i}`, selections: { size: `S-${i}` }, stock: 2, reserved: 0, available: 2,
    })) });
    const q = `q=${encodeURIComponent(c.product.name)}&pageSize=30`;
    const fullResponse = await fetch(`${server.url}/api/admin/products?${q}`, { headers: admin.headers });
    expect(fullResponse.status).toBe(200);
    const fullText = await fullResponse.text();
    const full = JSON.parse(fullText).data[0];
    const compactResponse = await fetch(`${server.url}/api/admin/products?${q}&view=templates`, { headers: admin.headers });
    expect(compactResponse.status).toBe(200);
    const compactText = await compactResponse.text();
    const compact = JSON.parse(compactText).data[0];
    for (const key of ['id', 'name', 'description', 'categoryId', 'category', 'images', 'options', 'sizeChart', 'roundCount', 'ownerKind']) {
      expect(compact[key]).toEqual(full[key]);
    }
    expect(compact.rounds).toEqual([]); expect(compact.currentRound).toBeNull();
    expect(full.rounds[0].skuStocks).toHaveLength(40);
    expect(compactText.length).toBeLessThan(fullText.length * 0.3);
    const detailResponse = await fetch(`${server.url}/api/admin/products/${c.product.id}`, { headers: admin.headers });
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json() as { data: { rounds: { skuStocks: unknown[] }[] } };
    expect(detail.data.rounds[0]!.skuStocks).toHaveLength(40);
  });
});
