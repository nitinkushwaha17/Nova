import {
  ArrowLeftRight,
  BarChart3,
  Calculator,
  CloudOff,
  CloudUpload,
  Cloud,
  Eye,
  EyeOff,
  Goal,
  Landmark,
  LayoutDashboard,
  Menu,
  Moon,
  PiggyBank,
  Receipt,
  RefreshCw,
  Settings,
  Sun,
  Tags,
  TrendingUp,
  Upload,
  Wallet,
  AlertTriangle,
  CreditCard,
  Luggage,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { useAutoSnapshot } from '../hooks';
import { reauthorize, syncNow, useSync } from '../sync/engine';
import { ProfileSwitcher } from './Profiles';
import { cx, IconButton, Spinner, toast } from './ui';

const NAV: { group: string; items: { to: string; label: string; icon: ReactNode }[] }[] = [
  {
    group: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: <LayoutDashboard /> },
      { to: '/analytics', label: 'Analytics', icon: <BarChart3 /> },
    ],
  },
  {
    group: 'Money',
    items: [
      { to: '/transactions', label: 'Transactions', icon: <ArrowLeftRight /> },
      { to: '/import', label: 'Import', icon: <Upload /> },
      { to: '/accounts', label: 'Accounts', icon: <Wallet /> },
      { to: '/categories', label: 'Categories & rules', icon: <Tags /> },
      { to: '/buckets', label: 'Buckets & tags', icon: <Luggage /> },
    ],
  },
  {
    group: 'Wealth',
    items: [
      { to: '/assets', label: 'Investments', icon: <PiggyBank /> },
      { to: '/liabilities', label: 'Loans & cards', icon: <CreditCard /> },
      { to: '/networth', label: 'Net worth', icon: <Landmark /> },
    ],
  },
  {
    group: 'Plan',
    items: [
      { to: '/taxes', label: 'Taxes', icon: <Receipt /> },
      { to: '/planning', label: 'Budgets & goals', icon: <Goal /> },
      { to: '/inflation', label: 'Inflation & growth', icon: <TrendingUp /> },
      { to: '/calculator', label: 'Calculators', icon: <Calculator /> },
    ],
  },
];

function ago(iso?: string) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function SyncChip() {
  const { status, lastSyncAt, pending, conflicts, error } = useSync();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const base = 'inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 text-xs font-medium transition hover:border-accent/50';

  if (status === 'unconfigured' || status === 'disconnected')
    return (
      <Link to="/settings" className={cx(base, 'text-muted')} title="Your data is only on this device. Connect Google Drive to back it up.">
        <CloudOff className="size-3.5" /> Local only{pending ? ` · ${pending} unsynced` : ''}
      </Link>
    );
  if (conflicts.length)
    return (
      <Link to="/settings#sync" className={cx(base, 'text-warn')}>
        <AlertTriangle className="size-3.5" /> {conflicts.length} conflict{conflicts.length > 1 ? 's' : ''}
      </Link>
    );
  if (status === 'needs-auth')
    return (
      <button
        className={cx(base, 'text-accent')}
        onClick={() => reauthorize().catch((e: Error) => toast(e.message, 'error'))}
        title="Google sign-in expired — click to reconnect and sync"
      >
        <RefreshCw className="size-3.5" /> Reconnect Drive{pending ? ` · ${pending}` : ''}
      </button>
    );
  if (status === 'syncing')
    return (
      <span className={cx(base, 'text-muted')}>
        <Spinner className="size-3.5" /> Syncing…
      </span>
    );
  if (status === 'error' || status === 'offline')
    return (
      <button className={cx(base, 'text-neg')} onClick={() => void syncNow()} title={error}>
        <CloudOff className="size-3.5" /> {status === 'offline' ? 'Offline' : 'Sync failed'} · retry
      </button>
    );
  return (
    <button className={cx(base, 'text-muted')} onClick={() => void syncNow()} title={`Last synced ${ago(lastSyncAt)} — click to sync now`}>
      {pending ? <CloudUpload className="size-3.5 text-warn" /> : <Cloud className="size-3.5 text-pos" />}
      {pending ? `${pending} pending` : `Synced ${ago(lastSyncAt)}`}
    </button>
  );
}

export function Layout() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.update);
  const ready = useStore((s) => s.ready);
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useAutoSnapshot();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', settings.theme === 'dark' ? '#090c15' : '#f5f6fb');
  }, [settings.theme]);
  useEffect(() => setOpen(false), [loc.pathname]);

  return (
    <div className="flex min-h-full">
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-bg/80 backdrop-blur-xl transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Link to="/" className="flex items-center gap-2.5 px-5 pt-5 pb-4">
          <img src="/favicon.svg" alt="" className="size-8" />
          <div>
            <div className="text-lg leading-none font-semibold tracking-tight">Nova</div>
            <div className="mt-0.5 text-[10px] tracking-widest text-faint uppercase">Personal finance</div>
          </div>
        </Link>
        <ProfileSwitcher />
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="px-2.5 pb-1.5 text-[10px] font-semibold tracking-widest text-faint uppercase">{g.group}</div>
              {g.items.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={i.to === '/'}
                  className={({ isActive }) =>
                    cx(
                      'group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition [&_svg]:size-4',
                      isActive ? 'bg-accent/12 font-medium text-fg [&_svg]:text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
                    )
                  }
                >
                  {i.icon}
                  {i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <NavLink
            to="/settings"
            className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm [&_svg]:size-4', isActive ? 'bg-accent/12 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg')}
          >
            <Settings /> Settings & sync
          </NavLink>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-bg/70 px-4 backdrop-blur-xl sm:px-6">
          <IconButton title="Menu" className="lg:hidden" onClick={() => setOpen(true)}>
            <Menu className="size-5" />
          </IconButton>
          <div className="flex-1" />
          <SyncChip />
          <IconButton title={settings.privacy ? 'Show amounts' : 'Hide amounts'} onClick={() => update('settings', (s) => ({ ...s, privacy: !s.privacy }))}>
            {settings.privacy ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </IconButton>
          <IconButton title="Toggle theme" onClick={() => update('settings', (s) => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }))}>
            {settings.theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </IconButton>
        </header>
        <main key={settings.privacy ? 'p' : 'np'} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          {ready ? (
            <Outlet />
          ) : (
            <div className="grid h-64 place-items-center">
              <Spinner className="size-6" />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
