"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import {
  DEFAULT_ORDER_EXPORT_SELECTION,
  loadOrderExportSelection,
  ORDER_EXPORT_COLUMNS,
  ORDER_EXPORT_GROUPS,
  saveOrderExportSelection,
  type OrderExportColumnKey,
  type OrderExportGroup,
  type OrderExportSelection,
} from "@/lib/orderExport";

export function OrderExportPanel({
  confirmLabel,
  busy,
  onConfirm,
}: {
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (columns: OrderExportSelection) => void;
}) {
  const [sel, setSel] = useState<OrderExportSelection>(DEFAULT_ORDER_EXPORT_SELECTION);

  useEffect(() => {
    setSel(loadOrderExportSelection());
  }, []);

  const update = (next: OrderExportSelection) => {
    setSel(next);
    saveOrderExportSelection(next);
  };

  const setKey = (key: OrderExportColumnKey, value: boolean) => {
    update({ ...sel, [key]: value });
  };

  const setGroup = (group: OrderExportGroup, value: boolean) => {
    const next = { ...sel };
    for (const col of ORDER_EXPORT_COLUMNS) {
      if (col.group === group) next[col.key] = value;
    }
    update(next);
  };

  const selectedCount = useMemo(
    () => ORDER_EXPORT_COLUMNS.filter((c) => sel[c.key]).length,
    [sel],
  );

  return (
    <Card className="mb-4 flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[14px] font-medium">Хэвлэх талбар</div>
          <div className="mt-0.5 text-[13px] text-muted">
            {selectedCount}/{ORDER_EXPORT_COLUMNS.length} талбар · сонгоогүйг алгасна
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => update({ ...DEFAULT_ORDER_EXPORT_SELECTION })}
          >
            Бүгдийг сонгох
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              update(
                Object.fromEntries(
                  ORDER_EXPORT_COLUMNS.map((c) => [c.key, false]),
                ) as OrderExportSelection,
              )
            }
          >
            Бүгдийг болиулах
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {ORDER_EXPORT_GROUPS.map((group) => {
          const cols = ORDER_EXPORT_COLUMNS.filter((c) => c.group === group.id);
          const allOn = cols.every((c) => sel[c.key]);
          const someOn = cols.some((c) => sel[c.key]);
          return (
            <div key={group.id}>
              <label className="mb-2 flex cursor-pointer items-center gap-2 text-[13px] font-medium">
                <GroupCheck
                  checked={allOn}
                  indeterminate={someOn && !allOn}
                  onChange={(v) => setGroup(group.id, v)}
                />
                {group.label}
              </label>
              <div className="flex flex-col gap-1.5 pl-0.5">
                {cols.map((col) => (
                  <label
                    key={col.key}
                    className="flex cursor-pointer items-center gap-2 text-[13px]"
                  >
                    <input
                      type="checkbox"
                      checked={sel[col.key]}
                      onChange={(e) => setKey(col.key, e.target.checked)}
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <Button
          size="sm"
          disabled={selectedCount === 0}
          loading={busy}
          onClick={() => onConfirm(sel)}
        >
          {confirmLabel}
        </Button>
      </div>
    </Card>
  );
}

function GroupCheck({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (value: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}
