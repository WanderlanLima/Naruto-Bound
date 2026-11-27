import React, { useEffect, useRef } from 'react';
import type { NinjaRosterEntry } from '../types/shinobi';

interface SpritePreviewProps {
  ninja: NinjaRosterEntry;
  height: number;
  className?: string;
}

/**
 * Renders a lightweight animated idle preview directly on canvas at the ninja's real FPS,
 * anchoring the character cleanly by feet without CSS sprite-step distortion.
 */
export const SpritePreview: React.FC<SpritePreviewProps> = ({ ninja, height, className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const sheetUrl = ninja.previewIdleSheetUrl;
    const meta = ninja.previewIdleMeta;
    if (!canvas || !sheetUrl || !meta) return;

    let rafId = 0;
    let alive = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      if (!alive) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const fw = Math.max(1, meta.fw);
      const fh = Math.max(1, meta.fh);
      const aspect = fw / fh;
      const drawH = Math.max(48, height);
      const drawW = Math.max(48, Math.round(drawH * aspect));

      canvas.width = Math.round(drawW * dpr);
      canvas.height = Math.round(drawH * dpr);
      canvas.style.width = `${drawW}px`;
      canvas.style.height = `${drawH}px`;

      const frameCount = Math.max(1, meta.frames?.length || meta.n || 1);
      const durMs = Math.max(200, meta.durationMs || Math.round((frameCount / (meta.fps || 24)) * 1000));
      const cols = Math.max(1, meta.cols || Math.floor(img.naturalWidth / fw) || 1);
      const t0 = performance.now();
      let drawnIdx = -1;

      const draw = (now: number) => {
        if (!alive) return;
        const elapsed = (now - t0) % durMs;
        const idx = Math.min(frameCount - 1, Math.floor((elapsed / durMs) * frameCount));
        // Only repaint when the animation actually advances a frame
        if (idx === drawnIdx) {
          rafId = requestAnimationFrame(draw);
          return;
        }
        drawnIdx = idx;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, drawW, drawH);

        const frame = meta.frames?.[idx];
        if (frame && frame.pageIndex === 0) {
          if (frame.rotated) {
            ctx.save();
            ctx.translate(0, drawH);
            ctx.rotate(-Math.PI / 2);
            ctx.drawImage(img, frame.x, frame.y, frame.h, frame.w, 0, 0, drawH, drawW);
            ctx.restore();
          } else {
            ctx.drawImage(img, frame.x, frame.y, frame.w, frame.h, 0, 0, drawW, drawH);
          }
        } else {
          const sx = (idx % cols) * fw;
          const sy = Math.floor(idx / cols) * fh;
          ctx.drawImage(img, sx, sy, fw, fh, 0, 0, drawW, drawH);
        }

        rafId = requestAnimationFrame(draw);
      };

      rafId = requestAnimationFrame(draw);
    };

    img.src = sheetUrl;
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
    };
  }, [ninja.previewIdleSheetUrl, ninja.previewIdleMeta, height]);

  return <canvas ref={canvasRef} className={`block shrink-0 ${className}`} />;
};
