/**
 * Decrypts password-protected .xlsx files ([MS-OFFCRYPTO] ECMA-376 Agile and Standard encryption)
 * entirely in the browser with WebCrypto. The password never leaves the device.
 *
 * An encrypted .xlsx is an OLE compound file holding an `EncryptionInfo` stream (key parameters)
 * and an `EncryptedPackage` stream (the real zip, AES-encrypted).
 */

import { sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';

type CFBContainer = { FileIndex: { name: string; content: ArrayLike<number> }[] };
type CFBLib = { read: (d: Uint8Array, o: { type: 'array' }) => CFBContainer; find: (c: CFBContainer, p: string) => { content: ArrayLike<number> } | null };

export class PasswordError extends Error {
  readonly reason: 'required' | 'wrong' | 'unsupported';
  constructor(reason: 'required' | 'wrong' | 'unsupported', message: string) {
    super(message);
    this.reason = reason;
  }
}

const isCFB = (b: Uint8Array) => b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

/** True when the bytes are an OLE container holding an encrypted OOXML package */
export function isEncryptedOOXML(data: Uint8Array, CFB: CFBLib): boolean {
  if (!isCFB(data)) return false;
  try {
    return !!CFB.find(CFB.read(data, { type: 'array' }), 'EncryptionInfo');
  } catch {
    return false;
  }
}

// ─── Byte helpers ───────────────────────────────────────────────────────────

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const u32 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
const utf16le = (s: string) => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    out[i * 2] = s.charCodeAt(i) & 0xff;
    out[i * 2 + 1] = s.charCodeAt(i) >> 8;
  }
  return out;
};
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
/** Copy into a fresh ArrayBuffer-backed array (WebCrypto rejects views on shared/odd buffers in some runtimes) */
const buf = (a: Uint8Array) => new Uint8Array(a).buffer as ArrayBuffer;

// Synchronous hashing: key derivation runs 100,000 rounds, far too slow as awaited WebCrypto digests
const HASHES: Record<string, (d: Uint8Array) => Uint8Array> = { SHA1: sha1, 'SHA-1': sha1, SHA256: sha256, SHA384: sha384, SHA512: sha512 };
const hash = (fn: (d: Uint8Array) => Uint8Array, ...parts: Uint8Array[]) => fn(parts.length === 1 ? parts[0] : concat(...parts));

/** Office keys are truncated, or padded with 0x36, to the key length */
const fit = (h: Uint8Array, len: number) => (h.length >= len ? h.slice(0, len) : concat(h, new Uint8Array(len - h.length).fill(0x36)));

// ─── AES without padding ────────────────────────────────────────────────────
// WebCrypto only offers AES-CBC with PKCS#7 padding. Office data is unpadded, so we append one
// extra block that decrypts to a full padding block: E(lastCipherBlock XOR 0x10…), which is exactly
// what AES-CBC-encrypting an empty message with IV = lastCipherBlock produces.

async function aesKey(raw: Uint8Array) {
  return crypto.subtle.importKey('raw', buf(raw), 'AES-CBC', false, ['encrypt', 'decrypt']);
}

async function cbcDecryptRaw(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const len = data.length - (data.length % 16);
  if (!len) return new Uint8Array();
  const body = data.subarray(0, len);
  const pad = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: buf(body.subarray(len - 16)) }, key, new ArrayBuffer(0)));
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: buf(iv) }, key, buf(concat(body, pad))));
}

/** AES-ECB decrypt = CBC decrypt with a zero IV, then undo the chaining XOR */
async function ecbDecryptRaw(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const out = await cbcDecryptRaw(key, new Uint8Array(16), data);
  for (let i = 16; i < out.length; i++) out[i] ^= data[i - 16];
  return out;
}

// ─── Agile encryption (Excel 2010+) ─────────────────────────────────────────

const BLOCK_VERIFIER_INPUT = new Uint8Array([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]);
const BLOCK_VERIFIER_VALUE = new Uint8Array([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]);
const BLOCK_KEY = new Uint8Array([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]);
const SEGMENT = 4096;

