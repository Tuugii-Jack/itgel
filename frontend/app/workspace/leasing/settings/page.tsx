"use client";

import { deferEffect } from "@/lib/deferEffect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHead } from "@/components/admin/shared";
import { LeasingPaySchedule } from "@/components/LeasingPaySchedule";
import { Button, Card, ErrorNote, Field, Input, Spinner, Textarea } from "@/components/ui";
import { leasingApi, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import {
  DEFAULT_LEASING_PAY_GAPS,
  DEFAULT_LEASING_SMS_TEMPLATES,
  SMS_TEMPLATE_MAX,
  buildLeasingPayPlan,
  fillLeasingCopy,
  leasingFeeOf,
  leasingRatePercent,
} from "@/lib/leasing";
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
  const [smsDueToday, setSmsDueToday] = useState("");
  const [smsOverdue, setSmsOverdue] = useState("");
  const [smsArrivedUnpaid, setSmsArrivedUnpaid] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [gapInputs, setGapInputs] = useState<string[]>(["5", "8", "8"]);
  const [sample, setSample] = useState("350000");
  const [publicName, setPublicName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [chatUrl, setChatUrl] = useState("");
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
      setSmsDueToday(data.smsDueToday);
      setSmsOverdue(data.smsOverdue);
      setSmsArrivedUnpaid(data.smsArrivedUnpaid);
      setBankName(data.bankName ?? "");
      setBankAccountNumber(data.bankAccountNumber ?? "");
      setBankAccountName(data.bankAccountName ?? "");
      setPaymentNote(data.paymentNote ?? "");
      setGapInputs((data.payGaps?.length ? data.payGaps : DEFAULT_LEASING_PAY_GAPS).map(String));
      setPublicName(data.publicName ?? "");
      setContactPhone(data.contactPhone ?? "");
      setChatUrl(data.chatUrl ?? "");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Ачаалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => deferEffect(() => { void load(); }), [load]);

  const previewTiers = useMemo(() => parseRows(rows), [rows]);
  const previewGaps = useMemo(
    () => gapInputs.map((g) => Number(g.replace(/\D/g, "")) || 0),
    [gapInputs],
  );
  const sampleAmount = Number(sample.replace(/\D/g, "")) || 0;
  const previewPercent = leasingRatePercent(sampleAmount, previewTiers);
  const previewFee = leasingFeeOf(sampleAmount, previewTiers);
  const previewPlan = useMemo(
    () =>
      sampleAmount > 0 && previewGaps.every((n) => n >= 1)
        ? buildLeasingPayPlan({
            isLeasing: true,
            subtotal: sampleAmount,
            leasingFee: previewFee,
            paidAmount: 0,
            refundedAmount: 0,
            payGaps: previewGaps,
          })
        : null,
    [sampleAmount, previewFee, previewGaps],
  );
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
        payGaps: previewGaps,
        choiceHint,
        termsTitle,
        termsBody,
        smsDueToday,
        smsOverdue,
        smsArrivedUnpaid,
        bankName,
        bankAccountNumber,
        bankAccountName,
        paymentNote,
        publicName,
        contactPhone,
        chatUrl,
      });
      setSettings(updated);
      setRows(tiersToRows(updated.feeTiers));
      setChoiceHint(updated.choiceHint);
      setTermsTitle(updated.termsTitle);
      setTermsBody(updated.termsBody);
      setSmsDueToday(updated.smsDueToday);
      setSmsOverdue(updated.smsOverdue);
      setSmsArrivedUnpaid(updated.smsArrivedUnpaid);
      setBankName(updated.bankName ?? "");
      setBankAccountNumber(updated.bankAccountNumber ?? "");
      setBankAccountName(updated.bankAccountName ?? "");
      setPaymentNote(updated.paymentNote ?? "");
      setGapInputs(updated.payGaps.map(String));
      setPublicName(updated.publicName ?? "");
      setContactPhone(updated.contactPhone ?? "");
      setChatUrl(updated.chatUrl ?? "");
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
        hint="Шимтгэл, үндсэн төлбөрийн хоногийн зай, холбоо барих, SMS загвар"
      />

      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3 p-4">
          <div className="text-[15px] font-medium">Хэрэглэгчид харагдах холбоо барих</div>
          <p className="m-0 text-[13px] text-ink-2">
            Лизингээр авсан захиалга дээр харагдана. Дэлгүүрийн ерөнхий утас өөрчлөгдөхгүй.
          </p>
          <Field label="Харагдах нэр">
            <Input value={publicName} onChange={setPublicName} placeholder="Жишээ: Итгэл лизинг" />
          </Field>
          <Field label="Утас">
            <Input
              value={contactPhone}
              onChange={setContactPhone}
              inputMode="tel"
              placeholder="99112233"
            />
          </Field>
          <Field label="Чатын холбоос">
            <Input
              value={chatUrl}
              onChange={setChatUrl}
              placeholder="https://m.me/…"
            />
          </Field>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="text-[15px] font-medium">Итгэлд төлөх хариуцагч</div>
          {settings.settlementAdmin ? (
            <p className="m-0 text-[14px]">
              {settings.settlementAdmin.name}
              {" · "}
              {settings.settlementAdmin.email}
              {settings.settlementAdmin.isActive ? "" : " · идэвхгүй"}
            </p>
          ) : (
            <p className="m-0 text-[13px] text-ink-2">
              Үндсэн админ хариуцагч тохируулаагүй. Шимтгэл төлөгдсөн захиалга дээр Итгэлд
              төлөх өр автоматаар үүсэхгүй.
            </p>
          )}
        </Card>

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
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-[15px] font-medium">Үндсэн төлбөрийн хуваарь</div>
              <p className="mt-1 mb-0 text-[13px] text-ink-2">
                Бараа 14–25 хоногт ирдэг. Үндсэн 100%-ийг 2 эсвэл 3 хувааж, хоорондын
                хоногийн зайг энд тохируулна. Сүүлийн төлөлт бараа ирэх үетэй давхцана.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={gapInputs.length === 2 ? "primary" : "outline"}
                onClick={() =>
                  setGapInputs((prev) => [prev[0] || "10", prev[1] || "11"])
                }
              >
                2 хуваах
              </Button>
              <Button
                size="sm"
                variant={gapInputs.length === 3 ? "primary" : "outline"}
                onClick={() =>
                  setGapInputs((prev) => [
                    prev[0] || "5",
                    prev[1] || "8",
                    prev[2] || "8",
                  ])
                }
              >
                3 хуваах
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setGapInputs(DEFAULT_LEASING_PAY_GAPS.map(String))}
              >
                5, 8, 8
              </Button>
            </div>
          </div>
          <div
            className={`grid gap-2 ${gapInputs.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}
          >
            {gapInputs.map((value, index) => (
              <Field
                key={index}
                label={
                  index === gapInputs.length - 1
                    ? `${index + 1}-р зай · бараа ирэх`
                    : `${index + 1}-р зай (хоног)`
                }
              >
                <Input
                  value={value}
                  onChange={(v) =>
                    setGapInputs((prev) =>
                      prev.map((g, i) => (i === index ? v.replace(/\D/g, "") : g)),
                    )
                  }
                  inputMode="numeric"
                  placeholder="8"
                />
              </Field>
            ))}
          </div>
          <p className="m-0 text-[13px] text-ink-2">
            Нийт{" "}
            <span className="tnum font-medium text-ink">
              {previewGaps.reduce((a, b) => a + b, 0)}
            </span>{" "}
            хоног · {previewGaps.filter((n) => n > 0).join(" + ") || "—"} (7–90 хоног)
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
          <div className="text-[15px] font-medium">Сануулгын SMS</div>
          <p className="m-0 text-[13px] text-ink-2">
            {"{ner}"} нэр, {"{dun}"} дүн, {"{ognoo}"} огноо, {"{honog}"} хоног. Хоосон бол
            үндсэн бичвэр явна.
          </p>
          <SmsTemplateField
            label="Өнөөдөр төлөгдөөгүй"
            value={smsDueToday}
            onChange={setSmsDueToday}
            fallback={DEFAULT_LEASING_SMS_TEMPLATES.dueToday}
          />
          <SmsTemplateField
            label="Хуваарь хоцорсон"
            value={smsOverdue}
            onChange={setSmsOverdue}
            fallback={DEFAULT_LEASING_SMS_TEMPLATES.overdue}
          />
          <SmsTemplateField
            label="Ирсэн · төлөөгүй"
            value={smsArrivedUnpaid}
            onChange={setSmsArrivedUnpaid}
            fallback={DEFAULT_LEASING_SMS_TEMPLATES.arrivedUnpaid}
          />
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="text-[15px] font-medium">Шилжүүлгийн данс</div>
          <p className="m-0 text-[13px] text-ink-2">
            Лизингийн бэлэн борлуулалт болон хуваарьт төлбөрийн шилжүүлэг. Дэлгүүрийн данс руу буцахгүй.
          </p>
          <Field label="Банк">
            <Input value={bankName} onChange={setBankName} />
          </Field>
          <Field label="Дансны дугаар">
            <Input value={bankAccountNumber} onChange={setBankAccountNumber} />
          </Field>
          <Field label="Хүлээн авагч">
            <Input value={bankAccountName} onChange={setBankAccountName} />
          </Field>
          <Field label="Нэмэлт заавар">
            <Textarea value={paymentNote} onChange={setPaymentNote} rows={2} />
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
          {previewPlan && <LeasingPaySchedule plan={previewPlan} />}
        </Card>

        {error && <ErrorNote>{error}</ErrorNote>}
        <div>
          <Button
            loading={busy}
            disabled={
              smsDueToday.length > SMS_TEMPLATE_MAX ||
              smsOverdue.length > SMS_TEMPLATE_MAX ||
              smsArrivedUnpaid.length > SMS_TEMPLATE_MAX
            }
            onClick={() => void save()}
          >
            Хадгалах
          </Button>
        </div>
      </div>
    </div>
  );
}

function SmsTemplateField({
  label,
  value,
  onChange,
  fallback,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  fallback: string;
}) {
  const over = value.length > SMS_TEMPLATE_MAX;
  return (
    <Field label={label}>
      <Textarea value={value} onChange={onChange} rows={5} resize="y" className="min-h-[110px]" />
      <div className="mt-1 flex items-center justify-between gap-2 text-[12px]">
        <span className={`tnum ${over ? "text-danger" : "text-muted"}`}>
          {value.length}/{SMS_TEMPLATE_MAX}
        </span>
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 text-muted underline"
          onClick={() => onChange(fallback)}
        >
          Анхны бичвэр
        </button>
      </div>
    </Field>
  );
}
