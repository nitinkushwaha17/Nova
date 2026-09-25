# Nova — personal finance tracker

A private, local-first finance app for tracking your whole financial life in India. It covers bank statements, spending, taxes, investments, loans, net worth and inflation. Nova has no server. Your data lives in your browser and syncs to a hidden folder in **your own Google Drive**.

## Features

| Area | What you get |
| --- | --- |
| **Import** | CSV / TSV / XLS / XLSX / ODS statements from any bank, with auto-detected columns and a manual mapping fallback. Duplicate detection, transfer detection, and a per-account balance trail. Also imports backups from the old Bank-statement-analyser. |
| **Transactions** | Search, filters, and single or bulk categorisation. Rules auto-categorise new imports and can be re-applied to history. |
| **Categories & rules** | Editable categories and subcategories (expense / income / investment / transfer), plus regex or "contains" rules. |
| **Analytics** | Any period: income, spending, investments and savings rate. Category donut with drill-down, top merchants, recurring payments, largest expenses, income sources, and GST paid by category. |
| **Assets** | FD / RD (maturity maths), mutual funds (live NAV from mfapi.in), stocks (one aggregate value updated manually), PPF, EPF, NPS, gold, bonds, real estate, crypto, cash and more. Shows invested amount, gain and XIRR per asset and for the whole portfolio. |
| **Liabilities** | Amortising loans with prepayments (interest saved, what-if calculator, yearly schedule), credit cards and other debts. |
| **Net worth** | Automatic monthly snapshots that you can backfill, a history chart in nominal terms or "today's money", and a breakdown by type. |
| **Taxes** | Per financial year: old vs new regime, slabs, rebate, surcharge and cess, capital gains, and deductions with limits. Deductions are suggested from your data (PPF/EPF, premiums, home-loan interest and principal). Also covers the HRA calculator, TDS / advance / self-assessment payments, the advance-tax schedule, and the total direct + indirect (GST) tax burden. |
| **Inflation** | Editable CPI table, a money time machine, real returns on each asset, and net worth and spending in today's money. |
| **Planning** | Budgets vs actuals with pacing and suggestions, inflation-aware goals linked to assets (with the SIP you need), emergency-fund coverage, and insurance with renewals and cover checks. |
| **Calculator** | Lump sum + SIP with yearly step-up and chosen compounding, shown in nominal and real terms, plus a reverse "how much should I invest" mode. |
| **Dashboard** | Net worth, FY cash flow vs last year, top spending, and upcoming FD maturities, premiums and advance-tax dates. |

Privacy mode (Settings) blurs every amount on screen.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (tax, finance, parsers…)
npm run build      # production build in dist/ (installable PWA, works offline)
```

The app works without Google Drive. Data then stays only in this browser, so export a backup from **Settings → Backup & restore** regularly.

## Google Drive setup (one time)

Nova uses the Drive **appDataFolder** scope (`drive.appdata`). This is a hidden, app-private folder: Nova cannot see any of your other Drive files, and they cannot see Nova's.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project, for example "Nova".
2. Go to **APIs & Services → Library** and enable the **Google Drive API**.
3. Go to **APIs & Services → OAuth consent screen**:
   - Choose User type **External**, then fill in the app name and your email.
   - Add the scopes `.../auth/drive.appdata` and `.../auth/userinfo.email`.
   - Under **Test users**, add your own Google account. Keeping the app in "Testing" is fine for personal use.
4. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorised JavaScript origins: `http://localhost:5173`. Also add `http://localhost:4173` if you use `npm run preview`, plus any domain you deploy to. No redirect URI is needed.
5. Give Nova the client ID in one of two ways:
   - Put it in `.env.local` as `VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com`, or
   - Paste it in **Settings → Google OAuth Client ID** (stored only in this browser).
6. Click **Connect Google Drive** in Settings.

Google access tokens last about an hour. When one expires, Nova keeps working locally and shows a "Reconnect" button. Nothing is lost; pending changes upload after you reconnect.

## How data is stored

### In Google Drive (source of truth across devices)

The data is split into small JSON files, so Nova only downloads what a screen needs:

| File | Contents | Loaded |
| --- | --- | --- |
| `manifest.json` | Revision and timestamp of every other file, used to detect what changed | every sync |
| `settings.json` | Theme, display name, privacy mode | at startup |
| `meta.json` | Accounts, categories, rules | at startup |
| `summaries.json` | Pre-aggregated monthly totals per FY and category, plus last account balances. Powers the dashboard, budgets and most charts without loading transactions. | at startup |
| `portfolio.json` | Assets with contributions and valuations | at startup |
| `liabilities.json` | Loans (with prepayments), credit cards, other debts | at startup |
| `networth.json` | Monthly net worth snapshots | at startup |
| `planning.json` | Budgets, goals, insurance, emergency-fund settings | at startup |
| `cpi.json` | Your inflation table | at startup |
| `transactions__FY2025-26.json` | All transactions of one financial year (one file per FY) | when a screen needs that FY |
| `tax__FY2025-26.json` | Income, deductions and tax payments of one FY | when you open that FY's taxes |

Files are plain, readable JSON. **Settings → Backup & restore → Export everything** downloads all of them as one file.

### In the browser (IndexedDB database `nova`)

IndexedDB is a local cache and offline store. It has three object stores:

- **`files`**: one record per file above, with the same `name` and `data`, plus sync bookkeeping (`localRev`, `remoteRev`, `dirty`, `updatedAt`). Every edit is written here first, so the app is instant and works offline. Dirty files are uploaded to Drive in the background, debounced.
- **`sync`**: the last Drive manifest seen, the last sync time and a device ID.
- **`priceCache`**: the latest mutual-fund NAVs from mfapi.in, so values show without a network call.

When the app starts, it reads the core files from IndexedDB, then pulls anything newer from Drive. Per-FY transaction and tax files are pulled only when you view that year. If the same file changed on two devices before syncing, Settings shows a conflict and lets you keep the local or the Drive version.

## Notes and assumptions

- **Tax rules** cover FY 2023-24 onwards, including the Budget 2025 new-regime slabs. Later years reuse the latest known rules. Capital-gains rates for FY 2024-25 use the post-23-July-2024 rates. Surcharge marginal relief is approximate. Treat the result as a planning estimate, not a filing tool.
- **GST** is estimated from category-level typical rates. Other indirect taxes (fuel duty, stamp duty, customs) are not included.
- **CPI** values are pre-filled approximations, and recent years are estimates. Edit them on the Inflation page as official data is published.
- **Stocks** are tracked as a single aggregate value that you update manually. Mutual-fund NAVs come from [mfapi.in](https://www.mfapi.in/), which covers Indian mutual funds only.
- PDF statements are not supported. Download the Excel/CSV version from net banking.

## Tech

React 19, TypeScript, Vite, Tailwind CSS v4, zustand, idb, recharts, SheetJS and Vitest. Pages are lazy-loaded. A small service worker (`public/sw.js`, production only) caches the app shell for offline use.
