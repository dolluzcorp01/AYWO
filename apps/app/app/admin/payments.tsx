// Plans and orders overview. Read only: webhooks alone change plans, and refunds happen at the store or gateway.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { AdminPage, adminStyles, DataTable, FilterChips, formatDate, Pager, PAGE_SIZE, QueryState, Section, StatCard, StatRow } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import type { PaymentsOverview, PlanRow } from '@/admin/types';
import { api } from '@/lib/api';

const STATUSES = ['all', 'active', 'trial', 'grace', 'expired', 'cancelled'] as const;
type Filter = (typeof STATUSES)[number];

export default function AdminPayments() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [status]);

  const query = useQuery({
    queryKey: ['admin', 'payments', status, page],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (status !== 'all') params.set('status', status);
      return api.get<PaymentsOverview>(`/admin/payments?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const planStatus = (value: string) => t(`admin.payments.status.${value}`, { defaultValue: value });
  const columns: Column<PlanRow>[] = [
    {
      key: 'payer',
      label: t('admin.payments.payer'),
      flex: 1.4,
      render: (plan) => (
        <View>
          <Text style={adminStyles.cellStrong}>{plan.payer_name || t('admin.users.noName')}</Text>
          <Text style={adminStyles.cellMuted}>{plan.payer_phone_masked ?? '-'}</Text>
        </View>
      ),
    },
    {
      key: 'plan',
      label: t('admin.payments.plan'),
      flex: 1.4,
      render: (plan) => (
        <View>
          <Text style={adminStyles.cellStrong}>{plan.product_id}</Text>
          <Text style={adminStyles.cellMuted}>{t(`admin.payments.store.${plan.store}`, { defaultValue: plan.store })}</Text>
        </View>
      ),
    },
    { key: 'status', label: t('admin.payments.statusLabel'), flex: 0.7, render: (plan) => planStatus(plan.status) },
    { key: 'members', label: t('admin.payments.members'), flex: 0.6, render: (plan) => plan.members },
    { key: 'renews', label: t('admin.payments.renews'), render: (plan) => formatDate(plan.renews_at ?? plan.trial_ends_at, i18n.language) },
    { key: 'external', label: t('admin.payments.externalId'), flex: 1.3, render: (plan) => <Text style={adminStyles.cellMuted}>{plan.external_id}</Text> },
  ];

  return (
    <AdminPage title={t('admin.payments.title')} subtitle={t('admin.payments.subtitle')} gates={['payments']}>
      <QueryState query={query}>
        {(data) => (
          <>
            <StatRow>
              <StatCard label={t('admin.payments.plans')} value={data.summary.plans} />
              <StatCard label={t('admin.payments.membersTotal')} value={data.summary.members} />
              {Object.entries(data.summary.by_store).map(([store, count]) => (
                <StatCard key={store} label={t(`admin.payments.store.${store}`, { defaultValue: store })} value={count} />
              ))}
            </StatRow>
            {data.orders ? (
              <Section title={t('admin.payments.orders')}>
                <StatRow>
                  <StatCard label={t('admin.payments.ordersTotal')} value={data.orders.total} />
                  {Object.entries(data.orders.by_status).map(([state, count]) => (
                    <StatCard key={state} label={t(`admin.payments.orderStatus.${state}`, { defaultValue: state })} value={count} />
                  ))}
                  {Object.entries(data.orders.paid_minor_by_currency).map(([currency, minor]) => (
                    <StatCard key={currency} label={t('admin.payments.paidIn', { currency })} value={Number(minor) / 100} />
                  ))}
                </StatRow>
              </Section>
            ) : null}
            <Section title={t('admin.payments.plansList')}>
              <FilterChips
                value={status}
                onChange={setStatus}
                options={STATUSES.map((value) => ({
                  value,
                  label: value === 'all' ? t('admin.payments.all') : planStatus(value),
                }))}
              />
              {data.rows.length === 0 ? (
                <Text style={adminStyles.cellMuted}>{t('admin.payments.empty')}</Text>
              ) : (
                <>
                  <DataTable columns={columns} rows={data.rows} rowKey={(plan) => plan.id} />
                  <Pager page={page} total={data.total} onPage={setPage} />
                </>
              )}
            </Section>
          </>
        )}
      </QueryState>
    </AdminPage>
  );
}
