import { AlertTriangle, CheckCircle2, FileClock, Mail, Upload, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, monthLabel } from '../lib/dates';
import { dueStatements } from '../lib/statementDue';
import { useStore } from '../store';
import { hasGmailToken } from '../sync/google';
import { syncStatementsFromGmail, useStatementSync, type StatementSyncResult } from '../sync/statementSync';
import { Button, IconButton, toast } from './ui';

// Automatic fetches happen at most once per page load, and only while Gmail access from an earlier click is still valid
let autoTried = false;

function summary(r: StatementSyncResult) {
  const added = r.imported.reduce((s, x) => s + x.added, 0);
  if (!r.imported.length) return r.review.length ? `${r.review.length} statement${r.review.length > 1 ? 's' : ''} need a quick review` : 'No new statement emails yet';
  return `Imported ${r.imported.length} statement${r.imported.length > 1 ? 's' : ''} · ${added} new transactions`;
}

/** Dashboard banner: last month's statement is missing for some accounts → fetch it from Gmail or upload it */
export function StatementReminder() {
  const accounts = useStore((s) => s.meta.accounts);
  const txByFY = useStore((s) => s.txByFY);
  const dismissed = useStore((s) => s.settings.statementReminderDismissed);
  const update = useStore((s) => s.update);
  const { running, result } = useStatementSync();
  const { month, due } = useMemo(() => dueStatements(accounts, Object.values(txByFY).flat()), [accounts, txByFY]);
  const since = due.reduce((min, d) => (d.through < min ? d.through : min), due[0]?.through ?? '');

  const run = async (quiet = false) => {
    try {
      const r = await syncStatementsFromGmail(since);
      if (!quiet || r.imported.length) toast(summary(r), r.imported.length ? 'success' : 'info');
    } catch (e) {
      if (!quiet) toast((e as Error).message, 'error');
    }
  };

  useEffect(() => {
    if (autoTried || !due.length || dismissed === month || !hasGmailToken()) return;
    autoTried = true;
    void run(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due.length]);

  if (result)
    return (
      <div className="card mb-5 p-4">
        <div className="flex items-start gap-3">
          {result.imported.length ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-pos" /> : <Mail className="mt-0.5 size-5 shrink-0 text-accent" />}
          <div className="min-w-0 flex-1 space-y-2 text-sm">
            <p className="font-medium">{summary(result)}</p>
            {result.imported.length > 0 && (
              <ul className="space-y-0.5 text-xs text-muted">
                {result.imported.map((x, i) => (
                  <li key={i}>
                    <b className="font-medium text-fg">{x.account}</b> ·{' '}
                    {x.deposits ? `${x.deposits} fixed deposit update${x.deposits > 1 ? 's' : ''}` : `${x.added} added${x.merged ? `, ${x.merged} SMS entries confirmed` : ''}`}
                    <span className="text-faint"> · {x.file}</span>
                  </li>
                ))}
              </ul>
            )}
            {!result.imported.length && !result.review.length && (
              <p className="text-xs text-muted">Nothing has arrived from your bank since {formatDate(since)}. Statements usually come in the first week of the month.</p>
            )}
            {result.review.length > 0 && (
              <ul className="space-y-1 text-xs">
                {result.review.map((x, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-2">
                    <AlertTriangle className="size-3.5 text-warn" />
                    <span className="font-medium">{x.file}</span>
                    <span className="text-muted">{x.reason}</span>
                  </li>
                ))}
                <li>
                  <Link to="/import?source=gmail" className="text-accent hover:underline">
                    Open in Import →
                  </Link>
                </li>
              </ul>
            )}
            {result.smsUnmatched > 0 && (
              <p className="text-xs text-warn">
                {result.smsUnmatched} SMS entr{result.smsUnmatched > 1 ? 'ies' : 'y'} not in the statements.{' '}
                <Link to="/transactions?sms=1" className="text-accent hover:underline">
                  Review
                </Link>
              </p>
            )}
          </div>
          <IconButton title="Close" onClick={() => useStatementSync.setState({ result: null })}>
            <X className="size-4" />
          </IconButton>
        </div>
      </div>
    );

  if (!due.length || dismissed === month) return null;
  return (
    <div className="card mb-5 flex flex-wrap items-center gap-3 border-accent/40 p-4">
      <FileClock className="size-5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{monthLabel(month, 'long')} statement not imported yet</p>
        <p className="text-xs text-muted">
          {due.map((d, i) => (
            <span key={d.account.id}>
              {i > 0 && ' · '}
              {d.account.name} <span className="text-faint">(up to {formatDate(d.through)})</span>
            </span>
          ))}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" icon={<Mail className="size-4" />} loading={running} onClick={() => void run()}>
          Sync from Gmail
        </Button>
        <Link
          to={`/import?account=${due[0].account.id}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium hover:border-accent/50"
        >
          <Upload className="size-3.5" /> Upload
        </Link>
        <Button size="sm" variant="ghost" onClick={() => update('settings', (s) => ({ ...s, statementReminderDismissed: month }))}>
          Not now
        </Button>
      </div>
    </div>
  );
}
