"use client";

import { Qr } from "@/components/Qr";

/** Олголтын QR — QPay төлбөрийн QR-аас нэр, байрлалаар ялгаатай. Нэвтрэх эрх биш. */
export function PickupQrCard({ value, code }: { value: string; code: string }) {
  return (
    <div className="rounded-[12px] border-2 border-ink bg-bg p-4">
      <div className="text-[15px] font-medium">Олголтын QR</div>
      <p className="mt-1 mb-3 text-[13px] leading-[1.45] text-ink-2">
        Дэлгүүрийн ажилтанд уншуулна. Энэ QR төлбөр төлөх QR биш, бараа авах эрх ч биш —
        зөвхөн захиалга олох лавлагаа.
      </p>
      <div className="flex flex-col items-center gap-3">
        <Qr value={value} size={168} />
        <div className="tnum text-[16px] font-medium tracking-[0.04em]">{code}</div>
      </div>
    </div>
  );
}
