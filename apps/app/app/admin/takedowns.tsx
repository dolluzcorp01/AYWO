// S-20 Takedown requests from people added to a tree by others.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Actions, AdminPage, adminStyles, DataTable, FilterChips, FormDialog, formatDate, Pager, QueryState, SecondaryButton, usePagedList } from '@/admin/ui';
import type { Column, DialogField } from '@/admin/ui';
import type { TakedownRow } from '@/admin/types';
import { api } from '@/lib/api';

type Status = TakedownRow['status'];

export default function AdminTakedowns() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [status, setStatus] = useState<Status>('open');
  const [acting, setActing] = useState<{ item: TakedownRow; decision: 'remove' | 'dismiss' } | null>(null);
  const { query, page, setPage } = usePagedList<TakedownRow>(['admin', 'takedowns'], '/admin/takedowns', { status });

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
    status === 'open'
      ? {
          key: 'actions',
          label: t('admin.common.actions'),
          flex: 1.3,
          render: (item) => (
            <Actions>
              <SecondaryButton label={t('admin.takedowns.remove')} danger onPress={() => setActing({ item, decision: 'remove' })} />
              <SecondaryButton label={t('admin.takedowns.dismiss')} onPress={() => setActing({ item, decision: 'dismiss' })} />
            </Actions>
          ),
        }
      : {
          key: 'decision',
          label: t('admin.takedowns.decision'),
          flex: 1.5,
          render: (item) => (
            <View>
              <Text style={adminStyles.cellStrong}>{item.decision_note ?? '-'}</Text>
              <Text style={adminStyles.cellMuted}>
                {t('admin.takedowns.decidedBy', { name: item.decided_by_name ?? '-', when: formatDate(item.decided_at, i18n.language) })}
              </Text>
            </View>
          ),
        },
  ];

  const dialogFields: DialogField[] = [{ name: 'note', label: t('admin.takedowns.note'), minLength: 5, multiline: true }];
  if (acting?.decision === 'remove' && !acting.item.person_id) {
    dialogFields.unshift({ name: 'person_id', label: t('admin.takedowns.personId'), minLength: 36 });
  }

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
            name: acting.item.person_name ?? acting.item.subject_name ?? '-',
          })}
          text={t(acting.decision === 'remove' ? 'admin.takedowns.removeText' : 'admin.takedowns.dismissText')}
          fields={dialogFields}
          confirmLabel={t(acting.decision === 'remove' ? 'admin.takedowns.remove' : 'admin.takedowns.dismiss')}
          danger={acting.decision === 'remove'}
          onCancel={() => setActing(null)}
          onConfirm={async ({ note, person_id }) => {
            await api.post(`/admin/takedowns/${acting.item.id}/decide`, {
              decision: acting.decision,
              note,
              ...(person_id ? { person_id } : {}),
            });
            await client.invalidateQueries({ queryKey: ['admin', 'takedowns'] });
            await client.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
            setActing(null);
          }}
        />
      ) : null}
    </AdminPage>
  );
}
