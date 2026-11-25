import type {
  AnchorMetrics,
  AnimationEventsTimelineMs,
  CompiledAnimation,
  FrameEmitterPoint,
  SpriteFrameRect,
} from '../types/shinobi';

function normalizeEventsMs(raw: any): AnimationEventsTimelineMs {
  const hits: AnimationEventsTimelineMs['hits'] = Array.isArray(raw?.hits)
    ? raw.hits.map((h: any) => ({
        timeMs: Math.max(0, Number(h.timeMs ?? Math.round((h.startTimeSec || 0) * 1000)) || 0),
        spineId: String(h.spineId || ''),
        effectAnim: String(h.effectAnim || h.animName || ''),
        layer: (h.layer === 'behind' ? 'behind' : 'front') as 'behind' | 'front',
      }))
    : [];

  const particles: AnimationEventsTimelineMs['particles'] = Array.isArray(raw?.particles)
    ? raw.particles.map((p: any) => ({
        timeMs: Math.max(0, Number(p.timeMs ?? Math.round((p.startTimeSec || 0) * 1000)) || 0),
        spineId: String(p.spineId || ''),
        effectAnim: String(p.effectAnim || p.animName || ''),
        layer: (p.layer === 'behind' ? 'behind' : 'front') as 'behind' | 'front',
      }))
    : [];

  const sounds: AnimationEventsTimelineMs['sounds'] = Array.isArray(raw?.sounds)
    ? raw.sounds.map((s: any) => ({
        timeMs: Math.max(0, Number(s.timeMs ?? Math.round((s.timeSec || 0) * 1000)) || 0),
        soundName: String(s.soundName || s.name || ''),
      }))
    : [];

  const videos: AnimationEventsTimelineMs['videos'] = Array.isArray(raw?.videos)
    ? raw.videos.map((v: any) => ({
        timeMs: Math.max(0, Number(v.timeMs ?? Math.round((v.startTimeSec || 0) * 1000)) || 0),
        key: String(v.key || v.name || ''),
      }))
    : [];

  hits.sort((a, b) => a.timeMs - b.timeMs);
  particles.sort((a, b) => a.timeMs - b.timeMs);
  sounds.sort((a, b) => a.timeMs - b.timeMs);
  videos.sort((a, b) => a.timeMs - b.timeMs);

  return { hits, particles, sounds, videos };
}

function normalizeEmitterPoints(raw: any): FrameEmitterPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((pt) => pt && typeof pt.x === 'number' && typeof pt.y === 'number')
    .map((pt, idx) => ({
      frame: typeof pt.frame === 'number' ? pt.frame : idx,
      timeMs: typeof pt.timeMs === 'number' ? pt.timeMs : 0,
      x: pt.x,
      y: pt.y,
      bone: typeof pt.bone === 'string' ? pt.bone : undefined,
      source: pt.source,
    }))
    .sort((a, b) => a.frame - b.frame);
}

/**
 * Parses BOTH TexturePacker JSON Hash (single sheet) AND Phaser 3 MultiAtlas JSON (`textures[]`)
 * produced by Shinobi Sprite Studio (`gameEngineExportMeta.ts` / `gameExporter.ts` / `completeCharacterExporter.ts`).
 */
