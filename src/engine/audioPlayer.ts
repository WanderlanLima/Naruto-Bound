class ShinobiAudioEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (Ctor) {
        this.ctx = new Ctor();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  unlock(): void {
    this.ensureContext();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  async decodeArrayBuffer(buf: ArrayBuffer): Promise<AudioBuffer | null> {
    const ctx = this.ensureContext();
    if (!ctx) return null;
    try {
      return await ctx.decodeAudioData(buf.slice(0));
    } catch {
      return null;
    }
  }

  playBuffer(buffer: AudioBuffer | undefined, volume = 0.55): boolean {
    if (this.muted || !buffer) return false;
    const ctx = this.ensureContext();
    if (!ctx) return false;
    try {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = buffer;
      gain.gain.value = volume;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(ctx.currentTime);
      return true;
    } catch {
      return false;
    }
  }

  playSynth(kind: 'launch' | 'hit' | 'bigHit' | 'chase' | 'charge' | 'win'): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (kind === 'launch') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.exponentialRampToValueAtTime(520, now + 0.14);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.17);
      } else if (kind === 'hit' || kind === 'bigHit') {
        osc.type = 'sawtooth';
        const dur = kind === 'bigHit' ? 0.24 : 0.13;
        osc.frequency.setValueAtTime(kind === 'bigHit' ? 140 : 190, now);
        osc.frequency.exponentialRampToValueAtTime(42, now + dur);
        gain.gain.setValueAtTime(kind === 'bigHit' ? 0.26 : 0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
        osc.start(now);
        osc.stop(now + dur + 0.02);
      } else if (kind === 'chase') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(480, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.16);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.2);
      } else if (kind === 'charge') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(360, now);
        osc.frequency.exponentialRampToValueAtTime(640, now + 0.12);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.start(now);
        osc.stop(now + 0.16);
      } else if (kind === 'win') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.12);
        osc.frequency.setValueAtTime(783.99, now + 0.24);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc.start(now);
        osc.stop(now + 0.58);
      }
    } catch {
      // ignore
    }
  }
}

export const audioEngine = new ShinobiAudioEngine();
