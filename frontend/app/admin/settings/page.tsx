"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHead } from "@/components/admin/shared";
import {
  Button,
  Card,
  Divider,
  ErrorNote,
  Field,
  Input,
  Spinner,
  Textarea,
  Toggle,
} from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayTimeLabel } from "@/lib/format";
import type { AuditLog, Settings } from "@/lib/types";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [fees, setFees] = useState<[string, string][]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi.settings();
      setSettings(data);
      setFees(Object.entries(data.deliveryFees ?? {}).map(([k, v]) => [k, String(v)]));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !settings) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-muted" />
      </div>
    );
  }

  const patch = (changes: Partial<Settings>) =>
    setSettings((prev) => (prev ? { ...prev, ...changes } : prev));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const deliveryFees: Record<string, number> = {};
      for (const [district, fee] of fees) {
        const name = district.trim();
        const value = Number(fee);
        if (name && Number.isFinite(value) && value >= 0) deliveryFees[name] = Math.trunc(value);
      }
      const updated = await adminApi.updateSettings({
        storeName: settings.storeName,
        phone: settings.phone,
        address: settings.address,
        workHours: settings.workHours,
        facebookUrl: settings.facebookUrl,
        defaultLeadMinDays: settings.defaultLeadMinDays,
        defaultLeadMaxDays: settings.defaultLeadMaxDays,
        smsOnArrival: settings.smsOnArrival,
        autoCloseOnDeadline: settings.autoCloseOnDeadline,
        deliveryDailyLimit: settings.deliveryDailyLimit,
        deliveryFees,
        bankName: settings.bankName,
        bankAccountNumber: settings.bankAccountNumber,
        bankAccountName: settings.bankAccountName,
        paymentNote: settings.paymentNote,
        unpaidCancelHours: settings.unpaidCancelHours,
      });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Хадгалж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[760px]">
      <PageHead title="Тохиргоо" hint="Дэлгүүрийн мэдээлэл, төлбөр, хүргэлт" />

      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3 p-4">
          <div className="text-[15px] font-medium">Дэлгүүр</div>
          <Field label="Нэр">
            <Input value={settings.storeName} onChange={(v) => patch({ storeName: v })} />
          </Field>
          <Field label="Утас">
            <Input value={settings.phone} onChange={(v) => patch({ phone: v })} />
          </Field>
          <Field label="Хаяг">
            <Textarea
              value={settings.address}
              onChange={(v) => patch({ address: v })}
              rows={2}
            />
          </Field>
          <Field label="Ажлын цаг">
            <Input value={settings.workHours} onChange={(v) => patch({ workHours: v })} />
          </Field>
          <Field label="Facebook">
            <Input value={settings.facebookUrl} onChange={(v) => patch({ facebookUrl: v })} />
          </Field>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="text-[15px] font-medium">Хугацаа</div>
          <p className="m-0 text-[13px] text-ink-2">
            Төлбөр үргэлж 100% — захиалга өгөхөд барааны дүнг бүтнээр шилжүүлнэ.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Хамгийн бага хоног">
              <Input
                value={String(settings.defaultLeadMinDays)}
                onChange={(v) =>
                  patch({ defaultLeadMinDays: Number(v.replace(/\D/g, "")) || 0 })
                }
                inputMode="numeric"
              />
            </Field>
            <Field label="Хамгийн их хоног">
              <Input
                value={String(settings.defaultLeadMaxDays)}
                onChange={(v) =>
                  patch({ defaultLeadMaxDays: Number(v.replace(/\D/g, "")) || 0 })
                }
                inputMode="numeric"
              />
            </Field>
          </div>
          <p className="m-0 text-[12px] text-muted">
            Шинэ бараа үүсгэхэд эдгээр утга анхдагчаар орно.
          </p>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div>
            <div className="text-[15px] font-medium">Төлбөр хүлээн авах данс</div>
            <p className="mt-1 mb-0 text-[13px] text-ink-2">
              Захиалга өгсний дараа хэрэглэгчид энэ мэдээлэл харагдана. Дансны дугаар
              хоосон бол данс огт харуулахгүй, оронд нь дэлгүүрийн утас гарна.
            </p>
          </div>
          <Field label="Банк">
            <Input
              value={settings.bankName}
              onChange={(v) => patch({ bankName: v })}
              placeholder="Хаан банк"
            />
          </Field>
          <Field label="Дансны дугаар">
            <Input
              value={settings.bankAccountNumber}
              onChange={(v) => patch({ bankAccountNumber: v })}
              placeholder="5019447288"
            />
          </Field>
          <Field label="Хүлээн авагч">
            <Input
              value={settings.bankAccountName}
              onChange={(v) => patch({ bankAccountName: v })}
              placeholder="Б. Сарангэрэл"
            />
          </Field>
          <Field label="Нэмэлт заавар" hint="Дансны доор гарах чөлөөт текст (заавал биш)">
            <Textarea
              value={settings.paymentNote}
              onChange={(v) => patch({ paymentNote: v })}
              rows={2}
            />
          </Field>
          <Field
            label="Төлбөр хүлээх хугацаа (цаг)"
            hint="Мөнгө ороогүй захиалгыг автоматаар цуцлана. 0 = цуцлахгүй. Шилжүүлсэн гэж мэдэгдсэн захиалгыг хөндөхгүй."
          >
            <Input
              type="number"
              value={String(settings.unpaidCancelHours)}
              onChange={(v) => patch({ unpaidCancelHours: Number(v) || 0 })}
            />
          </Field>
        </Card>

        <Card className="flex flex-col gap-2 p-4">
          <div className="text-[15px] font-medium">Автомат үйлдэл</div>
          <Toggle
            label="Захиалга ирэхэд SMS илгээх"
            hint="Захиалга агуулахад ирмэгц захиалагч руу мессеж"
            checked={settings.smsOnArrival}
            onChange={(v) => patch({ smsOnArrival: v })}
          />
          <Divider />
          <Toggle
            label="Хугацаа дуусахад захиалга хаах"
            hint="closeAt хүрсэн барааг өдөрт нэг удаа CLOSED болгоно"
            checked={settings.autoCloseOnDeadline}
            onChange={(v) => patch({ autoCloseOnDeadline: v })}
          />
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[15px] font-medium">Хүргэлтийн хураамж</div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFees((prev) => [...prev, ["", "5000"]])}
            >
              Дүүрэг нэмэх
            </Button>
          </div>

          <Field label="Өдрийн багтаамж" hint="Нэг өдөрт хэдэн хүргэлт авах вэ">
            <Input
              value={String(settings.deliveryDailyLimit)}
              onChange={(v) =>
                patch({ deliveryDailyLimit: Number(v.replace(/\D/g, "")) || 1 })
              }
              inputMode="numeric"
            />
          </Field>

          <div className="flex flex-col gap-2">
            {fees.map(([district, fee], index) => (
              <div key={index} className="flex gap-2">
                <div className="flex-1">
                  <Input
                    value={district}
                    onChange={(v) =>
                      setFees((prev) =>
                        prev.map((row, i) => (i === index ? [v, row[1]] : row)),
                      )
                    }
                    placeholder="Дүүрэг"
                  />
                </div>
                <div className="w-[120px]">
                  <Input
                    value={fee}
                    onChange={(v) =>
                      setFees((prev) =>
                        prev.map((row, i) =>
                          i === index ? [row[0], v.replace(/\D/g, "")] : row,
                        ),
                      )
                    }
                    inputMode="numeric"
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setFees((prev) => prev.filter((_, i) => i !== index))}
                >
                  Хасах
                </Button>
              </div>
            ))}
          </div>
        </Card>

        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="sticky bottom-4">
          <Button full size="lg" onClick={save} loading={busy}>
            {saved ? "Хадгалсан" : "Хадгалах"}
          </Button>
        </div>

        <AuditTrail />
      </div>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  CREATE: "Үүсгэсэн",
  UPDATE: "Зассан",
  DELETE: "Устгасан",
  STATUS_CHANGE: "Төлөв сольсон",
  HANDOVER: "Хүлээлгэн өгсөн",
  PAYMENT: "Төлбөр бүртгэсэн",
  REFUND: "Буцаалт хийсэн",
  ITEM_CANCEL: "Мөр цуцалсан",
  STALE_ORDERS_REPORT: "Удаан хүлээсэн захиалгын тайлан",
};

