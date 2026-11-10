// One account, everything staff may see about it: plan, trees, orders, tickets, reports, devices and staff history.
// Opening it needs a reason, which is recorded. Phone and email stay partly hidden; family details stay private.
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { useAdminAccess } from '@/admin/access';
import type { UserDetail } from '@/admin/types';
import { Actions, AdminPage, adminStyles, Facts, Field, formatDate, FormDialog, Message, money, Panel, Pill, SecondaryButton, useAction } from '@/admin/ui';
import { api } from '@/lib/api';

export default function AdminUser() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const access = useAdminAccess();
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const [user, setUser] = useState<UserDetail | null>(null);
  const [doing, setDoing] = useState<'block' | 'unblock' | 'end' | 'plus' | null>(null);
  const action = useAction();

  const open = () => action.run(async () => setUser(await api.post<UserDetail>(`/admin/users/${id}/view`, { reason: reason.trim() })));
  const reload = () => action.run(async () => setUser(await api.post<UserDetail>(`/admin/users/${id}/view`, { reason: reason.trim() })));
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
            <SecondaryButton label={t('admin.user360.open')} disabled={reason.trim().length < 5 || action.busy} onPress={open} />
          </Actions>
        </Panel>
      ) : (
        <>
          <Actions>
            {user.blocked_at ? <Pill label={t('admin.users.blocked')} alert /> : null}
            {user.deleted ? <Pill label={t('admin.users.deleted')} alert /> : null}
            {user.plus ? <Pill label="Plus" /> : null}
            {user.staff_role ? <Pill label={t(`admin.roles.${user.staff_role}`)} /> : null}
            {user.is_minor ? <Pill label={t('admin.user360.minor')} alert /> : null}
          </Actions>
          <Panel
            title={t('admin.user360.account')}
            actions={
              <Actions>
                {access.can(['users']) ? (
                  user.blocked_at ? (
                    <SecondaryButton label={t('admin.users.unblock')} onPress={() => setDoing('unblock')} />
                  ) : (
                    <SecondaryButton label={t('admin.users.block')} danger onPress={() => setDoing('block')} />
                  )
                ) : null}
                {access.can(['users']) ? <SecondaryButton label={t('admin.user360.endSessions')} onPress={() => setDoing('end')} /> : null}
                {access.can(['payments', 'support']) ? <SecondaryButton label={t('admin.user360.givePlus')} onPress={() => setDoing('plus')} /> : null}
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
              <Text key={tree.id} style={adminStyles.cellStrong}>
                {tree.name} · {tree.creator ? t('admin.user360.creator') : t('admin.user360.sharedWith')} · {t('admin.user360.peopleCount', { count: tree.people })}
              </Text>
            ))}
          </Panel>
          <Panel title={t('admin.user360.orders')}>
            {user.orders.length === 0 ? <Text style={adminStyles.cellMuted}>{t('admin.user360.none')}</Text> : null}
            {user.orders.map((o) => (
              <Text key={o.id} style={adminStyles.cellStrong}>
                {t(`admin.orders.products.${o.product}`)} · {money(o.amount_minor, o.currency, i18n.language)} · {t(`admin.payments.orderStatus.${o.status}`)}
                {o.fulfilment !== 'none' ? ` · ${t(`admin.orders.steps.${o.fulfilment}`)}` : ''} · {formatDate(o.created_at, i18n.language)}
              </Text>
            ))}
          </Panel>
          <Panel title={t('admin.user360.tickets')}>
            {user.tickets.length === 0 ? <Text style={adminStyles.cellMuted}>{t('admin.user360.none')}</Text> : null}
            {user.tickets.map((tk) => (
              <Text key={tk.id} style={adminStyles.cellStrong}>
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
            { name: 'reason', label: t('admin.common.reason'), minLength: 5, multiline: true },
          ]}
          confirmLabel={t('admin.common.save')}
          danger={doing === 'block'}
          onCancel={() => setDoing(null)}
          onConfirm={async ({ reason: why, days }) => {
            if (doing === 'block') await api.post(`/admin/users/${user.id}/block`, { reason: why });
            if (doing === 'unblock') await api.post(`/admin/users/${user.id}/unblock`, { reason: why });
            if (doing === 'end') await api.post(`/admin/users/${user.id}/end-sessions`, { reason: why });
            if (doing === 'plus') await api.post(`/admin/users/${user.id}/give-plus`, { reason: why, days: Number(days) });
            await client.invalidateQueries({ queryKey: ['admin', 'users'] });
            setDoing(null);
            await reload();
          }}
        />
      ) : null}
    </AdminPage>
  );
}
