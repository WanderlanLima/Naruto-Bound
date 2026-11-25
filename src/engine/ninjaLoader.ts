import { audioEngine } from './audioPlayer';
import {
  buildDynamicCombatKit,
  inferRolesFromAnimList,
  toGameSlug,
} from './combatParser';
import {
  buildGridCompiledAnimation,
  calibrateLegacyPivotFromImage,
  loadImageElement,
  parseSpritesheetJson,
} from './spriteAnimator';
import {
  getImportedNinjaRecord,
  getNinjaBlob,
  listImportedNinjas,
  ObjectUrlPool,
  type StoredImportedNinjaRecord,
} from '../storage/ninjaDb';
import type {
  AnimationEventsTimelineMs,
  CompiledAnimation,
  GameCharacterManifest,
  GameRootIndex,
  LegacySpineData,
  LoadedNinjaRuntime,
  NinjaRosterEntry,
  RawCombatJson,
} from '../types/shinobi';

const TARGET_BATTLE_BODY_H = 82;

function joinUrl(base: string, rel: string): string {
  const b = base.replace(/\/+$/, '');
  const r = rel.replace(/^\/+/, '');
  return b ? `${b}/${r}` : r;
}

async function fetchJsonSafe<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    if (!text.trim() || (!ct.includes('json') && text.trim().startsWith('<'))) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Loads the 4 built-in ninjas (lightweight preview metadata only!).
 */
async function loadBuiltinRoster(): Promise<NinjaRosterEntry[]> {
  const rosterData = await fetchJsonSafe<{
    characters: Array<{
      id: string;
      name: string;
      path: string;
      face?: string;
      art?: string;
      ico?: string;
      idlePreview: { file: string; fw: number; fh: number; n: number; cols: number; dur: number };
      combatFile: string;
      bundleFile: string;
    }>;
  }>('./builtin/roster.json');

  if (!rosterData?.characters) return [];

  const entries: NinjaRosterEntry[] = [];
  for (const ch of rosterData.characters) {
    const combatJson = await fetchJsonSafe<RawCombatJson>(`./${ch.combatFile}`);
    const roles = {
      idle: 'idle',
      move: 'run',
      jump: 'fly',
      fly: 'fly',
      fall: 'fall',
      attack: 'atk',
      skills: ['atk'],
      ultimate: 'atk',
      chase: 'atk',
      hurt: 'hurt',
      die: 'die',
      win: 'idle',
    };
    const isSasuke = ch.id === 'vdfno_100306';
    const combat = buildDynamicCombatKit(combatJson, roles, ch.name, {
      maxHp: isSasuke ? 120 : 100,
      baseDmg: 26,
    });

    entries.push({
      id: ch.id,
      name: ch.name,
      source: 'builtin',
      facing: 'right',
      combat,
      roles,
      previewFaceUrl: ch.face ? `./${ch.face}` : undefined,
      previewArtUrl: ch.art ? `./${ch.art}` : undefined,
      previewIcoUrl: ch.ico ? `./${ch.ico}` : undefined,
      previewIdleSheetUrl: `./${ch.idlePreview.file}`,
      previewIdleMeta: {
        fw: ch.idlePreview.fw,
        fh: ch.idlePreview.fh,
        n: ch.idlePreview.n,
        cols: ch.idlePreview.cols,
        fps: Math.max(1, Math.round(ch.idlePreview.n / Math.max(0.1, ch.idlePreview.dur))),
        durationMs: Math.round(ch.idlePreview.dur * 1000),
      },
      baseUrl: `./${ch.path}`,
      bundleUrl: `./${ch.bundleFile}`,
      formatLabel: 'Embutido',
    });
  }

  return entries;
}

/**
 * Probes repository assets folders (`./assets/index.json`, `./index.json`, or custom URL)
 * exported by the "Exportar para o jogo" tab in Shinobi Sprite Studio (`shinobi-phaser-index-v1`).
 */
