import { badRequest } from './errors.js';
import { normalizePhone, PHONE_RE } from './code.js';

const CHAT_URL_RE = /^https?:\/\/[^\s]+$/i;

export interface PublicLeasingContact {
  name: string | null;
  phone: string | null;
  chatUrl: string | null;
}

export function parseLeasingPublicName(raw: string | undefined | null): string {
  return (raw ?? '').trim().slice(0, 80);
}

export function parseLeasingContactPhone(raw: string | undefined | null): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  const phone = normalizePhone(trimmed);
  if (!PHONE_RE.test(phone)) {
    throw badRequest('Холбоо барих утас 8 оронтой монгол дугаар байх ёстой.');
  }
  return phone;
}

export function parseLeasingChatUrl(raw: string | undefined | null): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  if (!CHAT_URL_RE.test(trimmed) || trimmed.length > 300) {
    throw badRequest('Чатын холбоос https:// эсвэл http://-ээр эхэлсэн зөв URL байх ёстой.');
  }
  return trimmed;
}

export function publicLeasingContactOf(input: {
  leasingPublicName?: string | null;
  leasingContactPhone?: string | null;
  leasingChatUrl?: string | null;
}): PublicLeasingContact {
  const name = parseLeasingPublicName(input.leasingPublicName) || null;
  const phone = (input.leasingContactPhone ?? '').trim() || null;
  const chatUrl = (input.leasingChatUrl ?? '').trim() || null;
  return { name, phone, chatUrl };
}

export function hasPublicLeasingContact(contact: PublicLeasingContact): boolean {
  return Boolean(contact.name || contact.phone || contact.chatUrl);
}

export type OrderContactKind = 'SHOP' | 'LEASING';

export function orderContactKindOf(order: {
  isLeasing?: boolean | null;
  payeeKind?: string | null;
}): OrderContactKind {
  if (order.isLeasing || order.payeeKind === 'LEASING') return 'LEASING';
  return 'SHOP';
}

export function serializeOrderContact(input: {
  kind: OrderContactKind;
  shop: { storeName?: string | null; phone?: string | null; facebookUrl?: string | null };
  leasing: PublicLeasingContact;
}) {
  if (input.kind === 'LEASING') {
    return {
      kind: 'LEASING' as const,
      title: input.leasing.name || 'Лизингийн админ',
      phone: input.leasing.phone,
      chatUrl: input.leasing.chatUrl,
    };
  }
  return {
    kind: 'SHOP' as const,
    title: input.shop.storeName?.trim() || 'Итгэл',
    phone: input.shop.phone?.trim() || null,
    chatUrl: input.shop.facebookUrl?.trim() || null,
  };
}
