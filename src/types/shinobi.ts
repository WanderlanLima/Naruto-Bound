export type ChaseState = 'popup' | 'launcher' | 'fall' | 'back';

export type NatureKey = 'wind' | 'thunder' | 'water' | 'fire' | 'earth';

export type AnimRoleKey =
  | 'idle'
  | 'move'
  | 'jump'
  | 'fall'
  | 'attack'
  | 'skill'
  | 'ultimate'
  | 'chase'
  | 'hurt'
  | 'fly'
  | 'die'
  | 'win';

export type StatusEffectKind =
  | 'burn'
  | 'paralysis'
  | 'poison'
  | 'seal'
  | 'slow'
  | 'heal'
  | 'shield';

export interface StatusEffectSpec {
  kind: StatusEffectKind;
  label: string;
  turns: number;
  chance: number; // 0..1
  potency: number; // damage per turn or shield/heal value
}

export interface AnchorMetrics {
  anchorX: number;
  anchorY: number;
  anchorYBottom?: number;
  pivotPxX: number;
  pivotPxY: number;
  worldToPixelScale: number;
  computedFromOpaque?: boolean;
}

export interface AnimationHitEvent {
  timeMs: number;
  spineId: string;
  effectAnim: string;
  layer?: 'behind' | 'front';
}

export interface AnimationParticleEvent {
  timeMs: number;
  spineId: string;
  effectAnim: string;
  layer: 'behind' | 'front';
}

export interface AnimationSoundEvent {
  timeMs: number;
  soundName: string;
}

export interface AnimationVideoEvent {
  timeMs: number;
  key: string;
}

export interface AnimationEventsTimelineMs {
  hits: AnimationHitEvent[];
  particles: AnimationParticleEvent[];
  sounds: AnimationSoundEvent[];
  videos: AnimationVideoEvent[];
}

export interface FrameEmitterPoint {
  frame: number;
  timeMs: number;
  /** Pixel X relative to feet pivot (+X right) */
  x: number;
  /** Pixel Y relative to feet pivot (-Y up, +Y down) */
  y: number;
  bone?: string;
  source?: 'bone' | 'overlay' | 'bounds';
}

export interface SpriteFrameRect {
  filename: string;
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
  trimmed: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  pivot?: { x: number; y: number };
  durationMs: number;
}

export interface CompiledAnimation {
  slug: string;
  originalName: string;
  fps: number;
  frameCount: number;
  durationMs: number;
  cellWidth: number;
  cellHeight: number;
  /** Sheet width the frame rects were authored for (`meta.size.w`); the image may be smaller */
  sheetWidth?: number;
  anchor: AnchorMetrics;
  hasExplicitAnchor: boolean;
  frames: SpriteFrameRect[];
  /** Relative paths or resolved URLs for each texture page */
  pageFiles: string[];
  eventsMs: AnimationEventsTimelineMs;
  emitterPoints: FrameEmitterPoint[];
  /** Runtime loaded HTMLImageElements indexed by pageIndex */
  pages?: HTMLImageElement[];
  /** Optional legacy grid info if no JSON metadata existed */
  legacyCols?: number;
}

export interface GameCharacterManifestAnim {
  slug: string;
  originalName: string;
  role: string;
  roleSlot?: string;
  fps: number;
  frameCount: number;
  durationMs: number;
  cellWidth: number;
  cellHeight: number;
  multiatlas: boolean;
  jsonFile: string;
  imageFiles: string[];
  gifFile?: string;
  hasEmitterPoints?: boolean;
}

export interface GameCharacterRoles {
  idle?: string;
  move?: string;
  jump?: string;
  fall?: string;
  attack?: string;
  skills: string[];
  ultimate?: string;
  chase?: string;
  hurt?: string;
  fly?: string;
  die?: string;
  win?: string;
}

export interface GameCharacterManifest {
  schemaVersion: 'shinobi-phaser-v1';
  id: string;
  originalId?: string;
  code?: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  facing: 'right' | 'left';
  roles: GameCharacterRoles;
  roleToOriginalAnim?: Record<string, unknown>;
  animations: GameCharacterManifestAnim[];
  effects: Array<{
    spineId: string;
    originalSpineId?: string;
    animSlug: string;
    originalAnim?: string;
    jsonFile: string;
    imageFiles: string[];
  }>;
  legacySpineEffects?: Array<{
    spineId: string;
    jsonFile: string;
    atlasFile: string;
    imageFiles: string[];
  }>;
  audio: Array<{
    name: string;
    originalName?: string;
    file: string;
  }>;
  videos?: Array<{
    name: string;
    originalName?: string;
    file: string;
  }>;
  files?: string[];
}

