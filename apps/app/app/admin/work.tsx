// One queue for everything staff must act on: abuse reports, help tickets, orders to print, takedowns, word reports.
// Each item has an owner, a status, a priority and a deadline. Opening one shows its history and internal notes.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import type { WorkDetail, WorkItem, WorkKind, WorkPage, WorkPriority, WorkStatus } from '@/admin/types';
import { Actions, AdminPage, adminStyles, DataTable, DialogFrame, Field, FilterChips, formatDate, Message, Pager, Pill, QueryState, SecondaryButton, useAction, usePagedList } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import { api } from '@/lib/api';

type View_ = 'open' | 'mine' | 'unassigned' | 'overdue' | 'done';

const SOURCE: Record<WorkKind, Href> = {
  report: '/admin/reports',
  ticket: '/admin/tickets',
  order: '/admin/orders',
  takedown: '/admin/takedowns',
  term_report: '/admin/dictionary',
};

export default function AdminWork() {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<View_>('open');
  const [kind, setKind] = useState<WorkKind | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const { query, page, setPage } = usePagedList<WorkItem>(['admin', 'work'], '/admin/work', { view, kind: kind === 'all' ? undefined : kind });
  const counts = (query.data as WorkPage | undefined)?.counts;

  const columns: Column<WorkItem>[] = [
    {
      key: 'what',
      label: t('admin.work.item'),
      flex: 2,
      render: (item) => (
        <View>
          <Text style={adminStyles.cellStrong}>{item.title}</Text>
          <Text style={adminStyles.cellMuted}>{t(`admin.work.kinds.${item.kind}`)}</Text>
        </View>
      ),
    },
    {
      key: 'priority',
      label: t('admin.work.priority'),
      flex: 0.8,
      render: (item) => <Pill label={t(`admin.work.priorities.${item.priority}`)} alert={item.priority === 'urgent' || item.priority === 'high'} />,
    },
    { key: 'status', label: t('admin.work.status'), flex: 0.9, render: (item) => t(`admin.work.statuses.${item.status}`) },
    { key: 'owner', label: t('admin.work.owner'), render: (item) => (item.assignee_id ? item.assignee_name || t('admin.users.noName') : t('admin.work.nobody')) },
    {
      key: 'due',
      label: t('admin.work.due'),
      render: (item) =>
        item.status === 'done' ? (
          formatDate(item.done_at, i18n.language)
        ) : (
          <View>
            <Text style={item.overdue ? adminStyles.alertCell : adminStyles.cellStrong}>{formatDate(item.due_at, i18n.language)}</Text>
            {item.overdue ? <Text style={adminStyles.alertCell}>{t('admin.work.late')}</Text> : null}
          </View>
        ),
    },
    {
      key: 'open',
      label: t('admin.common.actions'),
      flex: 0.8,
      render: (item) => <SecondaryButton label={t('admin.work.open')} onPress={() => setOpen(item.id)} />,
    },
  ];

  const chip = (value: View_, key: keyof NonNullable<typeof counts> | null) => ({
    value,
    label: key && counts ? `${t(`admin.work.views.${value}`)} (${counts[key]})` : t(`admin.work.views.${value}`),
  });

  return (
    <AdminPage title={t('admin.work.title')} subtitle={t('admin.work.subtitle')} gates={['support', 'moderation', 'takedowns', 'dictionary', 'orders']}>
      <FilterChips
        value={view}
        onChange={setView}
        options={[chip('open', 'open'), chip('mine', 'mine'), chip('unassigned', 'unassigned'), chip('overdue', 'overdue'), chip('done', null)]}
      />
      <FilterChips
        value={kind}
        onChange={setKind}
        options={[
          { value: 'all', label: t('admin.work.allKinds') },
          ...(['report', 'ticket', 'order', 'takedown', 'term_report'] as WorkKind[]).map((k) => ({ value: k, label: t(`admin.work.kinds.${k}`) })),
        ]}
      />
      <QueryState query={query} isEmpty={(data) => data.rows.length === 0} emptyText={t('admin.work.empty')}>
        {(data) => (
          <>
            <DataTable columns={columns} rows={data.rows} rowKey={(item) => item.id} />
            <Pager page={page} total={data.total} onPage={setPage} />
          </>
        )}
      </QueryState>
      {open ? <WorkDialog id={open} onClose={() => setOpen(null)} /> : null}
    </AdminPage>
  );
}

