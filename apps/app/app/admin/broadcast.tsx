// System notices to everyone (PRD: 'never marketing blasts to families'). AYWO Admin only, with a reason, audited.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TextInput, View } from 'react-native';
import { Actions, AdminPage, adminStyles, DataTable, formatDate, FormDialog, Message, Missing, Pager, QueryState, SecondaryButton, Section, usePagedList, useRefreshAfter } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import { api } from '@/lib/api';

const MIN_TITLE = 3;
const MAX_TITLE = 80;
const MIN_BODY = 10;
const MAX_BODY = 500;
const MIN_REASON = 5;

/** A notice sent before, as the audit log kept it. */
interface SentNotice {
  id: number;
  sent_at: string;
  sent_by_name: string | null;
  title: string | null;
  body: string | null;
  recipients: number;
  reason: string | null;
}
/** Who the next notice reaches, and how many of the day's allowance have gone. */
interface NoticeCount {
  recipients: number;
  sent_today: number;
  daily_limit: number;
}

export default function AdminBroadcast() {
  const { t, i18n } = useTranslation();
  const refreshAfter = useRefreshAfter();
  const count = useQuery({ queryKey: ['admin', 'broadcast-count'], queryFn: () => api.get<NoticeCount>('/admin/broadcast/count') });
  const history = usePagedList<SentNotice>(['admin', 'broadcasts'], '/admin/broadcasts');
  const usedUp = !!count.data && count.data.sent_today >= count.data.daily_limit;
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const ready = title.trim().length >= MIN_TITLE && body.trim().length >= MIN_BODY && !usedUp;

  const columns: Column<SentNotice>[] = [
    {
      key: 'notice',
      label: t('admin.broadcast.notice'),
      flex: 2.4,
      render: (row) => (
        <View>
          <Text style={adminStyles.cellStrong}>{row.title ?? '-'}</Text>
          {row.body ? <Text style={adminStyles.cellMuted}>{row.body}</Text> : null}
        </View>
      ),
    },
    { key: 'when', label: t('admin.broadcast.sentWhen'), render: (row) => formatDate(row.sent_at, i18n.language) },
    { key: 'by', label: t('admin.broadcast.sentBy'), render: (row) => row.sent_by_name ?? '-' },
    { key: 'reach', label: t('admin.broadcast.reached'), flex: 0.7, render: (row) => row.recipients },
    { key: 'why', label: t('admin.common.reason'), flex: 1.4, render: (row) => row.reason ?? '-' },
  ];

  return (
    <AdminPage title={t('admin.broadcast.title')} subtitle={t('admin.broadcast.subtitle')} gates={['staff']}>
      <View style={adminStyles.field}>
        <Text style={adminStyles.fieldLabel}>{t('admin.broadcast.heading')}</Text>
        <TextInput value={title} onChangeText={setTitle} maxLength={MAX_TITLE} accessibilityLabel={t('admin.broadcast.heading')} style={adminStyles.input} />
      </View>
      <View style={adminStyles.field}>
        <Text style={adminStyles.fieldLabel}>{t('admin.broadcast.body')}</Text>
        <TextInput value={body} onChangeText={setBody} maxLength={MAX_BODY} multiline numberOfLines={5} accessibilityLabel={t('admin.broadcast.body')} style={adminStyles.input} />
      </View>
      {count.data ? (
        <Text style={adminStyles.cellMuted}>
          {t('admin.broadcast.willReach', { count: count.data.recipients })} {t('admin.broadcast.usedToday', { used: count.data.sent_today, limit: count.data.daily_limit })}
        </Text>
      ) : null}
      {sent !== null ? <Message text={t('admin.broadcast.sent', { count: sent })} good /> : null}
      <Actions>
        <SecondaryButton main label={t('admin.broadcast.send')} disabled={!ready} onPress={() => setAsking(true)} />
      </Actions>
      <Missing
        reasons={[
          title.trim().length < MIN_TITLE && t('admin.common.needsText', { field: t('admin.broadcast.heading'), count: MIN_TITLE }),
          body.trim().length < MIN_BODY && t('admin.common.needsText', { field: t('admin.broadcast.body'), count: MIN_BODY }),
          usedUp && t('admin.broadcast.usedUp', { limit: count.data?.daily_limit ?? 3 }),
        ]}
      />
      {asking ? (
        <FormDialog
          title={t('admin.broadcast.confirmTitle')}
          text={t('admin.broadcast.confirmText')}
          fields={[{ name: 'reason', label: t('admin.broadcast.reason'), minLength: MIN_REASON, multiline: true }]}
          confirmLabel={t('admin.broadcast.send')}
          danger
          onCancel={() => setAsking(false)}
          onConfirm={async ({ reason }) => {
            const answer = await api.post<{ recipients?: number } | null>('/admin/broadcast', { title: title.trim(), body: body.trim(), reason });
            setSent(answer?.recipients ?? 0);
            setTitle('');
            setBody('');
            setAsking(false);
            // The new notice joins the list below, and one more of today's allowance is used.
            await refreshAfter('broadcasts', 'broadcast-count');
          }}
        >
          {/* The last look before it goes to everyone: exactly what they will read. */}
          <View style={{ gap: 4 }}>
            <Text style={adminStyles.fieldLabel}>{t('admin.broadcast.preview')}</Text>
            <Text style={adminStyles.cellStrong}>{title.trim()}</Text>
            <Text style={adminStyles.cellMuted}>{body.trim()}</Text>
          </View>
          {count.data ? (
            <>
              <Message text={t('admin.broadcast.willReach', { count: count.data.recipients })} alert />
              <Message text={t('admin.broadcast.usedToday', { used: count.data.sent_today, limit: count.data.daily_limit })} />
            </>
          ) : (
            <Message text={t('admin.broadcast.limitNote')} />
          )}
        </FormDialog>
      ) : null}
      <Section title={t('admin.broadcast.history')}>
        <QueryState query={history.query} isEmpty={(data) => data.rows.length === 0} emptyText={t('admin.broadcast.noHistory')}>
          {(data) => (
            <>
              <DataTable columns={columns} rows={data.rows} rowKey={(row) => String(row.id)} />
              <Pager page={history.page} total={data.total} onPage={history.setPage} />
            </>
          )}
        </QueryState>
      </Section>
    </AdminPage>
  );
}
