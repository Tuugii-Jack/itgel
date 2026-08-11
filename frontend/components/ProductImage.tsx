"use client";

import { useState } from "react";
import { ImagePlaceholder } from "@/components/ui";

/**
 * Барааны зураг. Зураггүй эсвэл ачаалагдаагүй үед эвдэрсэн зургийн дүрс
 * харуулахын оронд шугаман placeholder харуулна.
 */
export function ProductImage({
  src,
  alt,
  className = "",
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  // Алдаа өгсөн src-г санана — src солигдвол (галерейд өөр зураг сонгоход)
  // автоматаар дахин оролдоно.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return <ImagePlaceholder className={className} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailedSrc(src)}
      className={`${className} bg-surface object-cover`}
    />
  );
}