export interface GameIndexCharacterEntry {
  id: string;
  originalId?: string;
  code?: string;
  name: string;
  path: string;
  characterJson: string;
  width?: number;
  height?: number;
  fps?: number;
  facing?: 'right' | 'left';
  roles?: GameCharacterRoles;
  fileCount?: number;
  totalBytes?: number;
}

export interface GameRootIndex {
  schemaVersion: 'shinobi-phaser-index-v1';
  generatedAt?: string;
  totalCharacters?: number;
  characters: GameIndexCharacterEntry[];
}

export interface RawSkillEntry {
  id?: string;
  slotLabel?: string;
  name: string;
  animKey?: string;
  descPlain?: string;
  descShort?: string;
  descInBattle?: string;
  causesChaseStates?: ChaseState[];
  causesChaseStateLabels?: string[];
  chaseTriggers?: ChaseState[];
  chaseTriggerLabels?: string[];
  appliedEffects?: string[];
  iconFile?: string;
}

export interface RawChaseComboLink {
  slot?: string;
  skillId?: string;
  skillName: string;
  requiresStates?: ChaseState[];
  requiresStateLabels?: string[];
  causesStates?: ChaseState[];
  causesStateLabels?: string[];
  appliedEffects?: string[];
}

export interface RawCombatJson {
  schemaVersion?: string;
  characterId?: string;
  heroCode?: string;
  displayName?: string;
  combatProfile?: {
    heroCode?: string;
    name?: string;
    shortDesc?: string;
    rolePosition?: string;
    combatRole?: string;
    combatRoleLabel?: string;
    nature?: string;
    natureLabel?: string;
    baseStats?: {
      hp?: number;
      attack?: number;
      defense?: number;
      crit?: number;
      block?: number;
      lifesteal?: number;
      ultimateDamage?: number;
    };
    chaseComboSummary?: {
      initiators?: RawChaseComboLink[];
      chasers?: RawChaseComboLink[];
    };
  };
  skills?: Record<string, RawSkillEntry>;
  passives?: RawSkillEntry[];
}

export interface ChaseSkillSpec {
  slot: string;
  name: string;
  requiresStates: ChaseState[];
  causesState: ChaseState;
  statusEffects: StatusEffectSpec[];
  animSlug?: string;
}

export interface ActionSkillSpec {
  slot: 'attack' | 'skill' | 'ultimate';
  name: string;
  slotLabel: string;
  description: string;
  causesState: ChaseState;
  statusEffects: StatusEffectSpec[];
  damageMultiplier: number;
  chakraCost: number;
  animSlug?: string;
}

export interface DynamicCombatKit {
  nature: NatureKey;
  natureLabel: string;
  role: string;
  roleLabel: string;
  displayHp: number;
  displayAtk: number;
  displayDef: number;
  /** Balanced combat stats for artillery arena */
  maxHp: number;
  baseDmg: number;
  critChance: number;
  attack: ActionSkillSpec;
  skill: ActionSkillSpec;
  ultimate: ActionSkillSpec;
  chasers: ChaseSkillSpec[];
  skillDisplayList: Array<{ slotLabel: string; name: string; desc?: string }>;
  chaseDisplayList: Array<{ name: string; requiresLabels: string[]; causesLabel: string; effects: string[] }>;
  hasDistinctSkill: boolean;
}

export type NinjaSourceType = 'builtin' | 'repo' | 'imported-phaser' | 'imported-legacy';

export interface NinjaRosterEntry {
  id: string;
  name: string;
  source: NinjaSourceType;
  facing: 'right' | 'left';
  combat: DynamicCombatKit;
  roles: GameCharacterRoles;
  /** Resolved URLs (or blob keys for IndexedDB) for lightweight menu/select preview */
  previewFaceUrl?: string;
  previewArtUrl?: string;
  previewIcoUrl?: string;
  previewIdleSheetUrl?: string;
  previewIdleMeta?: {
    fw: number;
    fh: number;
    n: number;
    cols: number;
    fps: number;
    durationMs: number;
    pivotPxX?: number;
    pivotPxY?: number;
    frames?: SpriteFrameRect[];
  };
  /** For repo / builtin lazy loading */
  baseUrl?: string;
  manifestUrl?: string;
  bundleUrl?: string;
  /** For IndexedDB imported ninjas */
  dbBlobKeys?: {
    face?: string;
    art?: string;
    ico?: string;
    idleSheet?: string;
  };
  warnings?: string[];
  importedAt?: number;
  formatLabel?: string;
}

