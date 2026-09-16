import type { AdminDelivery } from "@/lib/types";

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function monthCells(year: number, month: number): (number | null)[] {
  const last = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month - 1, 1).getDay();
  const lead = firstDow === 0 ? 6 : firstDow - 1;
  const cells: (number | null)[] = [
    ...Array<number | null>(lead).fill(null),
    ...Array.from({ length: last }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function districtCourierLabel(list: AdminDelivery[]): string | null {
  const open = list.filter((r) => r.status !== "DELIVERED");
  const names = [...new Set(open.map((r) => r.courierName?.trim()).filter(Boolean))] as string[];
  if (names.length === 1) return names[0]!;
  if (names.length > 1) return `${names.length} хүн`;
  return null;
}
