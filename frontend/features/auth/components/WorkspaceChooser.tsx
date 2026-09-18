"use client";

import Link from "next/link";
import { workspaceSectionsFor } from "@/lib/admin-role";

export function WorkspaceChooser({
  role,
  destinations,
}: {
  role?: string | null;
  destinations?: string[] | null;
}) {
  const sections = workspaceSectionsFor(role, destinations);
  return (
    <div className="flex flex-col gap-2">
      {sections.map((section) => (
        <Link
          key={section.id}
          href={section.href}
          className="flex h-11 items-center justify-center rounded-[8px] border border-line bg-bg px-3.5 text-[14px] text-ink no-underline"
        >
          {section.label}
        </Link>
      ))}
    </div>
  );
}

export function WorkspaceSectionLinks({
  role,
  destinations,
  current,
}: {
  role?: string | null;
  destinations?: string[] | null;
  current?: "shop" | "leasing" | "store";
}) {
  const sections = workspaceSectionsFor(role, destinations);
  if (sections.length <= 1) return null;
  return (
    <div className="mb-2 flex flex-col gap-1">
      {sections.map((section) => (
        <Link
          key={section.id}
          href={section.href}
          className={`block text-[13px] no-underline hover:text-ink hover:underline ${
            section.id === current ? "text-ink" : "text-ink-2"
          }`}
        >
          {section.label}
        </Link>
      ))}
    </div>
  );
}
