// Staff dashboard. The work queue first, then each area this person is granted. The server sends only those groups.
import { MENU, useAdminAccess } from '@/admin/access';
import { MyAccess } from '@/admin/MyAccess';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@/lib/router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { TwoStepSetup } from '@/admin/TwoStep';
import { Actions, AdminPage, adminStyles, Panel, QueryState, Section, SecondaryButton, StatCard, StatRow } from '@/admin/ui';
import type { Dashboard } from '@/admin/types';
import { api } from '@/lib/api';

export default function AdminDashboard() {
  const { t } = useTranslation();
  const router = useRouter();
  const query = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: () => api.get<Dashboard>('/admin/dashboard') });
  const twoStep = useQuery({ queryKey: ['admin', 'two-step'], queryFn: () => api.get<{ set_up: boolean; required: boolean }>('/admin/two-step') });
  const [settingUp, setSettingUp] = useState(false);
  // The queue counts come for every staff member, but the page itself opens only with one of its permissions:
  // a card that leads to "You don't have permission" is worse than no card.
  const access = useAdminAccess();
  const canWork = access.can(MENU.find((item) => item.key === 'work')?.gates ?? []);
  const canUsers = access.can(MENU.find((item) => item.key === 'users')?.gates ?? []);

  if (settingUp) return <TwoStepSetup onDone={() => { setSettingUp(false); twoStep.refetch(); }} onCancel={() => setSettingUp(false)} />;

  return (
    <AdminPage title={t('admin.dashboard.title')} subtitle={t('admin.dashboard.subtitle')}>
      {twoStep.data && !twoStep.data.set_up ? (
        <Panel title={t('admin.dashboard.twoStepTitle')}>
          <Text style={adminStyles.cellMuted}>{t('admin.dashboard.twoStepText')}</Text>
          <Actions>
            <SecondaryButton main label={t('admin.twoStep.begin')} onPress={() => setSettingUp(true)} />
          </Actions>
        </Panel>
      ) : null}
      <QueryState query={query} isEmpty={(data) => Object.keys(data).filter((key) => key !== 'work' || canWork).length === 0} emptyText={t('admin.dashboard.empty')}>
        {(data) => (
          <>
            {data.work && canWork ? (
              <Section title={t('admin.menu.work')}>
                <StatRow>
                  <StatCard label={t('admin.work.views.mine')} value={data.work.mine} onPress={() => router.navigate({ pathname: '/admin/work', params: { view: 'mine' } })} />
                  <StatCard label={t('admin.work.views.open')} value={data.work.open} onPress={() => router.navigate({ pathname: '/admin/work', params: { view: 'open' } })} />
                  <StatCard label={t('admin.work.views.unassigned')} value={data.work.unassigned} onPress={() => router.navigate({ pathname: '/admin/work', params: { view: 'unassigned' } })} />
                  <StatCard label={t('admin.work.views.overdue')} value={data.work.overdue} onPress={() => router.navigate({ pathname: '/admin/work', params: { view: 'overdue' } })} />
                </StatRow>
              </Section>
            ) : null}
            {data.moderation || data.support || data.takedowns || data.dictionary ? (
              <Section title={t('admin.dashboard.waiting')}>
                <StatRow>
                  {data.moderation ? <StatCard label={t('admin.dashboard.abuseReports')} value={data.moderation.open} onPress={() => router.navigate('/admin/reports')} /> : null}
                  {data.support ? <StatCard label={t('admin.dashboard.ticketsOpen')} value={data.support.open} onPress={() => router.navigate('/admin/tickets')} /> : null}
                  {data.takedowns ? <StatCard label={t('admin.dashboard.openTakedowns')} value={data.takedowns.open} onPress={() => router.navigate('/admin/takedowns')} /> : null}
                  {data.dictionary ? (
                    <>
                      <StatCard label={t('admin.dashboard.pendingTerms')} value={data.dictionary.pending_terms} onPress={() => router.navigate('/admin/dictionary')} />
                      <StatCard label={t('admin.dashboard.openReports')} value={data.dictionary.open_reports} onPress={() => router.navigate({ pathname: '/admin/dictionary', params: { tab: 'reports' } })} />
                    </>
                  ) : null}
                </StatRow>
              </Section>
            ) : null}
            {data.orders ? (
              <Section title={t('admin.menu.orders')}>
                <StatRow>
                  <StatCard label={t('admin.orders.steps.queued')} value={data.orders.queued} onPress={() => router.navigate({ pathname: '/admin/orders', params: { step: 'queued' } })} />
                  <StatCard label={t('admin.orders.steps.printing')} value={data.orders.printing} onPress={() => router.navigate({ pathname: '/admin/orders', params: { step: 'printing' } })} />
                  <StatCard label={t('admin.orders.steps.shipped')} value={data.orders.shipped} onPress={() => router.navigate({ pathname: '/admin/orders', params: { step: 'shipped' } })} />
                </StatRow>
              </Section>
            ) : null}
            {data.users ? (
              <Section title={t('admin.menu.users')}>
                <StatRow>
                  <StatCard label={t('admin.dashboard.usersTotal')} value={data.users.total} onPress={() => router.navigate('/admin/users')} />
                  <StatCard label={t('admin.dashboard.usersActive')} value={data.users.active_30d} onPress={() => router.navigate({ pathname: '/admin/users', params: { filter: 'active30' } })} />
                  <StatCard label={t('admin.dashboard.usersNew')} value={data.users.new_7d} onPress={() => router.navigate({ pathname: '/admin/users', params: { filter: 'new7' } })} />
                  <StatCard label={t('admin.dashboard.usersBlocked')} value={data.users.blocked} onPress={() => router.navigate({ pathname: '/admin/users', params: { filter: 'blocked' } })} />
                </StatRow>
              </Section>
            ) : null}
            {data.marketing ? (
              <Section title={t('admin.menu.offers')}>
                <StatRow>
                  <StatCard label={t('admin.dashboard.couponsRunning')} value={data.marketing.coupons_running} onPress={() => router.navigate('/admin/offers')} />
                  <StatCard label={t('admin.dashboard.bannersRunning')} value={data.marketing.banners_running} onPress={() => router.navigate('/admin/offers')} />
                  {/* The accounts themselves for staff who may open Users; the promotions page for the rest. */}
                  <StatCard
                    label={t('admin.dashboard.optedIn')}
                    value={data.marketing.opted_in}
                    onPress={() => (canUsers ? router.navigate({ pathname: '/admin/users', params: { filter: 'offers' } }) : router.navigate('/admin/offers'))}
                  />
                </StatRow>
              </Section>
            ) : null}
            {data.trees ? (
              <Section title={t('admin.menu.trees')}>
                <StatRow>
                  <StatCard label={t('admin.dashboard.treesTotal')} value={data.trees.total} onPress={() => router.navigate('/admin/trees')} />
                  <StatCard label={t('admin.dashboard.people')} value={data.trees.people} onPress={() => router.navigate('/admin/trees')} />
                </StatRow>
              </Section>
            ) : null}
            {data.payments ? (
              <Section title={t('admin.menu.payments')}>
                <StatRow>
                  <StatCard label={t('admin.dashboard.plansActive')} value={data.payments.active} onPress={() => router.navigate({ pathname: '/admin/payments', params: { status: 'active' } })} />
                  <StatCard label={t('admin.dashboard.plansTrial')} value={data.payments.trial} onPress={() => router.navigate({ pathname: '/admin/payments', params: { status: 'trial' } })} />
                  <StatCard label={t('admin.dashboard.plansGrace')} value={data.payments.grace} onPress={() => router.navigate({ pathname: '/admin/payments', params: { status: 'grace' } })} />
                </StatRow>
              </Section>
            ) : null}
            {data.health ? (
              <Section title={t('admin.settings.health')}>
                <StatRow>
                  <StatCard label={t('admin.dashboard.crashes')} value={data.health.errors_24h} onPress={() => router.navigate('/admin/settings')} />
                  {data.health.maintenance ? <StatCard label={t('admin.settings.maintenanceOn')} value={1} onPress={() => router.navigate('/admin/settings')} /> : null}
                </StatRow>
              </Section>
            ) : null}
            {data.staff ? (
              <Section title={t('admin.menu.staff')}>
                <StatRow>
                  <StatCard label={t('admin.dashboard.admins')} value={data.staff.admins} onPress={() => router.navigate({ pathname: '/admin/staff', params: { show: 'aywo_admin' } })} />
                  <StatCard label={t('admin.dashboard.subAdmins')} value={data.staff.sub_admins} onPress={() => router.navigate({ pathname: '/admin/staff', params: { show: 'sub_admin' } })} />
                  <StatCard label={t('admin.dashboard.withoutTwoStep')} value={data.staff.without_two_step} onPress={() => router.navigate({ pathname: '/admin/staff', params: { show: 'no_two_step' } })} />
                </StatRow>
              </Section>
            ) : null}
          </>
        )}
      </QueryState>
      <MyAccess />
    </AdminPage>
  );
}
