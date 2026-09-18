"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Mutation үед жагсаалтыг шууд татахгүй. Жагсаалт дахин харагдахад л шинэчилнэ.
 */
export function useDeferredReload(
  reload: () => void | Promise<void>,
  listVisible: boolean,
) {
  const dirty = useRef(false);

  const markChanged = useCallback(() => {
    dirty.current = true;
  }, []);

  useEffect(() => {
    if (!listVisible || !dirty.current) return;
    dirty.current = false;
    void reload();
  }, [listVisible, reload]);

  return markChanged;
}
