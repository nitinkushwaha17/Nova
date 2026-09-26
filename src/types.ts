export type ID = string;
/** ISO date, YYYY-MM-DD */
export type ISODate = string;
/** Financial year label, e.g. "2025-26" */
export type FY = string;

// ─── Accounts / transactions ────────────────────────────────────────────────

export type AccountType = 'savings' | 'current' | 'credit_card' | 'wallet' | 'cash';

export interface ColumnMapping {
  date: string;
  description: string;
  debit?: string;
  credit?: string;
  /** Single signed amount column (used when debit/credit columns are absent) */
  amount?: string;
  /** For a single amount column with a separate Dr/Cr indicator column */
  drCr?: string;
  balance?: string;
  reference?: string;
  valueDate?: string;
  dateFormat?: 'auto' | 'DMY' | 'MDY' | 'YMD';
}

export interface Account {
  id: ID;
  name: string;
  type: AccountType;
  bank?: string;
  last4?: string;
  /** Include this account's balance in net worth */
  includeInNetWorth: boolean;
  /** Manual balance override (used when statements don't carry balances) */
  manualBalance?: { date: ISODate; value: number };
  columnMapping?: ColumnMapping;
  archived?: boolean;
  createdAt: string;
}

export interface Transaction {
  id: ID;
  accountId: ID;
  date: ISODate;
  valueDate?: ISODate | null;
  description: string;
  rawDescription?: string;
  reference?: string;
  /** Signed: positive = money in (credit), negative = money out (debit) */
  amount: number;
  balance?: number | null;
  category?: string | null;
  subcategory?: string | null;
  notes?: string;
  /** Free-form labels (normalised: lowercase, dashes), many per transaction */
  tags?: string[];
  /** The event / purpose this belongs to (a trip, a wedding…) — at most one */
  collectionId?: ID | null;
  /** Manually marked as transfer (true) / not transfer (false); undefined = auto */
  isTransfer?: boolean;
  /** Auto-detected transfer (self-transfer pair / sweep) */
  autoTransfer?: boolean;
  importId?: string;
}

export type CategoryKind = 'expense' | 'income' | 'investment' | 'transfer';

export interface Category {
  id: string;
  name: string;
  color: string;
  kind: CategoryKind;
  subcategories: string[];
}

export interface Rule {
  id: ID;
  pattern: string;
  matchType: 'contains' | 'regex';
  category: string;
  subcategory?: string;
  /** Restrict to debits or credits */
  direction?: 'any' | 'debit' | 'credit';
  /** Higher runs first */
  priority: number;
}

export interface MetaDoc {
  accounts: Account[];
  categories: Category[];
  rules: Rule[];
}

// ─── Summaries (lightweight aggregates so charts don't need all transactions) ─

export interface MonthSummary {
  income: number;
  expense: number;
  investment: number;
  transferIn: number;
  transferOut: number;
  /** Net expense per category (debits minus refunds) */
  expenseByCategory: Record<string, number>;
  incomeByCategory: Record<string, number>;
  count: number;
}

export interface FYSummary {
  months: Record<string, MonthSummary>;
  count: number;
  /** Latest known balance per account within this FY */
  lastBalances: Record<ID, { date: ISODate; balance: number }>;
  /** Totals per collection id (absent in summaries written before collections existed) */
  byCollection?: Record<ID, GroupTotals>;
  /** Totals per tag */
  byTag?: Record<string, GroupTotals>;
  updatedAt: string;
}

/** Money out / in for a collection or tag. Self-transfers are excluded. */
export interface GroupTotals {
  spent: number;
  received: number;
  count: number;
  first: ISODate;
  last: ISODate;
}

// ─── Collections ────────────────────────────────────────────────────────────────

export type CollectionKind = 'trip' | 'event' | 'project' | 'home' | 'other';

export interface Collection {
  id: ID;
  name: string;
  kind: CollectionKind;
  emoji?: string;
  color: string;
  startDate?: ISODate;
  endDate?: ISODate;
  budget?: number;
  notes?: string;
  archived?: boolean;
  /** Parent collection, e.g. "Paris" inside "Europe 2026". Totals roll up to ancestors. */
  parentId?: ID | null;
  createdAt: string;
}

export interface CollectionsDoc {
  collections: Collection[];
}

export type SummariesDoc = Record<FY, FYSummary>;

// ─── Portfolio ──────────────────────────────────────────────────────────────

export type AssetType = 'fd' | 'rd' | 'mutual_fund' | 'stocks' | 'ppf' | 'epf' | 'nps' | 'gold' | 'bond' | 'real_estate' | 'crypto' | 'cash' | 'other';

export interface Valuation {
  date: ISODate;
  value: number;
}

/** Money put into (positive) or taken out of (negative) an asset */
export interface CashFlow {
  id: ID;
  date: ISODate;
  amount: number;
  note?: string;
}

export interface DepositDetails {
  principal: number;
  /** Annual rate, percent */
  rate: number;
  startDate: ISODate;
  maturityDate: ISODate;
  /** Compounding periods per year */
  compounding: 1 | 2 | 4 | 12;
  /** RD monthly installment */
  installment?: number;
  payout: 'cumulative' | 'payout';
}

