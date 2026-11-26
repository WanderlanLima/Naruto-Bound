import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  LogOut,
  Maximize2,
  Minimize2,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { audioEngine } from '../engine/audioPlayer';
import { ShinobiBattleEngine } from '../engine/battleEngine';
import { CHASE_STATE_LABELS } from '../engine/combatParser';
import type {
  BattleUiSnapshot,
  GameMode,
  LoadedNinjaRuntime,
} from '../types/shinobi';
import {
  enterBattleFullscreenLandscape,
  exitBattleFullscreenLandscape,
  isDocumentFullscreen,
} from '../utils/viewportOrientation';

interface BattleScreenProps {
  teams: [LoadedNinjaRuntime[], LoadedNinjaRuntime[]];
  mode: GameMode;
  onRematch: () => void;
  onChangeNinjas: () => void;
  onExitToMenu: () => void;
}

export const BattleScreen: React.FC<BattleScreenProps> = ({
  teams,
  mode,
  onRematch,
  onChangeNinjas,
  onExitToMenu,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<ShinobiBattleEngine | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [ui, setUi] = useState<BattleUiSnapshot | null>(null);
  const [muted, setMuted] = useState(() => audioEngine.isMuted());
  const [fullscreen, setFullscreen] = useState(() => isDocumentFullscreen());
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 720,
  }));

  const isPortrait = viewport.h > viewport.w;

  useEffect(() => {
    const updateSize = () => {
      setViewport({
        w: window.innerWidth,
        h: window.innerHeight,
      });
    };

    const handleFsChange = () => {
      setFullscreen(isDocumentFullscreen());
      updateSize();
    };

    window.addEventListener('resize', updateSize);
    window.addEventListener('orientationchange', updateSize);
    window.visualViewport?.addEventListener('resize', updateSize);
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);

    return () => {
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('orientationchange', updateSize);
      window.visualViewport?.removeEventListener('resize', updateSize);
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new ShinobiBattleEngine({
      canvas,
      teams,
      mode,
      onUiUpdate: (snap) => setUi(snap),
    });
    engine.setRotatedPortrait(window.innerHeight > window.innerWidth);
    engineRef.current = engine;

    const rafCenter = requestAnimationFrame(() => {
      engine.centerCameraOnActive();
    });

    return () => {
      cancelAnimationFrame(rafCenter);
      engine.dispose();
      engineRef.current = null;
    };
  }, [teams, mode]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setRotatedPortrait(isPortrait);
    const raf = requestAnimationFrame(() => {
      engine.centerCameraOnActive();
    });
    return () => cancelAnimationFrame(raf);
  }, [isPortrait, viewport.w, viewport.h]);

  // Synchronize cut-in video playback cleanly
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (ui?.cutIn?.showVideo && ui.cutIn.videoUrl) {
      vid.src = ui.cutIn.videoUrl;
      vid.muted = muted;
      const playPromise = vid.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          vid.muted = true;
          vid.play().catch(() => engineRef.current?.finishCutInVideo());
        });
      }
    } else {
      try {
        vid.pause();
        vid.removeAttribute('src');
        vid.load();
      } catch {
        // ignore
      }
    }
  }, [ui?.cutIn?.showVideo, ui?.cutIn?.videoUrl, muted]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    audioEngine.setMuted(next);
  };

  const toggleFullscreen = () => {
    if (fullscreen) {
      void exitBattleFullscreenLandscape();
    } else {
      void enterBattleFullscreenLandscape();
    }
  };

  const activeFighter = ui ? ui.fighters[ui.turnIndex] : null;
  const canPlayerAct = Boolean(
    ui && ui.phase === 'aim' && !(mode === 'ia' && ui.activeTeam === 1)
  );
  const ultReady = Boolean(
    activeFighter && activeFighter.chakra >= 100 && activeFighter.statuses.seal === 0
  );
  const ultArmed = Boolean(activeFighter && activeFighter.armedAction === 'ultimate');
  const skillCost = activeFighter?.combat.skill.chakraCost || 40;
  const skillReady = Boolean(
    activeFighter &&
      activeFighter.combat.hasDistinctSkill &&
      activeFighter.chakra >= skillCost &&
      activeFighter.statuses.seal === 0
  );
  const skillArmed = Boolean(activeFighter && activeFighter.armedAction === 'skill');

  const windDisplay = (() => {
    if (!ui) return '';
    const w = ui.wind;
    if (Math.abs(w) < 0.2) return 'Vento calmo';
    const arrows = (w > 0 ? '▶' : '◀').repeat(Math.min(5, Math.ceil(Math.abs(w) / 2)));
    return `Vento ${arrows} ${Math.abs(w).toFixed(1)}`;
  })();

  const rotatedLandscapeStyle: React.CSSProperties | undefined = isPortrait
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        width: `${viewport.h}px`,
        height: `${viewport.w}px`,
        transformOrigin: 'top left',
        transform: `translateX(${viewport.w}px) rotate(90deg)`,
        zIndex: 30,
      }
    : undefined;

  return (
    <section
      style={rotatedLandscapeStyle}
      className={`${isPortrait ? '' : 'relative h-full w-full'} flex flex-col overflow-hidden bg-[#0B1020] select-none`}
    >
      {/* Zone 1: Top HUD Strip */}
      {ui && (
        <header className="z-20 flex shrink-0 items-center justify-between gap-2 border-b border-slate-800/90 bg-[#080D1B]/95 px-2.5 py-1.5 backdrop-blur-sm md:px-4 md:py-2">
          {/* Left: Exit + Player 1 HUD */}
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={onExitToMenu}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900/90 text-slate-200 transition-colors hover:bg-slate-800 hover:text-white"
              aria-label="Sair para o menu"
              title="Voltar ao menu"
            >
              <LogOut className="h-4 w-4" />
            </button>

            <TeamHud ui={ui} team={0} />
          </div>

          {/* Center: Round, Utilities & Wind */}
          <div className="flex shrink-0 flex-col items-center gap-0.5 px-1">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => engineRef.current?.centerCameraOnActive()}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/75 bg-slate-900/85 text-slate-300 transition-colors hover:text-white"
                title="Centralizar câmera (C)"
                aria-label="Centralizar câmera"
              >
                <Crosshair className="h-3.5 w-3.5" />
              </button>
              <div className="font-display font-mono-num px-1 text-xl font-black italic leading-none tracking-tight text-amber-400 drop-shadow-[0_2px_0_rgba(90,26,0,0.9)] md:text-2xl">
                {ui.round}/{ui.maxRounds}
              </div>
              <button
                type="button"
                onClick={toggleMute}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/75 bg-slate-900/85 text-slate-300 transition-colors hover:text-white"
                title={muted ? 'Ativar áudio' : 'Silenciar áudio'}
                aria-label={muted ? 'Ativar áudio' : 'Silenciar áudio'}
              >
                {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/75 bg-slate-900/85 text-slate-300 transition-colors hover:text-white"
                title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia horizontal'}
                aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia horizontal'}
              >
                {fullscreen ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <div className="whitespace-nowrap rounded bg-slate-900/80 px-2.5 py-0.5 text-[10.5px] font-medium text-slate-200">
              <span className="font-semibold text-amber-300">
                {ui.fighters[ui.turnIndex].name.split(' ')[0]}
              </span>
              <span aria-hidden="true" className="mx-1.5 text-slate-500">·</span>
              <span className="font-mono-num">{ui.timerSec}s</span>
              <span aria-hidden="true" className="mx-1.5 text-slate-500">·</span>
              <span className="font-mono-num">{windDisplay}</span>
            </div>
          </div>

          {/* Right: Player 2 / Enemy HUD */}
          <TeamHud ui={ui} team={1} />
        </header>
      )}

      {/* Zone 2: Unobstructed Center Battlefield Arena */}
      <div className="relative min-h-0 w-full flex-1 overflow-hidden">
        <canvas ref={canvasRef} className="block h-full w-full touch-none" />

        {/* Sky-Level Combo Banner (Top-Left Sky, clear of sprites) */}
        {ui?.comboBanner && (
          <div
            key={ui.comboBanner.key}
            className="animate-slide-in pointer-events-none absolute left-2.5 top-2 z-20 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-[#180D06]/85 px-2.5 py-1 shadow-lg backdrop-blur-sm md:left-4 md:top-3"
          >
            <span className="text-sm font-black text-amber-400">▼</span>
            <span className="text-[11px] font-extrabold tracking-wide text-amber-300">
              {ui.comboBanner.stateLabel}
            </span>
            <span className="rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-semibold text-white">
              {ui.comboBanner.skillName}
            </span>
            <span className="font-display text-base font-black italic text-yellow-300 md:text-lg">
              {ui.comboBanner.comboCount} COMBO
            </span>
          </div>
        )}

        {/* Sky-Level HITS Counter (Top-Right Sky, clear of enemy sprite) */}
        {ui?.hitsVisible && (
          <div
            key={ui.hitsKey}
            className="animate-hit-pop pointer-events-none absolute right-3 top-2 z-20 text-right md:right-5 md:top-3"
          >
            <div className="font-display font-mono-num text-4xl font-black italic leading-none text-amber-400 drop-shadow-[0_3px_0_rgba(96,32,0,0.95)] md:text-5xl">
              {ui.hits}
            </div>
            <div className="text-[10px] font-extrabold tracking-widest text-sky-300">HITS</div>
          </div>
        )}
      </div>

      {/* Zone 3: Dedicated Bottom Command & Ôgi Card Dock */}
      {ui && (
        <footer className="z-20 flex shrink-0 items-center justify-between gap-2.5 border-t border-slate-800/95 bg-[#080D1B] px-2.5 py-1.5 md:px-4 md:py-2">
          {/* Left: Turn Queue + Movement Controls */}
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="hidden items-center gap-1 pr-1 md:flex" aria-label="Ordem de turnos">
              {ui.turnQueue.map((idx, j) => {
                const f = ui.fighters[idx];
                const isCur = j === 0;
                return (
                  <div
                    key={`${idx}-${j}`}
                    className={`rounded-full bg-slate-900 bg-cover bg-top ${
                      isCur
                        ? 'h-8 w-8 border-2 border-white shadow-[0_0_8px_rgba(245,158,11,0.75)]'
                        : 'h-6 w-6 border border-amber-700/70 opacity-75'
                    }`}
                    style={f.faceUrl ? { backgroundImage: `url(${f.faceUrl})` } : undefined}
                  />
                );
              })}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!canPlayerAct}
                onPointerDown={() => engineRef.current?.setMoveDirection(-1)}
                onPointerUp={() => engineRef.current?.setMoveDirection(0)}
                onPointerLeave={() => engineRef.current?.setMoveDirection(0)}
                onPointerCancel={() => engineRef.current?.setMoveDirection(0)}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-600/80 bg-[#0D1326] text-slate-100 active:scale-95 active:border-amber-400 disabled:opacity-35"
                aria-label="Mover para esquerda"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                disabled={!canPlayerAct}
                onPointerDown={() => engineRef.current?.setMoveDirection(1)}
                onPointerUp={() => engineRef.current?.setMoveDirection(0)}
                onPointerLeave={() => engineRef.current?.setMoveDirection(0)}
                onPointerCancel={() => engineRef.current?.setMoveDirection(0)}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-600/80 bg-[#0D1326] text-slate-100 active:scale-95 active:border-amber-400 disabled:opacity-35"
                aria-label="Mover para direita"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            <div className="flex w-14 flex-col gap-1 sm:w-20">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                Movimento
              </span>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-900">
                <div
                  className="h-full bg-amber-400 transition-all duration-100"
                  style={{ width: `${Math.round(ui.moveRemainingRatio * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Center: Contextual Single-Line Status */}
          <div className="hidden min-w-0 flex-1 items-center justify-center px-2 text-center lg:flex">
            <p className="truncate text-[11px] text-slate-300">
              {ui.phase === 'aim' && canPlayerAct
                ? 'Arraste a partir do ninja para mirar e solte · Arraste o mapa para mover · Roda/pinça para zoom'
                : ui.phase === 'ai'
                  ? 'Turno do oponente em andamento...'
                  : 'Técnica em execução...'}
            </p>
          </div>

          {/* Right: Skill Button + Always-Visible Horizontal Ôgi Card */}
          {activeFighter && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {activeFighter.combat.hasDistinctSkill && (
                <button
                  type="button"
                  disabled={!canPlayerAct || !skillReady}
                  onClick={() => engineRef.current?.selectAction('skill')}
                  className={`flex h-[54px] min-w-[88px] max-w-[136px] flex-col items-center justify-center rounded-lg border px-2.5 py-1 text-center transition-all duration-150 sm:h-[58px] ${
                    skillArmed
                      ? 'border-sky-300 bg-sky-500/30 text-white shadow-[0_0_16px_rgba(56,189,248,0.55)]'
                      : skillReady && canPlayerAct
                        ? 'border-sky-500/60 bg-[#0F1834] text-sky-200 hover:bg-sky-500/20'
                        : 'border-slate-800 bg-slate-900/80 text-slate-500 opacity-65'
                  }`}
                >
                  <div className="flex items-center gap-1 text-[11px] font-bold">
                    <Sparkles className="h-3 w-3 shrink-0" />
                    <span>Jutsu</span>
                    <span className="font-mono-num text-[9px] text-sky-300">
                      {skillArmed ? 'ATIVO' : `${skillCost * 10}`}
                    </span>
                  </div>
                  <div className="w-full truncate text-[9.5px] text-slate-300">
                    {activeFighter.combat.skill.name}
                  </div>
                </button>
              )}

              {/* Horizontal Ôgi Card (Never overlaps enemy character) */}
              <button
                type="button"
                disabled={!canPlayerAct || !ultReady}
                onClick={() => engineRef.current?.selectAction('ultimate')}
                className={`relative h-[54px] w-[206px] overflow-hidden rounded-xl p-[2.5px] text-left transition-transform duration-150 sm:h-[58px] sm:w-[244px] ${
                  ultArmed
                    ? '-translate-y-1 scale-[1.03] shadow-[0_0_20px_rgba(245,158,11,0.75)]'
                    : ultReady && canPlayerAct
                      ? 'card-shimmer cursor-pointer shadow-lg shadow-amber-950/50'
                      : 'grayscale-[0.7] brightness-80'
                }`}
                style={{
                  background:
                    'linear-gradient(135deg, #E8C866 0%, #7A5A1A 40%, #F4E29A 60%, #6B4A12 100%)',
                }}
              >
                <div className="flex h-full w-full items-stretch gap-2 rounded-[9px] bg-gradient-to-r from-[#1A1640] to-[#0D0A22] p-1">
                  <div
                    className="relative h-full w-11 shrink-0 rounded border border-amber-500/60 bg-slate-950 bg-cover bg-top sm:w-12"
                    style={
                      activeFighter.artUrl || activeFighter.faceUrl
                        ? {
                            backgroundImage: `url(${activeFighter.artUrl || activeFighter.faceUrl})`,
                          }
                        : undefined
                    }
                  >
                    {activeFighter.icoUrl && (
                      <img
                        src={activeFighter.icoUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border border-amber-300 bg-slate-900 object-cover"
                      />
                    )}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5 pr-0.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-[10px] font-extrabold leading-tight text-white">
                        {activeFighter.combat.ultimate.name}
                      </span>
                      <span className="shrink-0 text-[8.5px] font-bold text-amber-300">
                        {ultArmed ? 'ATIVO' : ultReady && canPlayerAct ? 'PRONTO' : 'ÔGI'}
                      </span>
                    </div>

                    <div className="truncate text-[8.5px] font-semibold leading-tight text-slate-200">
                      Dano ×2 · {CHASE_STATE_LABELS[activeFighter.combat.ultimate.causesState]}
                      {activeFighter.combat.ultimate.statusEffects.length > 0
                        ? ` · ${activeFighter.combat.ultimate.statusEffects[0].label}`
                        : ''}
                    </div>

                    <div className="relative h-2.5 w-full overflow-hidden rounded-full border border-slate-700 bg-[#0A0E22]">
                      <div
                        className="h-full bg-gradient-to-r from-sky-600 to-sky-300 transition-all duration-150"
                        style={{ width: `${activeFighter.chakra}%` }}
                      />
                      <span className="font-mono-num absolute inset-0 text-center text-[7.5px] font-bold leading-[10px] text-white drop-shadow">
                        {activeFighter.chakra * 10}/1000
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            </div>
          )}
        </footer>
      )}

      {/* Ôgi Cut-In Overlay & MP4 Video */}
      {ui?.cutIn?.active && (
        <div
          onClick={() => engineRef.current?.finishCutInVideo()}
          className="absolute inset-0 z-40 flex cursor-pointer items-center justify-center bg-black/80"
        >
          {!ui.cutIn.showVideo ? (
            <div className="animate-slide-in flex w-full max-w-xl items-center gap-4 bg-gradient-to-r from-amber-500 via-[#381808] to-transparent px-6 py-4">
              {ui.cutIn.icoUrl && (
                <img
                  src={ui.cutIn.icoUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-16 w-16 rounded-full border-2 border-amber-300 object-cover"
                />
              )}
              <div>
                <div className="text-xs font-extrabold tracking-widest text-amber-300">
                  TÉCNICA ÔGI · {ui.cutIn.ninjaName}
                </div>
                <div className="font-display text-3xl font-black uppercase text-white">
                  {ui.cutIn.skillName}
                </div>
              </div>
            </div>
          ) : (
            <video
              ref={videoRef}
              playsInline
              onEnded={() => engineRef.current?.finishCutInVideo()}
              onError={() => engineRef.current?.finishCutInVideo()}
              className="h-full w-full bg-black object-contain"
            />
          )}
          <div className="absolute bottom-4 right-4 text-xs text-slate-400">
            Toque para pular
          </div>
        </div>
      )}

      {/* Game Over / Victory Modal */}
      {ui?.phase === 'over' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-[#121931] p-5 text-center shadow-2xl">
            <p className="text-xs font-semibold text-amber-300">Fim da Batalha</p>
            <h2 className="font-display mt-1 text-3xl font-black uppercase text-white md:text-4xl">
              {ui.winnerTeam === -1
                ? 'Empate!'
                : ui.teamSize === 1
                  ? `${ui.fighters[ui.winnerTeam ?? 0].name.split(' ')[0]} Venceu!`
                  : mode === 'ia'
                    ? ui.winnerTeam === 0
                      ? 'Seu time venceu!'
                      : 'A IA venceu!'
                    : `Time ${(ui.winnerTeam ?? 0) + 1} venceu!`}
            </h2>

            <div className="mt-3 grid grid-cols-2 gap-3 text-left text-xs">
              {([0, 1] as const).map((team) => (
                <div key={team} className="min-w-0 space-y-2">
                  {ui.fighters
                    .filter((f) => f.team === team)
                    .map((f) => (
                      <div key={f.index} className="rounded-lg bg-slate-900/80 p-2">
                        <div className="truncate font-semibold text-slate-100">
                          {f.name.split(' ')[0]}
                          {f.hp <= 0 && <span className="ml-1 text-rose-400">(caiu)</span>}
                        </div>
                        <div className="font-mono-num text-slate-400">
                          Dano <span className="text-amber-300">{f.totalDamage}</span>
                          <span aria-hidden="true" className="mx-1 text-slate-600">·</span>
                          Maior <span className="text-slate-200">{f.biggestHit}</span>
                        </div>
                      </div>
                    ))}
                </div>
              ))}
            </div>

            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={onRematch}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-amber-400"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Jogar Novamente</span>
              </button>
              <button
                type="button"
                onClick={onChangeNinjas}
                className="min-h-[44px] flex-1 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-700"
              >
                Trocar Ninjas
              </button>
            </div>
            <button
              type="button"
              onClick={onExitToMenu}
              className="mt-2 w-full py-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-white"
            >
              Voltar ao Menu Principal
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

const TeamHud: React.FC<{ ui: BattleUiSnapshot; team: 0 | 1 }> = ({ ui, team }) => {
  const focused = ui.fighters[ui.focus[team]];
  const isRight = team === 1;
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${isRight ? 'items-end' : 'items-start'}`}>
      <FighterTopBar
        fighter={focused}
        active={ui.turnIndex === focused.index}
        align={isRight ? 'right' : 'left'}
      />
      {ui.teamSize > 1 && (
        <div className={`flex gap-1.5 ${isRight ? 'flex-row-reverse' : ''}`}>
          {ui.fighters
            .filter((f) => f.team === team)
            .map((f) => (
              <div
                key={f.index}
                className={`w-11 ${f.hp <= 0 ? 'opacity-40 grayscale' : ''}`}
                title={`${f.name} · ${f.hp}/${f.maxHp}`}
              >
                <div
                  className={`h-6 w-11 rounded border bg-slate-900 bg-cover bg-top ${
                    f.index === ui.turnIndex
                      ? 'border-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.75)]'
                      : isRight
                        ? 'border-rose-500/60'
                        : 'border-sky-500/60'
                  }`}
                  style={f.faceUrl ? { backgroundImage: `url(${f.faceUrl})` } : undefined}
                />
                <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full ${isRight ? 'bg-rose-400' : 'bg-emerald-400'}`}
                    style={{ width: `${(f.hp / Math.max(1, f.maxHp)) * 100}%` }}
                  />
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

interface FighterTopBarProps {
  fighter: BattleUiSnapshot['fighters'][number];
  active: boolean;
  align: 'left' | 'right';
}

const FighterTopBar: React.FC<FighterTopBarProps> = ({ fighter, active, align }) => {
  const hpPct = Math.max(0, Math.min(100, (fighter.hp / Math.max(1, fighter.maxHp)) * 100));
  const isRight = align === 'right';

  return (
    <div className={`flex w-[155px] items-center gap-2 sm:w-[210px] md:w-[238px] ${isRight ? 'flex-row-reverse' : ''}`}>
      <div
        className={`h-9 w-9 shrink-0 rounded-full border-2 bg-slate-900 bg-cover bg-top sm:h-10 sm:w-10 ${
          active
            ? 'border-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.75)]'
            : 'border-amber-800/70'
        }`}
        style={fighter.faceUrl ? { backgroundImage: `url(${fighter.faceUrl})` } : undefined}
      />
      <div className="min-w-0 flex-1">
        <div
          className={`flex items-baseline justify-between gap-1 text-[11px] font-bold leading-tight ${
            isRight ? 'flex-row-reverse' : ''
          }`}
        >
          <span className="truncate text-white">{fighter.name.split(' ')[0]}</span>
          <span className="font-mono-num shrink-0 text-[9.5px] font-semibold text-amber-300">
            Dano {fighter.totalDamage}
          </span>
        </div>

        {/* HP Bar */}
        <div className="relative mt-0.5 h-3 overflow-hidden rounded-full border border-amber-700/70 bg-[#0A0E22]">
          <div
            className="h-full bg-gradient-to-b from-emerald-400 to-emerald-600 transition-all duration-150"
            style={{ width: `${hpPct}%` }}
          />
          <span className="font-mono-num absolute inset-0 text-center text-[8.5px] font-bold leading-3 text-white drop-shadow">
            {fighter.hp}/{fighter.maxHp}
          </span>
        </div>

        {/* Chakra Bar */}
        <div className="relative mt-0.5 h-2.5 overflow-hidden rounded-full border border-slate-700 bg-[#0A0E22]">
          <div
            className="h-full bg-gradient-to-r from-sky-600 to-sky-300 transition-all duration-150"
            style={{ width: `${fighter.chakra}%` }}
          />
          <span className="font-mono-num absolute inset-0 text-center text-[7.5px] font-bold leading-[10px] text-white drop-shadow">
            {fighter.chakra * 10}/1000
          </span>
        </div>
      </div>
    </div>
  );
};
