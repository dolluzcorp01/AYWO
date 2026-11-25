// The Notifications tab on Activity: every piece of news for this person, newest first, each one opening what it is
// about. One line per event, so a host with twenty answers to an invitation sees twenty lines and who said what.
import type { Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { BellIcon, BoxIcon, CalendarIcon, ChatIcon, FriendsIcon, GiftIcon, LinkedPeopleIcon, PartyIcon, PhotoIcon, WordIcon } from '@/components/Icons';
import { Bouncy, Rise } from '@/components/Motion';
import { Text } from '@/components/Text';
import { EmptyState, Loading, LoadFailed, TextButton } from '@/components/ui';
import { useErrorText } from '@/lib/errors';
import { COUNTED_ELSEWHERE, useMarkRead, useNotices } from '@/lib/notices';
import type { Notice } from '@/lib/notices';
import { useRouter } from '@/lib/router';
import { useTimeAgo } from '@/lib/time';
import { colors, fonts, radius, shadows } from '@/theme/tokens';

type Tone = 'indigo' | 'purple' | 'warm' | 'red';
const TONES: Record<Tone, { back: string; ink: string }> = {
  indigo: { back: colors.tint, ink: colors.logoIndigo },
  purple: { back: colors.tint, ink: colors.logoPurple },
  warm: { back: colors.celebrationTint, ink: colors.ask },
  red: { back: colors.alertTint, ink: colors.alert },
};

/**
 * The picture and colour for one kind of news. Every line used to carry the same bell, so a birthday, a chat and an
 * emergency looked alike until read. Red is kept for alerts and SOS only.
 */
export function noticeLook(kind: string): { Icon: typeof BellIcon; tone: Tone } {
  if (kind === 'alert' || kind.startsWith('sos')) return { Icon: BellIcon, tone: 'red' };
  if (kind === 'birthdays_today' || kind === 'remembrance_today' || kind === 'memory_reminder') return { Icon: CalendarIcon, tone: 'warm' };
  if (kind.startsWith('invite') || kind === 'rsvp' || kind === 'poll_vote') return { Icon: PartyIcon, tone: 'warm' };
  if (kind.startsWith('chat_')) return { Icon: ChatIcon, tone: 'purple' };
  if (kind.startsWith('memory_')) return { Icon: PhotoIcon, tone: 'purple' };
  if (kind === 'kin_term_reviewed' || kind === 'term_report_decided') return { Icon: WordIcon, tone: 'purple' };
  if (kind.startsWith('order_')) return { Icon: BoxIcon, tone: 'warm' };
  if (kind === 'plus_gift' || kind === 'referral_reward' || kind === 'promo' || kind === 'trial_ending' || kind.startsWith('plan_')) return { Icon: GiftIcon, tone: 'warm' };
  if (kind.startsWith('share_') || kind === 'successor_named' || kind === 'group_added') return { Icon: FriendsIcon, tone: 'indigo' };
  if (kind.startsWith('request_') || kind.startsWith('tree_') || kind === 'merge_candidate' || kind === 'claim_made') return { Icon: LinkedPeopleIcon, tone: 'indigo' };
  return { Icon: BellIcon, tone: 'indigo' };
}

export function NoticeList({ listStyle, onStayHere }: { listStyle: StyleProp<ViewStyle>; onStayHere: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const router = useRouter();
  const timeAgo = useTimeAgo();
  const notices = useNotices();
  const markRead = useMarkRead();

  function open(notice: Notice) {
    if (!notice.read_at) markRead.mutate(notice.id);
    // A request to answer lives on this same page, under "Needs you".
    if (notice.path.split('?')[0] === '/activity') onStayHere();
    else router.push(notice.path as Href);
  }

  if (notices.isError) return <LoadFailed message={errorText(notices.error)} onRetry={() => notices.refetch()} />;
  if (!notices.data) return <Loading label={t('tree.loading')} />;
  const anyUnread = notices.data.some((n) => !n.read_at);
  // A request to answer is counted under "Needs you", so it is left out of this number, as on the tab and the bell.
  const unread = notices.data.filter((n) => !n.read_at && !COUNTED_ELSEWHERE.includes(n.kind)).length;
  return (
    <FlatList
      data={notices.data}
      keyExtractor={(item) => item.id}
      contentContainerStyle={listStyle}
      refreshing={notices.isRefetching}
      onRefresh={() => notices.refetch()}
      ListHeaderComponent={
        anyUnread ? (
          <View style={styles.head}>
            <Text style={styles.count}>{unread > 0 ? t('activity.unread', { count: unread }) : ''}</Text>
            <TextButton label={t('activity.markAllRead')} onPress={() => markRead.mutate(undefined)} disabled={markRead.isPending} />
          </View>
        ) : undefined
      }
      ListEmptyComponent={<EmptyState message={t('activity.emptyNews')} />}
      renderItem={({ item, index }) => {
        const look = noticeLook(item.kind);
        const tone = TONES[look.tone];
        return (
          // The first few lines come in one after another; further down they are simply there.
          <Rise delay={Math.min(index, 6) * 45}>
            <Bouncy
              accessibilityRole="button"
              accessibilityLabel={`${item.read_at ? '' : `${t('activity.new')}. `}${item.title}. ${item.body}`}
              onPress={() => open(item)}
              to={0.98}
              style={[styles.row, !item.read_at && styles.rowNew]}
            >
              <View style={[styles.mark, { backgroundColor: tone.back }, !!item.read_at && styles.markRead]}>
                <look.Icon color={tone.ink} size={20} width={1.8} />
              </View>
              <View style={styles.words}>
                <Text style={[styles.title, !item.read_at && styles.titleNew]}>{item.title}</Text>
                <Text style={styles.body}>{item.body}</Text>
                <Text style={styles.when}>{timeAgo(item.created_at)}</Text>
              </View>
              {item.read_at ? null : <View style={styles.dot} />}
            </Bouncy>
          </Rise>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  count: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: radius.card, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card },
  rowNew: { borderColor: colors.logoPurple, ...shadows.card },
  mark: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  // Already read: the picture stays, quieter.
  markRead: { opacity: 0.6 },
  words: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  titleNew: { fontFamily: fonts.extrabold },
  body: { color: colors.text, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  when: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6, backgroundColor: colors.alert },
});
