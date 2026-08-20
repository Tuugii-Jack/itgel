"use client";

import { ComboMatrix } from "@/components/admin/ComboMatrix";
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

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[15px] font-medium">Үлдэгдэл — хослол бүр</div>
      <p className="m-0 text-[13px] text-ink-2">
        Өнгө, хэмжээ, материал зэрэг нь нийлээд нэг бараа. Үлдэгдлийг тэр хослол
        дээр тавина. 0 бол хэрэглэгчид «Дууссан».
      </p>

      <ComboMatrix
        options={options}
        listHeader="Үлдэгдэл"
        renderCell={(key) => {
          const draft = rows.find((r) => r.key === key);
          return (
            <Input
              value={draft?.stock ?? ""}
              onChange={(v) => patch(key, v)}
              inputMode="numeric"
              placeholder="0"
            />
          );
        }}
      />
    </div>
  );
}