const ENTITY_LABEL: Record<string, string> = {
  Order: "Захиалга",
  Product: "Бараа",
  Category: "Ангилал",
  Batch: "Багц",
  Setting: "Тохиргоо",
  Ad: "Сурталчилгаа",
  Delivery: "Хүргэлт",
  Payment: "Төлбөр",
};

/** Хэн юу өөрчилснийг хардаг хэсэг — GET /admin/settings/audit. */
function AuditTrail() {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setLogs(await adminApi.audit({ limit: 50 }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !logs) void load();
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[15px] font-medium">Өөрчлөлтийн түүх</div>
          <div className="text-[13px] text-muted">Хэн юуг хэзээ өөрчилсөн</div>
        </div>
        <Button size="sm" variant="outline" onClick={toggle} loading={loading}>
          {open ? "Хаах" : "Харах"}
        </Button>
      </div>

      {open && (
        <>
          <Divider className="my-3" />
          {error ? (
            <ErrorNote>{error}</ErrorNote>
          ) : !logs || logs.length === 0 ? (
            <p className="m-0 text-[13px] text-muted">
              {loading ? "Ачаалж байна…" : "Бичилт алга."}
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5 text-[13px]"
                >
                  <span>
                    {ACTION_LABEL[log.action] ?? log.action}
                    {" · "}
                    <span className="text-ink-2">
                      {ENTITY_LABEL[log.entity] ?? log.entity}
                    </span>
                  </span>
                  <span className="tnum text-muted">
                    {actorLabel(log.actor)} · {dayTimeLabel(log.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** "admin:<id>" гэх мэт мөрийг уншихад ойлгомжтой болгоно. */
function actorLabel(actor: string): string {
  if (actor === "system") return "Систем";
  if (actor.startsWith("admin:")) return "Админ";
  if (actor.startsWith("customer:")) return "Хэрэглэгч";
  return actor;
}
