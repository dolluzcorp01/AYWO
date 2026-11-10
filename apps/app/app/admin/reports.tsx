// Abuse reports from people: memories, comments, chat messages and accounts. Apple and Google require these to be
// acted on quickly; each report is due within 24 hours in the work queue.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import type { ReportRow } from '@/admin/types';
import { Actions, AdminPage, adminStyles, Checkbox, DataTable, DialogFrame, Field, FilterChips, formatDate, Message, Pager, Pill, QueryState, SecondaryButton, useAction, usePagedList } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import { api } from '@/lib/api';

type Status = ReportRow['status'];

export default function AdminReports() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<Status>('open');
  const [acting, setActing] = useState<{ row: ReportRow; decision: 'remove' | 'dismiss' } | null>(null);
  const { query, page, setPage } = usePagedList<ReportRow>(['admin', 'reports'], '/admin/reports', { status });

  const columns: Column<ReportRow>[] = [
    {
      key: 'what',
      label: t('admin.reports.what'),
      flex: 2.4,
      render: (row) => (
        <View style={{ gap: 4 }}>
          <Actions>
            <Pill label={t(`admin.reports.types.${row.target_type}`)} />
            <Pill label={t(`admin.reports.reasons.${row.reason}`)} alert={['self_harm', 'violence', 'nudity', 'harassment', 'hate'].includes(row.reason)} />
            {row.same_target > 1 ? <Pill label={t('admin.reports.sameCount', { count: row.same_target })} alert /> : null}
          </Actions>
          <Text style={adminStyles.cellStrong}>
            {row.target?.gone ? t('admin.reports.gone') : row.target?.text ?? (row.target?.photos ? t('admin.reports.photoOnly') : '-')}
          </Text>
          {row.note ? <Text style={adminStyles.cellMuted}>{t('admin.reports.theirNote', { note: row.note })}</Text> : null}
        </View>
      ),
    },
    {
      key: 'who',
      label: t('admin.reports.posted'),
      render: (row) => (
        <View>
          <Text style={adminStyles.cellStrong}>{row.owner_name ?? '-'}</Text>
          <Text style={adminStyles.cellMuted}>{t('admin.reports.upheldBefore', { count: row.owner_reports })}</Text>
          {row.owner_blocked ? <Pill label={t('admin.users.blocked')} alert /> : null}
        </View>
      ),
    },
    {
      key: 'by',
      label: t('admin.reports.reportedBy'),
      render: (row) => (
        <View>
          <Text style={adminStyles.cellStrong}>{row.reporter_name ?? '-'}</Text>
          <Text style={adminStyles.cellMuted}>{formatDate(row.created_at, i18n.language)}</Text>
        </View>
      ),
    },
    status === 'open'
      ? {
          key: 'actions',
          label: t('admin.common.actions'),
          flex: 1.3,
          render: (row) => (
            <Actions>
              <SecondaryButton label={t('admin.reports.remove')} danger onPress={() => setActing({ row, decision: 'remove' })} />
              <SecondaryButton label={t('admin.reports.dismiss')} onPress={() => setActing({ row, decision: 'dismiss' })} />
            </Actions>
          ),
        }
      : {
          key: 'decision',
          label: t('admin.takedowns.decision'),
          flex: 1.5,
          render: (row) => (
            <View>
              <Text style={adminStyles.cellStrong}>{row.decision_note ?? '-'}</Text>
              <Text style={adminStyles.cellMuted}>
                {t('admin.takedowns.decidedBy', { name: row.decided_by_name ?? '-', when: formatDate(row.decided_at, i18n.language) })}
              </Text>
            </View>
          ),
        },
  ];

  return (
    <AdminPage title={t('admin.reports.title')} subtitle={t('admin.reports.subtitle')} gates={['moderation']}>
      <FilterChips
        value={status}
        onChange={setStatus}
        options={[
          { value: 'open', label: t('admin.takedowns.open') },
          { value: 'removed', label: t('admin.takedowns.removed') },
          { value: 'dismissed', label: t('admin.takedowns.dismissed') },
        ]}
      />
      <QueryState query={query} isEmpty={(data) => data.rows.length === 0} emptyText={t('admin.reports.empty')}>
        {(data) => (
          <>
            <DataTable columns={columns} rows={data.rows} rowKey={(row) => row.id} />
            <Pager page={page} total={data.total} onPage={setPage} />
          </>
        )}
      </QueryState>
      {acting ? <DecideDialog row={acting.row} decision={acting.decision} onClose={() => setActing(null)} /> : null}
    </AdminPage>
  );
}

function DecideDialog({ row, decision, onClose }: { row: ReportRow; decision: 'remove' | 'dismiss'; onClose: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [note, setNote] = useState('');
  const [blockOwner, setBlockOwner] = useState(false);
  const action = useAction();
  const removeProfile = row.target_type === 'profile';

  async function decide() {
    const ok = await action.run(() => api.post(`/admin/reports/${row.id}/decide`, { decision, note: note.trim(), block_owner: blockOwner }));
    if (ok) {
      await client.invalidateQueries({ queryKey: ['admin', 'reports'] });
      await client.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
      await client.invalidateQueries({ queryKey: ['admin', 'work'] });
      onClose();
    }
  }

  return (
    <DialogFrame
      title={t(decision === 'remove' ? 'admin.reports.removeTitle' : 'admin.reports.dismissTitle')}
      text={t(decision === 'remove' ? (removeProfile ? 'admin.reports.removeProfileText' : 'admin.reports.removeText') : 'admin.reports.dismissText')}
    >
      <Field label={t('admin.takedowns.note')} value={note} onChange={setNote} multiline maxLength={500} />
      {decision === 'remove' && !removeProfile && row.owner_id ? (
        <Checkbox label={t('admin.reports.alsoBlock', { name: row.owner_name ?? '-' })} checked={blockOwner} onChange={setBlockOwner} />
      ) : null}
      {action.failure ? <Message text={action.failure} alert /> : null}
      <Actions>
        <SecondaryButton label={t('admin.common.cancel')} onPress={onClose} disabled={action.busy} />
        <SecondaryButton
          label={t(decision === 'remove' ? 'admin.reports.remove' : 'admin.reports.dismiss')}
          danger={decision === 'remove'}
          disabled={action.busy || note.trim().length < 5}
          onPress={decide}
        />
      </Actions>
    </DialogFrame>
  );
}
