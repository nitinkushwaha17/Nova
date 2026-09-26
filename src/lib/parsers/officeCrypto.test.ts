import { createCipheriv, createHash, randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { PasswordError } from './officeCrypto';
import { findHeaderRow, readRows, rowsToTransactions } from './tabular';

const fixture = (name: string) => new File([new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)))], name);

function plainWorkbook(): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Date', 'Narration', 'Debit', 'Credit'],
    ['05/06/2025', 'AMAZON', '1200', ''],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'S');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** Builds an ECMA-376 Standard-encrypted (Excel 2007 style, AES-128) file with Node's crypto */
function standardEncrypt(zip: Buffer, password: string): Buffer {
  const sha1 = (...p: Buffer[]) => createHash('sha1').update(Buffer.concat(p)).digest();
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const ecb = (key: Buffer, data: Buffer) => {
    const c = createCipheriv('aes-128-ecb', key, null).setAutoPadding(false);
    return Buffer.concat([c.update(data), c.final()]);
  };
  const salt = randomBytes(16);
  let h = sha1(salt, Buffer.from(password, 'utf16le'));
  for (let i = 0; i < 50000; i++) h = sha1(u32(i), h);
  h = sha1(h, u32(0));
  const x = (fill: number) => {
    const b = Buffer.alloc(64, fill);
    for (let i = 0; i < 20; i++) b[i] ^= h[i];
    return sha1(b);
  };
  const key = Buffer.concat([x(0x36), x(0x5c)]).subarray(0, 16);
  const verifier = randomBytes(16);
  const verifierHash = Buffer.concat([sha1(verifier), Buffer.alloc(12)]);
  const csp = Buffer.from('Microsoft Enhanced RSA and AES Cryptographic Provider\0', 'utf16le');
  const header = Buffer.concat([u32(0x24), u32(0), u32(0x660e), u32(0x8004), u32(128), u32(0x18), u32(0), u32(0), csp]);
  const info = Buffer.concat([Buffer.from([3, 0, 2, 0]), u32(0x24), u32(header.length), header, u32(16), salt, ecb(key, verifier), u32(20), ecb(key, verifierHash)]);
  const size = Buffer.alloc(8);
  size.writeUInt32LE(zip.length);
  const padded = Buffer.concat([zip, Buffer.alloc((16 - (zip.length % 16)) % 16)]);
  const pkg = Buffer.concat([size, ecb(key, padded)]);
  const cfb = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(cfb, '/EncryptionInfo', info);
  XLSX.CFB.utils.cfb_add(cfb, '/EncryptedPackage', pkg);
  return XLSX.CFB.write(cfb, { type: 'buffer' }) as Buffer;
}

describe('password-protected Excel', () => {
  it('decrypts Agile (Excel 2010+) workbooks', async () => {
    const rows = await readRows(fixture('agile-secret123.xlsx'), 'secret123');
    const { index, mapping } = findHeaderRow(rows);
    const { transactions } = rowsToTransactions(rows, index, mapping!, 'a');
    expect(transactions.map((t) => [t.date, t.description, t.amount])).toEqual([
      ['2025-04-01', 'UPI-SWIGGY', -450],
      ['2025-04-02', 'SALARY APRIL', 85000],
    ]);
  }, 20000);

  it('asks for a password, and rejects a wrong one', async () => {
    await expect(readRows(fixture('agile-secret123.xlsx'))).rejects.toMatchObject({ reason: 'required' });
    const err = await readRows(fixture('agile-secret123.xlsx'), 'nope').catch((e) => e);
    expect(err).toBeInstanceOf(PasswordError);
    expect(err.reason).toBe('wrong');
  }, 20000);

  it('decrypts Standard (Excel 2007) workbooks', async () => {
    const file = new File([new Uint8Array(standardEncrypt(plainWorkbook(), 'pa55'))], 'old.xlsx');
    expect(await readRows(file, 'pa55')).toEqual([
      ['Date', 'Narration', 'Debit', 'Credit'],
      ['05/06/2025', 'AMAZON', '1200', ''],
    ]);
    await expect(readRows(file, 'wrong')).rejects.toMatchObject({ reason: 'wrong' });
  }, 20000);
});
