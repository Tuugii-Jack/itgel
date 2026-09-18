"use client";

import { deferEffect } from "@/lib/deferEffect";
import { useCallback, useEffect, useState } from "react";
import { Metric, PageHead, Table, Td, Th } from "@/components/admin/shared";
import { Button, Card, Empty, ErrorNote, Input, Skeleton, Textarea } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { useToast } from "@/lib/toast";

function ubToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ulaanbaatar" }).format(new Date());
}

type Tab = "day" | "paid" | "bank";

export default function AdminLeasingSettlementsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("day");
  const [day, setDay] = useState(ubToday);
  const [ownerAdminId, setOwnerAdminId] = useState("");
  const [operators, setOperators] = useState<{ id: string; name: string; email: string; isActive?: boolean }[]>([]);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof adminApi.leasingSettlementSummary>> | null>(null);
  const [payments, setPayments] = useState<Awaited<ReturnType<typeof adminApi.leasingSettlementPayments>>>([]);
  const [holds, setHolds] = useState<Awaited<ReturnType<typeof adminApi.unpaidReadyHolds>> | null>(null);
  const [exceptions, setExceptions] = useState<Awaited<ReturnType<typeof adminApi.moneyExceptions>>>([]);
  const [missing, setMissing] = useState<Awaited<ReturnType<typeof adminApi.missingSettlementOwners>> | null>(null);
  const [assignOwnerId, setAssignOwnerId] = useState("");
  const [selectedMissing, setSelectedMissing] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [ops, dayData, payRows, holdData, ex, miss] = await Promise.all([
        adminApi.leasingSettlementOperators(),
        adminApi.leasingSettlementSummary({
          day,
          ownerAdminId: ownerAdminId || undefined,
        }),
        adminApi.leasingSettlementPayments({
          ownerAdminId: ownerAdminId || undefined,
          status: tab === "bank" ? "PENDING" : tab === "paid" ? "CONFIRMED" : undefined,
        }),
        adminApi.unpaidReadyHolds(),
        adminApi.moneyExceptions(),
        adminApi.missingSettlementOwners(),
      ]);
      setOperators(ops);
      setSummary(dayData);
      setPayments(payRows);
      setHolds(holdData);
      setExceptions(ex.filter((row) => row.kind !== "SETTLEMENT_OWNER_MISSING"));
      setMissing(miss);
      setSelectedMissing(
        new Set(miss.orders.filter((row) => row.recordedMissing).map((row) => row.id)),
      );
      setAssignOwnerId((prev) => {
        if (prev) return prev;
        return ops.find((op) => op.isActive)?.id ?? "";
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, [day, ownerAdminId, tab]);

  useEffect(() => deferEffect(() => { void load(); }), [load]);

  const confirm = async (id: string) => {
    setBusyId(id);
    try {
      await adminApi.confirmLeasingBankPayment(id);
      toast.success("Шилжүүлгийг баталлаа.");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Баталгаажуулж чадсангүй.");
    } finally {
      setBusyId(null);
    }
  };

  const assign = async () => {
    if (!assignOwnerId || selectedMissing.size === 0) return;
    setBusyId("assign");
    try {
      const result = await adminApi.assignMissingSettlementOwners({
        ownerAdminId: assignOwnerId,
        orderIds: [...selectedMissing],
      });
      toast.success(`Тооцоо нөхөв: ${result.orders} захиалга, ${result.created} мөр.`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Нөхөж чадсангүй.");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async () => {
    if (!rejectId || rejectReason.trim().length < 3) return;
    setBusyId(rejectId);
    try {
      await adminApi.rejectLeasingBankPayment(rejectId, rejectReason.trim());
      toast.success("Буцаалаа.");
      setRejectId(null);
      setRejectReason("");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Буцааж чадсангүй.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHead
        title="Лизингийн тооцоо"
        hint="Лизингийн админ Итгэлд төлөх барааны бүтэн дүн. Банкны шилжүүлгийг энд хийхгүй — бүртгэл, баталгаа."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["day", "Өдрийн тооцоо"],
            ["paid", "Баталгаажсан төлбөр"],
            ["bank", "Дансны баталгаа"],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            size="sm"
            variant={tab === id ? "primary" : "outline"}
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Өдөр
          <Input type="date" value={day} onChange={setDay} className="w-44" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Лизингийн админ
          <select
            value={ownerAdminId}
            onChange={(e) => setOwnerAdminId(e.target.value)}
            className="h-10 min-w-44 rounded-[8px] border border-line bg-bg px-3 text-[14px]"
          >
            <option value="">Бүгд</option>
            {operators.map((op) => (
              <option key={op.id} value={op.id}>
                {op.name}
                {op.isActive === false ? " · идэвхгүй" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {missing && missing.orderCount > 0 && (
        <Card className="mb-6 flex flex-col gap-3 p-4">
          <div className="text-[15px] font-medium">Эзэнгүй баталгаажсан лизинг</div>
          <p className="mt-0 mb-0 text-[13px] text-ink-2">
            Тооцоо үүсээгүй тул өдрийн нийт дүнд ороогүй. Хариуцагчийг энд ил тод сонгож нэг удаа
            нөхнө. Ерөнхий тохиргоо солигдсон төдийд автоматаар оноогдохгүй. Хэрэглэгчийн төлбөр
            хэвээр.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Захиалга" value={missing.orderCount} tone="warn" />
            <Metric label="Итгэлд авах дүн" value={money(missing.amount)} tone="warn" />
          </div>
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th />
                  <Th>Захиалга</Th>
                  <Th>Хэрэглэгч</Th>
                  <Th>Дүн</Th>
                </tr>
              </thead>
              <tbody>
                {missing.orders.map((row) => (
                  <tr key={row.id}>
                    <Td>
                      <input
                        type="checkbox"
                        className="h-5 w-5"
                        checked={selectedMissing.has(row.id)}
                        onChange={() =>
                          setSelectedMissing((prev) => {
                            const next = new Set(prev);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            return next;
                          })
                        }
                      />
                    </Td>
                    <Td className="tnum">{row.code}</Td>
                    <Td>{row.customerName}</Td>
                    <Td className="tnum">
                      {money(row.amount)}
                      {row.recordedMissing ? (
                        <div className="text-[12px] text-ink-2">эзэн тохируулаагүй гэж бүртгэсэн</div>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-muted">
              Хариуцагч
              <select
                value={assignOwnerId}
                onChange={(e) => setAssignOwnerId(e.target.value)}
                className="h-11 rounded-[8px] border border-line bg-bg px-3 text-[14px]"
              >
                <option value="">Сонгоно уу</option>
                {operators
                  .filter((op) => op.isActive !== false)
                  .map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.name}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              className="min-h-11 w-full sm:w-auto"
              loading={busyId === "assign"}
              disabled={!assignOwnerId || selectedMissing.size === 0}
              onClick={() => void assign()}
            >
              Тооцоо нөхөн үүсгэх
            </Button>
          </div>
        </Card>
      )}
      {loading || !summary ? (
        <Skeleton className="h-40 w-full rounded-[12px]" />
      ) : tab === "day" ? (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Захиалга" value={summary.orderCount} />
            <Metric label="Барааны дүн" value={money(summary.amount)} />
            <Metric label="Төлсөн" value={money(summary.paidAmount)} tone="ok" />
            <Metric label="Авах үлдэгдэл" value={money(summary.remainingAmount)} tone="warn" />
          </div>
          {summary.unassignedOrderCount > 0 && (
            <div className="mb-4 text-[14px] text-ink-2">
              Эзэнгүй тооцоо: {summary.unassignedOrderCount} захиалга ·{" "}
              <span className="tnum font-medium">{money(summary.unassignedAmount)}</span> — дээрх
              картаас нөхнө, өдрийн нийт дүнд чимээгүй орхигдоогүй.
            </div>
          )}
          {summary.priorUnpaidAmount > 0 && (
            <div className="mb-4 text-[14px]">
              Өмнөх өдрийн үлдэгдэл: <span className="tnum font-medium">{money(summary.priorUnpaidAmount)}</span>
            </div>
          )}
          {summary.lines.length === 0 ? (
            <Empty>Энэ өдөр тооцоо алга.</Empty>
          ) : (
            <Card className="overflow-x-auto p-0">
              <Table>
                <thead>
                  <tr>
                    <Th>Захиалга</Th>
                    <Th>Хэрэглэгч</Th>
                    <Th>Бараа</Th>
                    <Th>Дүн</Th>
                    <Th>Төлөв</Th>
                  </tr>
                </thead>
                <tbody>
                  {summary.lines.map((line) => (
                    <tr key={line.id}>
                      <Td className="tnum">{line.orderCode}</Td>
                      <Td>{line.customerName}</Td>
                      <Td>
                        {line.productName} · {line.qty} ш
                      </Td>
                      <Td className="tnum">{money(line.amount)}</Td>
                      <Td>
                        {line.statusLabel}
                        {line.remainingAmount > 0 && line.remainingAmount !== line.amount && (
                          <div className="text-[12px] text-ink-2">үлдэгдэл {money(line.remainingAmount)}</div>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </>
      ) : (
        <>
          {payments.length === 0 ? (
            <Empty>{tab === "bank" ? "Баталгаа хүлээсэн шилжүүлэг алга." : "Баталгаажсан төлбөр алга."}</Empty>
          ) : (
            <Card className="overflow-x-auto p-0">
              <Table>
                <thead>
                  <tr>
                    <Th>Огноо</Th>
                    <Th>Арга</Th>
                    <Th>Дүн</Th>
                    <Th>Лавлагаа</Th>
                    <Th>Мөр</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <Td className="whitespace-nowrap">{p.createdAt.slice(0, 10)}</Td>
                      <Td>{p.method === "QPAY" ? "QPay" : "Данс"}</Td>
                      <Td className="tnum">{money(p.amount)}</Td>
                      <Td>
                        {p.bankRef ?? "—"}
                        {p.receiptUrl && (
                          <div>
                            <a href={p.receiptUrl} target="_blank" rel="noreferrer" className="text-[12px]">
                              Баримт
                            </a>
                          </div>
                        )}
                        {p.rejectedReason && (
                          <div className="text-[12px] text-danger">{p.rejectedReason}</div>
                        )}
                      </Td>
                      <Td>
                        {p.lines.map((line, i) => (
                          <div key={i}>
                            {line.settlement.orderCode} · {line.settlement.productName}
                          </div>
                        ))}
                      </Td>
                      <Td>
                        {tab === "bank" && p.status === "PENDING" && (
                          <div className="flex flex-col gap-2">
                            <Button
                              size="sm"
                              className="min-h-11 w-full"
                              loading={busyId === p.id}
                              onClick={() => void confirm(p.id)}
                            >
                              Батлах
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="min-h-11 w-full"
                              onClick={() => {
                                setRejectId(p.id);
                                setRejectReason("");
                              }}
                            >
                              Буцаах
                            </Button>
                          </div>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
          {rejectId && (
            <Card className="mt-4 flex max-w-[480px] flex-col gap-3 p-4">
              <div className="text-[15px] font-medium">Шилжүүлэг буцаах</div>
              <Textarea value={rejectReason} onChange={setRejectReason} rows={3} />
              <div className="flex gap-2">
                <Button loading={Boolean(busyId)} disabled={rejectReason.trim().length < 3} onClick={() => void reject()}>
                  Буцаах
                </Button>
                <Button variant="ghost" onClick={() => setRejectId(null)}>
                  Болих
                </Button>
              </div>
            </Card>
          )}
        </>
      )}

      {holds && holds.count > 0 && (
        <Card className="mt-6 p-4">
          <div className="text-[15px] font-medium">Төлөөгүй бэлэн захиалгын нөөц (зөвхөн харах)</div>
          <p className="mt-1 mb-0 text-[13px] text-ink-2">
            {holds.unpaidCancelHours} цаг өнгөрсөн төлөөгүй захиалга: {holds.count} мөр. Түр нөөц{" "}
            {holds.reservedQty} ш, хуучин зарлага {holds.consumedOrLegacyQty} ш. Production өгөгдлийг эндээс өөрчлөхгүй.
          </p>
        </Card>
      )}
      {exceptions.length > 0 && (
        <Card className="mt-4 p-4">
          <div className="text-[15px] font-medium">Мөнгөний зөрүү / хоцорсон төлбөр</div>
          <ul className="mt-2 mb-0 list-disc pl-5 text-[13px]">
            {exceptions.map((row) => (
              <li key={row.id}>
                {row.kind} · {money(row.amount)}
                {row.note ? ` · ${row.note}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
