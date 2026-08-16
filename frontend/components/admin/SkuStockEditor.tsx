"use client";

import { Input } from "@/components/ui";
import { optionCombinations, skuKeyOf } from "@/lib/options";
import type { ProductOption, SkuStock } from "@/lib/types";

export type SkuStockDraft = {
  key: string;
  selections: Record<string, string>;
  stock: string;
};

export function seedSkuStockDrafts(
  options: ProductOption[] | undefined,
  existing: SkuStock[] | undefined,
  copyStock = false,
): SkuStockDraft[] {
  const byKey = new Map(
    (existing ?? []).map((s) => [skuKeyOf(s.selections), s]),
  );
  return optionCombinations(options).map((selections) => {
    const prev = byKey.get(skuKeyOf(selections));
    return {
      key: skuKeyOf(selections),
      selections,
      stock: copyStock && prev ? String(prev.stock) : "",
    };
  });
}

export function SkuStockEditor({
  options,
  rows,
  onChange,
}: {
  options: ProductOption[];
  rows: SkuStockDraft[];
  onChange: (rows: SkuStockDraft[]) => void;
}) {
  if (rows.length === 0) return null;

  const patch = (key: string, next: string) => {
    onChange(
      rows.map((r) =>
        r.key === key ? { ...r, stock: next.replace(/\D/g, "") } : r,
      ),
    );
  };

  const rowGroup = options[0];
  const colGroup = options[1];
  const useGrid = options.length === 2 && rowGroup && colGroup;

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[15px] font-medium">Үлдэгдэл — хослол бүр</div>
      <p className="m-0 text-[13px] text-ink-2">
        Өнгө, хэмжээ, материал зэрэг нь нийлээд нэг бараа. Үлдэгдлийг тэр хослол
        дээр тавина. 0 бол хэрэглэгчид «Дууссан».
      </p>

      {useGrid ? (
        <div className="overflow-x-auto rounded-[8px] border border-line">
          <table className="w-full min-w-[280px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-surface text-muted">
                <th className="whitespace-nowrap px-3 py-2 text-left font-normal">
                  {rowGroup.name} \ {colGroup.name}
                </th>
                {colGroup.values.map((col) => (
                  <th key={col} className="px-2 py-2 text-left font-normal">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowGroup.values.map((rowVal) => (
                <tr key={rowVal} className="border-t border-line">
                  <td className="whitespace-nowrap px-3 py-2">{rowVal}</td>
                  {colGroup.values.map((colVal) => {
                    const key = skuKeyOf({
                      [rowGroup.name]: rowVal,
                      [colGroup.name]: colVal,
                    });
                    const draft = rows.find((r) => r.key === key);
                    return (
                      <td key={colVal} className="px-2 py-1.5">
                        <Input
                          value={draft?.stock ?? ""}
                          onChange={(v) => patch(key, v)}
                          inputMode="numeric"
                          placeholder="0"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[8px] border border-line">
          <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-2 border-b border-line bg-surface px-3 py-2 text-[12px] text-muted">
            <span>Хослол</span>
            <span>Үлдэгдэл</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.key}
              className="grid grid-cols-[minmax(0,1fr)_100px] items-center gap-2 border-b border-line px-3 py-2 last:border-b-0"
            >
              <div className="min-w-0 truncate text-[14px]">
                {options.map((o) => row.selections[o.name]).filter(Boolean).join(" · ")}
              </div>
              <Input
                value={row.stock}
                onChange={(v) => patch(row.key, v)}
                inputMode="numeric"
                placeholder="0"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
