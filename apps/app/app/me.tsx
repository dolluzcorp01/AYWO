// F5 / S-17 Me: the person, their plan, their trees and the app's settings.
import { useQueries, useQuery } from '@tanstack/react-query';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { ChevronIcon } from '@/components/Icons';
import { LanguagePicker } from '@/components/LanguagePicker';
import { Screen } from '@/components/Screen';
import { TAB_BAR_SPACE, TabBar } from '@/components/TabBar';
import { Text } from '@/components/Text';
import { Card, Checkbox, ErrorText, Loading, LoadFailed, NeonPanel } from '@/components/ui';
import { languageLabel } from '@/i18n/languages';
import { HELP_PAGES } from '@/legal/LegalLinks';
import { api } from '@/lib/api';
import { DeleteBanner } from '@/components/DeleteBanner';
import { mainTree, useMe, useTrees, useUpdateMe } from '@/lib/account';
import { useFeature } from '@/ops/appConfig';
import type { MyExtras } from '@/ops/types';
import { useErrorText } from '@/lib/errors';
import { setLanguage, setLargeText, useLargeText } from '@/lib/prefs';
import { FAMILY_PLAN_MAX, usePlan } from '@/pay/usePlan';
import { SosButton } from '@/social/SosButton';
import { canShare } from '@/tree/roles';
import { treeMembersQuery, useNotificationPrefs } from '@/tree/useEdit';
import { useTreeView } from '@/tree/useTreeView';
import { colors, fonts, minTapSize } from '@/theme/tokens';

