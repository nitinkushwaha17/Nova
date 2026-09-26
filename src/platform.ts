import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

/** True inside the Android/iOS app shell, false in a normal browser. */
export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform() as 'web' | 'android' | 'ios';

/** Native-only setup: status bar colours and the Android back button. */
export function initNative() {
  if (!isNative) return;
  document.documentElement.classList.add('native');
  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) history.back();
    else void App.exitApp();
  });
}

/** Light status-bar icons on the dark theme, dark icons on the light theme. */
export function setStatusBarTheme(theme: 'dark' | 'light') {
  if (!isNative) return;
  void StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light }).catch(() => {});
}
