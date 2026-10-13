/** Matches the server's preview fingerprint for a confirmed subset. */
export async function smsSubsetToken(rows: readonly { id: string; text: string }[], channel: string, relatedType = ""): Promise<string> {
  const canonical = [channel, relatedType, ...rows.map((row) => `${row.id}\n${row.text}`).sort()].join("\n--\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Each HTTP request stays small; a failed chunk stops future sends. */
export class SmsBatchError extends Error {
  readonly completed: number;
  readonly total: number;
  readonly originalError: unknown;
  constructor(completed: number, total: number, originalError: unknown) {
    super(`${completed} / ${total} дугаарын хүсэлт дууссан. Үлдсэн илгээлт зогслоо. ${originalError instanceof Error ? originalError.message : "SMS-ийн хариуг авч чадсангүй."}`);
    this.completed = completed; this.total = total; this.originalError = originalError;
  }
}

export async function sendSmsChunks<T, R>(
  rows: readonly T[],
  send: (chunk: T[]) => Promise<R>,
  onProgress: (completed: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = [];
  onProgress(0, rows.length);
  for (let start = 0; start < rows.length; start += 8) {
    const chunk = rows.slice(start, start + 8);
    try { results.push(await send(chunk)); }
    catch (error) { throw new SmsBatchError(start, rows.length, error); }
    onProgress(start + chunk.length, rows.length);
  }
  return results;
}