export default function MeScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const me = useMe();
  const trees = useTrees();
  const update = useUpdateMe();
  const plan = usePlan();
  const prefs = useNotificationPrefs();
  const large = useLargeText();
  const [picking, setPicking] = useState(false);
  const extras = useQuery({ queryKey: ['my-extras'], queryFn: () => api.rpc<MyExtras>('my_extras') });
  const ordersOn = useFeature('orders');
  const referralsOn = useFeature('referrals');
  const offersOn = useFeature('offers');

  const list = trees.data ?? [];
  const created = list.filter((tree) => tree.role === 'creator');
  const primary = mainTree(trees.data);
  // The person's own face comes from their card in their main tree.
  const main = useTreeView(primary?.id ?? '', primary ? 'mine' : 'see_as', i18n.language, null);
  // Export belongs to those who run a tree.
  const exportable = list.find((tree) => canShare(tree.role));
  const own = main.data?.nodes.find((n) => n.id === main.data?.viewer_person_id);
  const successors = useQueries({ queries: created.map((tree) => treeMembersQuery(tree.id)) });

  if (me.isError) {
    return (
      <Screen>
        <LoadFailed message={errorText(me.error)} onRetry={() => me.refetch()} />
        <TabBar active="me" />
      </Screen>
    );
  }
  if (!me.data) {
    return (
      <Screen>
        <Loading label={t('tree.loading')} />
      </Screen>
    );
  }

  function chooseLanguage(code: string) {
    setPicking(false);
    setLanguage(code);
    update.mutate({ language_code: code });
  }

  function toggleLarge(on: boolean) {
    setLargeText(on);
    update.mutate({ large_text: on });
  }

  const memberCount = plan.data?.members.length;
  const allOn = (prefs.data ?? []).every((p) => p.push || p.email || p.sms);
  const planOn = plan.data?.plus ?? me.data.plus;
  // One tree: who it is. Several: how many have someone. Nothing until the answers are in.
  const successorsKnown = successors.length > 0 && successors.every((q) => q.data);
  const successorValue = !successorsKnown
    ? undefined
    : successors.length === 1
      ? (successors[0].data?.successor?.display_name ?? t('me.noSuccessor'))
      : t('me.successorsSet', { count: successors.filter((q) => q.data?.successor).length, total: successors.length });

  return (
    <Screen flush>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.who}>
          <Avatar personId={own?.id ?? me.data.id} size={62} photoUrl={me.data.photo_url ?? own?.photoUrl} ring />
          <View style={styles.whoText}>
            <Text accessibilityRole="header" style={styles.name}>{me.data.display_name}</Text>
            {created.length > 0 ? <Text style={styles.sub}>{t('me.creatorOf', { count: created.length })}</Text> : null}
          </View>
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/profile', params: { edit: '1' } })} style={styles.edit}>
            <Text style={styles.editText}>{t('me.edit')}</Text>
          </Pressable>
        </View>

        <DeleteBanner />

        <Pressable accessibilityRole="button" onPress={() => router.push(planOn ? '/family-plan' : '/plus')}>
          <NeonPanel style={styles.plus}>
            <View style={styles.plusText}>
              <Text style={styles.plusEyebrow}>{t('me.plus')}</Text>
              <Text style={styles.plusTitle}>
                {planOn
                  ? memberCount !== undefined
                    ? t('me.familyPlan', { count: memberCount, size: FAMILY_PLAN_MAX })
                    : t('me.plusOn')
                  : t('me.plusOff')}
              </Text>
            </View>
            <ChevronIcon color={colors.white} />
          </NeonPanel>
        </Pressable>

        <SosButton />

        <Text accessibilityRole="header" style={styles.group}>{t('me.myTrees')}</Text>
        <Card style={styles.list}>
          {list.length === 0 ? (
            <Row title={t('home.anotherTree')} onPress={() => router.push('/start')} last />
          ) : (
            list.map((tree, i) => (
              <Row
                key={tree.id}
                title={tree.name}
                value={t('home.peopleCount', { count: tree.people })}
                onPress={() => router.push({ pathname: '/tree/[id]', params: { id: tree.id } })}
                last={i === list.length - 1}
              />
            ))
          )}
        </Card>

        {offersOn || ordersOn || referralsOn ? (
          <>
            <Text accessibilityRole="header" style={styles.group}>{t('ops.me.more')}</Text>
            <Card style={styles.list}>
              {offersOn ? <Row title={t('ops.me.offers')} onPress={() => router.push('/offers')} /> : null}
              {ordersOn ? <Row title={t('ops.me.shop')} onPress={() => router.push('/shop')} /> : null}
              {ordersOn ? <Row title={t('ops.me.orders')} onPress={() => router.push('/orders')} /> : null}
              {referralsOn ? <Row title={t('ops.me.invite')} value={t('ops.me.inviteValue')} onPress={() => router.push('/invite-friends')} last /> : null}
            </Card>
          </>
        ) : null}

        <Text accessibilityRole="header" style={styles.group}>{t('me.app')}</Text>
        <Card style={styles.list}>
          <Row title={t('settings.language')} value={languageLabel(i18n.language)} onPress={() => setPicking(true)} />
          <View style={styles.row}>
            <Checkbox label={t('settings.largeText')} on={large} onChange={toggleLarge} />
          </View>
          <Row
            title={t('settings.notifications')}
            value={prefs.data ? (allOn ? t('settings.allOn') : t('settings.someOff')) : undefined}
            onPress={() => router.push('/settings/notifications')}
            last
          />
        </Card>
        {update.isError ? <ErrorText>{errorText(update.error)}</ErrorText> : null}

        <Text accessibilityRole="header" style={styles.group}>{t('me.safeKeeping')}</Text>
        <Card style={styles.list}>
          {created.length > 0 ? <Row title={t('settings.successor')} value={successorValue} onPress={() => router.push('/settings/successor')} /> : null}
          {exportable ? (
            <Row title={t('me.download')} onPress={() => router.push({ pathname: '/export/[treeId]', params: { treeId: exportable.id } })} />
          ) : null}
          <Row
            title={t('ops.me.card')}
            value={extras.data ? (extras.data.has_emergency_card ? t('ops.me.cardSet') : t('ops.me.cardNotSet')) : undefined}
            onPress={() => router.push('/social/sos/card')}
          />
          <Row
            title={t('ops.me.blocked')}
            value={extras.data?.blocked ? String(extras.data.blocked) : undefined}
            onPress={() => router.push('/settings/blocked')}
          />
          <Row title={t('me.privacy')} onPress={() => router.push('/settings/privacy')} last />
        </Card>

        <Text accessibilityRole="header" style={styles.group}>{t('me.help')}</Text>
        <Card style={styles.list}>
          <Row
            title={t('ops.me.helpCentre')}
            value={extras.data?.open_tickets ? t('ops.me.answers', { count: extras.data.open_tickets }) : undefined}
            onPress={() => router.push('/help')}
          />
          {HELP_PAGES.map((page, i) => (
            <Row key={page.key} title={t(page.label)} onPress={() => router.push(page.href as Href)} last={i === HELP_PAGES.length - 1} />
          ))}
        </Card>
      </ScrollView>
      <TabBar active="me" />
      <LanguagePicker visible={picking} current={i18n.language} onPick={chooseLanguage} onClose={() => setPicking(false)} />
    </Screen>
  );
}

function Row({ title, value, onPress, last }: { title: string; value?: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.row, styles.rowInner, !last && styles.rowLine]}>
      <Text style={styles.rowTitle}>{title}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: TAB_BAR_SPACE, gap: 10 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  whoText: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 22, letterSpacing: -0.4 },
  sub: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13 },
  edit: { minHeight: minTapSize, minWidth: minTapSize, alignItems: 'center', justifyContent: 'center' },
  editText: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 14, textDecorationLine: 'underline' },
  plus: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  plusText: { flex: 1, minWidth: 0 },
  plusEyebrow: { color: colors.logoYellow, fontFamily: fonts.extrabold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  plusTitle: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 17 },
  group: { color: colors.muted, fontFamily: fonts.extrabold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 6 },
  list: { padding: 0, paddingHorizontal: 14 },
  row: { minHeight: 48, justifyContent: 'center' },
  rowInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: colors.tint },
  rowTitle: { flexShrink: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  rowValue: { flexShrink: 1, color: colors.muted, fontFamily: fonts.semibold, fontSize: 13 },
});
