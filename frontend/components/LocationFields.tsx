"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui";
import {
  AIMAGS,
  aimagDisplayName,
  aimagStoredName,
  inferDeliveryZone,
  type DeliveryZone,
} from "@/lib/locations";

/**
 * Хүргэлтийн байршил — эхлээд хот/аймаг, дараа нь дүүрэг эсвэл аймгийн нэр.
 */
export function LocationFields({
  cityDistricts,
  district,
  onDistrictChange,
  khoroo,
  onKhorooChange,
  readOnly = false,
}: {
  cityDistricts: readonly string[];
  district: string | null;
  onDistrictChange: (value: string | null) => void;
  khoroo: string;
  onKhorooChange: (value: string) => void;
  readOnly?: boolean;
}) {
  const inferred = inferDeliveryZone(district, cityDistricts);
  const [zone, setZone] = useState<DeliveryZone | null>(inferred);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (inferred) setZone(inferred);
  }, [inferred]);

  const pickZone = (next: DeliveryZone) => {
    if (readOnly) return;
    setZone(next);
    setQuery("");
    if (inferred !== next) onDistrictChange(null);
  };

  const places = zone === "aimag" ? AIMAGS : cityDistricts;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...places];
    return places.filter((name) => name.toLowerCase().includes(q));
  }, [places, query]);

  const selectedDisplay = district
    ? zone === "aimag"
      ? aimagDisplayName(district)
      : district
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="text-[14px] text-ink-2">Хаашаа хүргүүлэх вэ</div>
        <div className="grid grid-cols-2 gap-2">
          <ZoneChip
            active={zone === "city"}
            title="Хот"
            hint="Улаанбаатар"
            disabled={readOnly}
            onClick={() => pickZone("city")}
          />
          <ZoneChip
            active={zone === "aimag"}
            title="Аймаг"
            hint="21 аймаг"
            disabled={readOnly}
            onClick={() => pickZone("aimag")}
          />
        </div>
      </div>

      {zone && (
        <div className="flex flex-col gap-2">
          <div className="text-[14px] text-ink-2">
            {zone === "city" ? "Дүүрэг" : "Аймаг"}
          </div>
          {places.length > 10 && !readOnly && (
            <Input
              value={query}
              onChange={setQuery}
              placeholder={zone === "city" ? "Дүүрэг хайх" : "Аймаг хайх"}
            />
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {filtered.map((name) => {
              const active = selectedDisplay === name;
              return (
                <button
                  key={name}
                  type="button"
                  disabled={readOnly}
                  onClick={() =>
                    onDistrictChange(
                      zone === "aimag" ? aimagStoredName(name) : name,
                    )
                  }
                  className={`h-11 rounded-[8px] border px-2 text-[14px]
                    ${active ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"}
                    ${readOnly ? "cursor-default" : "cursor-pointer"}`}
                >
                  {name}
                </button>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <p className="m-0 text-[13px] text-muted">Тохирох байршил олдсонгүй.</p>
          )}
        </div>
      )}

      {zone && (
        <div className="flex flex-col gap-2">
          <div className="text-[14px] text-ink-2">
            {zone === "city" ? "Хороо" : "Сум"}
          </div>
          <Input
            value={khoroo}
            onChange={onKhorooChange}
            placeholder={zone === "city" ? "Жишээ: 15-р хороо" : "Жишээ: 1-р сум"}
            disabled={readOnly}
          />
        </div>
      )}
    </div>
  );
}

function ZoneChip({
  active,
  title,
  hint,
  onClick,
  disabled,
}: {
  active: boolean;
  title: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-[72px] flex-col items-start justify-center rounded-[12px] border px-4 text-left
        ${active ? "border-ink bg-surface" : "border-line bg-bg"}
        ${disabled ? "cursor-default" : "cursor-pointer"}`}
    >
      <span className="text-[17px] text-ink">{title}</span>
      <span className={`mt-0.5 text-[13px] ${active ? "text-ink-2" : "text-muted"}`}>
        {hint}
      </span>
    </button>
  );
}
