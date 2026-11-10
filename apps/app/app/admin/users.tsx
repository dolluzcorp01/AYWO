// Find accounts; open one account's full view; block and unblock. Phones and emails are masked by the server.
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { useAdminAccess } from '@/admin/access';
import { Actions, AdminPage, adminStyles, DataTable, FormDialog, formatDate, Pager, Pill, QueryState, SearchBox, SecondaryButton, usePagedList } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import type { UserRow } from '@/admin/types';
import { api } from '@/lib/api';

export default function AdminUsers() {
  const { t, i18n } = useTranslation();
  const access = useAdminAccess();
  const router = useRouter();
  const client = useQueryClient();
  const [q, setQ] = useState('');
  const [acting, setActing] = useState<{ user: UserRow; action: 'block' | 'unblock' } | null>(null);
  const { query, page, setPage } = usePagedList<UserRow>(['admin', 'users'], '/admin/users', { q });
  const canBlock = access.can(['users']);
  const canBlockStaff = access.can(['staff']);

  const columns: Column<UserRow>[] = [
    {
      key: 'name',
      label: t('admin.users.name'),
      flex: 2,
      render: (user) => (
        <View>
          <Text style={adminStyles.cellStrong}>{user.display_name || t('admin.users.noName')}</Text>
          <Text style={adminStyles.cellMuted}>{user.id}</Text>
        </View>
      ),
    },
    {
      key: 'reach',
      label: t('admin.users.phoneEmail'),
      flex: 1.4,
      render: (user) => (
        <View>
          <Text style={adminStyles.cellMuted}>{user.phone_masked ?? '-'}</Text>
          <Text style={adminStyles.cellMuted}>{user.email_masked ?? '-'}</Text>
        </View>
      ),
    },
    { key: 'trees', label: t('admin.users.trees'), flex: 0.6, render: (user) => user.trees_created },
    { key: 'active', label: t('admin.users.lastActive'), render: (user) => formatDate(user.last_active_at, i18n.language) },
    {
      key: 'state',
      label: t('admin.users.state'),
      render: (user) => (
        <Actions>
          {user.blocked_at ? <Pill label={t('admin.users.blocked')} alert /> : null}
          {user.deleted ? <Pill label={t('admin.users.deleted')} /> : null}
          {user.plus ? <Pill label={t('admin.users.plus')} /> : null}
          {user.staff_role ? <Pill label={t(`admin.roles.${user.staff_role}`)} /> : null}
        </Actions>
      ),
    },
    {
      key: 'actions',
      label: t('admin.common.actions'),
      flex: 1.3,
      render: (user: UserRow) => (
        <Actions>
          <SecondaryButton label={t('admin.user360.open')} onPress={() => router.navigate({ pathname: '/admin/user/[id]', params: { id: user.id } })} />
          {!canBlock || (user.staff_role && !canBlockStaff) ? null : user.blocked_at ? (
            <SecondaryButton label={t('admin.users.unblock')} onPress={() => setActing({ user, action: 'unblock' })} />
          ) : (
            <SecondaryButton label={t('admin.users.block')} danger onPress={() => setActing({ user, action: 'block' })} />
          )}
        </Actions>
      ),
    },
  ];

  return (
    <AdminPage title={t('admin.users.title')} subtitle={t('admin.users.subtitle')} gates={['users', 'support']}>
      <SearchBox placeholder={t('admin.users.search')} onSearch={setQ} />
      <QueryState query={query} isEmpty={(data) => data.rows.length === 0} emptyText={t('admin.users.empty')}>
        {(data) => (
          <>
            <DataTable columns={columns} rows={data.rows} rowKey={(user) => user.id} />
            <Pager page={page} total={data.total} onPage={setPage} />
          </>
        )}
      </QueryState>
      {acting ? (
        <FormDialog
          title={t(acting.action === 'block' ? 'admin.users.blockTitle' : 'admin.users.unblockTitle', {
            name: acting.user.display_name || t('admin.users.noName'),
          })}
          text={t(acting.action === 'block' ? 'admin.users.blockText' : 'admin.users.unblockText')}
          fields={[{ name: 'reason', label: t('admin.common.reason'), minLength: 5, multiline: true }]}
          confirmLabel={t(acting.action === 'block' ? 'admin.users.block' : 'admin.users.unblock')}
          danger={acting.action === 'block'}
          onCancel={() => setActing(null)}
          onConfirm={async ({ reason }) => {
            await api.post(`/admin/users/${acting.user.id}/${acting.action}`, { reason });
            await client.invalidateQueries({ queryKey: ['admin', 'users'] });
            setActing(null);
          }}
        />
      ) : null}
    </AdminPage>
  );
}
