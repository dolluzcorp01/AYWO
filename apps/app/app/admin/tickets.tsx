// Help tickets from the app's help centre. Staff answers appear to the person as "AYWO Support", never a staff name.
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import type { TicketDetail, TicketRow } from '@/admin/types';
import { Actions, AdminPage, adminStyles, CloseGuard, DataTable, DialogFrame, Field, FilterChips, formatDate, Message, Missing, Pager, Pill, QueryState, SearchBox, SecondaryButton, useAction, usePagedList, useRefreshAfter, useKept } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import { api } from '@/lib/api';
import { colors, fonts } from '@/theme/tokens';

type Status = TicketRow['status'];

/** "Tamil", not "ta": the language the customer uses, in the staff member's own language. */
function languageName(code: string, shownIn: string): string {
  try {
    return new Intl.DisplayNames([shownIn], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export default function AdminTickets() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [status, setStatus] = useKept<Status | 'all'>('status', 'open');
  const [q, setQ] = useKept('q', '');
  const [open, setOpen] = useState<string | null>(null);
  // The work queue and an account page send the ticket's id along: that ticket opens straight away.
  const params = useLocalSearchParams<{ open?: string }>();
  useEffect(() => {
    if (params.open) {
      setOpen(params.open);
      // Taken out of the address, so a refresh does not open the box again.
      router.setParams({ open: undefined });
    }
  }, [params.open, router]);
  const { query, page, setPage } = usePagedList<TicketRow>(['admin', 'tickets'], '/admin/tickets', { status, q });

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
    // Under "All" the three kinds are mixed, so each row says which it is.
    ...(status === 'all' ? [{ key: 'status', label: t('admin.work.status'), render: (row: TicketRow) => <Pill label={t(`admin.tickets.${row.status}`)} alert={row.status === 'open'} /> }] : []),
    { key: 'owner', label: t('admin.work.owner'), render: (row) => (row.assignee_name === undefined || row.assignee_name === null ? t('admin.work.nobody') : row.assignee_name || t('admin.users.noName')) },
    { key: 'updated', label: t('admin.tickets.updated'), render: (row) => formatDate(row.updated_at, i18n.language) },
    { key: 'open', label: t('admin.common.actions'), flex: 0.8, render: (row) => <SecondaryButton label={t('admin.work.open')} onPress={() => setOpen(row.id)} /> },
  ];

  return (
    <AdminPage title={t('admin.tickets.title')} subtitle={t('admin.tickets.subtitle')} gates={['support']}>
      <SearchBox
        placeholder={t('admin.tickets.search')}
        initial={q}
        onSearch={(text) => {
          setQ(text);
          // A search looks through every ticket: the one wanted may be closed or waiting for the person.
          if (text) setStatus('all');
        }}
      />
      <FilterChips
        value={status}
        onChange={setStatus}
        options={[
          { value: 'open', label: t('admin.tickets.open') },
          { value: 'waiting', label: t('admin.tickets.waiting') },
          { value: 'closed', label: t('admin.tickets.closed') },
          { value: 'all', label: t('admin.tickets.all') },
        ]}
      />
      {q ? <Text style={adminStyles.cellMuted}>{t('admin.tickets.searching', { q })}</Text> : null}
      <QueryState query={query} isEmpty={(data) => data.rows.length === 0} emptyText={q ? t('admin.tickets.emptySearch') : t('admin.tickets.empty')}>
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
  const router = useRouter();
  const refreshAfter = useRefreshAfter();
  // "Close without answering" asks once more before it does it.
  const [closing, setClosing] = useState(false);
  const ticket = useQuery({ queryKey: ['admin', 'ticket', id], queryFn: () => api.get<TicketDetail>(`/admin/tickets/${id}`) });
  const [reply, setReply] = useState('');
  const action = useAction();

  async function send(close: boolean) {
    const ok = await action.run(() => api.post(`/admin/tickets/${id}/reply`, { body: reply.trim(), close }));
    if (ok) {
      setReply('');
      if (close) onClose();
      // 'ticket' is the open ticket itself; an answer also moves the work queue, its badge and the dashboard.
      await refreshAfter('tickets', 'ticket', 'work');
    }
  }

  // Closes a ticket that needs no answer (a duplicate, a thank-you). The person gets no message.
  async function closeOnly() {
    const ok = await action.run(() => api.post(`/admin/tickets/${id}/close`));
    if (ok) {
      onClose();
      await refreshAfter('tickets', 'ticket', 'work');
    }
  }
  // A closed ticket waits for staff again; the answer box comes back in this same dialog.
  async function reopen() {
    const ok = await action.run(() => api.post(`/admin/tickets/${id}/reopen`));
    if (ok) await refreshAfter('tickets', 'ticket', 'work');
  }

  return (
    <DialogFrame title={ticket.data?.subject ?? t('admin.common.loading')}>
      <QueryState query={ticket}>
        {(data) => (
          <View style={{ gap: 10 }}>
            <Text style={adminStyles.cellMuted}>
              {data.name ?? '-'} · {t(`help.categories.${data.category}`)} · {data.plus ? t('admin.users.plus') : t('admin.tickets.free')} · {languageName(data.language, i18n.language)}
            </Text>
            {/* Their plan, orders and other tickets are on their account page. A half-written answer is not thrown away for it. */}
            <Actions>
              <SecondaryButton
                label={t('admin.tickets.account')}
                disabled={!!reply.trim()}
                onPress={() => {
                  onClose();
                  router.navigate({ pathname: '/admin/user/[id]', params: { id: data.profile_id } });
                }}
              />
            </Actions>
            <Missing reasons={[!!reply.trim() && t('admin.tickets.answerFirst')]} />
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
                  <SecondaryButton main label={t('admin.tickets.send')} disabled={!reply.trim() || action.busy} onPress={() => send(false)} />
                  <SecondaryButton label={t('admin.tickets.sendClose')} disabled={!reply.trim() || action.busy} onPress={() => send(true)} />
                </Actions>
                <Missing reasons={[!reply.trim() && t('admin.tickets.needReply')]} />
                {closing && !reply.trim() ? (
                  <View style={{ gap: 8 }}>
                    <Message text={t('admin.tickets.closeOnlySure')} alert />
                    <Actions>
                      <SecondaryButton label={t('admin.tickets.keepOpen')} disabled={action.busy} onPress={() => setClosing(false)} />
                      <SecondaryButton main danger label={t('admin.tickets.closeOnlyYes')} disabled={action.busy} onPress={closeOnly} />
                    </Actions>
                  </View>
                ) : (
                  <>
                    <Actions>
                      <SecondaryButton label={t('admin.tickets.closeOnly')} disabled={!!reply.trim() || action.busy} onPress={() => setClosing(true)} />
                    </Actions>
                    <Missing reasons={[!!reply.trim() && t('admin.tickets.closeOnlyBlocked')]} />
                  </>
                )}
              </>
            ) : (
              <>
                <Message text={t('admin.tickets.isClosed')} />
                {action.failure ? <Message text={action.failure} alert /> : null}
                <Actions>
                  <SecondaryButton main label={t('admin.tickets.reopen')} disabled={action.busy} onPress={reopen} />
                </Actions>
              </>
            )}
          </View>
        )}
      </QueryState>
      <CloseGuard dirty={!!reply.trim()} onClose={onClose} />
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
