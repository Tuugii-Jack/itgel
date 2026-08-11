import { describe, expect, it } from 'vitest';
import {
  BATCH_STAGES,
  canTransition,
  nextBatchStage,
  ORDER_FLOW,
  orderStatusForBatchStage,
  previousBatchStage,
  stepsToStatus,
} from '../src/lib/orderStatus.js';

describe('Захиалгын төлөв шилжилт', () => {
  it('гинжин дагуу нэг алхам урагш зөвшөөрнө', () => {
    for (let i = 0; i < ORDER_FLOW.length - 1; i++) {
      expect(canTransition(ORDER_FLOW[i]!, ORDER_FLOW[i + 1]!)).toBe(true);
    }
  });

  it('алхам алгасахыг зөвшөөрөхгүй', () => {
    expect(canTransition('NEW', 'IN_BATCH')).toBe(false);
    expect(canTransition('CONFIRMED', 'ARRIVED')).toBe(false);
    expect(canTransition('NEW', 'HANDED_OVER')).toBe(false);
  });

  it('буцаж шилжихийг зөвшөөрөхгүй', () => {
    expect(canTransition('ARRIVED', 'IN_TRANSIT')).toBe(false);
    expect(canTransition('CONFIRMED', 'NEW')).toBe(false);
  });

  it('ижил төлөв рүү шилжихгүй', () => {
    for (const status of ORDER_FLOW) expect(canTransition(status, status)).toBe(false);
  });

  it('CANCELLED руу HANDED_OVER-с бусад бүх төлвөөс шилжинэ', () => {
    for (const status of ORDER_FLOW) {
      expect(canTransition(status, 'CANCELLED')).toBe(status !== 'HANDED_OVER');
    }
  });

  it('CANCELLED-с хаашаа ч шилжихгүй', () => {
    for (const status of [...ORDER_FLOW, 'CANCELLED' as const]) {
      expect(canTransition('CANCELLED', status)).toBe(false);
    }
  });
});

describe('Багцын шат', () => {
  it('дараалал зөв', () => {
    expect(nextBatchStage('COLLECTING')).toBe('CLOSED');
    expect(nextBatchStage('IN_TRANSIT')).toBe('AT_WAREHOUSE');
    expect(nextBatchStage('DONE')).toBeNull();
  });

  it('буцах дараалал зөв', () => {
    expect(previousBatchStage('COLLECTING')).toBeNull();
    expect(previousBatchStage('CLOSED')).toBe('COLLECTING');
    expect(previousBatchStage('AT_WAREHOUSE')).toBe('IN_TRANSIT');
    expect(previousBatchStage('DONE')).toBe('AT_WAREHOUSE');
  });

  it('шат бүр 6 ширхэг, 0–5', () => {
    expect(BATCH_STAGES).toHaveLength(6);
  });

  it('шат нь захиалгын төлөвт буулгагдана', () => {
    expect(orderStatusForBatchStage('COLLECTING')).toBeNull();
    expect(orderStatusForBatchStage('CLOSED')).toBe('IN_BATCH');
    expect(orderStatusForBatchStage('AT_SUPPLIER')).toBe('IN_BATCH');
    expect(orderStatusForBatchStage('IN_TRANSIT')).toBe('IN_TRANSIT');
    expect(orderStatusForBatchStage('AT_WAREHOUSE')).toBe('ARRIVED');
    expect(orderStatusForBatchStage('DONE')).toBeNull();
  });
});

describe('Багц ахих үеийн алхмууд', () => {
  it('CONFIRMED → ARRIVED хүртэл алхам алхмаар', () => {
    expect(stepsToStatus('CONFIRMED', 'ARRIVED')).toEqual(['IN_BATCH', 'IN_TRANSIT', 'ARRIVED']);
  });

  it('аль хэдийн хүрсэн бол алхам байхгүй', () => {
    expect(stepsToStatus('ARRIVED', 'ARRIVED')).toEqual([]);
    expect(stepsToStatus('ARRIVED', 'IN_TRANSIT')).toEqual([]);
  });

  it('цуцлагдсан захиалга багцтай хамт хөдлөхгүй', () => {
    expect(stepsToStatus('CANCELLED', 'ARRIVED')).toEqual([]);
  });

  it('гаргасан алхам бүр зөвшөөрөгдсөн шилжилт байна', () => {
    const steps = stepsToStatus('NEW', 'HANDED_OVER');
    let current: (typeof ORDER_FLOW)[number] = 'NEW';
    for (const step of steps) {
      expect(canTransition(current, step)).toBe(true);
      current = step;
    }
    expect(current).toBe('HANDED_OVER');
  });
});
