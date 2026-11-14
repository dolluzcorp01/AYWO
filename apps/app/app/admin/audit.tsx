// AYWO Admin only: the record of every staff action. Nothing here can be changed.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { AdminPage, adminStyles, DataTable, formatDate, Pager, QueryState, SearchBox, usePagedList } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import type { AuditRow } from '@/admin/types';

export default function AdminAudit() {
  const { t, i18n } = useTranslation();
  const [action, setAction] = useState('');
  const { query, page, setPage } = usePagedList<AuditRow>(['admin', 'audit'], '/admin/audit', { action });

  const columns: Column<AuditRow>[] = [
    { key: 'when', label: t('admin.audit.when'), render: (row) => formatDate(row.created_at, i18n.language) },
    { key: 'who', label: t('admin.audit.who'), render: (row) => row.actor_name || (row.actor_id ? t('admin.users.noName') : t('admin.audit.server')) },
    {
      key: 'action',
      label: t('admin.audit.action'),
      flex: 1.3,
      render: (row) => t(`admin.audit.actions.${row.action.replace('.', '_')}`, { defaultValue: row.action }),
    },
    {
      key: 'target',
      label: t('admin.audit.target'),
      flex: 1.5,
      render: (row) => (
        <View>
          {row.target_name ? <Text style={adminStyles.cellStrong}>{row.target_name}</Text> : null}
          <Text style={adminStyles.cellMuted}>{t(`admin.audit.types.${row.target_type ?? 'none'}`, { defaultValue: row.target_type ?? '-' })}</Text>
          {!row.target_name ? <Text style={adminStyles.cellMuted}>{row.target_id ?? '-'}</Text> : null}
        </View>
      ),
    },
    { key: 'reason', label: t('admin.audit.reason'), flex: 1.5, render: (row) => row.reason || '-' },
    {
      key: 'details',
      label: t('admin.audit.details'),
      flex: 1.5,
      render: (row) => <Text style={adminStyles.cellMuted}>{Object.keys(row.details).length ? JSON.stringify(row.details) : '-'}</Text>,
    },
  ];

  return (
    <AdminPage title={t('admin.audit.title')} subtitle={t('admin.audit.subtitle')} gates={['audit']}>
      <SearchBox placeholder={t('admin.audit.search')} onSearch={setAction} />
      <QueryState query={query} isEmpty={(data) => data.rows.length === 0} emptyText={t('admin.audit.empty')}>
        {(data) => (
          <>
            <DataTable columns={columns} rows={data.rows} rowKey={(row) => String(row.id)} />
            <Pager page={page} total={data.total} onPage={setPage} />
          </>
        )}
      </QueryState>
    </AdminPage>
  );
}
