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

  const decoded = await decodeForUpload(file);
  try {
    const blob = await rasterToWebp(decoded, maxEdge, quality);
    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${base}.webp`, { type: "image/webp", lastModified: Date.now() });
  } finally {
    decoded.bitmap?.close();
    decoded.cleanup?.();
  }
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** 1 = аль хэдийн зөв чигтэй. 2–8 = JPEG EXIF-ийг canvas дээр өөрсдөө эргүүлнэ. */
  orientation: number;
  bitmap?: ImageBitmap;
  cleanup?: () => void;
};

/**
 * Сонгосон зураг дэлгэц дээр харагдах чигээрээ (portrait/landscape) орох ёстой.
 * createImageBitmap EXIF-ийг үл тоомсорловол утасны зураг хажуу тийш эргэдэг.
 */
async function decodeForUpload(file: File): Promise<DecodedImage> {
  const exif = await readJpegOrientation(file);

  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    } as ImageBitmapOptions);
    return finishDecode(bitmap, exif, true);
  } catch {
    /* imageOrientation дэмжихгүй эсвэл формат уншигдсангүй */
  }

  try {
    const bitmap = await createImageBitmap(file);
    return finishDecode(bitmap, exif, false);
  } catch {
    /* HEIC гэх мэт — <img> fallback. Дэлгэцтэй ижил decode, чиг зөв. */
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await loadHtmlImage(url);
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      orientation: 1,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function finishDecode(bitmap: ImageBitmap, exif: number, requestedFromImage: boolean): DecodedImage {
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    orientation: resolveOrientation(bitmap.width, bitmap.height, exif, requestedFromImage),
    bitmap,
  };
}

/**
 * EXIF 5–8 нь өргөн/өндрийг солино. Bitmap аль хэдийн portrait бол браузер эргүүлсэн.
 * 2–4-ийг зөвхөн from-image ажиллаагүй үед гараар хийнэ — давхар эргүүлэхгүй.
 */
function resolveOrientation(
  width: number,
  height: number,
  exif: number,
  requestedFromImage: boolean,
): number {
  if (exif <= 1) return 1;
  if (exif >= 5 && exif <= 8) {
    return width >= height ? exif : 1;
  }
  return requestedFromImage ? 1 : exif;
}

async function rasterToWebp(decoded: DecodedImage, maxEdge: number, quality: number): Promise<Blob> {
  const { source, width: srcW, height: srcH, orientation } = decoded;
  const visual =
    orientation >= 5 ? { width: srcH, height: srcW } : { width: srcW, height: srcH };
  const fitted = fitSize(visual.width, visual.height, maxEdge);
  const scale = fitted.width / visual.width;
  const drawW = Math.max(1, Math.round(srcW * scale));
  const drawH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = fitted.width;
  canvas.height = fitted.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Зураг боловсруулж чадсангүй.");

  applyExifTransform(ctx, orientation, drawW, drawH);
  ctx.drawImage(source, 0, 0, drawW, drawH);
  return canvasToWebp(canvas, quality);
}

/** JPEG EXIF Orientation — canvas.transform-д зориулсан стандарт матриц. */
function applyExifTransform(
  ctx: CanvasRenderingContext2D,
  orientation: number,
  srcW: number,
  srcH: number,
): void {
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, srcW, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, srcW, srcH);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, srcH);
      break;
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.transform(0, 1, -1, 0, srcH, 0);
      break;
    case 7:
      ctx.transform(0, -1, -1, 0, srcH, srcW);
      break;
    case 8:
      ctx.transform(0, -1, 1, 0, 0, srcW);
      break;
    default:
      break;
  }
}

async function readJpegOrientation(file: File): Promise<number> {
  if (!/jpe?g/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return 1;
  try {
    const buf = await file.slice(0, 128 * 1024).arrayBuffer();
    return parseJpegOrientation(buf);
  } catch {
    return 1;
  }
}

function parseJpegOrientation(buf: ArrayBuffer): number {
  const view = new DataView(buf);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    offset += 2;
    if (marker === 0xda || marker === 0xd9) break;
    if (offset + 2 > view.byteLength) break;
    const size = view.getUint16(offset);
    if (size < 2) break;
    if (marker === 0xe1 && offset + size <= view.byteLength) {
      const value = readExifOrientationTag(view, offset + 2, size - 2);
      if (value) return value;
    }
    offset += size;
  }
  return 1;
}

function readExifOrientationTag(view: DataView, start: number, length: number): number | null {
  if (length < 14) return null;
  if (view.getUint32(start) !== 0x45786966) return null;
  const tiff = start + 6;
  if (tiff + 8 > view.byteLength) return null;
  const endian = view.getUint16(tiff);
  const little = endian === 0x4949;
  if (!little && endian !== 0x4d4d) return null;
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);
  if (u16(tiff + 2) !== 0x002a) return null;
  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 + 2 > view.byteLength) return null;
  const entries = u16(ifd0);
  for (let i = 0; i < entries; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      if (value >= 1 && value <= 8) return value;
    }
  }
  return null;
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
