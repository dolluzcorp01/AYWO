// Abuse reports from people: memories, comments, chat messages and accounts. Apple and Google require these to be
// acted on quickly; each report is due within 24 hours in the work queue.
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import type { Page, ReportRow } from '@/admin/types';
import { Actions, AdminPage, adminStyles, Checkbox, DataTable, DialogFrame, Field, FilterChips, formatDate, FormDialog, Message, Missing, Pager, Panel, Pill, QueryState, SecondaryButton, useAction, usePagedList, useRefreshAfter, useKept } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import { api } from '@/lib/api';

type Status = ReportRow['status'];

export default function AdminReports() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useKept<Status>('status', 'open');
  const [acting, setActing] = useState<{ row: ReportRow; decision: 'remove' | 'dismiss' } | null>(null);
  const [reopening, setReopening] = useState<ReportRow | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const refreshAfter = useRefreshAfter();
  const { query, page, setPage } = usePagedList<ReportRow>(['admin', 'reports'], '/admin/reports', { status });
  // Opened from the work queue (?open=<report id>): that one report is shown on top, whatever list it is in now.
  const params = useLocalSearchParams<{ open?: string }>();
  const openId = /^[0-9a-f-]{36}$/i.test(params.open ?? '') ? (params.open as string) : null;
  const [closedOpen, setClosedOpen] = useState<string | null>(null);
  const opened = useQuery({
    queryKey: ['admin', 'reports', 'only', openId],
    queryFn: () => api.get<Page<ReportRow>>(`/admin/reports?only=${openId}`),
    enabled: !!openId,
  });

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
    {
      // What can be done depends on the row, not the tab: the row opened from the work queue can be in any state.
      key: 'actions',
      label: status === 'open' ? t('admin.common.actions') : t('admin.takedowns.decision'),
      flex: 1.5,
      render: (row) =>
        row.status === 'open' ? (
          <Actions>
            <SecondaryButton label={t('admin.reports.remove')} danger onPress={() => setActing({ row, decision: 'remove' })} />
            <SecondaryButton label={t('admin.reports.dismiss')} onPress={() => setActing({ row, decision: 'dismiss' })} />
          </Actions>
        ) : (
          <View style={{ gap: 6 }}>
            <Text style={adminStyles.cellStrong}>{row.decision_note ?? '-'}</Text>
            <Text style={adminStyles.cellMuted}>
              {t('admin.takedowns.decidedBy', { name: row.decided_by_name ?? '-', when: formatDate(row.decided_at, i18n.language) })}
            </Text>
            {row.status === 'dismissed' ? (
              <Actions>
                <SecondaryButton label={t('admin.reports.reopen')} onPress={() => setReopening(row)} />
              </Actions>
            ) : (
              <Text style={adminStyles.cellMuted}>{t('admin.reports.finalRemoved')}</Text>
            )}
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
          { value: 'dismissed', label: t('admin.reports.kept') },
        ]}
      />
      {done ? <Message text={done} good /> : null}
      {openId && closedOpen !== openId ? (
        <Panel title={t('admin.common.openedFromWork')} actions={<SecondaryButton label={t('admin.work.close')} onPress={() => setClosedOpen(openId)} />}>
          <QueryState query={opened} isEmpty={(data) => data.rows.length === 0} emptyText={t('admin.common.openedGone')}>
            {(data) => (
              <>
                <Text style={adminStyles.cellMuted}>{t('admin.common.openedState', { state: t(data.rows[0].status === 'dismissed' ? 'admin.reports.kept' : `admin.takedowns.${data.rows[0].status}`) })}</Text>
                <DataTable columns={columns} rows={data.rows} rowKey={(row) => row.id} />
              </>
            )}
          </QueryState>
        </Panel>
      ) : null}
      <QueryState query={query} isEmpty={(data) => data.rows.length === 0} emptyText={t('admin.reports.empty')}>
        {(data) => (
          <>
            <DataTable columns={columns} rows={data.rows} rowKey={(row) => row.id} />
            <Pager page={page} total={data.total} onPage={setPage} />
          </>
        )}
      </QueryState>
      {acting ? <DecideDialog row={acting.row} decision={acting.decision} onClose={() => setActing(null)} /> : null}
      {reopening ? (
        <FormDialog
          title={t('admin.reports.reopenTitle')}
          text={t('admin.reports.reopenText')}
          fields={[{ name: 'reason', label: t('admin.common.reason'), minLength: 5, multiline: true }]}
          confirmLabel={t('admin.reports.reopen')}
          onCancel={() => setReopening(null)}
          onConfirm={async ({ reason }) => {
            await api.post(`/admin/reports/${reopening.id}/reopen`, { reason });
            setReopening(null);
            setDone(t('admin.reports.reopened'));
            // It is back in the work queue too, so the menu badge and the dashboard change.
            await refreshAfter('reports', 'work');
          }}
        />
      ) : null}
    </AdminPage>
  );
}

function DecideDialog({ row, decision, onClose }: { row: ReportRow; decision: 'remove' | 'dismiss'; onClose: () => void }) {
  const { t } = useTranslation();
  const refreshAfter = useRefreshAfter();
  const [note, setNote] = useState('');
  const [blockOwner, setBlockOwner] = useState(false);
  const action = useAction();
  const removeProfile = row.target_type === 'profile';

  async function decide() {
    const ok = await action.run(() => api.post(`/admin/reports/${row.id}/decide`, { decision, note: note.trim(), block_owner: blockOwner }));
    if (ok) {
      onClose();
      // A decision closes its work item (the menu badge), and removing an account or 'also block' changes Users.
      await refreshAfter('reports', 'work', 'users');
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
      <Missing reasons={[note.trim().length < 5 && t('admin.common.needsText', { field: t('admin.takedowns.note'), count: 5 })]} />
      <Actions>
        <SecondaryButton label={t('admin.common.cancel')} onPress={onClose} disabled={action.busy} />
        <SecondaryButton
          main
          label={t(decision === 'remove' ? 'admin.reports.remove' : 'admin.reports.dismiss')}
          danger={decision === 'remove'}
          disabled={action.busy || note.trim().length < 5}
          onPress={decide}
        />
      </Actions>
    </DialogFrame>
  );
}
