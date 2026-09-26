import { useMemo } from 'react';
import { create } from 'zustand';
import type {
  Account,
  Collection,
  CollectionsDoc,
  Category,
  CpiDoc,
  FY,
  GroupTotals,
  LiabilitiesDoc,
  MetaDoc,
  NetWorthDoc,
  PlanningDoc,
  PortfolioDoc,
  Rule,
  SettingsDoc,
  SummariesDoc,
  TaxYear,
  Transaction,
} from '../types';
import {
  DEFAULT_COLLECTIONS,
  DEFAULT_CPI,
  DEFAULT_LIABILITIES,
  DEFAULT_META,
  DEFAULT_NETWORTH,
  DEFAULT_PLANNING,
  DEFAULT_PORTFOLIO,
  DEFAULT_SETTINGS,
  DEFAULT_SUMMARIES,
} from '../lib/defaults';
import { currentFY, fyOf } from '../lib/dates';
import { newSmsOnly, reconcileStatement, unmatchedSms } from '../lib/reconcile';
import { setPrivacyMode } from '../lib/format';
import { applyRules, dedupe, detectTransferPairs, groupByFY, mergeGroups, sortTxns, summarize } from '../lib/transactions';
import { emptyTaxYear } from '../lib/tax';
import { navsFor } from '../lib/mf';
import { computeNetWorth, snapshotFrom, upsertSnapshot } from '../lib/portfolio';
import { clearAll, fileNames, getFile, writeLocal } from '../storage/db';
import { CORE_FILES, F, fyFromFile, isTaxFile, isTxFile, taxFile, txFile, type CoreFile } from '../storage/files';
import { fetchRemoteFile, initSync, schedulePush, setFilesUpdatedHandler, useSync } from '../sync/engine';

interface Docs {
  settings: SettingsDoc;
  meta: MetaDoc;
  summaries: SummariesDoc;
  portfolio: PortfolioDoc;
  liabilities: LiabilitiesDoc;
  planning: PlanningDoc;
  networth: NetWorthDoc;
  cpi: CpiDoc;
  collections: CollectionsDoc;
}

const DEFAULTS: Docs = {
  settings: DEFAULT_SETTINGS,
  meta: DEFAULT_META,
  summaries: DEFAULT_SUMMARIES,
  portfolio: DEFAULT_PORTFOLIO,
  liabilities: DEFAULT_LIABILITIES,
  planning: DEFAULT_PLANNING,
  networth: DEFAULT_NETWORTH,
  cpi: DEFAULT_CPI,
  collections: DEFAULT_COLLECTIONS,
};

export interface ImportResult {
  added: number;
  duplicates: number;
  categorized: number;
  transfers: number;
  fys: FY[];
  /** Existing SMS entries confirmed (and replaced) by statement rows */
  merged: number;
  /** SMS entries inside the statement's date range that the statement doesn't list */
  smsUnmatched: string[];
}

interface State extends Docs {
  ready: boolean;
  /** Transactions per FY — only FYs that have been loaded */
  txByFY: Record<FY, Transaction[]>;
  taxByFY: Record<FY, TaxYear>;
  loadingFYs: FY[];
  /** FYs that have transaction files locally */
  localTxFYs: FY[];
  localTaxFYs: FY[];
  navs: Record<string, { nav: number; date: string }>;

  init(): Promise<void>;
  update<K extends keyof Docs>(key: K, updater: (doc: Docs[K]) => Docs[K]): void;
  ensureFYs(fys: FY[]): Promise<void>;
  ensureTax(fy: FY): Promise<TaxYear>;
  saveTax(tax: TaxYear): void;

  importTransactions(txns: Transaction[]): Promise<ImportResult>;
  updateTransaction(id: string, patch: Partial<Transaction>): void;
  updateTransactions(ids: string[], patch: Partial<Transaction>): void;
  deleteTransactions(ids: string[]): void;
  applyRulesTo(fys: FY[], overwrite: boolean): Promise<number>;
  recomputeSummaries(fys?: FY[]): void;

