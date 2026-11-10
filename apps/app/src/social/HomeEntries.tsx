// Owned by the social area: links to chat, memories, invites and alerts on Home, with any running SOS on top.
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { api } from '@/lib/api';
import { Badge, useName } from '@/social/parts';
import type { HomeCounts } from '@/social/types';
import { colors, fonts, minTapSize } from '@/theme/tokens';

const REFRESH_MS = 60_000;

export function SocialHomeEntries() {
  const { t } = useTranslation();
  const router = useRouter();
  const showName = useName();
  // Links stay useful even if the counts cannot load, so a failure here shows nothing extra.
  const counts = useQuery({
    queryKey: ['social-home'],
    queryFn: () => api.rpc<HomeCounts>('social_home_counts'),
    refetchInterval: REFRESH_MS,
  });
  const data = counts.data;

  const entries = [
    { key: 'chat', to: '/social/chat', badge: data?.unread_chats },
    { key: 'memories', to: '/social/memories', badge: 0 },
    { key: 'invites', to: '/social/invites', badge: data?.open_invites },
    { key: 'alerts', to: '/social/alerts', badge: data?.unseen_alerts },
    { key: 'groups', to: '/social/groups', badge: 0 },
    { key: 'pop', to: '/social/pop/new', badge: 0 },
  ] as const;

  return (
    <View style={styles.wrap}>
      {(data?.incoming_sos ?? []).map((sos) => (
        <Pressable
          key={sos.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/social/sos/watch/[id]', params: { id: sos.id } })}
          style={styles.sos}
        >
          <Text style={styles.sosText}>{t('social.home.sosFrom', { name: showName(sos.name) })}</Text>
        </Pressable>
      ))}
      <View style={styles.grid}>
        {entries.map((entry) => (
          <Pressable key={entry.key} accessibilityRole="button" onPress={() => router.push(entry.to)} style={styles.tile}>
            <View style={styles.tileText}>
              <Text style={styles.title}>{t(`social.home.${entry.key}`)}</Text>
              <Text style={styles.hint}>{t(`social.home.${entry.key}Hint`)}</Text>
            </View>
            {entry.badge ? <Badge count={entry.badge} /> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  sos: { minHeight: minTapSize + 8, borderRadius: 18, backgroundColor: colors.alert, padding: 14, justifyContent: 'center' },
  sosText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: minTapSize + 20,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  tileText: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  hint: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12, marginTop: 2 },
});
