export type ProductOption = { name: string; values: string[] };

/** Variant мөрүүдийг бүлэг нэр → утгууд болгоно (sortOrder-оор). */
export function optionsFromVariants(
  variants: { kind: string; value: string; sortOrder: number }[] | undefined,
): ProductOption[] {
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

/** Мөрийн сонголт — JSON байхгүй бол хуучин size/color. */
export function itemSelections(item: {
  selections?: unknown;
  size?: string | null;
  color?: string | null;
}): Record<string, string> {
  const fromJson = selectionsOf(item.selections);
  if (Object.keys(fromJson).length > 0) return fromJson;
  return normalizeSelections({ size: item.size, color: item.color });
}

/** Сонголтын тогтвортой түлхүүр — FIFO бүлэглэлтэд. */
export function variantKey(selections: Record<string, string>): string {
  const keys = Object.keys(selections).sort((a, b) => a.localeCompare(b, 'mn'));
  const ordered: Record<string, string> = {};
  for (const k of keys) ordered[k] = selections[k]!;
  return JSON.stringify(ordered);
}

export function formatSelectionsLabel(selections: Record<string, string>): string {
  const entries = Object.entries(selections);
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${k}: ${v}`).join(' · ');
}

const KIND_PRIORITY = ['Хэмжээ', 'SIZE', 'Өнгө', 'COLOR'];

export type VariantTally = {
  selections: Record<string, string>;
  size: string | null;
  color: string | null;
  qty: number;
};

export type KindTally = {
  kind: string;
  rows: { value: string; qty: number }[];
};

/** Захиалгын мөрийг сонголт болон бүлэг (хэмжээ/өнгө) бүрээр нэгтгэнэ. */
export function tallyVariants(
  rows: {
    selections: Record<string, string>;
    size?: string | null;
    color?: string | null;
    qty: number;
  }[],
): { byVariant: VariantTally[]; byKind: KindTally[] } {
  const variantMap = new Map<string, VariantTally>();
  const kindMap = new Map<string, Map<string, number>>();

  const addKind = (kind: string, value: string, qty: number) => {
    if (!kind || !value) return;
    const inner = kindMap.get(kind) ?? new Map<string, number>();
    inner.set(value, (inner.get(value) ?? 0) + qty);
    kindMap.set(kind, inner);
  };

  for (const row of rows) {
    const { size, color } = sizeColorFromSelections(row.selections);
    const resolvedSize = size ?? row.size ?? null;
    const resolvedColor = color ?? row.color ?? null;
    const key = variantKey(row.selections);
    const entry =
      variantMap.get(key) ??
      ({
        selections: row.selections,
        size: resolvedSize,
        color: resolvedColor,
        qty: 0,
      } satisfies VariantTally);
    entry.qty += row.qty;
    variantMap.set(key, entry);

    const entries = Object.entries(row.selections);
    if (entries.length > 0) {
      for (const [kind, value] of entries) addKind(kind, value, row.qty);
    } else {
      if (resolvedSize) addKind('Хэмжээ', resolvedSize, row.qty);
      if (resolvedColor) addKind('Өнгө', resolvedColor, row.qty);
    }
  }

  const kindRank = (kind: string) => {
    const i = KIND_PRIORITY.indexOf(kind);
    return i === -1 ? KIND_PRIORITY.length : i;
  };

  return {
    byVariant: [...variantMap.values()].sort((a, b) => b.qty - a.qty),
    byKind: [...kindMap.entries()]
      .sort((a, b) => kindRank(a[0]) - kindRank(b[0]) || a[0].localeCompare(b[0], 'mn'))
      .map(([kind, values]) => ({
        kind,
        rows: [...values.entries()]
          .map(([value, qty]) => ({ value, qty }))
          .sort((a, b) => b.qty - a.qty || a.value.localeCompare(b.value, 'mn')),
      })),
  };
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
