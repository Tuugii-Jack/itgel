import { prisma } from '../prisma.js';
import { conflict, badRequest } from '../lib/errors.js';
import { staffPhoneFields } from './phoneOtp.js';

/** Утас/и-мэйл давхцах үед хоёр бүртгэлийг автоматаар нийлүүлэхгүй. */
export async function resolveAdminOrderCustomer(input: { email?: string; phone?: string; name?: string }) {
  if (!input.email && !input.phone) throw badRequest('Утас эсвэл и-мэйл оруулна уу.');
  return prisma.$transaction(async (tx) => {
    const byEmail = input.email ? await tx.customer.findUnique({ where: { email: input.email } }) : null;
    const byPhone = input.phone ? await tx.customer.findUnique({ where: { phone: input.phone } }) : null;
    if (byEmail && byPhone && byEmail.id !== byPhone.id) throw conflict('Утас болон и-мэйл хоёр өөр хэрэглэгчтэй холбогдсон. Бүртгэлтэй хэрэглэгчээ сонгоно уу.');
    if (!byEmail && byPhone?.email && input.email && byPhone.email !== input.email) throw conflict('Энэ утас өөр и-мэйлтэй бүртгэлд байна. Бүртгэлтэй хэрэглэгчээ сонгоно уу.');
    const existing = byEmail ?? byPhone;
    if (existing) {
      const updated = await tx.customer.update({ where: { id: existing.id }, data: {
        ...(input.phone && existing.phone !== input.phone ? staffPhoneFields(input.phone) : {}),
        ...(input.email && !existing.email ? { email: input.email, emailVerifiedAt: new Date() } : {}),
        ...(input.name ? { name: input.name } : {}),
      } });
      return updated.id;
    }
    const customer = await tx.customer.create({ data: {
      email: input.email ?? null, ...staffPhoneFields(input.phone),
      name: input.name ?? null, emailVerifiedAt: input.email ? new Date() : null,
    } });
    return customer.id;
  });
}
