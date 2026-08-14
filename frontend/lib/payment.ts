import type { Tone } from "@/components/ui";
import type { PaymentState } from "./types";

/**
 * Төлбөрийн төлөвийн шошго, өнгө — backend-ийн `PAYMENT_STATE_LABEL`-тэй
 * үгчлэн таарна (backend/src/services/money.ts). Хоёр талд давхардуулж
 * бичихээс сэргийлж энэ файлыг л ашиглана.
 */
export const PAYMENT_LABEL: Record<PaymentState, string> = {
  UNPAID: "Төлөгдөөгүй",
  PARTIAL: "Хэсэгчилсэн",
  PAID: "Бүрэн төлсөн",
  OVERPAID: "Илүү төлсөн",
  REFUNDED: "Буцаасан",
};

/** Админы хүснэгтэд багтахаар богиносгосон хувилбар. */
export const PAYMENT_LABEL_SHORT: Record<PaymentState, string> = {
  ...PAYMENT_LABEL,
  PAID: "Төлсөн",
  OVERPAID: "Илүү",
};

export const PAYMENT_TONE: Record<PaymentState, Tone> = {
  UNPAID: "danger",
  PARTIAL: "warn",
  PAID: "ok",
  OVERPAID: "info",
  REFUNDED: "neutral",
};

/** Хэрэглэгчид харуулах тайлбар — юу хийхийг нь хэлнэ. */
export const PAYMENT_HINT: Record<PaymentState, string> = {
  UNPAID: "QPay-ээр төлнө үү.",
  PARTIAL: "Үлдэгдлийг QPay-ээр төлнө үү.",
  PAID: "Төлбөр бүрэн хүлээн авсан.",
  OVERPAID: "Илүү төлсөн дүнг буцаана. Бид тантай холбогдоно.",
  REFUNDED: "Төлбөрийг буцаасан.",
};

/** Захиалга мөнгө хүлээж байгаа эсэх. */
export const awaitingPayment = (state: PaymentState): boolean =>
  state === "UNPAID" || state === "PARTIAL";
