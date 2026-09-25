import type { CpiDoc, FY, ISODate } from '../types';
import { fyOf, fyStartYear, parseISO, shiftFY, todayISO } from './dates';

/** Annual inflation (decimal) for a FY */
export function rateFor(cpi: CpiDoc, fy: FY): number {
  return (cpi.rates[fy] ?? cpi.defaultRate) / 100;
}

const BASE_FY = '2000-01';

/**
 * Price index at a date (1.0 at start of BASE_FY), compounding each FY's inflation monthly.
 * Years without data use the default rate.
 */
export function cpiIndex(cpi: CpiDoc, date: ISODate): number {
  const fy = fyOf(date);
  let idx = 1;
  let f = BASE_FY;
  while (fyStartYear(f) < fyStartYear(fy)) {
    idx *= 1 + rateFor(cpi, f);
    f = shiftFY(f, 1);
  }
  const start = parseISO(`${fyStartYear(fy)}-04-01`);
  const frac = Math.max(0, (parseISO(date).getTime() - start.getTime()) / (365 * 86400000));
  return idx * Math.pow(1 + rateFor(cpi, fy), frac);
}

/** Convert an amount from money-of-`from` date into money-of-`to` date */
export function adjustForInflation(cpi: CpiDoc, amount: number, from: ISODate, to: ISODate = todayISO()): number {
  return amount * (cpiIndex(cpi, to) / cpiIndex(cpi, from));
}

/** Cumulative inflation between two dates (0.25 = prices rose 25%) */
export function inflationBetween(cpi: CpiDoc, from: ISODate, to: ISODate = todayISO()): number {
  return cpiIndex(cpi, to) / cpiIndex(cpi, from) - 1;
}

/** Annualised inflation between two dates */
export function annualisedInflation(cpi: CpiDoc, from: ISODate, to: ISODate = todayISO()): number {
  const years = (parseISO(to).getTime() - parseISO(from).getTime()) / (365 * 86400000);
  if (years <= 0) return rateFor(cpi, fyOf(from));
  return Math.pow(1 + inflationBetween(cpi, from, to), 1 / years) - 1;
}