  saveAccount(acc: Account): void;
  deleteAccount(id: string): Promise<void>;
  saveCategories(cats: Category[]): void;
  saveRules(rules: Rule[]): void;

  saveCollection(b: Collection): void;
  /** Removes the collection and un-assigns its transactions */
  deleteCollection(id: string): Promise<void>;
  /** Rename (or delete, when 	o is empty) a tag across every transaction */
  renameTag(from: string, to: string): Promise<number>;
  /** FYs whose transactions include a collection / tag, according to summaries */
  fysWith(kind: 'collection' | 'tag', key: string): FY[];
  /** Rebuild summaries written before collections/tags were tracked (loads those FYs once) */
  upgradeSummaries(): Promise<void>;

  refreshNavs(force?: boolean): Promise<void>;
  takeSnapshot(): void;
  resetAll(): Promise<void>;
  replaceAll(backup: FullBackup): Promise<void>;
  exportAll(): Promise<FullBackup>;
}

export interface FullBackup {
  app: 'nova';
  schemaVersion: 1;
  exportedAt: string;
  files: Record<string, unknown>;
}

const persist = (name: string, data: unknown) => {
  void writeLocal(name, data).then(() => schedulePush());
};

function catMapOf(meta: MetaDoc) {
  return new Map(meta.categories.map((c) => [c.id, c]));
}

