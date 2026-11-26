import { audioEngine } from './audioPlayer';
import {
  CHASE_BANNER_LABELS,
  CHASE_LAUNCH_VY,
  CHASE_STATE_LABELS,
  NATURE_COLORS,
  resolveRoleAnimationSlug,
  toGameSlug,
} from './combatParser';
import {
  drawActiveEffectsLayer,
  type ActiveEffectInstance,
} from './effectRenderer';
import {
  drawCompiledAnimationFrame,
  sampleEmitterWorldPosition,
} from './spriteAnimator';
import type {
  ActionChoice,
  AnimationEventsTimelineMs,
  AnimRoleKey,
  BattleUiSnapshot,
  ChaseSkillSpec,
  ChaseState,
  CompiledAnimation,
  FighterHudState,
  GameMode,
  LoadedNinjaRuntime,
  StatusEffectSpec,
} from '../types/shinobi';

export const WORLD_W = 1800;
export const WORLD_H = 760;
const GRAVITY = 720;
const FIGHTER_GRAVITY = 940;
const MAX_ROUNDS = 50;
const MAX_ROUNDS_TEAM = 90;
/** Safety cap for a single team chase chain (each chase skill still fires only once per chain) */
const MAX_TEAM_CHAIN = 9;
const SPAWN_MARGIN = 110;
const TURN_TIME_SEC = 30;
const MOVE_BUDGET = 190;

interface SimpleParticle {
  kind: 'circle' | 'ring' | 'spark';
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  maxLife: number;
  r: number;
  growR?: number;
  lineW?: number;
  color: string;
}

interface SlashBeam {
  x: number;
  y: number;
  angle: number;
  life: number;
  maxLife: number;
  color: string;
}

interface DamageNumber {
  x: number;
  y: number;
  value: string;
  life: number;
  big: boolean;
  crit: boolean;
  color: string;
}

interface FloatingCallout {
  text: string;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  color: string;
}

interface TimelineStrikeContext {
  attackerIdx: number;
  targetIdx: number;
  actionKind: 'attack' | 'skill' | 'ultimate' | 'chase';
  totalDamage: number;
  isBig: boolean;
  isCrit: boolean;
  causesState: ChaseState;
  statusEffects: StatusEffectSpec[];
  hitLabel: string;
  hitTimestampsMs: number[];
  firedHitIndices: Set<number>;
  finalImpactApplied: boolean;
  comboCount: number;
}

interface ActiveTimeline {
  events: AnimationEventsTimelineMs;
  firedParticles: Set<number>;
  firedSounds: Set<number>;
  firedVideos: Set<number>;
  strike?: TimelineStrikeContext;
}

interface ReturnTrip {
  idx: number;
  fromX: number;
  toX: number;
  t: number;
  dur: number;
}

interface DashSequence {
  /** Current striker: the turn owner at first, then whichever ally is chasing */
  attackerIdx: number;
  targetIdx: number;
  /** Where each participant stood before joining the chain */
  homes: Map<number, number>;
  /** Allies running back home while the chain continues */
  returns: ReturnTrip[];
  actionChoice: ActionChoice;
  phase: 'approach' | 'strike' | 'chaseWait' | 'chaseDash' | 'chaseStrike' | 'return';
  t: number;
  x0: number;
  x1: number;
  dashDur: number;
  waitDur: number;
  strikeElapsed: number;
  strikeDur: number;
  xChaseStart: number;
  xChaseEnd: number;
  lastCausedState: ChaseState;
  activeChaser?: ChaseSkillSpec;
  /** Keys are `${fighterIndex}:${slot}:${name}` so duplicated ninjas chase independently */
  usedChaserSlots: Set<string>;
  comboCount: number;
}

interface FighterEntity {
  index: number;
  team: 0 | 1;
  runtime: LoadedNinjaRuntime;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dir: 1 | -1;
  air: boolean;
  hp: number;
  maxHp: number;
  chakra: number;
  armedAction: ActionChoice;
  moveUsed: number;
  animSlug: string;
  animStartMs: number;
  animLoop: boolean;
  lockSec: number;
  timeline: ActiveTimeline | null;
  chaseState: ChaseState | null;
  silhouette: boolean;
  hitFlash: number;
  totalDamage: number;
  biggestHit: number;
  statuses: {
    burn: number;
    poison: number;
    paralysis: number;
    seal: number;
    slow: number;
    shield: number;
  };
}

interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  actionChoice: ActionChoice;
  trail: Array<[number, number]>;
}

