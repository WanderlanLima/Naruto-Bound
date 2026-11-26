import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BattleScreen } from './components/BattleScreen';
import { ImportModal } from './components/ImportModal';
import { MenuScreen } from './components/MenuScreen';
import { SelectScreen } from './components/SelectScreen';
import { loadFullRoster, loadNinjaForBattle } from './engine/ninjaLoader';
import {
  getSavedRepoBaseUrl,
  ObjectUrlPool,
  revokeRosterPreviewUrls,
} from './storage/ninjaDb';
import type {
  GameMode,
  GameScreen,
  LoadedNinjaRuntime,
  NinjaRosterEntry,
  TeamSize,
} from './types/shinobi';
import {
  enterBattleFullscreenLandscape,
  exitBattleFullscreenLandscape,
} from './utils/viewportOrientation';

type MatchRuntimes = [LoadedNinjaRuntime[], LoadedNinjaRuntime[]];

export const App: React.FC = () => {
  const previewPoolRef = useRef<ObjectUrlPool>(new ObjectUrlPool());
  const rosterRef = useRef<NinjaRosterEntry[]>([]);
  const activeRuntimesRef = useRef<LoadedNinjaRuntime[]>([]);

  const [screen, setScreen] = useState<GameScreen>('menu');
  const [mode, setMode] = useState<GameMode>('ia');
  const [roster, setRoster] = useState<NinjaRosterEntry[]>([]);
  const [detectedRepoUrl, setDetectedRepoUrl] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const [loadingMatch, setLoadingMatch] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamSize, setTeamSize] = useState<TeamSize>(1);
  const [matchTeams, setMatchTeams] = useState<MatchRuntimes | null>(null);
  const [matchKey, setMatchKey] = useState(0);

  const disposeActiveMatch = useCallback(() => {
    activeRuntimesRef.current.forEach((r) => r.dispose());
    activeRuntimesRef.current = [];
    setMatchTeams(null);
  }, []);

  const refreshRoster = useCallback(async (overrideRepoUrl?: string) => {
    const prevRoster = rosterRef.current;
    const repoUrl = overrideRepoUrl !== undefined ? overrideRepoUrl : getSavedRepoBaseUrl();
    const { roster: nextRoster, detectedRepoUrl: detected } = await loadFullRoster(
      previewPoolRef.current,
      repoUrl
    );
    rosterRef.current = nextRoster;
    setRoster(nextRoster);
    setDetectedRepoUrl(detected);
    // Revoke previous preview URLs cleanly after React switches to the new set
    window.setTimeout(() => {
      revokeRosterPreviewUrls(prevRoster, previewPoolRef.current);
    }, 300);
  }, []);

  useEffect(() => {
    refreshRoster();
    const pool = previewPoolRef.current;
    return () => {
      disposeActiveMatch();
      pool.revokeAll();
    };
  }, [refreshRoster, disposeActiveMatch]);

  const handleStartMode = (selectedMode: GameMode) => {
    setMode(selectedMode);
    setLoadError(null);
    setScreen('select');
  };

  const handleConfirmTeams = async (teams: [NinjaRosterEntry[], NinjaRosterEntry[]]) => {
    void enterBattleFullscreenLandscape();
    setLoadingMatch(true);
    setLoadError(null);
    disposeActiveMatch();
    try {
      // Repeated ninjas share one runtime, so each package is only loaded once
      const unique = new Map<string, NinjaRosterEntry>();
      for (const entry of [...teams[0], ...teams[1]]) unique.set(entry.id, entry);
      const results = await Promise.allSettled(Array.from(unique.values(), loadNinjaForBattle));
      const loaded = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      const failed = results.find((r) => r.status === 'rejected');
      if (failed) {
        loaded.forEach((r) => r.dispose());
        throw failed.reason;
      }
      const byId = new Map(loaded.map((r) => [r.entry.id, r]));
      const toRuntimes = (team: NinjaRosterEntry[]) => team.map((n) => byId.get(n.id)!);

      activeRuntimesRef.current = loaded;
      setMatchTeams([toRuntimes(teams[0]), toRuntimes(teams[1])]);
      setMatchKey((k) => k + 1);
      setScreen('battle');
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'Erro ao carregar os assets dos ninjas selecionados.'
      );
    } finally {
      setLoadingMatch(false);
    }
  };

  const handleRematch = () => {
    if (matchTeams) {
      void enterBattleFullscreenLandscape();
      setMatchKey((k) => k + 1);
    }
  };

  const handleChangeNinjas = () => {
    disposeActiveMatch();
    void exitBattleFullscreenLandscape();
    setScreen('select');
  };

  const handleExitToMenu = () => {
    disposeActiveMatch();
    void exitBattleFullscreenLandscape();
    setScreen('menu');
  };

  return (
    <main className="h-full w-full overflow-hidden bg-[#0B1020]">
      {screen === 'menu' && (
        <MenuScreen
          roster={roster}
          teamSize={teamSize}
          onChangeTeamSize={setTeamSize}
          onStartMode={handleStartMode}
          onOpenImport={() => setImportOpen(true)}
        />
      )}

      {screen === 'select' && (
        <SelectScreen
          roster={roster}
          mode={mode}
          teamSize={teamSize}
          loadingMatch={loadingMatch}
          loadError={loadError}
          onBackToMenu={() => setScreen('menu')}
          onOpenImport={() => setImportOpen(true)}
          onConfirmTeams={handleConfirmTeams}
        />
      )}

      {screen === 'battle' && matchTeams && (
        <BattleScreen
          key={matchKey}
          teams={matchTeams}
          mode={mode}
          onRematch={handleRematch}
          onChangeNinjas={handleChangeNinjas}
          onExitToMenu={handleExitToMenu}
        />
      )}

      <ImportModal
        open={importOpen}
        roster={roster}
        detectedRepoUrl={detectedRepoUrl}
        onClose={() => setImportOpen(false)}
        onRosterChanged={refreshRoster}
      />
    </main>
  );
};

export default App;
