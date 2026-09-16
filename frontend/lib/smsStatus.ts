export type SmsLifecycleStatus = "queued" | "pending" | "delivered" | "failed" | "unknown";

export function smsStatusLabel(
  status: SmsLifecycleStatus | string | null | undefined,
  failedReason?: string | null,
): string {
  if (status === "delivered") return "Хүргэгдсэн";
  if (status === "failed") {
    const reason = failedReason?.trim();
    return reason ? `Хүргэлт амжилтгүй: ${reason}` : "Хүргэлт амжилтгүй";
  }
  if (status === "unknown") return "Хүргэлтийн төлөв одоогоор тодорхойгүй";
  return "Хүргэлт хүлээгдэж байна";
}

export function smsToastForSend(input: {
  pending?: number;
  delivered?: number;
  failed?: number;
  unknown?: number;
  sent?: number;
}): { kind: "success" | "error"; message: string } | null {
  const pending = input.pending ?? 0;
  const delivered = input.delivered ?? 0;
  const failed = input.failed ?? 0;
  const unknown = input.unknown ?? 0;
  const accepted = input.sent ?? pending + delivered + unknown;
  if (accepted === 0 && failed === 0) return null;
  if (delivered > 0 && pending === 0 && unknown === 0 && failed === 0) {
    return {
      kind: "success",
      message: delivered === 1 ? "Хүргэгдсэн." : `${delivered} хүргэгдсэн.`,
    };
  }
  if (failed > 0 && accepted === 0) {
    return { kind: "error", message: "Хүргэлт амжилтгүй." };
  }
  if (unknown > 0 && pending === 0 && delivered === 0) {
    return { kind: "success", message: smsStatusLabel("unknown") };
  }
  return { kind: "success", message: smsStatusLabel("queued") };
}
