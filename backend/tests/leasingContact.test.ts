import { describe, expect, it } from 'vitest';
import {
  orderContactKindOf,
  parseLeasingChatUrl,
  parseLeasingContactPhone,
  publicLeasingContactOf,
  serializeOrderContact,
} from '../src/lib/leasingContact.js';

describe('лизингийн холбоо барих', () => {
  it('хоосон утгыг зөвшөөрнө', () => {
    expect(publicLeasingContactOf({})).toEqual({ name: null, phone: null, chatUrl: null });
  });

  it('утас 8 оронтой байх ёстой', () => {
    expect(parseLeasingContactPhone('99112233')).toBe('99112233');
    expect(() => parseLeasingContactPhone('123')).toThrow();
  });

  it('чат зөвхөн http(s) URL', () => {
    expect(parseLeasingChatUrl('https://m.me/itgel')).toBe('https://m.me/itgel');
    expect(() => parseLeasingChatUrl('javascript:alert(1)')).toThrow();
    expect(() => parseLeasingChatUrl('m.me/itgel')).toThrow();
  });

  it('лизинг/бэлэн дахин борлуулалт LEASING холбоо барих', () => {
    expect(orderContactKindOf({ isLeasing: true, payeeKind: 'LEASING' })).toBe('LEASING');
    expect(orderContactKindOf({ isLeasing: false, payeeKind: 'LEASING' })).toBe('LEASING');
    expect(orderContactKindOf({ isLeasing: false, payeeKind: 'SHOP' })).toBe('SHOP');
  });

  it('хоосон товчын утгыг нууна', () => {
    const leasing = serializeOrderContact({
      kind: 'LEASING',
      shop: { storeName: 'Итгэл', phone: '77001122', facebookUrl: 'https://fb.com/shop' },
      leasing: { name: 'Лизинг админ', phone: null, chatUrl: null },
    });
    expect(leasing.phone).toBeNull();
    expect(leasing.chatUrl).toBeNull();
    expect(leasing.title).toBe('Лизинг админ');
  });
});
