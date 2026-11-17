// S-20 Takedown requests from people added to a tree by others.
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Actions, AdminPage, adminStyles, DataTable, FilterChips, FormDialog, formatDate, Message, Pager, Panel, QueryState, SearchBox, SecondaryButton, usePagedList, useRefreshAfter } from '@/admin/ui';
import type { Column, DialogField } from '@/admin/ui';
import type { Page, TakedownMatch, TakedownRow } from '@/admin/types';
import { api } from '@/lib/api';

type Status = TakedownRow['status'];

export default function AdminTakedowns() {
  const { t, i18n } = useTranslation();
  const refreshAfter = useRefreshAfter();
  const [status, setStatus] = useState<Status>('open');
  const [acting, setActing] = useState<{ item: TakedownRow; decision: 'remove' | 'dismiss' } | null>(null);
  // A request with only a name: the person staff picked from the matches.
  const [picked, setPicked] = useState<TakedownMatch | null>(null);
  const start = (item: TakedownRow, decision: 'remove' | 'dismiss') => {
    setPicked(null);
    setActing({ item, decision });
  };
  const { query, page, setPage } = usePagedList<TakedownRow>(['admin', 'takedowns'], '/admin/takedowns', { status });
  const [reopening, setReopening] = useState<TakedownRow | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Opened from the work queue (?open=<request id>): that one request is shown on top, whatever list it is in now.
  const params = useLocalSearchParams<{ open?: string }>();
  const openId = /^[0-9a-f-]{36}$/i.test(params.open ?? '') ? (params.open as string) : null;
  const [closedOpen, setClosedOpen] = useState<string | null>(null);
  const opened = useQuery({
    queryKey: ['admin', 'takedowns', 'only', openId],
    queryFn: () => api.get<Page<TakedownRow>>(`/admin/takedowns?only=${openId}`),
    enabled: !!openId,
  });

  const columns: Column<TakedownRow>[] = [
    {
      key: 'who',
      label: t('admin.takedowns.person'),
      flex: 1.3,
      render: (item) => (
        <View>
          <Text style={adminStyles.cellStrong}>{item.person_name ?? item.subject_name ?? '-'}</Text>
          <Text style={adminStyles.cellMuted}>{item.tree_name ?? t('admin.takedowns.noPersonLinked')}</Text>
        </View>
      ),
    },
    { key: 'contact', label: t('admin.takedowns.askedBy'), render: (item) => item.requester_contact },
    { key: 'reason', label: t('admin.takedowns.reason'), flex: 2, render: (item) => item.reason },
    { key: 'when', label: t('admin.takedowns.when'), render: (item) => formatDate(item.created_at, i18n.language) },
    {
      // What can be done depends on the row, not the tab: the row opened from the work queue can be in any state.
      key: 'actions',
      label: status === 'open' ? t('admin.common.actions') : t('admin.takedowns.decision'),
      flex: 1.5,
      render: (item) =>
        item.status === 'open' ? (
          <Actions>
            <SecondaryButton label={t('admin.takedowns.remove')} danger onPress={() => start(item, 'remove')} />
            <SecondaryButton label={t('admin.takedowns.dismiss')} onPress={() => start(item, 'dismiss')} />
          </Actions>
        ) : (
          <View style={{ gap: 6 }}>
            <Text style={adminStyles.cellStrong}>{item.decision_note ?? '-'}</Text>
            <Text style={adminStyles.cellMuted}>
              {t('admin.takedowns.decidedBy', { name: item.decided_by_name ?? '-', when: formatDate(item.decided_at, i18n.language) })}
            </Text>
            {item.status === 'dismissed' ? (
              <Actions>
                <SecondaryButton label={t('admin.takedowns.reopen')} onPress={() => setReopening(item)} />
              </Actions>
            ) : (
              <Text style={adminStyles.cellMuted}>{t('admin.takedowns.finalRemoved')}</Text>
            )}
          </View>
        ),
    },
  ];

  const dialogFields: DialogField[] = [{ name: 'note', label: t('admin.takedowns.note'), minLength: 5, multiline: true }];
  const needsPick = acting?.decision === 'remove' && !acting.item.person_id;

  return (
    <AdminPage title={t('admin.takedowns.title')} subtitle={t('admin.takedowns.subtitle')} gates={['takedowns']}>
      <FilterChips
        value={status}
        onChange={setStatus}
        options={[
          { value: 'open', label: t('admin.takedowns.open') },
          { value: 'removed', label: t('admin.takedowns.removed') },
          { value: 'dismissed', label: t('admin.takedowns.dismissed') },
        ]}
      />
      {done ? <Message text={done} good /> : null}
      {openId && closedOpen !== openId ? (
        <Panel title={t('admin.common.openedFromWork')} actions={<SecondaryButton label={t('admin.work.close')} onPress={() => setClosedOpen(openId)} />}>
          <QueryState query={opened} isEmpty={(data) => data.rows.length === 0} emptyText={t('admin.common.openedGone')}>
            {(data) => (
              <>
                <Text style={adminStyles.cellMuted}>{t('admin.common.openedState', { state: t(`admin.takedowns.${data.rows[0].status}`) })}</Text>
                <DataTable columns={columns} rows={data.rows} rowKey={(item) => item.id} />
              </>
            )}
          </QueryState>
        </Panel>
      ) : null}
      <QueryState query={query} isEmpty={(data) => data.rows.length === 0} emptyText={t('admin.takedowns.empty')}>
        {(data) => (
          <>
            <DataTable columns={columns} rows={data.rows} rowKey={(item) => item.id} />
            <Pager page={page} total={data.total} onPage={setPage} />
          </>
        )}
      </QueryState>
      {acting ? (
        <FormDialog
          title={t(acting.decision === 'remove' ? 'admin.takedowns.removeTitle' : 'admin.takedowns.dismissTitle', {
            name: picked?.name ?? acting.item.person_name ?? acting.item.subject_name ?? '-',
          })}
          blocked={needsPick && !picked ? t('admin.takedowns.needPerson') : null}
          text={t(acting.decision === 'remove' ? 'admin.takedowns.removeText' : 'admin.takedowns.dismissText')}
          fields={dialogFields}
          confirmLabel={t(acting.decision === 'remove' ? 'admin.takedowns.remove' : 'admin.takedowns.dismiss')}
          danger={acting.decision === 'remove'}
          onCancel={() => setActing(null)}
          onConfirm={async ({ note }) => {
            await api.post(`/admin/takedowns/${acting.item.id}/decide`, {
              decision: acting.decision,
              note,
              ...(needsPick && picked ? { person_id: picked.id } : {}),
            });
            setActing(null);
            await refreshAfter('takedowns', 'work', 'trees');
          }}
        >
          {needsPick ? <PersonPick request={acting.item} picked={picked} onPick={setPicked} /> : null}
        </FormDialog>
      ) : null}
      {reopening ? (
        <FormDialog
          title={t('admin.takedowns.reopenTitle', { name: reopening.person_name ?? reopening.subject_name ?? '-' })}
          text={t('admin.takedowns.reopenText')}
          fields={[{ name: 'reason', label: t('admin.common.reason'), minLength: 5, multiline: true }]}
          confirmLabel={t('admin.takedowns.reopen')}
          onCancel={() => setReopening(null)}
          onConfirm={async ({ reason }) => {
            await api.post(`/admin/takedowns/${reopening.id}/reopen`, { reason });
            setReopening(null);
            setDone(t('admin.takedowns.reopened'));
            // It is back in the work queue too, so the menu badge and the dashboard change.
            await refreshAfter('takedowns', 'work');
          }}
        />
      ) : null}
    </AdminPage>
  );
}

