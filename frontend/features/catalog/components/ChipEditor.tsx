"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";

export function ChipEditor({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const value = draft.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setDraft("");
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[14px]"
          >
            {value}
            <button
              type="button"
              onClick={() => onChange(values.filter((v) => v !== value))}
              aria-label={`${value} хасах`}
              className="cursor-pointer border-0 bg-transparent text-muted"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <Input
            value={draft}
            onChange={setDraft}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              add();
            }}
          />
        </div>
        <Button variant="outline" onClick={add} disabled={!draft.trim()}>
          Нэмэх
        </Button>
      </div>
    </div>
  );
}