/** One item: change owner, status, priority, deadline; add a note; jump to the page where it is decided. */
function WorkDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ['admin', 'work', 'detail', id], queryFn: () => api.get<WorkDetail>(`/admin/work/${id}`) });
  const [note, setNote] = useState('');
  const action = useAction();

  async function change(body: Record<string, unknown>) {
    const ok = await action.run(() => api.patch(`/admin/work/${id}`, body));
    if (ok) {
      await client.invalidateQueries({ queryKey: ['admin', 'work'] });
      await client.invalidateQueries({ queryKey: ['admin', 'me'] });
    }
  }
  async function addNote() {
    const ok = await action.run(() => api.post(`/admin/work/${id}/notes`, { body: note }));
    if (ok) {
      setNote('');
      await client.invalidateQueries({ queryKey: ['admin', 'work', 'detail', id] });
    }
  }

  return (
    <DialogFrame title={detail.data?.title ?? t('admin.common.loading')}>
      <QueryState query={detail}>
        {(item) => (
          <View style={{ gap: 12 }}>
            <Text style={adminStyles.cellMuted}>
              {t(`admin.work.kinds.${item.kind}`)} · {t('admin.work.dueOn', { when: formatDate(item.due_at, i18n.language) })}
            </Text>
            <Text style={adminStyles.fieldLabel}>{t('admin.work.status')}</Text>
            <FilterChips
              value={item.status}
              onChange={(status: WorkStatus) => change({ status })}
              options={(['open', 'in_progress', 'waiting', 'done'] as WorkStatus[]).map((s) => ({ value: s, label: t(`admin.work.statuses.${s}`) }))}
            />
            <Text style={adminStyles.fieldLabel}>{t('admin.work.priority')}</Text>
            <FilterChips
              value={item.priority}
              onChange={(priority: WorkPriority) => change({ priority })}
              options={(['low', 'normal', 'high', 'urgent'] as WorkPriority[]).map((p) => ({ value: p, label: t(`admin.work.priorities.${p}`) }))}
            />
            <Text style={adminStyles.fieldLabel}>{t('admin.work.owner')}</Text>
            <FilterChips
              value={item.assignee_id ?? 'none'}
              onChange={(value: string) => change({ assignee_id: value === 'none' ? null : value })}
              options={[{ value: 'none', label: t('admin.work.nobody') }, ...item.assignable.map((a) => ({ value: a.profile_id, label: a.name }))]}
            />
            <Actions>
              <SecondaryButton label={t('admin.work.plusDay')} onPress={() => change({ due_at: new Date(Math.max(Date.now(), Date.parse(item.due_at)) + 86_400_000).toISOString() })} />
              <SecondaryButton label={t('admin.work.goTo')} onPress={() => { onClose(); router.navigate(SOURCE[item.kind]); }} />
            </Actions>
            <Text style={adminStyles.fieldLabel}>{t('admin.work.history')}</Text>
            {item.history.length === 0 ? <Text style={adminStyles.cellMuted}>{t('admin.work.noHistory')}</Text> : null}
            {item.history.map((h) => (
              <View key={h.id}>
                <Text style={adminStyles.cellStrong}>{h.body}</Text>
                <Text style={adminStyles.cellMuted}>
                  {h.author_name ?? '-'}, {formatDate(h.created_at, i18n.language)}
                </Text>
              </View>
            ))}
            <Field label={t('admin.work.note')} value={note} onChange={setNote} multiline maxLength={2000} help={t('admin.work.noteHelp')} />
            {action.failure ? <Message text={action.failure} alert /> : null}
            <Actions>
              <SecondaryButton label={t('admin.work.addNote')} disabled={!note.trim() || action.busy} onPress={addNote} />
            </Actions>
          </View>
        )}
      </QueryState>
      <Actions>
        <SecondaryButton label={t('admin.work.close')} onPress={onClose} />
      </Actions>
    </DialogFrame>
  );
}
