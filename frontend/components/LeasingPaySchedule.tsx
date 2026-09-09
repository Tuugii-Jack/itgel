"use client";

import { dayLabel, money } from "@/lib/format";
import {
  leasingStepStatusLabel,
  leasingStepTitle,
  leasingStepWhen,
} from "@/lib/leasing";
import type { LeasingPayPlan, LeasingPlanStepStatus } from "@/lib/types";

/**
 * Хэрэглэгчид: одоо шимтгэл, дараа нь 2–3 хуваарь, сүүлчийнх бараа ирэх үе.
 */
export function LeasingPaySchedule({
  plan,
  compact,
  title = "Төлөлтийн хуваарь",
}: {
  plan: LeasingPayPlan;
  compact?: boolean;
  title?: string;
}) {
  const installments = plan.steps.filter((s) => s.kind === "INSTALLMENT").length;
  const alert = plan.overdue ? "overdue" : plan.dueToday ? "due_today" : null;

  return (
    <div
      className={`rounded-[8px] border px-3 py-2.5 ${
        alert === "overdue"
          ? "border-danger bg-danger-bg"
          : alert === "due_today"
            ? "border-warn bg-warn-bg"
            : "border-line bg-surface"
      }`}
    >
      <div className="mb-1 font-medium text-ink">{title}</div>
      {!compact && (
        <p className="mt-0 mb-2.5 text-[12px] leading-[1.5] text-ink-2">
          Үндсэн төлбөрийг {installments} хувааж төлнө. Сүүлийн төлөлт ойролцоогоор{" "}
          {plan.totalDays} хоногийн дараа — бараа ирэх үе.
        </p>
      )}
      <ol className="m-0 flex list-none flex-col gap-0 p-0">
        {plan.steps.map((step, i) => {
          const last = i === plan.steps.length - 1;
          return (
            <li key={`${step.kind}-${step.index}`} className="flex gap-2.5">
              <div className="flex w-3.5 shrink-0 flex-col items-center">
                <span
                  className={`mt-1 h-2.5 w-2.5 rounded-full ${dotClass(step.status)}`}
                />
                {!last && <span className="mt-0.5 w-px flex-1 bg-line" />}
              </div>
              <div className={`min-w-0 flex-1 ${last ? "pb-0" : "pb-3"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium text-ink">
                    {leasingStepWhen(step)}
                  </span>
                  <span className="tnum text-[13px] font-medium text-ink">
                    {money(step.remaining > 0 ? step.remaining : step.amount)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-2">
                  <span>{leasingStepTitle(step, installments)}</span>
                  {step.status !== "upcoming" && (
                    <span className={statusClass(step.status)}>
                      {leasingStepStatusLabel(step.status)}
                    </span>
                  )}
                  {step.daysFromStart > 0 && (
                    <span className="text-muted">{dayLabel(`${step.dueDay}T12:00:00+08:00`)}</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function dotClass(status: LeasingPlanStepStatus): string {
  if (status === "paid") return "bg-ok";
  if (status === "due_today") return "bg-warn";
  if (status === "overdue") return "bg-danger";
  return "bg-line";
}

function statusClass(status: LeasingPlanStepStatus): string {
  if (status === "paid") return "text-ok";
  if (status === "due_today") return "font-medium text-warn";
  if (status === "overdue") return "font-medium text-danger";
  return "text-muted";
}
