"use client";

import { useEffect, useState } from "react";
import { ImagePlaceholder } from "@/components/ui";

/** Зураг ачаалагдахгүй бол alt текст биш, placeholder харуулна. */
export function ProductImage({
  src,
  alt,
  className = "",
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) return <ImagePlaceholder className={className} />;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={`object-cover ${className}`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
