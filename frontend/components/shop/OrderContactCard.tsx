"use client";

import type { PublicOrder } from "@/lib/types";

export function OrderContactCard({
  order,
  shopHours,
}: {
  order: Pick<PublicOrder, "contact" | "isLeasing" | "payeeKind" | "code">;
  shopHours?: string;
}) {
  const contact = order.contact;
  if (!contact) return null;
  const leasing = contact.kind === "LEASING";
  const phone = contact.phone?.replace(/\D/g, "") ?? "";
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4">
      <div>
        <div className="text-[15px] font-medium">
          {leasing ? "Лизингийн холбоо барих" : "Дэлгүүрийн холбоо барих"}
        </div>
        <div className="mt-0.5 text-[13px] text-ink-2">
          {contact.title}
          {leasing ? ` · ${order.code}` : shopHours ? ` · ${shopHours}` : ""}
        </div>
      </div>
      {(phone || contact.chatUrl) && (
      <div className="flex gap-2">
        {phone ? (
          <a
            href={`tel:${phone}`}
            className="flex h-11 flex-1 items-center justify-center rounded-[8px] border border-line bg-bg text-[14px] no-underline"
          >
            Залгах{contact.phone ? ` · ${contact.phone}` : ""}
          </a>
        ) : null}
        {contact.chatUrl ? (
          <a
            href={contact.chatUrl}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 flex-1 items-center justify-center rounded-[8px] border border-line bg-bg text-[14px] no-underline"
          >
            Чат
          </a>
        ) : null}
      </div>
      )}
    </div>
  );
}
