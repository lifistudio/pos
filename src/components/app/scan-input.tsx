"use client";

import { RiBarcodeLine, RiCameraLine, RiCloseLine } from "@remixicon/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/base/buttons/button";
import { InputBase } from "@/components/base/input/input";

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts?: { formats?: string[] }) => Detector;

const noopSubscribe = () => () => {};

function getDetector(): DetectorCtor | null {
  return typeof window !== "undefined" && "BarcodeDetector" in window
    ? ((window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector ?? null)
    : null;
}

/**
 * Input scan barcode/SKU.
 * - Scanner USB/Bluetooth bekerja sebagai keyboard: kode diketik cepat lalu Enter → `onScan`.
 * - Tombol kamera muncul bila browser mendukung BarcodeDetector (Chrome Android, Safari/Chrome macOS).
 */
export function ScanInput({
  onScan,
  placeholder = "Scan barcode atau ketik SKU, lalu Enter",
  autoFocus,
  disabled,
}: {
  onScan: (code: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(false);
  // Dukungan kamera hanya diketahui di browser; server selalu menganggap tidak ada.
  const supported = useSyncExternalStore(noopSubscribe, () => getDetector() !== null, () => false);

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex w-full items-center gap-2">
        <InputBase
          aria-label="Scan barcode atau SKU"
          placeholder={placeholder}
          leadingIcon={RiBarcodeLine}
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const code = value.trim();
              if (code) onScan(code);
              setValue("");
            }
          }}
          fieldClassName="flex-1"
          className="font-mono text-body-medium placeholder:font-sans"
        />
        {supported && (
          <Button
            type="button"
            variant="secondary"
            iconOnly
            leadingIcon={camera ? RiCloseLine : RiCameraLine}
            aria-label={camera ? "Tutup kamera" : "Scan dengan kamera"}
            onClick={() => setCamera((v) => !v)}
          />
        )}
      </div>
      {camera && (
        <CameraScanner
          onDetect={(code) => {
            onScan(code);
            setCamera(false);
          }}
        />
      )}
    </div>
  );
}

function CameraScanner({ onDetect }: { onDetect: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const Ctor = getDetector();
    if (!Ctor) return;
    const detector = new Ctor({ formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "qr_code"] });
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = videoRef.current;
        if (!video || stopped) return;
        video.srcObject = stream;
        await video.play();
        const tick = async () => {
          if (stopped) return;
          try {
            const [hit] = await detector.detect(video);
            if (hit?.rawValue) return onDetect(hit.rawValue);
          } catch {}
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setError("Kamera tidak bisa dibuka. Izinkan akses kamera di browser, atau gunakan scanner.");
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetect]);

  return error ? (
    <p role="alert" className="text-body-medium text-text-error-primary">
      {error}
    </p>
  ) : (
    <div className="relative overflow-hidden rounded-2xl bg-black">
      <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
      <div className="pointer-events-none absolute inset-x-[15%] top-1/2 h-px -translate-y-1/2 bg-accent-400 shadow-[0_0_0_1px_rgb(0_0_0/0.2)]" aria-hidden />
      <p className="absolute inset-x-0 bottom-0 bg-black/50 px-3 py-2 text-center text-body-2-medium text-white">Arahkan barcode ke garis</p>
    </div>
  );
}