export function parseSpritesheetJson(
  json: any,
  slug: string,
  baseDir: string,
  fallbackImageFiles?: string[],
  defaultWorldToPixelScale = 1
): CompiledAnimation {
  const meta = json?.meta || {};
  const frames: SpriteFrameRect[] = [];
  const pageFiles: string[] = [];

  const resolvePagePath = (filename: string): string => {
    const clean = filename.replace(/^\/+/, '');
    if (!baseDir) return clean;
    if (clean.startsWith(baseDir)) return clean;
    return `${baseDir.replace(/\/+$/, '')}/${clean}`;
  };

  let cellWidth = Number(meta.cellWidth || meta.grid?.cellWidth || 0);
  let cellHeight = Number(meta.cellHeight || meta.grid?.cellHeight || 0);
  const fps = Math.max(1, Number(meta.fps) || 24);
  const defaultFrameDurMs = Number(meta.frameDurationMs) || Math.round(1000 / fps);

  if (Array.isArray(json?.textures) && json.textures.length > 0) {
    // Phaser 3 MultiAtlas format (multiple <= 2048x2048 PNG pages)
    const frameByName = new Map<string, SpriteFrameRect>();
    json.textures.forEach((tex: any, pageIndex: number) => {
      const imgFile = String(tex.image || fallbackImageFiles?.[pageIndex] || `${slug}_${pageIndex}.png`);
      pageFiles.push(resolvePagePath(imgFile));

      const texFrames = Array.isArray(tex.frames) ? tex.frames : [];
      for (const f of texFrames) {
        const fr = f.frame || { x: 0, y: 0, w: cellWidth || 160, h: cellHeight || 160 };
        const ss = f.sourceSize || { w: fr.w, h: fr.h };
        const sss = f.spriteSourceSize || { x: 0, y: 0, w: fr.w, h: fr.h };
        if (!cellWidth) cellWidth = ss.w || fr.w;
        if (!cellHeight) cellHeight = ss.h || fr.h;
        const rect: SpriteFrameRect = {
          filename: String(f.filename || `${slug}_${frameByName.size}`),
          pageIndex,
          x: fr.x || 0,
          y: fr.y || 0,
          w: fr.w || cellWidth,
          h: fr.h || cellHeight,
          rotated: Boolean(f.rotated),
          trimmed: Boolean(f.trimmed),
          spriteSourceSize: sss,
          sourceSize: ss,
          pivot: f.pivot ? { x: Number(f.pivot.x), y: Number(f.pivot.y) } : undefined,
          durationMs: Number(f.duration) || defaultFrameDurMs,
        };
        frameByName.set(rect.filename, rect);
      }
    });

    const animOrder: string[] | undefined =
      json.animations?.[slug] ||
      (json.animations && (Object.values(json.animations)[0] as string[] | undefined));

    if (Array.isArray(animOrder) && animOrder.length > 0) {
      for (const key of animOrder) {
        const hit = frameByName.get(key);
        if (hit) frames.push(hit);
      }
    }
    if (frames.length === 0) {
      const sorted = Array.from(frameByName.values()).sort((a, b) =>
        a.filename.localeCompare(b.filename, undefined, { numeric: true })
      );
      frames.push(...sorted);
    }
  } else if (json?.frames && typeof json.frames === 'object') {
    // TexturePacker JSON Hash (single sheet)
    const imgFile = String(meta.image || fallbackImageFiles?.[0] || `${slug}.png`);
    pageFiles.push(resolvePagePath(imgFile));

    const animOrder: string[] | undefined =
      json.animations?.[slug] ||
      (json.animations && (Object.values(json.animations)[0] as string[] | undefined));
    const keys =
      Array.isArray(animOrder) && animOrder.length > 0
        ? animOrder.filter((k) => Boolean(json.frames[k]))
        : Object.keys(json.frames).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    for (const key of keys) {
      const f = json.frames[key];
      if (!f) continue;
      const fr = f.frame || { x: 0, y: 0, w: cellWidth || 160, h: cellHeight || 160 };
      const ss = f.sourceSize || { w: fr.w, h: fr.h };
      const sss = f.spriteSourceSize || { x: 0, y: 0, w: fr.w, h: fr.h };
      if (!cellWidth) cellWidth = ss.w || fr.w;
      if (!cellHeight) cellHeight = ss.h || fr.h;
      frames.push({
        filename: key,
        pageIndex: 0,
        x: fr.x || 0,
        y: fr.y || 0,
        w: fr.w || cellWidth,
        h: fr.h || cellHeight,
        rotated: Boolean(f.rotated),
        trimmed: Boolean(f.trimmed),
        spriteSourceSize: sss,
        sourceSize: ss,
        pivot: f.pivot ? { x: Number(f.pivot.x), y: Number(f.pivot.y) } : undefined,
        durationMs: Number(f.duration) || defaultFrameDurMs,
      });
    }
  }

  cellWidth = Math.max(1, cellWidth || 160);
  cellHeight = Math.max(1, cellHeight || 160);

  const frameCount = Math.max(1, frames.length || Number(meta.frameCount) || 1);
  const rawDurationMs = Number(meta.durationMs);
  const durationMs =
    Number.isFinite(rawDurationMs) && rawDurationMs > 0
      ? rawDurationMs
      : Math.max(40, Math.round((frameCount / fps) * 1000));

  const rawAnchor = meta.anchor;
  const firstFramePivot = frames[0]?.pivot;
  const hasExplicitAnchor = Boolean(
    rawAnchor &&
      (typeof rawAnchor.pivotPxX === 'number' || typeof rawAnchor.x === 'number')
  );

  const anchorX =
    typeof rawAnchor?.x === 'number'
      ? rawAnchor.x
      : typeof rawAnchor?.pivotPxX === 'number'
        ? rawAnchor.pivotPxX / cellWidth
        : typeof firstFramePivot?.x === 'number'
          ? firstFramePivot.x
          : 0.5;
  const anchorY =
    typeof rawAnchor?.y === 'number'
      ? rawAnchor.y
      : typeof rawAnchor?.pivotPxY === 'number'
        ? rawAnchor.pivotPxY / cellHeight
        : typeof firstFramePivot?.y === 'number'
          ? firstFramePivot.y
          : 0.92;
  const pivotPxX =
    typeof rawAnchor?.pivotPxX === 'number' ? rawAnchor.pivotPxX : anchorX * cellWidth;
  const pivotPxY =
    typeof rawAnchor?.pivotPxY === 'number' ? rawAnchor.pivotPxY : anchorY * cellHeight;
  const worldToPixelScale =
    typeof rawAnchor?.worldToPixelScale === 'number' && rawAnchor.worldToPixelScale > 0
      ? rawAnchor.worldToPixelScale
      : defaultWorldToPixelScale;

  const anchor: AnchorMetrics = {
    anchorX,
    anchorY,
    anchorYBottom: typeof rawAnchor?.yBottomLeft === 'number' ? rawAnchor.yBottomLeft : 1 - anchorY,
    pivotPxX,
    pivotPxY,
    worldToPixelScale,
  };

  return {
    slug,
    originalName: String(meta.animation || slug),
    fps,
    frameCount,
    durationMs,
    cellWidth,
    cellHeight,
    anchor,
    hasExplicitAnchor,
    frames,
    pageFiles: pageFiles.length > 0 ? pageFiles : fallbackImageFiles || [],
    eventsMs: normalizeEventsMs(meta.eventsMs),
    emitterPoints: normalizeEmitterPoints(meta.emitterPoints),
  };
}

