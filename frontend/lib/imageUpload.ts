/** Браузерт зургийг WebP болгож File буцаана (JPEG/PNG/HEIC гэх мэт). */

const DEFAULT_QUALITY = 0.85;
/** Хамгийн урт тал — том зургийг багасна. */
const MAX_EDGE = 2400;
const PASSTHROUGH = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
export const IMAGE_MAX_MB = 5;
export const IMAGE_MAX_BYTES = IMAGE_MAX_MB * 1024 * 1024;

export const IMAGE_SIZE_HINT = `Файл ${IMAGE_MAX_MB}MB-аас бага байх ёстой.`;

export function assertImageUnderLimit(file: File): void {
  if (file.size > IMAGE_MAX_BYTES) {
    throw new Error(IMAGE_SIZE_HINT);
  }
}

export async function fileToWebp(
  file: File,
  options?: { quality?: number; maxEdge?: number },
): Promise<File> {
  if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|gif|avif|heic|bmp)$/i.test(file.name)) {
    throw new Error("Зөвхөн зураг файл сонгоно уу.");
  }

  const quality = options?.quality ?? DEFAULT_QUALITY;
  const maxEdge = options?.maxEdge ?? MAX_EDGE;

  const bitmap = await loadBitmap(file);
  try {
    const { width, height } = fitSize(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Зураг боловсруулж чадсангүй.");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvasToWebp(canvas, quality);
    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${base}.webp`, { type: "image/webp", lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    // createImageBitmap дэмжихгүй формат (зарим HEIC) — <img> fallback.
    const url = URL.createObjectURL(file);
    try {
      const img = await loadHtmlImage(url);
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Зургийг уншиж чадсангүй."));
    img.src = src;
  });
}

function fitSize(w: number, h: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("WebP рүү хөрвүүлж чадсангүй. Өөр формат туршина уу."));
          return;
        }
        resolve(blob);
      },
      "image/webp",
      quality,
    );
  });
}

/** WebP болгож чадахгүй бол эх файлыг (JPEG/PNG) хэвээр илгээнэ. */
export async function prepareAdminImage(
  file: File,
  options?: { quality?: number; maxEdge?: number },
): Promise<File> {
  try {
    return await fileToWebp(file, options);
  } catch (error) {
    if (PASSTHROUGH.has(file.type) && file.size > 0 && file.size <= IMAGE_MAX_BYTES) {
      return file;
    }
    throw error instanceof Error ? error : new Error("Зургийг уншиж чадсангүй.");
  }
}
