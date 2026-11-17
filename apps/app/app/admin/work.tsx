// One queue for everything staff must act on: abuse reports, help tickets, orders to print, takedowns, word reports.
// Each item has an owner, a status, a priority and a deadline. Opening one shows its history and internal notes.
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import type { TFunction } from 'i18next';
import { DateField } from '@/components/DateTimeField';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import type { WorkChanges, WorkDetail, WorkItem, WorkKind, WorkPage, WorkPriority, WorkStatus } from '@/admin/types';
import { Actions, AdminPage, adminStyles, CloseGuard, DataTable, DialogFrame, Field, FilterChips, formatDate, Message, Missing, Pager, Pill, QueryState, SecondaryButton, useAction, usePagedList, useRefreshAfter } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import { api } from '@/lib/api';

/** "2026-11-17" for a moment, as the day it is in India. */
function dayInIndia(iso: string): string {
  return new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

type View_ = 'open' | 'mine' | 'unassigned' | 'overdue' | 'done';
const VIEWS: View_[] = ['open', 'mine', 'unassigned', 'overdue', 'done'];

const SOURCE: Record<WorkKind, string> = {
  report: '/admin/reports',
  ticket: '/admin/tickets',
  order: '/admin/orders',
  takedown: '/admin/takedowns',
  term_report: '/admin/dictionary',
};

// Titles the server writes in fixed English. A title somebody typed (a ticket's subject, the name in a takedown
// request) is not here and is shown as it is.
const FIXED_TITLES: Record<string, string> = {
  'Takedown request': 'admin.work.titles.takedown',
  'Wrong word report': 'admin.work.titles.term_report',
  'Print poster': 'admin.work.titles.poster',
  'Print family book': 'admin.work.titles.book',
};

/** The item's title in the staff member's language when the server wrote it, unchanged when a person did. */
function workTitle(item: { kind: WorkKind; title: string }, t: TFunction): string {
  const fixed = FIXED_TITLES[item.title];
  if (fixed) return t(fixed);
  // Abuse reports are titled "Report: harassment (post comment)".
  const report = item.kind === 'report' ? item.title.match(/^Report: (\w+) \(([\w ]+)\)$/) : null;
  if (report) {
    return t('admin.work.titles.report', {
      reason: t(`admin.reports.reasons.${report[1]}`, { defaultValue: report[1] }),
      type: t(`admin.reports.types.${report[2].replace(/ /g, '_')}`, { defaultValue: report[2] }),
    });
  }
  // With no title at all the server falls back to the kind's internal word.
  return item.title === item.kind ? t(`admin.work.kinds.${item.kind}`) : item.title;
}

/** History lines from before the server kept the change as data: "Changed: status in_progress, assignee 3f2a…". */
function oldChanges(body: string): WorkChanges | null {
  if (!body.startsWith('Changed: ')) return null;
  const found: Record<string, string | null> = {};
  for (const part of body.slice('Changed: '.length).split(', ')) {
    const [key, value, ...more] = part.split(' ');
    if (!key || !value || more.length > 0 || !['status', 'priority', 'due_at', 'assignee'].includes(key)) return null;
    if (key === 'due_at' && Number.isNaN(Date.parse(value))) return null;
    found[key] = value === 'none' ? null : value;
  }
  return found as WorkChanges;
}

/** What changed, in words: "Status: In progress · Owner: Kavi". Empty when there is nothing it can say. */
function changeLine(changes: WorkChanges, item: WorkDetail, t: TFunction, language: string): string {
  const parts: string[] = [];
  if (changes.status) parts.push(t('admin.work.changed.status', { value: t(`admin.work.statuses.${changes.status}`, { defaultValue: changes.status }) }));
  if (changes.priority) parts.push(t('admin.work.changed.priority', { value: t(`admin.work.priorities.${changes.priority}`, { defaultValue: changes.priority }) }));
  if (changes.due_at) parts.push(t('admin.work.changed.due', { when: formatDate(changes.due_at, language) }));
  if (changes.assignee === null) parts.push(t('admin.work.changed.noOwner'));
  if (changes.assignee) {
    // Old lines hold only the id; the name is looked up among the people who can own this item.
    const name = changes.assignee_name || item.assignable.find((a) => a.profile_id === changes.assignee)?.name;
    parts.push(name ? t('admin.work.changed.owner', { name }) : t('admin.work.changed.ownerSomeone'));
  }
  return parts.join(' · ');
}

export default function AdminWork() {
  const { t, i18n } = useTranslation();
  // A dashboard card opens the list it counted: "Late" opens the late ones, not everything.
  const params = useLocalSearchParams<{ view?: string }>();
  const asked = VIEWS.find((v) => v === params.view);
  const [view, setView] = useState<View_>(asked ?? 'open');
  useEffect(() => {
    if (asked) setView(asked);
  }, [asked]);
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
          <Text style={adminStyles.cellStrong}>{workTitle(item, t)}</Text>
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
  const refreshAfter = useRefreshAfter();
  const detail = useQuery({ queryKey: ['admin', 'work', 'detail', id], queryFn: () => api.get<WorkDetail>(`/admin/work/${id}`) });
  const [note, setNote] = useState('');
  const action = useAction();

  async function change(body: Record<string, unknown>) {
    const ok = await action.run(() => api.patch(`/admin/work/${id}`, body));
    if (ok) await refreshAfter('work', 'tickets');
  }
  async function addNote() {
    const ok = await action.run(() => api.post(`/admin/work/${id}/notes`, { body: note }));
    if (ok) {
      setNote('');
      await refreshAfter('work');
    }
  }

  return (
    <DialogFrame title={detail.data ? workTitle(detail.data, t) : t('admin.common.loading')}>
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
            <Text style={adminStyles.cellMuted}>{t('admin.work.doneHelp')}</Text>
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
            {/* Any day can be picked, earlier or later; "One more day" stays as the quick way. */}
            <DateField
              label={t('admin.work.dueDay')}
              value={dayInIndia(item.due_at)}
              min={dayInIndia(new Date().toISOString())}
              onChange={(day) => day && change({ due_at: new Date(`${day}T18:00:00+05:30`).toISOString() })}
            />
            <Actions>
              <SecondaryButton label={t('admin.work.plusDay')} onPress={() => change({ due_at: new Date(Math.max(Date.now(), Date.parse(item.due_at)) + 86_400_000).toISOString() })} />
              <SecondaryButton label={t('admin.work.goTo')} disabled={!!note.trim()} onPress={() => {
                  onClose();
                  // The item's own id goes along, so that page can open this very item and not just its list.
                  router.navigate({ pathname: SOURCE[item.kind], params: { open: item.ref_id } } as Href);
                }}
              />
            </Actions>
            <Missing reasons={[!!note.trim() && t('admin.work.noteFirst')]} />
            <Text style={adminStyles.fieldLabel}>{t('admin.work.history')}</Text>
            {item.history.length === 0 ? <Text style={adminStyles.cellMuted}>{t('admin.work.noHistory')}</Text> : null}
            {item.history.map((h) => {
              // A line the system wrote is said in the staff member's language; a typed note is shown as written.
              const changes = h.changes ?? oldChanges(h.body);
              const line = changes ? changeLine(changes, item, t, i18n.language) : '';
              return (
                <View key={h.id}>
                  <Text style={adminStyles.cellStrong}>{line || h.body}</Text>
                  <Text style={adminStyles.cellMuted}>
                    {h.author_name ?? '-'}, {formatDate(h.created_at, i18n.language)}
                  </Text>
                </View>
              );
            })}
            <Field label={t('admin.work.note')} value={note} onChange={setNote} multiline maxLength={2000} help={t('admin.work.noteHelp')} />
            {action.failure ? <Message text={action.failure} alert /> : null}
            <Actions>
              <SecondaryButton main label={t('admin.work.addNote')} disabled={!note.trim() || action.busy} onPress={addNote} />
            </Actions>
            <Missing reasons={[!note.trim() && t('admin.work.needNote')]} />
          </View>
        )}
      </QueryState>
      <CloseGuard dirty={!!note.trim()} onClose={onClose} />
    </DialogFrame>
  );
}
