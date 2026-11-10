// Help tickets from the app's help centre. Staff answers appear to the person as "AYWO Support", never a staff name.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import type { TicketDetail, TicketRow } from '@/admin/types';
import { Actions, AdminPage, adminStyles, DataTable, DialogFrame, Field, FilterChips, formatDate, Message, Pager, Pill, QueryState, SecondaryButton, useAction, usePagedList } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import { api } from '@/lib/api';
import { colors, fonts } from '@/theme/tokens';

type Status = TicketRow['status'];

export default function AdminTickets() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<Status>('open');
  const [open, setOpen] = useState<string | null>(null);
  const { query, page, setPage } = usePagedList<TicketRow>(['admin', 'tickets'], '/admin/tickets', { status });

  const columns: Column<TicketRow>[] = [
    {
      key: 'subject',
      label: t('admin.tickets.subject'),
      flex: 2,
      render: (row) => (
        <View>
          <Text style={adminStyles.cellStrong}>{row.subject}</Text>
          <Text style={adminStyles.cellMuted} numberOfLines={1}>
            {row.last ? `${row.last.from_staff ? t('admin.tickets.us') : row.name ?? '-'}: ${row.last.body}` : '-'}
          </Text>
        </View>
      ),
    },
    { key: 'category', label: t('admin.tickets.category'), flex: 0.8, render: (row) => <Pill label={t(`help.categories.${row.category}`)} /> },
    { key: 'person', label: t('admin.tickets.person'), render: (row) => row.name ?? '-' },
    { key: 'owner', label: t('admin.work.owner'), render: (row) => (row.assignee_name === undefined || row.assignee_name === null ? t('admin.work.nobody') : row.assignee_name || t('admin.users.noName')) },
    { key: 'updated', label: t('admin.tickets.updated'), render: (row) => formatDate(row.updated_at, i18n.language) },
    { key: 'open', label: t('admin.common.actions'), flex: 0.8, render: (row) => <SecondaryButton label={t('admin.work.open')} onPress={() => setOpen(row.id)} /> },
  ];

  return (
    <AdminPage title={t('admin.tickets.title')} subtitle={t('admin.tickets.subtitle')} gates={['support']}>
      <FilterChips
        value={status}
        onChange={setStatus}
        options={[
          { value: 'open', label: t('admin.tickets.open') },
          { value: 'waiting', label: t('admin.tickets.waiting') },
          { value: 'closed', label: t('admin.tickets.closed') },
        ]}
      />
      <QueryState query={query} isEmpty={(data) => data.rows.length === 0} emptyText={t('admin.tickets.empty')}>
        {(data) => (
          <>
            <DataTable columns={columns} rows={data.rows} rowKey={(row) => row.id} />
            <Pager page={page} total={data.total} onPage={setPage} />
          </>
        )}
      </QueryState>
      {open ? <TicketDialog id={open} onClose={() => setOpen(null)} /> : null}
    </AdminPage>
  );
}

function TicketDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const ticket = useQuery({ queryKey: ['admin', 'ticket', id], queryFn: () => api.get<TicketDetail>(`/admin/tickets/${id}`) });
  const [reply, setReply] = useState('');
  const action = useAction();

  async function send(close: boolean) {
    const ok = await action.run(() => api.post(`/admin/tickets/${id}/reply`, { body: reply.trim(), close }));
    if (ok) {
      setReply('');
      await client.invalidateQueries({ queryKey: ['admin', 'tickets'] });
      await client.invalidateQueries({ queryKey: ['admin', 'work'] });
      if (close) onClose();
      else await ticket.refetch();
    }
  }

  return (
    <DialogFrame title={ticket.data?.subject ?? t('admin.common.loading')}>
      <QueryState query={ticket}>
        {(data) => (
          <View style={{ gap: 10 }}>
            <Text style={adminStyles.cellMuted}>
              {data.name ?? '-'} · {t(`help.categories.${data.category}`)} · {data.plus ? 'Plus' : t('admin.tickets.free')} · {data.language}
            </Text>
            {data.messages.map((m) => (
              <View key={m.id} style={[styles.bubble, m.from_staff ? styles.ours : styles.theirs]}>
                <Text style={styles.who}>
                  {m.from_staff ? t('admin.tickets.us') : data.name ?? '-'} · {formatDate(m.created_at, i18n.language)}
                </Text>
                <Text style={styles.body}>{m.body}</Text>
              </View>
            ))}
            {data.status !== 'closed' ? (
              <>
                <Field label={t('admin.tickets.reply')} value={reply} onChange={setReply} multiline maxLength={4000} help={t('admin.tickets.replyHelp')} />
                {action.failure ? <Message text={action.failure} alert /> : null}
                <Actions>
                  <SecondaryButton label={t('admin.tickets.send')} disabled={!reply.trim() || action.busy} onPress={() => send(false)} />
                  <SecondaryButton label={t('admin.tickets.sendClose')} disabled={!reply.trim() || action.busy} onPress={() => send(true)} />
                </Actions>
              </>
            ) : (
              <Message text={t('admin.tickets.isClosed')} />
            )}
          </View>
        )}
      </QueryState>
      <Actions>
        <SecondaryButton label={t('admin.work.close')} onPress={onClose} />
      </Actions>
    </DialogFrame>
  );
}

const styles = StyleSheet.create({
  bubble: { padding: 12, borderRadius: 14, gap: 4, maxWidth: '92%' },
  ours: { alignSelf: 'flex-end', backgroundColor: colors.tint },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.background, borderWidth: 1, borderColor: colors.cardBorder },
  who: { color: colors.muted, fontFamily: fonts.bold, fontSize: 12 },
  body: { color: colors.text, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
});
