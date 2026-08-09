"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Захиалгын кодыг агуулсан QR — цагаан дэвсгэр дээр. */
export function Qr({ value, size = 160 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, {
      type: "svg",
      margin: 0,
      width: size,
      color: { dark: "#1C1917", light: "#FFFFFF" },
      errorCorrectionLevel: "M",
    })
      .then((out) => {
        if (!cancelled) setSvg(out);
      })
      .catch(() => {
        if (!cancelled) setSvg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div
      className="flex items-center justify-center rounded-[8px] border border-line bg-white p-2"
      style={{ width: size + 20, height: size + 20 }}
      aria-label={`${value} захиалгын QR код`}
    >
      {svg ? (
        <div style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="text-[12px] text-muted">QR…</div>
      )}
    </div>
  );
}
