export interface RevenueReport {
  period: "3m" | "6m" | "1y";
  series: {
    month: string;
    sold: number;
    returned: number;
    net: number;
    orders: number;
    soldQty: number;
    returnedQty: number;
  }[];
  totals: {
    sold: number;
    returned: number;
    net: number;
    orders: number;
    soldQty: number;
    returnedQty: number;
  };
}

export interface ProductReportRow {
  productId: string;
  name: string;
  category: string | null;
  soldQty: number;
  soldAmount: number;
  returnedQty: number;
  returnedAmount: number;
  netQty: number;
  netAmount: number;
  sellPrice: number;
}

export interface Settings {
  id: number;
  storeName: string;
  phone: string;
  address: string;
  workHours: string;
  facebookUrl: string;
  defaultLeadMinDays: number;
  defaultLeadMaxDays: number;
  smsOnArrival: boolean;
  autoCloseOnDeadline: boolean;
  deliveryFees: Record<string, number>;
  deliveryDailyLimit: number;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  paymentNote: string;
  /** Мөнгө ороогүй захиалгыг хэдэн цагийн дараа цуцлах. 0 = цуцлахгүй. */
  unpaidCancelHours: number;
  storageFreeDays: number;
  storageFeePerDay: number;
  updatedAt: string;
}

export interface LeasingSettings {
  feeTiers: { minAmount: number; ratePercent: number }[];
  suggestedFeeTiers: { minAmount: number; ratePercent: number }[];
  payGaps: number[];
  choiceHint: string;
  termsTitle: string;
  termsBody: string;
  smsDueToday: string;
  smsOverdue: string;
  smsArrivedUnpaid: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  paymentNote?: string;
  updatedAt: string;
}

/** Өөрчлөлтийн бүртгэл — GET /admin/settings/audit. */
export interface AuditLog {
  id: string;
  /** "admin:<id>" | "customer:<id>" | "system" */
  actor: string;
  /** CREATE | UPDATE | DELETE | STATUS_CHANGE | HANDOVER … */
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface AdminSummary {
  newOrders: number;
  /** Хэрэглэгч шилжүүлсэн гэж мэдэгдсэн ч мөнгө нь ороогүй захиалгын тоо. */
  paymentClaims: number;
  inTransit: number;
  arrived: number;
  pendingDeliveries: number;
  activeProducts: number;
}
