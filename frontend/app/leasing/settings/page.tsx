"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHead } from "@/components/admin/shared";
import { Button, Card, ErrorNote, Field, Input, Spinner, Textarea } from "@/components/ui";
import { leasingApi, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { fillLeasingCopy, leasingFeeOf, leasingRatePercent } from "@/lib/leasing";
import { useToast } from "@/lib/toast";
import type { LeasingSettings } from "@/lib/types";

type TierRow = { minAmount: string; ratePercent: string };

function tiersToRows(
  tiers: { minAmount: number; ratePercent: number }[],
): TierRow[] {
  return [...tiers]
    .sort((a, b) => b.minAmount - a.minAmount)
    .map((t) => ({
      minAmount: String(t.minAmount),
      ratePercent: String(t.ratePercent),
    }));
}

function parseRows(rows: TierRow[]): { minAmount: number; ratePercent: number }[] {
  return rows.map((row) => ({
    minAmount: Number(row.minAmount.replace(/\D/g, "")) || 0,
    ratePercent: Number(row.ratePercent.replace(",", ".")) || 0,
  }));
}

export default function LeasingSettingsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<LeasingSettings | null>(null);
  const [rows, setRows] = useState<TierRow[]>([]);
  const [choiceHint, setChoiceHint] = useState("");
  const [termsTitle, setTermsTitle] = useState("");
  const [termsBody, setTermsBody] = useState("");
  const [sample, setSample] = useState("350000");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await leasingApi.settings();
      setSettings(data);
      setRows(tiersToRows(data.feeTiers));
      setChoiceHint(data.choiceHint);
      setTermsTitle(data.termsTitle);
      setTermsBody(data.termsBody);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Ачаалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const previewTiers = useMemo(() => parseRows(rows), [rows]);
  const sampleAmount = Number(sample.replace(/\D/g, "")) || 0;
  const previewPercent = leasingRatePercent(sampleAmount, previewTiers);
  const previewFee = leasingFeeOf(sampleAmount, previewTiers);
  const previewHint = fillLeasingCopy(choiceHint, {
    percent: previewPercent,
    fee: previewFee,
    feeText: money(previewFee),
  });
  const previewBody = fillLeasingCopy(termsBody, {
    percent: previewPercent,
    fee: previewFee,
    feeText: money(previewFee),
  });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await leasingApi.updateSettings({
        feeTiers: parseRows(rows),
        choiceHint,
        termsTitle,
        termsBody,
      });
      setSettings(updated);
      setRows(tiersToRows(updated.feeTiers));
      setChoiceHint(updated.choiceHint);
      setTermsTitle(updated.termsTitle);
      setTermsBody(updated.termsBody);
      toast.success("Лизингийн тохиргоо хадгалагдлаа.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-muted" />
      </div>
    );
  }

  return (
    <div className="max-w-[720px]">
      <PageHead
        title="Лизингийн тохиргоо"
        hint="Шимтгэлийн хувь болон хэрэглэгчид харагдах нөхцөлийн бичвэр"
      />

      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-[15px] font-medium">Шимтгэлийн шатлал</div>
              <p className="mt-1 mb-0 text-[13px] text-ink-2">
                Барааны нийт үнэ энэ дүнгээс дээш бол (тухайн дүн орно) тухайн хувийг
                авна. 0₮-ийн мөр заавал байх ёстой.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRows(tiersToRows(settings.suggestedFeeTiers))}
              >
                Жишээ шатлал
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setRows((prev) => [{ minAmount: "", ratePercent: "" }, ...prev])
                }
              >
                Шатлал нэмэх
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_7rem_auto] gap-2 text-[12px] text-muted">
            <span>Доод дүн (₮)</span>
            <span>Хувь (%)</span>
            <span />
          </div>
          {rows.map((row, index) => {
            const min = Number(row.minAmount.replace(/\D/g, "")) || 0;
            const zeroRows = rows.filter(
              (r) => (Number(r.minAmount.replace(/\D/g, "")) || 0) === 0,
            ).length;
            const lastFloor = min === 0 && zeroRows <= 1;
            return (
              <div key={index} className="grid grid-cols-[1fr_7rem_auto] gap-2">
                <Input
                  value={row.minAmount}
                  onChange={(v) =>
                    setRows((prev) =>
                      prev.map((r, i) => (i === index ? { ...r, minAmount: v } : r)),
                    )
                  }
                  inputMode="numeric"
                  placeholder="500000"
                />
                <Input
                  value={row.ratePercent}
                  onChange={(v) =>
                    setRows((prev) =>
                      prev.map((r, i) => (i === index ? { ...r, ratePercent: v } : r)),
                    )
                  }
                  inputMode="decimal"
                  placeholder="15"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={lastFloor}
                  onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                >
                  Хасах
                </Button>
              </div>
            );
          })}

          <p className="m-0 text-[12px] text-muted">
            Жишээ: 500,000₮ → 11%, 400,000₮ → 12%, 200,000₮ хүртэл → 15%.
          </p>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="text-[15px] font-medium">Хэрэглэгчид харагдах бичвэр</div>
          <p className="m-0 text-[13px] text-ink-2">
            Сагсан дээрх хувийг <span className="font-medium text-ink">{"{percent}"}</span>,
            шимтгэлийн дүнг <span className="font-medium text-ink">{"{fee}"}</span> гэж бичнэ.
          </p>
          <Field label="Лизинг сонголтын тайлбар">
            <Textarea
              value={choiceHint}
              onChange={setChoiceHint}
              rows={3}
              resize="y"
            />
          </Field>
          <Field label="Нөхцөлийн гарчиг">
            <Input value={termsTitle} onChange={setTermsTitle} />
          </Field>
          <Field label="Нөхцөлийн дэлгэрэнгүй">
            <Textarea
              value={termsBody}
              onChange={setTermsBody}
              rows={6}
              resize="y"
              className="min-h-[140px]"
            />
          </Field>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="text-[15px] font-medium">Урьдчилан харах</div>
          <Field label="Жишээ барааны үнэ">
            <Input value={sample} onChange={setSample} inputMode="numeric" />
          </Field>
          <div className="rounded-[8px] border border-line bg-surface px-3 py-2.5 text-[13px] leading-[1.6] text-ink-2">
            <div className="mb-1 font-medium text-ink">Лизинг</div>
            {previewHint}
          </div>
          <div className="rounded-[8px] border border-line bg-surface px-3 py-2.5 text-[13px] leading-[1.6] text-ink-2">
            <div className="mb-1 font-medium text-ink">{termsTitle || "Лизингийн нөхцөл"}</div>
            {previewBody}
            <div className="mt-2 text-[12px] text-muted">
              {money(sampleAmount)} → {previewPercent}% · шимтгэл {money(previewFee)}
            </div>
          </div>
        </Card>

        {error && <ErrorNote>{error}</ErrorNote>}
        <div>
          <Button loading={busy} onClick={() => void save()}>
            Хадгалах
          </Button>
        </div>
      </div>
    </div>
  );
}
