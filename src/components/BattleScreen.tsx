import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  LogOut,
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

interface BattleScreenProps {
  runtimes: [LoadedNinjaRuntime, LoadedNinjaRuntime];
  mode: GameMode;
  onRematch: () => void;
  onChangeNinjas: () => void;
  onExitToMenu: () => void;
}

export const BattleScreen: React.FC<BattleScreenProps> = ({
  runtimes,
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new ShinobiBattleEngine({
      canvas,
      runtimes,
      mode,
      onUiUpdate: (snap) => setUi(snap),
    });
    engineRef.current = engine;

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [runtimes, mode]);

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

  const activeFighter = ui ? ui.fighters[ui.turnIndex] : null;
  const canPlayerAct = Boolean(
    ui && ui.phase === 'aim' && !(mode === 'ia' && ui.turnIndex === 1)
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

  const turnQueue: Array<0 | 1> = ui
    ? [ui.turnIndex, (1 - ui.turnIndex) as 0 | 1, ui.turnIndex]
    : [0, 1, 0];

  return (
    <section className="relative h-full w-full overflow-hidden bg-[#0B1020] select-none">
      {/* Interactive Full-Viewport Battlefield Canvas */}
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none"
      />

      {/* Top Left Controls + Player 1 HUD */}
      {ui && (
        <>
          <div className="pointer-events-none fixed inset-x-0 top-0 z-20 flex items-start justify-between gap-2 px-3 pt-2.5 md:px-5 md:pt-3">
            {/* Left Side: Menu Exit + Fighter 0 HUD */}
            <div className="flex items-start gap-2.5">
              <button
                type="button"
                onClick={onExitToMenu}
                className="pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-700/80 bg-[#0D1326]/85 text-slate-200 transition-colors hover:bg-slate-800 hover:text-white"
                aria-label="Sair para o menu"
                title="Voltar ao menu"
              >
                <LogOut className="h-4 w-4" />
              </button>

              <FighterTopBar fighter={ui.fighters[0]} active={ui.turnIndex === 0} align="left" />
            </div>

            {/* Center: Round, Wind & Utility Buttons */}
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => engineRef.current?.centerCameraOnActive()}
                  className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/70 bg-[#0D1326]/80 text-slate-300 transition-colors hover:text-white"
                  title="Centralizar câmera (C)"
                  aria-label="Centralizar câmera"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                </button>
                <div className="font-display font-mono-num text-2xl font-black italic leading-none tracking-tight text-amber-400 drop-shadow-[0_2px_0_rgba(90,26,0,0.9)] md:text-3xl">
                  {ui.round}/{ui.maxRounds}
                </div>
                <button
                  type="button"
                  onClick={toggleMute}
                  className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/70 bg-[#0D1326]/80 text-slate-300 transition-colors hover:text-white"
                  title={muted ? 'Ativar áudio' : 'Silenciar áudio'}
                  aria-label={muted ? 'Ativar áudio' : 'Silenciar áudio'}
                >
                  {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                </button>
              </div>
              <div className="rounded-md bg-[#0B1020]/80 px-3 py-1 text-[11px] font-medium text-slate-200 backdrop-blur-sm">
                <span className="font-semibold text-amber-300">
                  {ui.fighters[ui.turnIndex].name.split(' ')[0]}
                </span>
                <span aria-hidden="true" className="mx-1.5 text-slate-500">·</span>
                <span className="font-mono-num">{ui.timerSec}s</span>
                <span aria-hidden="true" className="mx-1.5 text-slate-500">·</span>
                <span className="font-mono-num">{windDisplay}</span>
              </div>
            </div>

            {/* Right Side: Fighter 1 HUD */}
            <FighterTopBar fighter={ui.fighters[1]} active={ui.turnIndex === 1} align="right" />
          </div>

          {/* Left Turn Queue */}
          <div className="pointer-events-none fixed bottom-28 left-3 z-20 hidden flex-col items-center gap-1.5 sm:flex md:left-4">
            {turnQueue
              .slice()
              .reverse()
              .map((idx, j) => {
                const f = ui.fighters[idx];
                const isCur = j === 2;
                return (
                  <div
                    key={`${idx}-${j}`}
                    className={`rounded-full bg-slate-900 bg-cover bg-top ${
                      isCur
                        ? 'h-11 w-11 border-2 border-white shadow-[0_0_10px_rgba(245,158,11,0.75)]'
                        : 'h-8 w-8 border border-amber-700/70 opacity-75'
                    }`}
                    style={f.faceUrl ? { backgroundImage: `url(${f.faceUrl})` } : undefined}
                  />
                );
              })}
          </div>

          {/* Left Movement Controls */}
          <div className="fixed bottom-4 left-3 z-20 flex flex-col gap-1.5 md:bottom-5 md:left-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!canPlayerAct}
                onPointerDown={() => engineRef.current?.setMoveDirection(-1)}
                onPointerUp={() => engineRef.current?.setMoveDirection(0)}
                onPointerLeave={() => engineRef.current?.setMoveDirection(0)}
                onPointerCancel={() => engineRef.current?.setMoveDirection(0)}
                className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-600/80 bg-[#0D1326]/85 text-slate-100 active:scale-95 active:border-amber-400 disabled:opacity-35 md:h-13 md:w-13"
                aria-label="Mover para esquerda"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                disabled={!canPlayerAct}
                onPointerDown={() => engineRef.current?.setMoveDirection(1)}
                onPointerUp={() => engineRef.current?.setMoveDirection(0)}
                onPointerLeave={() => engineRef.current?.setMoveDirection(0)}
                onPointerCancel={() => engineRef.current?.setMoveDirection(0)}
                className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-600/80 bg-[#0D1326]/85 text-slate-100 active:scale-95 active:border-amber-400 disabled:opacity-35 md:h-13 md:w-13"
                aria-label="Mover para direita"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </div>
            {/* Movement budget bar */}
            <div className="h-1.5 w-26 overflow-hidden rounded-full bg-slate-900/90">
              <div
                className="h-full bg-amber-400 transition-all duration-100"
                style={{ width: `${Math.round(ui.moveRemainingRatio * 100)}%` }}
              />
            </div>
          </div>

          {/* Bottom Helper Hint (fades away once flying) */}
          {ui.phase === 'aim' && canPlayerAct && (
            <div className="pointer-events-none fixed bottom-3 left-1/2 z-10 hidden -translate-x-1/2 rounded-md bg-[#0B1020]/70 px-3 py-1 text-[11px] text-slate-300 lg:block">
              Arraste a partir do ninja para mirar e solte para disparar · Arraste o mapa para mover · Roda/pinça para zoom
            </div>
          )}

          {/* Right Bottom: Optional Skill Button + Iconic Ôgi Card */}
          {activeFighter && (
            <div className="fixed bottom-3 right-3 z-20 flex items-end gap-2.5 md:bottom-4 md:right-4">
              {activeFighter.combat.hasDistinctSkill && (
                <button
                  type="button"
                  disabled={!canPlayerAct || !skillReady}
                  onClick={() => engineRef.current?.selectAction('skill')}
                  className={`flex min-h-[52px] flex-col items-center justify-center rounded-xl border px-3 py-2 text-center transition-all duration-150 ${
                    skillArmed
                      ? 'border-sky-300 bg-sky-500/30 text-white shadow-[0_0_16px_rgba(56,189,248,0.55)]'
                      : skillReady && canPlayerAct
                        ? 'border-sky-500/60 bg-[#0F1834]/90 text-sky-200 hover:bg-sky-500/20'
                        : 'border-slate-800 bg-slate-900/75 text-slate-500 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-1 text-xs font-bold">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Jutsu</span>
                  </div>
                  <div className="max-w-[92px] truncate text-[10px] text-slate-300">
                    {activeFighter.combat.skill.name}
                  </div>
                  <div className="font-mono-num text-[9px] text-sky-300">
                    {skillArmed ? 'ATIVADO' : `${skillCost * 10} CK`}
                  </div>
                </button>
              )}

              {/* Ôgi Card */}
              <button
                type="button"
                disabled={!canPlayerAct || !ultReady}
                onClick={() => engineRef.current?.selectAction('ultimate')}
                className={`relative h-[148px] w-[108px] overflow-hidden rounded-xl p-[3px] text-left transition-transform duration-150 ${
                  ultArmed
                    ? '-translate-y-2.5 scale-105 shadow-[0_0_24px_rgba(245,158,11,0.75)]'
                    : ultReady && canPlayerAct
                      ? 'animate-card-float card-shimmer cursor-pointer shadow-xl'
                      : 'grayscale-[0.75] brightness-75'
                }`}
                style={{
                  background:
                    'linear-gradient(135deg, #E8C866 0%, #7A5A1A 40%, #F4E29A 60%, #6B4A12 100%)',
                }}
              >
                <div className="flex h-full w-full flex-col rounded-[9px] bg-gradient-to-b from-[#1A1640] to-[#0D0A22] p-1">
                  <div className="flex h-6 items-center justify-center rounded border border-amber-500/60 bg-[#2C2058] px-1 text-center text-[8.5px] font-extrabold leading-tight text-white">
                    <span className="line-clamp-2">{activeFighter.combat.ultimate.name}</span>
                  </div>

                  <div
                    className="relative my-1 h-[56px] w-full border border-amber-500/60 bg-slate-950 bg-cover bg-top"
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
                        className="absolute -bottom-1.5 -left-1 h-6 w-6 rounded-full border-2 border-amber-300 bg-slate-900 object-cover"
                      />
                    )}
                  </div>

                  <div className="pl-3 text-center text-[7.5px] font-bold text-amber-300">
                    Ôgi · {activeFighter.natureLabel}
                  </div>

                  <div className="my-0.5 flex-1 overflow-hidden rounded bg-black/40 px-1 py-0.5 text-[8px] font-semibold leading-tight text-slate-200">
                    Dano ×2 · {CHASE_STATE_LABELS[activeFighter.combat.ultimate.causesState]}
                    {activeFighter.combat.ultimate.statusEffects.length > 0
                      ? ` · ${activeFighter.combat.ultimate.statusEffects[0].label}`
                      : ''}
                    {ultReady && canPlayerAct && (
                      <div className="mt-0.5 font-extrabold text-amber-300">
                        {ultArmed ? 'ATIVADO' : 'Toque p/ ativar'}
                      </div>
                    )}
                  </div>

                  <div className="relative h-3 overflow-hidden rounded-full border border-slate-700 bg-[#0A0E22]">
                    <div
                      className="h-full bg-gradient-to-r from-sky-600 to-sky-300 transition-all duration-150"
                      style={{ width: `${activeFighter.chakra}%` }}
                    />
                    <span className="font-mono-num absolute inset-0 text-center text-[7.5px] font-bold leading-3 text-white drop-shadow">
                      {activeFighter.chakra * 10}/1000
                    </span>
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* HITS Counter */}
          {ui.hitsVisible && (
            <div
              key={ui.hitsKey}
              className="animate-hit-pop pointer-events-none fixed right-4 top-1/3 z-20 text-right md:right-6"
            >
              <div className="font-display font-mono-num text-5xl font-black italic leading-none text-amber-400 drop-shadow-[0_3px_0_rgba(96,32,0,0.95)] md:text-6xl">
                {ui.hits}
              </div>
              <div className="text-xs font-extrabold tracking-widest text-sky-300">HITS</div>
            </div>
          )}

          {/* Dynamic Chase Combo Banner */}
          {ui.comboBanner && (
            <div
              key={ui.comboBanner.key}
              className="animate-slide-in pointer-events-none fixed bottom-24 left-0 z-20 flex items-center gap-2.5 bg-gradient-to-r from-[#2D1708]/95 via-[#140B06]/90 to-transparent py-1.5 pl-3 pr-8"
            >
              <span className="text-base font-black text-amber-400">▼</span>
              <span className="text-[11px] font-extrabold tracking-wide text-amber-300">
                {ui.comboBanner.stateLabel}
              </span>
              <span className="rounded bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
                {ui.comboBanner.skillName}
              </span>
              <span className="font-display text-lg font-black italic text-yellow-300">
                {ui.comboBanner.comboCount} COMBO
              </span>
            </div>
          )}

          {/* Ôgi Cut-In Overlay & MP4 Video */}
          {ui.cutIn?.active && (
            <div
              onClick={() => engineRef.current?.finishCutInVideo()}
              className="fixed inset-0 z-40 flex cursor-pointer items-center justify-center bg-black/80"
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
              <div className="fixed bottom-4 right-4 text-xs text-slate-400">
                Toque para pular
              </div>
            </div>
          )}

          {/* Game Over / Victory Modal */}
          {ui.phase === 'over' && (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#121931] p-6 text-center shadow-2xl">
                <p className="text-xs font-semibold text-amber-300">Fim da Batalha</p>
                <h2 className="font-display mt-1 text-4xl font-black uppercase text-white">
                  {ui.winnerIndex === -1
                    ? 'Empate!'
                    : `${ui.fighters[ui.winnerIndex ?? 0].name.split(' ')[0]} Venceu!`}
                </h2>

                <div className="mt-4 grid grid-cols-2 gap-3 text-left text-xs">
                  {ui.fighters.map((f, idx) => (
                    <div key={f.id + idx} className="rounded-lg bg-slate-900/80 p-3">
                      <div className="truncate font-semibold text-slate-100">
                        {f.name.split(' ')[0]}
                      </div>
                      <div className="font-mono-num mt-1 text-slate-400">
                        Dano total: <span className="text-amber-300">{f.totalDamage}</span>
                      </div>
                      <div className="font-mono-num text-slate-400">
                        Maior golpe: <span className="text-slate-200">{f.biggestHit}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
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
                  className="mt-2.5 w-full py-2 text-xs font-medium text-slate-400 transition-colors hover:text-white"
                >
                  Voltar ao Menu Principal
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};

interface FighterTopBarProps {
  fighter: BattleUiSnapshot['fighters'][0];
  active: boolean;
  align: 'left' | 'right';
}

const FighterTopBar: React.FC<FighterTopBarProps> = ({ fighter, active, align }) => {
  const hpPct = Math.max(0, Math.min(100, (fighter.hp / Math.max(1, fighter.maxHp)) * 100));
  const isRight = align === 'right';

  return (
    <div className={`flex flex-col gap-1 ${isRight ? 'items-end' : 'items-start'}`}>
      <div className={`flex w-[180px] items-center gap-2 sm:w-[225px] ${isRight ? 'flex-row-reverse' : ''}`}>
        <div
          className={`h-11 w-11 shrink-0 rounded-full border-2 bg-slate-900 bg-cover bg-top ${
            active
              ? 'border-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.75)]'
              : 'border-amber-800/70'
          }`}
          style={fighter.faceUrl ? { backgroundImage: `url(${fighter.faceUrl})` } : undefined}
        />
        <div className="min-w-0 flex-1">
          <div
            className={`truncate text-xs font-bold text-white drop-shadow ${
              isRight ? 'text-right' : 'text-left'
            }`}
          >
            {fighter.name.split(' ')[0]}
          </div>

          {/* HP Bar */}
          <div className="relative mt-0.5 h-3 overflow-hidden rounded-full border border-amber-700/70 bg-[#0A0E22]">
            <div
              className="h-full bg-gradient-to-b from-emerald-400 to-emerald-600 transition-all duration-150"
              style={{ width: `${hpPct}%` }}
            />
            <span className="font-mono-num absolute inset-0 text-center text-[9px] font-bold leading-3 text-white drop-shadow">
              {fighter.hp}/{fighter.maxHp}
            </span>
          </div>

          {/* Chakra Bar */}
          <div className="relative mt-1 h-2.5 overflow-hidden rounded-full border border-slate-700 bg-[#0A0E22]">
            <div
              className="h-full bg-gradient-to-r from-sky-600 to-sky-300 transition-all duration-150"
              style={{ width: `${fighter.chakra}%` }}
            />
            <span className="font-mono-num absolute inset-0 text-center text-[8px] font-bold leading-[10px] text-white drop-shadow">
              {fighter.chakra * 10}/1000
            </span>
          </div>
        </div>
      </div>

      {/* Damage summary */}
      <div
        className={`font-mono-num text-[10px] font-semibold text-slate-200 drop-shadow ${
          isRight ? 'text-right' : 'text-left'
        }`}
      >
        <span className="text-amber-300">Dano {fighter.totalDamage}</span>
        <span aria-hidden="true" className="mx-1 text-slate-500">·</span>
        <span className="text-slate-300">Máx {fighter.biggestHit}</span>
      </div>
    </div>
  );
};
