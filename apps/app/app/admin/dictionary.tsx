// S-19 Dictionary review (LLD L5 no. 20): new words waiting for approval, and 'wrong word' reports.
// Approved and rejected words can be looked at again and changed, so a wrong decision can be fixed.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Actions, AdminPage, adminStyles, DataTable, DialogFrame, Field, FilterChips, FormDialog, formatDate, Message, Missing, Pager, Pill, QueryState, SearchBox, SecondaryButton, useAction, usePagedList, useRefreshAfter } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import type { KinTermRow, TermReportRow } from '@/admin/types';
import { api } from '@/lib/api';

type Tab = 'words' | 'reports';
/** A wrong-word report with who decided it and when (empty while it is open). */
type TermReport = TermReportRow & { decided_at?: string | null; decided_by_name?: string | null };

export default function AdminDictionary() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('words');
  return (
    <AdminPage title={t('admin.dictionary.title')} subtitle={t('admin.dictionary.subtitle')} gates={['dictionary']}>
      <FilterChips
        value={tab}
        onChange={setTab}
        options={[
          { value: 'words', label: t('admin.dictionary.newWords') },
          { value: 'reports', label: t('admin.dictionary.reports') },
        ]}
      />
      {tab === 'words' ? <NewWords /> : <Reports />}
    </AdminPage>
  );
}

function WordCell({ term, native }: { term: string; native: string | null }) {
  return (
    <View>
      <Text style={adminStyles.cellStrong}>{term}</Text>
      {native ? <Text style={adminStyles.cellMuted}>{native}</Text> : null}
    </View>
  );
}

function NewWords() {
  const { t, i18n } = useTranslation();
  const refreshAfter = useRefreshAfter();
  const [acting, setActing] = useState<{ term: KinTermRow; decision: 'approve' | 'reject' } | null>(null);
  const [status, setStatus] = useState<'pending' | 'verified' | 'rejected'>('pending');
  // The approved and rejected lists grow for ever, so they can be searched. The waiting list is short and is not.
  const [q, setQ] = useState('');
  const searching = status !== 'pending';
  const { query, page, setPage } = usePagedList<KinTermRow>(['admin', 'kin-terms', status], '/admin/kin-terms', { status, q: searching ? q : undefined });
  // Approve (with the spelling put right if needed), or correct the spelling of a word already approved.
  const [fixing, setFixing] = useState<{ term: KinTermRow; correcting: boolean } | null>(null);

  const columns: Column<KinTermRow>[] = [
    { key: 'word', label: t('admin.dictionary.word'), render: (row) => <WordCell term={row.term} native={row.term_native} /> },
    { key: 'meaning', label: t('admin.dictionary.relationship'), flex: 1.6, render: (row) => row.path_description },
    { key: 'language', label: t('admin.dictionary.language'), flex: 0.7, render: (row) => row.language_name },
    { key: 'from', label: t('admin.dictionary.sentBy'), render: (row) => row.submitted_by_name || t('admin.users.noName') },
    { key: 'when', label: t('admin.dictionary.when'), render: (row) => formatDate(row.created_at, i18n.language) },
    {
      key: 'actions',
      label: t('admin.common.actions'),
      flex: 1.4,
      render: (row) => (
        <Actions>
          {status !== 'verified' ? (
            <SecondaryButton label={t('admin.dictionary.approve')} onPress={() => setFixing({ term: row, correcting: false })} />
          ) : (
            <SecondaryButton label={t('admin.dictionary.correct')} onPress={() => setFixing({ term: row, correcting: true })} />
          )}
          {status !== 'rejected' ? (
            <SecondaryButton
              label={status === 'verified' ? t('admin.dictionary.takeBack') : t('admin.dictionary.reject')}
              danger
              onPress={() => setActing({ term: row, decision: 'reject' })}
            />
          ) : null}
        </Actions>
      ),
    },
  ];

  return (
    <>
      <FilterChips
        value={status}
        onChange={setStatus}
        options={[
          { value: 'pending', label: t('admin.dictionary.waiting') },
          { value: 'verified', label: t('admin.dictionary.approvedWords') },
          { value: 'rejected', label: t('admin.dictionary.rejectedWords') },
        ]}
      />
      {searching ? <SearchBox key={status} placeholder={t('admin.dictionary.search')} onSearch={setQ} initial={q} /> : null}
      {searching && q ? (
        <Actions>
          <Text style={adminStyles.cellMuted}>{t('admin.dictionary.searchingFor', { q })}</Text>
        </Actions>
      ) : null}
      <QueryState query={query} isEmpty={(data) => data.rows.length === 0} emptyText={status === 'pending' ? t('admin.dictionary.noWords') : searching && q ? t('admin.dictionary.noMatch') : t('admin.dictionary.noneHere')}>
        {(data) => (
          <>
            <DataTable columns={columns} rows={data.rows} rowKey={(row) => row.id} />
            <Pager page={page} total={data.total} onPage={setPage} />
          </>
        )}
      </QueryState>
      {acting ? (
        <FormDialog
          title={t(acting.decision === 'approve' ? 'admin.dictionary.approveTitle' : status === 'verified' ? 'admin.dictionary.takeBackTitle' : 'admin.dictionary.rejectTitle', { word: acting.term.term })}
          text={t(acting.decision === 'approve' ? 'admin.dictionary.approveText' : status === 'verified' ? 'admin.dictionary.takeBackText' : 'admin.dictionary.rejectText')}
          confirmLabel={t(acting.decision === 'approve' ? 'admin.dictionary.approve' : status === 'verified' ? 'admin.dictionary.takeBack' : 'admin.dictionary.reject')}
          danger={acting.decision === 'reject'}
          onCancel={() => setActing(null)}
          onConfirm={async () => {
            await api.post('/admin/kin-review', { id: acting.term.id, decision: acting.decision });
            setActing(null);
            await refreshAfter('kin-terms');
          }}
        />
      ) : null}
      {fixing ? <WordDialog term={fixing.term} correcting={fixing.correcting} onClose={() => setFixing(null)} /> : null}
    </>
  );
}

