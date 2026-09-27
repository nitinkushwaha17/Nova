import { AlertTriangle, Cloud, CloudOff, Database, Download, Eye, EyeOff, FileJson, HardDrive, KeyRound, LogOut, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AccountModal } from '../components/AccountModal';
import { ProfilesCard } from '../components/Profiles';
import { SmsCard } from '../components/SmsCard';
import { Badge, Button, Card, Field, IconButton, Input, Modal, PageHeader, Select, Tabs, toast } from '../components/ui';
import { uid } from '../lib/format';
import { convertLegacy, isLegacyBackup } from '../lib/parsers/legacy';
import { allFiles } from '../storage/db';
import { CORE_FILES } from '../storage/files';
import { useStore, type FullBackup } from '../store';
import { connect, disconnect, resolveConflict, syncNow, useSync } from '../sync/engine';
import { connectedEmail, isConnected } from '../sync/google';
import type { StatementPassword, StoredFile } from '../types';

function DriveCard() {
  const sync = useSync();
  const [busy, setBusy] = useState(false);
  const connected = isConnected();

  const doConnect = async () => {
    setBusy(true);
    try {
      await connect();
      toast('Connected to Google Drive');
    } catch (e) {
      toast((e as Error).message || 'Sign-in failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Cloud className="size-4" /> Google Drive sync
        </span>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Data is stored as JSON files in your Drive's hidden <b>app data folder</b> — private to Nova, not visible in your Drive file list and not accessible to other apps. Only the
        files a page needs are downloaded (settings and summaries always; transactions and tax data per financial year on demand).
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {connected ? (
          <>
            <Badge color="#34d399">Connected{connectedEmail() ? ` · ${connectedEmail()}` : ''}</Badge>
            {sync.status === 'needs-auth' ? (
              <Button variant="primary" icon={<RefreshCw className="size-4" />} loading={busy} onClick={doConnect}>
                Reconnect & sync
              </Button>
            ) : (
              <Button icon={<RefreshCw className="size-4" />} loading={sync.status === 'syncing'} onClick={() => void syncNow()}>
                Sync now
              </Button>
            )}
            <Button
              variant="ghost"
              icon={<LogOut className="size-4" />}
              onClick={() => {
                disconnect();
                toast('Disconnected. Data stays on this device.', 'info');
              }}
            >
              Disconnect
            </Button>
          </>
        ) : (
          <Button variant="primary" icon={<Cloud className="size-4" />} loading={busy} onClick={doConnect}>
            Connect Google Drive
          </Button>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">Status</dt>
          <dd className="font-medium capitalize">{sync.status.replace('-', ' ')}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Last sync</dt>
          <dd className="font-medium">{sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString() : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Pending uploads</dt>
          <dd className="font-medium">{sync.pending}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Files on Drive</dt>
          <dd className="font-medium">{Object.keys(sync.remoteFiles).length}</dd>
        </div>
      </dl>
      {sync.error && <p className="mt-3 text-sm text-neg">{sync.error}</p>}
      {sync.conflicts.length > 0 && (
        <div id="sync" className="mt-4 rounded-xl border border-warn/40 bg-warn/5 p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-medium text-warn">
            <AlertTriangle className="size-4" /> These files changed on this device and on another device. Choose which copy to keep.
          </p>
          <div className="space-y-2">
            {sync.conflicts.map((c) => (
              <div key={c.name} className="flex flex-wrap items-center gap-3 text-sm">
                <code className="font-mono text-xs">{c.name}</code>
                <span className="text-xs text-muted">
                  this device {new Date(c.localUpdatedAt).toLocaleString()} · Drive {new Date(c.remoteUpdatedAt).toLocaleString()}
                </span>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" onClick={() => void resolveConflict(c.name, 'local')}>
                    Keep this device
                  </Button>
                  <Button size="sm" onClick={() => void resolveConflict(c.name, 'remote')}>
                    Keep Drive
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function StorageCard() {
  const remote = useSync((s) => s.remoteFiles);
  const pending = useSync((s) => s.pending);
  const txByFY = useStore((s) => s.txByFY);
  const [files, setFiles] = useState<StoredFile[]>([]);
  useEffect(() => {
    void allFiles().then(setFiles);
  }, [pending, remote, txByFY]);
  const names = [...new Set([...files.map((f) => f.name), ...Object.keys(remote)])].sort((a, b) => {
    const ca = (CORE_FILES as string[]).includes(a) ? 0 : 1;
    const cb = (CORE_FILES as string[]).includes(b) ? 0 : 1;
    return ca - cb || a.localeCompare(b);
  });
  const byName = new Map(files.map((f) => [f.name, f]));
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Database className="size-4" /> Data files
        </span>
      }
    >
      <p className="mb-3 text-sm text-muted">
        Each row is one JSON document, cached in this browser's IndexedDB and mirrored to Drive as <code className="font-mono text-xs">name.json</code>.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1.5 font-medium">File</th>
              <th className="font-medium">Records</th>
              <th className="font-medium">Size</th>
              <th className="font-medium">This device</th>
              <th className="font-medium">Drive</th>
            </tr>
          </thead>
          <tbody>
            {names.map((n) => {
              const f = byName.get(n);
              const size = f ? new Blob([JSON.stringify(f.data)]).size : 0;
              const count = f && f.data && typeof f.data === 'object' ? (Array.isArray(f.data) ? f.data.length : Object.keys(f.data).length) : null;
              return (
                <tr key={n} className="border-t border-line">
                  <td className="py-1.5 font-mono text-xs">{n}</td>
                  <td className="tabular text-muted">{count ?? '—'}</td>
                  <td className="tabular text-muted">{f ? `${(size / 1024).toFixed(1)} KB` : '—'}</td>
                  <td>{f ? f.dirty ? <Badge color="#fbbf24">changed</Badge> : <Badge>cached</Badge> : <span className="text-xs text-faint">not loaded</span>}</td>
                  <td>{remote[n] ? <Badge color="#34d399">rev {remote[n].rev}</Badge> : <span className="text-xs text-faint">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!names.length && <p className="py-6 text-center text-sm text-muted">Nothing stored yet.</p>}
      </div>
    </Card>
  );
}

function BackupCard() {
  const store = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [legacyRaw, setLegacyRaw] = useState<Parameters<typeof convertLegacy>[0] | null>(null);
  const [accountId, setAccountId] = useState('');
  const [newAcc, setNewAcc] = useState(false);
  const [busy, setBusy] = useState(false);
  const legacy = legacyRaw ? convertLegacy(legacyRaw, accountId || 'tmp', store.meta.categories) : null;

  const exportAll = async () => {
    setBusy(true);
    try {
      const b = await store.exportAll();
      const url = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `nova-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      if (data?.app === 'nova') {
        if (!window.confirm('Replace ALL data on this device (and Drive, on next sync) with this backup?')) return;
        await store.replaceAll(data as FullBackup);
        toast('Backup restored');
      } else if (isLegacyBackup(data)) {
        setAccountId(store.meta.accounts[0]?.id ?? '');
        setLegacyRaw(data);
      } else toast('Not a Nova or Bank Statement Analyser backup', 'error');
    } catch {
      toast('Could not read that file', 'error');
    }
  };

  const importLegacy = async () => {
    if (!legacy || !accountId) return;
    setBusy(true);
    try {
      if (legacy.newCategories.length) store.saveCategories([...store.meta.categories, ...legacy.newCategories]);
      const existing = new Set(store.meta.rules.map((r) => `${r.pattern.toLowerCase()}|${r.category}`));
      const rules = legacy.rules.filter((r) => !existing.has(`${r.pattern.toLowerCase()}|${r.category}`));
      if (rules.length) store.saveRules([...useStore.getState().meta.rules, ...rules]);
      const res = await useStore.getState().importTransactions(legacy.transactions);
      toast(`Imported ${res.added} transactions (${res.duplicates} duplicates skipped), ${rules.length} rules`);
      setLegacyRaw(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <HardDrive className="size-4" /> Backup & restore
        </span>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Button icon={<Download className="size-4" />} loading={busy && !legacy} onClick={exportAll}>
          Export everything (JSON)
        </Button>
        <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>
          Restore / import backup
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void onFile(f);
          }}
        />
      </div>
      <p className="mt-3 text-xs text-muted">
        Restore accepts a Nova backup, or a backup exported from the old <b>Bank Statement Analyser</b> (transactions, categories and auto-label rules are migrated).
      </p>

      <Modal
        open={!!legacy}
        onClose={() => setLegacyRaw(null)}
        title={
          <span className="flex items-center gap-2">
            <FileJson className="size-4" /> Import Bank Statement Analyser backup
          </span>
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setLegacyRaw(null)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={!accountId} onClick={importLegacy}>
              Import {legacy?.transactions.length} transactions
            </Button>
          </>
        }
      >
        {legacy && (
          <div className="space-y-4 text-sm">
            <p className="text-muted">
              Found <b className="text-fg">{legacy.transactions.length}</b> transactions, <b className="text-fg">{legacy.rules.length}</b> rules and{' '}
              <b className="text-fg">{legacy.newCategories.length}</b> new categories{legacy.profileName ? ` from profile “${legacy.profileName}”` : ''}.
            </p>
            <Field label="Assign transactions to account">
              <div className="flex gap-2">
                <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">Select account…</option>
                  {store.meta.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
                <Button onClick={() => setNewAcc(true)}>New</Button>
              </div>
            </Field>
          </div>
        )}
      </Modal>
      <AccountModal open={newAcc} onClose={() => setNewAcc(false)} onSaved={(a) => setAccountId(a.id)} />
    </Card>
  );
}

function PasswordsCard() {
  const saved = useStore((s) => s.settings.statementPasswords) ?? [];
  const update = useStore((s) => s.update);
  const [label, setLabel] = useState('');
  const [pw, setPw] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const save = (list: StatementPassword[]) => update('settings', (s) => ({ ...s, statementPasswords: list }));
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="size-4" /> Statement passwords
        </span>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Tried automatically when you import a password-protected PDF or Excel statement. If none of them work, you're asked for the password. They sync with your data to your
        private Drive app folder and are included in JSON backups.
      </p>
      {saved.length > 0 && (
        <ul className="mb-4 divide-y divide-line rounded-xl border border-line">
          {saved.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{p.label || 'Untitled'}</span>
              <code className="text-xs text-muted">{shown === p.id ? p.password : '•'.repeat(Math.min(12, p.password.length))}</code>
              <IconButton title={shown === p.id ? 'Hide' : 'Show'} onClick={() => setShown(shown === p.id ? null : p.id)}>
                {shown === p.id ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </IconButton>
              <IconButton title="Remove" onClick={() => save(saved.filter((x) => x.id !== p.id))}>
                <Trash2 className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pw) return;
          if (saved.some((p) => p.password === pw)) return toast('That password is already saved', 'info');
          save([...saved, { id: uid('pw'), label: label.trim(), password: pw }]);
          setLabel('');
          setPw('');
          toast('Password saved');
        }}
      >
        <Input className="min-w-32 flex-1" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label, e.g. SBI e-statement" />
        <Input className="min-w-32 flex-1" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" />
        <Button type="submit" icon={<Plus className="size-4" />} disabled={!pw}>
          Add
        </Button>
      </form>
    </Card>
  );
}

function PreferencesCard() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.update);
  const resetAll = useStore((s) => s.resetAll);
  return (
    <Card title="Preferences">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name">
          <Input value={settings.displayName ?? ''} onChange={(e) => update('settings', (s) => ({ ...s, displayName: e.target.value }))} placeholder="Shown on the dashboard" />
        </Field>
        <Field label="Theme">
          <Tabs
            value={settings.theme}
            onChange={(theme) => update('settings', (s) => ({ ...s, theme }))}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
          />
        </Field>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neg/25 p-4">
        <div>
          <p className="text-sm font-medium">Clear this device</p>
          <p className="text-xs text-muted">Deletes the local IndexedDB copy. Data already on Drive is kept and re-downloads when you reconnect.</p>
        </div>
        <Button
          variant="danger"
          icon={<Trash2 className="size-4" />}
          onClick={async () => {
            if (!window.confirm('Delete all Nova data from this browser? Unsynced changes will be lost.')) return;
            disconnect();
            await resetAll();
            toast('Local data cleared', 'info');
          }}
        >
          Clear local data
        </Button>
      </div>
    </Card>
  );
}

export default function Settings() {
  return (
    <>
      <PageHeader
        title="Settings & sync"
        subtitle={
          <span className="flex items-center gap-1.5">
            <CloudOff className="size-3.5" /> Local-first: everything works offline; Drive is your private backup and cross-device sync.
          </span>
        }
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-5">
          <DriveCard />
          <BackupCard />
          <PreferencesCard />
        </div>
        <div className="space-y-5">
          <ProfilesCard />
          <PasswordsCard />
          <SmsCard />
          <StorageCard />
        </div>
      </div>
    </>
  );
}
