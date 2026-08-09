"use client";

import type { ReactNode } from "react";
import { Badge, type Tone } from "@/components/ui";
import type { BatchStage, DeliveryStatus, OrderStatus } from "@/lib/types";

export const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
  NEW: "neutral",
  CONFIRMED: "info",
  IN_BATCH: "info",
  IN_TRANSIT: "info",
  ARRIVED: "ok",
  HANDED_OVER: "ok",
  CANCELLED: "danger",
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: "Шинэ",
  CONFIRMED: "Баталгаажсан",
  IN_BATCH: "Багцад орсон",
  IN_TRANSIT: "Зам дээр",
  ARRIVED: "Агуулахад ирсэн",
  HANDED_OVER: "Хүлээлгэн өгсөн",
  CANCELLED: "Цуцлагдсан",
};

export const BATCH_STAGE_LABEL: Record<BatchStage, string> = {
  COLLECTING: "Цуглуулж байна",
  CLOSED: "Хаагдсан",
  AT_SUPPLIER: "Нийлүүлэгч дээр",
  IN_TRANSIT: "Зам дээр",
  AT_WAREHOUSE: "Агуулахад",
  DONE: "Дууссан",
};

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  PENDING: "Хүлээгдэж буй",
  ASSIGNED: "Жолооч хуваарилсан",
  DELIVERED: "Хүргэсэн",
};

export function OrderBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_STATUS_TONE[status]}>{ORDER_STATUS_LABEL[status]}</Badge>;
}

export function PageHead({
  title,
  hint,
  actions,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="m-0 text-[20px] font-medium">{title}</h1>
        {hint && <p className="mt-0.5 mb-0 text-[13px] text-ink-2">{hint}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Тоо том, шошго жижиг — метрик карт. */
export function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: Tone;
}) {
  const colors: Record<Tone, string> = {
    neutral: "text-ink",
    ok: "text-ok",
    warn: "text-warn",
    info: "text-info",
    danger: "text-danger",
  };
  return (
    <div className="rounded-[12px] border border-line bg-bg p-4">
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className={`tnum mt-1 text-[24px] font-medium ${colors[tone ?? "neutral"]}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-11 rounded-[8px] border border-line bg-bg px-3 text-[14px] ${className}`}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[12px] border border-line bg-bg">
      <table className="w-full border-collapse text-[14px]">{children}</table>
    </div>
  );
}

export function Th({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`whitespace-nowrap border-b border-line bg-surface p-3 text-left text-[13px] font-normal text-ink-2 ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`border-b border-line p-3 align-top ${className}`}>{children}</td>;
}