/**
 * Approving a word, with its spelling put right first if it needs it, so a small mistake no longer means rejecting
 * the word. The same box corrects a word that is already approved.
 */
function WordDialog({ term, correcting, onClose }: { term: KinTermRow; correcting: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const refreshAfter = useRefreshAfter();
  const action = useAction();
  const [word, setWord] = useState(term.term);
  const [native, setNative] = useState(term.term_native ?? '');
  const same = word.trim() === term.term && native.trim() === (term.term_native ?? '');
  const missing = [!word.trim() && t('admin.dictionary.needWord'), correcting && same && t('admin.dictionary.changeFirst')];

  async function save() {
    const ok = await action.run(() =>
      api.post('/admin/kin-review', { id: term.id, decision: 'approve', term: word.trim(), term_native: native.trim() }),
    );
    if (ok) {
      onClose();
      await refreshAfter('kin-terms');
    }
  }

  return (
    <DialogFrame
      title={t(correcting ? 'admin.dictionary.correctTitle' : 'admin.dictionary.approveTitle', { word: term.term })}
      text={t(correcting ? 'admin.dictionary.correctText' : 'admin.dictionary.approveFixText')}
    >
      <Text style={adminStyles.cellMuted}>{`${term.path_description} · ${term.language_name}`}</Text>
      <Field label={t('admin.dictionary.wordLatin')} value={word} onChange={setWord} maxLength={120} />
      <Field label={t('admin.dictionary.wordNative')} value={native} onChange={setNative} maxLength={120} help={t('admin.dictionary.wordNativeHelp')} />
      {!correcting && !same ? <Message text={t('admin.dictionary.willSaveCorrected')} /> : null}
      {action.failure ? <Message text={action.failure} alert /> : null}
      <Missing reasons={missing} />
      <Actions>
        <SecondaryButton label={t('admin.common.cancel')} onPress={onClose} disabled={action.busy} />
        <SecondaryButton main label={t(correcting ? 'admin.dictionary.saveCorrection' : 'admin.dictionary.approve')} onPress={save} disabled={action.busy || missing.some(Boolean)} />
      </Actions>
    </DialogFrame>
  );
}

function Reports() {
  const { t, i18n } = useTranslation();
  const refreshAfter = useRefreshAfter();
  const [acting, setActing] = useState<{ report: TermReportRow; decision: 'accept' | 'dismiss' } | null>(null);
  // Open reports wait for a decision; Decided shows what was decided before, the newest first.
  const [view, setView] = useState<'open' | 'decided'>('open');
  const { query, page, setPage } = usePagedList<TermReport>(['admin', 'term-reports'], '/admin/term-reports', { status: view });

  const columns: Column<TermReport>[] = [
    { key: 'word', label: t('admin.dictionary.word'), render: (row) => <WordCell term={row.term} native={row.term_native} /> },
    { key: 'meaning', label: t('admin.dictionary.relationship'), flex: 1.4, render: (row) => row.path_description },
    { key: 'language', label: t('admin.dictionary.language'), flex: 0.7, render: (row) => row.language_name },
    { key: 'suggestion', label: t('admin.dictionary.suggestion'), render: (row) => row.suggestion || '-' },
    { key: 'from', label: t('admin.dictionary.reportedBy'), render: (row) => row.reporter_name || t('admin.users.noName') },
    { key: 'when', label: t('admin.dictionary.when'), render: (row) => formatDate(row.created_at, i18n.language) },
    {
      key: 'actions',
      label: view === 'open' ? t('admin.common.actions') : t('admin.takedowns.decision'),
      flex: 1.4,
      render: (row) =>
        row.status === 'open' ? (
          <Actions>
            <SecondaryButton label={t('admin.dictionary.accept')} onPress={() => setActing({ report: row, decision: 'accept' })} />
            <SecondaryButton label={t('admin.dictionary.dismiss')} onPress={() => setActing({ report: row, decision: 'dismiss' })} />
          </Actions>
        ) : (
          <View style={{ gap: 4 }}>
            <Pill label={t(row.status === 'accepted' ? 'admin.dictionary.accepted' : 'admin.dictionary.dismissed')} />
            {row.decided_at ? (
              <Text style={adminStyles.cellMuted}>
                {t('admin.takedowns.decidedBy', { name: row.decided_by_name ?? '-', when: formatDate(row.decided_at, i18n.language) })}
              </Text>
            ) : null}
          </View>
        ),
    },
  ];

  return (
    <>
      <FilterChips
        value={view}
        onChange={setView}
        options={[
          { value: 'open', label: t('admin.takedowns.open') },
          { value: 'decided', label: t('admin.dictionary.decided') },
        ]}
      />
      {view === 'decided' ? <Text style={adminStyles.cellMuted}>{t('admin.dictionary.decidedHelp')}</Text> : null}
      <QueryState query={query} isEmpty={(data) => data.rows.length === 0} emptyText={view === 'open' ? t('admin.dictionary.noReports') : t('admin.dictionary.noDecided')}>
        {(data) => (
          <>
            <DataTable columns={columns} rows={data.rows} rowKey={(row) => row.id} />
            <Pager page={page} total={data.total} onPage={setPage} />
          </>
        )}
      </QueryState>
      {acting ? (
        <FormDialog
          title={t(acting.decision === 'accept' ? 'admin.dictionary.acceptTitle' : 'admin.dictionary.dismissTitle', { word: acting.report.term })}
          text={t(acting.decision === 'accept' ? 'admin.dictionary.acceptText' : 'admin.dictionary.dismissText')}
          fields={
            acting.decision === 'accept'
              ? [
                  { name: 'term', label: t('admin.dictionary.correctedWord'), initial: acting.report.suggestion ?? '' },
                  { name: 'term_native', label: t('admin.dictionary.correctedNative'), initial: acting.report.term_native ?? '' },
                ]
              : []
          }
          confirmLabel={t(acting.decision === 'accept' ? 'admin.dictionary.accept' : 'admin.dictionary.dismiss')}
          danger={acting.decision === 'accept'}
          onCancel={() => setActing(null)}
          onConfirm={async ({ term, term_native }) => {
            await api.post(`/admin/term-reports/${acting.report.id}/decide`, {
              decision: acting.decision,
              ...(term ? { term } : {}),
              ...(term_native ? { term_native } : {}),
            });
            setActing(null);
            // Accepting a report changes the word itself and closes the report's work item.
            await refreshAfter('term-reports', 'kin-terms', 'work');
          }}
        />
      ) : null}
    </>
  );
}
