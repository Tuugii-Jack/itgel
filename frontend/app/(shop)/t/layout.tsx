"use client";

import type { ReactNode } from "react";
import { TrackChrome, TrackShellProvider } from "./TrackShell";

export default function TrackLayout({ children }: { children: ReactNode }) {
  return (
    <TrackShellProvider>
      <TrackChrome>{children}</TrackChrome>
    </TrackShellProvider>
  );
}
