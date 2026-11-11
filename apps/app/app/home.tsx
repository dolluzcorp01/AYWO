// S-05 Home (Warm Daylight): a greeting, the SOS bar, the family card with a small drawn tree, the one thing that needs
// you, family dates, quick ways into family life, offers, and memories. Activity lives behind the bell.
import { closeFamily, focusView, graphFromApi } from '@aywo/layout';
import { useQuery } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { BellIcon, ChatIcon, ChevronIcon, FriendsIcon, InviteIcon, PartyIcon, PhotoIcon, RingsIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { TAB_BAR_SPACE, TabBar } from '@/components/TabBar';
import { useDesktop } from '@/components/WebFrame';
import { Text } from '@/components/Text';
import { Card, Loading, LoadFailed, SmallButton, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { firstName, mainTree, useMe, useTrees } from '@/lib/account';
import type { TreeRow } from '@/lib/account';
import { useErrorText } from '@/lib/errors';
import { AnnouncementBar, HomeOfferCards } from '@/ops/Announcements';
import { useFeature } from '@/ops/appConfig';
import { FamilyDates, OnThisDayCard } from '@/ops/HomeExtras';
import { SosBar } from '@/ops/SosBar';
import { useTimeAgo } from '@/lib/time';
import { useName } from '@/social/parts';
import type { HomeCounts, Post } from '@/social/types';
import { activityRoute, useActivityText } from '@/tree/activityText';
import { canShare } from '@/tree/roles';
import { generationCount } from '@/tree/stats';
import { useActivity } from '@/tree/useEdit';
import type { RequestItem } from '@/tree/useEdit';
import { useTreeView } from '@/tree/useTreeView';
import type { TreeNode } from '@/tree/useTreeView';
import { colors, fonts, minTapSize, radius, shadows } from '@/theme/tokens';

function useCounts() {
  return useQuery({ queryKey: ['social-home'], queryFn: () => api.rpc<HomeCounts>('social_home_counts'), refetchInterval: 60_000 });
}

export default function Home() {
  const { t } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const me = useMe();
  const trees = useTrees();
  // Hooks stay above the early returns, so every render calls the same ones.
  const desktop = useDesktop();

  if (trees.isError) {
    return (
      <Screen>
        <LoadFailed message={errorText(trees.error)} onRetry={() => trees.refetch()} />
        <TabBar active="home" />
      </Screen>
    );
  }
  if (!trees.data) {
    return (
      <Screen>
        <Loading label={t('tree.loading')} />
      </Screen>
    );
  }
  // No tree yet: A5 is this person's Home.
  if (trees.data.length === 0) return <Redirect href="/start" />;

  const main = mainTree(trees.data) as TreeRow;
  const others = trees.data.filter((tree) => tree.id !== main.id);
  const name = firstName(me.data?.display_name);

  // On a computer: the family on the left, what needs you and the ways in on the right.
  if (desktop) {
    return (
      <Screen flush>
        <ScrollView contentContainerStyle={[styles.scroll, styles.desktopScroll]}>
          <Top treeId={main.id} name={name} />
          <AnnouncementBar />
          <IncomingSos />
          <View style={styles.columns}>
            <View style={styles.leftColumn}>
              <FamilyCard tree={main} />
              <FamilyDates />
              <LatestMemory />
              <OnThisDayCard />
            </View>
            <View style={styles.rightColumn}>
              <SosEntry />
              <NeedsYou />
              <InviteRow tree={main} />
              <QuickActions />
              <HomeOfferCards />
              <TextButton label={t('home.anotherTree')} onPress={() => router.push('/start')} />
            </View>
          </View>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen flush>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Top treeId={main.id} name={name} />
        <AnnouncementBar />
        <IncomingSos />
        <SosEntry />
        <FamilyCard tree={main} />
        <NeedsYou />
        <FamilyDates />
        <InviteRow tree={main} />
        <QuickActions />
        <HomeOfferCards />
        <OnThisDayCard />
        <LatestMemory />
        {others.length > 0 ? (
          <>
            <Text accessibilityRole="header" style={styles.section}>{t('home.otherTrees')}</Text>
            <Card style={styles.list}>
              {others.map((tree, i) => (
                <Pressable
                  key={tree.id}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/tree/[id]', params: { id: tree.id } })}
                  style={[styles.row, i === others.length - 1 && styles.rowLast]}
                >
                  <Text style={styles.rowTitle}>{tree.name}</Text>
                  <Text style={styles.rowMeta}>{t('home.peopleCount', { count: tree.people })}</Text>
                </Pressable>
              ))}
            </Card>
          </>
        ) : null}
        <TextButton label={t('home.anotherTree')} onPress={() => router.push('/start')} />
      </ScrollView>
      <TabBar active="home" treeId={main.id} />
    </Screen>
  );
}

function greetingKey(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'home.morning' : hour < 17 ? 'home.afternoon' : 'home.evening';
}

/** The SOS bar, unless staff switched SOS off for maintenance. */
function SosEntry() {
  return useFeature('sos') ? <SosBar /> : null;
}

/** Greeting, the bell for activity, and the person's own face. SOS has its own full-width bar below. */
function Top({ treeId, name }: { treeId: string; name: string | null }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const me = useMe();
  const tree = useTreeView(treeId, 'mine', i18n.language, null);
  const needs = useActivity('needs_you');
  const own = tree.data?.nodes.find((n) => n.id === tree.data?.viewer_person_id);
  // The side menu already has Activity on a computer.
  const desktop = useDesktop();
  const waiting = needs.data?.filter((item) => item.needs_you).length ?? 0;
  return (
    <View style={styles.top}>
      <View style={styles.topText}>
        <Text style={styles.eyebrow}>{t(greetingKey())}</Text>
        <Text accessibilityRole="header" style={styles.hey} numberOfLines={1}>{name ? t('home.hi', { name }) : t('home.welcome')}</Text>
      </View>
      {desktop ? null : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={waiting ? `${t('tabs.activity')}, ${waiting}` : t('tabs.activity')}
            onPress={() => router.push('/activity')}
            style={styles.iconButton}
          >
            <BellIcon color={colors.text} size={20} width={1.8} />
            {waiting ? <View style={styles.dot} /> : null}
          </Pressable>
        </>
      )}
      <Pressable accessibilityRole="button" accessibilityLabel={t('tabs.me')} onPress={() => router.replace('/me')}>
        <Avatar personId={own?.id ?? me.data?.id ?? 'me'} size={40} photoUrl={own?.photoUrl} name={own?.name ?? me.data?.display_name ?? undefined} />
      </Pressable>
    </View>
  );
}

function IncomingSos() {
  const { t } = useTranslation();
  const router = useRouter();
  const showName = useName();
  const counts = useCounts();
  return (
    <>
      {(counts.data?.incoming_sos ?? []).map((sos) => (
        <Pressable
          key={sos.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/social/sos/watch/[id]', params: { id: sos.id } })}
          style={styles.incoming}
        >
          <Text style={styles.incomingText}>{t('social.home.sosFrom', { name: showName(sos.name) })}</Text>
        </Pressable>
      ))}
    </>
  );
}

/** The family at a glance: parents above, you and your partner, children below, drawn small. */
function MiniTree({ nodes, viewerId, focus }: { nodes: TreeNode[]; viewerId: string; focus: ReturnType<typeof focusView> }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const face = (id: string, size: number, ring = false) => {
    const n = byId.get(id);
    if (!n) return null;
    return <Avatar key={id} personId={id} size={size} photoUrl={n.photoUrl} nameUnknown={n.nameUnknown} name={n.name} ring={ring} />;
  };
  const parents = focus.parents.slice(0, 2);
  const middle = [viewerId, ...focus.partners.slice(0, 1)];
  const children = focus.children.slice(0, 4);
  return (
    <View style={styles.mini} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {parents.length ? <View style={styles.miniRow}>{parents.map((id) => face(id, 40))}</View> : null}
      {parents.length ? <View style={styles.miniLine} /> : null}
      <View style={styles.miniRow}>{middle.map((id, i) => face(id, i === 0 ? 54 : 40, i === 0))}</View>
      {children.length ? <View style={styles.miniLine} /> : null}
      {children.length ? <View style={styles.miniRow}>{children.map((id) => face(id, 40))}</View> : null}
    </View>
  );
}

function FamilyCard({ tree }: { tree: TreeRow }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const view = useTreeView(tree.id, 'mine', i18n.language, null);
  const data = view.data;
  const viewerId = data?.viewer_person_id && data.nodes.some((n) => n.id === data.viewer_person_id) ? data.viewer_person_id : null;
  const generations = data ? generationCount(data.nodes, data.links) : null;
  const open = () => router.push({ pathname: '/tree/[id]', params: { id: tree.id } });
  return (
    <Pressable accessibilityRole="button" onPress={open} style={styles.familyCard}>
      <View style={styles.familyHead}>
        <View style={styles.topText}>
          <Text style={styles.eyebrow}>{t('home.yourFamily')}</Text>
          <Text style={styles.treeName} numberOfLines={2}>{tree.name}</Text>
        </View>
      </View>
      {/* Under the name, not beside it, so a long family name gets the full width. */}
      <View style={styles.pill}>
        <Text style={styles.pillText}>
          {t('home.peopleCount', { count: tree.people })}
          {generations ? ` · ${t('home.generationCount', { count: generations })}` : ''}
        </Text>
      </View>
      {data && viewerId ? <MiniTree nodes={data.nodes} viewerId={viewerId} focus={focusView(graphFromApi(data), viewerId)} /> : <View style={styles.miniSpace} />}
      <View style={styles.openButton}>
        <Text style={styles.openText}>{t('home.openTree')}</Text>
      </View>
    </Pressable>
  );
}

function NeedsYou() {
  const { t } = useTranslation();
  const router = useRouter();
  const needs = useActivity('needs_you');
  const textFor = useActivityText();
  const timeAgo = useTimeAgo();
  const items = (needs.data ?? []).filter((item): item is RequestItem => item.type === 'request' && !!item.needs_you);
  if (items.length === 0) return null;
  const first = items[0];
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(activityRoute(first))} style={styles.need}>
      <View style={[styles.needIcon, first.kind === 'merge' && styles.needIconWarm]}>
        {first.kind === 'merge' ? <RingsIcon color={colors.logoOrange} size={20} /> : <BellIcon color={colors.relation} size={20} width={1.8} />}
      </View>
      <View style={styles.topText}>
        <Text style={styles.needTitle}>{textFor(first)}</Text>
        <Text style={styles.rowMeta}>
          {items.length > 1 ? t('home.andMore', { when: timeAgo(first.at), count: items.length - 1 }) : timeAgo(first.at)}
        </Text>
      </View>
      <ChevronIcon color={colors.muted} size={18} />
    </Pressable>
  );
}

/** 'Invite these two': close family with no account yet. */
function InviteRow({ tree }: { tree: TreeRow }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const view = useTreeView(tree.id, 'mine', i18n.language, null);
  const data = view.data;
  const viewerId = data?.viewer_person_id;
  if (!data || !viewerId || !canShare(data.role)) return null;
  const family = closeFamily(focusView(graphFromApi(data), viewerId));
  const notJoined = family
    .map((id) => data.nodes.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => !!n && !n.joined && !n.nameUnknown && n.living !== 'deceased')
    .slice(0, 2);
  if (notJoined.length === 0) return null;
  const names = notJoined.map((n) => firstName(n.name));
  return (
    <Card style={styles.inviteRow}>
      <View style={styles.faces}>
        {notJoined.map((n, i) => (
          <View key={n.id} style={i > 0 ? styles.faceOverlap : undefined}>
            <Avatar personId={n.id} size={34} photoUrl={n.photoUrl} name={n.name} />
          </View>
        ))}
      </View>
      <Text style={styles.inviteText}>
        {names.length === 2 ? t('home.inviteTwo', { a: names[0], b: names[1] }) : t('home.inviteOne', { name: names[0] })}
      </Text>
      <SmallButton
        label={t('card.invite')}
        onPress={() => router.push({ pathname: '/share/[treeId]', params: { treeId: tree.id, personId: notJoined[0].id } })}
      />
    </Card>
  );
}

function Quick({ label, badge, onPress, icon }: { label: string; badge?: number; onPress: () => void; icon: ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={badge ? `${label}, ${badge}` : label} onPress={onPress} style={styles.quick}>
      <View style={styles.quickIcon}>
        {icon}
        {badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.quickText} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function QuickActions() {
  const { t } = useTranslation();
  const router = useRouter();
  const counts = useCounts().data;
  const ink = colors.relation;
  // Staff can switch a feature off for everyone (admin App settings); its way in disappears.
  const on = { chat: useFeature('chat'), memories: useFeature('memories'), invites: useFeature('invites'), alerts: useFeature('alerts'), pop: useFeature('pop_party') };
  return (
    <View style={styles.quickRow}>
      {on.chat ? <Quick label={t('social.home.chat')} badge={counts?.unread_chats} onPress={() => router.push('/social/chat')} icon={<ChatIcon color={ink} size={22} width={1.8} />} /> : null}
      {on.memories ? <Quick label={t('social.home.memories')} onPress={() => router.push('/social/memories')} icon={<PhotoIcon color={ink} size={22} width={1.8} />} /> : null}
      {on.invites ? <Quick label={t('social.home.invites')} badge={counts?.open_invites} onPress={() => router.push('/social/invites')} icon={<InviteIcon color={ink} size={22} width={1.8} />} /> : null}
      {on.alerts ? <Quick label={t('social.home.alerts')} badge={counts?.unseen_alerts} onPress={() => router.push('/social/alerts')} icon={<BellIcon color={ink} size={22} width={1.8} />} /> : null}
      <Quick label={t('social.home.groups')} onPress={() => router.push('/social/groups')} icon={<FriendsIcon color={ink} size={22} width={1.8} />} />
      {on.pop ? <Quick label={t('social.home.pop')} onPress={() => router.push('/social/pop/new')} icon={<PartyIcon color={ink} size={22} width={1.8} />} /> : null}
    </View>
  );
}

function LatestMemory() {
  const { t } = useTranslation();
  const router = useRouter();
  const posts = useQuery({ queryKey: ['posts', 'home'], queryFn: () => api.get<Post[]>('/posts?limit=1') });
  const post = posts.data?.[0];
  if (!post) return null;
  const photo = post.media.find((m) => m.url)?.url;
  const tagged = post.tags.map((tag) => firstName(tag.name)).filter(Boolean).slice(0, 2);
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/social/memories/[id]', params: { id: post.id } })} style={styles.memory}>
      {photo ? <Image source={{ uri: photo }} style={styles.memoryImage} /> : <View style={[styles.memoryImage, styles.memoryBlank]}><PhotoIcon color={colors.relation} size={22} /></View>}
      <View style={styles.topText}>
        <Text style={styles.eyebrow}>{t('home.latestMemory')}</Text>
        <Text style={styles.memoryTitle} numberOfLines={1}>{post.body ?? t('social.home.memories')}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {tagged.length ? t('home.memoryBy', { name: firstName(post.author_name), with: tagged.join(', ') }) : firstName(post.author_name)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: TAB_BAR_SPACE, gap: 16 },
  desktopScroll: { paddingHorizontal: 40, paddingTop: 32, paddingBottom: 48, gap: 24 },
  columns: { flexDirection: 'row', gap: 24, alignItems: 'flex-start' },
  leftColumn: { flex: 3, minWidth: 0, gap: 16 },
  rightColumn: { flex: 2, minWidth: 0, gap: 16 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  topText: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.muted, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
  hey: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 30, letterSpacing: -1, lineHeight: 36 },
  iconButton: {
    width: minTapSize,
    height: minTapSize,
    borderRadius: minTapSize / 2,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { position: 'absolute', top: 9, right: 11, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.alert, borderWidth: 1.5, borderColor: colors.card },
  incoming: { minHeight: minTapSize + 8, borderRadius: radius.card, backgroundColor: colors.alert, padding: 16, justifyContent: 'center' },
  incomingText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 16 },
  familyCard: {
    borderRadius: radius.hero,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 20,
    gap: 6,
    ...shadows.raised,
  },
  familyHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  treeName: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 24, letterSpacing: -0.6, marginTop: 2 },
  pill: { alignSelf: 'flex-start', marginTop: 8, borderRadius: 999, backgroundColor: colors.tint, paddingHorizontal: 10, paddingVertical: 6 },
  pillText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 12 },
  mini: { alignItems: 'center', paddingVertical: 12 },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  miniLine: { width: 2, height: 12, backgroundColor: colors.line, borderRadius: 1 },
  miniSpace: { height: 40 },
  openButton: { alignSelf: 'flex-start', minHeight: 46, paddingHorizontal: 22, borderRadius: radius.button, backgroundColor: colors.logoIndigo, justifyContent: 'center' },
  openText: { color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
  need: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.card,
  },
  needIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  needIconWarm: { backgroundColor: '#FFF1E6' },
  needTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  section: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18, letterSpacing: -0.3 },
  list: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.tint },
  rowLast: { borderBottomWidth: 0 },
  rowTitle: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  rowMeta: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12, marginTop: 2 },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  faces: { flexDirection: 'row' },
  faceOverlap: { marginStart: -10 },
  inviteText: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  quick: { width: '33.33%', alignItems: 'center', gap: 7 },
  quickIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  quickText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 12 },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.alert,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 11 },
  memory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 12,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.card,
  },
  memoryImage: { width: 72, height: 60, borderRadius: 14 },
  memoryBlank: { backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  memoryTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 15, marginTop: 2 },
});
