"use client";

import { deferEffect } from "@/lib/deferEffect";
import { useCallback, useEffect, useState } from "react";
import { Metric, Table, Td, Th } from "@/components/admin/shared";
import { Button, Card, ErrorNote } from "@/components/ui";
import { OrderDetail } from "@/components/admin/OrderDetail";
import { ItgelWorkspace } from "@/features/leasing/settlements/ItgelWorkspace";
import { adminApi, ApiError } from "@/lib/api";
import { isFullAdmin } from "@/lib/admin-role";
import { useAdminSession } from "@/lib/admin-session";
import { money } from "@/lib/format";
import { useToast } from "@/lib/toast";

export default function AdminLeasingSettlementsPage() {
  const toast = useToast();
  const { user } = useAdminSession();
  const [operators, setOperators] = useState<{ id: string; name: string; email: string; isActive?: boolean }[]>([]);
  const [holds, setHolds] = useState<Awaited<ReturnType<typeof adminApi.unpaidReadyHolds>> | null>(null);
  const [exceptions, setExceptions] = useState<Awaited<ReturnType<typeof adminApi.moneyExceptions>>>([]);
  const [missing, setMissing] = useState<Awaited<ReturnType<typeof adminApi.missingSettlementOwners>> | null>(null);
  const [assignOwnerId, setAssignOwnerId] = useState("");
  const [selectedMissing, setSelectedMissing] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const loadExtras = useCallback(async () => {
    try {
      const [ops, holdData, ex, miss] = await Promise.all([
        adminApi.leasingSettlementOperators(),
        adminApi.unpaidReadyHolds(),
        adminApi.moneyExceptions(),
        adminApi.missingSettlementOwners(),
      ]);
      setOperators(ops);
      setHolds(holdData);
      setExceptions(ex.filter((row) => row.kind !== "SETTLEMENT_OWNER_MISSING"));
      setMissing(miss);
      setSelectedMissing(new Set(miss.orders.filter((row) => row.recordedMissing).map((row) => row.id)));
      setAssignOwnerId((prev) => prev || ops.find((op) => op.isActive)?.id || "");
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    }
  }, []);

  useEffect(() => deferEffect(() => { void loadExtras(); }), [loadExtras]);

  const assign = async () => {
    if (!assignOwnerId || selectedMissing.size === 0) return;
    setBusyId("assign");
    try {
      const result = await adminApi.assignMissingSettlementOwners({
        ownerAdminId: assignOwnerId,
        orderIds: [...selectedMissing],
      });
      toast.success(`Тооцоо нөхөв: ${result.orders} захиалга, ${result.created} мөр.`);
      await loadExtras();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Нөхөж чадсангүй.");
    } finally {
      setBusyId(null);
    }
  };

  if (openOrderId) {
    return (
      <OrderDetail
        orderId={openOrderId}
        api={adminApi}
        canWrite={isFullAdmin(user?.role)}
        workspace="shop"
        onClose={() => setOpenOrderId(null)}
        onChanged={() => void loadExtras()}
      />
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {missing && missing.orderCount > 0 && (
        <Card className="mb-6 flex flex-col gap-3 p-4">
          <div className="text-[15px] font-medium">Эзэнгүй баталгаажсан лизинг</div>
          <p className="mt-0 mb-0 text-[13px] text-ink-2">
            Тооцоо үүсээгүй тул өдрийн нийт дүнд ороогүй. Хариуцагчийг энд ил тод сонгож нэг удаа нөхнө.
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
                    <Td className="tnum">
                      <button
                        type="button"
                        className="cursor-pointer border-0 bg-transparent p-0 underline"
                        onClick={() => setOpenOrderId(row.id)}
                      >
                        {row.code}
                      </button>
                    </Td>
                    <Td>{row.customerName}</Td>
                    <Td className="tnum">{money(row.amount)}</Td>
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

      <ItgelWorkspace
        key={user?.id ?? "admin-settlements"}
        variant="admin"
        canPay={false}
        canConfirmBank={isFullAdmin(user?.role)}
        showOwnerFilter
        canWriteOrder={isFullAdmin(user?.role)}
      />

      {holds && holds.count > 0 && (
        <Card className="mt-6 p-4">
          <div className="text-[15px] font-medium">Төлөөгүй бэлэн захиалгын нөөц (зөвхөн харах)</div>
          <p className="mt-1 mb-0 text-[13px] text-ink-2">
            {holds.unpaidCancelHours} цаг өнгөрсөн төлөөгүй захиалга: {holds.count} мөр. Production өгөгдлийг эндээс
            өөрчлөхгүй.
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
                {row.qpayInvoiceId ? ` · invoice ${row.qpayInvoiceId}` : ""}
                {row.reference ? ` · гүйлгээ ${row.reference}` : ""}
                {row.note ? ` · ${row.note}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
