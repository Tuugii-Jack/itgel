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
import type { Settings } from "@/lib/types";

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
      </div>
    </div>
  );
}
