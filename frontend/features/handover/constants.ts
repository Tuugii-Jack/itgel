import type { HandoverCustomerItem } from "@/lib/types";

export const PAY_METHOD_KEY = "itgel.handover.payMethod";

export const ITEM_STATUS_LABEL: Record<HandoverCustomerItem["itemStatus"], string> = {
  waiting: "Хүлээж байна",
  arrived: "Ирсэн",
  handed_over: "Авсан",
  cancelled: "Цуцлагдсан",
};
