export async function enterBattleFullscreenLandscape(): Promise<void> {
  if (typeof document === 'undefined') return;
  const docEl = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
  };

  try {
    if (!document.fullscreenElement) {
      if (typeof docEl.requestFullscreen === 'function') {
        await docEl.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
      } else if (typeof docEl.webkitRequestFullscreen === 'function') {
        await docEl.webkitRequestFullscreen();
      }
    }
  } catch {
    // Fullscreen can be blocked by browser policy or iframe permissions; CSS landscape fallback handles it.
  }

  try {
    const orientation = window.screen?.orientation as
      | (ScreenOrientation & { lock?: (mode: string) => Promise<void> })
      | undefined;
    if (orientation && typeof orientation.lock === 'function') {
      await orientation.lock('landscape');
    }
  } catch {
    // Orientation lock is unsupported on desktop / iOS Safari or without fullscreen.
  }
}

export async function exitBattleFullscreenLandscape(): Promise<void> {
  if (typeof document === 'undefined') return;

  try {
    const orientation = window.screen?.orientation as
      | (ScreenOrientation & { unlock?: () => void })
      | undefined;
    if (orientation && typeof orientation.unlock === 'function') {
      orientation.unlock();
    }
  } catch {
    // Ignore unsupported unlock
  }

  try {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void>;
    };
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      await document.exitFullscreen();
    } else if (doc.webkitFullscreenElement && typeof doc.webkitExitFullscreen === 'function') {
      await doc.webkitExitFullscreen();
    }
  } catch {
    // Ignore exit errors
  }
}

export function isDocumentFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return Boolean(document.fullscreenElement || doc.webkitFullscreenElement);
}
