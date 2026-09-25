import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { inPeriod, periodFYs, type Period } from './lib/dates';
import { defaultPeriod } from './components/PeriodPicker';
import { computeNetWorth, snapshotFrom, upsertSnapshot, type NetWorth } from './lib/portfolio';
import { useKnownFYs, useStore } from './store';
import type { Transaction } from './types';

/** Period shared across Transactions / Analytics so switching pages keeps context */
export const usePeriod = create<{ period: Period; setPeriod: (p: Period) => void }>((set) => ({
  period: defaultPeriod(),
  setPeriod: (period) => set({ period }),
}));

/** Loads (lazily) the FY files a period needs and returns its transactions */
export function usePeriodTxns(period: Period): { txns: Transaction[]; loading: boolean; fys: string[] } {
  const known = useKnownFYs();
  const fys = useMemo(() => periodFYs(period, known), [period, known]);
  const txByFY = useStore((s) => s.txByFY);
  const loadingFYs = useStore((s) => s.loadingFYs);
  const ensureFYs = useStore((s) => s.ensureFYs);

  useEffect(() => {
    void ensureFYs(fys);
  }, [fys, ensureFYs]);

  const txns = useMemo(() => fys.flatMap((fy) => txByFY[fy] ?? []).filter((t) => inPeriod(t.date, period)), [fys, txByFY, period]);
  const loading = fys.some((f) => loadingFYs.includes(f) || !txByFY[f]);
  return { txns, loading, fys };
}

/** Live net worth from assets, liabilities, account balances and cached NAVs */
export function useNetWorth(): NetWorth {
  const assets = useStore((s) => s.portfolio.assets);
  const liabilities = useStore((s) => s.liabilities.liabilities);
  const accounts = useStore((s) => s.meta.accounts);
  const summaries = useStore((s) => s.summaries);
  const navs = useStore((s) => s.navs);
  return useMemo(() => computeNetWorth(assets, liabilities, accounts, summaries, navs), [assets, liabilities, accounts, summaries, navs]);
}

/** Keeps this month's net-worth snapshot current (one per month, latest value wins) and refreshes NAVs once per session */
export function useAutoSnapshot() {
  const ready = useStore((s) => s.ready);
  const nw = useNetWorth();
  const hasData = useStore((s) => s.portfolio.assets.length + s.liabilities.liabilities.length + s.meta.accounts.length > 0);
  const refreshNavs = useStore((s) => s.refreshNavs);
  useEffect(() => {
    if (ready) void refreshNavs();
  }, [ready, refreshNavs]);
  useEffect(() => {
    if (!ready || !hasData) return;
    const t = setTimeout(() => {
      const s = useStore.getState();
      const snap = snapshotFrom(nw);
      const cur = s.networth.snapshots.find((x) => x.month === snap.month);
      if (!cur || cur.netWorth !== snap.netWorth || cur.assets !== snap.assets || cur.liabilities !== snap.liabilities) {
        s.update('networth', (d) => ({ snapshots: upsertSnapshot(d.snapshots, snap) }));
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [ready, hasData, nw]);
}
