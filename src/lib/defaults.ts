import type {
  Category,
  CpiDoc,
  LiabilitiesDoc,
  MetaDoc,
  NetWorthDoc,
  PlanningDoc,
  PortfolioDoc,
  SettingsDoc,
  SummariesDoc,
} from '../types';

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'food', name: 'Food & Dining', color: '#fb7185', kind: 'expense', subcategories: ['Restaurants', 'Groceries', 'Food Delivery', 'Coffee & Tea', 'Fast Food'] },
  { id: 'transport', name: 'Transport', color: '#2dd4bf', kind: 'expense', subcategories: ['Fuel', 'Public Transport', 'Cab/Taxi', 'Parking', 'Vehicle Maintenance', 'Tolls'] },
  { id: 'shopping', name: 'Shopping', color: '#38bdf8', kind: 'expense', subcategories: ['Clothing', 'Electronics', 'Home & Garden', 'Personal Care', 'Online Shopping'] },
  { id: 'housing', name: 'Housing', color: '#a3e635', kind: 'expense', subcategories: ['Rent', 'Maintenance', 'Repairs', 'Furniture', 'Household Help'] },
  { id: 'utilities', name: 'Utilities & Bills', color: '#4ade80', kind: 'expense', subcategories: ['Electricity', 'Water', 'Gas', 'Internet', 'Mobile', 'DTH/Cable'] },
  { id: 'entertainment', name: 'Entertainment', color: '#c084fc', kind: 'expense', subcategories: ['Movies', 'Streaming Services', 'Games', 'Events', 'Subscriptions'] },
  { id: 'travel', name: 'Travel', color: '#f472b6', kind: 'expense', subcategories: ['Flights', 'Trains', 'Hotels', 'Holidays', 'Visa & Forex'] },
  { id: 'health', name: 'Health', color: '#34d399', kind: 'expense', subcategories: ['Doctor', 'Pharmacy', 'Gym/Fitness', 'Medical Tests', 'Hospital'] },
  { id: 'insurance', name: 'Insurance', color: '#818cf8', kind: 'expense', subcategories: ['Health Insurance', 'Term Insurance', 'Life Insurance', 'Vehicle Insurance'] },
  { id: 'education', name: 'Education', color: '#facc15', kind: 'expense', subcategories: ['Courses', 'Books', 'Tuition', 'School/College Fees', 'Stationery'] },
  { id: 'personal', name: 'Personal', color: '#fdba74', kind: 'expense', subcategories: ['Salon', 'Gifts', 'Donations', 'Pets', 'Hobbies'] },
  { id: 'family', name: 'Family', color: '#f9a8d4', kind: 'expense', subcategories: ['Parents', 'Kids', 'Spouse'] },
  { id: 'emi', name: 'EMI & Loans', color: '#f87171', kind: 'expense', subcategories: ['Home Loan', 'Car Loan', 'Personal Loan', 'Education Loan', 'Credit Card Bill', 'Credit Card Charges'] },
  { id: 'taxes', name: 'Taxes', color: '#e11d48', kind: 'expense', subcategories: ['Income Tax', 'Advance Tax', 'Property Tax', 'Other Tax'] },
  { id: 'cash', name: 'ATM & Cash', color: '#fbbf24', kind: 'expense', subcategories: ['ATM Withdrawal', 'Bank Charges'] },
  { id: 'other', name: 'Other', color: '#94a3b8', kind: 'expense', subcategories: ['Miscellaneous'] },
  { id: 'income', name: 'Income', color: '#22c55e', kind: 'income', subcategories: ['Salary', 'Bonus', 'Freelance', 'Interest', 'Dividend', 'Rental', 'Cashback', 'Gift', 'Other Income'] },
  { id: 'investment', name: 'Investments', color: '#60a5fa', kind: 'investment', subcategories: ['Mutual Funds', 'Stocks', 'Fixed Deposit', 'Recurring Deposit', 'PPF', 'NPS', 'EPF/VPF', 'Gold', 'Crypto'] },
  { id: 'transfer', name: 'Transfers', color: '#a78bfa', kind: 'transfer', subcategories: ['Self Transfer', 'Credit Card Payment', 'Wallet Top-up', 'Sweep'] },
];

/** India CPI (combined) annual inflation by financial year, %. Editable in app. */
export const DEFAULT_CPI: CpiDoc = {
  rates: {
    '2012-13': 10.0,
    '2013-14': 9.4,
    '2014-15': 5.9,
    '2015-16': 4.9,
    '2016-17': 4.5,
    '2017-18': 3.6,
    '2018-19': 3.4,
    '2019-20': 4.8,
    '2020-21': 6.2,
    '2021-22': 5.5,
    '2022-23': 6.7,
    '2023-24': 5.4,
    '2024-25': 4.6,
    '2025-26': 2.5,
  },
  defaultRate: 5.5,
};

export const DEFAULT_SETTINGS: SettingsDoc = { theme: 'dark', currencySymbol: '₹', privacy: false };
export const DEFAULT_META: MetaDoc = { accounts: [], categories: DEFAULT_CATEGORIES, rules: [] };
export const DEFAULT_PORTFOLIO: PortfolioDoc = { assets: [] };
export const DEFAULT_LIABILITIES: LiabilitiesDoc = { liabilities: [] };
export const DEFAULT_NETWORTH: NetWorthDoc = { snapshots: [] };
export const DEFAULT_PLANNING: PlanningDoc = { budgets: [], goals: [], insurance: [], emergencyMonths: 6, emergencyAssetIds: [] };
export const DEFAULT_SUMMARIES: SummariesDoc = {};

export const PALETTE = [
  '#818cf8', '#22d3ee', '#34d399', '#fbbf24', '#fb7185', '#c084fc', '#f472b6', '#a3e635', '#38bdf8', '#fdba74', '#94a3b8', '#2dd4bf',
];
