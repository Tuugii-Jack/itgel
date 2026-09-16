"use client";

import { useEffect, useMemo, useState } from "react";
import { deferEffect } from "@/lib/deferEffect";
import { useOnKeyChange } from "@/lib/syncKey";
import { Button, Card, ErrorNote, Skeleton, Textarea } from "@/components/ui";
import { SmsPreviewDialog } from "@/components/leasing/SmsPreviewDialog";
import { leasingApi, ApiError } from "@/lib/api";
import { dayLabel, daysBetween, money, phoneLabel } from "@/lib/format";
import {
  SMS_TEMPLATE_MAX,
  defaultLeasingSmsTemplate,
  fillLeasingSmsTemplate,
} from "@/lib/leasing";
import { hasCustomizedSms, markCustomizedSms, smsTextsEqual } from "@/lib/smsEditOnce";
import { useToast } from "@/lib/toast";
import type { AdminOrderRow, LeasingSettings } from "@/lib/types";

export type ScheduleSmsKind = "due_today" | "overdue" | "arrived_unpaid";

const TITLE: Record<ScheduleSmsKind, string> = {
  due_today: "Өнөөдөр төлөх ёстой төлбөрийн сануулга",
  overdue: "Хоног хоцорсон төлбөрийн сануулга",
  arrived_unpaid: "Ирсэн · төлөөгүй сануулга",
};

function hasPhone(order: AdminOrderRow): boolean {
  return /^[5-9]\d{7}$/.test(order.customer.phone?.replace(/\D/g, "") ?? "");
}

function reminderAmount(order: AdminOrderRow, kind: ScheduleSmsKind): number {
  if (kind === "arrived_unpaid") return Math.max(0, order.dueAmount);
  const steps = order.payPlan?.steps ?? [];
  const status = kind === "due_today" ? "due_today" : "overdue";
  const sum = steps
    .filter((s) => s.status === status && s.remaining > 0)
    .reduce((n, s) => n + s.remaining, 0);
  return sum > 0 ? sum : Math.max(0, order.nextPayAmount ?? order.dueAmount);
}

function dueDateLabel(order: AdminOrderRow): string {
  const due = order.payPlan?.steps.find((s) => s.status === "due_today")?.dueDay;
  if (!due) return dayLabel(new Date());
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due);
  return m ? `${Number(m[2])}-р сарын ${Number(m[3])}` : due;
}

function overdueDaysOf(order: AdminOrderRow): number {
  const steps = (order.payPlan?.steps ?? []).filter(
    (s) => s.status === "overdue" && s.remaining > 0,
  );
  if (steps.length === 0) return 1;
  return Math.max(
    1,
    ...steps.map((s) =>
      Math.max(1, -daysBetween(`${s.dueDay}T12:00:00+08:00`)),
    ),
  );
}

function customerName(order: AdminOrderRow): string {
  return order.customer.name?.trim() || "харилцагч";
}

function templateFromSettings(
  kind: ScheduleSmsKind,
  settings: LeasingSettings | null,
): string {
  if (!settings) return defaultLeasingSmsTemplate(kind);
  if (kind === "due_today") return settings.smsDueToday;
  if (kind === "overdue") return settings.smsOverdue;
  return settings.smsArrivedUnpaid;
}

function settingsPatchOf(kind: ScheduleSmsKind, template: string) {
  if (kind === "due_today") return { smsDueToday: template };
  if (kind === "overdue") return { smsOverdue: template };
  return { smsArrivedUnpaid: template };
}

function smsPreview(template: string, kind: ScheduleSmsKind, order: AdminOrderRow): string {
  return fillLeasingSmsTemplate(template, {
    ner: customerName(order),
    dun: reminderAmount(order, kind),
    ognoo: dueDateLabel(order),
    honog: overdueDaysOf(order),
  });
}

