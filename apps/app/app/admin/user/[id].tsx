// One account, everything staff may see about it: plan, trees, orders, tickets, reports, devices and staff history.
// Opening it needs a reason, which is recorded. Phone and email stay partly hidden; family details stay private.
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/lib/router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { useAdminAccess } from '@/admin/access';
import type { UserDetail } from '@/admin/types';
import { Actions, AdminPage, adminStyles, Facts, Field, formatDate, FormDialog, Message, Missing, money, Panel, Pill, SecondaryButton, useAction, useRefreshAfter } from '@/admin/ui';
import { ApiFailure, api } from '@/lib/api';

// The reason typed for one account is kept until the browser tab is closed, so a refresh or coming back from another
// page does not ask for it again. The server still records every look, each with this reason.
const reasonKey = (id: string) => `aywo.admin.viewReason.${id}`;
function recallReason(id: string): string {
  try {
    return globalThis.sessionStorage?.getItem(reasonKey(id)) ?? '';
  } catch {
    return '';
  }
}
function keepReason(id: string, reason: string | null) {
  try {
    if (reason) globalThis.sessionStorage?.setItem(reasonKey(id), reason);
    else globalThis.sessionStorage?.removeItem(reasonKey(id));
  } catch {
    // A browser that refuses storage just asks for the reason again.
  }
}