export async function loadRepoRoster(customBaseUrl?: string): Promise<{
  entries: NinjaRosterEntry[];
  detectedBaseUrl: string | null;
}> {
  const candidates: string[] = [];
  if (customBaseUrl && customBaseUrl.trim()) {
    const clean = customBaseUrl.trim().replace(/\/+$/, '');
    candidates.push(clean.endsWith('index.json') ? clean : `${clean}/index.json`);
  }
  candidates.push('./assets/index.json', './game-assets/index.json', './index.json');

  for (const idxUrl of candidates) {
    const idx = await fetchJsonSafe<GameRootIndex>(idxUrl);
    if (!idx || !Array.isArray(idx.characters) || idx.characters.length === 0) continue;

    const baseRoot = idxUrl.replace(/\/index\.json$/i, '');
    const entries: NinjaRosterEntry[] = [];

    for (const item of idx.characters) {
      const charJsonUrl = joinUrl(baseRoot, item.characterJson || `${item.path}/character.json`);
      const charBase = charJsonUrl.replace(/\/character\.json$/i, '');
      const manifest = await fetchJsonSafe<GameCharacterManifest>(charJsonUrl);
      if (!manifest) continue;

      const combatJson = await fetchJsonSafe<RawCombatJson>(
        joinUrl(charBase, 'combate_e_habilidades.json')
      );

      const roles = manifest.roles || inferRolesFromAnimList(manifest.animations.map((a) => a.slug));
      const combat = buildDynamicCombatKit(combatJson, roles, combatJson?.displayName || manifest.name);

      const idleSlug = roles.idle || manifest.animations[0]?.slug || 'idle';
      const idleAnim = manifest.animations.find((a) => a.slug === idleSlug) || manifest.animations[0];
      let idleMeta: NinjaRosterEntry['previewIdleMeta'];
      let idleSheetUrl: string | undefined;

      if (idleAnim) {
        const animJson = await fetchJsonSafe<any>(joinUrl(charBase, idleAnim.jsonFile));
        if (animJson) {
          const parsed = parseSpritesheetJson(animJson, idleAnim.slug, 'anims', idleAnim.imageFiles, 1);
          idleSheetUrl = parsed.pageFiles[0] ? joinUrl(charBase, parsed.pageFiles[0]) : undefined;
          idleMeta = {
            fw: parsed.cellWidth,
            fh: parsed.cellHeight,
            n: parsed.frameCount,
            cols: Math.max(1, Math.ceil(Math.sqrt(parsed.frameCount))),
            fps: parsed.fps,
            durationMs: parsed.durationMs,
            pivotPxX: parsed.anchor.pivotPxX,
            pivotPxY: parsed.anchor.pivotPxY,
            frames: parsed.frames,
          };
        }
      }

      const filesList = manifest.files || [];
      const findRel = (re: RegExp) => filesList.find((f) => re.test(f.toLowerCase()));
      const faceRel = findRel(/^(artes\/.*08_avatar|avatar|face|portrait).*\.(png|webp|jpg|jpeg)$/);
      const artRel = findRel(/^(artes\/.*01_arte_completa|artes\/.*02_meio_corpo|art).*\.(png|webp|jpg|jpeg)$/);
      const icoRel = findRel(/^(icones_skills\/.*(03_|unique|esoter|ogi)|ico).*\.(png|webp|jpg|jpeg)$/);

      entries.push({
        id: manifest.id,
        name: combatJson?.displayName || manifest.name,
        source: 'repo',
        facing: manifest.facing === 'left' ? 'left' : 'right',
        combat,
        roles,
        previewFaceUrl: faceRel ? joinUrl(charBase, faceRel) : idleSheetUrl,
        previewArtUrl: artRel ? joinUrl(charBase, artRel) : undefined,
        previewIcoUrl: icoRel ? joinUrl(charBase, icoRel) : undefined,
        previewIdleSheetUrl: idleSheetUrl,
        previewIdleMeta: idleMeta,
        baseUrl: charBase,
        manifestUrl: charJsonUrl,
        formatLabel: 'Repositório',
      });
    }

    if (entries.length > 0) {
      return { entries, detectedBaseUrl: baseRoot };
    }
  }

  return { entries: [], detectedBaseUrl: null };
}

/**
 * Loads lightweight previews for all imported ninjas stored in IndexedDB,
 * creating ObjectURLs ONLY for face/art/ico/idle preview!
 */
