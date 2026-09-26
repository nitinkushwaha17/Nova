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

/** Status-bar icons that stay readable: follow the theme when the app draws behind the bars, else light on the dark window background */
export function setStatusBarTheme(theme: 'dark' | 'light') {
  if (!isNative) return;
  const apply = () => {
    // Capacitor reports a 0 inset when it pads the WebView below the bars instead (older WebViews)
    const edgeToEdge = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top') || '0') > 0;
    void StatusBar.setStyle({ style: theme === 'light' && edgeToEdge ? Style.Light : Style.Dark }).catch(() => {});
  };
  apply();
  // Insets are injected shortly after load
  setTimeout(apply, 1500);
}