export default function AdminUser() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const access = useAdminAccess();
  const refreshAfter = useRefreshAfter();
  const [reason, setReason] = useState('');
  const [user, setUser] = useState<UserDetail | null>(null);
  const [doing, setDoing] = useState<'block' | 'unblock' | 'end' | 'plus' | 'minus' | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const action = useAction();
  // The server lets only an AYWO Admin block a staff account or sign it out, so the buttons are not offered to others.
  const staffLocked = !!user?.staff_role && !access.can(['staff']);
  // Free days can be taken back only while some are left.
  const hasFreeDays = !!user?.plus_bonus_until && Date.parse(user.plus_bonus_until) > Date.now();

  const openWith = (why: string) =>
    action.run(async () => {
      setUser(await api.post<UserDetail>(`/admin/users/${id}/view`, { reason: why }));
      keepReason(id, why);
    });
  const open = () => openWith(reason.trim());
  // Back on an account already opened in this tab: its reason is reused. A different account asks afresh.
  useEffect(() => {
    setUser(null);
    setDone(null);
    const kept = recallReason(id);
    setReason(kept);
    if (kept.length >= 5) void openWith(kept);
    // Only the account in the address decides this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  // The server has no way to read an account without recording a view, so the reload after an action is a second
  // audited view with the same reason.
  const reload = open;
  const yesNo = (v: boolean) => (v ? t('admin.user360.yes') : t('admin.user360.no'));

  return (
    <AdminPage title={user?.display_name || t('admin.user360.title')} subtitle={t('admin.user360.subtitle')} gates={['users', 'support']}>
      <Actions>
        <SecondaryButton label={t('admin.user360.back')} onPress={() => router.navigate('/admin/users')} />
      </Actions>
      {!user ? (
        <Panel title={t('admin.user360.askTitle')}>
          <Text style={adminStyles.cellMuted}>{t('admin.user360.askText')}</Text>
          <Field label={t('admin.common.reason')} value={reason} onChange={setReason} multiline maxLength={500} />
          {action.failure ? <Message text={action.failure} alert /> : null}
          <Actions>
            <SecondaryButton main label={t('admin.user360.open')} disabled={reason.trim().length < 5 || action.busy} onPress={open} />
          </Actions>
          <Missing reasons={[reason.trim().length < 5 && t('admin.common.needsText', { field: t('admin.common.reason'), count: 5 })]} />
        </Panel>
      ) : (
        <>
          <Actions>
            {user.blocked_at ? <Pill label={t('admin.users.blocked')} alert /> : null}
            {user.deleted ? <Pill label={t('admin.users.deleted')} alert /> : null}
            {user.plus ? <Pill label={t('admin.users.plus')} /> : null}
            {user.staff_role ? <Pill label={t(`admin.roles.${user.staff_role}`)} /> : null}
            {user.is_minor ? <Pill label={t('admin.user360.minor')} alert /> : null}
          </Actions>
          {/* Says that the reason is being reused, and gives the way to type a new one. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <Text style={[adminStyles.cellMuted, { flexShrink: 1 }]}>{t('admin.user360.reasonKept', { reason: reason.trim() })}</Text>
            <SecondaryButton
              label={t('admin.user360.changeReason')}
              onPress={() => {
                keepReason(id, null);
                setReason('');
                setDone(null);
                setUser(null);
              }}
            />
          </View>
          {done ? <Message text={done} good /> : null}
          {action.failure ? (
            <>
              <Message text={t('admin.user360.reloadFailed', { why: action.failure })} alert />
              <Actions>
                <SecondaryButton label={t('admin.common.tryAgain')} disabled={action.busy} onPress={reload} />
              </Actions>
            </>
          ) : null}
          {staffLocked && access.can(['users']) ? <Text style={adminStyles.cellMuted}>{t('admin.user360.staffLocked')}</Text> : null}
          <Panel
            title={t('admin.user360.account')}
            actions={
              <Actions>
                {access.can(['users']) && !staffLocked ? (
                  user.blocked_at ? (
                    <SecondaryButton label={t('admin.users.unblock')} onPress={() => setDoing('unblock')} />
                  ) : (
                    <SecondaryButton label={t('admin.users.block')} danger onPress={() => setDoing('block')} />
                  )
                ) : null}
                {access.can(['users']) && !staffLocked ? <SecondaryButton label={t('admin.user360.endSessions')} onPress={() => setDoing('end')} /> : null}
                {access.can(['payments', 'support']) ? <SecondaryButton label={t('admin.user360.givePlus')} onPress={() => setDoing('plus')} /> : null}
                {access.can(['payments', 'support']) && hasFreeDays ? <SecondaryButton label={t('admin.user360.takePlus')} onPress={() => setDoing('minus')} /> : null}
                {access.can(['staff']) && !user.staff_role && !user.deleted && !user.blocked_at ? (
                  <SecondaryButton label={t('admin.user360.makeStaff')} onPress={() => router.navigate({ pathname: '/admin/staff', params: { add: user.id, name: user.display_name } })} />
                ) : null}
              </Actions>
            }
          >
            <Facts
              items={[
                [t('admin.users.phoneEmail'), [user.phone_masked, user.email_masked].filter(Boolean).join(' · ') || '-'],
                [t('admin.user360.emailVerified'), yesNo(user.email_verified)],
                [t('admin.user360.language'), user.language],
                [t('admin.user360.joined'), formatDate(user.created_at, i18n.language)],
                [t('admin.users.lastActive'), formatDate(user.last_active_at, i18n.language)],
                [t('admin.user360.offers'), yesNo(user.marketing_opt_in)],
                [t('admin.user360.freePlus'), user.plus_bonus_until ? formatDate(user.plus_bonus_until, i18n.language) : '-'],
                [t('admin.user360.devices'), user.devices.map((d) => `${d.platform} (${formatDate(d.last_seen_at, i18n.language)})`).join(', ') || '-'],
              ]}
            />
          </Panel>
          <Panel title={t('admin.user360.activity')}>
            <Facts items={Object.entries(user.counts).map(([k, v]) => [t(`admin.user360.counts.${k}`, { defaultValue: k }), `${v}`] as [string, string])} />
          </Panel>
          <Panel title={t('admin.user360.plans')}>
            {user.plans.length === 0 ? <Text style={adminStyles.cellMuted}>{t('admin.user360.none')}</Text> : null}
            {user.plans.map((p, i) => (
              <Text key={i} style={adminStyles.cellStrong}>
                {t(`admin.payments.store.${p.store}`)} · {p.product_id} · {t(`admin.payments.status.${p.status}`)} · {p.payer ? t('admin.user360.pays') : t('admin.user360.member')} ·{' '}
                {formatDate(p.renews_at ?? p.trial_ends_at, i18n.language)}
              </Text>
            ))}
          </Panel>
          <Panel title={t('admin.user360.trees')}>
            {user.trees.length === 0 ? <Text style={adminStyles.cellMuted}>{t('admin.user360.none')}</Text> : null}
            {user.trees.map((tree) => (
              <Text
                key={tree.id}
                style={[adminStyles.cellStrong, access.can(['trees']) && { textDecorationLine: 'underline' }]}
                accessibilityRole={access.can(['trees']) ? 'link' : undefined}
                onPress={access.can(['trees']) ? () => router.navigate({ pathname: '/admin/trees', params: { q: tree.id } }) : undefined}
              >
                {tree.name} · {tree.creator ? t('admin.user360.creator') : t('admin.user360.sharedWith')} · {t('admin.user360.peopleCount', { count: tree.people })}
              </Text>
            ))}
          </Panel>
          <Panel title={t('admin.user360.orders')}>
            {user.orders.length === 0 ? <Text style={adminStyles.cellMuted}>{t('admin.user360.none')}</Text> : null}
            {user.orders.map((o) => (
              <Text
                key={o.id}
                style={[adminStyles.cellStrong, access.can(['orders']) && { textDecorationLine: 'underline' }]}
                accessibilityRole={access.can(['orders']) ? 'link' : undefined}
                onPress={access.can(['orders']) ? () => router.navigate({ pathname: '/admin/orders', params: { open: o.id } }) : undefined}
              >
                {t(`admin.orders.products.${o.product}`)} · {money(o.amount_minor, o.currency, i18n.language)} · {t(`admin.payments.orderStatus.${o.status}`)}
                {o.fulfilment !== 'none' ? ` · ${t(`admin.orders.steps.${o.fulfilment}`)}` : ''} · {formatDate(o.created_at, i18n.language)}
              </Text>
            ))}
          </Panel>
          <Panel title={t('admin.user360.tickets')}>
            {user.tickets.length === 0 ? <Text style={adminStyles.cellMuted}>{t('admin.user360.none')}</Text> : null}
            {user.tickets.map((tk) => (
              <Text
                key={tk.id}
                style={[adminStyles.cellStrong, access.can(['support']) && { textDecorationLine: 'underline' }]}
                accessibilityRole={access.can(['support']) ? 'link' : undefined}
                onPress={access.can(['support']) ? () => router.navigate({ pathname: '/admin/tickets', params: { open: tk.id } }) : undefined}
              >
                {tk.subject} · {t(`admin.tickets.${tk.status}`)} · {formatDate(tk.updated_at, i18n.language)}
              </Text>
            ))}
          </Panel>
          <Panel title={t('admin.user360.history')}>
            {user.history.length === 0 ? <Text style={adminStyles.cellMuted}>{t('admin.user360.none')}</Text> : null}
            {user.history.map((h, i) => (
              <View key={i}>
                <Text style={adminStyles.cellStrong}>{t(`admin.audit.actions.${h.action.replace(/\./g, '_')}`, { defaultValue: h.action })}</Text>
                <Text style={adminStyles.cellMuted}>
                  {h.actor_name ?? t('admin.audit.server')} · {formatDate(h.at, i18n.language)}
                  {h.reason ? ` · ${h.reason}` : ''}
                </Text>
              </View>
            ))}
          </Panel>
        </>
      )}
      {doing && user ? (
        <FormDialog
          title={t(`admin.user360.confirm.${doing}`, { name: user.display_name || t('admin.users.noName') })}
          text={t(`admin.user360.confirmText.${doing}`)}
          fields={[
            ...(doing === 'plus' ? [{ name: 'days', label: t('admin.user360.days'), minLength: 1, initial: '30' }] : []),
            // No ready number here: the days to take back are whatever was given by mistake.
            ...(doing === 'minus' ? [{ name: 'days', label: t('admin.user360.takeDays'), minLength: 1 }] : []),
            { name: 'reason', label: t('admin.common.reason'), minLength: 5, multiline: true },
          ]}
          // The button says what it does. "Save" on a box that blocks someone tells nobody anything.
          confirmLabel={t(
            doing === 'block' ? 'admin.users.block' : doing === 'unblock' ? 'admin.users.unblock' : doing === 'end' ? 'admin.user360.endSessions' : doing === 'minus' ? 'admin.user360.takePlus' : 'admin.user360.givePlus',
          )}
          danger={doing === 'block'}
          onCancel={() => setDoing(null)}
          onConfirm={async ({ reason: why, days }) => {
            setDone(null);
            if ((doing === 'plus' || doing === 'minus') && !(Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 365)) {
              throw new ApiFailure(422, 'admin_days_bad', 'admin.user360.daysBad');
            }
            if (doing === 'minus') await api.post(`/admin/users/${user.id}/take-plus`, { reason: why, days: Number(days) });
            if (doing === 'block') await api.post(`/admin/users/${user.id}/block`, { reason: why });
            if (doing === 'unblock') await api.post(`/admin/users/${user.id}/unblock`, { reason: why });
            if (doing === 'end') await api.post(`/admin/users/${user.id}/end-sessions`, { reason: why });
            if (doing === 'plus') await api.post(`/admin/users/${user.id}/give-plus`, { reason: why, days: Number(days) });
            setDone(t(`admin.user360.done.${doing}`, { name: user.display_name || t('admin.users.noName') }));
            setDoing(null);
            await refreshAfter('users', 'staff');
            await reload();
          }}
        />
      ) : null}
    </AdminPage>
  );
}
