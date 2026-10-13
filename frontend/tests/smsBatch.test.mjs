import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sendSmsChunks, smsSubsetToken, SmsBatchError } from '../lib/smsBatch.ts';

test('subset fingerprint matches the backend format and includes text and merchant', async () => {
  const rows = [{ id: 'b', text: 'Бараа ирлээ' }, { id: 'a', text: 'SMS 123' }];
  const expected = createHash('sha256').update('shop\n--\norder\n--\na\nSMS 123\n--\nb\nБараа ирлээ').digest('hex');
  assert.equal(await smsSubsetToken(rows, 'shop', 'order'), expected);
  assert.equal(await smsSubsetToken([...rows].reverse(), 'shop', 'order'), expected);
  assert.notEqual(await smsSubsetToken(rows, 'leasing', 'order'), expected);
  assert.notEqual(await smsSubsetToken([{ id: 'b', text: 'changed' }, rows[1]], 'shop', 'order'), expected);
});

test('large sends are bounded, ordered, and report progress after completed responses', async () => {
  const rows = Array.from({ length: 21 }, (_, i) => i);
  const sent = []; const progress = []; let active = 0;
  const results = await sendSmsChunks(rows, async (chunk) => {
    assert.equal(active++, 0);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--; sent.push(...chunk); return chunk.length;
  }, (completed, total) => progress.push([completed, total]));
  assert.deepEqual(sent, rows); assert.deepEqual(results, [8, 8, 5]);
  assert.deepEqual(progress, [[0, 21], [8, 21], [16, 21], [21, 21]]);
});

test('an uncertain response stops later sends and preserves completed progress', async () => {
  let requests = 0;
  await assert.rejects(sendSmsChunks(Array.from({ length: 40 }, (_, i) => i), async () => {
    if (++requests === 2) throw new Error('timeout'); return 8;
  }, () => {}), (error) => error instanceof SmsBatchError && error.completed === 8 && error.total === 40 && error.originalError.message === 'timeout');
  assert.equal(requests, 2);
});
