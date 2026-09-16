/** Effect доторх ажлыг дараагийн микротаск руу хойшлуулна — session.tsx-тай ижил. */
export function deferEffect(work: () => void): () => void {
  let cancelled = false;
  queueMicrotask(() => {
    if (!cancelled) work();
  });
  return () => {
    cancelled = true;
  };
}