export const useStore = create<State>((set, get) => {
  /** Persist one FY's transactions + refresh its summary */
  const saveFY = (fy: FY, txns: Transaction[], extra: Partial<State> = {}) => {
    const sorted = sortTxns(txns);
    const summaries = { ...get().summaries };
    if (sorted.length) summaries[fy] = summarize(sorted, catMapOf(get().meta));
    else delete summaries[fy];
    const localTxFYs = get().localTxFYs.includes(fy) ? get().localTxFYs : [...get().localTxFYs, fy].sort();
    set({ txByFY: { ...get().txByFY, [fy]: sorted }, summaries, localTxFYs, ...extra });
    persist(txFile(fy), sorted);
    persist(F.summaries, summaries);
  };

  /** Reload in-memory state from IndexedDB after sync pulled newer files */
  const reload = async (names: string[]) => {
    const patch: Partial<State> = {};
    const txByFY = { ...get().txByFY };
    const taxByFY = { ...get().taxByFY };
    for (const name of names) {
      const file = await getFile<unknown>(name);
      if (!file) continue;
      if ((CORE_FILES as string[]).includes(name)) {
        (patch as Record<string, unknown>)[name] = { ...DEFAULTS[name as CoreFile], ...(file.data as object) };
      } else if (isTxFile(name)) {
        const fy = fyFromFile(name)!;
        if (txByFY[fy]) txByFY[fy] = file.data as Transaction[];
      } else if (isTaxFile(name)) {
        const fy = fyFromFile(name)!;
        if (taxByFY[fy]) taxByFY[fy] = file.data as TaxYear;
      }
    }
    set({ ...patch, txByFY, taxByFY });
    if (patch.settings) setPrivacyMode(patch.settings.privacy);
    const names2 = await fileNames();
    set({
      localTxFYs: names2
        .filter(isTxFile)
        .map((n) => fyFromFile(n)!)
        .sort(),
      localTaxFYs: names2
        .filter(isTaxFile)
        .map((n) => fyFromFile(n)!)
        .sort(),
    });
  };

  return {
    ...DEFAULTS,
    ready: false,
    txByFY: {},
    taxByFY: {},
    loadingFYs: [],
    localTxFYs: [],
    localTaxFYs: [],
    navs: {},

    async init() {
      setFilesUpdatedHandler(reload);
      const docs: Partial<Docs> = {};
      for (const name of CORE_FILES) {
        const f = await getFile<object>(name);
        (docs as Record<string, unknown>)[name] = f ? { ...DEFAULTS[name], ...f.data } : DEFAULTS[name];
      }
      const names = await fileNames();
      set({
        ...(docs as Docs),
        localTxFYs: names
          .filter(isTxFile)
          .map((n) => fyFromFile(n)!)
          .sort(),
        localTaxFYs: names
          .filter(isTaxFile)
          .map((n) => fyFromFile(n)!)
          .sort(),
      });
      setPrivacyMode(get().settings.privacy);
      await get().ensureFYs([currentFY()]);
      // FYs that were loaded as empty before Drive was reachable: fetch them once the manifest lists them
      useSync.subscribe((s, prev) => {
        if (s.remoteFiles === prev.remoteFiles) return;
        void (async () => {
          const local = new Set(await fileNames());
          for (const name of Object.keys(s.remoteFiles)) {
            if (local.has(name)) continue;
            const fy = fyFromFile(name);
            if (!fy) continue;
            if (isTxFile(name) && get().txByFY[fy]) {
              const f = await fetchRemoteFile<Transaction[]>(name);
              if (f) set({ txByFY: { ...get().txByFY, [fy]: f.data }, localTxFYs: [...new Set([...get().localTxFYs, fy])].sort() });
            } else if (isTaxFile(name) && get().taxByFY[fy]) {
              const f = await fetchRemoteFile<TaxYear>(name);
              if (f) set({ taxByFY: { ...get().taxByFY, [fy]: { ...emptyTaxYear(fy), ...f.data } }, localTaxFYs: [...new Set([...get().localTaxFYs, fy])].sort() });
            }
          }
        })().catch(() => undefined);
      });
      await initSync();
      set({ ready: true });
      void get().refreshNavs();
    },

    update(key, updater) {
      const next = updater(get()[key]);
      set({ [key]: next } as Partial<State>);
      if (key === 'settings') setPrivacyMode((next as SettingsDoc).privacy);
      persist(key, next);
    },

    async ensureFYs(fys) {
      const missing = fys.filter((fy) => !get().txByFY[fy] && !get().loadingFYs.includes(fy));
      if (!missing.length) return;
      set({ loadingFYs: [...get().loadingFYs, ...missing] });
      const loaded: Record<FY, Transaction[]> = {};
      await Promise.all(
        missing.map(async (fy) => {
          const file = (await getFile<Transaction[]>(txFile(fy))) ?? (await fetchRemoteFile<Transaction[]>(txFile(fy)));
          loaded[fy] = file?.data ?? [];
        }),
      );
      const names = await fileNames();
      set({
        txByFY: { ...get().txByFY, ...loaded },
        loadingFYs: get().loadingFYs.filter((f) => !missing.includes(f)),
        localTxFYs: names
          .filter(isTxFile)
          .map((n) => fyFromFile(n)!)
          .sort(),
      });
    },

    async ensureTax(fy) {
      const have = get().taxByFY[fy];
      if (have) return have;
      const file = (await getFile<TaxYear>(taxFile(fy))) ?? (await fetchRemoteFile<TaxYear>(taxFile(fy)));
      const tax = file ? { ...emptyTaxYear(fy), ...file.data } : emptyTaxYear(fy);
      set({ taxByFY: { ...get().taxByFY, [fy]: tax } });
      return tax;
    },

    saveTax(tax) {
      set({
        taxByFY: { ...get().taxByFY, [tax.fy]: tax },
        localTaxFYs: get().localTaxFYs.includes(tax.fy) ? get().localTaxFYs : [...get().localTaxFYs, tax.fy].sort(),
      });
      persist(taxFile(tax.fy), tax);
    },

    async importTransactions(incoming) {
      const isSms = incoming.length > 0 && incoming.every((t) => t.source === 'sms');
      await get().ensureFYs([...groupByFY(incoming).keys()]);
      const loaded = Object.values(get().txByFY).flat();
      let merged = 0;
      let duplicates = 0;
      const mergedTx: Transaction[] = [];
      const removed = new Set<string>();
      const statementRows = incoming;
      if (isSms) {
        const r = newSmsOnly(loaded, incoming);
        duplicates += r.duplicates;
        incoming = r.fresh;
      } else {
        // Exact re-imports are dropped first, so only genuinely new statement rows can confirm an SMS
        const exact = new Set<string>();
        for (const [fy, rows] of groupByFY(incoming)) for (const t of dedupe(get().txByFY[fy] ?? [], rows).dupes) exact.add(t.id);
        const { merges, rest } = reconcileStatement(
          loaded,
          incoming.filter((t) => !exact.has(t.id)),
        );
        for (const m of merges) {
          removed.add(m.sms.id);
          mergedTx.push(m.merged);
        }
        merged = merges.length;
        incoming = [...rest, ...incoming.filter((t) => exact.has(t.id))];
      }
      const groups = groupByFY(incoming);
      for (const fy of groupByFY(mergedTx).keys()) if (!groups.has(fy)) groups.set(fy, []);
      for (const t of loaded) if (removed.has(t.id) && !groups.has(fyOf(t.date))) groups.set(fyOf(t.date), []);
      const fys = [...groups.keys()].sort();
      // Neighbouring FYs are needed to catch transfer pairs straddling 31-Mar
      await get().ensureFYs(fys);
      const { meta } = get();
      let added = 0;
      let categorized = 0;
      const allNew: Transaction[] = [];
      const perFY: Record<FY, Transaction[]> = {};
      const mergedByFY = groupByFY(applyRules(mergedTx, meta.rules).txns);
      for (const fy of fys) {
        const existing = (get().txByFY[fy] ?? []).filter((t) => !removed.has(t.id));
        const { fresh, dupes } = dedupe(existing, groups.get(fy)!);
        duplicates += dupes.length;
        const ruled = applyRules(fresh, meta.rules);
        categorized += ruled.txns.filter((t) => t.category).length;
        added += ruled.txns.length;
        allNew.push(...ruled.txns);
        perFY[fy] = [...existing, ...(mergedByFY.get(fy) ?? []), ...ruled.txns];
      }
      // Self-transfer detection across all loaded + new transactions
      const pool = Object.entries(get().txByFY)
        .filter(([fy]) => !perFY[fy])
        .flatMap(([, l]) => l)
        .concat(Object.values(perFY).flat());
      const pairIds = detectTransferPairs(pool);
      let transfers = 0;
      const newIds = new Set(allNew.map((t) => t.id));
      const touched = new Set<FY>(fys);
      for (const [fy, list] of Object.entries({ ...get().txByFY, ...perFY })) {
        let changed = false;
        const next = list.map((t) => {
          if (pairIds.has(t.id) && !t.autoTransfer && t.isTransfer === undefined) {
            changed = true;
            if (newIds.has(t.id)) transfers++;
            return { ...t, autoTransfer: true };
          }
          return t;
        });
        if (changed || perFY[fy]) {
          perFY[fy] = next;
          touched.add(fy);
        }
      }
      for (const fy of touched) saveFY(fy, perFY[fy]);
      const smsUnmatched = isSms ? [] : unmatchedSms(Object.values({ ...get().txByFY, ...perFY }).flat(), statementRows).map((t) => t.id);
      return { added, duplicates, categorized, transfers, fys, merged, smsUnmatched };
    },

    updateTransaction(id, patch) {
      get().updateTransactions([id], patch);
    },

    updateTransactions(ids, patch) {
      const idSet = new Set(ids);
      const byFY = new Map<FY, Transaction[]>();
      for (const [fy, list] of Object.entries(get().txByFY)) {
        if (!list.some((t) => idSet.has(t.id))) continue;
        byFY.set(fy, list);
      }
      const moved: Transaction[] = [];
      for (const [fy, list] of byFY) {
        const next: Transaction[] = [];
        for (const t of list) {
          if (!idSet.has(t.id)) {
            next.push(t);
            continue;
          }
          const u = { ...t, ...patch };
          if (fyOf(u.date) !== fy) moved.push(u);
          else next.push(u);
        }
        saveFY(fy, next);
      }
      if (moved.length) {
        for (const [fy, list] of groupByFY(moved)) {
          void get()
            .ensureFYs([fy])
            .then(() => saveFY(fy, [...(get().txByFY[fy] ?? []), ...list]));
        }
      }
    },

    deleteTransactions(ids) {
      const idSet = new Set(ids);
      for (const [fy, list] of Object.entries(get().txByFY)) {
        if (!list.some((t) => idSet.has(t.id))) continue;
        saveFY(
          fy,
          list.filter((t) => !idSet.has(t.id)),
        );
      }
    },

    async applyRulesTo(fys, overwrite) {
      await get().ensureFYs(fys);
      let total = 0;
      for (const fy of fys) {
        const { txns, changed } = applyRules(get().txByFY[fy] ?? [], get().meta.rules, overwrite);
        if (changed) {
          total += changed;
          saveFY(fy, txns);
        }
      }
      return total;
    },

    recomputeSummaries(fys) {
      const summaries = { ...get().summaries };
      const cm = catMapOf(get().meta);
      for (const fy of fys ?? Object.keys(get().txByFY)) {
        const list = get().txByFY[fy];
        if (!list) continue;
        if (list.length) summaries[fy] = summarize(list, cm);
        else delete summaries[fy];
      }
      set({ summaries });
      persist(F.summaries, summaries);
    },

    saveAccount(acc) {
      get().update('meta', (m) => {
        const exists = m.accounts.some((a) => a.id === acc.id);
        return { ...m, accounts: exists ? m.accounts.map((a) => (a.id === acc.id ? acc : a)) : [...m.accounts, acc] };
      });
    },

    async deleteAccount(id) {
      const fys = [...new Set([...get().localTxFYs, ...Object.keys(get().summaries)])];
      await get().ensureFYs(fys);
      for (const [fy, list] of Object.entries(get().txByFY)) {
        if (list.some((t) => t.accountId === id))
          saveFY(
            fy,
            list.filter((t) => t.accountId !== id),
          );
      }
      get().update('meta', (m) => ({ ...m, accounts: m.accounts.filter((a) => a.id !== id) }));
    },

    saveCategories(categories) {
      get().update('meta', (m) => ({ ...m, categories }));
      get().recomputeSummaries();
    },

    saveRules(rules) {
      get().update('meta', (m) => ({ ...m, rules }));
    },

    saveCollection(b) {
      get().update('collections', (d) => ({ collections: d.collections.some((x) => x.id === b.id) ? d.collections.map((x) => (x.id === b.id ? b : x)) : [...d.collections, b] }));
    },

    async deleteCollection(id) {
      const fys = get().fysWith('collection', id);
      await get().ensureFYs(fys);
      for (const fy of fys) {
        const list = get().txByFY[fy] ?? [];
        if (list.some((t) => t.collectionId === id))
          saveFY(
            fy,
            list.map((t) => (t.collectionId === id ? { ...t, collectionId: null } : t)),
          );
      }
      get().update('collections', (d) => {
        const gone = d.collections.find((b) => b.id === id);
        return {
          collections: d.collections.filter((b) => b.id !== id).map((b) => (b.parentId === id ? { ...b, parentId: gone?.parentId ?? null } : b)),
        };
      });
    },

    async renameTag(from, to) {
      const fys = get().fysWith('tag', from);
      await get().ensureFYs(fys);
      let n = 0;
      for (const fy of fys) {
        const list = get().txByFY[fy] ?? [];
        if (!list.some((t) => t.tags?.includes(from))) continue;
        saveFY(
          fy,
          list.map((t) => {
            if (!t.tags?.includes(from)) return t;
            n++;
            const tags = [...new Set(t.tags.map((x) => (x === from ? to : x)).filter(Boolean))];
            return { ...t, tags };
          }),
        );
      }
      return n;
    },

    fysWith(kind, key) {
      return Object.entries(get().summaries)
        .filter(([, s]) => (kind === 'collection' ? s.byCollection : s.byTag)?.[key])
        .map(([fy]) => fy)
        .sort();
    },

    async upgradeSummaries() {
      const stale = Object.entries(get().summaries)
        .filter(([, s]) => !s.byTag || !s.byCollection)
        .map(([fy]) => fy);
      if (!stale.length) return;
      await get().ensureFYs(stale);
      get().recomputeSummaries(stale);
    },

    async refreshNavs(force = false) {
      const codes = get()
        .portfolio.assets.filter((a) => a.type === 'mutual_fund' && a.mf?.schemeCode && !a.closed)
        .map((a) => a.mf!.schemeCode!);
      if (!codes.length) return;
      const navs = await navsFor(codes, force);
      set({ navs: { ...get().navs, ...navs } });
    },

    takeSnapshot() {
      const s = get();
      const nw = computeNetWorth(s.portfolio.assets, s.liabilities.liabilities, s.meta.accounts, s.summaries, s.navs);
      s.update('networth', (d) => ({ snapshots: upsertSnapshot(d.snapshots, snapshotFrom(nw)) }));
    },

    async exportAll() {
      const s = get();
      const fys = [...new Set([...s.localTxFYs, ...Object.keys(s.summaries), ...remoteFYs('transactions')])];
      await s.ensureFYs(fys);
      const taxFys = [...new Set([...s.localTaxFYs, ...remoteFYs('tax')])];
      for (const fy of taxFys) await s.ensureTax(fy);
      const st = get();
      const files: Record<string, unknown> = {};
      for (const n of CORE_FILES) files[n] = st[n];
      for (const [fy, l] of Object.entries(st.txByFY)) if (l.length) files[txFile(fy)] = l;
      for (const [fy, t] of Object.entries(st.taxByFY)) files[taxFile(fy)] = t;
      return { app: 'nova', schemaVersion: 1, exportedAt: new Date().toISOString(), files };
    },

    async replaceAll(backup) {
      for (const [name, data] of Object.entries(backup.files)) await writeLocal(name, data);
      set({ txByFY: {}, taxByFY: {} });
      await reload(Object.keys(backup.files).filter((n) => (CORE_FILES as string[]).includes(n)));
      await get().ensureFYs([currentFY()]);
      schedulePush(500);
    },

    async resetAll() {
      await clearAll();
      set({ ...DEFAULTS, txByFY: {}, taxByFY: {}, localTxFYs: [], localTaxFYs: [], navs: {} });
      setPrivacyMode(false);
    },
  };
});

