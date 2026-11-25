import JSZip from 'jszip';
import {
  buildDynamicCombatKit,
  inferRolesFromAnimList,
  toGameSlug,
} from '../engine/combatParser';
import { loadImageElement, parseSpritesheetJson } from '../engine/spriteAnimator';
import {
  makeBlobKey,
  saveImportedNinja,
  type StoredImportedNinjaRecord,
} from '../storage/ninjaDb';
import type {
  GameCharacterManifest,
  GameCharacterRoles,
  RawCombatJson,
} from '../types/shinobi';

export interface ImportReportItem {
  id: string;
  name: string;
  format: 'shinobi-phaser-v1' | 'completo-legado';
  animCount: number;
  effectCount: number;
  audioCount: number;
  videoCount: number;
  warnings: string[];
  ok: boolean;
  error?: string;
}

interface VirtualFile {
  path: string;
  readBytes: () => Promise<Uint8Array>;
  readText: () => Promise<string>;
  readBlob: (mime?: string) => Promise<Blob>;
}

function guessMime(path: string): string {
  const low = path.toLowerCase();
  if (low.endsWith('.png')) return 'image/png';
  if (low.endsWith('.webp')) return 'image/webp';
  if (low.endsWith('.jpg') || low.endsWith('.jpeg')) return 'image/jpeg';
  if (low.endsWith('.mp3')) return 'audio/mpeg';
  if (low.endsWith('.ogg')) return 'audio/ogg';
  if (low.endsWith('.wav')) return 'audio/wav';
  if (low.endsWith('.mp4')) return 'video/mp4';
  if (low.endsWith('.webm')) return 'video/webm';
  if (low.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

function normalizeVirtualPath(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

/**
 * Automatically groups and joins split archive files like:
 *   vdfno_100311_completo.zip.t0.001 + .002
 *   naruto_completo.zip.001 + .002
 *   export.zip.part1 + .part2
 */
function groupAndReassembleFiles(files: File[]): {
  archives: Array<{ name: string; blob: Blob }>;
  looseFiles: File[];
  warnings: string[];
} {
  const splitGroups = new Map<string, Array<{ partNum: number; file: File }>>();
  const directZips: Array<{ name: string; blob: Blob }> = [];
  const looseFiles: File[] = [];
  const warnings: string[] = [];

  const splitRegex = /^(.*\.zip)(?:\.t\d+)?\.(\d{2,4})$/i;
  const partRegex = /^(.*\.zip)\.part(\d+)$/i;

  for (const file of files) {
    const m1 = file.name.match(splitRegex);
    const m2 = !m1 ? file.name.match(partRegex) : null;
    if (m1 || m2) {
      const baseName = (m1 ? m1[1] : m2![1]).toLowerCase();
      const partNum = parseInt(m1 ? m1[2] : m2![2], 10);
      const list = splitGroups.get(baseName) || [];
      list.push({ partNum, file });
      splitGroups.set(baseName, list);
    } else if (file.name.toLowerCase().endsWith('.zip')) {
      directZips.push({ name: file.name, blob: file });
    } else {
      looseFiles.push(file);
    }
  }

  const archives: Array<{ name: string; blob: Blob }> = [...directZips];

  for (const [baseName, parts] of splitGroups.entries()) {
    parts.sort((a, b) => a.partNum - b.partNum);
    // Check for missing sequence numbers
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].partNum !== i + 1) {
        warnings.push(
          `Arquivo dividido "${baseName}" pode estar faltando partes (esperado parte ${i + 1}, encontrado ${parts[i].partNum}).`
        );
        break;
      }
    }
    const joined = new Blob(
      parts.map((p) => p.file),
      { type: 'application/zip' }
    );
    archives.push({ name: baseName, blob: joined });
  }

  return { archives, looseFiles, warnings };
}

/**
 * Crops a crisp 156x156 portrait centered on the character's head/face from frame 0 of idle.
 */