/**
 * Builds a CompiledAnimation from legacy grid parameters (used for built-in ninjas or
 * spritesheets lacking a TexturePacker JSON file).
 */
export function buildGridCompiledAnimation(params: {
  slug: string;
  originalName?: string;
  imageFile: string;
  fw: number;
  fh: number;
  n: number;
  cols: number;
  fps?: number;
  durationMs?: number;
  eventsMs?: AnimationEventsTimelineMs;
  worldToPixelScale?: number;
}): CompiledAnimation {
  const fps = Math.max(1, params.fps || 24);
  const frameCount = Math.max(1, params.n);
  const durationMs = params.durationMs || Math.max(80, Math.round((frameCount / fps) * 1000));
  const frameDurationMs = Math.round(durationMs / frameCount);
  const cols = Math.max(1, params.cols);
  const frames: SpriteFrameRect[] = [];

  for (let i = 0; i < frameCount; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    frames.push({
      filename: `${params.slug}_${String(i).padStart(3, '0')}.png`,
      pageIndex: 0,
      x: col * params.fw,
      y: row * params.fh,
      w: params.fw,
      h: params.fh,
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: params.fw, h: params.fh },
      sourceSize: { w: params.fw, h: params.fh },
      durationMs: frameDurationMs,
    });
  }

  return {
    slug: params.slug,
    originalName: params.originalName || params.slug,
    fps,
    frameCount,
    durationMs,
    cellWidth: params.fw,
    cellHeight: params.fh,
    anchor: {
      anchorX: 0.5,
      anchorY: 0.96,
      anchorYBottom: 0.04,
      pivotPxX: params.fw * 0.5,
      pivotPxY: params.fh * 0.96,
      worldToPixelScale: params.worldToPixelScale || 1,
    },
    hasExplicitAnchor: false,
    frames,
    pageFiles: [params.imageFile],
    eventsMs: params.eventsMs || { hits: [], particles: [], sounds: [], videos: [] },
    emitterPoints: [],
    legacyCols: cols,
  };
}

let probeCanvas: HTMLCanvasElement | null = null;
let probeCtx: CanvasRenderingContext2D | null = null;

/**
 * For legacy spritesheets that didn't ship `pivotPxX`/`pivotPxY` in JSON, scans opaque
 * pixel bounds of frame 0 (and mid-frame) to anchor the character's feet accurately on the
 * ground and compute consistent visible body height across states.
 */
