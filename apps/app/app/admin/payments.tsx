// Plans and orders overview. Read only: webhooks alone change plans, and refunds happen at the store or gateway.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAdminAccess } from '@/admin/access';
import { Actions, AdminPage, adminStyles, DataTable, DownloadList, FilterChips, formatDate, money, Pager, PAGE_SIZE, QueryState, SearchBox, SecondaryButton, Section, StatCard, StatRow, useKept } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import type { PaymentsOverview, PlanRow } from '@/admin/types';
import { api } from '@/lib/api';
import { colors, fonts } from '@/theme/tokens';

const STATUSES = ['all', 'active', 'trial', 'grace', 'expired', 'cancelled'] as const;
type Filter = (typeof STATUSES)[number];

/** Monthly or yearly, read from the product code. Every store names its products its own way, but all say the period. */
function planPeriod(productId: string): 'monthly' | 'yearly' | null {
  const code = productId.toLowerCase();
  if (/year|annual/.test(code)) return 'yearly';
  if (/month/.test(code)) return 'monthly';
  return null;
}

export default function AdminPayments() {
  const { t, i18n } = useTranslation();
  // A dashboard card opens this page already narrowed, such as ?status=trial.
  const params = useLocalSearchParams<{ status?: string }>();
  const asked = STATUSES.find((value) => value === params.status);
  const [status, setStatusOnly] = useKept<Filter>('status', 'all', asked);
  const [page, setPage] = useKept('page', 0);
  const [q, setQOnly] = useKept('q', '');
  // A new filter or search starts again at the first page.
  const setStatus = (value: Filter) => {
    setStatusOnly(value);
    setPage(0);
  };
  const setQ = (value: string) => {
    setQOnly(value);
    setPage(0);
  };
  const router = useRouter();
  // The payer's name opens their account page, for the people who may open accounts.
  const access = useAdminAccess();
  const canOpenAccount = access.can(['users', 'support']);
  const canOpenOrders = access.can(['orders', 'payments']);

  const query = useQuery({
    queryKey: ['admin', 'payments', status, q, page],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (status !== 'all') params.set('status', status);
      if (q) params.set('q', q);
      return api.get<PaymentsOverview>(`/admin/payments?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const planStatus = (value: string) => t(`admin.payments.status.${value}`, { defaultValue: value });
  // "AYWO Plus, yearly" where the code says which; the raw code otherwise, so nothing is ever hidden.
  const planName = (productId: string) => {
    const period = planPeriod(productId);
    return period ? t(`admin.payments.period.${period}`) : productId;
  };
  const columns: Column<PlanRow>[] = [
    {
      key: 'payer',
      label: t('admin.payments.payer'),
      flex: 1.4,
      render: (plan) => (
        <View>
          {canOpenAccount ? (
            <Pressable accessibilityRole="link" onPress={() => router.navigate({ pathname: '/admin/user/[id]', params: { id: plan.payer_id } })}>
              <Text style={styles.link}>{plan.payer_name || t('admin.users.noName')}</Text>
            </Pressable>
          ) : (
            <Text style={adminStyles.cellStrong}>{plan.payer_name || t('admin.users.noName')}</Text>
          )}
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
          <Text style={adminStyles.cellStrong}>{planName(plan.product_id)}</Text>
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
                  <StatCard label={t('admin.payments.ordersTotal')} value={data.orders.total} onPress={canOpenOrders ? () => router.navigate({ pathname: '/admin/orders', params: { step: 'all' } }) : undefined} />
                  {Object.entries(data.orders.by_status).map(([state, count]) => (
                    <StatCard key={state} label={t(`admin.payments.orderStatus.${state}`, { defaultValue: state })} value={count} />
                  ))}
                  {Object.entries(data.orders.paid_minor_by_currency).map(([currency, minor]) => (
                    <StatCard key={currency} label={t('admin.payments.paidIn', { currency })} value={money(Number(minor), currency, i18n.language)} />
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
              {/* The key empties the box when the search is cleared with the button below. */}
              <SearchBox key={q} placeholder={t('admin.payments.search')} onSearch={setQ} initial={q} />
              {q ? (
                <Actions>
                  <Text style={adminStyles.cellMuted}>{t('admin.payments.searchingFor', { q })}</Text>
                  <SecondaryButton label={t('admin.payments.clearSearch')} onPress={() => setQ('')} />
                </Actions>
              ) : null}
              {data.rows.length === 0 ? (
                <Text style={adminStyles.cellMuted}>{q ? t('admin.payments.noMatch') : t('admin.payments.empty')}</Text>
              ) : (
                <>
                  <DataTable columns={columns} rows={data.rows} rowKey={(plan) => plan.id} />
                  <Pager page={page} total={data.total} onPage={setPage} />
                  <DownloadList
                    fileName="aywo-plans"
                    title={t('admin.payments.title')}
                    headers={[
                      t('admin.payments.payer'), t('admin.payments.csvPhone'), t('admin.payments.plan'), t('admin.payments.csvStore'), t('admin.payments.statusLabel'),
                      t('admin.payments.members'), t('admin.payments.renews'), t('admin.payments.externalId'),
                    ]}
                    rows={data.rows.map((plan) => [
                      plan.payer_name ?? '',
                      plan.payer_phone_masked ?? '',
                      planName(plan.product_id),
                      t(`admin.payments.store.${plan.store}`, { defaultValue: plan.store }),
                      planStatus(plan.status),
                      String(plan.members),
                      formatDate(plan.renews_at ?? plan.trial_ends_at, i18n.language),
                      plan.external_id,
                    ])}
                  />
                </>
              )}
            </Section>
          </>
        )}
      </QueryState>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  // A name that opens the account: the same weight as other names, in the link colour.
  link: { color: colors.logoIndigo, fontFamily: fonts.bold, fontSize: 14, textDecorationLine: 'underline' },
});
