"use client";

import { ComboMatrix } from "@/components/admin/ComboMatrix";
import { Button, Input } from "@/components/ui";
import { money } from "@/lib/format";
import {
  comboLabel,
  optionCombinations,
  priceForSelections,
  skuKeyOf,
} from "@/lib/options";
import type { OptionPrice, ProductOption } from "@/lib/types";

export const MAX_OPTION_COMBOS = 400;

export type OptionPriceDraft = {
  key: string;
  selections: Record<string, string>;
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
  const base = Number(defaults.sell) || 0;
  return optionCombinations(options).map((selections) => {
    const keys = Object.keys(selections);
    const resolved = priceForSelections(base, existing, selections);
    const sell = resolved > 0 ? String(resolved) : defaults.sell;
    return {
      key: skuKeyOf(selections),
      selections,
      kind: keys.length === 1 ? keys[0]! : "",
      value: keys.length === 1 ? selections[keys[0]!]! : comboLabel(selections),
      cost: "0",
      sell,
    };
  });
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
  if (options.length === 0) return null;

  const comboCount = optionCombinations(options).length;
  const patch = (key: string, next: string) => {
    onChange(
      rows.map((r) =>
        r.key === key ? { ...r, sell: next.replace(/\D/g, ""), cost: "0" } : r,
      ),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[15px] font-medium">Сонголтын үнэ — хослол бүр</div>
          <p className="mt-1 mb-0 text-[13px] text-ink-2">
            Материал, хэмжээ гэх мэт нийлээд нэг үнэ. Хоосон нүд дээрх үндсэн үнийг авна.
          </p>
        </div>
        {onFillAll && comboCount <= MAX_OPTION_COMBOS && (
          <Button size="sm" variant="outline" onClick={onFillAll}>
            Үндсэн үнийг бүгдэд
          </Button>
        )}
      </div>

      {comboCount > MAX_OPTION_COMBOS ? (
        <p className="m-0 rounded-[8px] border border-warn bg-warn-bg px-3 py-2 text-[13px] text-ink-2">
          Хослол хэт олон ({comboCount}). Бүлэг эсвэл утгыг цөөлөөд дахин оролдоно уу
          (дээд тал {MAX_OPTION_COMBOS}).
        </p>
      ) : (
        <ComboMatrix
          options={options}
          listHeader="Зарах үнэ"
          renderCell={(key) => {
            const draft = rows.find((r) => r.key === key);
            const sell = Number(draft?.sell) || 0;
            return (
              <Input
                value={draft?.sell ?? ""}
                onChange={(v) => patch(key, v)}
                inputMode="numeric"
                placeholder={sell > 0 ? money(sell) : "0"}
              />
            );
          }}
        />
      )}
    </div>
  );
}