export function calibrateLegacyPivotFromImage(
  anim: CompiledAnimation,
  idleRefVisibleH?: number
): { visibleHeight: number; visibleWidth: number } {
  const fallback = { visibleHeight: anim.cellHeight * 0.88, visibleWidth: anim.cellWidth * 0.6 };
  const img = anim.pages?.[0];
  const f0 = anim.frames[0];
  if (!img || !f0 || img.naturalWidth === 0) return fallback;

  try {
    if (!probeCanvas) {
      probeCanvas = document.createElement('canvas');
      probeCtx = probeCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!probeCtx) return fallback;

    const w = Math.min(512, Math.max(1, f0.w));
    const h = Math.min(512, Math.max(1, f0.h));
    const scaleX = w / Math.max(1, f0.w);
    const scaleY = h / Math.max(1, f0.h);
    probeCanvas.width = w;
    probeCanvas.height = h;
    probeCtx.clearRect(0, 0, w, h);
    probeCtx.drawImage(img, f0.x, f0.y, f0.w, f0.h, 0, 0, w, h);

    const data = probeCtx.getImageData(0, 0, w, h).data;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;

    for (let y = 0; y < h; y++) {
      const rowOff = y * w * 4;
      for (let x = 0; x < w; x++) {
        if (data[rowOff + x * 4 + 3] > 28) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxY <= minY || maxX <= minX) return fallback;

    // Find feet center X specifically along the bottom 12% of the opaque silhouette
    const footTop = Math.max(minY, Math.floor(maxY - (maxY - minY) * 0.14));
    let footSumX = 0;
    let footCount = 0;
    for (let y = footTop; y <= maxY; y++) {
      const rowOff = y * w * 4;
      for (let x = minX; x <= maxX; x++) {
        if (data[rowOff + x * 4 + 3] > 28) {
          footSumX += x;
          footCount++;
        }
      }
    }

    const footCenterX = footCount > 0 ? footSumX / footCount : (minX + maxX) / 2;
    const visH = (maxY - minY + 1) / scaleY;
    const visW = (maxX - minX + 1) / scaleX;

    if (!anim.hasExplicitAnchor) {
      const pivotPxX = footCenterX / scaleX;
      const pivotPxY = (maxY + 1) / scaleY;
      anim.anchor = {
        anchorX: pivotPxX / anim.cellWidth,
        anchorY: pivotPxY / anim.cellHeight,
        anchorYBottom: 1 - pivotPxY / anim.cellHeight,
        pivotPxX,
        pivotPxY,
        worldToPixelScale:
          idleRefVisibleH && idleRefVisibleH > 0 && anim.slug === 'run'
            ? Math.max(0.65, Math.min(1.45, visH / idleRefVisibleH))
            : anim.anchor.worldToPixelScale || 1,
        computedFromOpaque: true,
      };
    }

    return { visibleHeight: visH, visibleWidth: visW };
  } catch {
    return fallback;
  }
}

/**
 * Returns the frame index for an animation at a given elapsed millisecond timestamp.
 */
export function getAnimationFrameIndex(
  anim: CompiledAnimation,
  elapsedMs: number,
  loop: boolean
): number {
  const count = Math.max(1, anim.frames.length || anim.frameCount);
  if (count <= 1) return 0;
  const dur = Math.max(1, anim.durationMs);
  const t = Math.max(0, elapsedMs);
  const progress = loop ? (t % dur) / dur : Math.min(0.99999, t / dur);
  return Math.min(count - 1, Math.floor(progress * count));
}

let silCanvas: HTMLCanvasElement | null = null;
let silCtx: CanvasRenderingContext2D | null = null;

/**
 * Draws a CompiledAnimation frame anchored EXACTLY at its feet pivot `(pivotPxX, pivotPxY)`
 * onto ground position `(worldX, worldY)` with consistent character proportions across all
 * animations (`charWorldScale / anim.anchor.worldToPixelScale`).
 */
export function drawCompiledAnimationFrame(params: {
  ctx: CanvasRenderingContext2D;
  anim: CompiledAnimation;
  elapsedMs: number;
  loop: boolean;
  worldX: number;
  worldY: number;
  /** Direction on battlefield: 1 = facing right, -1 = facing left */
  dir: 1 | -1;
  /** Native facing direction of exported spritesheet */
  nativeFacing: 'right' | 'left';
  /** Consistent Spine-world-to-battlefield scale computed from idle */
  charWorldScale: number;
  alpha?: number;
  silhouetteColor?: string | null;
}): void {
  const {
    ctx,
    anim,
    elapsedMs,
    loop,
    worldX,
    worldY,
    dir,
    nativeFacing,
    charWorldScale,
    alpha = 1,
    silhouetteColor,
  } = params;

  const frameIdx = getAnimationFrameIndex(anim, elapsedMs, loop);
  const frame = anim.frames[frameIdx];
  if (!frame) return;

  const pageImg = anim.pages?.[frame.pageIndex];
  if (!pageImg || !pageImg.complete || pageImg.naturalWidth === 0) return;

  const animScale = charWorldScale / Math.max(0.05, anim.anchor.worldToPixelScale || 1);
  const facingSign = nativeFacing === 'left' ? -1 : 1;
  const scaleX = dir * facingSign * animScale;
  const scaleY = animScale;

  const pivotX = anim.anchor.pivotPxX;
  const pivotY = anim.anchor.pivotPxY;
  const sss = frame.spriteSourceSize || { x: 0, y: 0, w: frame.w, h: frame.h };
  const destX = sss.x - pivotX;
  const destY = sss.y - pivotY;

  ctx.save();
  ctx.translate(worldX, worldY);
  ctx.scale(scaleX, scaleY);
  if (alpha < 1) ctx.globalAlpha *= alpha;

  if (silhouetteColor) {
    if (!silCanvas) {
      silCanvas = document.createElement('canvas');
      silCtx = silCanvas.getContext('2d');
    }
    if (silCtx && silCanvas) {
      const sw = frame.rotated ? frame.h : frame.w;
      const sh = frame.rotated ? frame.w : frame.h;
      silCanvas.width = Math.max(1, sw);
      silCanvas.height = Math.max(1, sh);
      silCtx.clearRect(0, 0, sw, sh);
      if (frame.rotated) {
        silCtx.save();
        silCtx.translate(0, sh);
        silCtx.rotate(-Math.PI / 2);
        silCtx.drawImage(pageImg, frame.x, frame.y, frame.h, frame.w, 0, 0, frame.h, frame.w);
        silCtx.restore();
      } else {
        silCtx.drawImage(pageImg, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
      }
      silCtx.globalCompositeOperation = 'source-in';
      silCtx.fillStyle = silhouetteColor;
      silCtx.fillRect(0, 0, sw, sh);
      silCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(silCanvas, 0, 0, sw, sh, destX, destY, sss.w, sss.h);
      ctx.restore();
      return;
    }
  }

  if (frame.rotated) {
    // TexturePacker rotated 90deg CW in atlas -> rotate -90deg CCW when drawing
    ctx.translate(destX, destY + sss.h);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(pageImg, frame.x, frame.y, frame.h, frame.w, 0, 0, sss.h, sss.w);
  } else {
    ctx.drawImage(pageImg, frame.x, frame.y, frame.w, frame.h, destX, destY, sss.w, sss.h);
  }

  ctx.restore();
}

/**
 * Returns the exact world coordinates `(x, y)` of the character's weapon/hand emitter point
 * at the given elapsed time in the animation, or a sensible upper-body fallback if the
 * animation does not define `emitterPoints`.
 */
export function sampleEmitterWorldPosition(params: {
  anim?: CompiledAnimation;
  elapsedMs: number;
  worldX: number;
  worldY: number;
  dir: 1 | -1;
  nativeFacing: 'right' | 'left';
  charWorldScale: number;
  bodyHeight: number;
}): { x: number; y: number } {
  const { anim, elapsedMs, worldX, worldY, dir, nativeFacing, charWorldScale, bodyHeight } = params;
  if (!anim || !anim.emitterPoints || anim.emitterPoints.length === 0) {
    return {
      x: worldX + dir * 20,
      y: worldY - bodyHeight * 0.62,
    };
  }

  const pts = anim.emitterPoints;
  const frameIdx = getAnimationFrameIndex(anim, elapsedMs, false);
  let pt = pts.find((p) => p.frame === frameIdx);
  if (!pt) {
    // Pick nearest emitter point by timeMs
    let best = pts[0];
    let bestDiff = Math.abs(pts[0].timeMs - elapsedMs);
    for (let i = 1; i < pts.length; i++) {
      const diff = Math.abs(pts[i].timeMs - elapsedMs);
      if (diff < bestDiff) {
        best = pts[i];
        bestDiff = diff;
      }
    }
    pt = best;
  }

  const animScale = charWorldScale / Math.max(0.05, anim.anchor.worldToPixelScale || 1);
  // Note: emitterPoints.x is already exported in `nativeFacing` (+x right),
  // so flipping by `dir * facingSign` aligns it to the active battlefield facing direction.
  const facingSign = nativeFacing === 'left' ? -1 : 1;
  return {
    x: worldX + dir * facingSign * pt.x * animScale,
    y: worldY + pt.y * animScale,
  };
}

/**
 * Helper to load an HTMLImageElement with clean error tolerance.
 */
export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}
