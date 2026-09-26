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
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Камер нээж байна…");

  useEffect(() => {
    if (paused) return;
    const video = videoRef.current;
    if (!video) return;

    let controls: IScannerControls | null = null;
    let cancelled = false;
    let stream: MediaStream | null = null;
    const reader = new BrowserQRCodeReader();
    let last = "";
    let lastAt = 0;

    async function openStream(): Promise<MediaStream> {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("no-media");
      }
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: "environment" },
        });
      } catch {
        return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }
    }

    async function start(preview: HTMLVideoElement) {
      const hung = window.setTimeout(() => {
        if (!cancelled && preview.videoWidth === 0) {
          setError(
            "Камер нээгдсэнгүй. Зөвшөөрлөө шалгаад дахин оролдох эсвэл кодыг гараар оруулна уу.",
          );
        }
      }, 12000);
      try {
        setStatus("Камерын зөвшөөрөл хүсэж байна…");
        stream = await openStream();
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        preview.setAttribute("playsinline", "true");
        preview.setAttribute("webkit-playsinline", "true");
        preview.muted = true;
        preview.srcObject = stream;
        await preview.play();
        if (cancelled) return;
        setStatus("QR-ийг хүрээнд оруулна уу.");
        controls = await reader.decodeFromStream(stream, preview, (result) => {
          if (!result || cancelled) return;
          const text = result.getText();
          const now = Date.now();
          if (text === last && now - lastAt < 1500) return;
          last = text;
          lastAt = now;
          onResultRef.current(text);
        });
      } catch {
        if (!cancelled) {
          setError(
            "Камер нээгдсэнгүй. Зөвшөөрлөө шалгаад дахин оролдох эсвэл кодыг гараар оруулна уу.",
          );
        }
        stream?.getTracks().forEach((track) => track.stop());
      } finally {
        window.clearTimeout(hung);
      }
    }

    void start(video);

    return () => {
      cancelled = true;
      controls?.stop();
      const attached = video.srcObject;
      if (attached instanceof MediaStream) {
        attached.getTracks().forEach((track) => track.stop());
      }
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, [paused]);

  return (
    <div>
      {error ? (
        <div className="flex min-h-[96px] items-center justify-center rounded-[12px] border border-line bg-surface px-4 py-5 text-center text-[13px] leading-[1.45] text-ink-2">
          {error}
        </div>
      ) : (
        <p className="mt-0 mb-2 text-center text-[13px] text-muted">{status}</p>
      )}
      <div
        className={
          error
            ? "hidden"
            : "relative mx-auto aspect-square w-full max-w-[220px] overflow-hidden rounded-[12px] border border-line bg-ink"
        }
      >
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          muted
          playsInline
          autoPlay
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-1/2 w-1/2 rounded-[12px] border-2 border-white/80" />
        </div>
      </div>
    </div>
  );
}
