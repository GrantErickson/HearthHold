import { Capacitor } from '@capacitor/core';

/**
 * Glue for the iPhone, iPad and Android app (Capacitor). In a browser it does nothing.
 *  - full screen (no status bar) and the screen stays on while you play,
 *  - going to the background pauses the game,
 *  - Android's back button: pause, resume, or leave from the main menu.
 */

export interface NativeHooks {
  /** Pause if a game is running. */
  pause(): void;
  /** Back button: true if the game handled it (paused or resumed). */
  back(): boolean;
}

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

export async function initNative(h: NativeHooks): Promise<void> {
  if (!isNativeApp()) return;
  document.documentElement.dataset.nativeApp = Capacitor.getPlatform();
  const [{ StatusBar }, { App }, { KeepAwake }] = await Promise.all([
    import('@capacitor/status-bar'),
    import('@capacitor/app'),
    import('@capacitor-community/keep-awake'),
  ]);
  try {
    await StatusBar.hide();
  } catch {
    /* not on this device */
  }
  try {
    await KeepAwake.keepAwake();
  } catch {
    /* the screen may dim: harmless */
  }
  await App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) h.pause();
  });
  await App.addListener('backButton', () => {
    if (!h.back()) void App.exitApp();
  });
}
