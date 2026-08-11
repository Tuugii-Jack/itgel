import type { ProductVariant } from '@prisma/client';

export type ProductOption = { name: string; values: string[] };

/** Variant мөрүүдийг бүлэг нэр → утгууд болгоно (sortOrder-оор). */
export function optionsFromVariants(variants: ProductVariant[] | undefined): ProductOption[] {
  const map = new Map<string, { values: string[]; minSort: number }>();
  for (const v of variants ?? []) {
    const entry = map.get(v.kind);
    if (!entry) {
      map.set(v.kind, { values: [v.value], minSort: v.sortOrder });
    } else {
      entry.values.push(v.value);
      entry.minSort = Math.min(entry.minSort, v.sortOrder);
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[1].minSort - b[1].minSort || a[0].localeCompare(b[0], 'mn'))
    .map(([name, { values }]) => ({ name, values }));
}

/** Хуучин size/color API-тай нийцүүлэх — Хэмжээ/Өнгө бүлэг. */
export function sizeColorCompat(options: ProductOption[]) {
  const sizes =
    options.find((o) => o.name === 'Хэмжээ' || o.name === 'SIZE')?.values ?? [];
  const colors =
    options.find((o) => o.name === 'Өнгө' || o.name === 'COLOR')?.values ?? [];
  return { sizes, colors };
}

export function normalizeSelections(input: {
  selections?: Record<string, string>;
  size?: string | null;
  color?: string | null;
}): Record<string, string> {
  const out: Record<string, string> = { ...(input.selections ?? {}) };
  if (input.size && !out['Хэмжээ'] && !out['SIZE']) out['Хэмжээ'] = input.size;
  if (input.color && !out['Өнгө'] && !out['COLOR']) out['Өнгө'] = input.color;
  return out;
}

export function sizeColorFromSelections(selections: Record<string, string>) {
  return {
    size: selections['Хэмжээ'] ?? selections['SIZE'] ?? null,
    color: selections['Өнгө'] ?? selections['COLOR'] ?? null,
  };
}

/** OrderItem.selections Json-ыг Record болгоно. */
export function selectionsOf(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v;
  }
  return out;
}

/** Админ хадгалахад — бүлэг бүрийн утгуудыг ProductVariant мөр болгоно. */
export function variantRowsFromOptions(options: ProductOption[]) {
  const rows: { kind: string; value: string; sortOrder: number }[] = [];
  let groupOrder = 0;
  for (const opt of options) {
    const name = opt.name.trim();
    if (!name) continue;
    const values = [...new Set(opt.values.map((v) => v.trim()).filter(Boolean))];
    if (values.length === 0) continue;
    values.forEach((value, i) => {
      rows.push({ kind: name, value, sortOrder: groupOrder * 100 + i });
    });
    groupOrder += 1;
  }
  return rows;
}
