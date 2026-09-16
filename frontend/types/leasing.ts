export type LeasingPayKind = "NONE" | "FEE" | "PRINCIPAL" | "BALANCE";

export type LeasingPlanStepStatus = "paid" | "due_today" | "overdue" | "upcoming";

export interface LeasingPlanStep {
  kind: "FEE" | "INSTALLMENT";
  index: number;
  daysFromStart: number;
  dueDay: string;
  amount: number;
  paidAmount: number;
  remaining: number;
  status: LeasingPlanStepStatus;
  isLast: boolean;
}

export interface LeasingPayPlan {
  gaps: number[];
  totalDays: number;
  steps: LeasingPlanStep[];
  overdue: boolean;
  dueToday: boolean;
  nextAmount: number;
}

export interface LeasingFields {
  isLeasing: boolean;
  leasingFee: number;
  leasingFeePaid: boolean;
  leasingFeePaidAmount: number;
  leasingPrincipalPaid: number;
  leasingPrincipalDue: number;
  leasingDueAmount?: number;
  nextPayAmount: number;
  nextPayKind: LeasingPayKind;
  payPlan?: LeasingPayPlan | null;
}
