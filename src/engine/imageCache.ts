/**
 * Decode-ahead cache for combat textures.
 *
 * A duel holds far more spritesheet pixels than a phone can keep decoded, so the browser
 * discards `<img>` bitmaps and decodes them again in the middle of a combo (visible stalls).
 * The battle engine instead asks for the textures it is about to need; they are decoded off
 * the main thread into `ImageBitmap`s that stay in memory within a fixed budget.
 */

interface CacheEntry {
  img: HTMLImageElement;
  bytes: number;
  bitmap?: ImageBitmap;
  failed?: boolean;
  uploaded?: boolean;
  lastWanted: number;
}

const MB = 1024 * 1024;

function pickBudgetBytes(): number {
  if (typeof window === 'undefined') return 256 * MB;
  const memoryGb = (navigator as any).deviceMemory as number | undefined;
  if (memoryGb !== undefined && memoryGb <= 3) return 180 * MB;
  return window.matchMedia?.('(pointer: coarse)').matches ? 280 * MB : 420 * MB;
}

class DecodedImageCache {
  private entries = new Map<HTMLImageElement, CacheEntry>();
  private queue: CacheEntry[] = [];
  private wanted = new Set<HTMLImageElement>();
  private budget = pickBudgetBytes();
  private used = 0;
  private busy = false;
  private tick = 0;
  private generation = 0;

  /** Declares the textures needed next, most urgent first. Whatever exceeds the budget is skipped. */
  want(images: Iterable<HTMLImageElement>): void {
    if (typeof createImageBitmap !== 'function') return;
    this.tick++;
    this.wanted.clear();
    this.queue = [];
    let planned = 0;
    for (const img of images) {
      if (this.wanted.has(img) || !img.naturalWidth) continue;
      const bytes = img.naturalWidth * img.naturalHeight * 4;
      if (planned + bytes > this.budget) continue;
      planned += bytes;
      this.wanted.add(img);
      let entry = this.entries.get(img);
      if (!entry) {
        entry = { img, bytes, lastWanted: this.tick };
        this.entries.set(img, entry);
      }
      entry.lastWanted = this.tick;
      if (!entry.bitmap && !entry.failed) this.queue.push(entry);
    }
    void this.pump();
  }

  /** Source to hand to `drawImage`: the decoded bitmap when ready, else the original image. */
  source(img: HTMLImageElement): CanvasImageSource {
    return this.entries.get(img)?.bitmap || img;
  }

  /** Sends one pending bitmap to the GPU ahead of its first real draw. Call before clearing. */
  uploadNext(ctx: CanvasRenderingContext2D): void {
    for (const entry of this.entries.values()) {
      if (entry.bitmap && !entry.uploaded) {
        entry.uploaded = true;
        ctx.drawImage(entry.bitmap, 0, 0, 1, 1, 0, 0, 1, 1);
        return;
      }
    }
  }

  stats(): { decodedMb: number; pending: number } {
    return { decodedMb: Math.round(this.used / MB), pending: this.queue.length + (this.busy ? 1 : 0) };
  }

  clear(): void {
    this.generation++;
    for (const entry of this.entries.values()) entry.bitmap?.close();
    this.entries.clear();
    this.wanted.clear();
    this.queue = [];
    this.used = 0;
  }

  private makeRoom(bytes: number): void {
    if (this.used + bytes <= this.budget) return;
    const idle = Array.from(this.entries.values())
      .filter((e) => e.bitmap && !this.wanted.has(e.img))
      .sort((a, b) => a.lastWanted - b.lastWanted);
    for (const entry of idle) {
      if (this.used + bytes <= this.budget) break;
      entry.bitmap!.close();
      this.used -= entry.bytes;
      this.entries.delete(entry.img);
    }
  }

  /** Decodes one texture at a time so preparation itself never causes a spike */
  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length > 0) {
      const entry = this.queue.shift()!;
      if (entry.bitmap) continue;
      const generation = this.generation;
      try {
        // Decoding from a Blob happens off the main thread (decoding from <img> does not)
        const blob = await (await fetch(entry.img.src)).blob();
        const bitmap = await createImageBitmap(blob);
        const stale =
          generation !== this.generation ||
          this.entries.get(entry.img) !== entry ||
          !this.wanted.has(entry.img);
        if (stale || entry.bitmap) {
          bitmap.close();
          continue;
        }
        this.makeRoom(entry.bytes);
        entry.bitmap = bitmap;
        this.used += entry.bytes;
      } catch {
        entry.failed = true;
      }
    }
    this.busy = false;
  }
}

export const combatImages = new DecodedImageCache();
