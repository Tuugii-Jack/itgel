/** Ижил төлбөрийн үе/дүнд автомат QPay invoice-ийг дахин бүү үүсгэ. */
export function autoInvoiceDedupeKey(input: {
  code: string;
  kind: "split" | "fee" | "full" | "cargo";
  amount: number;
}): string {
  return `${input.code}|${input.kind}|${input.amount}`;
}

export function shouldIssueAutoInvoice(previous: string | null, next: string): boolean {
  return Boolean(next) && previous !== next;
}
