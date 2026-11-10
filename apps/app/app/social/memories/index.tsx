// P2 memories feed: everything from the caller's trees and friends groups.
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card, EmptyState, PrimaryButton, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { Gate, Note, Page, useName, useWhen } from '@/social/parts';
import type { Post } from '@/social/types';
import { colors, fonts } from '@/theme/tokens';

const PAGE = 20;

export default function Memories() {
  const { t } = useTranslation();
  const router = useRouter();
  const when = useWhen();
  const showName = useName();
  const feed = useInfiniteQuery({
    queryKey: ['posts'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<Post[]>(`/posts?limit=${PAGE}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].created_at : null),
  });

  return (
    <Page title={t('social.memories.title')} subtitle={t('social.memories.subtitle')}>
      <PrimaryButton label={t('social.memories.new')} onPress={() => router.push('/social/memories/new')} />
      <Gate query={feed as never}>
        {() => {
          const posts = feed.data?.pages.flat() ?? [];
          if (posts.length === 0) return <EmptyState message={t('social.memories.empty')} />;
          return (
            <>
              {posts.map((post) => (
                <Pressable
                  key={post.id}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/social/memories/[id]', params: { id: post.id } })}
                >
                  <Card style={styles.card}>
                    <Text style={styles.who}>{showName(post.author_name)}</Text>
                    <Note>{[post.scope_name, when(post.happened_on, true)].filter(Boolean).join(' · ')}</Note>
                    {post.media[0]?.url ? (
                      <Image source={{ uri: post.media[0].url }} style={styles.photo} accessibilityLabel={t('social.memories.photo')} />
                    ) : null}
                    {post.body ? <Text numberOfLines={4} style={styles.body}>{post.body}</Text> : null}
                    <View style={styles.counts}>
                      {post.reactions.map((r) => (
                        <Text key={r.emoji} style={styles.count}>{`${r.emoji} ${r.count}`}</Text>
                      ))}
                      <Text style={styles.count}>{t('social.memories.commentCount', { count: post.comment_count })}</Text>
                      {post.closed ? <Text style={styles.count}>{t('social.memories.closed')}</Text> : null}
                    </View>
                  </Card>
                </Pressable>
              ))}
              {feed.hasNextPage ? <TextButton label={t('social.more')} onPress={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage} /> : null}
            </>
          );
        }}
      </Gate>
    </Page>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  who: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  photo: { width: '100%', height: 220, borderRadius: 14 },
  body: { color: colors.text, fontFamily: fonts.medium, fontSize: 15, lineHeight: 22 },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  count: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13 },
});
