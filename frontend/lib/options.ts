import type { ProductOption } from "@/lib/types";

/** Сонголтуудыг «Хэмжээ: M · Өнгө: Хар» хэлбэрээр. */
export function formatSelections(
  selections?: Record<string, string> | null,
  size?: string | null,
  color?: string | null,
): string {
  if (selections && Object.keys(selections).length > 0) {
    return Object.entries(selections)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ");
  }
  return [size, color].filter(Boolean).join(" · ");
}

export function formatOptionsSummary(options: ProductOption[] | undefined): string {
  if (!options || options.length === 0) return "—";
  return options.map((o) => `${o.name}: ${o.values.join(", ")}`).join(" · ");
}

export const OPTION_PRESETS = [
  "Хэмжээ",
  "Өнгө",
  "Багтаамж",
  "Материал",
  "Загвар",
  "Амт",
] as const;