export class ShinobiBattleEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private terrainCanvas: HTMLCanvasElement;
  private terrainCtx: CanvasRenderingContext2D;
  private terrainMask!: Uint8ClampedArray;

  private mode: GameMode;
  private onUiUpdate: (snap: BattleUiSnapshot) => void;
  private fighters: FighterEntity[] = [];
  private teamSize: number;

  /** Index (in `fighters`) of the ninja that owns the current turn */
  private turnIndex = 0;
  private activeTeam: 0 | 1 = 0;
  /** Last team slot that acted, per team */
  private turnCursor: [number, number] = [-1, -1];
  /** Fighter highlighted on each side of the HUD */
  private focus: [number, number] = [0, 1];
  private phase: 'aim' | 'ai' | 'fly' | 'after' | 'over' = 'aim';
  private round = 0;
  private timerSec = TURN_TIME_SEC;
  private wind = 0;
  private afterTimer = 0;
  private winnerTeam: -1 | 0 | 1 | null = null;

  private aim: { angle: number; power: number } | null = null;
  private aiPlan: { angle: number; power: number; delay: number } | null = null;
  private projectile: Projectile | null = null;
  private dash: DashSequence | null = null;
  private cutInPending: {
    active: boolean;
    showVideo: boolean;
    videoUrl?: string;
    icoUrl?: string;
    skillName: string;
    ninjaName: string;
    onDone: () => void;
    ribbonTimer?: number;
    safetyTimer?: number;
  } | null = null;

  private effects: ActiveEffectInstance[] = [];
  private nextEffectId = 1;
  private particles: SimpleParticle[] = [];
  private beams: SlashBeam[] = [];
  private dmgNumbers: DamageNumber[] = [];
  private callouts: FloatingCallout[] = [];
  private shake = 0;

  private hits = 0;
  private hitsKey = 0;
  private hitsTimer = 0;
  private comboBanner: BattleUiSnapshot['comboBanner'] = null;
  private comboBannerTimer = 0;
  private comboBannerKey = 0;

  private cam = { x: 400, y: 400, z: 1.0 };
  private camFree = false;
  /** World pixels the camera may currently show above the top of the map */
  private camSkyPx = 0;
  /** Zoom to restore once a high-jump animation ends */
  private camZoomBeforeJump: number | null = null;
  private moveDir: -1 | 0 | 1 = 0;
  private rotatedPortrait = false;
  /** Phones fill far fewer pixels per frame with a lower canvas resolution cap */
  private maxPixelRatio = window.matchMedia?.('(pointer: coarse)').matches ? 1.5 : 2;

  // Pointer gesture tracking
  private pointers = new Map<number, [number, number]>();
  private gesture: { mode: 'aim' | 'pan' | 'zoom'; dist?: number; baseZoom?: number } | null = null;

  // Atmospheric backdrop stars (deterministic per match)
  private stars: Array<{ x: number; y: number; r: number; a: number }> = [];

  private rafId = 0;
  private lastNow = 0;
  private nowMs = 0;
  private lastUiEmit = 0;
  private disposed = false;

  constructor(params: {
    canvas: HTMLCanvasElement;
    teams: [LoadedNinjaRuntime[], LoadedNinjaRuntime[]];
    mode: GameMode;
    onUiUpdate: (snap: BattleUiSnapshot) => void;
  }) {
    this.canvas = params.canvas;
    const ctx = params.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.mode = params.mode;
    this.onUiUpdate = params.onUiUpdate;

    this.terrainCanvas = document.createElement('canvas');
    this.terrainCanvas.width = WORLD_W;
    this.terrainCanvas.height = WORLD_H;
    this.terrainCtx = this.terrainCanvas.getContext('2d', { willReadFrequently: true })!;
    this.generateTerrain();
    this.generateStars();

    this.nowMs = performance.now();
    this.lastNow = this.nowMs;

    this.teamSize = params.teams[0].length;
    const lineup = [
      ...params.teams[0].map((runtime) => ({ runtime, team: 0 as const })),
      ...params.teams[1].map((runtime) => ({ runtime, team: 1 as const })),
    ];
    const spawnXs = this.rollSpawnPositions(lineup.length);
    this.fighters = lineup.map((l, i) =>
      this.createFighter(i, l.team, l.runtime, spawnXs[i], l.team === 0 ? 1 : -1)
    );
    for (const f of this.fighters) {
      const foe = this.nearestEnemy(f);
      if (foe) f.dir = foe.x >= f.x ? 1 : -1;
    }
    this.focus = [0, this.teamSize];

    this.cam = {
      x: this.fighters[0].x + 80,
      y: this.fighters[0].y - 95,
      z: this.getDefaultZoom(),
    };

    this.bindInputEvents();
    this.startTurn(true);
    this.emitUi(true);
    this.rafId = requestAnimationFrame(this.loop);
  }

  /**
   * 1x1 keeps the classic mirrored start. Team battles split the map into one lane per ninja
   * and shuffle who gets which lane, so both squads land mixed without overlapping.
   */
  private rollSpawnPositions(count: number): number[] {
    if (count <= 2) return [320, WORLD_W - 320];
    const laneW = (WORLD_W - SPAWN_MARGIN * 2) / count;
    const xs = Array.from({ length: count }, (_, i) =>
      Math.round(SPAWN_MARGIN + laneW * (i + 0.5) + (Math.random() - 0.5) * laneW * 0.5)
    );
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  }

  /* ---------- Team Helpers ---------- */

  private livingEnemies(f: FighterEntity): FighterEntity[] {
    return this.fighters.filter((o) => o.team !== f.team && o.hp > 0);
  }

  private nearestEnemy(f: FighterEntity): FighterEntity | undefined {
    return this.livingEnemies(f).sort((a, b) => Math.abs(a.x - f.x) - Math.abs(b.x - f.x))[0];
  }

  private teamMembers(team: 0 | 1): FighterEntity[] {
    return this.fighters.filter((f) => f.team === team);
  }

  private isTeamAlive(team: 0 | 1): boolean {
    return this.teamMembers(team).some((f) => f.hp > 0);
  }

  private teamHpRatio(team: 0 | 1): number {
    const members = this.teamMembers(team);
    const max = members.reduce((sum, f) => sum + f.maxHp, 0);
    return members.reduce((sum, f) => sum + f.hp, 0) / Math.max(1, max);
  }

  private isAiTurn(): boolean {
    return this.mode === 'ia' && this.activeTeam === 1;
  }

  private getMaxRounds(): number {
    return this.teamSize > 1 ? MAX_ROUNDS_TEAM : MAX_ROUNDS;
  }

  /** Fighters that dropped through the bottom of the map no longer take part in physics */
  private isOffMap(f: FighterEntity): boolean {
    return f.y > WORLD_H + 70;
  }

  private createFighter(
    index: number,
    team: 0 | 1,
    runtime: LoadedNinjaRuntime,
    x: number,
    dir: 1 | -1
  ): FighterEntity {
    const combat = runtime.entry.combat;
    const idleSlug =
      resolveRoleAnimationSlug(runtime.roles, new Set(runtime.animations.keys()), 'idle') || 'idle';
    return {
      index,
      team,
      runtime,
      x,
      y: this.findGroundY(x),
      vx: 0,
      vy: 0,
      dir,
      air: false,
      hp: combat.maxHp,
      maxHp: combat.maxHp,
      chakra: 0,
      armedAction: 'attack',
      moveUsed: 0,
      animSlug: idleSlug,
      animStartMs: this.nowMs,
      animLoop: true,
      lockSec: 0,
      timeline: null,
      chaseState: null,
      silhouette: false,
      hitFlash: 0,
      totalDamage: 0,
      biggestHit: 0,
      statuses: {
        burn: 0,
        poison: 0,
        paralysis: 0,
        seal: 0,
        slow: 0,
        shield: 0,
      },
    };
  }

  private generateStars(): void {
    this.stars = [];
    for (let i = 0; i < 65; i++) {
      this.stars.push({
        x: Math.random(),
        y: Math.random() * 0.58,
        r: 0.7 + Math.random() * 1.5,
        a: 0.25 + Math.random() * 0.6,
      });
    }
  }

  private generateTerrain(): void {
    const g = this.terrainCtx;
    g.clearRect(0, 0, WORLD_W, WORLD_H);
    const p1 = Math.random() * Math.PI * 2;
    const p2 = Math.random() * Math.PI * 2;
    const heightAt = (x: number) =>
      WORLD_H * 0.62 +
      Math.sin(x / 250 + p1) * 56 +
      Math.sin(x / 95 + p2) * 20 +
      Math.sin(x / 36) * 4;

    // Deep stone & earth strata gradient
    const grad = g.createLinearGradient(0, WORLD_H * 0.42, 0, WORLD_H);
    grad.addColorStop(0, '#594430');
    grad.addColorStop(0.28, '#413124');
    grad.addColorStop(0.68, '#29201A');
    grad.addColorStop(1, '#171210');

    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, WORLD_H);
    for (let x = 0; x <= WORLD_W; x += 6) g.lineTo(x, heightAt(x));
    g.lineTo(WORLD_W, WORLD_H);
    g.closePath();
    g.fill();

    // Subtle rock strata texture lines
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(255, 232, 195, 0.04)';
    for (let i = 0; i < 18; i++) {
      const rx = Math.random() * WORLD_W;
      const ry = WORLD_H * 0.55 + Math.random() * (WORLD_H * 0.42);
      g.beginPath();
      g.ellipse(rx, ry, 28 + Math.random() * 70, 6 + Math.random() * 12, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    // Mossy grass crust along top ridge
    g.strokeStyle = '#4B8B3B';
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.beginPath();
    for (let x = 0; x <= WORLD_W; x += 6) {
      if (x === 0) g.moveTo(x, heightAt(x) + 4);
      else g.lineTo(x, heightAt(x) + 4);
    }
    g.stroke();

    // Crisp lighter highlight rim on grass
    g.strokeStyle = '#73B85A';
    g.lineWidth = 2.5;
    g.beginPath();
    for (let x = 0; x <= WORLD_W; x += 6) {
      if (x === 0) g.moveTo(x, heightAt(x) + 1);
      else g.lineTo(x, heightAt(x) + 1);
    }
    g.stroke();

    this.refreshTerrainMask();
  }

  private refreshTerrainMask(): void {
    this.terrainMask = this.terrainCtx.getImageData(0, 0, WORLD_W, WORLD_H).data;
  }

  private isSolid(x: number, y: number): boolean {
    if (x < 0 || x >= WORLD_W || y < 0 || y >= WORLD_H) return false;
    return this.terrainMask[((y | 0) * WORLD_W + (x | 0)) * 4 + 3] > 100;
  }

  private findGroundY(x: number): number {
    let y = 0;
    while (y < WORLD_H && !this.isSolid(x, y)) y++;
    return y;
  }

  private carveCrater(x: number, y: number, radius: number): void {
    const g = this.terrainCtx;
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(x, y, radius, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // Scorched crater rim
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.strokeStyle = 'rgba(20, 12, 8, 0.72)';
    g.lineWidth = 7;
    g.beginPath();
    g.arc(x, y, radius + 3, 0, Math.PI * 2);
    g.stroke();
    g.restore();

    this.refreshTerrainMask();
  }

  /* ---------- Public Controls ---------- */

  public setMoveDirection(dir: -1 | 0 | 1): void {
    this.moveDir = dir;
  }

  public selectAction(choice: ActionChoice): void {
    const f = this.fighters[this.turnIndex];
    if (this.phase !== 'aim' || this.isAiTurn()) return;
    if (choice === 'ultimate') {
      if (f.chakra < 100 || f.statuses.seal > 0) return;
      f.armedAction = f.armedAction === 'ultimate' ? 'attack' : 'ultimate';
      audioEngine.playSynth('charge');
    } else if (choice === 'skill') {
      const cost = f.runtime.entry.combat.skill.chakraCost;
      if (f.chakra < cost || f.statuses.seal > 0) return;
      f.armedAction = f.armedAction === 'skill' ? 'attack' : 'skill';
      audioEngine.playSynth('charge');
    } else {
      f.armedAction = 'attack';
    }
    this.emitUi(true);
  }

  public finishCutInVideo(): void {
    if (!this.cutInPending) return;
    const pending = this.cutInPending;
    this.cutInPending = null;
    if (pending.ribbonTimer) window.clearTimeout(pending.ribbonTimer);
    if (pending.safetyTimer) window.clearTimeout(pending.safetyTimer);
    this.emitUi(true);
    pending.onDone();
  }

  public centerCameraOnActive(): void {
    this.camFree = false;
    this.cam.z = this.getDefaultZoom();
  }

  public setRotatedPortrait(rotated: boolean): void {
    this.rotatedPortrait = rotated;
  }

  private getDefaultZoom(): number {
    const W = Math.max(1, this.canvas.clientWidth);
    const H = Math.max(1, this.canvas.clientHeight);
    const minZ = Math.max(W / WORLD_W, H / WORLD_H);
    return Math.min(1.12, Math.max(minZ, H / 410));
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    if (this.cutInPending) {
      if (this.cutInPending.ribbonTimer) window.clearTimeout(this.cutInPending.ribbonTimer);
      if (this.cutInPending.safetyTimer) window.clearTimeout(this.cutInPending.safetyTimer);
      this.cutInPending = null;
    }
    this.unbindInputEvents();
  }

  /* ---------- Animation & Timeline Helpers ---------- */

  private getFighterAnim(f: FighterEntity, slug?: string): CompiledAnimation | undefined {
    return (
      f.runtime.animations.get(slug || f.animSlug) ||
      f.runtime.animations.get(f.runtime.roles.idle || 'idle') ||
      f.runtime.animations.values().next().value
    );
  }

  private playFighterRole(
    f: FighterEntity,
    role: AnimRoleKey,
    options?: {
      loop?: boolean;
      lockSec?: number;
      preferredSlug?: string;
      actionEventOverride?: 'attack' | 'skill' | 'ultimate' | 'chase' | 'hurt';
      suppressTimelineEvents?: boolean;
      strike?: Omit<
        TimelineStrikeContext,
        'hitTimestampsMs' | 'firedHitIndices' | 'finalImpactApplied'
      >;
    }
  ): CompiledAnimation | undefined {
    const avail = new Set(f.runtime.animations.keys());
    const slug =
      resolveRoleAnimationSlug(f.runtime.roles, avail, role, options?.preferredSlug) ||
      f.runtime.roles.idle ||
      'idle';
    const anim = this.getFighterAnim(f, slug);

    f.animSlug = slug;
    f.animStartMs = this.nowMs;
    f.animLoop = options?.loop ?? false;

    const animDurSec = anim ? anim.durationMs / 1000 : 0.6;
    f.lockSec = options?.lockSec !== undefined ? options.lockSec : f.animLoop ? 0 : animDurSec;

    // Combine animation's own eventsMs + actionEvents fallback (for built-in ninjas)
    const emptyEv: AnimationEventsTimelineMs = { hits: [], particles: [], sounds: [], videos: [] };
    const baseEv = anim?.eventsMs || emptyEv;
    const overrideEv =
      options?.actionEventOverride && f.runtime.actionEvents?.[options.actionEventOverride];
    const hasBaseEv =
      baseEv.hits.length > 0 ||
      baseEv.particles.length > 0 ||
      baseEv.sounds.length > 0 ||
      baseEv.videos.length > 0;
    const events: AnimationEventsTimelineMs = options?.suppressTimelineEvents
      ? emptyEv
      : hasBaseEv
        ? baseEv
        : overrideEv || emptyEv;

    let strikeCtx: TimelineStrikeContext | undefined;
    if (options?.strike) {
      // Determine real impact timestamps from eventsMs.hits, or smart fallback
      // `impactMs` marks hits that are baked into the ninja's own spritesheet
      let hitTimestampsMs = anim?.impactMs?.slice() || events.hits.map((h) => h.timeMs);
      if (hitTimestampsMs.length === 0) {
        const maxParticleMs =
          events.particles.length > 0
            ? Math.max(...events.particles.map((p) => p.timeMs))
            : 0;
        if (events.particles.length > 0 && maxParticleMs >= 80) {
          hitTimestampsMs = events.particles.map((p) => Math.max(80, p.timeMs));
        } else {
          const fallbackMs = Math.round(
            Math.min(620, Math.max(150, (anim?.durationMs || 700) * 0.42))
          );
          hitTimestampsMs = [fallbackMs];
        }
      }
      // Deduplicate timestamps within 40ms so simultaneous behind+front hit layers count as one hit beat
      const grouped: number[] = [];
      for (const ms of [...hitTimestampsMs].sort((a, b) => a - b)) {
        if (grouped.length === 0 || ms - grouped[grouped.length - 1] > 40) {
          grouped.push(ms);
        }
      }
      strikeCtx = {
        ...options.strike,
        hitTimestampsMs: grouped,
        firedHitIndices: new Set<number>(),
        finalImpactApplied: false,
      };
    }

    f.timeline = {
      events,
      firedParticles: new Set<number>(),
      firedSounds: new Set<number>(),
      firedVideos: new Set<number>(),
      strike: strikeCtx,
    };

    // Immediately process timeMs === 0 events on frame 0
    this.tickFighterTimeline(f);
    return anim;
  }

  private getEffectDurationMs(
    runtime: LoadedNinjaRuntime,
    spineId: string,
    effectAnim: string
  ): number {
    const sheet = this.lookupEffectSheet(runtime, spineId, effectAnim);
    if (sheet) return Math.max(200, sheet.durationMs);
    const sp =
      runtime.legacySpineEffects.get(spineId) ||
      runtime.legacySpineEffects.get(spineId.toLowerCase()) ||
      runtime.legacySpineEffects.get(toGameSlug(spineId, 'effect'));
    const sec = sp?.dur?.[effectAnim];
    return sec ? Math.max(200, Math.round(sec * 1000)) : 520;
  }

  private computeStrikeDurationSec(
    att: FighterEntity,
    anim: CompiledAnimation | undefined
  ): number {
    let maxMs = Math.max(450, anim?.durationMs || 650);
    const ev = att.timeline?.events;
    if (ev) {
      for (const p of ev.particles) {
        const effDur = this.getEffectDurationMs(att.runtime, p.spineId, p.effectAnim);
        maxMs = Math.max(maxMs, p.timeMs + Math.min(1200, effDur));
      }
      for (const h of ev.hits) {
        const effDur = this.getEffectDurationMs(att.runtime, h.spineId, h.effectAnim);
        maxMs = Math.max(maxMs, h.timeMs + Math.min(900, effDur));
      }
      for (const s of ev.sounds) {
        maxMs = Math.max(maxMs, Math.min(2200, s.timeMs + 140));
      }
      if (att.timeline?.strike) {
        for (const tMs of att.timeline.strike.hitTimestampsMs) {
          maxMs = Math.max(maxMs, tMs + 220);
        }
      }
    }
    // Trailing effects are capped, but the ninja's own animation always plays to the end
    const capSec = Math.max(2.6, (anim?.durationMs || 0) / 1000);
    return Math.max(0.5, Math.min(capSec, maxMs / 1000));
  }

  private lookupEffectSheet(
    runtime: LoadedNinjaRuntime,
    spineId: string,
    effectAnim: string
  ): CompiledAnimation | undefined {
    const k1 = `${spineId}/${effectAnim}`;
    const k2 = `${spineId.toLowerCase()}/${effectAnim.toLowerCase()}`;
    const k3 = `${toGameSlug(spineId, 'effect')}/${toGameSlug(effectAnim, 'anim')}`;
    return runtime.effects.get(k1) || runtime.effects.get(k2) || runtime.effects.get(k3);
  }

  private spawnStudioEffect(params: {
    owner: FighterEntity;
    spineId: string;
    effectAnim: string;
    layer: 'behind' | 'front';
    anchorMode: 'attacker' | 'target' | 'world';
    targetFighter?: FighterEntity;
    worldX?: number;
    worldY?: number;
  }): boolean {
    const { owner, spineId, effectAnim, layer, anchorMode, targetFighter } = params;
    const anchorFighter = anchorMode === 'target' && targetFighter ? targetFighter : owner;
    const x = params.worldX ?? anchorFighter.x;
    const y = params.worldY ?? anchorFighter.y;

    // 1. Prefer pre-rendered PNG+JSON spritesheet effect
    const sheet = this.lookupEffectSheet(owner.runtime, spineId, effectAnim);
    if (sheet && sheet.pages && sheet.pages.length > 0) {
      this.effects.push({
        id: this.nextEffectId++,
        kind: 'spritesheet',
        layer,
        anchorMode,
        fighterIndex: anchorMode === 'world' ? undefined : anchorFighter.index,
        worldX: x,
        worldY: y,
        dir: owner.dir,
        nativeFacing: owner.runtime.facing,
        charWorldScale: owner.runtime.charWorldScale,
        startMs: this.nowMs,
        durationMs: Math.max(120, sheet.durationMs),
        sheetAnim: sheet,
      });
      return true;
    }

    // 2. Fallback to fixed legacy Spine renderer (built-in / legacy packs)
    const sp =
      owner.runtime.legacySpineEffects.get(spineId) ||
      owner.runtime.legacySpineEffects.get(spineId.toLowerCase()) ||
      owner.runtime.legacySpineEffects.get(toGameSlug(spineId, 'effect'));
    if (sp && sp.anims?.[effectAnim]) {
      const durMs = Math.max(180, Math.round((sp.dur?.[effectAnim] || 0.7) * 1000));
      this.effects.push({
        id: this.nextEffectId++,
        kind: 'legacy-spine',
        layer,
        anchorMode,
        fighterIndex: anchorMode === 'world' ? undefined : anchorFighter.index,
        worldX: x,
        worldY: y,
        dir: owner.dir,
        nativeFacing: owner.runtime.facing,
        charWorldScale: owner.runtime.charWorldScale,
        startMs: this.nowMs,
        durationMs: durMs,
        spineData: sp,
        spineAnimName: effectAnim,
      });
      return true;
    }

    return false;
  }

  private playSoundByName(runtime: LoadedNinjaRuntime, soundName: string): boolean {
    const stem = soundName.replace(/\.(mp3|ogg|wav)$/i, '');
    const buf =
      runtime.audioBuffers.get(soundName) ||
      runtime.audioBuffers.get(stem) ||
      runtime.audioBuffers.get(stem.toLowerCase()) ||
      runtime.audioBuffers.get(toGameSlug(stem, 'sfx'));
    return audioEngine.playBuffer(buf, 0.56);
  }

  private tickFighterTimeline(f: FighterEntity): void {
    const tl = f.timeline;
    if (!tl) return;
    const elapsedMs = Math.max(0, this.nowMs - f.animStartMs);

    // 1. Trigger self/screen particle effects at exact timeMs anchored on the attacker
    tl.events.particles.forEach((pEv, idx) => {
      if (tl.firedParticles.has(idx) || elapsedMs < pEv.timeMs) return;
      tl.firedParticles.add(idx);
      const targetIdx = tl.strike?.targetIdx;
      this.spawnStudioEffect({
        owner: f,
        spineId: pEv.spineId,
        effectAnim: pEv.effectAnim,
        layer: pEv.layer || 'front',
        anchorMode: 'attacker',
        targetFighter: targetIdx !== undefined ? this.fighters[targetIdx] : undefined,
      });
    });

    // 2. Trigger hit visual effects on target at exact timeMs
    tl.events.hits.forEach((hEv, idx) => {
      if (tl.firedParticles.has(10000 + idx) || elapsedMs < hEv.timeMs) return;
      tl.firedParticles.add(10000 + idx);
      const target =
        tl.strike !== undefined ? this.fighters[tl.strike.targetIdx] : this.nearestEnemy(f) || f;
      this.spawnStudioEffect({
        owner: f,
        spineId: hEv.spineId,
        effectAnim: hEv.effectAnim,
        layer: hEv.layer || 'front',
        anchorMode: 'target',
        targetFighter: target,
      });
    });

    // 3. Trigger synchronized MP3 sound cues at exact timeMs
    tl.events.sounds.forEach((sEv, idx) => {
      if (tl.firedSounds.has(idx) || elapsedMs < sEv.timeMs) return;
      tl.firedSounds.add(idx);
      this.playSoundByName(f.runtime, sEv.soundName);
    });

    // 4. Trigger synchronized hit damage / shake / knockback / status effects at exact hit timestamps!
    if (tl.strike) {
      const st = tl.strike;
      const target = this.fighters[st.targetIdx];
      const totalBeats = Math.max(1, st.hitTimestampsMs.length);

      st.hitTimestampsMs.forEach((hitMs, beatIdx) => {
        if (st.firedHitIndices.has(beatIdx) || elapsedMs < hitMs) return;
        st.firedHitIndices.add(beatIdx);
        const isFinalBeat = beatIdx === totalBeats - 1;
        this.deliverSynchronizedHitBeat(f, target, st, beatIdx, totalBeats, isFinalBeat);
      });
    }
  }

  private deliverSynchronizedHitBeat(
    att: FighterEntity,
    tg: FighterEntity,
    st: TimelineStrikeContext,
    beatIdx: number,
    totalBeats: number,
    isFinalBeat: boolean
  ): void {
    // Split total damage cleanly across hit beats
    const baseSlice = Math.floor(st.totalDamage / totalBeats);
    const remainder = st.totalDamage - baseSlice * totalBeats;
    let dmg = baseSlice + (isFinalBeat ? remainder : 0);

    // Absorb with shield if target has one
    if (tg.statuses.shield > 0 && dmg > 0) {
      const absorbed = Math.min(tg.statuses.shield, dmg);
      tg.statuses.shield -= absorbed;
      dmg -= absorbed;
    }

    tg.hp = Math.max(0, tg.hp - dmg);
    tg.hitFlash = 0.16;
    att.totalDamage += dmg;
    att.biggestHit = Math.max(att.biggestHit, st.totalDamage);

    const hitX = tg.x + (Math.random() - 0.5) * 18;
    const hitY = tg.y - tg.runtime.bodyHeight * 0.55;

    // Damage number & hit counter
    this.dmgNumbers.push({
      x: hitX,
      y: tg.y - tg.runtime.bodyHeight - 6,
      value: `${dmg}${st.isCrit && isFinalBeat ? '!' : ''}`,
      life: 1.35,
      big: st.isBig && isFinalBeat,
      crit: st.isCrit && isFinalBeat,
      color: st.isCrit ? '#FEF08A' : st.isBig ? '#FDE047' : '#FBBF24',
    });

    const hitIncrement =
      st.actionKind === 'ultimate' ? Math.max(3, Math.round(18 / totalBeats)) : 1;
    this.addHits(hitIncrement);

    // Impact sparks, shockwave ring & screen shake directly on target
    const nat = att.runtime.entry.combat.nature;
    this.spawnImpactSparks(hitX, hitY, st.isBig && isFinalBeat, nat);
    this.particles.push({
      kind: 'ring',
      x: tg.x,
      y: hitY,
      vx: 0,
      vy: 0,
      g: 0,
      life: 0.24,
      maxLife: 0.24,
      r: 6,
      growR: isFinalBeat ? 155 : 105,
      lineW: isFinalBeat ? 3.5 : 2.2,
      color: NATURE_COLORS[nat] || '#FDE047',
    });
    this.shake = Math.max(this.shake, st.isBig && isFinalBeat ? 0.52 : 0.26);
    audioEngine.playSynth(st.isBig && isFinalBeat ? 'bigHit' : 'hit');

    if (!isFinalBeat) {
      // Mid-combo flinch animation + target hurt sound
      if (!tg.air && tg.hp > 0) {
        this.playFighterRole(tg, 'hurt', {
          loop: false,
          lockSec: 0.34,
          actionEventOverride: 'hurt',
        });
      }
      return;
    }

    // Final hit beat: carve terrain crater under target & detonate impact burst right on target!
    st.finalImpactApplied = true;
    const craterR =
      st.actionKind === 'ultimate'
        ? 82
        : st.actionKind === 'skill'
          ? 62
          : st.actionKind === 'chase'
            ? 32
            : 48;
    this.carveCrater(tg.x, tg.y, craterR);
    this.spawnTerrainBurst(tg.x, tg.y, true, nat);
    if (!att.timeline?.events.hits.length) {
      this.spawnBeams(tg.x, hitY, att.dir);
    }
    this.applyHitState(tg, st.causesState, att);

    const appliedStatusLabels: string[] = [];
    for (const eff of st.statusEffects) {
      if (Math.random() > eff.chance) continue;
      if (eff.kind === 'burn') {
        tg.statuses.burn = Math.max(tg.statuses.burn, eff.turns);
        appliedStatusLabels.push('Chamas');
      } else if (eff.kind === 'poison') {
        tg.statuses.poison = Math.max(tg.statuses.poison, eff.turns);
        appliedStatusLabels.push('Veneno');
      } else if (eff.kind === 'paralysis') {
        tg.statuses.paralysis = Math.max(tg.statuses.paralysis, eff.turns);
        appliedStatusLabels.push('Paralisia');
      } else if (eff.kind === 'seal') {
        tg.statuses.seal = Math.max(tg.statuses.seal, eff.turns);
        appliedStatusLabels.push('Selado');
      } else if (eff.kind === 'slow') {
        tg.statuses.slow = Math.max(tg.statuses.slow, eff.turns);
        appliedStatusLabels.push('Lento');
      } else if (eff.kind === 'heal') {
        const healAmt = eff.potency;
        att.hp = Math.min(att.maxHp, att.hp + healAmt);
        this.dmgNumbers.push({
          x: att.x,
          y: att.y - att.runtime.bodyHeight - 10,
          value: `+${healAmt}`,
          life: 1.3,
          big: false,
          crit: false,
          color: '#4ADE80',
        });
        appliedStatusLabels.push('Cura');
      } else if (eff.kind === 'shield') {
        att.statuses.shield += eff.potency;
        appliedStatusLabels.push('Escudo');
      }
    }

    if (st.actionKind === 'chase') {
      this.spawnBeams(att.x, att.y - att.runtime.bodyHeight * 0.5, att.dir);
      const label =
        this.teamSize > 1 ? `${att.runtime.entry.name.split(' ')[0]} · ${st.hitLabel}` : st.hitLabel;
      this.showComboBanner(st.causesState, label, st.comboCount);
    }

    const suffix = appliedStatusLabels.length > 0 ? ` · ${appliedStatusLabels.join(' · ')}` : '';
    const prefix =
      st.actionKind === 'ultimate'
        ? 'ÔGI · '
        : st.actionKind === 'chase'
          ? 'PERSEGUIÇÃO · '
          : st.actionKind === 'skill'
            ? 'JUTSU · '
            : '';
    this.pushCallout(
      `${prefix}${CHASE_STATE_LABELS[st.causesState]}${suffix}`,
      tg.x,
      tg.y - tg.runtime.bodyHeight * 0.85,
      st.actionKind === 'chase' ? '#7DD3FC' : '#FDE047'
    );

    this.emitUi(true);
  }

  private applyHitState(tg: FighterEntity, state: ChaseState, att: FighterEntity): void {
    tg.chaseState = state;
    this.particles.push({
      kind: 'ring',
      x: tg.x,
      y: tg.y - tg.runtime.bodyHeight * 0.5,
      vx: 0,
      vy: 0,
      g: 0,
      life: 0.3,
      maxLife: 0.3,
      r: 8,
      growR: 160,
      lineW: 3,
      color: '#FFFFFF',
    });

    const pushDir = att.x < tg.x ? 1 : -1;
    if (state === 'fall') {
      this.playFighterRole(tg, 'fall', { loop: false, lockSec: 1.0, actionEventOverride: 'hurt' });
    } else if (state === 'back') {
      tg.vx = pushDir * 310;
      tg.vy = CHASE_LAUNCH_VY.back;
      tg.air = true;
      this.playFighterRole(tg, 'hurt', { loop: false, lockSec: 0.65, actionEventOverride: 'hurt' });
    } else {
      tg.vy = CHASE_LAUNCH_VY[state];
      tg.vx = pushDir * 64;
      tg.air = true;
      this.playFighterRole(tg, 'fly', { loop: true, lockSec: 0, actionEventOverride: 'hurt' });
    }
  }

  /* ---------- Turn & Combat Flow ---------- */

  /** Teams alternate; inside each team the living ninjas rotate in lineup order */
  private advanceTurn(first: boolean): void {
    if (!first) this.activeTeam = this.activeTeam === 0 ? 1 : 0;
    const team = this.activeTeam;
    const members = this.teamMembers(team);
    for (let step = 1; step <= members.length; step++) {
      const slot = (this.turnCursor[team] + step) % members.length;
      if (members[slot].hp > 0) {
        this.turnCursor[team] = slot;
        this.turnIndex = members[slot].index;
        this.focus[team] = this.turnIndex;
        break;
      }
    }
    const enemyTeam = team === 0 ? 1 : 0;
    if (this.fighters[this.focus[enemyTeam]].hp <= 0) {
      const alive = this.teamMembers(enemyTeam).find((f) => f.hp > 0);
      if (alive) this.focus[enemyTeam] = alive.index;
    }
  }

  private startTurn(first = false): void {
    this.advanceTurn(first);
    this.round++;
    this.wind = Math.round((Math.random() * 2 - 1) * 80) / 10;
    this.timerSec = TURN_TIME_SEC;
    this.camFree = false;
    this.aim = null;
    this.aiPlan = null;

    const active = this.fighters[this.turnIndex];
    active.moveUsed = 0;
    active.armedAction = 'attack';

    // Tick status effects at start of turn
    if (active.statuses.burn > 0 && active.hp > 0) {
      active.statuses.burn--;
      const dot = 5;
      active.hp = Math.max(0, active.hp - dot);
      this.pushCallout(`Chamas -${dot}`, active.x, active.y - active.runtime.bodyHeight, '#FB923C');
      this.dmgNumbers.push({
        x: active.x,
        y: active.y - active.runtime.bodyHeight - 10,
        value: `-${dot}`,
        life: 1.2,
        big: false,
        crit: false,
        color: '#FB923C',
      });
    }
    if (active.statuses.poison > 0 && active.hp > 0) {
      active.statuses.poison--;
      const dot = 4;
      active.hp = Math.max(0, active.hp - dot);
      this.pushCallout(`Veneno -${dot}`, active.x, active.y - active.runtime.bodyHeight - 18, '#A855F7');
    }
    if (active.statuses.slow > 0) active.statuses.slow--;
    if (active.statuses.seal > 0) active.statuses.seal--;

    if (this.round > this.getMaxRounds()) {
      const r0 = this.teamHpRatio(0);
      const r1 = this.teamHpRatio(1);
      for (const f of this.fighters) {
        if (r0 === r1 || f.team === (r0 > r1 ? 1 : 0)) f.hp = 0;
      }
    }

    if (active.hp <= 0) {
      this.phase = 'after';
      this.afterTimer = 1.0;
      this.emitUi(true);
      return;
    }

    if (active.statuses.paralysis > 0) {
      active.statuses.paralysis--;
      this.pushCallout('Paralisado!', active.x, active.y - active.runtime.bodyHeight, '#FDE047');
      this.phase = 'after';
      this.afterTimer = 1.1;
      this.emitUi(true);
      return;
    }

    if (active.statuses.seal === 0) {
      active.chakra = Math.min(100, active.chakra + 20);
    }

    const foe = this.nearestEnemy(active);
    if (foe) active.dir = foe.x >= active.x ? 1 : -1;

    if (this.isAiTurn()) {
      this.planAiShot();
    } else {
      this.phase = 'aim';
    }
    this.emitUi(true);
  }

  private planAiShot(): void {
    this.phase = 'ai';
    const ai = this.fighters[this.turnIndex];

    if (ai.chakra >= 100 && ai.statuses.seal === 0) {
      ai.armedAction = 'ultimate';
    } else if (
      ai.runtime.entry.combat.hasDistinctSkill &&
      ai.chakra >= ai.runtime.entry.combat.skill.chakraCost &&
      ai.statuses.seal === 0 &&
      Math.random() < 0.45
    ) {
      ai.armedAction = 'skill';
    } else {
      ai.armedAction = 'attack';
    }

    const origin = this.getLaunchOrigin(ai);

    // Solve a shot for every living enemy, then pick the most valuable reachable one
    const options = this.livingEnemies(ai).map((target) => {
      const shot = this.solveAiShot(origin, target);
      const reachable = shot.dist < Math.max(26, target.runtime.bodyWidth * 0.5);
      const wounded = 1 - target.hp / target.maxHp;
      const alreadyAirborne = target.air ? 0.15 : 0;
      const score = (reachable ? 10 : -shot.dist / 100) + wounded * 2 + alreadyAirborne + Math.random() * 0.5;
      return { shot, score };
    });
    options.sort((a, b) => b.score - a.score);
    const best = options[0]?.shot || { angle: -Math.PI * 0.72, power: 0.7, dist: 1e9 };

    const jitter = (Math.random() - 0.5) * 0.09;
    this.aiPlan = {
      angle: best.angle + jitter,
      power: Math.min(1, Math.max(0.2, best.power * (1 + jitter * 0.65))),
      delay: 1.35,
    };
  }

  private solveAiShot(
    origin: { x: number; y: number },
    target: FighterEntity
  ): { angle: number; power: number; dist: number } {
    const tx = target.x;
    const ty = target.y - target.runtime.bodyHeight * 0.5;
    let best = { angle: -Math.PI * 0.72, power: 0.7, dist: 1e9 };

    for (let i = 0; i < 130; i++) {
      const right = tx > origin.x;
      const angle = right
        ? -(0.18 + Math.random() * 1.2)
        : -Math.PI + (0.18 + Math.random() * 1.2);
      const power = 0.28 + Math.random() * 0.72;
      const speed = 260 + 760 * power;
      let x = origin.x;
      let y = origin.y;
      let vx = Math.cos(angle) * speed;
      let vy = Math.sin(angle) * speed;
      let minDist = 1e9;

      for (let step = 0; step < 360; step++) {
        vx += (this.wind * 14) / 60;
        vy += GRAVITY / 60;
        x += vx / 60;
        y += vy / 60;
        minDist = Math.min(minDist, Math.hypot(x - tx, y - ty));
        if (this.isSolid(x, y) || y > WORLD_H + 180) break;
      }

      if (minDist < best.dist) {
        best = { angle, power, dist: minDist };
      }
    }

    return best;
  }

  private getLaunchOrigin(f: FighterEntity): { x: number; y: number } {
    const slug = resolveRoleAnimationSlug(f.runtime.roles, new Set(f.runtime.animations.keys()), 'attack');
    const anim = this.getFighterAnim(f, slug);
    // Sample emitter point around the release window (~35% into attack animation)
    const sampleMs = anim ? Math.round(anim.durationMs * 0.35) : 0;
    return sampleEmitterWorldPosition({
      anim,
      elapsedMs: sampleMs,
      worldX: f.x,
      worldY: f.y,
      dir: f.dir,
      nativeFacing: f.runtime.facing,
      charWorldScale: f.runtime.charWorldScale,
      bodyHeight: f.runtime.bodyHeight,
    });
  }

  private fireShot(): void {
    if (!this.aim) return;
    const f = this.fighters[this.turnIndex];
    const { angle, power } = this.aim;
    const speed = 260 + 760 * power;
    f.dir = Math.cos(angle) >= 0 ? 1 : -1;

    // Play a clean launch/throw animation WITHOUT firing melee skill particles at the distant firing pad
    const anim = this.playFighterRole(f, 'attack', {
      loop: false,
      lockSec: 0.28,
      suppressTimelineEvents: true,
    });
    const origin = sampleEmitterWorldPosition({
      anim,
      elapsedMs: anim ? Math.round(anim.durationMs * 0.35) : 0,
      worldX: f.x,
      worldY: f.y,
      dir: f.dir,
      nativeFacing: f.runtime.facing,
      charWorldScale: f.runtime.charWorldScale,
      bodyHeight: f.runtime.bodyHeight,
    });

    this.spawnMuzzleBurst(origin.x, origin.y, angle, f.runtime.entry.combat.nature);
    audioEngine.playSynth('launch');

    this.projectile = {
      x: origin.x,
      y: origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      actionChoice: f.armedAction,
      trail: [],
    };
    this.phase = 'fly';
    this.aim = null;
    this.camFree = false;
    this.emitUi(true);
  }

  private onProjectileImpact(x: number, y: number, hitFighter: FighterEntity | null): void {
    const att = this.fighters[this.turnIndex];
    const actionChoice = this.projectile?.actionChoice || att.armedAction;
    const isUlt = Boolean(hitFighter && actionChoice === 'ultimate' && att.chakra >= 100);
    const isSkill = Boolean(
      hitFighter && !isUlt && actionChoice === 'skill' && att.chakra >= att.runtime.entry.combat.skill.chakraCost
    );
    const nature = att.runtime.entry.combat.nature;
    this.projectile = null;

    if (!hitFighter) {
      const craterR = 34;
      this.carveCrater(x, y, craterR);
      this.spawnTerrainBurst(x, y, false, nature);
      this.shake = Math.max(this.shake, 0.14);

      for (const f of this.fighters) {
        if (f.hp <= 0) continue;
        if (this.teamSize > 1 && f.team === att.team && f !== att) continue; // no friendly fire
        const dist = Math.hypot(x - f.x, y - (f.y - f.runtime.bodyHeight * 0.5));
        if (dist < craterR + 34) {
          const splashDmg = Math.round(att.runtime.entry.combat.baseDmg * 0.38);
          f.hp = Math.max(0, f.hp - splashDmg);
          f.hitFlash = 0.15;
          this.dmgNumbers.push({
            x: f.x,
            y: f.y - f.runtime.bodyHeight - 8,
            value: `${splashDmg}`,
            life: 1.2,
            big: false,
            crit: false,
            color: '#FCA5A5',
          });
          this.playFighterRole(f, 'hurt', { loop: false, lockSec: 0.45, actionEventOverride: 'hurt' });
        }
      }

      if (att.statuses.seal === 0) {
        att.chakra = Math.min(100, att.chakra + 12);
      }
      this.pushCallout('Errou...', x, y - 16, '#CBD5E1');
      this.phase = 'after';
      this.afterTimer = 1.2;
      this.emitUi(true);
      return;
    }

    // Direct hit: defer terrain crater carving to final impact beat so target doesn't sink before the combo!
    hitFighter.hitFlash = 0.16;
    hitFighter.vx = 0;
    this.spawnImpactSparks(x, y, false, nature);
    this.shake = Math.max(this.shake, 0.18);
    audioEngine.playSynth('hit');
    this.pushCallout(isUlt ? 'ÔGI ATIVADO!' : 'ACERTOU!', x, y - 20, '#FDE047');
    this.phase = 'after';
    this.afterTimer = 1.3;

    const effectiveChoice: ActionChoice = isUlt ? 'ultimate' : isSkill ? 'skill' : 'attack';
    this.focus[hitFighter.team] = hitFighter.index;
    const dashSeq: DashSequence = {
      attackerIdx: att.index,
      targetIdx: hitFighter.index,
      homes: new Map([[att.index, att.x]]),
      returns: [],
      actionChoice: effectiveChoice,
      phase: 'approach',
      t: 0,
      x0: att.x,
      x1: hitFighter.x + (hitFighter.x > att.x ? -62 : 62),
      dashDur: Math.min(0.55, 0.18 + Math.abs(hitFighter.x - att.x) / 3400),
      waitDur: 0,
      strikeElapsed: 0,
      strikeDur: 0.8,
      xChaseStart: att.x,
      xChaseEnd: hitFighter.x,
      lastCausedState: 'popup',
      usedChaserSlots: new Set<string>(),
      comboCount: 1,
    };

    if (effectiveChoice === 'ultimate') {
      this.triggerUltimateCutIn(att, () => {
        this.dash = dashSeq;
      });
    } else {
      this.dash = dashSeq;
    }
    this.emitUi(true);
  }

  private triggerUltimateCutIn(att: FighterEntity, onDone: () => void): void {
    const combat = att.runtime.entry.combat;
    const ultAnim = this.getFighterAnim(
      att,
      resolveRoleAnimationSlug(att.runtime.roles, new Set(att.runtime.animations.keys()), 'ultimate')
    );

    // Find video from eventsMs.videos[0].key or fallback to 'ultimate'
    let videoUrl: string | undefined;
    const vidKey = ultAnim?.eventsMs.videos[0]?.key;
    if (vidKey) {
      videoUrl =
        att.runtime.videoUrls.get(vidKey) ||
        att.runtime.videoUrls.get(vidKey.toLowerCase()) ||
        att.runtime.videoUrls.get(toGameSlug(vidKey, 'video'));
    }
    if (!videoUrl) {
      videoUrl = att.runtime.videoUrls.get('ultimate') || att.runtime.videoUrls.values().next().value;
    }

    const pending: NonNullable<typeof this.cutInPending> = {
      active: true,
      showVideo: false,
      videoUrl,
      icoUrl: att.runtime.entry.previewIcoUrl || att.runtime.entry.previewFaceUrl,
      skillName: combat.ultimate.name,
      ninjaName: att.runtime.entry.name,
      onDone,
    };
    this.cutInPending = pending;
    this.emitUi(true);

    pending.ribbonTimer = window.setTimeout(() => {
      if (this.cutInPending !== pending || this.disposed) return;
      if (videoUrl) {
        pending.showVideo = true;
        this.emitUi(true);
        pending.safetyTimer = window.setTimeout(() => this.finishCutInVideo(), 8000);
      } else {
        pending.safetyTimer = window.setTimeout(() => this.finishCutInVideo(), 480);
      }
    }, 900);
  }

  private beginMeleeStrike(D: DashSequence, isChase: boolean): void {
    const att = this.fighters[D.attackerIdx];
    const tg = this.fighters[D.targetIdx];
    const combat = att.runtime.entry.combat;

    att.dir = att.x <= tg.x ? 1 : -1;

    if (isChase && D.activeChaser) {
      const ch = D.activeChaser;
      const isCrit = Math.random() < combat.critChance;
      const totalDamage = Math.round(combat.baseDmg * 0.55 * (isCrit ? 1.3 : 1));
      const anim = this.playFighterRole(att, 'chase', {
        loop: false,
        preferredSlug: ch.animSlug,
        actionEventOverride: 'chase',
        strike: {
          attackerIdx: D.attackerIdx,
          targetIdx: D.targetIdx,
          actionKind: 'chase',
          totalDamage,
          isBig: false,
          isCrit,
          causesState: ch.causesState,
          statusEffects: ch.statusEffects,
          hitLabel: ch.name,
          comboCount: D.comboCount,
        },
      });
      D.lastCausedState = ch.causesState;
      D.strikeElapsed = 0;
      D.strikeDur = this.computeStrikeDurationSec(att, anim);
      att.lockSec = D.strikeDur;
      return;
    }

    const spec =
      D.actionChoice === 'ultimate'
        ? combat.ultimate
        : D.actionChoice === 'skill'
          ? combat.skill
          : combat.attack;
    const role: AnimRoleKey =
      D.actionChoice === 'ultimate'
        ? 'ultimate'
        : D.actionChoice === 'skill'
          ? 'skill'
          : 'attack';

    if (D.actionChoice === 'ultimate') {
      att.chakra = 0;
      att.armedAction = 'attack';
    } else if (D.actionChoice === 'skill') {
      att.chakra = Math.max(0, att.chakra - spec.chakraCost);
      att.armedAction = 'attack';
    } else if (att.statuses.seal === 0) {
      att.chakra = Math.min(100, att.chakra + 35);
    }

    const isCrit = Math.random() < combat.critChance;
    const totalDamage = Math.round(combat.baseDmg * spec.damageMultiplier * (isCrit ? 1.3 : 1));

    const anim = this.playFighterRole(att, role, {
      loop: false,
      preferredSlug: spec.animSlug,
      actionEventOverride: role,
      strike: {
        attackerIdx: D.attackerIdx,
        targetIdx: D.targetIdx,
        actionKind: role,
        totalDamage,
        isBig: D.actionChoice === 'ultimate',
        isCrit,
        causesState: spec.causesState,
        statusEffects: spec.statusEffects,
        hitLabel: spec.name,
        comboCount: 1,
      },
    });

    D.lastCausedState = spec.causesState;
    D.strikeElapsed = 0;
    D.strikeDur = this.computeStrikeDurationSec(att, anim);
    att.lockSec = D.strikeDur;
    this.emitUi(true);
  }

  /** Chase skills of every ally still able to join the current chain, in lineup order */
  private availableChasers(
    D: DashSequence
  ): Array<{ fighter: FighterEntity; chaser: ChaseSkillSpec; key: string }> {
    const tg = this.fighters[D.targetIdx];
    const limit = this.teamSize > 1 ? MAX_TEAM_CHAIN : 3;
    if (tg.hp <= 0 || D.usedChaserSlots.size >= limit) return [];

    const turnOwner = this.fighters[this.turnIndex];
    const out: Array<{ fighter: FighterEntity; chaser: ChaseSkillSpec; key: string }> = [];
    for (const fighter of this.teamMembers(turnOwner.team)) {
      if (fighter.hp <= 0) continue;
      // Allies outside their own turn need to be free to move
      if (fighter !== turnOwner && fighter.statuses.paralysis > 0) continue;
      if (fighter !== turnOwner && fighter.air && !D.homes.has(fighter.index)) continue;
      for (const chaser of fighter.runtime.entry.combat.chasers) {
        const key = `${fighter.index}:${chaser.slot}:${chaser.name}`;
        if (!D.usedChaserSlots.has(key)) out.push({ fighter, chaser, key });
      }
    }
    return out;
  }

  private findMatchingChaser(D: DashSequence) {
    const tg = this.fighters[D.targetIdx];
    return this.availableChasers(D).find(
      ({ chaser }) =>
        (tg.chaseState && chaser.requiresStates.includes(tg.chaseState)) ||
        (D.lastCausedState !== 'fall' && chaser.requiresStates.includes(D.lastCausedState))
    );
  }

  private ensureMoveAnim(f: FighterEntity): void {
    const moveSlug = resolveRoleAnimationSlug(
      f.runtime.roles,
      new Set(f.runtime.animations.keys()),
      'move'
    );
    if (f.animSlug !== moveSlug) {
      this.playFighterRole(f, 'move', { loop: true, lockSec: 0 });
    }
  }

  private queueReturn(D: DashSequence, f: FighterEntity): void {
    const home = D.homes.get(f.index) ?? f.x;
    f.silhouette = false;
    f.lockSec = 0;
    D.returns.push({
      idx: f.index,
      fromX: f.x,
      toX: home,
      t: 0,
      dur: Math.min(0.55, 0.18 + Math.abs(f.x - home) / 3400),
    });
  }

  private updateReturns(D: DashSequence, dt: number): void {
    const tg = this.fighters[D.targetIdx];
    D.returns = D.returns.filter((trip) => {
      const f = this.fighters[trip.idx];
      trip.t += dt;
      const k = Math.min(1, trip.t / Math.max(0.05, trip.dur));
      f.x = trip.fromX + (trip.toX - trip.fromX) * k;
      f.y = this.findGroundY(f.x);
      f.dir = trip.toX >= trip.fromX ? 1 : -1;
      if (f.hp > 0) this.ensureMoveAnim(f);
      if (k < 1) return true;
      f.air = false;
      f.vy = 0;
      f.lockSec = 0;
      f.dir = tg.x >= f.x ? 1 : -1;
      if (f.hp > 0) this.playFighterRole(f, 'idle', { loop: true, lockSec: 0 });
      return false;
    });
  }

  private updateDash(dt: number): void {
    const D = this.dash;
    if (!D) return;
    this.updateReturns(D, dt);

    const att = this.fighters[D.attackerIdx];
    const tg = this.fighters[D.targetIdx];
    const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, Math.max(0, k));

    D.t += dt;
    att.silhouette =
      D.phase === 'chaseDash' || (D.phase === 'chaseStrike' && D.strikeElapsed < 0.35);

    if (D.phase === 'approach') {
      att.x = lerp(D.x0, D.x1, D.t / Math.max(0.05, D.dashDur));
      att.y = this.findGroundY(att.x);
      att.dir = D.x1 >= D.x0 ? 1 : -1;
      this.ensureMoveAnim(att);
      if (D.t >= D.dashDur) {
        att.x = D.x1;
        att.y = this.findGroundY(att.x);
        att.air = false;
        att.vy = 0;
        D.phase = 'strike';
        D.t = 0;
        this.beginMeleeStrike(D, false);
      }
    } else if (D.phase === 'strike' || D.phase === 'chaseStrike') {
      D.strikeElapsed += dt;
      if (D.strikeElapsed >= D.strikeDur) {
        // Guarantee final impact wasn't missed if animation ended slightly early
        const st = att.timeline?.strike;
        if (st && !st.finalImpactApplied) {
          this.deliverSynchronizedHitBeat(att, tg, st, 0, 1, true);
        }
        D.phase = 'chaseWait';
        D.t = 0;
        D.waitDur = 0;
      }
    } else if (D.phase === 'chaseWait') {
      D.waitDur += dt;
      const next = this.findMatchingChaser(D);
      const waitingForFall =
        !next &&
        tg.hp > 0 &&
        tg.air &&
        this.availableChasers(D).some((c) => c.chaser.requiresStates.includes('fall'));

      if (next) {
        const ally = next.fighter;
        if (ally.index !== att.index) {
          // Hand the chain over: previous striker runs home while the ally dashes in
          this.queueReturn(D, att);
          const trip = D.returns.find((r) => r.idx === ally.index);
          D.returns = D.returns.filter((r) => r.idx !== ally.index);
          if (!trip && !D.homes.has(ally.index)) D.homes.set(ally.index, ally.x);
          D.attackerIdx = ally.index;
          this.focus[ally.team] = ally.index;
        }
        D.usedChaserSlots.add(next.key);
        D.activeChaser = next.chaser;
        D.comboCount++;
        D.phase = 'chaseDash';
        D.t = 0;
        D.xChaseStart = ally.x;
        const side = tg.x >= ally.x ? -60 : 60;
        D.xChaseEnd = Math.min(WORLD_W - 30, Math.max(30, tg.x + side));
        audioEngine.playSynth('chase');
        this.pushCallout('PERSEGUIÇÃO!', tg.x, tg.y - tg.runtime.bodyHeight - 24, '#7DD3FC');
      } else if (waitingForFall && D.waitDur < 2.6) {
        // Wait for airborne enemy to land and trigger 'fall' chase!
      } else {
        D.phase = 'return';
        D.t = 0;
        this.queueReturn(D, att);
      }
    } else if (D.phase === 'chaseDash') {
      att.x = lerp(D.xChaseStart, D.xChaseEnd, D.t / 0.16);
      att.y = this.findGroundY(att.x);
      att.dir = D.xChaseEnd >= D.xChaseStart ? 1 : -1;
      this.ensureMoveAnim(att);
      if (D.t >= 0.16) {
        att.x = D.xChaseEnd;
        att.y = this.findGroundY(att.x);
        att.air = false;
        att.vy = 0;
        D.phase = 'chaseStrike';
        D.t = 0;
        this.beginMeleeStrike(D, true);
      }
    } else if (D.phase === 'return' && D.returns.length === 0) {
      this.dash = null;
    }
  }

  private endMatch(): void {
    this.phase = 'over';
    const alive0 = this.isTeamAlive(0);
    const alive1 = this.isTeamAlive(1);
    this.winnerTeam = alive0 && !alive1 ? 0 : alive1 && !alive0 ? 1 : -1;
    if (this.winnerTeam === 0 || this.winnerTeam === 1) {
      const winners = this.teamMembers(this.winnerTeam).filter((f) => f.hp > 0);
      for (const f of winners) this.playFighterRole(f, 'win', { loop: true, lockSec: 0 });
      this.focus[this.winnerTeam] = winners[0].index;
      audioEngine.playSynth('win');
    }
    this.emitUi(true);
  }

  /* ---------- Main Update Loop ---------- */

  private loop = (now: number): void => {
    if (this.disposed) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastNow) / 1000));
    this.lastNow = now;
    this.nowMs = now;

    this.update(dt);
    this.render();

    if (now - this.lastUiEmit > 90) {
      this.emitUi(false);
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    // Freeze physics cleanly during cut-in video
    if (this.cutInPending) return;

    const active = this.fighters[this.turnIndex];

    // 1. Update fighters physics, terrain settling, and animation timelines
    for (const f of this.fighters) {
      if (f.hitFlash > 0) f.hitFlash = Math.max(0, f.hitFlash - dt);
      this.tickFighterTimeline(f);
      if (f.hp <= 0 && this.isOffMap(f)) continue;

      if (this.isSolid(f.x, f.y) && f.vy >= 0) {
        let steps = 0;
        while (this.isSolid(f.x, f.y) && steps++ < 16) f.y--;
      }

      if (f.vy < 0 || !this.isSolid(f.x, f.y + 1)) {
        f.vy += FIGHTER_GRAVITY * dt;
        f.y += f.vy * dt;
        f.air = true;
        if (this.isOffMap(f)) f.hp = 0;
      } else {
        if (f.air) {
          f.air = false;
          f.vx = 0;
          this.spawnDust(f.x, f.y, 10);
          if (f.chaseState === 'popup' || f.chaseState === 'launcher') {
            f.chaseState = 'fall';
            this.playFighterRole(f, 'fall', { loop: false, lockSec: 0.85 });
          }
        }
        f.vy = 0;
      }

      if (Math.abs(f.vx) > 0.5) {
        const nx = f.x + f.vx * dt;
        if (nx > 28 && nx < WORLD_W - 28 && !this.isSolid(nx, f.y - 12)) {
          f.x = nx;
        } else {
          f.vx = 0;
        }
        f.vx *= Math.pow(0.05, dt);
      } else {
        f.vx = 0;
      }

      if (f.hp > 0 && f.lockSec > 0) {
        f.lockSec = Math.max(0, f.lockSec - dt);
      }

      const isBusyInDash = Boolean(
        this.dash &&
          ((this.dash.attackerIdx === f.index && this.dash.phase !== 'return') ||
            this.dash.returns.some((r) => r.idx === f.index) ||
            (this.dash.targetIdx === f.index && this.dash.phase !== 'return'))
      );

      if (f.hp > 0 && !f.air && f.lockSec <= 0 && !isBusyInDash && this.phase !== 'over') {
        const avail = new Set(f.runtime.animations.keys());
        const idleSlug = resolveRoleAnimationSlug(f.runtime.roles, avail, 'idle') || 'idle';
        const moveSlug = resolveRoleAnimationSlug(f.runtime.roles, avail, 'move');
        if (f.animSlug !== idleSlug && f.animSlug !== moveSlug) {
          this.playFighterRole(f, 'idle', { loop: true, lockSec: 0 });
          f.chaseState = null;
        }
      }

      const dieSlug = resolveRoleAnimationSlug(
        f.runtime.roles,
        new Set(f.runtime.animations.keys()),
        'die'
      );
      if (f.hp <= 0 && !f.air && f.animSlug !== dieSlug) {
        this.playFighterRole(f, 'die', { loop: false, lockSec: 0 });
      }

      // Status flame / poison ambient embers
      if (f.statuses.burn > 0 && f.hp > 0 && Math.random() < 0.45) {
        const r = Math.random();
        this.particles.push({
          kind: 'circle',
          x: f.x + (r - 0.5) * 28,
          y: f.y - r * f.runtime.bodyHeight * 0.85,
          vx: (r - 0.5) * 20,
          vy: -55,
          g: -80,
          life: 0.45,
          maxLife: 0.45,
          r: 2 + r * 3,
          color: r < 0.5 ? '#FB923C' : '#FDE047',
        });
      }
    }

    // 2. Active fighter walking (left/right movement)
    const moveCap = active.statuses.slow > 0 ? MOVE_BUDGET * 0.5 : MOVE_BUDGET;
    const canMove =
      this.phase === 'aim' &&
      this.moveDir !== 0 &&
      !this.isAiTurn() &&
      active.moveUsed < moveCap &&
      active.lockSec <= 0 &&
      !this.dash;

    const activeMoveSlug = resolveRoleAnimationSlug(
      active.runtime.roles,
      new Set(active.runtime.animations.keys()),
      'move'
    );

    if (canMove) {
      const speed = active.statuses.slow > 0 ? 52 : 84;
      const nx = active.x + this.moveDir * speed * dt;
      let ny: number | null = null;
      for (let climb = 0; climb <= 14; climb++) {
        if (!this.isSolid(nx, active.y - climb)) {
          ny = active.y - climb;
          break;
        }
      }
      if (ny !== null && nx > 28 && nx < WORLD_W - 28) {
        active.x = nx;
        active.y = ny;
        active.moveUsed += speed * dt;
      }
      active.dir = this.moveDir as 1 | -1;
      if (active.animSlug !== activeMoveSlug && !active.air) {
        this.playFighterRole(active, 'move', { loop: true, lockSec: 0 });
      }
    } else if (
      active.animSlug === activeMoveSlug &&
      !this.dash &&
      this.phase !== 'over'
    ) {
      this.playFighterRole(active, 'idle', { loop: true, lockSec: 0 });
    }

    // 3. Turn timer & AI firing
    if (this.phase === 'aim') {
      this.timerSec -= dt;
      if (this.timerSec <= 0) {
        this.startTurn(false);
      }
    } else if (this.phase === 'ai' && this.aiPlan) {
      this.aim = { angle: this.aiPlan.angle, power: this.aiPlan.power };
      this.aiPlan.delay -= dt;
      if (this.aiPlan.delay <= 0) {
        this.fireShot();
      }
    }

    // 4. Projectile sub-stepped physics
    if (this.phase === 'fly' && this.projectile) {
      const pr = this.projectile;
      const subSteps = 4;
      for (let s = 0; s < subSteps && this.phase === 'fly' && this.projectile; s++) {
        const sdt = dt / subSteps;
        pr.vx += this.wind * 14 * sdt;
        pr.vy += GRAVITY * sdt;
        pr.x += pr.vx * sdt;
        pr.y += pr.vy * sdt;
        pr.trail.push([pr.x, pr.y]);
        if (pr.trail.length > 30) pr.trail.shift();

        // Allies are passed through: only living enemies can be struck
        const struck = this.livingEnemies(active).find(
          (o) =>
            Math.abs(pr.x - o.x) < Math.max(22, o.runtime.bodyWidth * 0.45) &&
            pr.y > o.y - o.runtime.bodyHeight &&
            pr.y < o.y + 4
        );
        if (struck) {
          this.onProjectileImpact(pr.x, pr.y, struck);
        } else if (this.isSolid(pr.x, pr.y)) {
          this.onProjectileImpact(pr.x, pr.y, null);
        } else if (pr.x < -160 || pr.x > WORLD_W + 160 || pr.y > WORLD_H + 200) {
          this.projectile = null;
          this.phase = 'after';
          this.afterTimer = 0.9;
        }
      }
      if (this.projectile) {
        this.spawnProjectileTrail(this.projectile, active.runtime.entry.combat.nature);
      }
    }

    // 5. Dash / melee / chase sequence
    if (this.dash) {
      this.updateDash(dt);
    }

    // A ninja that drops out of the map during its own turn forfeits it
    if ((this.phase === 'aim' || this.phase === 'ai') && active.hp <= 0) {
      this.aim = null;
      this.aiPlan = null;
      this.phase = 'after';
      this.afterTimer = 0.9;
    }

    // 6. After-shot turn transition
    if (this.phase === 'after') {
      this.afterTimer -= dt;
      const settled =
        this.afterTimer <= 0 &&
        !this.dash &&
        !this.cutInPending &&
        this.fighters.every(
          (f) => (f.hp <= 0 && this.isOffMap(f)) || (!f.air && (f.hp <= 0 || f.lockSec <= 0))
        );
      if (settled) {
        if (!this.isTeamAlive(0) || !this.isTeamAlive(1)) {
          this.endMatch();
        } else {
          this.startTurn(false);
        }
      }
    }

    // 7. Update visual particles, beams, numbers, callouts, effects, HUD timers
    for (const p of this.particles) {
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.kind === 'ring' && p.growR) p.r += p.growR * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);

    for (const d of this.dmgNumbers) {
      d.life -= dt;
      d.y -= 36 * dt;
    }
    this.dmgNumbers = this.dmgNumbers.filter((d) => d.life > 0);

    for (const c of this.callouts) c.life -= dt;
    this.callouts = this.callouts.filter((c) => c.life > 0);

    this.effects = this.effects.filter((e) => this.nowMs - e.startMs < e.durationMs + 40);
    this.shake = Math.max(0, this.shake - dt * 1.3);

    if (this.hitsTimer > 0) {
      this.hitsTimer -= dt;
      if (this.hitsTimer <= 0) {
        this.hits = 0;
        this.emitUi(true);
      }
    }
    if (this.comboBannerTimer > 0) {
      this.comboBannerTimer -= dt;
      if (this.comboBannerTimer <= 0) {
        this.comboBanner = null;
        this.emitUi(true);
      }
    }

    // 8. Smooth camera follow & bounds clamping
    const W = Math.max(1, this.canvas.clientWidth);
    const H = Math.max(1, this.canvas.clientHeight);
    const minZ = Math.max(W / WORLD_W, H / WORLD_H);

    let camTarget = { x: active.x, y: active.y - 95 };
    if (this.phase === 'fly' && this.projectile) {
      camTarget = { x: this.projectile.x, y: this.projectile.y };
    } else if (this.dash) {
      const striker = this.fighters[this.dash.attackerIdx];
      const tg = this.fighters[this.dash.targetIdx];
      // While an ally is still crossing the map, keep the camera on the target
      const from = Math.abs(striker.x - tg.x) > 420 ? tg : striker;
      camTarget = {
        x: (from.x + tg.x) / 2,
        y: Math.min(from.y, tg.y) - 85,
      };
    } else if (this.phase === 'over' && (this.winnerTeam === 0 || this.winnerTeam === 1)) {
      const w = this.fighters[this.focus[this.winnerTeam]];
      camTarget = { x: w.x, y: w.y - 85 };
    }

    // Animations with high jumps zoom out so the ninja never leaves the screen
    const jumper = this.fighters.find(
      (f) => f.hp > 0 && this.getFighterAnim(f)?.anchor.cameraHeadroomPx
    );
    let skyTarget = 0;
    if (jumper) {
      const anchor = this.getFighterAnim(jumper)!.anchor;
      const headroom =
        (anchor.cameraHeadroomPx! * jumper.runtime.charWorldScale) /
        Math.max(0.05, anchor.worldToPixelScale || 1);
      const viewTop = jumper.y - headroom;
      const viewBottom = jumper.y + 75;
      if (this.camZoomBeforeJump === null) this.camZoomBeforeJump = this.cam.z;
      const fitZ = Math.max(minZ, Math.min(this.camZoomBeforeJump, H / (viewBottom - viewTop)));
      this.cam.z += (fitZ - this.cam.z) * Math.min(1, dt * 7);
      camTarget = { x: jumper.x, y: viewBottom - H / 2 / fitZ };
      skyTarget = Math.max(0, -(viewBottom - H / fitZ));
    } else if (this.camZoomBeforeJump !== null) {
      this.cam.z += (this.camZoomBeforeJump - this.cam.z) * Math.min(1, dt * 4.5);
      if (Math.abs(this.camZoomBeforeJump - this.cam.z) < 0.01) {
        this.cam.z = this.camZoomBeforeJump;
        this.camZoomBeforeJump = null;
      }
    }
    this.camSkyPx += (skyTarget - this.camSkyPx) * Math.min(1, dt * (jumper ? 9 : 4.5));

    if (!this.camFree || this.phase === 'fly' || Boolean(this.dash) || jumper) {
      const lerpRate = Math.min(1, dt * (this.phase === 'fly' ? 9 : 4.5));
      this.cam.x += (camTarget.x - this.cam.x) * lerpRate;
      this.cam.y += (camTarget.y - this.cam.y) * lerpRate;
    }

    this.cam.z = Math.min(2.6, Math.max(minZ, this.cam.z));
    this.cam.x = Math.min(WORLD_W - W / 2 / this.cam.z, Math.max(W / 2 / this.cam.z, this.cam.x));
    this.cam.y = Math.min(
      WORLD_H - H / 2 / this.cam.z,
      Math.max(H / 2 / this.cam.z - this.camSkyPx, this.cam.y)
    );
  }

  /* ---------- Canvas Rendering ---------- */

  private render(): void {
    const W = Math.max(1, this.canvas.clientWidth);
    const H = Math.max(1, this.canvas.clientHeight);
    const dpr = Math.min(this.maxPixelRatio, window.devicePixelRatio || 1);
    const cw = Math.round(W * dpr);
    const ch = Math.round(H * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 1. Atmospheric moonlit shinobi valley sky
    const sky = ctx.createLinearGradient(0, 0, 0, ch);
    sky.addColorStop(0, '#0B132B');
    sky.addColorStop(0.55, '#1C2B54');
    sky.addColorStop(1, '#314473');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, cw, ch);

    // Subtle stars & moon glow
    for (const s of this.stars) {
      ctx.fillStyle = `rgba(226, 238, 255, ${s.a})`;
      ctx.beginPath();
      ctx.arc(s.x * cw, s.y * ch, s.r * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    const moonX = cw * 0.78;
    const moonY = ch * 0.19;
    const moonHalo = ctx.createRadialGradient(moonX, moonY, 8 * dpr, moonX, moonY, 130 * dpr);
    moonHalo.addColorStop(0, 'rgba(255, 248, 220, 0.28)');
    moonHalo.addColorStop(0.4, 'rgba(180, 205, 255, 0.08)');
    moonHalo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = moonHalo;
    ctx.fillRect(moonX - 140 * dpr, moonY - 140 * dpr, 280 * dpr, 280 * dpr);
    ctx.fillStyle = '#FFF9E6';
    ctx.beginPath();
    ctx.arc(moonX, moonY, 22 * dpr, 0, Math.PI * 2);
    ctx.fill();

    // Distant mountain silhouettes (subtle parallax)
    const paraX = (this.cam.x / WORLD_W - 0.5) * 90 * dpr;
    ctx.fillStyle = 'rgba(14, 22, 46, 0.55)';
    ctx.beginPath();
    ctx.moveTo(0, ch);
    for (let i = 0; i <= 10; i++) {
      const mx = (i / 10) * cw;
      const my = ch * 0.62 - Math.sin(i * 1.15 + 0.6) * 54 * dpr - Math.cos(i * 2.1) * 24 * dpr;
      ctx.lineTo(mx - paraX * 0.4, my);
    }
    ctx.lineTo(cw, ch);
    ctx.closePath();
    ctx.fill();

    // 2. World transform with screen shake
    const shk = this.shake * 28 * dpr;
    const z = this.cam.z * dpr;
    ctx.setTransform(
      z,
      0,
      0,
      z,
      (dpr * W) / 2 - this.cam.x * z + (Math.random() - 0.5) * shk,
      (dpr * H) / 2 - this.cam.y * z + (Math.random() - 0.5) * shk
    );

    // 3. Destructible terrain
    ctx.drawImage(this.terrainCanvas, 0, 0);

    const getFighterPos = (idx: number) => {
      const f = this.fighters[idx];
      return f ? { x: f.x, y: f.y, dir: f.dir } : null;
    };

    // 4. Behind-character effects layer (pre-rendered PNG+JSON or fixed Spine)
    drawActiveEffectsLayer(ctx, this.effects, 'behind', this.nowMs, getFighterPos);

    // 5. Fighters anchored cleanly on ground via feet pivot
    for (const f of this.fighters) {
      if (f.hp <= 0 && this.isOffMap(f)) continue;

      // Team marker under every living ninja in squad battles
      if (this.teamSize > 1 && f.hp > 0) {
        ctx.fillStyle = f.team === 0 ? 'rgba(56, 189, 248, 0.34)' : 'rgba(244, 63, 94, 0.34)';
        ctx.beginPath();
        ctx.ellipse(f.x, f.y + 1, 36, 10, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Ground shadow ellipse
      ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
      ctx.beginPath();
      ctx.ellipse(f.x, f.y + 1, 28, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      // Target reticle ellipse under opponent during aiming
      if (f.team !== this.activeTeam && f.hp > 0 && (this.phase === 'aim' || this.phase === 'ai')) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(f.x, f.y + 1, 34, 9, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      const anim = this.getFighterAnim(f);
      if (anim) {
        drawCompiledAnimationFrame({
          ctx,
          anim,
          elapsedMs: this.nowMs - f.animStartMs,
          loop: f.animLoop,
          worldX: f.x,
          worldY: f.y + 1,
          dir: f.dir,
          nativeFacing: f.runtime.facing,
          charWorldScale: f.runtime.charWorldScale,
          silhouetteColor: f.silhouette ? '#FFFFFF' : f.hitFlash > 0 ? 'rgba(255,255,255,0.85)' : null,
        });
      }

      // Shield aura ring
      if (f.statuses.shield > 0 && f.hp > 0) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.72)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(f.x, f.y - f.runtime.bodyHeight * 0.5, 42, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Overhead compact HP bar & turn marker
      const barY = f.y - f.runtime.bodyHeight - 16;
      if (this.teamSize > 1 && f.hp <= 0) continue;
      ctx.fillStyle = 'rgba(6, 10, 24, 0.78)';
      ctx.fillRect(f.x - 28, barY, 56, 7);
      const hpRatio = Math.max(0, f.hp / Math.max(1, f.maxHp));
      const teamColor = this.teamSize > 1 && f.team === 1 ? '#FB7185' : '#22C55E';
      ctx.fillStyle = hpRatio > 0.35 ? teamColor : '#EF4444';
      ctx.fillRect(f.x - 26, barY + 1.5, 52 * hpRatio, 4);

      if (f.index === this.turnIndex && this.phase !== 'over') {
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.moveTo(f.x - 6, barY - 12);
        ctx.lineTo(f.x + 6, barY - 12);
        ctx.lineTo(f.x, barY - 4);
        ctx.closePath();
        ctx.fill();
      }

      if (this.teamSize > 1) {
        ctx.font = '700 11px "Plus Jakarta Sans", system-ui';
        ctx.textAlign = 'center';
        ctx.fillStyle = f.team === 0 ? '#BAE6FD' : '#FECDD3';
        ctx.fillText(f.runtime.entry.name.split(' ')[0], f.x, f.y + 20);
      }

      // Overhead status indicators (clean text labels)
      const activeSt: string[] = [];
      if (f.statuses.burn > 0) activeSt.push(`CHA ${f.statuses.burn}`);
      if (f.statuses.poison > 0) activeSt.push(`VEN ${f.statuses.poison}`);
      if (f.statuses.paralysis > 0) activeSt.push('PAR');
      if (f.statuses.seal > 0) activeSt.push('SEL');
      if (activeSt.length > 0) {
        ctx.font = '700 10px "Plus Jakarta Sans", system-ui';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#FDE047';
        ctx.fillText(activeSt.join(' · '), f.x, barY - 16);
      }
    }

    // 6. Front effects layer (slashes, explosions, hit impacts!)
    drawActiveEffectsLayer(ctx, this.effects, 'front', this.nowMs, getFighterPos);

    // 7. Aiming trajectory preview starting from actual emitterPoint!
    if (this.aim && this.phase !== 'fly') {
      const active = this.fighters[this.turnIndex];
      const origin = this.getLaunchOrigin(active);
      const speed = 260 + 760 * this.aim.power;
      let px = origin.x;
      let py = origin.y;
      let vx = Math.cos(this.aim.angle) * speed;
      let vy = Math.sin(this.aim.angle) * speed;

      const natColor = NATURE_COLORS[active.runtime.entry.combat.nature] || '#F59E0B';
      // Emitter anchor ring
      ctx.strokeStyle = natColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, 7, 0, Math.PI * 2);
      ctx.stroke();

      for (let i = 0; i < 34; i++) {
        for (let k = 0; k < 3; k++) {
          vx += (this.wind * 14) / 60;
          vy += GRAVITY / 60;
          px += vx / 60;
          py += vy / 60;
        }
        ctx.globalAlpha = Math.max(0.08, 1 - i / 36);
        ctx.fillStyle = i % 3 === 0 ? natColor : '#FFFFFF';
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1.8, 4.2 - i * 0.08), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 8. Flying projectile & energy trail
    if (this.projectile) {
      const pr = this.projectile;
      const col = NATURE_COLORS[this.fighters[this.turnIndex].runtime.entry.combat.nature] || '#F59E0B';
      pr.trail.forEach((pt, idx) => {
        ctx.globalAlpha = (idx / pr.trail.length) * 0.65;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], 2.2 + idx * 0.14, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 9. Procedural impact particles & chase beams
    ctx.lineCap = 'round';
    for (const q of this.particles) {
      ctx.globalAlpha = Math.min(1, q.life * 2.4);
      if (q.kind === 'ring') {
        ctx.strokeStyle = q.color;
        ctx.lineWidth = q.lineW || 2.5;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (q.kind === 'spark') {
        ctx.strokeStyle = q.color;
        ctx.lineWidth = q.r;
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(q.x - q.vx * 0.035, q.y - q.vy * 0.035);
        ctx.stroke();
      } else {
        ctx.fillStyle = q.color;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    for (const b of this.beams) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      const grad = ctx.createLinearGradient(-160, 0, 160, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, b.color);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = b.life / b.maxLife;
      ctx.fillStyle = grad;
      ctx.fillRect(-160, -4, 320, 8);
      ctx.restore();
    }

    // 10. Damage numbers & callouts
    for (const d of this.dmgNumbers) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, d.life * 2);
      ctx.font = `italic 900 ${d.big ? 44 : 28}px "Barlow Condensed", system-ui`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#3B1105';
      ctx.strokeText(d.value, d.x, d.y);
      ctx.fillStyle = d.color;
      ctx.fillText(d.value, d.x, d.y);
      ctx.restore();
    }

    for (const c of this.callouts) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, c.life * 2);
      ctx.font = '800 20px "Barlow Condensed", system-ui';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(10, 14, 30, 0.85)';
      const floatY = c.y - (c.maxLife - c.life) * 24;
      ctx.strokeText(c.text, c.x, floatY);
      ctx.fillStyle = c.color;
      ctx.fillText(c.text, c.x, floatY);
      ctx.restore();
    }
  }

  /* ---------- Visual FX Helpers ---------- */

  private addHits(delta: number): void {
    this.hits += delta;
    this.hitsKey++;
    this.hitsTimer = 2.6;
  }

  private showComboBanner(state: ChaseState, skillName: string, comboCount: number): void {
    this.comboBannerKey++;
    this.comboBanner = {
      stateLabel: CHASE_BANNER_LABELS[state] || 'COMBO',
      skillName,
      comboCount,
      key: this.comboBannerKey,
    };
    this.comboBannerTimer = 2.6;
  }

  private pushCallout(text: string, x: number, y: number, color: string): void {
    this.callouts.push({ text, x, y, life: 1.6, maxLife: 1.6, color });
  }

  private spawnDust(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        kind: 'circle',
        x: x + (Math.random() - 0.5) * 32,
        y: y - 2,
        vx: (Math.random() - 0.5) * 160,
        vy: -55 - Math.random() * 95,
        g: 300,
        life: 0.55 + Math.random() * 0.35,
        maxLife: 0.9,
        r: 2 + Math.random() * 3,
        color: '#9A7B55',
      });
    }
  }

  private spawnMuzzleBurst(x: number, y: number, angle: number, nature: keyof typeof NATURE_COLORS): void {
    const col = NATURE_COLORS[nature] || '#F59E0B';
    this.particles.push({
      kind: 'ring',
      x,
      y,
      vx: 0,
      vy: 0,
      g: 0,
      life: 0.25,
      maxLife: 0.25,
      r: 4,
      growR: 95,
      lineW: 3,
      color: col,
    });
    for (let i = 0; i < 10; i++) {
      const a = angle + (Math.random() - 0.5) * 1.1;
      const spd = 120 + Math.random() * 210;
      this.particles.push({
        kind: 'spark',
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        g: 0,
        life: 0.24,
        maxLife: 0.24,
        r: 2,
        color: i % 2 === 0 ? '#FFFFFF' : col,
      });
    }
  }

  private spawnProjectileTrail(pr: Projectile, nature: keyof typeof NATURE_COLORS): void {
    const col = NATURE_COLORS[nature] || '#F59E0B';
    if (nature === 'thunder') {
      if (Math.random() < 0.7) {
        const a = Math.random() * Math.PI * 2;
        const s = 180 + Math.random() * 260;
        this.particles.push({
          kind: 'spark',
          x: pr.x,
          y: pr.y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          g: 0,
          life: 0.12,
          maxLife: 0.12,
          r: 1.6,
          color: Math.random() < 0.5 ? '#FFFFFF' : col,
        });
      }
    } else {
      this.particles.push({
        kind: 'circle',
        x: pr.x + (Math.random() - 0.5) * 8,
        y: pr.y + (Math.random() - 0.5) * 8,
        vx: -pr.vx * 0.15 + (Math.random() - 0.5) * 30,
        vy: -pr.vy * 0.15 - 20,
        g: nature === 'fire' ? -80 : 40,
        life: 0.35,
        maxLife: 0.35,
        r: 2 + Math.random() * 2.2,
        color: col,
      });
    }
  }

  private spawnTerrainBurst(
    x: number,
    y: number,
    hit: boolean,
    nature: keyof typeof NATURE_COLORS
  ): void {
    const col = NATURE_COLORS[nature] || '#F59E0B';
    const R = hit ? 76 : 36;
    this.particles.push({
      kind: 'ring',
      x,
      y,
      vx: 0,
      vy: 0,
      g: 0,
      life: 0.35,
      maxLife: 0.35,
      r: 6,
      growR: R * 4.5,
      lineW: hit ? 5 : 3,
      color: col,
    });
    for (let i = 0; i < (hit ? 34 : 16); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * (hit ? 380 : 200);
      this.particles.push({
        kind: i % 2 === 0 ? 'spark' : 'circle',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 60,
        g: 320,
        life: 0.45 + Math.random() * 0.4,
        maxLife: 0.85,
        r: 2 + Math.random() * 2.5,
        color: i % 3 === 0 ? '#FFFFFF' : col,
      });
    }
    this.spawnDust(x, y, hit ? 18 : 9);
  }

  private spawnImpactSparks(
    x: number,
    y: number,
    big: boolean,
    nature: keyof typeof NATURE_COLORS
  ): void {
    const col = NATURE_COLORS[nature] || '#F59E0B';
    this.particles.push({
      kind: 'circle',
      x,
      y,
      vx: 0,
      vy: 0,
      g: 0,
      life: 0.14,
      maxLife: 0.14,
      r: big ? 44 : 24,
      color: '#FFFFFF',
    });
    for (let i = 0; i < (big ? 22 : 12); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 200 + Math.random() * (big ? 500 : 280);
      this.particles.push({
        kind: 'spark',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        g: 0,
        life: 0.28 + Math.random() * 0.18,
        maxLife: 0.46,
        r: 2 + Math.random() * 2,
        color: i % 2 === 0 ? col : '#FBBF24',
      });
    }
  }

  private spawnBeams(x: number, y: number, dir: 1 | -1): void {
    for (const offset of [-0.55, 0.55]) {
      this.beams.push({
        x,
        y,
        angle: offset + (dir > 0 ? 0 : Math.PI),
        life: 0.35,
        maxLife: 0.35,
        color: '#FFFFFF',
      });
    }
  }

  /* ---------- Pointer, Wheel & Keyboard Input ---------- */

  private clientToCanvasLocal(clientX: number, clientY: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    if (this.rotatedPortrait) {
      // Container rotated +90deg clockwise in portrait viewports
      return [clientY - rect.top, rect.right - clientX];
    }
    return [clientX - rect.left, clientY - rect.top];
  }

  private screenToWorld(clientX: number, clientY: number): [number, number] {
    const [sx, sy] = this.clientToCanvasLocal(clientX, clientY);
    return [
      (sx - this.canvas.clientWidth / 2) / this.cam.z + this.cam.x,
      (sy - this.canvas.clientHeight / 2) / this.cam.z + this.cam.y,
    ];
  }

  private getPinchDistance(): number {
    const vals = Array.from(this.pointers.values());
    if (vals.length < 2) return 1;
    return Math.hypot(vals[0][0] - vals[1][0], vals[0][1] - vals[1][1]) || 1;
  }

  private updateAimFromPointer(clientX: number, clientY: number): void {
    const active = this.fighters[this.turnIndex];
    const origin = this.getLaunchOrigin(active);
    const [wx, wy] = this.screenToWorld(clientX, clientY);
    const dx = origin.x - wx;
    const dy = origin.y - wy;
    const angle = Math.atan2(dy, dx);
    const power = Math.min(1, Math.hypot(dx, dy) / 155);
    active.dir = Math.cos(angle) >= 0 ? 1 : -1;
    this.aim = { angle, power };
  }

  private handlePointerDown = (e: PointerEvent): void => {
    audioEngine.unlock();
    this.canvas.setPointerCapture(e.pointerId);
    const [sx, sy] = this.clientToCanvasLocal(e.clientX, e.clientY);
    this.pointers.set(e.pointerId, [sx, sy]);

    if (this.pointers.size === 2) {
      this.gesture = { mode: 'zoom', dist: this.getPinchDistance(), baseZoom: this.cam.z };
      this.aim = null;
      this.camFree = true;
      return;
    }

    if (
      this.phase === 'aim' &&
      !this.isAiTurn() &&
      this.fighters[this.turnIndex].lockSec <= 0
    ) {
      const active = this.fighters[this.turnIndex];
      const activeSx = (active.x - this.cam.x) * this.cam.z + this.canvas.clientWidth / 2;
      const activeSy =
        (active.y - active.runtime.bodyHeight * 0.5 - this.cam.y) * this.cam.z +
        this.canvas.clientHeight / 2;
      if (Math.hypot(sx - activeSx, sy - activeSy) < 115) {
        this.gesture = { mode: 'aim' };
        this.updateAimFromPointer(e.clientX, e.clientY);
        return;
      }
    }

    this.gesture = { mode: 'pan' };
    this.camFree = true;
  };

  private handlePointerMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev || !this.gesture) return;
    const next = this.clientToCanvasLocal(e.clientX, e.clientY);
    this.pointers.set(e.pointerId, next);

    if (this.gesture.mode === 'zoom' && this.pointers.size === 2) {
      this.cam.z = (this.gesture.baseZoom || 1.1) * (this.getPinchDistance() / (this.gesture.dist || 1));
    } else if (this.gesture.mode === 'pan') {
      this.cam.x -= (next[0] - prev[0]) / this.cam.z;
      this.cam.y -= (next[1] - prev[1]) / this.cam.z;
    } else if (this.gesture.mode === 'aim') {
      this.updateAimFromPointer(e.clientX, e.clientY);
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.gesture?.mode === 'aim') {
      if (this.aim && this.aim.power > 0.12 && e.type === 'pointerup' && this.phase === 'aim') {
        this.fireShot();
      } else {
        this.aim = null;
      }
    }
    if (this.pointers.size === 0) {
      this.gesture = null;
    } else if (this.gesture?.mode === 'zoom') {
      this.gesture = { mode: 'pan' };
    }
  };

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.camFree = true;
    const factor = e.deltaY > 0 ? 0.92 : 1.09;
    this.cam.z *= factor;
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.moveDir = -1;
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.moveDir = 1;
    else if (e.key === '1') this.selectAction('attack');
    else if (e.key === '2') this.selectAction('skill');
    else if (e.key === '3') this.selectAction('ultimate');
    else if (e.key === 'c' || e.key === 'C') this.centerCameraOnActive();
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (
      (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') &&
      this.moveDir === -1
    ) {
      this.moveDir = 0;
    } else if (
      (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') &&
      this.moveDir === 1
    ) {
      this.moveDir = 0;
    }
  };

  private bindInputEvents(): void {
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerUp);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  private unbindInputEvents(): void {
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerUp);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
  }

  /* ---------- UI Snapshot Emission ---------- */

  private toFighterHud(f: FighterEntity): FighterHudState {
    const e = f.runtime.entry;
    return {
      index: f.index,
      team: f.team,
      id: e.id,
      name: e.name,
      faceUrl: e.previewFaceUrl,
      artUrl: e.previewArtUrl,
      icoUrl: e.previewIcoUrl,
      nature: e.combat.nature,
      natureLabel: e.combat.natureLabel,
      roleLabel: e.combat.roleLabel,
      hp: Math.ceil(f.hp),
      maxHp: f.maxHp,
      chakra: Math.floor(f.chakra),
      armedAction: f.armedAction,
      totalDamage: f.totalDamage,
      biggestHit: f.biggestHit,
      statuses: { ...f.statuses },
      combat: e.combat,
    };
  }

  private previewTurnQueue(length: number): number[] {
    const queue = [this.turnIndex];
    const cursor: [number, number] = [this.turnCursor[0], this.turnCursor[1]];
    let team = this.activeTeam;
    while (queue.length < length) {
      team = team === 0 ? 1 : 0;
      const members = this.teamMembers(team);
      let next = members[0];
      for (let step = 1; step <= members.length; step++) {
        const slot = (cursor[team] + step) % members.length;
        if (members[slot].hp > 0) {
          cursor[team] = slot;
          next = members[slot];
          break;
        }
      }
      queue.push(next.index);
    }
    return queue;
  }

  private emitUi(force: boolean): void {
    if (!force && this.nowMs - this.lastUiEmit < 90) return;
    this.lastUiEmit = this.nowMs;
    const active = this.fighters[this.turnIndex];
    const moveCap = active.statuses.slow > 0 ? MOVE_BUDGET * 0.5 : MOVE_BUDGET;

    this.onUiUpdate({
      turnIndex: this.turnIndex,
      activeTeam: this.activeTeam,
      teamSize: this.teamSize,
      focus: [this.focus[0], this.focus[1]],
      turnQueue: this.previewTurnQueue(3),
      phase: this.phase,
      round: this.round,
      maxRounds: this.getMaxRounds(),
      timerSec: Math.max(0, Math.ceil(this.timerSec)),
      wind: this.wind,
      hits: this.hits,
      hitsKey: this.hitsKey,
      hitsVisible: this.hitsTimer > 0 && this.hits > 0,
      comboBanner: this.comboBanner,
      cutIn: this.cutInPending
        ? {
            active: this.cutInPending.active,
            showVideo: this.cutInPending.showVideo,
            videoUrl: this.cutInPending.videoUrl,
            icoUrl: this.cutInPending.icoUrl,
            skillName: this.cutInPending.skillName,
            ninjaName: this.cutInPending.ninjaName,
          }
        : null,
      fighters: this.fighters.map((f) => this.toFighterHud(f)),
      winnerTeam: this.winnerTeam,
      moveRemainingRatio: Math.max(0, 1 - active.moveUsed / Math.max(1, moveCap)),
    });
  }
}
