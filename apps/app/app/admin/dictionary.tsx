// S-19 Dictionary review (LLD L5 no. 20): new words waiting for approval, and 'wrong word' reports.
// Approved and rejected words can be looked at again and changed, so a wrong decision can be fixed.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Actions, AdminPage, adminStyles, DataTable, FilterChips, FormDialog, formatDate, Pager, QueryState, SecondaryButton, usePagedList } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import type { KinTermRow, TermReportRow } from '@/admin/types';
import { api } from '@/lib/api';

type Tab = 'words' | 'reports';

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
  const client = useQueryClient();
  const [acting, setActing] = useState<{ term: KinTermRow; decision: 'approve' | 'reject' } | null>(null);
  const [status, setStatus] = useState<'pending' | 'verified' | 'rejected'>('pending');
  const { query, page, setPage } = usePagedList<KinTermRow>(['admin', 'kin-terms', status], '/admin/kin-terms', { status });

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
            <SecondaryButton label={t('admin.dictionary.approve')} onPress={() => setActing({ term: row, decision: 'approve' })} />
          ) : null}
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
      <QueryState query={query} isEmpty={(data) => data.rows.length === 0} emptyText={status === 'pending' ? t('admin.dictionary.noWords') : t('admin.dictionary.noneHere')}>
        {(data) => (
          <>
            <DataTable columns={columns} rows={data.rows} rowKey={(row) => row.id} />
            <Pager page={page} total={data.total} onPage={setPage} />
          </>
        )}
      </QueryState>
      {acting ? (
        <FormDialog
          title={t(acting.decision === 'approve' ? 'admin.dictionary.approveTitle' : 'admin.dictionary.rejectTitle', { word: acting.term.term })}
          text={t(acting.decision === 'approve' ? 'admin.dictionary.approveText' : 'admin.dictionary.rejectText')}
          confirmLabel={t(acting.decision === 'approve' ? 'admin.dictionary.approve' : 'admin.dictionary.reject')}
          danger={acting.decision === 'reject'}
          onCancel={() => setActing(null)}
          onConfirm={async () => {
            await api.post('/admin/kin-review', { id: acting.term.id, decision: acting.decision });
            await client.invalidateQueries({ queryKey: ['admin', 'kin-terms'] });
            await client.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
            setActing(null);
          }}
        />
      ) : null}
    </>
  );
}

function Reports() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [acting, setActing] = useState<{ report: TermReportRow; decision: 'accept' | 'dismiss' } | null>(null);
  const { query, page, setPage } = usePagedList<TermReportRow>(['admin', 'term-reports'], '/admin/term-reports', { status: 'open' });

  const columns: Column<TermReportRow>[] = [
    { key: 'word', label: t('admin.dictionary.word'), render: (row) => <WordCell term={row.term} native={row.term_native} /> },
    { key: 'meaning', label: t('admin.dictionary.relationship'), flex: 1.4, render: (row) => row.path_description },
    { key: 'language', label: t('admin.dictionary.language'), flex: 0.7, render: (row) => row.language_name },
    { key: 'suggestion', label: t('admin.dictionary.suggestion'), render: (row) => row.suggestion || '-' },
    { key: 'from', label: t('admin.dictionary.reportedBy'), render: (row) => row.reporter_name || t('admin.users.noName') },
    { key: 'when', label: t('admin.dictionary.when'), render: (row) => formatDate(row.created_at, i18n.language) },
    {
      key: 'actions',
      label: t('admin.common.actions'),
      flex: 1.4,
      render: (row) => (
        <Actions>
          <SecondaryButton label={t('admin.dictionary.accept')} onPress={() => setActing({ report: row, decision: 'accept' })} />
          <SecondaryButton label={t('admin.dictionary.dismiss')} onPress={() => setActing({ report: row, decision: 'dismiss' })} />
        </Actions>
      ),
    },
  ];

  return (
    <>
      <QueryState query={query} isEmpty={(data) => data.rows.length === 0} emptyText={t('admin.dictionary.noReports')}>
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
          onCancel={() => setActing(null)}
          onConfirm={async ({ term, term_native }) => {
            await api.post(`/admin/term-reports/${acting.report.id}/decide`, {
              decision: acting.decision,
              ...(term ? { term } : {}),
              ...(term_native ? { term_native } : {}),
            });
            await client.invalidateQueries({ queryKey: ['admin', 'term-reports'] });
            await client.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
            setActing(null);
          }}
        />
      ) : null}
    </>
  );
}
