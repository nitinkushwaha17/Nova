import { Link2, MessageSquareText, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { useStore } from '../store';
import { clearUnlinked, FIRST_SCAN_DAYS, scanSms, setSmsAuto, smsAutoEnabled, smsSupported, startSmsAuto, useSmsState } from '../sync/sms';
import type { UnlinkedSms } from '../lib/sms';
import { Badge, Button, Card, Select, Toggle, toast } from './ui';

function UnlinkedRow({ u }: { u: UnlinkedSms }) {
  const accounts = useStore((s) => s.meta.accounts).filter((a) => !a.archived);
  const saveAccount = useStore((s) => s.saveAccount);
  const [target, setTarget] = useState('');
  const link = async () => {
    const acc = accounts.find((a) => a.id === target);
    if (!acc) return;
    saveAccount({ ...acc, last4: u.last4 || acc.last4, bank: acc.bank || u.bank });
    clearUnlinked(u);
    await scanSms({ fromDate: u.oldest });
  };
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1">
        <b className="font-medium">
          {u.bank ?? 'Unknown bank'} {u.last4 ? `a/c ··${u.last4}` : ''}
        </b>
        <span className="block text-xs text-muted">
          {u.count} alert{u.count === 1 ? '' : 's'} not matched to an account
        </span>
      </span>
      <Select className="w-44" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">Link to account…</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      <Button icon={<Link2 className="size-4" />} disabled={!target} onClick={link}>
        Link
      </Button>
      <button className="text-faint hover:text-fg" title="Ignore" onClick={() => clearUnlinked(u)}>
        <X className="size-4" />
      </button>
    </li>
  );
}

export function SmsCard() {
  const [auto, setAuto] = useState(smsAutoEnabled());
  const { scanning, last, error } = useSmsState();
  const title = (
    <span className="flex items-center gap-2">
      <MessageSquareText className="size-4" /> SMS alerts
    </span>
  );

  if (!smsSupported)
    return (
      <Card title={title}>
        <p className="text-sm text-muted">
          In the Android app, Nova can read your bank's transaction SMS and add them as they arrive. When you later import the statement, matching entries are merged with it and
          anything the SMS missed is added.
        </p>
      </Card>
    );

  const toggle = async (on: boolean) => {
    if (!on) {
      setSmsAuto(false);
      setAuto(false);
      return;
    }
    // The first read asks for the SMS permission
    const r = await scanSms();
    if (!r) return;
    setSmsAuto(true);
    setAuto(true);
    void startSmsAuto(false);
  };

  return (
    <Card title={title}>
      <p className="mb-4 text-sm text-muted">
        Reads bank transaction alerts on this phone and adds them as <Badge>SMS</Badge> entries. Messages are parsed on the device and never uploaded; only the resulting
        transactions sync. Importing the bank statement later confirms them: matching entries are merged (your category, notes and tags are kept) and anything the SMS missed is
        added.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Toggle checked={auto} onChange={(v) => void toggle(v)} label="Import new alerts automatically" />
        <div className="flex gap-2">
          <Button icon={<RefreshCw className={scanning ? 'size-4 animate-spin' : 'size-4'} />} disabled={scanning} onClick={() => void scanSms()}>
            Scan now
          </Button>
          <Button
            variant="ghost"
            disabled={scanning}
            onClick={async () => {
              const r = await scanSms({ fromDays: 90 });
              if (r && !r.added) toast('Nothing new in the last 90 days', 'info');
            }}
          >
            Last 90 days
          </Button>
        </div>
      </div>
      {!auto && !last && <p className="mt-3 text-xs text-faint">The first scan looks back {FIRST_SCAN_DAYS} days and asks for permission to read SMS.</p>}
      {error && <p className="mt-3 text-xs text-neg">{error}</p>}
      {last && (
        <p className="mt-3 text-xs text-muted">
          Last scan {new Date(last.at).toLocaleTimeString()}: {last.read} messages, {last.parsed} transaction alerts, {last.added} added, {last.duplicates} already known.
        </p>
      )}
      {!!last?.unlinked.length && (
        <ul className="mt-3 divide-y divide-line rounded-xl border border-warn/30">
          {last.unlinked.map((u) => (
            <UnlinkedRow key={`${u.last4}|${u.bank}`} u={u} />
          ))}
        </ul>
      )}
    </Card>
  );
}
