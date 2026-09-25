import { Banknote, CreditCard, Landmark, Pencil, Plus, Smartphone, Trash2, Upload, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ACCOUNT_TYPES, AccountModal } from '../components/AccountModal';
import { Badge, Button, Empty, IconButton, Money, PageHeader, Stat, toast } from '../components/ui';
import { formatDate } from '../lib/dates';
import { accountBalances } from '../lib/portfolio';
import { useStore } from '../store';
import type { Account } from '../types';

const ICONS = { savings: Landmark, current: Landmark, credit_card: CreditCard, wallet: Smartphone, cash: Banknote };

export default function Accounts() {
  const accounts = useStore((s) => s.meta.accounts);
  const summaries = useStore((s) => s.summaries);
  const deleteAccount = useStore((s) => s.deleteAccount);
  const [edit, setEdit] = useState<Account | undefined>();
  const [open, setOpen] = useState(false);
  const balances = useMemo(() => accountBalances(accounts, summaries), [accounts, summaries]);

  const bankTotal = accounts.filter((a) => a.type !== 'credit_card' && a.includeInNetWorth).reduce((s, a) => s + (balances[a.id]?.balance ?? 0), 0);
  const cardTotal = accounts.filter((a) => a.type === 'credit_card' && a.includeInNetWorth).reduce((s, a) => s + Math.abs(balances[a.id]?.balance ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Bank accounts, cards, wallets and cash. Statements are imported into an account."
        actions={
          <Button
            variant="primary"
            icon={<Plus className="size-4" />}
            onClick={() => {
              setEdit(undefined);
              setOpen(true);
            }}
          >
            Add account
          </Button>
        }
      />
      {accounts.length === 0 ? (
        <div className="card">
          <Empty icon={<Wallet />} title="No accounts yet" action={<Button variant="primary" onClick={() => setOpen(true)}>Add your first account</Button>}>
            Add a savings account, credit card or wallet, then import its statement.
          </Empty>
        </div>
      ) : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-3">
            <Stat label="Cash in banks & wallets" value={<Money value={bankTotal} />} icon={<Landmark className="size-4" />} />
            <Stat label="Credit card dues" value={<Money value={cardTotal} />} icon={<CreditCard className="size-4" />} tone="neg" />
            <Stat label="Accounts" value={accounts.length} sub={`${accounts.filter((a) => a.columnMapping).length} with a saved statement format`} icon={<Wallet className="size-4" />} />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {accounts.map((a) => {
              const Icon = ICONS[a.type];
              const b = balances[a.id];
              return (
                <div key={a.id} className="card animate-in group p-5">
                  <div className="flex items-start gap-3">
                    <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 text-accent">
                      <Icon className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{a.name}</div>
                      <div className="text-xs text-muted">
                        {ACCOUNT_TYPES[a.type]}
                        {a.bank ? ` · ${a.bank}` : ''}
                        {a.last4 ? ` · •••• ${a.last4}` : ''}
                      </div>
                    </div>
                    <div className="flex opacity-60 transition group-hover:opacity-100">
                      <IconButton
                        title="Edit"
                        onClick={() => {
                          setEdit(a);
                          setOpen(true);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </IconButton>
                      <IconButton
                        title="Delete"
                        onClick={async () => {
                          if (!window.confirm(`Delete “${a.name}” and ALL its transactions?`)) return;
                          await deleteAccount(a.id);
                          toast('Account deleted', 'info');
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </div>
                  </div>
                  <div className="mt-5 flex items-end justify-between">
                    <div>
                      <div className="text-xs text-muted">{a.type === 'credit_card' ? 'Outstanding' : 'Balance'}</div>
                      <div className="text-2xl font-semibold tracking-tight">
                        {b ? <Money value={a.type === 'credit_card' ? Math.abs(b.balance) : b.balance} /> : <span className="text-faint">—</span>}
                      </div>
                      <div className="text-[11px] text-faint">{b ? `as of ${formatDate(b.date)}` : 'no balance yet'}</div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {!a.includeInNetWorth && <Badge>excluded from net worth</Badge>}
                      <Link to={`/import?account=${a.id}`}>
                        <Button size="sm" icon={<Upload className="size-3.5" />}>
                          Import
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      <AccountModal open={open} onClose={() => setOpen(false)} initial={edit} />
    </>
  );
}
