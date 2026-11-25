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
} from './types/shinobi';

export const App: React.FC = () => {
  const previewPoolRef = useRef<ObjectUrlPool>(new ObjectUrlPool());
  const rosterRef = useRef<NinjaRosterEntry[]>([]);
  const activeRuntimesRef = useRef<[LoadedNinjaRuntime, LoadedNinjaRuntime] | null>(null);

  const [screen, setScreen] = useState<GameScreen>('menu');
  const [mode, setMode] = useState<GameMode>('ia');
  const [roster, setRoster] = useState<NinjaRosterEntry[]>([]);
  const [detectedRepoUrl, setDetectedRepoUrl] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const [loadingMatch, setLoadingMatch] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [matchPair, setMatchPair] = useState<[NinjaRosterEntry, NinjaRosterEntry] | null>(null);
  const [matchRuntimes, setMatchRuntimes] = useState<[LoadedNinjaRuntime, LoadedNinjaRuntime] | null>(
    null
  );
  const [matchKey, setMatchKey] = useState(0);

  const disposeActiveMatch = useCallback(() => {
    if (activeRuntimesRef.current) {
      activeRuntimesRef.current[0].dispose();
      activeRuntimesRef.current[1].dispose();
      activeRuntimesRef.current = null;
    }
    setMatchRuntimes(null);
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

  const handleConfirmPair = async (pair: [NinjaRosterEntry, NinjaRosterEntry]) => {
    setLoadingMatch(true);
    setLoadError(null);
    disposeActiveMatch();
    try {
      const [r0, r1] = await Promise.all([
        loadNinjaForBattle(pair[0]),
        loadNinjaForBattle(pair[1]),
      ]);
      activeRuntimesRef.current = [r0, r1];
      setMatchPair(pair);
      setMatchRuntimes([r0, r1]);
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
    if (matchPair && matchRuntimes) {
      setMatchKey((k) => k + 1);
    }
  };

  const handleChangeNinjas = () => {
    disposeActiveMatch();
    setScreen('select');
  };

  const handleExitToMenu = () => {
    disposeActiveMatch();
    setScreen('menu');
  };

  return (
    <main className="h-full w-full overflow-hidden bg-[#0B1020]">
      {screen === 'menu' && (
        <MenuScreen
          roster={roster}
          onStartMode={handleStartMode}
          onOpenImport={() => setImportOpen(true)}
        />
      )}

      {screen === 'select' && (
        <SelectScreen
          roster={roster}
          mode={mode}
          loadingMatch={loadingMatch}
          loadError={loadError}
          onBackToMenu={() => setScreen('menu')}
          onOpenImport={() => setImportOpen(true)}
          onConfirmPair={handleConfirmPair}
        />
      )}

      {screen === 'battle' && matchRuntimes && (
        <BattleScreen
          key={matchKey}
          runtimes={matchRuntimes}
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
