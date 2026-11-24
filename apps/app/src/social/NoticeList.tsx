// The Notifications tab on Activity: every piece of news for this person, newest first, each one opening what it is
// about. One line per event, so a host with twenty answers to an invitation sees twenty lines and who said what.
import type { Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { BellIcon } from '@/components/Icons';
import { Text } from '@/components/Text';
import { EmptyState, Loading, LoadFailed, TextButton } from '@/components/ui';
import { useErrorText } from '@/lib/errors';
import { useMarkRead, useNotices } from '@/lib/notices';
import type { Notice } from '@/lib/notices';
import { useRouter } from '@/lib/router';
import { useTimeAgo } from '@/lib/time';
import { colors, fonts, radius } from '@/theme/tokens';

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
  const unread = notices.data.filter((n) => !n.read_at).length;
  return (
    <FlatList
      data={notices.data}
      keyExtractor={(item) => item.id}
      contentContainerStyle={listStyle}
      refreshing={notices.isRefetching}
      onRefresh={() => notices.refetch()}
      ListHeaderComponent={
        unread > 0 ? (
          <View style={styles.head}>
            <Text style={styles.count}>{t('activity.unread', { count: unread })}</Text>
            <TextButton label={t('activity.markAllRead')} onPress={() => markRead.mutate(undefined)} disabled={markRead.isPending} />
          </View>
        ) : undefined
      }
      ListEmptyComponent={<EmptyState message={t('activity.emptyNews')} />}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${item.read_at ? '' : `${t('activity.new')}. `}${item.title}. ${item.body}`}
          onPress={() => open(item)}
          style={[styles.row, !item.read_at && styles.rowNew]}
        >
          <View style={[styles.mark, !item.read_at && styles.markNew]}>
            <BellIcon color={item.read_at ? colors.muted : colors.white} size={18} width={1.8} />
          </View>
          <View style={styles.words}>
            <Text style={[styles.title, !item.read_at && styles.titleNew]}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
            <Text style={styles.when}>{timeAgo(item.created_at)}</Text>
          </View>
          {item.read_at ? null : <View style={styles.dot} />}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  count: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: radius.card, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card },
  rowNew: { borderColor: colors.logoPurple },
  mark: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint },
  markNew: { backgroundColor: colors.logoIndigo },
  words: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  titleNew: { fontFamily: fonts.extrabold },
  body: { color: colors.text, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  when: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6, backgroundColor: colors.alert },
});
