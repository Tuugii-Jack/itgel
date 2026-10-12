"use client";
import { useRef, type ComponentProps } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui";
export function SearchField({ className = "", ...props }: ComponentProps<typeof Input>) {
  const input = useRef<HTMLInputElement>(null);
  return <div className={`relative min-w-0 ${className}`}>
    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
    <Input {...props} className="w-full pl-10 pr-11" inputRef={input} autoComplete="off" enterKeyHint="search" aria-label={props["aria-label"] ?? props.placeholder ?? "Хайх"} />
    {props.value && <button type="button" aria-label="Хайлтыг цэвэрлэх" onClick={() => { props.onChange(""); input.current?.focus(); }}
      className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2"><X className="h-4 w-4" aria-hidden="true" /></button>}
  </div>;
}
