// P2 memories feed: everything from the caller's trees and friends groups.
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from '@/lib/router';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { CommentIcon } from '@/components/Icons';
import { Bouncy, Rise } from '@/components/Motion';
import { Text } from '@/components/Text';
import { Card, EmptyState, PrimaryButton, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { Gate, Page, useName, useWhen } from '@/social/parts';
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
              {posts.map((post, i) => (
                <Rise key={post.id} delay={Math.min(i, 6) * 50}>
                <Bouncy
                  accessibilityRole="button"
                  to={0.985}
                  onPress={() => router.push({ pathname: '/social/memories/[id]', params: { id: post.id } })}
                >
                  <Card style={styles.card}>
                    {/* Who shared it, with their face, the way a family album says whose page this is. */}
                    <View style={styles.head}>
                      <Avatar personId={post.author_id} size={42} name={showName(post.author_name)} />
                      <View style={styles.headText}>
                        <Text style={styles.who} numberOfLines={1}>{showName(post.author_name)}</Text>
                        <Text style={styles.where} numberOfLines={1}>{post.scope_name}</Text>
                      </View>
                      {post.happened_on ? (
                        <View style={styles.day}>
                          <Text style={styles.dayText}>{when(post.happened_on, true)}</Text>
                        </View>
                      ) : null}
                    </View>
                    {post.media[0]?.url ? (
                      <View>
                        <Image source={{ uri: post.media[0].url }} style={styles.photo} accessibilityLabel={t('social.memories.photo')} />
                        {post.media.length > 1 ? (
                          <View style={styles.more}>
                            <Text style={styles.moreText}>{t('social.memories.morePhotos', { count: post.media.length - 1 })}</Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                    {post.body ? <Text numberOfLines={4} style={styles.body}>{post.body}</Text> : null}
                    <View style={styles.counts}>
                      {post.reactions.map((r) => (
                        <View key={r.emoji} style={[styles.chip, styles.chipWarm]}>
                          <Text style={styles.count}>{`${r.emoji} ${r.count}`}</Text>
                        </View>
                      ))}
                      <View style={styles.chip}>
                        <CommentIcon color={colors.muted} size={14} width={2} />
                        <Text style={styles.count}>{t('social.memories.commentCount', { count: post.comment_count })}</Text>
                      </View>
                      {post.closed ? (
                        <View style={styles.chip}>
                          <Text style={styles.count}>{t('social.memories.closed')}</Text>
                        </View>
                      ) : null}
                    </View>
                  </Card>
                </Bouncy>
                </Rise>
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
  card: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headText: { flex: 1, minWidth: 0 },
  who: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  where: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  day: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.warmTint, borderWidth: 1, borderColor: colors.warmBorder },
  dayText: { color: colors.ask, fontFamily: fonts.bold, fontSize: 12 },
  photo: { width: '100%', height: 230, borderRadius: 16 },
  more: { position: 'absolute', right: 10, bottom: 10, backgroundColor: colors.scrim, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  moreText: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  body: { color: colors.text, fontFamily: fonts.medium, fontSize: 15, lineHeight: 22 },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.tint },
  chipWarm: { backgroundColor: colors.alertTint },
  count: { color: colors.text, fontFamily: fonts.semibold, fontSize: 13 },
});
