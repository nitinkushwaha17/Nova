import type { CapacitorConfig } from '@capacitor/cli';

// The Android shell loads the deployed GitHub Pages site, so web updates reach the app without a new APK.
// Set NOVA_APP_URL to another address, or to an empty string to bundle dist/ into the APK instead.
const appUrl = process.env.NOVA_APP_URL ?? 'https://nitinkushwaha17.github.io/Nova/';

const config: CapacitorConfig = {
  appId: 'in.nova.finance',
  appName: 'Nova',
  webDir: 'dist',
  backgroundColor: '#090c15',
  ...(appUrl ? { server: { url: appUrl, cleartext: false } } : {}),
};

export default config;