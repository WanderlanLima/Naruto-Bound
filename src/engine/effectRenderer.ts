import type { CompiledAnimation, LegacySpineData } from '../types/shinobi';
import { combatImages } from './imageCache';
import { drawCompiledAnimationFrame } from './spriteAnimator';

export interface ActiveEffectInstance {
  id: number;
  kind: 'spritesheet' | 'legacy-spine';
  layer: 'behind' | 'front';
  /** Attached target or static world coordinates */
  anchorMode: 'attacker' | 'target' | 'world';
  fighterIndex?: number;
  worldX: number;
  worldY: number;
  dir: 1 | -1;
  nativeFacing: 'right' | 'left';
  charWorldScale: number;
  startMs: number;
  durationMs: number;
  sheetAnim?: CompiledAnimation;
  spineData?: LegacySpineData;
  spineAnimName?: string;
}

/* ---------- Fixed Legacy Spine Renderer (supports rotate, RGB tint, additive blend) ---------- */

/* Tinted atlas pieces are built once and reused instead of being recomposed every frame */
const TINT_CACHE_MAX_PIXELS = 6_000_000;
const TINT_STEPS = 20;
const tintCache = new Map<string, HTMLCanvasElement>();
const imageIds = new WeakMap<HTMLImageElement, number>();
let tintCachePixels = 0;
let nextImageId = 0;

export function clearTintCache(): void {
  tintCache.clear();
  tintCachePixels = 0;
}

function parseHexRgba(s?: string): [number, number, number, number] {
  const hex = s || 'ffffffff';
  return [
    hex.length >= 2 ? parseInt(hex.slice(0, 2), 16) / 255 : 1,
    hex.length >= 4 ? parseInt(hex.slice(2, 4), 16) / 255 : 1,
    hex.length >= 6 ? parseInt(hex.slice(4, 6), 16) / 255 : 1,
    hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
  ];
}

function solveBezier(f: any, t: number): number {
  const c = f.curve;
  if (c === undefined) return t;
  if (c === 'stepped') return 0;
  const x1 = Number(c);
  const y1 = f.c2 === undefined ? 0 : Number(f.c2);
  const x2 = f.c3 === undefined ? 1 : Number(f.c3);
  const y2 = f.c4 === undefined ? 1 : Number(f.c4);
  let lo = 0;
  let hi = 1;
  let s = t;
  for (let i = 0; i < 14; i++) {
    s = (lo + hi) / 2;
    const q = 1 - s;
    const x = 3 * q * q * s * x1 + 3 * q * s * s * x2 + s * s * s;
    if (x < t) lo = s;
    else hi = s;
  }
  const q = 1 - s;
  return 3 * q * q * s * y1 + 3 * q * s * s * y2 + s * s * s;
}

function sampleTimeline(
  frames: any[] | undefined,
  t: number,
  fields: string[],
  defaults: number[],
  isAngle = false
): number[] | null {
  if (!frames || frames.length === 0) return null;
  const getVal = (f: any, j: number) => (f[fields[j]] === undefined ? defaults[j] : f[fields[j]]);
  const t0 = frames[0].time || 0;
  if (t < t0 - 1e-5) return [...defaults];
  if (t <= t0) return fields.map((_, j) => getVal(frames[0], j));
  const last = frames[frames.length - 1];
  if (t >= (last.time || 0)) return fields.map((_, j) => getVal(last, j));
  let i = 0;
  while (i < frames.length - 2 && (frames[i + 1].time || 0) <= t) i++;
  const a = frames[i];
  const b = frames[i + 1];
  const dt = Math.max(0.0001, (b.time || 0) - (a.time || 0));
  const p = solveBezier(a, (t - (a.time || 0)) / dt);
  return fields.map((_, j) => {
    const x = getVal(a, j);
    let d = getVal(b, j) - x;
    if (isAngle) d -= Math.floor((d + 180) / 360) * 360;
    return x + d * p;
  });
}

function sampleColorTimeline(frames: any[], t: number): [number, number, number, number] {
  const cached =
    (frames as any)._parsed ||
    ((frames as any)._parsed = frames.map((f) => {
      const rgba = parseHexRgba(f.color);
      return {
        time: f.time || 0,
        curve: f.curve,
        c2: f.c2,
        c3: f.c3,
        c4: f.c4,
        r: rgba[0],
        g: rgba[1],
        b: rgba[2],
        a: rgba[3],
      };
    }));
  const res = sampleTimeline(cached, t, ['r', 'g', 'b', 'a'], [1, 1, 1, 1]);
  return (res as [number, number, number, number]) || [1, 1, 1, 1];
}

