"use client";
export type TaskTab = { id: string; label: string; count?: number };
export function TaskTabs({ items, value, onChange, label = "Ажлын хэсэг" }: { items: readonly TaskTab[]; value: string; onChange: (value: string) => void; label?: string }) {
  return <nav aria-label={label} className="no-scrollbar mb-5 flex gap-1 overflow-x-auto rounded-xl border border-line bg-bg p-1">
    {items.map((item, index) => <button key={item.id} type="button" aria-pressed={value === item.id} onClick={() => onChange(item.id)} onKeyDown={(event) => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
      onChange(items[next].id); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
    }} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-4 text-[13px] ${value === item.id ? "bg-secondary font-medium text-white" : "text-ink-2 hover:bg-surface-2"}`}>
      {item.label}{item.count != null && <span className="tnum rounded-md bg-surface/20 px-1.5 py-0.5 text-[11px]">{item.count}</span>}
    </button>)}
  </nav>;
}