function attrs(xml: string, tag: string): Record<string, string> {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*)>`));
  if (!m) throw new PasswordError('unsupported', `Unrecognised encryption info (missing ${tag})`);
  return Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
}

async function decryptAgile(info: Uint8Array, pkg: Uint8Array, password: string): Promise<Uint8Array> {
  const xml = new TextDecoder().decode(info.subarray(8));
  const keyData = attrs(xml, 'keyData');
  const enc = attrs(xml, 'encryptedKey');
  if (keyData.cipherAlgorithm !== 'AES' || enc.cipherAlgorithm !== 'AES' || keyData.cipherChaining !== 'ChainingModeCBC')
    throw new PasswordError('unsupported', `Unsupported cipher ${keyData.cipherAlgorithm}/${keyData.cipherChaining}`);
  const alg = HASHES[enc.hashAlgorithm];
  const dataAlg = HASHES[keyData.hashAlgorithm];
  if (!alg || !dataAlg) throw new PasswordError('unsupported', `Unsupported hash ${enc.hashAlgorithm}`);

  const salt = b64(enc.saltValue);
  const keyLen = +enc.keyBits / 8;
  let h = hash(alg, salt, utf16le(password));
  for (let i = 0; i < +enc.spinCount; i++) h = hash(alg, u32(i), h);
  const derive = async (block: Uint8Array) => aesKey(fit(hash(alg, h, block), keyLen));

  const verifierInput = (await cbcDecryptRaw(await derive(BLOCK_VERIFIER_INPUT), salt, b64(enc.encryptedVerifierHashInput))).slice(0, +enc.saltSize);
  const verifierHash = (await cbcDecryptRaw(await derive(BLOCK_VERIFIER_VALUE), salt, b64(enc.encryptedVerifierHashValue))).slice(0, +enc.hashSize);
  if (!equal(hash(alg, verifierInput), verifierHash)) throw new PasswordError('wrong', 'Wrong password');

  const secret = (await cbcDecryptRaw(await derive(BLOCK_KEY), salt, b64(enc.encryptedKeyValue))).slice(0, +keyData.keyBits / 8);
  const key = await aesKey(secret);
  const dataSalt = b64(keyData.saltValue);
  const blockSize = +keyData.blockSize || 16;

  const size = readSize(pkg);
  const body = pkg.subarray(8);
  const out = new Uint8Array(Math.ceil(body.length / 16) * 16);
  for (let i = 0, off = 0; off < body.length; i++, off += SEGMENT) {
    const iv = fit(hash(dataAlg, dataSalt, u32(i)), blockSize);
    out.set(await cbcDecryptRaw(key, iv, body.subarray(off, off + SEGMENT)), off);
  }
  return out.slice(0, size);
}

// ─── Standard encryption (Excel 2007) ───────────────────────────────────────

async function decryptStandard(info: Uint8Array, pkg: Uint8Array, password: string): Promise<Uint8Array> {
  const dv = new DataView(info.buffer, info.byteOffset, info.byteLength);
  const headerSize = dv.getUint32(8, true);
  const h = 12; // EncryptionHeader starts after version (4) + flags (4) + headerSize (4)
  const algId = dv.getUint32(h + 8, true);
  const keyBits = dv.getUint32(h + 16, true) || 128;
  if (algId && ![0x660e, 0x660f, 0x6610].includes(algId)) throw new PasswordError('unsupported', 'Only AES-encrypted workbooks are supported (not RC4)');
  let v = h + headerSize;
  const saltSize = dv.getUint32(v, true);
  const salt = info.slice(v + 4, v + 4 + saltSize);
  v += 4 + saltSize;
  const encVerifier = info.slice(v, v + 16);
  const hashSize = dv.getUint32(v + 16, true);
  const encVerifierHash = info.slice(v + 20, v + 20 + 32);

  let hh = hash(sha1, salt, utf16le(password));
  for (let i = 0; i < 50000; i++) hh = hash(sha1, u32(i), hh);
  hh = hash(sha1, hh, u32(0));
  const x = (fill: number) => {
    const b = new Uint8Array(64).fill(fill);
    for (let i = 0; i < hh.length; i++) b[i] ^= hh[i];
    return hash(sha1, b);
  };
  const raw = concat(x(0x36), x(0x5c)).slice(0, keyBits / 8);
  const key = await aesKey(raw);

  const verifier = await ecbDecryptRaw(key, encVerifier);
  const verifierHash = (await ecbDecryptRaw(key, encVerifierHash)).slice(0, hashSize);
  if (!equal(hash(sha1, verifier), verifierHash)) throw new PasswordError('wrong', 'Wrong password');

  return (await ecbDecryptRaw(key, pkg.subarray(8))).slice(0, readSize(pkg));
}

function readSize(pkg: Uint8Array) {
  const dv = new DataView(pkg.buffer, pkg.byteOffset, 8);
  return dv.getUint32(0, true) + dv.getUint32(4, true) * 2 ** 32;
}

/** Returns the decrypted .xlsx (zip) bytes. Throws PasswordError for missing/wrong passwords. */
export async function decryptOOXML(data: Uint8Array, password: string | undefined, CFB: CFBLib): Promise<Uint8Array> {
  const cfb = CFB.read(data, { type: 'array' });
  const infoEntry = CFB.find(cfb, 'EncryptionInfo');
  const pkgEntry = CFB.find(cfb, 'EncryptedPackage');
  if (!infoEntry || !pkgEntry) throw new PasswordError('unsupported', 'Not an encrypted Office file');
  if (!password) throw new PasswordError('required', 'This file is password-protected');
  const info = Uint8Array.from(infoEntry.content);
  const pkg = Uint8Array.from(pkgEntry.content);
  const major = info[0] | (info[1] << 8);
  const minor = info[2] | (info[3] << 8);
  if (major === 4 && minor === 4) return decryptAgile(info, pkg, password);
  if ((major === 2 || major === 3 || major === 4) && minor === 2) return decryptStandard(info, pkg, password);
  throw new PasswordError('unsupported', `Unsupported encryption version ${major}.${minor}`);
}