async function generateAutoFaceBlob(
  sheetBlob: Blob,
  frameRect?: { x: number; y: number; w: number; h: number }
): Promise<Blob | null> {
  const url = URL.createObjectURL(sheetBlob);
  try {
    const img = await loadImageElement(url);
    const fx = frameRect?.x || 0;
    const fy = frameRect?.y || 0;
    const fw = Math.max(1, frameRect?.w || img.naturalWidth);
    const fh = Math.max(1, frameRect?.h || img.naturalHeight);

    const probe = document.createElement('canvas');
    probe.width = fw;
    probe.height = fh;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    if (!pctx) return null;
    pctx.drawImage(img, fx, fy, fw, fh, 0, 0, fw, fh);

    const data = pctx.getImageData(0, 0, fw, fh).data;
    let y0 = -1;
    let y1 = fh - 1;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        if (data[(y * fw + x) * 4 + 3] > 35) {
          if (y0 < 0) y0 = y;
          y1 = y;
          break;
        }
      }
    }
    if (y0 < 0) y0 = 0;
    const bodyH = Math.max(24, y1 - y0);
    const bandA = Math.floor(y0 + bodyH * 0.05);
    const bandB = Math.min(fh, Math.ceil(y0 + bodyH * 0.28));

    let sumX = 0;
    let cnt = 0;
    for (let y = bandA; y < bandB; y++) {
      for (let x = 0; x < fw; x++) {
        if (data[(y * fw + x) * 4 + 3] > 35) {
          sumX += x;
          cnt++;
        }
      }
    }
    const cx = cnt > 0 ? sumX / cnt : fw / 2;
    const cropSize = Math.max(36, bodyH * 0.34);

    const out = document.createElement('canvas');
    out.width = 156;
    out.height = 156;
    const octx = out.getContext('2d');
    if (!octx) return null;
    octx.drawImage(
      probe,
      cx - cropSize / 2,
      Math.max(0, y0 + bodyH * 0.02),
      cropSize,
      cropSize,
      0,
      0,
      156,
      156
    );

    return await new Promise<Blob | null>((resolve) =>
      out.toBlob((b) => resolve(b), 'image/webp', 0.88)
    );
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function importPhaserCharacterFromTree(
  charRoot: string,
  tree: Map<string, VirtualFile>,
  onProgress?: (msg: string) => void
): Promise<ImportReportItem> {
  const prefix = charRoot ? `${charRoot.replace(/\/+$/, '')}/` : '';
  const manifestVf = tree.get(`${prefix}character.json`);
  if (!manifestVf) {
    throw new Error(`character.json não encontrado em "${charRoot || '/'}"`);
  }

  const manifest = JSON.parse(await manifestVf.readText()) as GameCharacterManifest;
  if (manifest.schemaVersion !== 'shinobi-phaser-v1') {
    throw new Error(`Schema não suportado: ${String((manifest as any).schemaVersion)}`);
  }

  const ninjaId = manifest.id || toGameSlug(manifest.name || 'ninja');
  const warnings: string[] = [];

  onProgress?.(`Importando ${manifest.name} (shinobi-phaser-v1)...`);

  let combatJson: RawCombatJson | null = null;
  const combatVf = tree.get(`${prefix}combate_e_habilidades.json`);
  if (combatVf) {
    try {
      combatJson = JSON.parse(await combatVf.readText()) as RawCombatJson;
    } catch {
      warnings.push('combate_e_habilidades.json inválido; usando perfil padrão.');
    }
  } else {
    warnings.push('Sem combate_e_habilidades.json; combos serão derivados com valores padrão.');
  }

  let instructionsJson: any = null;
  const insVf = tree.get(`${prefix}animacoes_instrucoes.json`);
  if (insVf) {
    try {
      instructionsJson = JSON.parse(await insVf.readText());
    } catch {
      // optional
    }
  }

  // Collect all files belonging to this character prefix
  const fileBlobKeys: Record<string, string> = {};
  const blobsToSave: Array<{ key: string; blob: Blob }> = [];

  for (const [fullPath, vf] of tree.entries()) {
    if (!fullPath.startsWith(prefix)) continue;
    const rel = fullPath.slice(prefix.length);
    if (!rel || rel.endsWith('/')) continue;
    // Skip GIF previews (heavy & unused by canvas engine)
    if (rel.toLowerCase().endsWith('.gif')) continue;

    const key = makeBlobKey(ninjaId, rel);
    const blob = await vf.readBlob(guessMime(rel));
    fileBlobKeys[rel] = key;
    blobsToSave.push({ key, blob });
  }

  const findBlobByPattern = (re: RegExp): string | undefined => {
    const match = Object.keys(fileBlobKeys).find((rel) => re.test(rel.toLowerCase()));
    return match ? fileBlobKeys[match] : undefined;
  };

  // Locate idle animation metadata & first page for preview + auto-portrait
  const idleSlug = manifest.roles?.idle || manifest.animations?.[0]?.slug || 'idle';
  const idleAnimEntry =
    manifest.animations.find((a) => a.slug === idleSlug) || manifest.animations[0];
  const idleJsonRel = idleAnimEntry?.jsonFile;
  const idleSheetRel = idleAnimEntry?.imageFiles?.[0];

  let faceKey = findBlobByPattern(/^(artes\/.*08_avatar|avatar|face|portrait).*\.(png|webp|jpg|jpeg)$/);
  const artKey = findBlobByPattern(/^(artes\/.*01_arte_completa|artes\/.*02_meio_corpo|art|full).*\.(png|webp|jpg|jpeg)$/);
  const icoKey = findBlobByPattern(/^(icones_skills\/.*(unique|esoter|ogi|03_)|ico|icon).*\.(png|webp|jpg|jpeg)$/);

  // Auto-generate face portrait from idle frame 0 if no avatar image was packaged
  if (!faceKey && idleSheetRel) {
    const idleSheetBlobItem = blobsToSave.find((b) => b.key === fileBlobKeys[idleSheetRel]);
    if (idleSheetBlobItem) {
      let frame0Rect: { x: number; y: number; w: number; h: number } | undefined;
      if (idleJsonRel && tree.has(`${prefix}${idleJsonRel}`)) {
        try {
          const parsed = parseSpritesheetJson(
            JSON.parse(await tree.get(`${prefix}${idleJsonRel}`)!.readText()),
            idleSlug,
            'anims',
            idleAnimEntry?.imageFiles
          );
          if (parsed.frames[0]) {
            frame0Rect = {
              x: parsed.frames[0].x,
              y: parsed.frames[0].y,
              w: parsed.frames[0].w,
              h: parsed.frames[0].h,
            };
          }
        } catch {
          // ignore
        }
      }
      const autoFace = await generateAutoFaceBlob(idleSheetBlobItem.blob, frame0Rect);
      if (autoFace) {
        const autoKey = makeBlobKey(ninjaId, '_generated/face.webp');
        fileBlobKeys['_generated/face.webp'] = autoKey;
        blobsToSave.push({ key: autoKey, blob: autoFace });
        faceKey = autoKey;
      }
    }
  }

  // Ensure roles has all expected fields normalized
  const animSlugs = manifest.animations.map((a) => a.slug);
  const inferredRoles = inferRolesFromAnimList(animSlugs);
  const roles: GameCharacterRoles = {
    idle: manifest.roles?.idle || inferredRoles.idle,
    move: manifest.roles?.move || inferredRoles.move,
    jump: manifest.roles?.jump || inferredRoles.jump,
    fall: manifest.roles?.fall || inferredRoles.fall,
    attack: manifest.roles?.attack || inferredRoles.attack,
    skills:
      Array.isArray(manifest.roles?.skills) && manifest.roles.skills.length > 0
        ? manifest.roles.skills
        : inferredRoles.skills,
    ultimate: manifest.roles?.ultimate || inferredRoles.ultimate,
    chase:
      manifest.roles?.chase ||
      (manifest.roles?.skills || []).find((s) => /chase|zhuida/i.test(s)) ||
      inferredRoles.chase,
    hurt: manifest.roles?.hurt || inferredRoles.hurt,
    fly: manifest.roles?.fly || inferredRoles.fly,
    die: manifest.roles?.die || inferredRoles.die,
    win: manifest.roles?.win || inferredRoles.win,
  };

  // Sanity check for split-zip missing texture pages
  for (const a of manifest.animations) {
    for (const imgFile of a.imageFiles || []) {
      if (!fileBlobKeys[imgFile]) {
        warnings.push(`Página de textura ausente: ${imgFile} (selecione todos os ZIPs divididos juntos).`);
      }
    }
  }

  const record: StoredImportedNinjaRecord = {
    id: ninjaId,
    name: combatJson?.displayName || manifest.name || ninjaId,
    source: 'imported-phaser',
    facing: manifest.facing === 'left' ? 'left' : 'right',
    roles,
    manifest: { ...manifest, roles },
    combatJson,
    instructionsJson,
    fileBlobKeys,
    previewKeys: {
      face: faceKey,
      art: artKey,
      ico: icoKey,
      idleSheet: idleSheetRel ? fileBlobKeys[idleSheetRel] : undefined,
      idleJson: idleJsonRel ? fileBlobKeys[idleJsonRel] : undefined,
    },
    warnings,
    importedAt: Date.now(),
  };

  // Validate combat parsing so we fail early on truly broken files
  buildDynamicCombatKit(combatJson, roles, record.name);

  await saveImportedNinja(record, blobsToSave);

  return {
    id: ninjaId,
    name: record.name,
    format: 'shinobi-phaser-v1',
    animCount: manifest.animations.length,
    effectCount: manifest.effects?.length || 0,
    audioCount: manifest.audio?.length || 0,
    videoCount: manifest.videos?.length || 0,
    warnings,
    ok: true,
  };
}

