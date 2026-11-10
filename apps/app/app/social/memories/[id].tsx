// One memory: photos, who is in it, reactions, comments, and closing the thread. Anyone can report it or a comment.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card, ConfirmDialog, Field, SecondaryButton, SectionTitle, SmallButton, TextButton } from '@/components/ui';
import { api, uploadFile } from '@/lib/api';
import { useTimeAgo } from '@/lib/time';
import { ReportDialog } from '@/ops/Report';
import type { ReportTarget } from '@/ops/Report';
import { pickPhotos } from '@/social/media';
import { ActionError, Gate, Note, Page, useName, useWhen } from '@/social/parts';
import type { Post } from '@/social/types';
import { colors, fonts, minTapSize } from '@/theme/tokens';

const EMOJIS = ['❤️', '🙏', '😂', '😢', '👏'];

export default function MemoryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const when = useWhen();
  const ago = useTimeAgo();
  const showName = useName();
  const [comment, setComment] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reporting, setReporting] = useState<{ type: ReportTarget; id: string; ownerId: string; ownerName: string } | null>(null);

  const key = ['post', id];
  const post = useQuery({ queryKey: key, queryFn: () => api.get<Post>(`/posts/${id}`) });
  const refresh = () => {
    client.invalidateQueries({ queryKey: key });
    client.invalidateQueries({ queryKey: ['posts'] });
  };

  const react = useMutation({
    mutationFn: (input: { type: 'post' | 'comment'; target: string; emoji: string | null }) =>
      api.rpc('react', { p_target_type: input.type, p_target_id: input.target, p_emoji: input.emoji }),
    onSuccess: refresh,
  });
  const addComment = useMutation({
    mutationFn: () => api.rpc('post_comment', { p_post: id, p_body: comment.trim() }),
    onSuccess: () => {
      setComment('');
      refresh();
    },
  });
  const removeComment = useMutation({ mutationFn: (commentId: string) => api.rpc('comment_delete', { p_comment: commentId }), onSuccess: refresh });
  const setClosed = useMutation({ mutationFn: (closed: boolean) => api.rpc('post_set_closed', { p_post: id, p_closed: closed }), onSuccess: refresh });
  const addPhotos = useMutation({
    mutationFn: async () => {
      const photos = await pickPhotos(10);
      if (photos.length === 0) return;
      const paths = await Promise.all(photos.map((photo) => uploadFile('posts', photo)));
      await api.rpc('post_add_media', { p_post: id, p_media: paths });
    },
    onSuccess: refresh,
  });
  const removePost = useMutation({
    mutationFn: () => api.rpc('post_delete', { p_post: id }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['posts'] });
      router.back();
    },
  });

  return (
    <Page title={t('social.memories.one')}>
      <Gate query={post}>
        {(data) => (
          <>
            <Card style={styles.card}>
              <Text style={styles.who}>{showName(data.author_name)}</Text>
              <Note>{[data.scope_name, when(data.happened_on, true)].filter(Boolean).join(' · ')}</Note>
              {data.media.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                  {data.media.map((m) =>
                    m.url ? <Image key={m.id} source={{ uri: m.url }} style={styles.photo} accessibilityLabel={t('social.memories.photo')} /> : null,
                  )}
                </ScrollView>
              ) : null}
              {data.body ? <Text style={styles.body}>{data.body}</Text> : null}
              {data.tags.length > 0 ? <Note>{t('social.memories.with', { names: data.tags.map((x) => x.name).join(', ') })}</Note> : null}
              {data.collaborators.length > 0 ? (
                <Note>{t('social.memories.addedWith', { names: data.collaborators.map((x) => showName(x.name)).join(', ') })}</Note>
              ) : null}
            </Card>

            {/* Everyone can see the counts. Adding a reaction needs Plus, which the server decides. */}
            <View style={styles.emojis}>
              {EMOJIS.map((emoji) => {
                const count = data.reactions.find((r) => r.emoji === emoji)?.count ?? 0;
                const mine = data.my_reaction === emoji;
                return (
                  <Pressable
                    key={emoji}
                    accessibilityRole="button"
                    accessibilityLabel={t('social.memories.reactWith', { emoji })}
                    accessibilityState={{ selected: mine }}
                    disabled={data.closed || react.isPending}
                    onPress={() => react.mutate({ type: 'post', target: data.id, emoji: mine ? null : emoji })}
                    style={[styles.emoji, mine && styles.emojiOn]}
                  >
                    <Text style={styles.emojiText}>{count > 0 ? `${emoji} ${count}` : emoji}</Text>
                  </Pressable>
                );
              })}
            </View>
            <ActionError error={react.error} />

            <SectionTitle>{t('social.memories.comments')}</SectionTitle>
            {(data.comments ?? []).length === 0 ? <Note>{t('social.memories.noComments')}</Note> : null}
            {(data.comments ?? []).map((c) => (
              <Card key={c.id} style={styles.comment}>
                <Text style={styles.who}>{showName(c.author_name)}</Text>
                <Text style={styles.body}>{c.body}</Text>
                <View style={styles.commentFoot}>
                  <Note>{ago(c.created_at)}</Note>
                  {c.reactions.map((r) => (
                    <Note key={r.emoji}>{`${r.emoji} ${r.count}`}</Note>
                  ))}
                  {!data.closed ? (
                    <TextButton
                      label={c.my_reaction ? t('social.memories.unlike') : t('social.memories.like')}
                      onPress={() => react.mutate({ type: 'comment', target: c.id, emoji: c.my_reaction ? null : EMOJIS[0] })}
                    />
                  ) : null}
                  {c.mine || data.is_mine ? <TextButton label={t('social.delete')} danger onPress={() => removeComment.mutate(c.id)} /> : null}
                  {!c.mine ? (
                    <TextButton
                      label={t('ops.report.short')}
                      onPress={() => setReporting({ type: 'post_comment', id: c.id, ownerId: c.author_id, ownerName: showName(c.author_name) })}
                    />
                  ) : null}
                </View>
              </Card>
            ))}

            {data.closed ? (
              <Note>{t('social.memories.closedNote')}</Note>
            ) : (
              <>
                <Field label={t('social.memories.addComment')} value={comment} onChangeText={setComment} multiline maxLength={2000} />
                <ActionError error={addComment.error} />
                <View style={styles.start}>
                  <SmallButton label={t('social.memories.postComment')} disabled={!comment.trim() || addComment.isPending} onPress={() => addComment.mutate()} />
                </View>
              </>
            )}

            {data.can_edit && !data.closed ? (
              <>
                <SecondaryButton label={t('social.memories.addPhotos')} disabled={addPhotos.isPending} onPress={() => addPhotos.mutate()} />
                <ActionError error={addPhotos.error} />
              </>
            ) : null}
            {data.is_mine ? (
              <>
                <SecondaryButton
                  label={data.closed ? t('social.memories.reopen') : t('social.memories.close')}
                  disabled={setClosed.isPending}
                  onPress={() => setClosed.mutate(!data.closed)}
                />
                <TextButton label={t('social.memories.delete')} danger onPress={() => setConfirmDelete(true)} />
              </>
            ) : (
              <TextButton
                label={t('ops.report.memory')}
                onPress={() => setReporting({ type: 'post', id: data.id, ownerId: data.author_id, ownerName: showName(data.author_name) })}
              />
            )}
          </>
        )}
      </Gate>
      <ConfirmDialog
        visible={confirmDelete}
        title={t('social.memories.deleteTitle')}
        confirmLabel={t('social.delete')}
        danger
        busy={removePost.isPending}
        onConfirm={() => removePost.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
      {reporting ? (
        <ReportDialog
          visible
          type={reporting.type}
          id={reporting.id}
          ownerId={reporting.ownerId}
          ownerName={reporting.ownerName}
          onClose={(result) => {
            setReporting(null);
            if (result === 'reported') refresh();
          }}
        />
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  who: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  body: { color: colors.text, fontFamily: fonts.medium, fontSize: 15, lineHeight: 22 },
  strip: { gap: 8 },
  photo: { width: 260, height: 260, borderRadius: 14 },
  emojis: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emoji: {
    minHeight: minTapSize,
    minWidth: minTapSize,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiOn: { borderColor: colors.logoPurple, borderWidth: 2 },
  emojiText: { fontSize: 16, color: colors.text, fontFamily: fonts.bold },
  comment: { gap: 4, padding: 12 },
  commentFoot: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  start: { alignSelf: 'flex-start' },
});
