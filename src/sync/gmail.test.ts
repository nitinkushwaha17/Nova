import { describe, expect, it } from 'vitest';
import { attachmentsOf, base64UrlToBytes, DEFAULT_GMAIL_QUERY, gmailQueryOf, subjectPhrases } from './gmail';

describe('gmail helpers', () => {
  it('finds importable attachments in nested MIME parts', () => {
    const payload = {
      parts: [
        { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { size: 900 } }] },
        { filename: 'Statement_Aug.pdf', body: { attachmentId: 'a1', size: 5000 } },
        { filename: 'logo.png', body: { attachmentId: 'a2', size: 100 } },
        { mimeType: 'multipart/mixed', parts: [{ filename: 'txns.XLSX', body: { attachmentId: 'a3' } }] },
      ],
    };
    expect(attachmentsOf('m1', payload)).toEqual([
      { messageId: 'm1', attachmentId: 'a1', filename: 'Statement_Aug.pdf', size: 5000 },
      { messageId: 'm1', attachmentId: 'a3', filename: 'txns.XLSX', size: 0 },
    ]);
  });

  it('decodes base64url attachment data', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xfb, 0xff]);
    const b64url = Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect([...base64UrlToBytes(b64url)]).toEqual([...bytes]);
  });

  it('default query is limited to SBI e-statement mails', () => {
    expect(subjectPhrases(DEFAULT_GMAIL_QUERY)).toEqual(['e-account statement for your sbi account']);
    const ok = (s: string) => subjectPhrases(DEFAULT_GMAIL_QUERY).every((p) => s.toLowerCase().includes(p));
    expect(ok('E-account statement for your SBI account(s)')).toBe(true);
    expect(ok('TDS Certificate (Form 16A) for your SBI account')).toBe(false);
  });

  it('saved copies of old defaults fall back to the current default', () => {
    expect(gmailQueryOf('(from:sbi.co.in OR from:sbi.bank.in) has:attachment filename:pdf newer_than:1y')).toBe(DEFAULT_GMAIL_QUERY);
    expect(gmailQueryOf(undefined)).toBe(DEFAULT_GMAIL_QUERY);
    expect(gmailQueryOf('from:hdfcbank.net')).toBe('from:hdfcbank.net');
  });
});