function computeSpinePose(sp: LegacySpineData, animName: string, t: number) {
  const animBones = (sp.anims[animName] || {}).bones || {};
  const world: Array<{ a: number; b: number; c: number; d: number; x: number; y: number }> = [];
  const DEG = Math.PI / 180;

  sp.bones.forEach((b, i) => {
    const tl = animBones[b.name] || {};
    let x = b.x || 0;
    let y = b.y || 0;
    let r = b.rotation || 0;
    let sx = b.scaleX === undefined ? 1 : b.scaleX;
    let sy = b.scaleY === undefined ? 1 : b.scaleY;
    let hx = b.shearX || 0;
    let hy = b.shearY || 0;

    const tr = sampleTimeline(tl.translate, t, ['x', 'y'], [0, 0]);
    if (tr) {
      x += tr[0];
      y += tr[1];
    }
    const rot = sampleTimeline(tl.rotate, t, ['angle'], [0], true);
    if (rot) r += rot[0];
    const sc = sampleTimeline(tl.scale, t, ['x', 'y'], [1, 1]);
    if (sc) {
      sx *= sc[0];
      sy *= sc[1];
    }
    const sh = sampleTimeline(tl.shear, t, ['x', 'y'], [0, 0]);
    if (sh) {
      hx += sh[0];
      hy += sh[1];
    }

    const a = Math.cos((r + hx) * DEG) * sx;
    const bb = Math.cos((r + 90 + hy) * DEG) * sy;
    const c = Math.sin((r + hx) * DEG) * sx;
    const d = Math.sin((r + 90 + hy) * DEG) * sy;
    const parent = b.parent === undefined ? null : world[sp.bi[b.parent]];

    world[i] = parent
      ? {
          a: parent.a * a + parent.b * c,
          b: parent.a * bb + parent.b * d,
          c: parent.c * a + parent.d * c,
          d: parent.c * bb + parent.d * d,
          x: parent.a * x + parent.b * y + parent.x,
          y: parent.c * x + parent.d * y + parent.y,
        }
      : { a, b: bb, c, d, x, y };
  });

  return world;
}

function getTintedPiece(
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  isRot90: boolean,
  r: number,
  g: number,
  b: number
): HTMLCanvasElement | null {
  let id = imageIds.get(img);
  if (id === undefined) imageIds.set(img, (id = ++nextImageId));
  const step = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * TINT_STEPS);
  const [qr, qg, qb] = [step(r), step(g), step(b)];
  const key = `${id}:${sx},${sy},${sw},${sh}:${qr},${qg},${qb}`;
  const hit = tintCache.get(key);
  if (hit) {
    tintCache.delete(key);
    tintCache.set(key, hit);
    return hit;
  }

  const piece = document.createElement('canvas');
  piece.width = Math.max(1, Math.ceil(sw));
  piece.height = Math.max(1, Math.ceil(sh));
  const g2d = piece.getContext('2d');
  if (!g2d) return null;
  const source = combatImages.source(img);
  const paintRegion = () => {
    if (isRot90) {
      g2d.save();
      g2d.translate(0, sh);
      g2d.rotate(-Math.PI / 2);
      g2d.drawImage(source, sx, sy, sh, sw, 0, 0, sh, sw);
      g2d.restore();
    } else {
      g2d.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    }
  };
  paintRegion();
  g2d.globalCompositeOperation = 'multiply';
  const channel = (q: number) => Math.round((q / TINT_STEPS) * 255);
  g2d.fillStyle = `rgb(${channel(qr)},${channel(qg)},${channel(qb)})`;
  g2d.fillRect(0, 0, sw, sh);
  g2d.globalCompositeOperation = 'destination-in';
  paintRegion();

  tintCache.set(key, piece);
  tintCachePixels += piece.width * piece.height;
  for (const [oldKey, old] of tintCache) {
    if (tintCachePixels <= TINT_CACHE_MAX_PIXELS || old === piece) break;
    tintCache.delete(oldKey);
    tintCachePixels -= old.width * old.height;
  }
  return piece;
}

function drawTintedRegion(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  rotated: boolean | number | undefined,
  r: number,
  g: number,
  b: number
) {
  const needsTint = r < 0.96 || g < 0.96 || b < 0.96;
  const isRot90 = rotated === true || rotated === 90;

  if (needsTint && sw > 0 && sh > 0) {
    const piece = getTintedPiece(img, sx, sy, sw, sh, isRot90, r, g, b);
    if (piece) {
      ctx.drawImage(piece, 0, 0, sw, sh, dx, dy, dw, dh);
      return;
    }
  }

  const source = combatImages.source(img);
  if (isRot90) {
    ctx.save();
    ctx.translate(dx, dy + dh);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(source, sx, sy, sh, sw, 0, 0, dh, dw);
    ctx.restore();
  } else {
    ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
  }
}

