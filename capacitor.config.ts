import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.nova.finance',
  appName: 'Nova',
  webDir: 'dist',
  backgroundColor: '#090c15',
  android: {
    // Statement files and Drive data stay inside the app; no remote debugging in release builds
    webContentsDebuggingEnabled: false,
  },
};

export default config;