export interface Asset {
  id: ID;
  type: AssetType;
  name: string;
  institution?: string;
  notes?: string;
  closed?: boolean;
  deposit?: DepositDetails;
  mf?: { schemeCode?: string; schemeName?: string; units: number };
  /** Manual valuations (latest wins) */
  valuations: Valuation[];
  /** Contributions / withdrawals (not used for FD/RD, which are derived) */
  flows: CashFlow[];
  createdAt: string;
  /** Source identity for assets synced from statements (e.g. an SBI FD number), used to update them on re-import */
  ref?: string;
}

export interface PortfolioDoc {
  assets: Asset[];
}

// ─── Liabilities ────────────────────────────────────────────────────────────

export type LiabilityType = 'home_loan' | 'car_loan' | 'personal_loan' | 'education_loan' | 'gold_loan' | 'credit_card' | 'other';

export interface Liability {
  id: ID;
  type: LiabilityType;
  name: string;
  lender?: string;
  /** Amortising loan details (absent for credit cards / manual liabilities) */
  loan?: {
    principal: number;
    rate: number;
    tenureMonths: number;
    startDate: ISODate;
    prepayments: { id: ID; date: ISODate; amount: number }[];
  };
  /** Manual outstanding values (credit cards, or override) */
  valuations: Valuation[];
  closed?: boolean;
  notes?: string;
  createdAt: string;
}

export interface LiabilitiesDoc {
  liabilities: Liability[];
}

// ─── Net worth ──────────────────────────────────────────────────────────────

export interface NetWorthSnapshot {
  /** YYYY-MM */
  month: string;
  date: ISODate;
  assets: number;
  liabilities: number;
  netWorth: number;
  byAssetType: Partial<Record<AssetType | 'bank', number>>;
}

export interface NetWorthDoc {
  snapshots: NetWorthSnapshot[];
}

// ─── Taxes ──────────────────────────────────────────────────────────────────

export type Regime = 'new' | 'old';
export type AgeBand = 'below60' | '60to80' | 'above80';

export interface TaxPayment {
  id: ID;
  date: ISODate;
  kind: 'tds' | 'tcs' | 'advance' | 'self_assessment';
  amount: number;
  note?: string;
}

export interface TaxYear {
  fy: FY;
  preferredRegime: Regime | 'auto';
  ageBand: AgeBand;
  income: {
    salary: number;
    /** Interest, dividends, other sources */
    otherSources: number;
    /** Net income from house property (can be negative) */
    houseProperty: number;
    business: number;
  };
  capitalGains: {
    /** Listed equity STCG (s.111A) */
    stcgEquity: number;
    /** Listed equity LTCG (s.112A), before exemption */
    ltcgEquity: number;
    /** Other STCG taxed at slab */
    stcgOther: number;
    /** Other LTCG (s.112) at flat rate */
    ltcgOther: number;
  };
  deductions: {
    c80: number;
    ccd1b80: number;
    ccd2Employer80: number;
    d80: number;
    hraExempt: number;
    homeLoanInterest24b: number;
    e80: number;
    g80: number;
    tta80: number;
    professionalTax: number;
    other: number;
  };
  hraHelper?: { basicDA: number; hraReceived: number; rentPaid: number; metro: boolean };
  payments: TaxPayment[];
  notes?: string;
}

// ─── Planning ───────────────────────────────────────────────────────────────

export interface Budget {
  id: ID;
  category: string;
  monthlyLimit: number;
}

export interface Goal {
  id: ID;
  name: string;
  targetAmount: number;
  targetDate: ISODate;
  /** Target is in today's money and will be inflated */
  inflationAdjust: boolean;
  expectedReturn: number;
  linkedAssetIds: ID[];
  manualSaved: number;
  color: string;
  createdAt: string;
}

export interface InsurancePolicy {
  id: ID;
  kind: 'term' | 'health' | 'life' | 'vehicle' | 'home' | 'other';
  name: string;
  insurer?: string;
  policyNumber?: string;
  sumAssured: number;
  premium: number;
  frequency: 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'single';
  renewalDate?: ISODate;
  notes?: string;
}

export interface PlanningDoc {
  budgets: Budget[];
  goals: Goal[];
  insurance: InsurancePolicy[];
  /** Months of expenses targeted for emergency fund */
  emergencyMonths: number;
  emergencyAssetIds: ID[];
}

// ─── CPI / settings ─────────────────────────────────────────────────────────

export interface CpiDoc {
  /** Annual CPI inflation (percent) by FY */
  rates: Record<FY, number>;
  /** Assumed inflation for future / missing years */
  defaultRate: number;
}

export interface SettingsDoc {
  theme: 'dark' | 'light';
  currencySymbol: string;
  displayName?: string;
  /** Hide amounts (privacy mode) */
  privacy: boolean;
  /** Passwords tried automatically when an imported statement is encrypted */
  statementPasswords?: StatementPassword[];
}

export interface StatementPassword {
  id: string;
  /** e.g. "SBI e-statement" */
  label: string;
  password: string;
}

// ─── Storage / sync ─────────────────────────────────────────────────────────

export interface StoredFile<T = unknown> {
  name: string;
  data: T;
  /** Incremented on every local change */
  localRev: number;
  /** Manifest revision last synced with Drive */
  remoteRev: number;
  dirty: boolean;
  updatedAt: string;
}

export interface Manifest {
  schemaVersion: number;
  updatedAt: string;
  files: Record<string, { rev: number; updatedAt: string; device: string }>;
}
