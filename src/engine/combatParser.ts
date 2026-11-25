import type {
  ActionSkillSpec,
  AnimRoleKey,
  ChaseSkillSpec,
  ChaseState,
  DynamicCombatKit,
  GameCharacterRoles,
  NatureKey,
  RawCombatJson,
  RawSkillEntry,
  StatusEffectSpec,
} from '../types/shinobi';

export const NATURE_COLORS: Record<NatureKey, string> = {
  wind: '#34D399',
  thunder: '#A78BFA',
  water: '#38BDF8',
  fire: '#FB923C',
  earth: '#D6A15C',
};

export const NATURE_LABELS: Record<NatureKey, string> = {
  wind: 'Vento',
  thunder: 'Relâmpago',
  water: 'Água',
  fire: 'Fogo',
  earth: 'Terra',
};

export const CHASE_STATE_LABELS: Record<ChaseState, string> = {
  popup: 'Flutuação baixa',
  launcher: 'Flutuação alta',
  back: 'Empurrão',
  fall: 'Queda',
};

export const CHASE_BANNER_LABELS: Record<ChaseState, string> = {
  popup: 'FLUTUAÇÃO',
  launcher: 'FLUTUAÇÃO ALTA',
  back: 'REPELIDO',
  fall: 'CAÍDO',
};

export const CHASE_LAUNCH_VY: Record<ChaseState, number> = {
  popup: -380,
  launcher: -630,
  back: -180,
  fall: 0,
};

