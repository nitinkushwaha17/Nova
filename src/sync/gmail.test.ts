import { describe, expect, it } from 'vitest';
import { attachmentsOf, base64UrlToBytes } from './gmail';

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
});