function remoteFYs(kind: 'transactions' | 'tax'): FY[] {
  return Object.keys(useSync.getState().remoteFiles)
    .filter((n) => n.startsWith(`${kind}/`))
    .map((n) => fyFromFile(n)!)
    .filter(Boolean);
}

/** Every FY we know has transactions (locally, in summaries, or on Drive) — newest first */
export function useKnownFYs(): FY[] {
  const local = useStore((s) => s.localTxFYs);
  const summaries = useStore((s) => s.summaries);
  const remote = useSync((s) => s.remoteFiles);
  return useMemo(() => {
    const set = new Set<FY>([...local, ...Object.keys(summaries), currentFY()]);
    for (const n of Object.keys(remote)) if (n.startsWith('transactions/')) set.add(fyFromFile(n)!);
    return [...set].filter(Boolean).sort().reverse();
  }, [local, summaries, remote]);
}

export function useCatMap() {
  const cats = useStore((s) => s.meta.categories);
  return useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
}

/** All-time totals per collection / tag, merged across FY summaries (no transactions loaded) */
export function useGroupTotals(kind: 'collection' | 'tag') {
  const summaries = useStore((s) => s.summaries);
  return useMemo(() => {
    const lists = new Map<string, (GroupTotals | undefined)[]>();
    for (const s of Object.values(summaries)) {
      for (const [k, g] of Object.entries((kind === 'collection' ? s.byCollection : s.byTag) ?? {})) {
        const arr = lists.get(k);
        if (arr) arr.push(g);
        else lists.set(k, [g]);
      }
    }
    const out = new Map<string, GroupTotals>();
    for (const [k, l] of lists) out.set(k, mergeGroups(l)!);
    return out;
  }, [summaries, kind]);
}
