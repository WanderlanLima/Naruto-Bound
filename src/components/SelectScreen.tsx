import React, { useEffect, useState } from 'react';
import { ChevronLeft, Loader2, Upload } from 'lucide-react';
import { CHASE_STATE_LABELS, NATURE_COLORS } from '../engine/combatParser';
import type { GameMode, NinjaRosterEntry } from '../types/shinobi';
import { SpritePreview } from './SpritePreview';

interface SelectScreenProps {
  roster: NinjaRosterEntry[];
  mode: GameMode;
  loadingMatch: boolean;
  loadError: string | null;
  onBackToMenu: () => void;
  onOpenImport: () => void;
  onConfirmPair: (pair: [NinjaRosterEntry, NinjaRosterEntry]) => void;
}

export const SelectScreen: React.FC<SelectScreenProps> = ({
  roster,
  mode,
  loadingMatch,
  loadError,
  onBackToMenu,
  onOpenImport,
  onConfirmPair,
}) => {
  const [step, setStep] = useState<0 | 1>(0);
  const [firstPick, setFirstPick] = useState<NinjaRosterEntry | null>(null);
  const [selected, setSelected] = useState<NinjaRosterEntry | null>(() => roster[0] || null);

  useEffect(() => {
    if (!selected && roster.length > 0) {
      setSelected(roster[0]);
    } else if (selected && !roster.some((r) => r.id === selected.id)) {
      setSelected(roster[0] || null);
    }
  }, [roster, selected]);

  const stepTitle =
    mode === 'ia'
      ? step === 0
        ? 'Escolha seu ninja'
        : 'Escolha seu oponente (IA)'
      : step === 0
        ? 'Jogador 1: escolha seu ninja'
        : 'Jogador 2: escolha seu ninja';

  const handleBack = () => {
    if (loadingMatch) return;
    if (step === 1) {
      setStep(0);
      setSelected(firstPick || roster[0] || null);
    } else {
      onBackToMenu();
    }
  };

  const handleConfirm = () => {
    if (!selected || loadingMatch) return;
    if (step === 0) {
      setFirstPick(selected);
      setStep(1);
      // Pre-select a different ninja for the opponent if available
      const other = roster.find((n) => n.id !== selected.id) || selected;
      setSelected(other);
    } else if (firstPick) {
      onConfirmPair([firstPick, selected]);
    }
  };

  const accent = selected ? NATURE_COLORS[selected.combat.nature] || '#F59E0B' : '#F59E0B';

  return (
    <section className="relative flex h-full w-full flex-col overflow-hidden bg-[#0B1020]">
      {/* Dynamic elemental glow behind showcase */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          background: selected
            ? `radial-gradient(circle at 28% 58%, ${accent}33, transparent 58%), linear-gradient(135deg, #090E1C 0%, #121B38 55%, #0B1020 100%)`
            : 'linear-gradient(135deg, #090E1C 0%, #121B38 100%)',
        }}
      />

      {/* Top Bar */}
      <header className="relative z-20 flex shrink-0 items-center justify-between gap-4 border-b border-slate-800/80 bg-[#0B1020]/75 px-4 py-3 backdrop-blur-md md:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            disabled={loadingMatch}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900/80 text-slate-200 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-50"
            aria-label="Voltar"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="font-display text-xl font-bold tracking-wide text-amber-300 md:text-2xl">
              {stepTitle}
            </h1>
            {step === 1 && firstPick && (
              <p className="text-xs text-slate-400">
                Jogador 1 confirmado: <span className="font-semibold text-slate-200">{firstPick.name}</span>
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenImport}
          disabled={loadingMatch}
          className="flex min-h-[40px] items-center gap-2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-amber-400/50 hover:text-amber-200 disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5 shrink-0" />
          <span>Importar Ninja</span>
        </button>
      </header>

      {/* Main Split Workspace */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-4 p-4 md:flex-row md:gap-6 md:p-6">
        {/* Left: Character Showcase + Dynamic Combat Breakdown */}
        <div className="flex min-h-0 flex-1 flex-col justify-between gap-4 overflow-y-auto rounded-xl border border-slate-800/80 bg-[#0F162D]/70 p-4 md:p-6">
          {selected ? (
            <>
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
                {/* Visual Art or Animated Idle Preview */}
                <div className="relative flex h-48 shrink-0 items-end justify-center overflow-hidden rounded-lg bg-slate-950/50 p-3 sm:h-56 lg:h-64 lg:w-64">
                  {selected.previewArtUrl ? (
                    <img
                      src={selected.previewArtUrl}
                      alt={selected.name}
                      referrerPolicy="no-referrer"
                      className="max-h-full max-w-full object-contain drop-shadow-[0_10px_22px_rgba(0,0,0,0.75)]"
                    />
                  ) : (
                    <SpritePreview ninja={selected} height={210} />
                  )}
                </div>

                {/* Identity & Unboxed Stats */}
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <h2 className="font-display text-3xl font-extrabold tracking-tight text-white md:text-4xl">
                      {selected.name}
                    </h2>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-300">
                      <span style={{ color: accent }}>{selected.combat.natureLabel}</span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span>{selected.combat.roleLabel}</span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span className="font-mono-num">
                        HP {selected.combat.displayHp} ({selected.combat.maxHp} Arena)
                      </span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span className="font-mono-num">ATK {selected.combat.displayAtk}</span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span className="font-mono-num">DEF {selected.combat.displayDef}</span>
                      {selected.formatLabel && (
                        <>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span className="text-slate-400">{selected.formatLabel}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Dynamic Skills Breakdown */}
                  <div className="space-y-2 border-t border-slate-800/90 pt-3 text-xs">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="rounded-lg bg-slate-900/70 p-2.5">
                        <div className="font-semibold text-amber-300">
                          {selected.combat.attack.slotLabel}: {selected.combat.attack.name}
                        </div>
                        <div className="mt-0.5 text-slate-400">
                          Causa {CHASE_STATE_LABELS[selected.combat.attack.causesState]}
                          {selected.combat.attack.statusEffects.length > 0
                            ? ` · ${selected.combat.attack.statusEffects.map((e) => e.label).join(', ')}`
                            : ''}
                        </div>
                      </div>

                      <div className="rounded-lg bg-slate-900/70 p-2.5">
                        <div className="font-semibold text-amber-300">
                          Ôgi: {selected.combat.ultimate.name}
                        </div>
                        <div className="mt-0.5 text-slate-400">
                          Dano ×2 · Causa {CHASE_STATE_LABELS[selected.combat.ultimate.causesState]}
                          {selected.combat.ultimate.statusEffects.length > 0
                            ? ` · ${selected.combat.ultimate.statusEffects.map((e) => e.label).join(', ')}`
                            : ''}
                        </div>
                      </div>
                    </div>

                    {selected.combat.chaseDisplayList.length > 0 && (
                      <div className="space-y-1 rounded-lg bg-slate-900/70 p-2.5">
                        <div className="font-semibold text-sky-300">Perseguições Dinâmicas</div>
                        {selected.combat.chaseDisplayList.map((ch, idx) => (
                          <div key={idx} className="text-slate-300">
                            <span className="font-semibold text-white">{ch.name}</span>
                            <span className="text-slate-400">
                              {' '}
                              — Requer {ch.requiresLabels.join(' / ')} → Causa {ch.causesLabel}
                              {ch.effects.length > 0 ? ` · ${ch.effects.join(', ')}` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Compact animated sprite strip when art is shown */}
              {selected.previewArtUrl && selected.previewIdleSheetUrl && (
                <div className="hidden items-center justify-between border-t border-slate-800/80 pt-3 sm:flex">
                  <div className="text-xs text-slate-400">
                    Papéis detectados:{' '}
                    <span className="text-slate-200">
                      {[
                        selected.roles.idle && 'idle',
                        selected.roles.move && 'move',
                        selected.roles.attack && 'attack',
                        selected.roles.skills.length > 0 && `${selected.roles.skills.length} skill(s)`,
                        selected.roles.ultimate && 'ultimate',
                        selected.roles.chase && 'chase',
                        selected.roles.hurt && 'hurt',
                        selected.roles.die && 'die',
                        selected.roles.win && 'win',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  <SpritePreview ninja={selected} height={68} />
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
              Selecione um ninja na lista ao lado.
            </div>
          )}
        </div>

        {/* Right: Roster Grid & Confirm CTA */}
        <aside className="flex w-full shrink-0 flex-col gap-3 md:w-[340px] lg:w-[380px]">
          <div className="grid max-h-[240px] grid-cols-3 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-4 md:max-h-none md:flex-1 md:grid-cols-3 md:content-start">
            {roster.map((n) => {
              const isSelected = selected?.id === n.id;
              const isFirst = step === 1 && firstPick?.id === n.id;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelected(n)}
                  disabled={loadingMatch}
                  className={`group relative aspect-square overflow-hidden rounded-xl border-2 bg-slate-900 text-left transition-transform duration-150 focus-visible:outline-2 focus-visible:outline-amber-400 ${
                    isSelected
                      ? 'scale-[1.02] border-amber-400 shadow-[0_0_16px_rgba(245,158,11,0.45)]'
                      : 'border-slate-700/80 hover:border-slate-500'
                  }`}
                >
                  {n.previewFaceUrl ? (
                    <img
                      src={n.previewFaceUrl}
                      alt={n.name}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover object-top"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-800 text-xs font-bold text-slate-400">
                      {n.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-1.5 pb-1.5 pt-5">
                    <div className="truncate text-[11px] font-bold leading-tight text-white">
                      {n.name.split(' ')[0]}
                    </div>
                    {isFirst && (
                      <div className="text-[9px] font-semibold text-amber-300">P1</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {loadError && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-200">
              {loadError}
            </div>
          )}

          <button
            type="button"
            disabled={!selected || loadingMatch}
            onClick={handleConfirm}
            className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-amber-950/40 transition-colors hover:from-amber-400 hover:to-orange-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {loadingMatch ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Carregando sprites e efeitos...</span>
              </>
            ) : (
              <span>{step === 1 ? 'Iniciar Batalha' : 'Confirmar Jogador 1'}</span>
            )}
          </button>
        </aside>
      </div>
    </section>
  );
};
