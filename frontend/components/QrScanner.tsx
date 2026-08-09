"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";

/**
 * Камераар QR уншина. Камер зөвхөн HTTPS эсвэл localhost дээр ажиллана —
 * ажиллахгүй бол алдааг харуулж, гараар код оруулах хувилбар руу үлдээнэ.
 */
export function QrScanner({
  onResult,
  paused,
}: {
  onResult: (text: string) => void;
  paused?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (paused) return;

    let controls: IScannerControls | null = null;
    let cancelled = false;

    const reader = new BrowserQRCodeReader();
    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
        if (result) onResult(result.getText());
      })
      .then((c) => {
        if (cancelled) c.stop();
        else controls = c;
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            "Камер нээгдсэнгүй. Хөтчийн зөвшөөрлөө шалгах эсвэл кодыг гараар оруулна уу.",
          );
        }
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [onResult, paused]);

  if (error) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-[12px] border border-line bg-surface px-6 text-center text-[13px] text-ink-2">
        {error}
      </div>
    );
  }

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-[12px] border border-line bg-ink">
      <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-1/2 w-1/2 rounded-[12px] border-2 border-white/80" />
      </div>
    </div>
  );
}
