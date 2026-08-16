"use client";

import { Button, Input } from "@/components/ui";
import { money } from "@/lib/format";
import { pricedOptionName } from "@/lib/options";
import type { OptionPrice, ProductOption } from "@/lib/types";

export type OptionPriceDraft = {
  kind: string;
  value: string;
  cost: string;
  sell: string;
};

export function seedOptionPriceDrafts(
  options: ProductOption[] | undefined,
  existing: OptionPrice[] | undefined,
  defaults: { sell: string; cost?: string },
): OptionPriceDraft[] {
  const byKey = new Map(
    (existing ?? []).map((p) => [`${p.kind}\0${p.value}`, p]),
  );
  const rows: OptionPriceDraft[] = [];
  for (const opt of options ?? []) {
    for (const value of opt.values) {
      const prev = byKey.get(`${opt.name}\0${value}`);
      const sell = prev ? String(prev.sellPrice ?? prev.price) : defaults.sell;
      rows.push({ kind: opt.name, value, cost: "0", sell });
    }
  }
  return rows;
}

export function OptionPriceEditor({
  options,
  rows,
  onChange,
  onFillAll,
}: {
  options: ProductOption[];
  rows: OptionPriceDraft[];
  onChange: (rows: OptionPriceDraft[]) => void;
  onFillAll?: () => void;
}) {
  const primary = pricedOptionName(options);
  if (!primary) return null;

  const groups = options.map((opt) => ({
    name: opt.name,
    required: opt.name === primary,
    rows: rows.filter((r) => r.kind === opt.name),
  }));

  const patch = (kind: string, value: string, next: string) => {
    onChange(
      rows.map((r) =>
        r.kind === kind && r.value === value ? { ...r, sell: next.replace(/\D/g, ""), cost: "0" } : r,
      ),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[15px] font-medium">Сонголтын үнэ</div>
          <p className="mt-1 mb-0 text-[13px] text-ink-2">
            Бараан дээр оруулсан {primary} бүрт энэ гаргалтын зарах үнийг тавина.
          </p>
        </div>
        {onFillAll && (
          <Button size="sm" variant="outline" onClick={onFillAll}>
            Үндсэн үнийг бүгдэд
          </Button>
        )}
      </div>

      {groups.map((group) => (
        <div key={group.name}>
          <div className="mb-2 text-[13px] text-ink-2">
            {group.name}
            {!group.required && (
              <span className="text-muted"> — заавал биш, хоосон бол үндсэн үнэ</span>
            )}
          </div>
          <div className="overflow-hidden rounded-[8px] border border-line">
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2 border-b border-line bg-surface px-3 py-2 text-[12px] text-muted">
              <span>Утга</span>
              <span>Зарах үнэ</span>
            </div>
            {group.rows.map((row) => {
              const sell = Number(row.sell) || 0;
              return (
                <div
                  key={`${row.kind}-${row.value}`}
                  className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-2 border-b border-line px-3 py-2 last:border-b-0"
                >
                  <div className="min-w-0 truncate text-[14px]">{row.value}</div>
                  <Input
                    value={row.sell}
                    onChange={(v) => patch(row.kind, row.value, v)}
                    inputMode="numeric"
                    placeholder={sell > 0 ? money(sell) : "0"}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