/** The request named someone but gave no link to their card: search by name and pick which person it is. */
function PersonPick({ request, picked, onPick }: { request: TakedownRow; picked: TakedownMatch | null; onPick: (match: TakedownMatch | null) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState((request.subject_name ?? '').trim());
  const matches = useQuery({
    queryKey: ['admin', 'takedowns', 'people', request.id, q],
    queryFn: () => api.get<TakedownMatch[]>(`/admin/takedowns/${request.id}/people?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });
  const line = (m: TakedownMatch) =>
    [m.birth_year ? t('admin.takedowns.born', { year: m.birth_year }) : null, m.tree_name, m.creator_name ? t('admin.takedowns.madeBy', { name: m.creator_name }) : null]
      .filter(Boolean)
      .join(' · ');

  if (picked) {
    return (
      <View style={{ gap: 6 }}>
        <Text style={adminStyles.fieldLabel}>{t('admin.takedowns.whichPerson')}</Text>
        <Text style={adminStyles.cellStrong}>{picked.name}</Text>
        <Text style={adminStyles.cellMuted}>{line(picked)}</Text>
        <Actions>
          <SecondaryButton label={t('admin.takedowns.pickAnother')} onPress={() => onPick(null)} />
        </Actions>
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={adminStyles.fieldLabel}>{t('admin.takedowns.whichPerson')}</Text>
      <SearchBox placeholder={t('admin.takedowns.searchName')} initial={q} onSearch={setQ} />
      {q.length < 2 ? <Text style={adminStyles.cellMuted}>{t('admin.takedowns.searchHelp')}</Text> : null}
      {q.length >= 2 ? (
        <QueryState query={matches} isEmpty={(rows) => rows.length === 0} emptyText={t('admin.takedowns.noMatch')}>
          {(rows) => (
            <View style={{ gap: 8 }}>
              {rows.map((m) => (
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={adminStyles.cellStrong}>{m.name}</Text>
                    <Text style={adminStyles.cellMuted}>{line(m)}</Text>
                  </View>
                  <SecondaryButton label={t('admin.takedowns.thisOne')} onPress={() => onPick(m)} />
                </View>
              ))}
              {rows.length >= 20 ? <Message text={t('admin.takedowns.tooMany')} /> : null}
            </View>
          )}
        </QueryState>
      ) : null}
    </View>
  );
}
