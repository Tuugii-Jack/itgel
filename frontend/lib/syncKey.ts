import { useState } from "react";

/** Түлхүүр солигдоход render үед reset — effect-ээр setState хийхгүй. */
export function useOnKeyChange(key: string, apply: () => void) {
  const [seen, setSeen] = useState(key);
  if (key !== seen) {
    setSeen(key);
    apply();
  }
}
