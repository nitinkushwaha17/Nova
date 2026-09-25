import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner, Toaster } from './components/ui';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Import = lazy(() => import('./pages/Import'));
const Accounts = lazy(() => import('./pages/Accounts'));
const Categories = lazy(() => import('./pages/Categories'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Assets = lazy(() => import('./pages/Assets'));
const Liabilities = lazy(() => import('./pages/Liabilities'));
const NetWorth = lazy(() => import('./pages/NetWorth'));
const Taxes = lazy(() => import('./pages/Taxes'));
const Planning = lazy(() => import('./pages/Planning'));
const Inflation = lazy(() => import('./pages/Inflation'));
const Calculator = lazy(() => import('./pages/Calculator'));
const Collections = lazy(() => import('./pages/Collections'));
const Settings = lazy(() => import('./pages/Settings'));

const pages = [
  ['/', Dashboard],
  ['/transactions', Transactions],
  ['/import', Import],
  ['/accounts', Accounts],
  ['/categories', Categories],
  ['/collections', Collections],
  ['/collections/:id', Collections],
  ['/analytics', Analytics],
  ['/assets', Assets],
  ['/liabilities', Liabilities],
  ['/networth', NetWorth],
  ['/taxes', Taxes],
  ['/planning', Planning],
  ['/inflation', Inflation],
  ['/calculator', Calculator],
  ['/settings', Settings],
] as const;

export default function App() {
  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <div className="grid h-screen place-items-center">
            <Spinner className="size-6" />
          </div>
        }
      >
        <Routes>
          <Route element={<Layout />}>
            {pages.map(([path, Page]) => (
              <Route
                key={path}
                path={path}
                element={
                  <Suspense fallback={<Spinner className="m-8 size-6" />}>
                    <Page />
                  </Suspense>
                }
              />
            ))}
            <Route path="*" element={<Dashboard />} />
          </Route>
        </Routes>
      </Suspense>
      <Toaster />
    </BrowserRouter>
  );
}