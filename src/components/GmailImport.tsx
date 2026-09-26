import { Check, FileText, Mail, RotateCcw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDate } from '../lib/dates';
import { DEFAULT_GMAIL_QUERY, downloadAttachment, searchStatements, type MailAttachment, type StatementMail } from '../sync/gmail';
import { getClientId, hasGmailToken } from '../sync/google';
import { Button, cx, Input, Spinner, toast } from './ui';

const keyOf = (a: MailAttachment) => `${a.messageId}:${a.filename}`;
const sender = (from: string) => from.replace(/<.*>/, '').replace(/"/g, '').trim() || from;

export function GmailImport({
  query,
  onQuery,
  imported,
  current,
  onOpen,
}: {
  query: string;
  onQuery: (q: string) => void;
  imported: string[];
  current: string | null;
  onOpen: (file: File, key: string) => Promise<void>;
}) {
  const [mails, setMails] = useState<StatementMail[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(query);

  const search = async (q = query) => {
    setSearching(true);
    try {
      setMails(await searchStatements(q));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSearching(false);
    }
  };

  // Coming back to this tab with Gmail access still valid: refresh without another click
  useEffect(() => {
    if (hasGmailToken()) void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async (a: MailAttachment) => {
    setOpening(keyOf(a));
    try {
      await onOpen(await downloadAttachment(a), keyOf(a));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setOpening(null);
    }
  };

  if (!getClientId()) return <p className="rounded-xl border border-line p-4 text-sm text-muted">Gmail import uses Google sign-in. Add your OAuth Client ID in Settings first.</p>;

  const done = new Set(imported);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button variant="primary" className="flex-1 justify-center" icon={<Mail className="size-4" />} loading={searching} onClick={() => void search()}>
          {mails ? 'Search again' : 'Find statements in Gmail'}
        </Button>
        <Button icon={<Search className="size-4" />} title="Edit search" onClick={() => (setDraft(query), setEditing(!editing))} />
      </div>

      {editing && (
        <form
          className="space-y-2 rounded-xl border border-line bg-surface-2/50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const q = draft.trim() || DEFAULT_GMAIL_QUERY;
            onQuery(q);
            setEditing(false);
            void search(q);
          }}
        >
          <p className="text-xs text-muted">Gmail search syntax, e.g. add another bank with OR from:hdfcbank.net</p>
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} className="font-mono text-xs" />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setDraft(DEFAULT_GMAIL_QUERY)}>
              Default
            </Button>
            <Button type="submit" size="sm" variant="primary">
              Save & search
            </Button>
          </div>
        </form>
      )}

      {mails && !mails.length && <p className="py-4 text-center text-sm text-muted">No matching emails with statement attachments. Try editing the search.</p>}
      {mails && mails.length > 0 && (
        <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {mails.map((m) => (
            <li key={m.id} className="rounded-xl border border-line p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium" title={m.subject}>
                  {m.subject || '(no subject)'}
                </p>
                <span className="shrink-0 text-[11px] text-faint">{formatDate(m.date.slice(0, 10))}</span>
              </div>
              <p className="truncate text-xs text-muted">{sender(m.from)}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.attachments.map((a) => {
                  const k = keyOf(a);
                  return (
                    <button
                      key={k}
                      disabled={!!opening}
                      onClick={() => void open(a)}
                      title={done.has(k) ? 'Already imported — open again' : 'Open this statement'}
                      className={cx(
                        'inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition disabled:opacity-60',
                        current === k ? 'border-accent bg-accent/10 text-fg' : 'border-line hover:border-accent/50',
                      )}
                    >
                      {opening === k ? <Spinner className="size-3" /> : done.has(k) ? <Check className="size-3 text-pos" /> : <FileText className="size-3 text-accent" />}
                      <span className="truncate">{a.filename}</span>
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-faint">
        Read-only Gmail access, asked for only here and kept in memory. Only the attachment you open is downloaded, straight into this browser.
      </p>
    </div>
  );
}
