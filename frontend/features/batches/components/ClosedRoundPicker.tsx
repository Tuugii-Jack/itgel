"use client";

import { useEffect, useMemo, useState } from "react";
import { deferEffect } from "@/lib/deferEffect";
import { ProductImage } from "@/components/ProductImage";
import { Button, Card, ErrorNote, Input, Spinner } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayLabel, money, MONTH_LABELS } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { AdminBatchDetail, BatchProduct } from "@/lib/types";

/** Хаагдсан гаргалтыг он/сараар сонгож багцад нэмэх. */
export function ClosedRoundPicker({
  batch,
  onAdded,
}: {
  batch: AdminBatchDetail;
  onAdded: (products: BatchProduct[]) => void;
}) {
  const toast = useToast();
  const [months, setMonths] = useState<
    { year: number; month: number; key: string; count: number }[]
  >([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [rounds, setRounds] = useState<BatchProduct[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loadingMonths, setLoadingMonths] = useState(true);
  const [loadingRounds, setLoadingRounds] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      deferEffect(() => {
        void (async () => {
          setLoadingMonths(true);
          try {
            const list = await adminApi.batchEligibleMonths();
            setMonths(list);
            if (list[0]) setSelectedKey(list[0].key);
            setError(null);
          } catch (e) {
            setError(e instanceof ApiError ? e.message : "Сарууд ачаалж чадсангүй.");
          } finally {
            setLoadingMonths(false);
          }
        })();
      }),
    [],
  );

  useEffect(() => {
    if (!selectedKey) {
      return deferEffect(() => {
        setRounds([]);
      });
    }
    const [y, m] = selectedKey.split("-").map(Number);
    return deferEffect(() => {
      void (async () => {
        setLoadingRounds(true);
        setSelected(new Set());
        try {
          const list = await adminApi.batchEligibleRounds(y!, m!);
          setRounds(list);
          setError(null);
        } catch (e) {
          setError(e instanceof ApiError ? e.message : "Гаргалт ачаалж чадсангүй.");
        } finally {
          setLoadingRounds(false);
        }
      })();
    });
  }, [selectedKey]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addSelected = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const result = await adminApi.addBatchProduct(batch.id, {
        roundIds: [...selected],
      });
      const list = Array.isArray(result) ? result : [result];
      onAdded(list);
      setSelected(new Set());
      setRounds((prev) => prev.filter((r) => !selected.has(r.roundId)));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Нэмж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const inBatch = new Set(batch.products.map((p) => p.roundId));
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return rounds;
    return rounds.filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        String(row.roundNo).includes(q),
    );
  }, [rounds, q]);

  return (
    <Card className="mb-4 p-4">
      <div className="mb-2 text-[14px] font-medium">Хаагдсан гаргалт — он/сараар</div>
      <p className="mt-0 mb-3 text-[12px] text-muted">
        Захиалга хаагдсан сараар шүүж сонгоод багцад оруулна. Захиалгууд дагаж орно.
      </p>

      {loadingMonths ? (
        <div className="flex justify-center py-6">
          <Spinner className="text-muted" />
        </div>
      ) : months.length === 0 ? (
        <div className="py-4 text-center text-[13px] text-muted">
          Нэмэх боломжтой хаагдсан гаргалт алга.
        </div>
      ) : (
        <>
          <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
            {months.map((m) => {
              const active = m.key === selectedKey;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setSelectedKey(m.key)}
                  className={`h-9 shrink-0 cursor-pointer rounded-[8px] border px-3 text-[13px] ${
                    active
                      ? "border-ink bg-ink text-white"
                      : "border-line bg-bg text-ink hover:border-ink/40"
                  }`}
                >
                  {m.year} · {MONTH_LABELS[m.month - 1]}
                  <span className="tnum ml-1.5 opacity-70">{m.count}</span>
                </button>
              );
            })}
          </div>

          <div className="mb-3">
            <Input
              value={search}
              onChange={setSearch}
              placeholder="Барааны нэр эсвэл гаргалтын дугаараар хайх"
            />
          </div>

          {error && (
            <div className="mb-3">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}

          {loadingRounds ? (
            <div className="flex justify-center py-8">
              <Spinner className="text-muted" />
            </div>
          ) : rounds.length === 0 ? (
            <div className="py-6 text-center text-[13px] text-muted">
              Энэ сард нэмэх гаргалт алга.
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-6 text-center text-[13px] text-muted">
              Хайлтад тохирох бараа олдсонгүй.
            </div>
          ) : (
            <div className="max-h-[320px] overflow-y-auto">
              {filtered.map((row) => {
                const linked = inBatch.has(row.roundId);
                const checked = selected.has(row.roundId);
                return (
                  <label
                    key={row.roundId}
                    className={`flex cursor-pointer items-center gap-3 border-b border-line py-2 last:border-b-0 ${
                      linked ? "opacity-50" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={linked}
                      checked={linked || checked}
                      onChange={() => toggle(row.roundId)}
                      className="size-4"
                    />
                    <ProductImage
                      src={row.image}
                      alt={row.name}
                      className="h-10 w-10 shrink-0 rounded-[8px]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px]">{row.name}</div>
                      <div className="tnum text-[12px] text-muted">
                        #{row.roundNo}
                        {row.closeAt ? ` · ${dayLabel(row.closeAt)}` : ""}
                        {` · ${money(row.sellPrice)}`}
                        {row.orderedQty > 0
                          ? ` · ${row.orderedQty} ш · ${row.customerCount} хүн`
                          : ""}
                      </div>
                    </div>
                    {linked && (
                      <span className="text-[12px] text-muted">Багцад байна</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="tnum text-[13px] text-muted">{selected.size} сонгосон</span>
            <Button
              size="sm"
              onClick={() => void addSelected()}
              loading={busy}
              disabled={selected.size === 0}
            >
              Багцад нэмэх
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
