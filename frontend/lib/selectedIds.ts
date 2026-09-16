/** Зөвшөөрөгдсөн id-уудад үлдсэн сонголтыг шүүнэ. */
export function pruneSelectedIds(pendingKey: string, prev: Iterable<string>): Set<string> {
  const allowed = new Set(pendingKey ? pendingKey.split(",") : []);
  const next = new Set<string>();
  for (const id of prev) {
    if (allowed.has(id)) next.add(id);
  }
  return next;
}