export function toGameSlug(raw: string, fallback = 'item'): string {
  const cleaned = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

export function normalizeNature(raw?: string): NatureKey {
  const s = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (s.includes('wind') || s.includes('vento')) return 'wind';
  if (s.includes('thunder') || s.includes('relampago') || s.includes('trovao') || s.includes('raio')) {
    return 'thunder';
  }
  if (s.includes('water') || s.includes('agua')) return 'water';
  if (s.includes('fire') || s.includes('fogo') || s.includes('chama')) return 'fire';
  if (s.includes('earth') || s.includes('terra')) return 'earth';
  return 'fire';
}

export function normalizeChaseState(raw?: string): ChaseState | null {
  const s = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (!s) return null;
  if (s === 'popup' || s.includes('flutuacao baixa') || s.includes('pequena flutuacao')) return 'popup';
  if (s === 'launcher' || s.includes('flutuacao alta') || s.includes('grande flutuacao')) return 'launcher';
  if (s === 'back' || s.includes('empurr') || s.includes('repel')) return 'back';
  if (s === 'fall' || s.includes('queda') || s.includes('caid')) return 'fall';
  if (s.includes('flutuacao')) return 'popup';
  return null;
}

/**
 * Dynamically extracts battle status effects from `appliedEffects` and skill description text.
 */
export function parseStatusEffects(appliedEffects?: string[], desc?: string): StatusEffectSpec[] {
  const found = new Map<string, StatusEffectSpec>();
  const combined = [...(appliedEffects || []), desc || ''].join(' | ');
  const low = combined
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (/\b(chamas|queimadura|incendiar|ignitar|burn|fogo continuo)\b/.test(low)) {
    found.set('burn', {
      kind: 'burn',
      label: 'Chamas',
      turns: 2,
      chance: 1,
      potency: 5,
    });
  }
  if (/\b(paralisia|paralisar|imobilidade|atordoar|stun|paralysis|caos)\b/.test(low)) {
    const isGuarantee = /causa\s+(paralisia|imobilidade|atordoamento)/.test(low);
    found.set('paralysis', {
      kind: 'paralysis',
      label: 'Paralisia',
      turns: 1,
      chance: isGuarantee ? 0.55 : 0.35,
      potency: 1,
    });
  }
  if (/\b(veneno|envenenamento|poison|toxina)\b/.test(low)) {
    found.set('poison', {
      kind: 'poison',
      label: 'Veneno',
      turns: 3,
      chance: 1,
      potency: 4,
    });
  }
  if (/\b(selamento|sela|acupuntura|interrupcao|seal)\b/.test(low)) {
    found.set('seal', {
      kind: 'seal',
      label: 'Selamento',
      turns: 1,
      chance: 0.75,
      potency: 1,
    });
  }
  if (/\b(lentidao|desacelerar|slow)\b/.test(low)) {
    found.set('slow', {
      kind: 'slow',
      label: 'Lentidão',
      turns: 2,
      chance: 0.85,
      potency: 0.5,
    });
  }
  if (/\b(cura|curar|recupera vida|regenera|heal)\b/.test(low)) {
    found.set('heal', {
      kind: 'heal',
      label: 'Cura',
      turns: 1,
      chance: 1,
      potency: 14,
    });
  }
  if (/\b(escudo|barreira|shield)\b/.test(low)) {
    found.set('shield', {
      kind: 'shield',
      label: 'Escudo',
      turns: 2,
      chance: 1,
      potency: 16,
    });
  }

  return Array.from(found.values());
}

/**
 * Classifies a list of animation names/slugs into structured roles (matching gameExporter.ts).
 */
export function inferRolesFromAnimList(animNames: string[]): GameCharacterRoles {
  const roles: GameCharacterRoles = { skills: [] };
  const byLower = new Map<string, string>();
  for (const name of animNames) {
    byLower.set(name.toLowerCase(), name);
  }

  const pickFirst = (patterns: RegExp[], exclude = new Set<string>()): string | undefined => {
    for (const pat of patterns) {
      for (const name of animNames) {
        if (exclude.has(name)) continue;
        if (pat.test(name.toLowerCase())) return name;
      }
    }
    return undefined;
  };

  const used = new Set<string>();
  const take = (patterns: RegExp[]): string | undefined => {
    const found = pickFirst(patterns, used);
    if (found) used.add(found);
    return found;
  };

  roles.idle = take([/^idle$/, /^stand$/, /^wait$/, /^idle_?\d*$/, /idle/]);
  roles.move = take([/^move$/, /^run$/, /^walk$/, /^dash$/, /run|move/]);
  roles.jump = take([/^jump$/, /^fly$/, /^air$/, /jump/]);
  roles.fly = byLower.get('fly') || byLower.get('air') || undefined;
  roles.fall = take([/^fall$/, /^down$/, /^knockdown$/, /fall/]);
  roles.attack = take([/^attack$/, /^atk$/, /^pugong$/, /^attack_?1$/, /^normal_?attack$/]);
  roles.ultimate = take([
    /^ultimate$/,
    /^uniqueskill$/,
    /^superuniqueskill$/,
    /^aoyi$/,
    /^ogi$/,
    /unique|ultimate|aoyi|super/,
  ]);
  roles.chase = take([/^chase$/, /^chase_?1$/, /^chase_?1action$/, /^zhuida$/, /chase|zhuida|perseg|gatilho/]);
  roles.hurt = take([/^hurt$/, /^hurt_?1$/, /^hit$/, /^behit$/, /hurt|behit/]);
  roles.die = take([/^die$/, /^dead$/, /^death$/, /die|dead/]);
  roles.win = take([/^win$/, /^victory$/, /^pose$/, /win|victory/]);

  // Everything remaining that looks like a skill/chase/combat action goes into roles.skills
  for (const name of animNames) {
    if (used.has(name)) continue;
    const low = name.toLowerCase();
    if (/^(skill|chase|gatilho|jutsu|atk|attack|combo|aoyi|unique|special)/.test(low)) {
      roles.skills.push(name);
      used.add(name);
    }
  }

  if (!roles.idle && animNames.length > 0) {
    roles.idle = animNames[0];
  }

  return roles;
}

/**
 * Ensures missing role slots (especially `chase` when exported inside `roles.skills`)
 * are cleanly populated from available animation slugs.
 */
export function normalizeCharacterRoles(
  rawRoles: Partial<GameCharacterRoles> | null | undefined,
  animNames: string[]
): GameCharacterRoles {
  const inferred = inferRolesFromAnimList(animNames);
  const existingSkills = Array.isArray(rawRoles?.skills) ? rawRoles.skills : [];
  const mergedSkills = Array.from(new Set([...existingSkills, ...inferred.skills]));
  const chaseFromSkills = mergedSkills.find((s) => /chase|zhuida|perseg|gatilho/i.test(s));

  return {
    idle: rawRoles?.idle || inferred.idle,
    move: rawRoles?.move || inferred.move,
    jump: rawRoles?.jump || inferred.jump,
    fly: rawRoles?.fly || inferred.fly,
    fall: rawRoles?.fall || inferred.fall,
    attack: rawRoles?.attack || inferred.attack,
    skills: mergedSkills,
    ultimate: rawRoles?.ultimate || inferred.ultimate,
    chase: rawRoles?.chase || chaseFromSkills || inferred.chase,
    hurt: rawRoles?.hurt || inferred.hurt,
    die: rawRoles?.die || inferred.die,
    win: rawRoles?.win || inferred.win,
  };
}

/**
 * Resolves the best available animation slug for a requested battle role,
 * with smart fallback when a ninja does not have every single animation.
 */
export function resolveRoleAnimationSlug(
  roles: GameCharacterRoles,
  availableAnims: Set<string>,
  requestedRole: AnimRoleKey,
  preferredSlug?: string
): string | undefined {
  const has = (s?: string): s is string => Boolean(s && availableAnims.has(s));
  const pick = (s?: string): string | undefined => (s && availableAnims.has(s) ? s : undefined);

  if (has(preferredSlug)) return preferredSlug;

  const findSkillMatching = (regex: RegExp): string | undefined => {
    for (const s of roles.skills || []) {
      if (has(s) && regex.test(s.toLowerCase())) return s;
    }
    for (const s of availableAnims) {
      if (regex.test(s.toLowerCase())) return s;
    }
    return undefined;
  };

  switch (requestedRole) {
    case 'idle':
      return pick(roles.idle) || findSkillMatching(/idle|stand/) || Array.from(availableAnims)[0];
    case 'move':
      return (
        pick(roles.move) ||
        findSkillMatching(/^(run|move|walk)/) ||
        pick(roles.idle) ||
        Array.from(availableAnims)[0]
      );
    case 'jump':
      return (
        pick(roles.jump) ||
        pick(roles.fly) ||
        findSkillMatching(/jump|fly/) ||
        pick(roles.move) ||
        pick(roles.idle)
      );
    case 'fly':
      return (
        pick(roles.fly) ||
        pick(roles.jump) ||
        findSkillMatching(/fly|air|jump|hurt/) ||
        pick(roles.hurt) ||
        pick(roles.fall) ||
        pick(roles.idle)
      );
    case 'fall':
      return (
        pick(roles.fall) ||
        findSkillMatching(/fall|down/) ||
        pick(roles.hurt) ||
        pick(roles.idle)
      );
    case 'attack':
      return (
        pick(roles.attack) ||
        findSkillMatching(/^(attack|atk|pugong)/) ||
        (roles.skills || []).find((s) => has(s)) ||
        pick(roles.idle)
      );
    case 'skill': {
      const nonChaseSkill = (roles.skills || []).find(
        (s) => has(s) && !/chase|zhuida|ultimate|unique/.test(s.toLowerCase())
      );
      return (
        nonChaseSkill ||
        findSkillMatching(/^skill/) ||
        (roles.skills || []).find((s) => has(s)) ||
        pick(roles.attack) ||
        pick(roles.idle)
      );
    }
    case 'ultimate':
      return (
        pick(roles.ultimate) ||
        findSkillMatching(/ultimate|unique|aoyi|ogi|super/) ||
        (roles.skills && roles.skills.length > 0 ? pick(roles.skills[roles.skills.length - 1]) : undefined) ||
        pick(roles.attack) ||
        pick(roles.idle)
      );
    case 'chase': {
      const chaseSkill =
        pick(roles.chase) ||
        (roles.skills || []).find((s) => has(s) && /chase|zhuida|perseg/.test(s.toLowerCase())) ||
        findSkillMatching(/chase|zhuida/);
      return (
        chaseSkill ||
        (roles.skills || []).find((s) => has(s)) ||
        pick(roles.attack) ||
        pick(roles.idle)
      );
    }
    case 'hurt':
      return (
        pick(roles.hurt) ||
        findSkillMatching(/hurt|hit|behit/) ||
        pick(roles.fall) ||
        pick(roles.idle)
      );
    case 'die':
      return (
        pick(roles.die) ||
        findSkillMatching(/die|dead/) ||
        pick(roles.fall) ||
        pick(roles.hurt) ||
        pick(roles.idle)
      );
    case 'win':
      return pick(roles.win) || findSkillMatching(/win|victory/) || pick(roles.idle);
  }
}

function pickSkillEntry(
  skills: Record<string, RawSkillEntry>,
  keys: string[]
): RawSkillEntry | undefined {
  for (const k of keys) {
    if (skills[k]) return skills[k];
  }
  const entries = Object.entries(skills);
  for (const k of keys) {
    const low = k.toLowerCase();
    const match = entries.find(
      ([ek, ev]) =>
        ek.toLowerCase() === low ||
        (ev.slotLabel && ev.slotLabel.toLowerCase().includes(low))
    );
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Builds a 100% dynamic combat kit from `combate_e_habilidades.json` (shinobi-combat-v1)
 * and character animation roles. No hardcoded ninja IDs required!
 */
export function buildDynamicCombatKit(
  combatJson: RawCombatJson | null | undefined,
  roles: GameCharacterRoles,
  fallbackName: string,
  overrides?: {
    maxHp?: number;
    baseDmg?: number;
    nature?: string;
    roleLabel?: string;
    availableAnims?: Iterable<string>;
  }
): DynamicCombatKit {
  const cp = combatJson?.combatProfile;
  const bs = cp?.baseStats;
  const skillsMap = combatJson?.skills || {};
  const passives = combatJson?.passives || [];

  const nature = normalizeNature(cp?.nature || cp?.natureLabel || overrides?.nature);
  const natureLabel = cp?.natureLabel || NATURE_LABELS[nature];
  const roleCode = String(cp?.combatRole || 'dps').toLowerCase();
  const roleLabel =
    cp?.combatRoleLabel ||
    overrides?.roleLabel ||
    (roleCode === 'tank' ? 'Tanque' : roleCode === 'support' ? 'Suporte' : 'Dano');

  const displayHp = Math.round(bs?.hp || 2100);
  const displayAtk = Math.round(bs?.attack || 560);
  const displayDef = Math.round(bs?.defense || 115);

  // Normalize HP & damage into balanced GunBound/Artillery ranges while reflecting character archetype
  const isTank = roleCode === 'tank' || roleLabel.toLowerCase().includes('tanq');
  const computedMaxHp = Math.round(
    Math.min(145, Math.max(90, (isTank ? 114 : 96) + ((displayHp - 2000) / 140)))
  );
  const computedBaseDmg = Math.round(
    Math.min(34, Math.max(20, 24 + ((displayAtk - 500) / 85)))
  );
  const maxHp = overrides?.maxHp || computedMaxHp;
  const baseDmg = overrides?.baseDmg || computedBaseDmg;
  const critChance = Math.min(0.35, Math.max(0.08, (bs?.crit || 100) / 1000));

  const rawAttack = pickSkillEntry(skillsMap, ['attack', 'atk', 'ataque normal']);
  const rawSkill = pickSkillEntry(skillsMap, ['skill', 'habilidade', 'skill1']);
  const rawUlt = pickSkillEntry(skillsMap, [
    'UniqueSkill',
    'superUniqueSkill',
    'ultimate',
    'esotérica',
    'ôgi',
    'ogi',
  ]);

  const initiators = cp?.chaseComboSummary?.initiators || [];
  const initAttack = initiators.find((i) => i.slot === 'attack');
  const initSkill = initiators.find((i) => i.slot === 'skill');
  const initUlt = initiators.find((i) => i.slot === 'UniqueSkill' || i.slot === 'ultimate');

  const extractState = (
    skill?: RawSkillEntry,
    init?: { causesStates?: ChaseState[] },
    fallback: ChaseState = 'popup'
  ): ChaseState => {
    const rawList = [...(skill?.causesChaseStates || []), ...(init?.causesStates || [])];
    for (const st of rawList) {
      const norm = normalizeChaseState(st);
      if (norm) return norm;
    }
    if (skill?.descPlain) {
      const low = skill.descPlain.toLowerCase();
      if (low.includes('empurr') || low.includes('repel')) return 'back';
      if (low.includes('flutuação alta') || low.includes('grande flutuação')) return 'launcher';
      if (low.includes('queda')) return 'fall';
      if (low.includes('flutuação')) return 'popup';
    }
    return fallback;
  };

  const attackState = extractState(rawAttack, initAttack, 'popup');
  const skillState = extractState(rawSkill, initSkill, attackState);
  const ultState = extractState(rawUlt, initUlt, 'launcher');

  const attackEffects = parseStatusEffects(
    [...(rawAttack?.appliedEffects || []), ...(initAttack?.appliedEffects || [])],
    rawAttack?.descPlain
  );
  const skillEffects = parseStatusEffects(
    [...(rawSkill?.appliedEffects || []), ...(initSkill?.appliedEffects || [])],
    rawSkill?.descPlain
  );
  const ultEffects = parseStatusEffects(
    [...(rawUlt?.appliedEffects || []), ...(initUlt?.appliedEffects || [])],
    rawUlt?.descPlain
  );

  const allKnownAnims = new Set<string>([
    ...(overrides?.availableAnims || []),
    ...[
      roles.idle,
      roles.move,
      roles.jump,
      roles.fly,
      roles.fall,
      roles.attack,
      roles.ultimate,
      roles.chase,
      roles.hurt,
      roles.die,
      roles.win,
      ...(roles.skills || []),
    ].filter((x): x is string => Boolean(x)),
  ]);

  const matchAnimHint = (hint?: string): string | undefined => {
    if (!hint) return undefined;
    if (allKnownAnims.has(hint)) return hint;
    const low = hint.toLowerCase();
    const slug = toGameSlug(hint, '');
    for (const candidate of allKnownAnims) {
      if (candidate.toLowerCase() === low || (slug && toGameSlug(candidate, '') === slug)) {
        return candidate;
      }
    }
    return undefined;
  };

  const distinctSkillSlug =
    matchAnimHint(rawSkill?.animKey) ||
    (roles.skills || []).find(
      (s) => !/chase|zhuida|ultimate|unique/.test(s.toLowerCase()) && s !== roles.attack
    );

  const attackAnimSlug = matchAnimHint(rawAttack?.animKey) || roles.attack;
  const ultAnimSlug =
    matchAnimHint(rawUlt?.animKey) || roles.ultimate || distinctSkillSlug || roles.attack;

  const attackSpec: ActionSkillSpec = {
    slot: 'attack',
    slotLabel: rawAttack?.slotLabel || 'Ataque Normal',
    name: rawAttack?.name || `Golpe de ${fallbackName.split(' ')[0]}`,
    description: rawAttack?.descShort || rawAttack?.descPlain || 'Ataque básico com ganho de chakra.',
    causesState: attackState,
    statusEffects: attackEffects,
    damageMultiplier: 1.0,
    chakraCost: 0,
    animSlug: attackAnimSlug,
  };

  const skillSpec: ActionSkillSpec = {
    slot: 'skill',
    slotLabel: rawSkill?.slotLabel || 'Habilidade',
    name: rawSkill?.name || rawAttack?.name || 'Jutsu Especial',
    description: rawSkill?.descShort || rawSkill?.descPlain || 'Técnica shinobi com dano ampliado.',
    causesState: skillState,
    statusEffects: skillEffects.length > 0 ? skillEffects : attackEffects,
    damageMultiplier: 1.38,
    chakraCost: 40,
    animSlug: distinctSkillSlug || attackAnimSlug,
  };

  const ultSpec: ActionSkillSpec = {
    slot: 'ultimate',
    slotLabel: rawUlt?.slotLabel || 'Ôgi (Ultimate)',
    name: rawUlt?.name || 'Técnica Suprema',
    description: rawUlt?.descShort || rawUlt?.descPlain || 'Técnica definitiva com impacto massivo.',
    causesState: ultState,
    statusEffects: ultEffects.length > 0 ? ultEffects : skillEffects,
    damageMultiplier: 2.05,
    chakraCost: 100,
    animSlug: ultAnimSlug,
  };

  // Build dynamic chase list from chaseComboSummary.chasers + chase* skill entries
  const chasers: ChaseSkillSpec[] = [];
  const seenChaseKeys = new Set<string>();
  const chaseAnimSlugs = Array.from(
    new Set([
      ...(roles.chase ? [roles.chase] : []),
      ...(roles.skills || []).filter((s) => /chase|zhuida|perseg|gatilho/i.test(s)),
      ...Array.from(allKnownAnims).filter((s) => /chase|zhuida|perseg|gatilho/i.test(s)),
    ])
  );

  const addChaser = (
    slot: string,
    name: string,
    reqRaw: string[] | undefined,
    causesRaw: string[] | undefined,
    applied: string[] | undefined,
    desc?: string,
    animKey?: string
  ) => {
    const reqs = (reqRaw || [])
      .map((s) => normalizeChaseState(s))
      .filter((s): s is ChaseState => Boolean(s));
    if (reqs.length === 0) return;
    const dedupe = `${name.toLowerCase()}::${reqs.join(',')}`;
    if (seenChaseKeys.has(dedupe)) return;
    seenChaseKeys.add(dedupe);

    const causes =
      (causesRaw || [])
        .map((s) => normalizeChaseState(s))
        .find((s): s is ChaseState => Boolean(s)) || 'fall';

    const idx = chasers.length;
    const slotSlug = toGameSlug(slot, '');
    const slotMatchedAnim =
      matchAnimHint(animKey) ||
      matchAnimHint(skillsMap[slot]?.animKey) ||
      chaseAnimSlugs.find((s) => slotSlug && toGameSlug(s, '').includes(slotSlug));

    chasers.push({
      slot,
      name,
      requiresStates: reqs,
      causesState: causes,
      statusEffects: parseStatusEffects(applied, desc),
      animSlug: slotMatchedAnim || chaseAnimSlugs[idx] || chaseAnimSlugs[0] || roles.chase || roles.attack,
    });
  };

  for (const ch of cp?.chaseComboSummary?.chasers || []) {
    const skRef = ch.slot ? skillsMap[ch.slot] : undefined;
    addChaser(
      ch.slot || `chase${chasers.length + 1}`,
      ch.skillName || 'Perseguição',
      ch.requiresStates,
      ch.causesStates,
      ch.appliedEffects,
      skRef?.descPlain,
      skRef?.animKey
    );
  }

  for (const [slot, sk] of Object.entries(skillsMap)) {
    if (sk.chaseTriggers && sk.chaseTriggers.length > 0) {
      addChaser(
        slot,
        sk.name || 'Perseguição',
        sk.chaseTriggers,
        sk.causesChaseStates,
        sk.appliedEffects,
        sk.descPlain,
        sk.animKey
      );
    }
  }

  for (const p of passives) {
    if (p.chaseTriggers && p.chaseTriggers.length > 0) {
      addChaser(
        'passive',
        p.name || 'Perseguição',
        p.chaseTriggers,
        p.causesChaseStates,
        p.appliedEffects,
        p.descPlain,
        p.animKey
      );
    }
  }

  const skillDisplayList: Array<{ slotLabel: string; name: string; desc?: string }> = [];
  for (const sk of Object.values(skillsMap)) {
    if (!sk?.name) continue;
    skillDisplayList.push({
      slotLabel: sk.slotLabel || 'Habilidade',
      name: sk.name,
      desc: sk.descShort || sk.descPlain,
    });
  }
  if (skillDisplayList.length === 0) {
    skillDisplayList.push(
      { slotLabel: attackSpec.slotLabel, name: attackSpec.name, desc: attackSpec.description },
      { slotLabel: ultSpec.slotLabel, name: ultSpec.name, desc: ultSpec.description }
    );
  }

  const chaseDisplayList = chasers.map((c) => ({
    name: c.name,
    requiresLabels: c.requiresStates.map((s) => CHASE_STATE_LABELS[s]),
    causesLabel: CHASE_STATE_LABELS[c.causesState],
    effects: c.statusEffects.map((e) => e.label),
  }));

  const hasDistinctSkill = Boolean(
    distinctSkillSlug || (rawSkill && rawAttack && rawSkill.name !== rawAttack.name)
  );

  return {
    nature,
    natureLabel,
    role: roleCode,
    roleLabel,
    displayHp,
    displayAtk,
    displayDef,
    maxHp,
    baseDmg,
    critChance,
    attack: attackSpec,
    skill: skillSpec,
    ultimate: ultSpec,
    chasers,
    skillDisplayList,
    chaseDisplayList,
    hasDistinctSkill,
  };
}