export async function loadImportedRoster(previewUrlPool: ObjectUrlPool): Promise<NinjaRosterEntry[]> {
  const records = await listImportedNinjas();
  const entries: NinjaRosterEntry[] = [];

  for (const rec of records) {
    const combat = buildDynamicCombatKit(rec.combatJson, rec.roles, rec.name);

    const blobToUrl = async (key?: string): Promise<string | undefined> => {
      if (!key) return undefined;
      const b = await getNinjaBlob(key);
      return b ? previewUrlPool.create(b) : undefined;
    };

    const [faceUrl, artUrl, icoUrl, idleSheetUrl] = await Promise.all([
      blobToUrl(rec.previewKeys.face),
      blobToUrl(rec.previewKeys.art),
      blobToUrl(rec.previewKeys.ico),
      blobToUrl(rec.previewKeys.idleSheet),
    ]);

    let previewIdleMeta: NinjaRosterEntry['previewIdleMeta'] = rec.idleFallbackMeta;
    if (rec.previewKeys.idleJson) {
      const jsonBlob = await getNinjaBlob(rec.previewKeys.idleJson);
      if (jsonBlob) {
        try {
          const parsed = parseSpritesheetJson(
            JSON.parse(await jsonBlob.text()),
            rec.roles.idle || 'idle',
            '',
            undefined,
            1
          );
          previewIdleMeta = {
            fw: parsed.cellWidth,
            fh: parsed.cellHeight,
            n: parsed.frameCount,
            cols: Math.max(1, Math.ceil(Math.sqrt(parsed.frameCount))),
            fps: parsed.fps,
            durationMs: parsed.durationMs,
            pivotPxX: parsed.anchor.pivotPxX,
            pivotPxY: parsed.anchor.pivotPxY,
            frames: parsed.frames,
          };
        } catch {
          // fallback
        }
      }
    }

    entries.push({
      id: rec.id,
      name: rec.name,
      source: rec.source,
      facing: rec.facing,
      combat,
      roles: rec.roles,
      previewFaceUrl: faceUrl,
      previewArtUrl: artUrl,
      previewIcoUrl: icoUrl,
      previewIdleSheetUrl: idleSheetUrl,
      previewIdleMeta,
      dbBlobKeys: {
        face: rec.previewKeys.face,
        art: rec.previewKeys.art,
        ico: rec.previewKeys.ico,
        idleSheet: rec.previewKeys.idleSheet,
      },
      warnings: rec.warnings,
      importedAt: rec.importedAt,
      formatLabel: rec.source === 'imported-phaser' ? 'Studio v1' : 'Legado ZIP',
    });
  }

  return entries;
}

export async function loadFullRoster(
  previewUrlPool: ObjectUrlPool,
  customRepoUrl?: string
): Promise<{ roster: NinjaRosterEntry[]; detectedRepoUrl: string | null }> {
  const [builtin, repoRes, imported] = await Promise.all([
    loadBuiltinRoster(),
    loadRepoRoster(customRepoUrl),
    loadImportedRoster(previewUrlPool),
  ]);

  // Deduplicate by ID: Imported overrides Repo overrides Builtin so user updates take precedence!
  const byId = new Map<string, NinjaRosterEntry>();
  for (const n of builtin) byId.set(n.id, n);
  for (const n of repoRes.entries) byId.set(n.id, n);
  for (const n of imported) byId.set(n.id, n);

  return {
    roster: Array.from(byId.values()),
    detectedRepoUrl: repoRes.detectedBaseUrl,
  };
}

/* ---------- On-Demand Battle Runtime Loader ---------- */

function computeCharacterScaleFromIdle(
  idleAnim: CompiledAnimation | undefined
): { charWorldScale: number; bodyHeight: number; bodyWidth: number } {
  if (!idleAnim) {
    return { charWorldScale: 0.5, bodyHeight: TARGET_BATTLE_BODY_H, bodyWidth: 56 };
  }
  const metrics = calibrateLegacyPivotFromImage(idleAnim);
  const idleWorldScale = Math.max(0.05, idleAnim.anchor.worldToPixelScale || 1);
  // Visible character height in Spine world units
  const visibleWorldH = Math.max(40, metrics.visibleHeight / idleWorldScale);
  const charWorldScale = TARGET_BATTLE_BODY_H / visibleWorldH;
  const bodyWidth = Math.max(36, Math.min(96, (metrics.visibleWidth / idleWorldScale) * charWorldScale));
  return {
    charWorldScale,
    bodyHeight: TARGET_BATTLE_BODY_H,
    bodyWidth,
  };
}

