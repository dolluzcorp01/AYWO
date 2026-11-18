// AYWO Admin only: the record of every staff action. Nothing here can be changed.
import { DateField } from '@/components/DateTimeField';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { AdminPage, adminStyles, DataTable, formatDate, Pager, QueryState, SearchBox, usePagedList, useKept } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import type { AuditRow } from '@/admin/types';

export default function AdminAudit() {
  const { t, i18n } = useTranslation();
  const [action, setAction] = useKept('action', '');
  const [from, setFrom] = useKept('from', '');
  const [to, setTo] = useKept('to', '');
  // What is typed is matched against the words in the Action column ("Removed staff"), not only the hidden codes:
  // the codes whose label contains it go to the server, which also looks in the staff name and the reason.
  const labels = t('admin.audit.actions', { returnObjects: true }) as Record<string, string>;
  const needle = action.trim().toLowerCase();
  const codes = needle ? Object.entries(labels).filter(([, label]) => typeof label === 'string' && label.toLowerCase().includes(needle)).map(([code]) => code) : [];
  const { query, page, setPage } = usePagedList<AuditRow>(['admin', 'audit'], '/admin/audit', {
    action: action || undefined,
    actions: codes.length ? codes.join(',') : undefined,
    from: from || undefined,
    to: to || undefined,
  });

  // Details in words: "Role: Sub-admin · Permissions: Help tickets, Users". Long internal ids are left out.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const say = (key: string, value: unknown): string | null => {
    if (value === null || value === undefined || value === '') return null;
    if (Array.isArray(value)) {
      const list = value.map((v) => say(key, v)).filter(Boolean);
      return list.length ? list.join(', ') : null;
    }
    if (typeof value === 'object') return null;
    const text = String(value);
    if (UUID.test(text)) return null;
    if (key === 'role') return t(`admin.roles.${text}`, { defaultValue: text });
    if (key === 'permissions') return t(`admin.permissions.${text}`, { defaultValue: text });
    if (typeof value === 'boolean') return t(value ? 'admin.user360.yes' : 'admin.user360.no');
    return text;
  };
  const detailText = (details: AuditRow['details']): string => {
    const parts = Object.entries(details ?? {})
      .map(([key, value]) => {
        const said = say(key, value);
        return said ? `${t(`admin.audit.keys.${key}`, { defaultValue: key.replace(/_/g, ' ') })}: ${said}` : null;
      })
      .filter(Boolean);
    return parts.length ? parts.join(' · ') : '-';
  };

  const columns: Column<AuditRow>[] = [
    { key: 'when', label: t('admin.audit.when'), render: (row) => formatDate(row.created_at, i18n.language) },
    { key: 'who', label: t('admin.audit.who'), render: (row) => row.actor_name || (row.actor_id ? t('admin.users.noName') : t('admin.audit.server')) },
    {
      key: 'action',
      label: t('admin.audit.action'),
      flex: 1.3,
      render: (row) => t(`admin.audit.actions.${row.action.replace(/\./g, '_')}`, { defaultValue: row.action }),
    },
    {
      key: 'target',
      label: t('admin.audit.target'),
      flex: 1.5,
      render: (row) => (
        <View>
          {row.target_name ? <Text style={adminStyles.cellStrong}>{row.target_name}</Text> : null}
          <Text style={adminStyles.cellMuted}>{t(`admin.audit.types.${row.target_type ?? 'none'}`, { defaultValue: row.target_type ?? '-' })}</Text>
          {/* A long internal id tells nobody anything; a short one (a masked phone, a setting name) does. */}
          {!row.target_name && row.target_id && !UUID.test(row.target_id) && !/^[0-9a-f]{32}$/.test(row.target_id) ? <Text style={adminStyles.cellMuted}>{row.target_id}</Text> : null}
        </View>
      ),
    },
    { key: 'reason', label: t('admin.audit.reason'), flex: 1.5, render: (row) => row.reason || '-' },
    {
      key: 'details',
      label: t('admin.audit.details'),
      flex: 1.5,
      render: (row) => <Text style={adminStyles.cellMuted}>{detailText(row.details)}</Text>,
    },
  ];

  return (
    <AdminPage title={t('admin.audit.title')} subtitle={t('admin.audit.subtitle')} gates={['audit']}>
      <SearchBox placeholder={t('admin.audit.search')} onSearch={setAction} initial={action} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <View style={{ minWidth: 220 }}>
          <DateField label={t('admin.audit.from')} value={from} onChange={setFrom} max={to || undefined} optional />
        </View>
        <View style={{ minWidth: 220 }}>
          <DateField label={t('admin.audit.to')} value={to} onChange={setTo} min={from || undefined} optional />
        </View>
      </View>
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
