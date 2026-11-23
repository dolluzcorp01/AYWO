// Growth and use, in counts only. No one's family details appear here.
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@/lib/router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Funnel } from '@/admin/Funnel';
import type { FunnelAnswer } from '@/admin/Funnel';
import type { Analytics } from '@/admin/types';
import { useAdminAccess } from '@/admin/access';
import { AdminPage, Bars, Facts, FilterChips, money, Panel, QueryState, Section, StatCard, StatRow, useKept } from '@/admin/ui';
import { api } from '@/lib/api';
import { colors, fonts } from '@/theme/tokens';

export default function AdminAnalytics() {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useKept<'7' | '30' | '90'>('days', '30');
  const router = useRouter();
  // The counts that have a list behind them open it, for staff who may open Users.
  const canUsers = useAdminAccess().can(['users', 'support']);
  const users = (filter?: 'active30' | 'plus') => (canUsers ? () => router.navigate({ pathname: '/admin/users', params: filter ? { filter } : {} }) : undefined);
  const query = useQuery({ queryKey: ['admin', 'analytics', days], queryFn: () => api.get<Analytics>(`/admin/analytics?days=${days}`) });
  const funnel = useQuery({ queryKey: ['admin', 'funnel', days], queryFn: () => api.get<FunnelAnswer>(`/admin/funnel?days=${days}`) });

  return (
    <AdminPage title={t('admin.analytics.title')} subtitle={t('admin.analytics.subtitle')} gates={['analytics']}>
      <FilterChips
        value={days}
        onChange={setDays}
        options={[
          { value: '7', label: t('admin.analytics.lastDays', { count: 7 }) },
          { value: '30', label: t('admin.analytics.lastDays', { count: 30 }) },
          { value: '90', label: t('admin.analytics.lastDays', { count: 90 }) },
        ]}
      />
      <Panel title={t('admin.funnel.title', { count: Number(days) })}>
        <Text style={styles.help}>{t('admin.funnel.help')}</Text>
        <QueryState query={funnel}>{(data) => <Funnel data={data} />}</QueryState>
      </Panel>
      <QueryState query={query}>
        {(data) => {
          // "17 Nov", not "11-17", which reads as a month first.
          const dayLabels = data.daily.map((d) => new Date(`${d.day.slice(0, 10)}T12:00:00`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }));
          const languageName = (code: string) => {
            try {
              return new Intl.DisplayNames([i18n.language], { type: 'language' }).of(code) ?? code;
            } catch {
              return code;
            }
          };
          const DEVICE: Record<string, string> = { ios: 'iPhone', android: 'Android', web: t('admin.analytics.webBrowser') };
          const series = (key: keyof Analytics['daily'][number]) => data.daily.map((d) => Number(d[key]));
          const pct = (part: number) => (data.funnel.signed_up ? `${Math.round((100 * part) / data.funnel.signed_up)}%` : '0%');
          return (
            <>
              <StatRow>
                <StatCard label={t('admin.analytics.users')} value={data.totals.users} onPress={users()} />
                <StatCard label={t('admin.analytics.active1')} value={data.totals.active_1d} />
                <StatCard label={t('admin.analytics.active7')} value={data.totals.active_7d} />
                <StatCard label={t('admin.analytics.active30')} value={data.totals.active_30d} onPress={users('active30')} />
                <StatCard label={t('admin.analytics.plus')} value={data.totals.plus} onPress={users('plus')} />
              </StatRow>
              <Section title={t('admin.analytics.everyDay')}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                  <Bars label={t('admin.analytics.signups')} values={series('signups')} days={dayLabels} />
                  <Bars label={t('admin.analytics.trees')} values={series('trees')} days={dayLabels} />
                  <Bars label={t('admin.analytics.people')} values={series('people')} days={dayLabels} />
                  <Bars label={t('admin.analytics.memories')} values={series('memories')} days={dayLabels} />
                  <Bars label={t('admin.analytics.messages')} values={series('messages')} days={dayLabels} />
                  <Bars label={t('admin.analytics.plusStarted')} values={series('plus_started')} days={dayLabels} />
                  <Bars label={t('admin.analytics.orders')} values={series('orders')} days={dayLabels} />
                  <Bars label={t('admin.analytics.sos')} values={series('sos')} days={dayLabels} />
                </View>
              </Section>
              <Panel title={t('admin.analytics.funnelAllTime')}>
                <Facts
                  items={[
                    [t('admin.analytics.funnelSigned'), `${data.funnel.signed_up}`],
                    [t('admin.analytics.funnelTree'), `${data.funnel.built_tree} (${pct(data.funnel.built_tree)})`],
                    [t('admin.analytics.funnelFive'), `${data.funnel.added_5} (${pct(data.funnel.added_5)})`],
                    [t('admin.analytics.funnelShared'), `${data.funnel.shared} (${pct(data.funnel.shared)})`],
                    [t('admin.analytics.funnelPlus'), `${data.funnel.plus} (${pct(data.funnel.plus)})`],
                  ]}
                />
              </Panel>
              <Panel title={t('admin.analytics.more')}>
                <Facts
                  items={[
                    [t('admin.analytics.revenue'), Object.entries(data.totals.revenue_minor).map(([c, n]) => money(n, c, i18n.language)).join(' + ') || '0'],
                    [t('admin.analytics.trees'), `${data.totals.trees}`],
                    [t('admin.analytics.peopleTotal'), `${data.totals.people}`],
                    [t('admin.analytics.optIn'), `${data.totals.marketing_opt_in}`],
                    [t('admin.analytics.referrals'), `${data.totals.referrals}`],
                    [t('admin.analytics.plans'), Object.entries(data.plans).map(([s, n]) => `${t(`admin.payments.store.${s}`)} ${n}`).join(', ') || '0'],
                    [t('admin.analytics.languages'), Object.entries(data.languages).map(([l, n]) => `${languageName(l)} ${n}`).join(', ') || '-'],
                    [t('admin.analytics.devices'), Object.entries(data.devices).map(([p, n]) => `${DEVICE[p] ?? p} ${n}`).join(', ') || '-'],
                  ]}
                />
              </Panel>
            </>
          );
        }}
      </QueryState>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  help: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, marginBottom: 6 },
});
