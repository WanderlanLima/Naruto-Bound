import React, { useMemo } from 'react';
import { Swords, Users, Upload, ChevronRight } from 'lucide-react';
import type { GameMode, NinjaRosterEntry, TeamSize } from '../types/shinobi';
import { SpritePreview } from './SpritePreview';

interface MenuScreenProps {
  roster: NinjaRosterEntry[];
  teamSize: TeamSize;
  onChangeTeamSize: (size: TeamSize) => void;
  onStartMode: (mode: GameMode) => void;
  onOpenImport: () => void;
}

export const MenuScreen: React.FC<MenuScreenProps> = ({
  roster,
  teamSize,
  onChangeTeamSize,
  onStartMode,
  onOpenImport,
}) => {
  const embers = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        id: i,
        left: `${6 + ((i * 7.3) % 88)}%`,
        delay: `${(i * 0.7) % 6.5}s`,
        duration: `${5.5 + (i % 4) * 1.4}s`,
        size: i % 3 === 0 ? 5 : 3,
      })),
    []
  );

  const previewHeight = typeof window !== 'undefined' && window.innerHeight < 500 ? 96 : 130;

  const importedCount = roster.filter(
    (n) => n.source === 'imported-phaser' || n.source === 'imported-legacy'
  ).length;
  const repoCount = roster.filter((n) => n.source === 'repo').length;

  return (
    <section className="relative flex h-full w-full flex-col overflow-hidden bg-[#0B1020]">
      <button
        type="button"
        onClick={onOpenImport}
        title="ZIP shinobi-phaser-v1, legado .001/.002 ou index.json"
        className="absolute z-20 flex min-h-[40px] items-center gap-2 rounded-lg border border-dashed border-amber-500/50 bg-[#1A1A28]/95 px-3 text-xs font-semibold text-amber-100 transition-colors duration-150 hover:border-amber-400 hover:bg-amber-500/15"
        style={{ top: 'calc(var(--sa-t) + 10px)', right: 'calc(var(--sa-r) + 12px)' }}
      >
        <Upload className="h-4 w-4 shrink-0 text-amber-400" />
        Importar ninja
      </button>
      {/* Atmospheric night backdrop */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 22% 18%, rgba(45, 76, 152, 0.42), transparent 58%), radial-gradient(ellipse at 82% 82%, rgba(217, 119, 6, 0.2), transparent 55%), linear-gradient(180deg, #090E1C 0%, #111A36 60%, #0D1326 100%)',
        }}
      />

      {/* Rising embers */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {embers.map((e) => (
          <div
            key={e.id}
            className="animate-ember absolute rounded-full bg-amber-400/80 shadow-[0_0_8px_rgba(251,191,36,0.85)]"
            style={{
              left: e.left,
              width: e.size,
              height: e.size,
              animationDelay: e.delay,
              animationDuration: e.duration,
            }}
          />
        ))}
      </div>

      {/* Main Content Split: side by side whenever the screen is wide or lying down; scrolls if it still overflows */}
      <div className="relative z-10 h-full w-full overflow-y-auto overscroll-contain">
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col justify-between gap-6 px-6 pb-6 pt-16 md:flex-row md:items-center md:gap-12 md:px-12 md:py-14 landscape:flex-row landscape:items-center [@media(max-height:500px)]:gap-5 [@media(max-height:500px)]:px-5 [@media(max-height:500px)]:pb-3 [@media(max-height:500px)]:pt-14">
        {/* Left Hero Anchor & Animated Shinobi Crew */}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-6 [@media(max-height:500px)]:gap-1">
          <div>
            <p className="text-xs font-medium tracking-wide text-amber-300/90">
              Artilharia ninja por turnos · {roster.length} ninjas disponíveis
              {repoCount > 0 ? ` · ${repoCount} do repositório` : ''}
              {importedCount > 0 ? ` · ${importedCount} importado(s)` : ''}
            </p>
            <h1 className="font-display mt-2 text-5xl font-black uppercase leading-[0.9] tracking-tight text-white sm:text-6xl lg:text-7xl [@media(max-height:500px)]:text-4xl">
              <span className="bg-gradient-to-b from-amber-100 via-amber-300 to-orange-500 bg-clip-text text-transparent">
                SHINOBI
              </span>
              <br />
              <span>ARTILLERY</span>
            </h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-300 [@media(max-height:500px)]:mt-2 [@media(max-height:500px)]:text-xs">
              Mire por arraste, domine o vento, destrua o terreno e encadeie combos de perseguição e técnicas Ôgi sincronizadas em tempo real.
            </p>
          </div>

          {/* Animated Idle Crew Strip */}
          <div className="flex items-end gap-2 overflow-hidden pt-2">
            {roster.slice(0, 5).map((n) => (
              <div
                key={n.id}
                className="relative flex flex-col items-center justify-end"
                title={n.name}
              >
                <SpritePreview ninja={n} height={previewHeight} />
              </div>
            ))}
          </div>
        </div>

        {/* Right Primary Actions */}
        <div className="flex w-full shrink-0 flex-col gap-3 md:w-[340px] landscape:w-[300px] md:landscape:w-[340px]">
          <div
            className="grid grid-cols-2 gap-1 rounded-xl border border-slate-700/90 bg-[#0F162D]/90 p-1"
            role="group"
            aria-label="Formato da batalha"
          >
            {([1, 3] as const).map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => onChangeTeamSize(size)}
                aria-pressed={teamSize === size}
                className={`min-h-[40px] rounded-lg text-sm font-bold transition-colors ${
                  teamSize === size
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {size === 1 ? 'Duelo 1x1' : 'Equipes 3x3'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onStartMode('ia')}
            className="group flex min-h-[60px] w-full items-center justify-between rounded-xl border border-amber-400/50 bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-3.5 text-left text-slate-950 shadow-lg shadow-amber-950/40 transition-transform duration-150 hover:scale-[1.01] active:scale-[0.99]"
          >
            <div className="flex items-center gap-3.5">
              <Swords className="h-5 w-5 shrink-0" />
              <div>
                <div className="text-base font-bold leading-tight">Player vs IA</div>
                <div className="text-xs font-medium text-slate-900/80">
                  {teamSize === 3
                    ? 'Monte seu trio; a IA escolhe os 3 ninjas dela'
                    : 'Batalha tática contra oponente controlado por IA'}
                </div>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5" />
          </button>

          <button
            type="button"
            onClick={() => onStartMode('local')}
            className="group flex min-h-[60px] w-full items-center justify-between rounded-xl border border-slate-700/90 bg-[#151F3B]/90 px-5 py-3.5 text-left text-slate-100 transition-colors duration-150 hover:border-amber-400/50 hover:bg-[#1B2749]"
          >
            <div className="flex items-center gap-3.5">
              <Users className="h-5 w-5 shrink-0 text-sky-400" />
              <div>
                <div className="text-base font-semibold leading-tight">Player vs Player Local</div>
                <div className="text-xs text-slate-400">
                  {teamSize === 3
                    ? 'Cada jogador monta um trio no mesmo dispositivo'
                    : 'Dois jogadores no mesmo dispositivo por turnos'}
                </div>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-amber-300" />
          </button>
        </div>
      </div>
      </div>
    </section>
  );
};