function registerAudioAliases(map: Map<string, AudioBuffer>, rawKey: string, buf: AudioBuffer) {
  const stem = rawKey.replace(/^.*\//, '').replace(/\.(mp3|ogg|wav)$/i, '');
  map.set(rawKey, buf);
  map.set(stem, buf);
  map.set(stem.toLowerCase(), buf);
  map.set(toGameSlug(stem, 'sfx'), buf);
}

function registerEffectAliases(
  map: Map<string, CompiledAnimation>,
  spineId: string,
  animName: string,
  compiled: CompiledAnimation
) {
  const s1 = spineId.toLowerCase();
  const a1 = animName.toLowerCase();
  const s2 = toGameSlug(spineId, 'effect');
  const a2 = toGameSlug(animName, 'anim');
  map.set(`${spineId}/${animName}`, compiled);
  map.set(`${s1}/${a1}`, compiled);
  map.set(`${s2}/${a2}`, compiled);
}

/**
 * Loads ALL battle assets for a single fighter ON DEMAND and returns a `LoadedNinjaRuntime`
 * whose `dispose()` method revokes every ObjectURL created for this match.
 */
export async function loadNinjaForBattle(entry: NinjaRosterEntry): Promise<LoadedNinjaRuntime> {
  const matchPool = new ObjectUrlPool();

  if (entry.source === 'builtin') {
    return await loadBuiltinRuntime(entry, matchPool);
  }
  if (entry.source === 'repo') {
    return await loadRepoRuntime(entry, matchPool);
  }
  const record = await getImportedNinjaRecord(entry.id);
  if (!record) {
    throw new Error(`Ninja importado "${entry.name}" não encontrado no IndexedDB.`);
  }
  if (record.source === 'imported-phaser') {
    return await loadImportedPhaserRuntime(entry, record, matchPool);
  }
  return await loadImportedLegacyRuntime(entry, record, matchPool);
}

async function loadBuiltinRuntime(
  entry: NinjaRosterEntry,
  matchPool: ObjectUrlPool
): Promise<LoadedNinjaRuntime> {
  const baseUrl = entry.baseUrl || `./builtin/${entry.id}`;
  const bundle = await fetchJsonSafe<any>(entry.bundleUrl || `${baseUrl}/bundle.json`);
  if (!bundle) {
    throw new Error(`Não foi possível carregar os assets de ${entry.name}.`);
  }

  const animations = new Map<string, CompiledAnimation>();
  const effects = new Map<string, CompiledAnimation>();
  const legacySpineEffects = new Map<string, LegacySpineData>();
  const audioBuffers = new Map<string, AudioBuffer>();
  const videoUrls = new Map<string, string>();

  // Load animations
  await Promise.all(
    Object.entries(bundle.anims || {}).map(async ([slug, info]: [string, any]) => {
      const imgUrl = joinUrl(baseUrl, info.file);
      const anim = buildGridCompiledAnimation({
        slug,
        originalName: slug,
        imageFile: imgUrl,
        fw: info.fw,
        fh: info.fh,
        n: info.n,
        cols: info.cols,
        fps: info.fps || 24,
        durationMs: info.durationMs,
      });
      try {
        anim.pages = [await loadImageElement(imgUrl)];
      } catch {
        anim.pages = [];
      }
      animations.set(slug, anim);
    })
  );

  // Calibrate legacy pivots using idle reference so built-in ninjas NEVER hop or change height
  const idleAnim = animations.get('idle');
  const idleVis = idleAnim ? calibrateLegacyPivotFromImage(idleAnim) : undefined;
  for (const [slug, anim] of animations.entries()) {
    if (slug !== 'idle') {
      calibrateLegacyPivotFromImage(anim, idleVis?.visibleHeight);
    }
  }
  const { charWorldScale, bodyHeight, bodyWidth } = computeCharacterScaleFromIdle(idleAnim);

  // Load legacy Spine effects for built-in ninjas (rendered via our fixed Spine renderer!)
  await Promise.all(
    Object.entries(bundle.spineEffects || {}).map(async ([spineId, jsonRel]: [string, any]) => {
      const sp = await fetchJsonSafe<LegacySpineData>(joinUrl(baseUrl, String(jsonRel)));
      if (!sp) return;
      const pages: HTMLImageElement[] = [];
      for (const pf of sp.pageFiles || []) {
        try {
          pages.push(await loadImageElement(joinUrl(baseUrl, pf)));
        } catch {
          // ignore
        }
      }
      sp.pages = pages;
      legacySpineEffects.set(spineId, sp);
      legacySpineEffects.set(spineId.toLowerCase(), sp);
      legacySpineEffects.set(toGameSlug(spineId, 'effect'), sp);
    })
  );

  // Load MP3 sounds
  await Promise.all(
    Object.entries(bundle.audio || {}).map(async ([soundKey, rel]: [string, any]) => {
      try {
        const res = await fetch(joinUrl(baseUrl, String(rel)));
        if (!res.ok) return;
        const buf = await audioEngine.decodeArrayBuffer(await res.arrayBuffer());
        if (buf) registerAudioAliases(audioBuffers, soundKey, buf);
      } catch {
        // ignore
      }
    })
  );

  if (bundle.video) {
    const vUrl = joinUrl(baseUrl, bundle.video);
    videoUrls.set('ultimate', vUrl);
  }

  const actionEvents: LoadedNinjaRuntime['actionEvents'] = {};
  if (bundle.eventsByAction) {
    for (const [k, ev] of Object.entries(bundle.eventsByAction)) {
      actionEvents[k as keyof NonNullable<LoadedNinjaRuntime['actionEvents']>] =
        ev as AnimationEventsTimelineMs;
    }
  }

  return {
    entry,
    facing: entry.facing,
    roles: entry.roles,
    animations,
    effects,
    legacySpineEffects,
    audioBuffers,
    videoUrls,
    actionEvents,
    charWorldScale,
    bodyHeight,
    bodyWidth,
    dispose: () => matchPool.revokeAll(),
  };
}

async function loadRepoRuntime(
  entry: NinjaRosterEntry,
  matchPool: ObjectUrlPool
): Promise<LoadedNinjaRuntime> {
  const charBase = entry.baseUrl!;
  const manifest = await fetchJsonSafe<GameCharacterManifest>(
    entry.manifestUrl || joinUrl(charBase, 'character.json')
  );
  if (!manifest) {
    throw new Error(`Manifesto character.json não encontrado para ${entry.name}.`);
  }

  const animations = new Map<string, CompiledAnimation>();
  const effects = new Map<string, CompiledAnimation>();
  const legacySpineEffects = new Map<string, LegacySpineData>();
  const audioBuffers = new Map<string, AudioBuffer>();
  const videoUrls = new Map<string, string>();

  // 1. Load all character animations (single-sheet + MultiAtlas)
  await Promise.all(
    manifest.animations.map(async (animDef) => {
      const json = await fetchJsonSafe<any>(joinUrl(charBase, animDef.jsonFile));
      if (!json) return;
      const baseDir = animDef.jsonFile.includes('/')
        ? animDef.jsonFile.slice(0, animDef.jsonFile.lastIndexOf('/'))
        : '';
      const compiled = parseSpritesheetJson(json, animDef.slug, baseDir, animDef.imageFiles, 1);
      const pages: HTMLImageElement[] = [];
      for (const pageRel of compiled.pageFiles) {
        try {
          pages.push(await loadImageElement(joinUrl(charBase, pageRel)));
        } catch {
          // ignore missing page
        }
      }
      compiled.pages = pages;
      animations.set(animDef.slug, compiled);
    })
  );

  // 2. Load pre-rendered PNG+JSON spritesheet effects
  await Promise.all(
    (manifest.effects || []).map(async (effDef) => {
      const json = await fetchJsonSafe<any>(joinUrl(charBase, effDef.jsonFile));
      if (!json) return;
      const baseDir = effDef.jsonFile.includes('/')
        ? effDef.jsonFile.slice(0, effDef.jsonFile.lastIndexOf('/'))
        : '';
      const compiled = parseSpritesheetJson(json, effDef.animSlug, baseDir, effDef.imageFiles, 1);
      const pages: HTMLImageElement[] = [];
      for (const pageRel of compiled.pageFiles) {
        try {
          pages.push(await loadImageElement(joinUrl(charBase, pageRel)));
        } catch {
          // ignore
        }
      }
      compiled.pages = pages;
      registerEffectAliases(effects, effDef.spineId, effDef.animSlug, compiled);
      if (effDef.originalSpineId && effDef.originalAnim) {
        registerEffectAliases(effects, effDef.originalSpineId, effDef.originalAnim, compiled);
      }
    })
  );

  // 3. Load MP3 audio buffers
  await Promise.all(
    (manifest.audio || []).map(async (aud) => {
      try {
        const res = await fetch(joinUrl(charBase, aud.file));
        if (!res.ok) return;
        const buf = await audioEngine.decodeArrayBuffer(await res.arrayBuffer());
        if (buf) {
          registerAudioAliases(audioBuffers, aud.name, buf);
          if (aud.originalName) registerAudioAliases(audioBuffers, aud.originalName, buf);
        }
      } catch {
        // ignore
      }
    })
  );

  // 4. Register MP4 video URLs
  for (const vid of manifest.videos || []) {
    const url = joinUrl(charBase, vid.file);
    videoUrls.set(vid.name, url);
    videoUrls.set(vid.name.toLowerCase(), url);
    if (vid.originalName) videoUrls.set(vid.originalName.toLowerCase(), url);
    if (!videoUrls.has('ultimate')) videoUrls.set('ultimate', url);
  }

  const idleAnim = animations.get(manifest.roles.idle || 'idle') || animations.values().next().value;
  const { charWorldScale, bodyHeight, bodyWidth } = computeCharacterScaleFromIdle(idleAnim);

  return {
    entry,
    facing: manifest.facing === 'left' ? 'left' : 'right',
    roles: manifest.roles,
    animations,
    effects,
    legacySpineEffects,
    audioBuffers,
    videoUrls,
    charWorldScale,
    bodyHeight,
    bodyWidth,
    dispose: () => matchPool.revokeAll(),
  };
}

async function loadImportedPhaserRuntime(
  entry: NinjaRosterEntry,
  record: StoredImportedNinjaRecord,
  matchPool: ObjectUrlPool
): Promise<LoadedNinjaRuntime> {
  const manifest = record.manifest;
  if (!manifest) {
    throw new Error(`Manifesto ausente no IndexedDB para ${entry.name}.`);
  }

  const animations = new Map<string, CompiledAnimation>();
  const effects = new Map<string, CompiledAnimation>();
  const legacySpineEffects = new Map<string, LegacySpineData>();
  const audioBuffers = new Map<string, AudioBuffer>();
  const videoUrls = new Map<string, string>();

  const readBlobByRel = async (rel: string): Promise<Blob | null> => {
    const clean = rel.replace(/^\/+/, '');
    const key =
      record.fileBlobKeys[clean] ||
      Object.entries(record.fileBlobKeys).find(
        ([k]) => k.toLowerCase() === clean.toLowerCase()
      )?.[1];
    if (!key) return null;
    return await getNinjaBlob(key);
  };

  const loadImageByRel = async (rel: string): Promise<HTMLImageElement | null> => {
    const blob = await readBlobByRel(rel);
    if (!blob) return null;
    const url = matchPool.create(blob);
    try {
      return await loadImageElement(url);
    } catch {
      return null;
    }
  };

  // 1. Animations (Single-sheet + MultiAtlas)
  await Promise.all(
    manifest.animations.map(async (animDef) => {
      const jsonBlob = await readBlobByRel(animDef.jsonFile);
      if (!jsonBlob) return;
      const json = JSON.parse(await jsonBlob.text());
      const baseDir = animDef.jsonFile.includes('/')
        ? animDef.jsonFile.slice(0, animDef.jsonFile.lastIndexOf('/'))
        : '';
      const compiled = parseSpritesheetJson(json, animDef.slug, baseDir, animDef.imageFiles, 1);
      const pages: HTMLImageElement[] = [];
      for (const pageRel of compiled.pageFiles) {
        const img = await loadImageByRel(pageRel);
        if (img) pages.push(img);
      }
      compiled.pages = pages;
      animations.set(animDef.slug, compiled);
    })
  );

  // 2. Pre-rendered effects PNG+JSON
  await Promise.all(
    (manifest.effects || []).map(async (effDef) => {
      const jsonBlob = await readBlobByRel(effDef.jsonFile);
      if (!jsonBlob) return;
      const json = JSON.parse(await jsonBlob.text());
      const baseDir = effDef.jsonFile.includes('/')
        ? effDef.jsonFile.slice(0, effDef.jsonFile.lastIndexOf('/'))
        : '';
      const compiled = parseSpritesheetJson(json, effDef.animSlug, baseDir, effDef.imageFiles, 1);
      const pages: HTMLImageElement[] = [];
      for (const pageRel of compiled.pageFiles) {
        const img = await loadImageByRel(pageRel);
        if (img) pages.push(img);
      }
      compiled.pages = pages;
      registerEffectAliases(effects, effDef.spineId, effDef.animSlug, compiled);
      if (effDef.originalSpineId && effDef.originalAnim) {
        registerEffectAliases(effects, effDef.originalSpineId, effDef.originalAnim, compiled);
      }
    })
  );

  // 3. Audio MP3s
  await Promise.all(
    (manifest.audio || []).map(async (aud) => {
      const blob = await readBlobByRel(aud.file);
      if (!blob) return;
      const buf = await audioEngine.decodeArrayBuffer(await blob.arrayBuffer());
      if (buf) {
        registerAudioAliases(audioBuffers, aud.name, buf);
        if (aud.originalName) registerAudioAliases(audioBuffers, aud.originalName, buf);
      }
    })
  );

  // 4. Videos MP4
  for (const vid of manifest.videos || []) {
    const blob = await readBlobByRel(vid.file);
    if (!blob) continue;
    const url = matchPool.create(blob);
    videoUrls.set(vid.name, url);
    videoUrls.set(vid.name.toLowerCase(), url);
    if (vid.originalName) videoUrls.set(vid.originalName.toLowerCase(), url);
    if (!videoUrls.has('ultimate')) videoUrls.set('ultimate', url);
  }

  const idleAnim = animations.get(record.roles.idle || 'idle') || animations.values().next().value;
  const { charWorldScale, bodyHeight, bodyWidth } = computeCharacterScaleFromIdle(idleAnim);

  return {
    entry,
    facing: record.facing,
    roles: record.roles,
    animations,
    effects,
    legacySpineEffects,
    audioBuffers,
    videoUrls,
    charWorldScale,
    bodyHeight,
    bodyWidth,
    dispose: () => matchPool.revokeAll(),
  };
}

async function loadImportedLegacyRuntime(
  entry: NinjaRosterEntry,
  record: StoredImportedNinjaRecord,
  matchPool: ObjectUrlPool
): Promise<LoadedNinjaRuntime> {
  const animations = new Map<string, CompiledAnimation>();
  const effects = new Map<string, CompiledAnimation>();
  const legacySpineEffects = new Map<string, LegacySpineData>();
  const audioBuffers = new Map<string, AudioBuffer>();
  const videoUrls = new Map<string, string>();

  const instructionsAnims: any[] = record.instructionsJson?.animations || [];
  const insByAnim = new Map<string, any>();
  for (const a of instructionsAnims) {
    if (a?.name) {
      insByAnim.set(String(a.name).toLowerCase(), a);
      insByAnim.set(toGameSlug(String(a.name)), a);
    }
  }

  const readBlobByRel = async (rel: string): Promise<Blob | null> => {
    const key = record.fileBlobKeys[rel];
    return key ? await getNinjaBlob(key) : null;
  };

  // Discover all legacy animation folders saved in IndexedDB
  const animMap = new Map<string, { sheetRel?: string; jsonRel?: string }>();
  for (const rel of Object.keys(record.fileBlobKeys)) {
    const m = rel.match(/^animacoes\/([^/]+)\/(.+)$/i);
    if (!m) continue;
    const folder = m[1];
    const sub = m[2].toLowerCase();
    const cur = animMap.get(folder) || {};
    if (sub.endsWith('_spritesheet.png')) cur.sheetRel = rel;
    else if (sub.endsWith('_spritesheet.json')) cur.jsonRel = rel;
    animMap.set(folder, cur);
  }

  await Promise.all(
    Array.from(animMap.entries()).map(async ([folder, files]) => {
      if (!files.sheetRel) return;
      const sheetBlob = await readBlobByRel(files.sheetRel);
      if (!sheetBlob) return;
      const sheetUrl = matchPool.create(sheetBlob);
      const sheetImg = await loadImageElement(sheetUrl).catch(() => null);
      if (!sheetImg) return;

      let compiled: CompiledAnimation | null = null;
      if (files.jsonRel) {
        const jBlob = await readBlobByRel(files.jsonRel);
        if (jBlob) {
          try {
            compiled = parseSpritesheetJson(
              JSON.parse(await jBlob.text()),
              folder,
              `animacoes/${folder}`,
              [files.sheetRel],
              1
            );
            compiled.pages = [sheetImg];
          } catch {
            compiled = null;
          }
        }
      }

      if (!compiled) {
        const ins = insByAnim.get(folder.toLowerCase()) || insByAnim.get(toGameSlug(folder));
        const durMs = Math.round((ins?.baseDurationSec || 1.2) * 1000);
        const estFrames = Math.max(1, Math.round((durMs / 1000) * 24));
        const cols = Math.max(1, Math.ceil(Math.sqrt(estFrames)));
        const rows = Math.max(1, Math.ceil(estFrames / cols));
        compiled = buildGridCompiledAnimation({
          slug: folder,
          originalName: ins?.name || folder,
          imageFile: sheetUrl,
          fw: Math.max(1, Math.floor(sheetImg.naturalWidth / cols)),
          fh: Math.max(1, Math.floor(sheetImg.naturalHeight / rows)),
          n: estFrames,
          cols,
          fps: 24,
          durationMs: durMs,
          eventsMs: ins?.eventsMs,
        });
        compiled.pages = [sheetImg];
      } else if (
        compiled.eventsMs.hits.length === 0 &&
        compiled.eventsMs.particles.length === 0 &&
        compiled.eventsMs.sounds.length === 0
      ) {
        // Hydrate eventsMs from animacoes_instrucoes.json if spritesheet JSON didn't carry them
        const ins = insByAnim.get(folder.toLowerCase()) || insByAnim.get(toGameSlug(folder));
        if (ins?.eventsMs) {
          compiled.eventsMs = {
            hits: ins.eventsMs.hits || [],
            particles: ins.eventsMs.particles || [],
            sounds: ins.eventsMs.sounds || [],
            videos: ins.eventsMs.videos || [],
          };
        }
      }

      animations.set(folder, compiled);
    })
  );

  // Calibrate pivots for animations that lacked explicit anchor metadata
  const idleAnim = animations.get(record.roles.idle || 'idle') || animations.values().next().value;
  const idleVis = idleAnim ? calibrateLegacyPivotFromImage(idleAnim) : undefined;
  for (const [slug, anim] of animations.entries()) {
    if (slug !== (record.roles.idle || 'idle')) {
      calibrateLegacyPivotFromImage(anim, idleVis?.visibleHeight);
    }
  }
  const { charWorldScale, bodyHeight, bodyWidth } = computeCharacterScaleFromIdle(idleAnim);

  // Load pre-rendered spritesheet effects under particulas/<spineId>/ if present
  for (const rel of Object.keys(record.fileBlobKeys)) {
    const m = rel.match(/^particulas\/([^/]+)\/(.+)_spritesheet\.json$/i);
    if (!m) continue;
    const spineId = m[1];
    const animName = m[2].replace(/^.*\//, '');
    const pngRel = rel.replace(/_spritesheet\.json$/i, '_spritesheet.png');
    const [jBlob, pBlob] = await Promise.all([readBlobByRel(rel), readBlobByRel(pngRel)]);
    if (!jBlob || !pBlob) continue;
    try {
      const compiled = parseSpritesheetJson(
        JSON.parse(await jBlob.text()),
        animName,
        `particulas/${spineId}`,
        [pngRel],
        1
      );
      const img = await loadImageElement(matchPool.create(pBlob));
      compiled.pages = [img];
      registerEffectAliases(effects, spineId, animName, compiled);
    } catch {
      // ignore
    }
  }

  // Load sounds from sons/ and audios/
  await Promise.all(
    Object.keys(record.fileBlobKeys)
      .filter((rel) => /^(sons|audios)\/.+\.(mp3|ogg|wav)$/i.test(rel))
      .map(async (rel) => {
        const blob = await readBlobByRel(rel);
        if (!blob) return;
        const buf = await audioEngine.decodeArrayBuffer(await blob.arrayBuffer());
        if (buf) registerAudioAliases(audioBuffers, rel, buf);
      })
  );

  // Load videos from videos/
  for (const rel of Object.keys(record.fileBlobKeys).filter((r) =>
    /^videos?\/.+\.(mp4|webm)$/i.test(r)
  )) {
    const blob = await readBlobByRel(rel);
    if (!blob) continue;
    const url = matchPool.create(blob);
    const stem = rel.replace(/^.*\//, '').replace(/\.(mp4|webm)$/i, '');
    videoUrls.set(stem, url);
    videoUrls.set(stem.toLowerCase(), url);
    videoUrls.set(toGameSlug(stem, 'video'), url);
    if (!videoUrls.has('ultimate')) videoUrls.set('ultimate', url);
  }

  return {
    entry,
    facing: record.facing,
    roles: record.roles,
    animations,
    effects,
    legacySpineEffects,
    audioBuffers,
    videoUrls,
    charWorldScale,
    bodyHeight,
    bodyWidth,
    dispose: () => matchPool.revokeAll(),
  };
}
