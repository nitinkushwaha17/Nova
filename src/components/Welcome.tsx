import { Cloud, FileLock2, HardDrive, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { connect } from '../sync/engine';
import { connectedEmail, setLocalOnly, skipResume } from '../sync/google';
import { Button, toast } from './ui';

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/**
 * Full-screen sign-in shown on first launch ("welcome") and when a returning user's Google session has
 * expired ("resume"). Both keep a way to carry on without syncing.
 */
export function Welcome({ mode, onDone }: { mode: 'welcome' | 'resume'; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const email = connectedEmail();

  const signIn = async () => {
    setBusy(true);
    try {
      await connect();
      toast(mode === 'resume' ? 'Signed in — synced with Google Drive' : 'Signed in — your data now syncs to Google Drive');
      onDone();
    } catch (e) {
      toast((e as Error).message || 'Sign-in failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    if (mode === 'welcome') setLocalOnly(true);
    else skipResume();
    onDone();
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />
      <div className="card relative w-full max-w-md p-8">
        <div className="flex flex-col items-center text-center">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-14" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{mode === 'resume' ? 'Welcome back' : 'Welcome to Nova'}</h1>
          <p className="mt-1.5 text-sm text-muted">
            {mode === 'resume'
              ? 'Your Google session expired. Sign in again to sync changes across your devices.'
              : 'Your complete financial picture — spending, investments, taxes and net worth — in one private place.'}
          </p>
        </div>

        {mode === 'welcome' && (
          <ul className="mt-6 space-y-3 text-sm">
            <li className="flex gap-3">
              <Cloud className="mt-0.5 size-4 shrink-0 text-accent" />
              <span>
                <b className="font-medium">Stored in your own Google Drive</b>
                <span className="block text-xs text-muted">In a hidden folder only Nova can open. There's no Nova server.</span>
              </span>
            </li>
            <li className="flex gap-3">
              <FileLock2 className="mt-0.5 size-4 shrink-0 text-accent" />
              <span>
                <b className="font-medium">Statements are read on this device</b>
                <span className="block text-xs text-muted">Files and passwords never leave your device.</span>
              </span>
            </li>
            <li className="flex gap-3">
              <WifiOff className="mt-0.5 size-4 shrink-0 text-accent" />
              <span>
                <b className="font-medium">Works offline</b>
                <span className="block text-xs text-muted">Changes upload the next time you're online.</span>
              </span>
            </li>
          </ul>
        )}

        <div className="mt-7 space-y-3">
          <Button variant="primary" className="w-full justify-center" loading={busy} icon={<GoogleG />} onClick={signIn}>
            {mode === 'resume' && email ? `Continue as ${email}` : 'Sign in with Google'}
          </Button>
          <Button variant="ghost" className="w-full justify-center" icon={<HardDrive className="size-4" />} onClick={skip}>
            {mode === 'resume' ? 'Use offline for now' : 'Continue without syncing'}
          </Button>
          <p className="text-center text-[11px] text-faint">
            {mode === 'resume'
              ? 'Nothing is lost — pending changes upload after you sign in.'
              : 'Without syncing, data stays only on this device. You can connect Drive later in Settings.'}
          </p>
        </div>
      </div>
    </div>
  );
}
