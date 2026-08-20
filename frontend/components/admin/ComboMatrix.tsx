"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { optionCombinations, skuKeyOf } from "@/lib/options";
import type { ProductOption } from "@/lib/types";

function otherGroups(options: ProductOption[], rowName: string, colName: string) {
  return options.filter((o) => o.name !== rowName && o.name !== colName);
}

export function ComboMatrix({
  options,
  listHeader,
  renderCell,
}: {
  options: ProductOption[];
  listHeader: string;
  renderCell: (key: string, selections: Record<string, string>) => ReactNode;
}) {
  const [rowName, setRowName] = useState(options[0]?.name ?? "");
  const [colName, setColName] = useState(options[1]?.name ?? "");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [asList, setAsList] = useState(false);

  const optionSig = options.map((o) => `${o.name}:${o.values.join("\0")}`).join("|");
  useEffect(() => {
    setRowName(options[0]?.name ?? "");
    setColName(options[1]?.name ?? "");
    setFilters({});
    setAsList(false);
  }, [optionSig]);

  const rowGroup = options.find((o) => o.name === rowName) ?? options[0];
  const colGroup =
    options.find((o) => o.name === colName && o.name !== rowGroup?.name) ??
    options.find((o) => o.name !== rowGroup?.name);
  const rest = useMemo(
    () => otherGroups(options, rowGroup?.name ?? "", colGroup?.name ?? ""),
    [options, rowGroup?.name, colGroup?.name],
  );

  const restFilters: Record<string, string> = {};
  for (const opt of rest) {
    const current = filters[opt.name];
    restFilters[opt.name] =
      current && opt.values.includes(current) ? current : (opt.values[0] ?? "");
  }

  const setAxis = (which: "row" | "col", name: string) => {
    if (which === "row") {
      const nextCol = colName === name ? (options.find((o) => o.name !== name)?.name ?? colName) : colName;
      setRowName(name);
      setColName(nextCol);
      setFilters({});
    } else {
      const nextRow = rowName === name ? (options.find((o) => o.name !== name)?.name ?? rowName) : rowName;
      setColName(name);
      setRowName(nextRow);
      setFilters({});
    }
  };

  const useGrid = options.length >= 2 && !asList && rowGroup && colGroup;

  return (
    <div className="flex flex-col gap-3">
      {options.length >= 2 && (
        <div className="flex flex-col gap-2">
          {options.length >= 3 && (
            <p className="m-0 text-[13px] text-ink-2">
              3-аас дээш бүлэгтэй үед хүснэгтэд 2 бүлэг харуулна. Бусад бүлгийг доороос
              шүүгээд нүд бүрт үнэ/тоо тавина. Бүх хослолыг жагсаалтаар ч харна.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[120px] flex-1 flex-col gap-1 text-[12px] text-muted">
              Мөр
              <select
                className="h-10 rounded-[8px] border border-line bg-bg px-2 text-[14px] text-ink"
                value={rowGroup?.name ?? ""}
                onChange={(e) => setAxis("row", e.target.value)}
              >
                {options.map((o) => (
                  <option key={o.name} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[120px] flex-1 flex-col gap-1 text-[12px] text-muted">
              Багана
              <select
                className="h-10 rounded-[8px] border border-line bg-bg px-2 text-[14px] text-ink"
                value={colGroup?.name ?? ""}
                onChange={(e) => setAxis("col", e.target.value)}
              >
                {options.map((o) => (
                  <option key={o.name} value={o.name} disabled={o.name === rowGroup?.name}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            {rest.map((opt) => (
              <label
                key={opt.name}
                className="flex min-w-[120px] flex-1 flex-col gap-1 text-[12px] text-muted"
              >
                {opt.name}
                <select
                  className="h-10 rounded-[8px] border border-line bg-bg px-2 text-[14px] text-ink"
                  value={restFilters[opt.name] ?? ""}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, [opt.name]: e.target.value }))
                  }
                >
                  {opt.values.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {options.length >= 3 && (
              <div className="flex gap-1">
                <Button size="sm" variant={asList ? "outline" : "primary"} onClick={() => setAsList(false)}>
                  Хүснэгт
                </Button>
                <Button size="sm" variant={asList ? "primary" : "outline"} onClick={() => setAsList(true)}>
                  Жагсаалт
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {useGrid ? (
        <div className="overflow-x-auto rounded-[8px] border border-line">
          <table className="w-full min-w-[280px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-surface text-muted">
                <th className="whitespace-nowrap px-3 py-2 text-left font-normal">
                  {rowGroup.name} \ {colGroup.name}
                </th>
                {colGroup.values.map((col) => (
                  <th key={col} className="px-2 py-2 text-left font-normal">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowGroup.values.map((rowVal) => (
                <tr key={rowVal} className="border-t border-line">
                  <td className="whitespace-nowrap px-3 py-2">{rowVal}</td>
                  {colGroup.values.map((colVal) => {
                    const selections = {
                      ...restFilters,
                      [rowGroup.name]: rowVal,
                      [colGroup.name]: colVal,
                    };
                    const key = skuKeyOf(selections);
                    return (
                      <td key={colVal} className="px-2 py-1.5">
                        {renderCell(key, selections)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[8px] border border-line">
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2 border-b border-line bg-surface px-3 py-2 text-[12px] text-muted">
            <span>Хослол</span>
            <span>{listHeader}</span>
          </div>
          {(options.length === 1
            ? (options[0]?.values ?? []).map((value) => {
                const selections = { [options[0]!.name]: value };
                return { key: skuKeyOf(selections), selections };
              })
            : optionCombinations(options).map((selections) => ({
                key: skuKeyOf(selections),
                selections,
              }))
          ).map((row) => (
            <div
              key={row.key}
              className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-2 border-b border-line px-3 py-2 last:border-b-0"
            >
              <div className="min-w-0 truncate text-[14px]">
                {options.map((o) => row.selections[o.name]).filter(Boolean).join(" · ")}
              </div>
              {renderCell(row.key, row.selections)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