export function LeasingScheduleSms({
  kind,
  orders,
  loading,
  emptyText,
  onOpenOrder,
}: {
  kind: ScheduleSmsKind;
  orders: AdminOrderRow[];
  loading: boolean;
  emptyText: string;
  onOpenOrder: (id: string) => void;
}) {
  const toast = useToast();
  const sendable = useMemo(() => orders.filter(hasPhone), [orders]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sendable.map((o) => o.id)));
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [smsTick, setSmsTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState(() => defaultLeasingSmsTemplate(kind));
  const [savedTemplate, setSavedTemplate] = useState(() => defaultLeasingSmsTemplate(kind));
  const [templateLoading, setTemplateLoading] = useState(true);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const sendableIds = sendable.map((o) => o.id).join(",");
  useOnKeyChange(sendableIds, () => {
    setSelected(new Set(sendable.map((o) => o.id)));
  });

  useEffect(() => {
    let cancelled = false;
    const stop = deferEffect(() => {
      setTemplateLoading(true);
      leasingApi
        .settings()
        .then((settings) => {
          if (cancelled) return;
          const next = templateFromSettings(kind, settings);
          setTemplate(next);
          setSavedTemplate(next);
        })
        .catch(() => {
          if (cancelled) return;
          const next = defaultLeasingSmsTemplate(kind);
          setTemplate(next);
          setSavedTemplate(next);
        })
        .finally(() => {
          if (!cancelled) setTemplateLoading(false);
        });
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [kind]);

  useOnKeyChange(kind, () => {
    setPreviewId(null);
    setOverrides({});
  });

  const selectedCount = sendable.filter((o) => selected.has(o.id)).length;
  const allOn = sendable.length > 0 && selectedCount === sendable.length;
  const overLimit = template.length > SMS_TEMPLATE_MAX;
  const dirty = template.trim() !== savedTemplate.trim();
  const sendTemplate = template.trim() || defaultLeasingSmsTemplate(kind);
  const previewOrder = orders.find((order) => order.id === previewId) ?? null;

  const toggle = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const saveTemplate = async () => {
    if (overLimit || savingTemplate) return;
    setSavingTemplate(true);
    setError(null);
    try {
      const updated = await leasingApi.updateSettings(settingsPatchOf(kind, template.trim()));
      const next = templateFromSettings(kind, updated);
      setTemplate(next);
      setSavedTemplate(next);
      toast.success("Мессежийн загвар хадгалагдлаа.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setSavingTemplate(false);
    }
  };

  const send = async () => {
    const orderIds = sendable.filter((o) => selected.has(o.id)).map((o) => o.id);
    if (orderIds.length === 0 || busy || overLimit) return;
    setBusy(true);
    setError(null);
    try {
      const result = await leasingApi.sendScheduleSms(
        kind,
        orderIds,
        sendTemplate,
        orderIds
          .map((id) => {
            const order = sendable.find((row) => row.id === id);
            const text = overrides[id];
            if (!order || !text || hasCustomizedSms(order.customer.id)) return null;
            const def = smsPreview(sendTemplate, kind, order);
            if (smsTextsEqual(text, def)) return null;
            return { orderId: id, text };
          })
          .filter((row): row is { orderId: string; text: string } => row !== null),
      );
      setSavedTemplate(sendTemplate);
      setTemplate(sendTemplate);
      const fail = result.failed.length;
      if (fail > 0) {
        setError(
          `${result.sent} илгээлээ, ${result.skipped} алгассан, ${fail} алдаа: ${result.failed
            .map((f) => `${f.code}: ${f.error}`)
            .join(" · ")}`,
        );
        toast.error("Зарим SMS илгээгдсэнгүй.");
      } else {
        toast.success(
          result.skipped > 0
            ? `${result.sent} илгээлээ, ${result.skipped} алгаслаа.`
            : `${result.sent} дугаар руу илгээлээ.`,
        );
      }
      const failedIds = new Set(result.failed.map((f) => f.orderId));
      for (const id of orderIds) {
        if (failedIds.has(id)) continue;
        const order = sendable.find((row) => row.id === id);
        const text = overrides[id];
        if (!order || !text) continue;
        const def = smsPreview(sendTemplate, kind, order);
        if (smsTextsEqual(text, def) || hasCustomizedSms(order.customer.id)) continue;
        markCustomizedSms(order.customer.id);
      }
      setSmsTick((n) => n + 1);
      setOverrides({});
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of orderIds) {
          if (!failedIds.has(id)) next.delete(id);
        }
        return next;
      });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "SMS илгээж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] lg:items-start">
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={allOn}
              disabled={sendable.length === 0}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(sendable.map((o) => o.id)) : new Set())
              }
            />
            <span className="text-[14px] font-medium">{TITLE[kind]}</span>
          </label>
          <span className="tnum shrink-0 text-[13px] text-muted">
            {selectedCount}/{sendable.length} дугаар
          </span>
        </div>
        {sendable.length > 0 && (
          <div className="border-b border-line px-4 py-2 text-[12px] text-muted">
            Бүгд сонгогдсон. Илгээхгүй дугаарын тэмдэглэгээг авна уу.
          </div>
        )}
        {loading && orders.length === 0 ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-[8px]" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="px-4 py-12 text-center text-[15px] text-ink-2">{emptyText}</div>
        ) : (
          <ul className="max-h-[min(70vh,560px)] overflow-y-auto">
            {orders.map((order) => {
              const phone = hasPhone(order);
              const checked = phone && selected.has(order.id);
              const customized = hasCustomizedSms(order.customer.id);
              const hasOverride = Boolean(overrides[order.id]) && !customized;
              return (
                <li key={order.id} className="border-b border-line last:border-b-0">
                  <div
                    className={`flex items-start gap-3 px-4 py-3 ${
                      phone ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                    } ${checked ? "bg-surface" : ""}`}
                    onClick={() => phone && toggle(order.id, !checked)}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0 accent-primary"
                      checked={checked}
                      disabled={!phone}
                      onChange={(e) => toggle(order.id, e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <div className="tnum min-w-0 flex-1 text-[15px] font-medium tracking-[-0.02em]">
                          {phone ? phoneLabel(order.customer.phone) : "Дугаар алга"}
                        </div>
                        <button
                          type="button"
                          disabled={!phone}
                          className="h-8 shrink-0 cursor-pointer rounded-[8px] border border-line bg-bg px-2.5 text-[12px] text-ink-2 hover:border-primary-muted hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (phone) setPreviewId(order.id);
                          }}
                        >
                          Харах
                        </button>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink-2">
                        <span className="truncate">{order.customer.name ?? "Нэргүй"}</span>
                        <button
                          type="button"
                          className="tnum cursor-pointer border-0 bg-transparent p-0 text-muted underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenOrder(order.id);
                          }}
                        >
                          {order.code}
                        </button>
                        <span className="tnum ml-auto text-ink">
                          {money(reminderAmount(order, kind))}
                        </span>
                      </div>
                      {hasOverride && (
                        <div className="mt-1 text-[12px] text-muted">Энэ удаад зассан мессеж явна.</div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {orders.length > sendable.length && (
          <div className="border-t border-line px-4 py-2 text-[12px] text-muted">
            Дугааргүй {orders.length - sendable.length} захиалгыг алгасна.
          </div>
        )}
      </Card>

      <Card className="sticky bottom-3 z-20 p-4 lg:top-4 lg:bottom-auto">
        <div className="text-[13px] font-medium">Мессеж</div>
        <p className="mt-1 text-[12px] text-muted">
          {"{ner}"} нэр, {"{dun}"} дүн, {"{ognoo}"} огноо, {"{honog}"} хоног. Хүссэнээрээ засаарай.
        </p>
        {templateLoading ? (
          <Skeleton className="mt-2 h-36 w-full rounded-[8px]" />
        ) : (
          <Textarea
            value={template}
            onChange={setTemplate}
            rows={7}
            resize="y"
            className="mt-2 min-h-[140px] text-[13px] leading-[1.55]"
          />
        )}
        <div className="mt-1 flex items-center justify-between gap-2 text-[12px]">
          <span className={`tnum ${overLimit ? "text-danger" : "text-muted"}`}>
            {template.length}/{SMS_TEMPLATE_MAX}
          </span>
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-muted underline"
            onClick={() => setTemplate(defaultLeasingSmsTemplate(kind))}
          >
            Анхны бичвэр
          </button>
        </div>
        <Button
          variant="outline"
          full
          className="mt-3"
          loading={savingTemplate}
          disabled={!dirty || overLimit || templateLoading}
          onClick={() => void saveTemplate()}
        >
          Загвар хадгалах
        </Button>
        {error && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        <Button
          full
          className="mt-3"
          loading={busy}
          disabled={selectedCount === 0 || overLimit || templateLoading}
          onClick={() => void send()}
        >
          {selectedCount} дугаар руу илгээх
        </Button>
      </Card>

      {previewOrder && (
        <SmsPreviewDialog
          key={`${previewOrder.id}-${smsTick}`}
          title="Явуулах SMS"
          name={previewOrder.customer.name}
          phone={previewOrder.customer.phone}
          defaultText={
            !hasCustomizedSms(previewOrder.customer.id) && overrides[previewOrder.id]
              ? overrides[previewOrder.id]!
              : smsPreview(sendTemplate, kind, previewOrder)
          }
          canEdit={!hasCustomizedSms(previewOrder.customer.id)}
          confirmLabel={hasCustomizedSms(previewOrder.customer.id) ? "Хаах" : "Тохируулах"}
          onClose={() => setPreviewId(null)}
          onConfirm={(text) => {
            if (hasCustomizedSms(previewOrder.customer.id)) {
              setPreviewId(null);
              return;
            }
            const def = smsPreview(sendTemplate, kind, previewOrder);
            setOverrides((prev) => {
              const next = { ...prev };
              if (smsTextsEqual(text, def)) delete next[previewOrder.id];
              else next[previewOrder.id] = text;
              return next;
            });
            setPreviewId(null);
          }}
        />
      )}
    </div>
  );
}
