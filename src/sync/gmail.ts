/* Minimal Gmail REST client: find statement emails and download their attachments. Read-only. */
import { dropGmailToken, getGmailToken } from './google';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** SBI mails from sbi.co.in today; Indian banks are moving to *.bank.in domains */
export const DEFAULT_GMAIL_QUERY = '(from:sbi.co.in OR from:sbi.bank.in) has:attachment filename:pdf newer_than:1y';

/** Attachments Nova can import */
export const IMPORTABLE = /\.(pdf|xlsx?|xlsm|csv|tsv|txt|ods)$/i;

export interface MailAttachment {
  messageId: string;
  attachmentId: string;
  filename: string;
  size: number;
}

export interface StatementMail {
  id: string;
  date: string;
  subject: string;
  from: string;
  attachments: MailAttachment[];
}

interface Part {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; size?: number };
  parts?: Part[];
}

async function call<T>(path: string): Promise<T> {
  const token = await getGmailToken();
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) {
    dropGmailToken();
    throw new Error('Gmail access expired, search again to reconnect');
  }
  if (r.status === 403) {
    const body = await r.text();
    throw new Error(/has not been used|is disabled/i.test(body) ? 'Enable the Gmail API in your Google Cloud project (see README)' : 'Gmail access was denied');
  }
  if (!r.ok) throw new Error(`Gmail request failed (${r.status})`);
  return r.json() as Promise<T>;
}

export function attachmentsOf(messageId: string, part: Part | undefined): MailAttachment[] {
  if (!part) return [];
  const own =
    part.filename && part.body?.attachmentId && IMPORTABLE.test(part.filename)
      ? [{ messageId, attachmentId: part.body.attachmentId, filename: part.filename, size: part.body.size ?? 0 }]
      : [];
  return [...own, ...(part.parts ?? []).flatMap((p) => attachmentsOf(messageId, p))];
}

export async function searchStatements(query: string, max = 25): Promise<StatementMail[]> {
  const list = await call<{ messages?: { id: string }[] }>(`/messages?maxResults=${max}&q=${encodeURIComponent(query)}`);
  const ids = (list.messages ?? []).map((m) => m.id);
  const b = 'filename,body(attachmentId,size)';
  const fields = `id,internalDate,payload(headers,${b},parts(${b},parts(${b},parts(${b}))))`;
  const msgs = await Promise.all(
    ids.map((id) =>
      call<{ id: string; internalDate: string; payload: Part & { headers?: { name: string; value: string }[] } }>(
        `/messages/${id}?format=full&fields=${encodeURIComponent(fields)}`,
      ),
    ),
  );
  return msgs
    .map((m) => {
      const h = (n: string) => m.payload.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? '';
      return { id: m.id, date: new Date(+m.internalDate).toISOString(), subject: h('subject'), from: h('from'), attachments: attachmentsOf(m.id, m.payload) };
    })
    .filter((m) => m.attachments.length);
}

export function base64UrlToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function downloadAttachment(a: MailAttachment): Promise<File> {
  const r = await call<{ data: string }>(`/messages/${a.messageId}/attachments/${a.attachmentId}`);
  return new File([base64UrlToBytes(r.data) as BlobPart], a.filename);
}