export interface LegacySpineData {
  bones: Array<{
    name: string;
    parent?: string;
    x?: number;
    y?: number;
    rotation?: number;
    scaleX?: number;
    scaleY?: number;
    shearX?: number;
    shearY?: number;
  }>;
  bi: Record<string, number>;
  slots: Array<{
    name: string;
    bone: string;
    attachment?: string;
    color?: string;
    blend?: string;
  }>;
  sk: Record<string, Record<string, any>>;
  rg: Record<
    string,
    {
      p: number;
      x: number;
      y: number;
      w: number;
      h: number;
      ow: number;
      oh: number;
      ox: number;
      oy: number;
      rotate?: boolean | number;
    }
  >;
  anims: Record<string, any>;
  dur: Record<string, number>;
  pageFiles?: string[];
  pages?: HTMLImageElement[];
}

export interface LoadedNinjaRuntime {
  entry: NinjaRosterEntry;
  facing: 'right' | 'left';
  roles: GameCharacterRoles;
  animations: Map<string, CompiledAnimation>;
  /** Pre-rendered spritesheet effects keyed by `${spineSlug}/${animSlug}` (also lowercase aliases) */
  effects: Map<string, CompiledAnimation>;
  /** Fixed Spine fallback data ONLY for legacy built-in / raw spine particulas */
  legacySpineEffects: Map<string, LegacySpineData>;
  /** Decoded Web Audio buffers keyed by slug & original soundName */
  audioBuffers: Map<string, AudioBuffer>;
  /** Resolved video URLs keyed by slug & 'ultimate' */
  videoUrls: Map<string, string>;
  /** Action-level fallback events (used by builtin ninjas whose anim JSONs didn't carry per-action events) */
  actionEvents?: Partial<Record<'attack' | 'skill' | 'ultimate' | 'chase' | 'hurt', AnimationEventsTimelineMs>>;
  /** Consistent world scale computed from idle animation */
  charWorldScale: number;
  /** Display body height in world units */
  bodyHeight: number;
  /** Display body width in world units */
  bodyWidth: number;
  /** Cleanup callback to revoke all ObjectURLs created for this match */
  dispose: () => void;
}

export type GameMode = 'ia' | 'local';
export type TeamSize = 1 | 3;
export type GameScreen = 'menu' | 'select' | 'battle';
export type ActionChoice = 'attack' | 'skill' | 'ultimate';

export interface FighterHudState {
  index: number;
  team: 0 | 1;
  id: string;
  name: string;
  faceUrl?: string;
  artUrl?: string;
  icoUrl?: string;
  nature: NatureKey;
  natureLabel: string;
  roleLabel: string;
  hp: number;
  maxHp: number;
  chakra: number; // 0..100
  armedAction: ActionChoice;
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
  combat: DynamicCombatKit;
}

export interface BattleUiSnapshot {
  /** Index in `fighters` of the ninja that owns the turn */
  turnIndex: number;
  activeTeam: 0 | 1;
  teamSize: number;
  /** Fighter shown in each side's main HUD bar */
  focus: [number, number];
  /** Fighter indexes of the current and next turns */
  turnQueue: number[];
  phase: 'aim' | 'ai' | 'fly' | 'after' | 'over';
  round: number;
  maxRounds: number;
  timerSec: number;
  wind: number;
  hits: number;
  hitsKey: number;
  hitsVisible: boolean;
  comboBanner: {
    stateLabel: string;
    skillName: string;
    comboCount: number;
    key: number;
  } | null;
  cutIn: {
    active: boolean;
    showVideo: boolean;
    videoUrl?: string;
    icoUrl?: string;
    skillName: string;
    ninjaName: string;
  } | null;
  /** Team 0 first, then team 1, each in lineup order */
  fighters: FighterHudState[];
  winnerTeam: -1 | 0 | 1 | null;
  moveRemainingRatio: number;
}
