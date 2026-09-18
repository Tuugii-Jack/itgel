"use client";

import { deferEffect } from "@/lib/deferEffect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Metric, PageHead, Table, Td, Th } from "@/components/admin/shared";
import { Qr } from "@/components/Qr";
import { Button, Card, Empty, ErrorNote, Field, Input, Skeleton } from "@/components/ui";
import { leasingApi, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { useToast } from "@/lib/toast";

function ubToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ulaanbaatar" }).format(new Date());
}

type Summary = Awaited<ReturnType<typeof leasingApi.itgelSummary>>;
type Invoice = NonNullable<Awaited<ReturnType<typeof leasingApi.itgelPay>>["invoice"]>;

export default function LeasingItgelPage() {
  const toast = useToast();
  const [day, setDay] = useState(ubToday);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [bankOpen, setBankOpen] = useState(false);
  const [bankRef, setBankRef] = useState("");
  const [bankDate, setBankDate] = useState(ubToday);
  const [receiptUrl, setReceiptUrl] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [payments, setPayments] = useState<Awaited<ReturnType<typeof leasingApi.itgelPayments>>>([]);

  const load = useCallback(async () => {
    try {
      const data = await leasingApi.itgelSummary(day);
      setSummary(data);
      setSelected(new Set(data.unpaidTodayIds));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, [day]);

  useEffect(() => deferEffect(() => { void load(); }), [load]);

  const selectedAmount = useMemo(() => {
    if (!summary) return 0;
    return summary.lines
      .filter((line) => selected.has(line.id) && line.status === "OPEN")
      .reduce((sum, line) => sum + line.remainingAmount, 0);
  }, [summary, selected]);

  const pay = async (method: "QPAY" | "BANK_TRANSFER", ids: string[]) => {
    if (ids.length === 0) {
      toast.error("Тооцоо сонгоно уу.");
      return;
    }
    setBusy(true);
    try {
      const result = await leasingApi.itgelPay({
        settlementIds: ids,
        method,
        bankRef: method === "BANK_TRANSFER" ? bankRef : undefined,
        bankDate: method === "BANK_TRANSFER" ? bankDate : undefined,
        receiptUrl: method === "BANK_TRANSFER" && receiptUrl ? receiptUrl : undefined,
      });
      setPaymentId(result.payment.id);
      setInvoice(result.invoice);
      setBankOpen(false);
      toast.success(method === "QPAY" ? "QPay нэхэмжлэл үүслээ." : "Шилжүүлэг бүртгэгдлээ. Үндсэн админ батална.");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Төлбөр үүсгэж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!paymentId) return;
    setBusy(true);
    try {
      const st = await leasingApi.itgelVerify(paymentId);
      if (st.status === "CONFIRMED") {
        toast.success("Итгэлд төлөгдлөө.");
        setInvoice(null);
        setPaymentId(null);
      } else {
        toast.error("Төлбөр хараахан ороогүй байна.");
      }
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Шалгаж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async (id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
    if (payments.length === 0) {
      try {
        setPayments(await leasingApi.itgelPayments());
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <div>
      <PageHead
        title="Итгэлд төлөх"
        hint="Хэрэглэгчийн хэсэгчилсэн төлөлт энэ дүнг бууруулахгүй. Зөвхөн барааны бүтэн үнэ."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Өдөр (Улаанбаатар)
          <Input type="date" value={day} onChange={setDay} className="w-44" />
        </label>
      </div>
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {loading || !summary ? (
        <Skeleton className="h-40 w-full rounded-[12px]" />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Өнөөдрийн захиалга" value={summary.orderCount} />
            <Metric label="Барааны нийт дүн" value={money(summary.amount)} />
            <Metric label="Итгэлд төлсөн" value={money(summary.paidAmount)} tone="ok" />
            <Metric label="Шилжүүлэх үлдэгдэл" value={money(summary.remainingAmount)} tone="warn" />
          </div>
          {summary.priorUnpaidAmount > 0 && (
            <div className="mb-4 rounded-[8px] border border-line bg-surface px-4 py-3 text-[14px]">
              Өмнөх өдрийн төлөөгүй үлдэгдэл:{" "}
              <span className="tnum font-medium">{money(summary.priorUnpaidAmount)}</span>
              {summary.priorUnpaidCount > 0 ? ` · ${summary.priorUnpaidCount} мөр` : ""}
            </div>
          )}
          <div className="mb-4 flex flex-wrap gap-2">
            <Button
              loading={busy}
              disabled={summary.unpaidTodayIds.length === 0}
              className="w-full sm:w-auto"
              onClick={() => void pay("QPAY", summary.unpaidTodayIds)}
            >
              Өнөөдрийн үлдэгдлийг төлөх
            </Button>
            <Button
              variant="outline"
              loading={busy}
              disabled={selectedAmount <= 0}
              className="w-full sm:w-auto"
              onClick={() => void pay("QPAY", [...selected])}
            >
              Сонгосоноо QPay-ээр төлөх · {money(selectedAmount)}
            </Button>
            <Button
              variant="outline"
              disabled={selectedAmount <= 0}
              className="w-full sm:w-auto"
              onClick={() => setBankOpen(true)}
            >
              Дансаар мэдэгдэх
            </Button>
          </div>
          {invoice && (
            <Card className="mb-4 flex flex-col items-center gap-3 p-4">
              <div className="text-[15px] font-medium">Итгэлд төлөх QPay · {money(invoice.amount)}</div>
              {invoice.qrImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={
                    invoice.qrImage.startsWith("data:")
                      ? invoice.qrImage
                      : `data:image/png;base64,${invoice.qrImage}`
                  }
                  alt="QPay"
                  width={180}
                  height={180}
                  className="rounded-[8px] border border-line bg-white p-2"
                />
              ) : invoice.qrText ? (
                <Qr value={invoice.qrText} size={160} />
              ) : null}
              <Button variant="outline" loading={busy} onClick={() => void verify()}>
                Төлбөр шалгах
              </Button>
            </Card>
          )}
          {bankOpen && (
            <Card className="mb-4 flex max-w-[480px] flex-col gap-3 p-4">
              <div className="text-[15px] font-medium">Дансаар шилжүүлсэн</div>
              <p className="m-0 text-[13px] text-ink-2">
                Баримт оруулсан төдийд өр хаагдахгүй. Үндсэн админ батална. Дүн: {money(selectedAmount)}
              </p>
              <Field label="Гүйлгээний лавлагаа">
                <Input value={bankRef} onChange={setBankRef} />
              </Field>
              <Field label="Огноо">
                <Input type="date" value={bankDate} onChange={setBankDate} />
              </Field>
              <Field label="Баримтын холбоос (заавал биш)">
                <Input value={receiptUrl} onChange={setReceiptUrl} placeholder="https://" />
              </Field>
              <div className="flex gap-2">
                <Button
                  loading={busy}
                  disabled={!bankRef.trim()}
                  onClick={() => void pay("BANK_TRANSFER", [...selected])}
                >
                  Мэдэгдэх
                </Button>
                <Button variant="ghost" onClick={() => setBankOpen(false)}>
                  Болих
                </Button>
              </div>
            </Card>
          )}
          {summary.lines.length === 0 ? (
            <Empty>Энэ өдөр баталгаажсан лизингийн борлуулалт алга.</Empty>
          ) : (
            <Card className="overflow-x-auto p-0">
              <Table>
                <thead>
                  <tr>
                    <Th />
                    <Th>Хэрэглэгч</Th>
                    <Th>Захиалга</Th>
                    <Th>Бараа</Th>
                    <Th>Тоо</Th>
                    <Th>Итгэлд</Th>
                    <Th>Төлөв</Th>
                  </tr>
                </thead>
                <tbody>
                  {summary.lines.map((line) => (
                    <tr key={line.id}>
                      <Td>
                        {line.status === "OPEN" ? (
                          <input
                            type="checkbox"
                            className="h-5 w-5"
                            checked={selected.has(line.id)}
                            onChange={() =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(line.id)) next.delete(line.id);
                                else next.add(line.id);
                                return next;
                              })
                            }
                          />
                        ) : null}
                      </Td>
                      <Td>{line.customerName}</Td>
                      <Td className="tnum">{line.orderCode}</Td>
                      <Td>{line.productName}</Td>
                      <Td className="tnum">{line.qty}</Td>
                      <Td className="tnum">{money(line.amount)}</Td>
                      <Td>
                        <button
                          type="button"
                          className="cursor-pointer border-0 bg-transparent p-0 text-left text-[13px] underline"
                          onClick={() => void openHistory(line.id)}
                        >
                          {line.statusLabel}
                        </button>
                        {openId === line.id && (
                          <div className="mt-1 text-[12px] text-ink-2">
                            Төлсөн {money(line.paidAmount)} · үлдэгдэл {money(line.remainingAmount)}
                            {payments
                              .filter((p) => p.lines.some((l) => l.settlement.id === line.id))
                              .map((p) => (
                                <div key={p.id}>
                                  {p.method === "QPAY" ? "QPay" : "Данс"} · {money(p.amount)} ·{" "}
                                  {p.status}
                                  {p.bankRef ? ` · ${p.bankRef}` : ""}
                                </div>
                              ))}
                          </div>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
