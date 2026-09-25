import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { inPeriod, periodFYs, type Period } from './lib/dates';
import { defaultPeriod } from './components/PeriodPicker';
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
