import { describe, expect, it } from 'vitest';
import { refundPayoutStatus } from '../src/services/serialize.js';

describe('refundPayoutStatus', () => {
  it('буцаалтгүй бол хоосон', () => {
    expect(refundPayoutStatus([], new Set())).toEqual({
      refundPayoutOn: null,
      refundPaid: false,
    });
  });

  it('админ баталгаажуулаагүй бол хамгийн ойрын өдөр', () => {
    expect(refundPayoutStatus(['2026-08-10', '2026-08-20'], new Set())).toEqual({
      refundPayoutOn: '2026-08-10',
      refundPaid: false,
    });
  });

  it('эхний өдөр орсон бол дараагийнхыг харуулна', () => {
    expect(refundPayoutStatus(['2026-08-10', '2026-08-20'], new Set(['2026-08-10']))).toEqual({
      refundPayoutOn: '2026-08-20',
      refundPaid: false,
    });
  });

  it('бүгд орсон бол paid', () => {
    expect(
      refundPayoutStatus(['2026-08-10', '2026-08-20'], new Set(['2026-08-10', '2026-08-20'])),
    ).toEqual({
      refundPayoutOn: '2026-08-20',
      refundPaid: true,
    });
  });
});
