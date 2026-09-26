import { describe, expect, it } from 'vitest';
import type { Account } from '../types';
import { accountFor, parseSms, smsDate, smsToTransactions, type RawSms } from './sms';

const at = Date.parse('2025-09-12T10:30:00+05:30');
const msg = (address: string, body: string, date = at): RawSms => ({ id: Math.random().toString(36).slice(2), address, body, date });

describe('parseSms', () => {
  it('reads an SBI UPI debit', () => {
    const t = parseSms(msg('VM-SBIUPI', 'Dear UPI user A/C X1234 debited by 250.0 on date 12Sep25 trf to SWIGGY Refno 525512345678. If not u? call 1800111109. -SBI'))!;
    expect(t).toMatchObject({ bank: 'SBI', last4: '1234', date: '2025-09-12', amount: -250, counterparty: 'SWIGGY', reference: '525512345678', kind: 'upi' });
    expect(t.description).toBe('UPI to SWIGGY');
  });

  it('reads an SBI credit with the sender name', () => {
    const t = parseSms(msg('AD-SBIINB', 'Dear SBI User, your A/c X1234-credited by Rs.5000 on 11Sep25 transfer from JOHN DOE Ref No 525587654321 -SBI'))!;
    expect(t).toMatchObject({ last4: '1234', date: '2025-09-11', amount: 5000, counterparty: 'JOHN DOE', reference: '525587654321' });
  });

  it('reads an account debit with available balance', () => {
    const t = parseSms(msg('JD-SBIINB-S', 'Your A/C XXXXX1234 Debited INR 1,500.00 on 12/09/25 -Deposit by transfer to ACME LTD. Avl Bal INR 10,250.50-SBI'))!;
    expect(t).toMatchObject({ last4: '1234', amount: -1500, balance: 10250.5, date: '2025-09-12', counterparty: 'ACME LTD' });
  });

  it('reads HDFC and ICICI UPI formats', () => {
    expect(parseSms(msg('VK-HDFCBK', 'Sent Rs.349.00 From HDFC Bank A/C *5678 To ZOMATO On 12/09/25 Ref 525511112222 Not You? Call 18002586161'))).toMatchObject({
      bank: 'HDFC',
      last4: '5678',
      amount: -349,
      counterparty: 'ZOMATO',
      reference: '525511112222',
    });
    expect(parseSms(msg('AX-ICICIT', 'ICICI Bank Acct XX123 debited for Rs 120.00 on 12-Sep-25; UBER INDIA credited. UPI:525533334444. Call 18002662 for dispute.'))).toMatchObject(
      {
        bank: 'ICICI',
        last4: '123',
        amount: -120,
        counterparty: 'UBER INDIA',
        reference: '525533334444',
        date: '2025-09-12',
      },
    );
  });

  it('reads a card spend', () => {
    const t = parseSms(msg('VM-SBICRD', 'Rs.2,499.00 spent on your SBI Credit Card ending 4321 at AMAZON on 10/09/25. Trxn. not done by you? Report at https://sbicard.com'))!;
    expect(t).toMatchObject({ last4: '4321', amount: -2499, counterparty: 'AMAZON', kind: 'card', date: '2025-09-10' });
  });

  it('ignores OTPs, reminders, requests, failures and personal numbers', () => {
    expect(parseSms(msg('VM-SBIOTP', 'OTP for txn of Rs 500 at AMAZON is 123456. Do not share.'))).toBeNull();
    expect(parseSms(msg('VM-HDFCBK', 'Rs 5000 will be debited from your a/c 5678 on 15-09-25 towards EMI'))).toBeNull();
    expect(parseSms(msg('VM-ICICIB', 'Your credit card bill of Rs 12,000 is due on 20-Sep-25'))).toBeNull();
    expect(parseSms(msg('VM-SBIUPI', 'JOHN has requested money of Rs 200 from you on UPI'))).toBeNull();
    expect(parseSms(msg('VM-SBIUPI', 'Your UPI txn of Rs 300 failed'))).toBeNull();
    expect(parseSms(msg('+919876543210', 'Sent Rs 500 to you, check your a/c 1234'))).toBeNull();
    expect(parseSms(msg('VM-AMAZON', 'Your order has shipped'))).toBeNull();
  });
});

describe('smsDate', () => {
  it('falls back to the received date when the date is missing or implausible', () => {
    expect(smsDate('debited Rs 5', at)).toBe('2025-09-12');
    expect(smsDate('debited Rs 5 on 01/01/20', at)).toBe('2025-09-12');
    expect(smsDate('debited Rs 5 on 2025-09-10', at)).toBe('2025-09-10');
  });
});

describe('account mapping', () => {
  const acc = (p: Partial<Account>): Account => ({ id: 'x', name: 'X', type: 'savings', includeInNetWorth: true, createdAt: '', ...p });
  const accounts = [acc({ id: 'sbi', bank: 'SBI', last4: '1234' }), acc({ id: 'hdfc', bank: 'HDFC', last4: '5678' }), acc({ id: 'icici', bank: 'ICICI' })];

  it('matches by digits, then by the only account at that bank', () => {
    const p = (a: string, b: string) => parseSms(msg(a, b))!;
    expect(accountFor(p('VM-SBIUPI', 'A/C X1234 debited by 10.0 on date 12Sep25 trf to A Refno 525512345678'), accounts)?.id).toBe('sbi');
    expect(accountFor(p('AX-ICICIT', 'ICICI Bank debited for Rs 120.00 on 12-Sep-25; UBER credited.'), accounts)?.id).toBe('icici');
    expect(accountFor(p('VM-SBIUPI', 'A/C X9999 debited by 10.0 on date 12Sep25 trf to A'), accounts)).toBeUndefined();
  });

  it('builds unconfirmed transactions and groups unknown accounts', () => {
    const parsed = [
      parseSms(msg('VM-SBIUPI', 'A/C X1234 debited by 10.0 on date 12Sep25 trf to A Refno 525512345678'))!,
      parseSms(msg('VM-SBIUPI', 'A/C X9999 debited by 20.0 on date 11Sep25 trf to B'))!,
      parseSms(msg('VM-SBIUPI', 'A/C X9999 debited by 30.0 on date 10Sep25 trf to C'))!,
    ];
    const { txns, unlinked } = smsToTransactions(parsed, accounts);
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ accountId: 'sbi', amount: -10, source: 'sms', balance: null, reference: '525512345678' });
    expect(unlinked).toEqual([{ last4: '9999', bank: 'SBI', count: 2, oldest: '2025-09-10' }]);
  });
});
