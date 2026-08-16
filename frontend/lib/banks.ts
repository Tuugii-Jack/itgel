/** Монголын банкууд — буцаалтын данс сонгоход. */
export const MN_BANKS: string[] = [
  "Хаан банк",
  "Голомт банк",
  "Худалдаа хөгжлийн банк",
  "Хас банк",
  "Төрийн банк",
  "Капитрон банк",
  "Чингис хаан банк",
  "Ариг банк",
  "Богд банк",
  "Тээвэр хөгжлийн банк",
  "М банк",
  "Төмөр замын банк",
];

export function bankSelectOptions(current?: string): { value: string; label: string }[] {
  const name = current?.trim() ?? "";
  const names = name && !MN_BANKS.includes(name) ? [name, ...MN_BANKS] : MN_BANKS;
  return names.map((value) => ({ value, label: value }));
}
