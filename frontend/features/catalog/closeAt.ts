export function splitCloseAt(value: string): { date: Date | undefined; hour: string; minute: string } {
  if (!value || !value.includes("T")) {
    return { date: undefined, hour: "18", minute: "00" };
  }
  const [day, time] = value.split("T");
  const [h = "18", m = "00"] = (time ?? "").split(":");
  const [y, mo, d] = day!.split("-").map(Number);
  if (!y || !mo || !d) return { date: undefined, hour: h.slice(0, 2), minute: m.slice(0, 2) };
  return {
    date: new Date(y, mo - 1, d),
    hour: h.slice(0, 2),
    minute: ["00", "15", "30", "45"].includes(m.slice(0, 2)) ? m.slice(0, 2) : "00",
  };
}

export function joinCloseAt(date: Date, hour: string, minute: string): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}T${hour}:${minute}`;
}
