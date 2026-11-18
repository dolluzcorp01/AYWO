// Find accounts; open one account's full view; block and unblock. Phones and emails are masked by the server.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { useAdminAccess } from '@/admin/access';
import { Actions, AdminPage, adminStyles, DataTable, FilterChips, FormDialog, formatDate, Pager, Pill, QueryState, SearchBox, SecondaryButton, usePagedList, useRefreshAfter, useKept } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import type { UserRow } from '@/admin/types';
import { api } from '@/lib/api';

const FILTERS = ['all', 'blocked', 'plus', 'staff', 'active30', 'new7', 'offers'] as const;
type Filter = (typeof FILTERS)[number];
type Sort = 'newest' | 'active' | 'name';

export default function AdminUsers() {
  const { t, i18n } = useTranslation();
  const access = useAdminAccess();
  const router = useRouter();
  const refreshAfter = useRefreshAfter();
  const [q, setQ] = useKept('q', '');
  const [acting, setActing] = useState<{ user: UserRow; action: 'block' | 'unblock' } | null>(null);
  // A dashboard card opens this page already narrowed, such as ?filter=blocked.
  const params = useLocalSearchParams<{ filter?: string }>();
  const asked = FILTERS.find((value) => value === params.filter);
  const [filter, setFilter] = useKept<Filter>('filter', 'all', asked);
  const [sort, setSort] = useKept<Sort>('sort', 'newest');
  const [copied, setCopied] = useState<string | null>(null);
  const { query, page, setPage } = usePagedList<UserRow>(['admin', 'users'], '/admin/users', { q, filter, sort });
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
          {/* The long internal id is not for reading. It can still be copied, for a search or a note to a colleague. */}
          <Text
            accessibilityRole="button"
            style={[adminStyles.cellMuted, { textDecorationLine: 'underline' }]}
            onPress={() => {
              void globalThis.navigator?.clipboard?.writeText(user.id).then(() => setCopied(user.id));
            }}
          >
            {copied === user.id ? t('admin.users.idCopied') : t('admin.users.copyId')}
          </Text>
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
      <SearchBox placeholder={t('admin.users.search')} onSearch={setQ} initial={q} />
      <FilterChips
        value={filter}
        onChange={setFilter}
        options={FILTERS.map((value) => ({ value, label: t(`admin.users.filters.${value}`) }))}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <Text style={adminStyles.fieldLabel}>{t('admin.users.sortBy')}</Text>
        <FilterChips
          value={sort}
          onChange={setSort}
          options={(['newest', 'active', 'name'] as Sort[]).map((value) => ({ value, label: t(`admin.users.sorts.${value}`) }))}
        />
      </View>
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
            setActing(null);
            // A block also changes the dashboard's blocked count and, for a staff account, the Staff page.
            await refreshAfter('users', 'staff');
          }}
        />
      ) : null}
    </AdminPage>
  );
}