function drawLegacySpineEffect(
  ctx: CanvasRenderingContext2D,
  eff: ActiveEffectInstance,
  x: number,
  y: number,
  elapsedSec: number
): void {
  const sp = eff.spineData;
  const animName = eff.spineAnimName;
  if (!sp || !animName || !sp.pages || sp.pages.length === 0) return;
  const an = sp.anims[animName];
  if (!an) return;

  const worldBones = computeSpinePose(sp, animName, elapsedSec);
  const scale = eff.charWorldScale;

  for (const s of sp.slots) {
    const sl = (an.slots || {})[s.name] || {};
    let attName = s.attachment;
    if (sl.attachment) {
      let current: any = null;
      for (const kf of sl.attachment) {
        if ((kf.time || 0) <= elapsedSec) current = kf;
        else break;
      }
      if (current) attName = current.name;
    }

    const att = attName && sp.sk[s.name] && sp.sk[s.name][attName];
    if (!att) continue;
    const rg = sp.rg[att.path || att.name || attName];
    if (!rg) continue;
    const pageImg = sp.pages[rg.p];
    if (!pageImg || !pageImg.complete || pageImg.naturalWidth === 0) continue;

    let slotCol = parseHexRgba(s.color);
    if (sl.color) {
      slotCol = sampleColorTimeline(sl.color, elapsedSec);
    } else if (sl.twoColor) {
      // Two-color tint: only the light color (and its alpha) can be reproduced on a 2D canvas
      const light = sl.twoColor._light || (sl.twoColor._light = sl.twoColor.map((k: any) => ({ ...k, color: k.light })));
      slotCol = sampleColorTimeline(light, elapsedSec);
    }
    const attCol = parseHexRgba(att.color);
    const r = slotCol[0] * attCol[0];
    const g = slotCol[1] * attCol[1];
    const b = slotCol[2] * attCol[2];
    const alpha = slotCol[3] * attCol[3];
    if (alpha < 0.01) continue;

    const wb = worldBones[sp.bi[s.bone]];
    if (!wb) continue;

    const ar = ((att.rotation || 0) * Math.PI) / 180;
    const sX = att.scaleX === undefined ? 1 : att.scaleX;
    const sY = att.scaleY === undefined ? 1 : att.scaleY;
    const kx = (att.width || rg.ow || rg.w) / Math.max(1, rg.ow || rg.w);
    const ky = (att.height || rg.oh || rg.h) / Math.max(1, rg.oh || rg.h);

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale * eff.dir, -scale);
    ctx.transform(wb.a, wb.c, wb.b, wb.d, wb.x, wb.y);
    ctx.transform(
      Math.cos(ar) * sX,
      Math.sin(ar) * sX,
      -Math.sin(ar) * sY,
      Math.cos(ar) * sY,
      att.x || 0,
      att.y || 0
    );
    ctx.scale(1, -1);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation =
      s.blend === 'additive'
        ? 'lighter'
        : s.blend === 'multiply'
          ? 'multiply'
          : s.blend === 'screen'
            ? 'screen'
            : 'source-over';

    const dx = (-rg.ow / 2 + rg.ox) * kx;
    const dy = -((-rg.oh / 2 + rg.oy) * ky + rg.h * ky);
    drawTintedRegion(ctx, pageImg, rg.x, rg.y, rg.w, rg.h, dx, dy, rg.w * kx, rg.h * ky, rg.rotate, r, g, b);
    ctx.restore();
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Draws all active effects belonging to `layer` ('behind' or 'front').
 * Prefers pre-rendered PNG+JSON spritesheets (shinobi-phaser-v1) and falls back cleanly
 * to the fixed Spine renderer only for legacy effects.
 */
export function drawActiveEffectsLayer(
  ctx: CanvasRenderingContext2D,
  effects: ActiveEffectInstance[],
  layer: 'behind' | 'front',
  nowMs: number,
  getFighterPos: (index: number) => { x: number; y: number; dir: 1 | -1 } | null
): void {
  for (const eff of effects) {
    if (eff.layer !== layer) continue;
    const elapsedMs = nowMs - eff.startMs;
    if (elapsedMs < 0 || elapsedMs > eff.durationMs) continue;

    let x = eff.worldX;
    let y = eff.worldY;
    let dir = eff.dir;

    if ((eff.anchorMode === 'attacker' || eff.anchorMode === 'target') && eff.fighterIndex !== undefined) {
      const pos = getFighterPos(eff.fighterIndex);
      if (pos) {
        x = pos.x;
        y = pos.y;
        if (eff.anchorMode === 'attacker') dir = pos.dir;
      }
    }

    if (eff.kind === 'spritesheet' && eff.sheetAnim) {
      drawCompiledAnimationFrame({
        ctx,
        anim: eff.sheetAnim,
        elapsedMs,
        loop: false,
        worldX: x,
        worldY: y,
        dir,
        nativeFacing: eff.nativeFacing,
        charWorldScale: eff.charWorldScale,
      });
    } else if (eff.kind === 'legacy-spine') {
      drawLegacySpineEffect(ctx, eff, x, y, elapsedMs / 1000);
    }
  }
}
