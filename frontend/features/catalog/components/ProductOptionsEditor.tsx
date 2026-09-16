"use client";

import { Button, Card, Input } from "@/components/ui";
import { OPTION_PRESETS } from "@/lib/options";
import type { ProductOption } from "@/lib/types";
import { ChipEditor } from "./ChipEditor";

export function ProductOptionsEditor({
  options,
  onChange,
}: {
  options: ProductOption[];
  onChange: (options: ProductOption[]) => void;
}) {
  const addOption = (preset?: string) => {
    if (preset && options.some((o) => o.name === preset)) return;
    onChange([...options, { name: preset ?? "", values: [] }]);
  };

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[15px] font-medium">Сонголт</div>
          <p className="m-0 text-[13px] text-muted">
            Бараанд тохирох төрөл нэмнэ үү (хоосон бол сонголтгүй). Үнийг
            гаргалт нээхэд хэмжээ/утга тус бүрээр тавина.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => addOption()}>
          Төрөл нэмэх
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {OPTION_PRESETS.map((preset) => {
          const used = options.some((o) => o.name === preset);
          return (
            <Button
              key={preset}
              size="sm"
              variant="ghost"
              disabled={used}
              onClick={() => addOption(preset)}
            >
              + {preset}
            </Button>
          );
        })}
      </div>

      {options.length === 0 && (
        <p className="m-0 text-[13px] text-muted">Сонголт байхгүй — шууд захиална.</p>
      )}

      {options.map((opt, index) => (
        <div key={index} className="rounded-[8px] border border-line p-3">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex-1">
              <Input
                value={opt.name}
                onChange={(v) =>
                  onChange(options.map((o, i) => (i === index ? { ...o, name: v } : o)))
                }
                placeholder="Төрлийн нэр (ж: Багтаамж)"
              />
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange(options.filter((_, i) => i !== index))}
            >
              Хасах
            </Button>
          </div>
          <ChipEditor
            values={opt.values}
            onChange={(values) =>
              onChange(options.map((o, i) => (i === index ? { ...o, values } : o)))
            }
            placeholder="Утга нэмэх…"
          />
        </div>
      ))}
    </Card>
  );
}
