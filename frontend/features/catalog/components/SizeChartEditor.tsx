"use client";

import { Button, Card, Input } from "@/components/ui";
import type { SizeChartRow } from "@/lib/types";

export function SizeChartEditor({
  rows,
  onChange,
}: {
  rows: SizeChartRow[];
  onChange: (rows: SizeChartRow[]) => void;
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[15px] font-medium">Хэмжээсийн хүснэгт</div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange([...rows, { size: "", heightRange: "", chestCm: "" }])}
        >
          Мөр нэмэх
        </Button>
      </div>
      <p className="m-0 text-[12px] text-muted">Хувцас гэх мэтэд л хэрэгтэй — хоосон орхиж болно.</p>
      {rows.map((row, index) => (
        <div key={index} className="flex gap-2">
          {(["size", "heightRange", "chestCm"] as const).map((key) => (
            <div key={key} className="flex-1">
              <Input
                value={row[key] ?? ""}
                onChange={(v) =>
                  onChange(rows.map((r, i) => (i === index ? { ...r, [key]: v } : r)))
                }
                placeholder={
                  key === "size" ? "Хэмжээ" : key === "heightRange" ? "Өндөр" : "Цээж"
                }
              />
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            Хасах
          </Button>
        </div>
      ))}
    </Card>
  );
}