/**
 * Imports a legacy `*_completo.zip` package (animacoes/, particulas/, sons/ or audios/, videos/, artes/,
 * combate_e_habilidades.json, animacoes_instrucoes.json).
 */
async function importLegacyCompleteFromTree(
  rootPrefix: string,
  tree: Map<string, VirtualFile>,
  onProgress?: (msg: string) => void
): Promise<ImportReportItem> {
  const prefix = rootPrefix ? `${rootPrefix.replace(/\/+$/, '')}/` : '';
  const insVf = tree.get(`${prefix}animacoes_instrucoes.json`);
  const cmbVf = tree.get(`${prefix}combate_e_habilidades.json`);

  if (!insVf && !cmbVf) {
    throw new Error('Faltam animacoes_instrucoes.json e combate_e_habilidades.json no pacote legado.');
  }

  const instructionsJson = insVf ? JSON.parse(await insVf.readText()) : null;
  const combatJson = cmbVf ? (JSON.parse(await cmbVf.readText()) as RawCombatJson) : null;

  const rawId =
    combatJson?.characterId ||
    instructionsJson?.characterId ||
    toGameSlug(combatJson?.displayName || 'ninja_legado');
  const ninjaId = toGameSlug(rawId, 'ninja');
  const ninjaName = combatJson?.displayName || instructionsJson?.displayName || rawId;
  const warnings: string[] = [];

  onProgress?.(`Importando ${ninjaName} (pacote completo legado)...`);

  const fileBlobKeys: Record<string, string> = {};
  const blobsToSave: Array<{ key: string; blob: Blob }> = [];

  // Index all relevant files under this character's root
  const allRelPaths: string[] = [];
  for (const fullPath of tree.keys()) {
    if (!fullPath.startsWith(prefix)) continue;
    const rel = fullPath.slice(prefix.length);
    if (!rel || rel.endsWith('/')) continue;
    allRelPaths.push(rel);
  }

  // Save spritesheets, spritesheet jsons, particle sheets, sounds, videos, artes, skill icons
  const animFolders = new Map<
    string,
    { sheetRel?: string; jsonRel?: string; frameRels: string[] }
  >();

  let audioCount = 0;
  let videoCount = 0;
  let effectCount = 0;

  for (const rel of allRelPaths) {
    const low = rel.toLowerCase();

    // Detect animations under animacoes/<anim>/...
    const animMatch = rel.match(/^animacoes\/([^/]+)\/(.+)$/i);
    if (animMatch) {
      const folder = animMatch[1];
      const sub = animMatch[2];
      const entry = animFolders.get(folder) || { frameRels: [] };
      if (sub.toLowerCase().endsWith('_spritesheet.png')) {
        entry.sheetRel = rel;
      } else if (sub.toLowerCase().endsWith('_spritesheet.json')) {
        entry.jsonRel = rel;
      } else if (/^frames\/.+\.png$/i.test(sub)) {
        entry.frameRels.push(rel);
      }
      animFolders.set(folder, entry);

      // Persist spritesheet png + json (skip individual loose frames unless spritesheet is missing!)
      if (low.endsWith('_spritesheet.png') || low.endsWith('_spritesheet.json')) {
        const vf = tree.get(`${prefix}${rel}`)!;
        const key = makeBlobKey(ninjaId, rel);
        fileBlobKeys[rel] = key;
        blobsToSave.push({ key, blob: await vf.readBlob(guessMime(rel)) });
      }
      continue;
    }

    // Particles / effects under particulas/...
    if (low.startsWith('particulas/')) {
      if (
        low.endsWith('.png') ||
        low.endsWith('.webp') ||
        low.endsWith('.json') ||
        low.endsWith('.atlas')
      ) {
        const vf = tree.get(`${prefix}${rel}`)!;
        const key = makeBlobKey(ninjaId, rel);
        fileBlobKeys[rel] = key;
        blobsToSave.push({ key, blob: await vf.readBlob(guessMime(rel)) });
        if (low.endsWith('.json')) effectCount++;
      }
      continue;
    }

    // Audio under sons/ or audios/
    if ((low.startsWith('sons/') || low.startsWith('audios/')) && /\.(mp3|ogg|wav)$/.test(low)) {
      const vf = tree.get(`${prefix}${rel}`)!;
      const key = makeBlobKey(ninjaId, rel);
      fileBlobKeys[rel] = key;
      blobsToSave.push({ key, blob: await vf.readBlob(guessMime(rel)) });
      audioCount++;
      continue;
    }

    // Videos under videos/ or video/
    if ((low.startsWith('videos/') || low.startsWith('video/')) && /\.(mp4|webm)$/.test(low)) {
      const vf = tree.get(`${prefix}${rel}`)!;
      const key = makeBlobKey(ninjaId, rel);
      fileBlobKeys[rel] = key;
      blobsToSave.push({ key, blob: await vf.readBlob(guessMime(rel)) });
      videoCount++;
      continue;
    }

    // Artes & skill icons
    if (
      (low.startsWith('artes/') || low.startsWith('icones_skills/')) &&
      /\.(png|webp|jpg|jpeg)$/.test(low)
    ) {
      const vf = tree.get(`${prefix}${rel}`)!;
      const key = makeBlobKey(ninjaId, rel);
      fileBlobKeys[rel] = key;
      blobsToSave.push({ key, blob: await vf.readBlob(guessMime(rel)) });
    }
  }

  // If any animation folder has no spritesheet PNG but has frames/*.png, persist frame 0 as fallback
  for (const [folder, info] of animFolders.entries()) {
    if (!info.sheetRel && info.frameRels.length > 0) {
      info.frameRels.sort();
      const f0Rel = info.frameRels[0];
      const vf = tree.get(`${prefix}${f0Rel}`);
      if (vf) {
        const synthRel = `animacoes/${folder}/${folder}_spritesheet.png`;
        const key = makeBlobKey(ninjaId, synthRel);
        fileBlobKeys[synthRel] = key;
        blobsToSave.push({ key, blob: await vf.readBlob('image/png') });
        info.sheetRel = synthRel;
        warnings.push(`Animação "${folder}" sem spritesheet completo (usando frame inicial).`);
      }
    }
  }

  const animNames = Array.from(animFolders.keys()).filter((k) => Boolean(animFolders.get(k)?.sheetRel));
  if (animNames.length === 0) {
    throw new Error('Nenhuma animação válida encontrada em animacoes/ no pacote legado.');
  }

  const roles = inferRolesFromAnimList(animNames);
  const idleFolder = roles.idle || animNames[0];
  const idleInfo = animFolders.get(idleFolder);

  const findArtKey = (re: RegExp): string | undefined => {
    const match = Object.keys(fileBlobKeys).find((rel) => re.test(rel.toLowerCase()));
    return match ? fileBlobKeys[match] : undefined;
  };

  let faceKey = findArtKey(/^artes\/08_avatar|^artes\/.*avatar|^artes\/03_retrato/);
  const artKey = findArtKey(/^artes\/01_arte_completa|^artes\/02_meio_corpo/);
  const icoKey = findArtKey(/^icones_skills\/.*(03_|unique|esoter|ogi)|^icones_skills\//);

  // Determine idle dimensions & generate face portrait if missing
  let idleFallbackMeta: StoredImportedNinjaRecord['idleFallbackMeta'];
  if (idleInfo?.sheetRel) {
    const idleSheetKey = fileBlobKeys[idleInfo.sheetRel];
    const idleBlob = blobsToSave.find((b) => b.key === idleSheetKey)?.blob;
    if (idleBlob) {
      let frame0Rect: { x: number; y: number; w: number; h: number } | undefined;
      if (idleInfo.jsonRel && tree.has(`${prefix}${idleInfo.jsonRel}`)) {
        try {
          const parsed = parseSpritesheetJson(
            JSON.parse(await tree.get(`${prefix}${idleInfo.jsonRel}`)!.readText()),
            idleFolder,
            `animacoes/${idleFolder}`,
            [idleInfo.sheetRel]
          );
          if (parsed.frames[0]) {
            frame0Rect = {
              x: parsed.frames[0].x,
              y: parsed.frames[0].y,
              w: parsed.frames[0].w,
              h: parsed.frames[0].h,
            };
            idleFallbackMeta = {
              fw: parsed.cellWidth,
              fh: parsed.cellHeight,
              n: parsed.frameCount,
              cols: Math.max(1, Math.round((parsed.frames.length || 1) / Math.max(1, Math.ceil(parsed.frameCount / 6)))),
              fps: parsed.fps,
              durationMs: parsed.durationMs,
            };
          }
        } catch {
          // ignore
        }
      } else if (idleInfo.frameRels.length > 0) {
        // Compute grid meta from sheet image & first frame
        const f0Vf = tree.get(`${prefix}${idleInfo.frameRels.sort()[0]}`);
        if (f0Vf) {
          const f0Url = URL.createObjectURL(await f0Vf.readBlob('image/png'));
          const shUrl = URL.createObjectURL(idleBlob);
          try {
            const [f0Img, shImg] = await Promise.all([
              loadImageElement(f0Url),
              loadImageElement(shUrl),
            ]);
            const cols = Math.max(1, Math.floor(shImg.naturalWidth / Math.max(1, f0Img.naturalWidth)));
            const insIdle = (instructionsJson?.animations || []).find(
              (a: any) => String(a.name || '').toLowerCase() === idleFolder.toLowerCase()
            );
            const durMs = Math.round((insIdle?.baseDurationSec || 1.5) * 1000);
            idleFallbackMeta = {
              fw: f0Img.naturalWidth,
              fh: f0Img.naturalHeight,
              n: idleInfo.frameRels.length,
              cols,
              fps: Math.max(1, Math.round((idleInfo.frameRels.length * 1000) / Math.max(100, durMs))),
              durationMs: durMs,
            };
            frame0Rect = { x: 0, y: 0, w: f0Img.naturalWidth, h: f0Img.naturalHeight };
          } finally {
            URL.revokeObjectURL(f0Url);
            URL.revokeObjectURL(shUrl);
          }
        }
      }

      if (!faceKey) {
        const autoFace = await generateAutoFaceBlob(idleBlob, frame0Rect);
        if (autoFace) {
          const autoKey = makeBlobKey(ninjaId, '_generated/face.webp');
          fileBlobKeys['_generated/face.webp'] = autoKey;
          blobsToSave.push({ key: autoKey, blob: autoFace });
          faceKey = autoKey;
        }
      }
    }
  }

  if (effectCount === 0) warnings.push('Sem efeitos pré-renderizados em particulas/.');

  const record: StoredImportedNinjaRecord = {
    id: ninjaId,
    name: ninjaName,
    source: 'imported-legacy',
    facing: 'right',
    roles,
    combatJson,
    instructionsJson,
    fileBlobKeys,
    previewKeys: {
      face: faceKey,
      art: artKey,
      ico: icoKey,
      idleSheet: idleInfo?.sheetRel ? fileBlobKeys[idleInfo.sheetRel] : undefined,
      idleJson: idleInfo?.jsonRel ? fileBlobKeys[idleInfo.jsonRel] : undefined,
    },
    idleFallbackMeta,
    warnings,
    importedAt: Date.now(),
  };

  buildDynamicCombatKit(combatJson, roles, record.name);
  await saveImportedNinja(record, blobsToSave);

  return {
    id: ninjaId,
    name: ninjaName,
    format: 'completo-legado',
    animCount: animNames.length,
    effectCount,
    audioCount,
    videoCount,
    warnings,
    ok: true,
  };
}

/**
 * Main entry point for manual import:
 * - Accepts one or multiple `.zip` files (including split <= 20MB shinobi-phaser-v1 ZIPs selected together)
 * - Accepts legacy split archive parts (`.zip.t0.001`, `.002`, `.zip.001`, `.002`, etc.)
 * - Accepts local folder files (`webkitRelativePath` via folder picker)
 */
export async function importNinjaFiles(
  fileList: FileList | File[],
  onProgress?: (msg: string) => void
): Promise<{ results: ImportReportItem[]; globalWarnings: string[] }> {
  const files = Array.from(fileList);
  const results: ImportReportItem[] = [];
  const { archives, looseFiles, warnings: globalWarnings } = groupAndReassembleFiles(files);

  // Build unified virtual file tree merging all selected archives + loose folder files
  const mergedTree = new Map<string, VirtualFile>();

  for (let i = 0; i < archives.length; i++) {
    const arch = archives[i];
    onProgress?.(`Abrindo arquivo ${i + 1}/${archives.length}: ${arch.name}...`);
    try {
      const zip = await JSZip.loadAsync(arch.blob);
      for (const [rawPath, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const norm = normalizeVirtualPath(rawPath);
        if (!norm || norm.startsWith('__MACOSX/')) continue;
        mergedTree.set(norm, {
          path: norm,
          readBytes: () => entry.async('uint8array'),
          readText: () => entry.async('string'),
          readBlob: async (mime) => {
            const bytes = await entry.async('uint8array');
            return new Blob([bytes.buffer as ArrayBuffer], { type: mime || guessMime(norm) });
          },
        });
      }
    } catch (err) {
      results.push({
        id: arch.name,
        name: arch.name,
        format: 'shinobi-phaser-v1',
        animCount: 0,
        effectCount: 0,
        audioCount: 0,
        videoCount: 0,
        warnings: [],
        ok: false,
        error: `Não foi possível abrir o ZIP "${arch.name}": ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  for (const file of looseFiles) {
    const relRaw = (file as any).webkitRelativePath || file.name;
    const norm = normalizeVirtualPath(relRaw);
    if (!norm || norm.startsWith('__MACOSX/')) continue;
    mergedTree.set(norm, {
      path: norm,
      readBytes: async () => new Uint8Array(await file.arrayBuffer()),
      readText: () => file.text(),
      readBlob: async (mime) => (mime ? file.slice(0, file.size, mime) : file),
    });
  }

  // 1. Discover all `shinobi-phaser-v1` characters (`**/character.json`)
  const phaserRoots = new Set<string>();
  for (const p of mergedTree.keys()) {
    if (p === 'character.json' || p.endsWith('/character.json')) {
      const root = p.slice(0, p.length - 'character.json'.length).replace(/\/+$/, '');
      phaserRoots.add(root);
    }
  }

  for (const root of phaserRoots) {
    try {
      const item = await importPhaserCharacterFromTree(root, mergedTree, onProgress);
      results.push(item);
    } catch (err) {
      results.push({
        id: root || 'character',
        name: root || 'Ninja',
        format: 'shinobi-phaser-v1',
        animCount: 0,
        effectCount: 0,
        audioCount: 0,
        videoCount: 0,
        warnings: [],
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. Discover any legacy `*_completo.zip` roots (not already handled as shinobi-phaser-v1)
  const legacyRoots = new Set<string>();
  for (const p of mergedTree.keys()) {
    if (
      p === 'animacoes_instrucoes.json' ||
      p.endsWith('/animacoes_instrucoes.json') ||
      p === 'combate_e_habilidades.json' ||
      p.endsWith('/combate_e_habilidades.json')
    ) {
      const suffix = p.endsWith('animacoes_instrucoes.json')
        ? 'animacoes_instrucoes.json'
        : 'combate_e_habilidades.json';
      const root = p.slice(0, p.length - suffix.length).replace(/\/+$/, '');
      if (!phaserRoots.has(root)) {
        legacyRoots.add(root);
      }
    }
  }

  for (const root of legacyRoots) {
    try {
      const item = await importLegacyCompleteFromTree(root, mergedTree, onProgress);
      results.push(item);
    } catch (err) {
      results.push({
        id: root || 'legado',
        name: root || 'Pacote Legado',
        format: 'completo-legado',
        animCount: 0,
        effectCount: 0,
        audioCount: 0,
        videoCount: 0,
        warnings: [],
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (results.length === 0) {
    results.push({
      id: 'unknown',
      name: 'Pacote selecionado',
      format: 'shinobi-phaser-v1',
      animCount: 0,
      effectCount: 0,
      audioCount: 0,
      videoCount: 0,
      warnings: [],
      ok: false,
      error:
        'Nenhum character.json (shinobi-phaser-v1) ou pacote *_completo.zip válido foi encontrado nos arquivos selecionados.',
    });
  }

  return { results, globalWarnings };
}
