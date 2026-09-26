/* Android-only: read bank alert SMS from the inbox and import them as unconfirmed transactions. */
import { App } from '@capacitor/app';
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { create } from 'zustand';
import { toast } from '../components/ui';
import { parseSms, smsToTransactions, type RawSms, type SmsTxn, type UnlinkedSms } from '../lib/sms';
import { platform } from '../platform';
import { useStore } from '../store';

interface SmsInboxPlugin {
  read(opts: { since: number; limit?: number }): Promise<{ messages: RawSms[] }>;
  checkPermissions(): Promise<{ sms: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' }>;
  addListener(event: 'smsReceived', fn: () => void): Promise<PluginListenerHandle>;
}

const SmsInbox = registerPlugin<SmsInboxPlugin>('SmsInbox');

export const smsSupported = platform === 'android';

// Per device: the SMS inbox belongs to this phone, not to the synced profile
const LS_AUTO = 'nova.smsAuto';
const LS_SINCE = 'nova.smsSince';
const DAY = 86400000;
export const FIRST_SCAN_DAYS = 30;

export const smsAutoEnabled = () => localStorage.getItem(LS_AUTO) === '1';
export const setSmsAuto = (on: boolean) => (on ? localStorage.setItem(LS_AUTO, '1') : localStorage.removeItem(LS_AUTO));

export interface SmsScanResult {
  at: number;
  read: number;
  parsed: number;
  added: number;
  duplicates: number;
  unlinked: UnlinkedSms[];
}

export const useSmsState = create<{ scanning: boolean; last: SmsScanResult | null; error: string | null }>(() => ({ scanning: false, last: null, error: null }));

/** Read new alerts and import them. `fromDays` rescans further back (safe: already-imported SMS are skipped). */
export async function scanSms(opts: { fromDays?: number; fromDate?: string; quiet?: boolean } = {}): Promise<SmsScanResult | null> {
  if (!smsSupported || useSmsState.getState().scanning) return null;
  useSmsState.setState({ scanning: true, error: null });
  try {
    const stored = Number(localStorage.getItem(LS_SINCE) || 0);
    const since = opts.fromDate ? Date.parse(opts.fromDate) - DAY : opts.fromDays ? Date.now() - opts.fromDays * DAY : stored || Date.now() - FIRST_SCAN_DAYS * DAY;
    const { messages } = await SmsInbox.read({ since });
    const parsed = messages.map(parseSms).filter((s): s is SmsTxn => !!s);
    const { txns, unlinked } = smsToTransactions(parsed, useStore.getState().meta.accounts);
    const res = txns.length ? await useStore.getState().importTransactions(txns) : null;
    const newest = messages.reduce((m, x) => Math.max(m, x.date), stored);
    if (newest > stored) localStorage.setItem(LS_SINCE, String(newest));
    const result: SmsScanResult = { at: Date.now(), read: messages.length, parsed: parsed.length, added: res?.added ?? 0, duplicates: res?.duplicates ?? 0, unlinked };
    // Unlinked alerts stay visible until linked, even after later scans that find nothing new
    const prev = useSmsState.getState().last?.unlinked ?? [];
    for (const u of prev) if (!unlinked.some((x) => x.last4 === u.last4 && x.bank === u.bank)) unlinked.push(u);
    useSmsState.setState({ last: result });
    if (!opts.quiet || result.added) toast(result.added ? `Added ${result.added} transaction${result.added === 1 ? '' : 's'} from SMS alerts` : 'No new transactions in SMS');
    return result;
  } catch (e) {
    const msg = (e as { code?: string }).code === 'DENIED' ? 'SMS permission was denied. Allow it in Android Settings → Apps → Nova → Permissions.' : (e as Error).message;
    useSmsState.setState({ error: msg });
    if (!opts.quiet) toast(msg, 'error');
    return null;
  } finally {
    useSmsState.setState({ scanning: false });
  }
}

/** Forget an unlinked group once the user links or dismisses it */
export function clearUnlinked(u: UnlinkedSms) {
  const last = useSmsState.getState().last;
  if (last) useSmsState.setState({ last: { ...last, unlinked: last.unlinked.filter((x) => !(x.last4 === u.last4 && x.bank === u.bank)) } });
}

let started = false;
/** Scan on launch, when the app returns to the foreground, and when an SMS arrives while it's open */
export async function startSmsAuto(initialScan = true) {
  if (!smsSupported || started || !smsAutoEnabled()) return;
  const perm = await SmsInbox.checkPermissions().catch(() => null);
  if (perm?.sms !== 'granted') return;
  started = true;
  if (initialScan) void scanSms({ quiet: true });
  void App.addListener('resume', () => smsAutoEnabled() && void scanSms({ quiet: true }));
  // The SMS provider stores the message just after the broadcast
  void SmsInbox.addListener('smsReceived', () => smsAutoEnabled() && setTimeout(() => void scanSms({ quiet: true }), 2000));
}
