// One memory: photos, who is in it, reactions, comments, and closing the thread. Anyone can report it or a comment.
// The author can edit the words and date, remove or reorder photos and untag people; anyone can edit their comment.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card, ConfirmDialog, Field, Label, SecondaryButton, SectionTitle, SmallButton, TextButton } from '@/components/ui';
import { api, uploadFile } from '@/lib/api';
import { useTimeAgo } from '@/lib/time';
import { ReportDialog } from '@/ops/Report';
import type { ReportTarget } from '@/ops/Report';
import { pickPhotos } from '@/social/media';
import { moveItem, PhotoStrip } from '@/social/PhotoStrip';
import { ActionError, Gate, Note, Page, useName, useWhen } from '@/social/parts';
import type { Post } from '@/social/types';
import { colors, fonts, minTapSize } from '@/theme/tokens';

const EMOJIS = ['❤️', '🙏', '😂', '😢', '👏'];

/** A name with an x to take it off (a tag, a helper). Without onRemove it is just the name. */
function Chip({ label, removeLabel, onRemove }: { label: string; removeLabel: string; onRemove?: () => void }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
      {onRemove ? (
        <Pressable accessibilityRole="button" accessibilityLabel={removeLabel} onPress={onRemove} style={styles.chipX}>
          <Text style={styles.chipXText}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

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
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState('');
  const [draftDate, setDraftDate] = useState('');
  const [editingComment, setEditingComment] = useState<{ id: string; body: string } | null>(null);
  const [removingPhoto, setRemovingPhoto] = useState<string | null>(null);
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
  const update = useMutation({
    mutationFn: () =>
      api.rpc('post_update', { p_post: id, p_body: draftBody.trim(), p_happened_on: draftDate.trim() || null }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const removeMedia = useMutation({
    mutationFn: (mediaId: string) => api.rpc('post_remove_media', { p_media: mediaId }),
    onSuccess: () => {
      setRemovingPhoto(null);
      refresh();
    },
    onError: () => setRemovingPhoto(null),
  });
  const reorder = useMutation({
    mutationFn: (order: string[]) => api.rpc('post_reorder_media', { p_post: id, p_order: order }),
    onSuccess: refresh,
  });
  const untag = useMutation({
    mutationFn: (tag: { person_id: string | null; profile_id: string | null }) =>
      api.rpc('post_remove_tag', { p_post: id, p_person: tag.person_id, p_profile: tag.profile_id }),
    onSuccess: refresh,
  });
  const removeHelper = useMutation({
    mutationFn: (profileId: string) => api.rpc('post_remove_collaborator', { p_post: id, p_profile: profileId }),
    onSuccess: refresh,
  });
  const updateComment = useMutation({
    mutationFn: (c: { id: string; body: string }) => api.rpc('comment_update', { p_comment: c.id, p_body: c.body.trim() }),
    onSuccess: () => {
      setEditingComment(null);
      refresh();
    },
  });
  const draftDateOk = draftDate.trim() === '' || /^\d{4}-\d{2}-\d{2}$/.test(draftDate.trim());

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
              <View style={styles.cardHead}>
                <View style={styles.flex}>
                  <Text style={styles.who}>{showName(data.author_name)}</Text>
                  <Note>
                    {[data.scope_name, when(data.happened_on, true), data.edited ? t('social.edited') : null].filter(Boolean).join(' · ')}
                  </Note>
                </View>
                {data.is_mine && !editing ? (
                  <SmallButton
                    kind="plain"
                    label={t('social.memories.edit')}
                    onPress={() => {
                      setDraftBody(data.body ?? '');
                      setDraftDate(data.happened_on ?? '');
                      setEditing(true);
                    }}
                  />
                ) : null}
              </View>

              {editing ? (
                <>
                  {/* Photos: remove any, or move them into the order the family should see. */}
                  <PhotoStrip
                    photos={data.media.map((m) => ({ key: m.id, uri: m.url, canRemove: !!m.can_remove }))}
                    size={140}
                    busy={removeMedia.isPending || reorder.isPending}
                    onRemove={(mediaId) => setRemovingPhoto(mediaId)}
                    onMove={(from, to) => reorder.mutate(moveItem(data.media.map((m) => m.id), from, to))}
                  />
                  <ActionError error={removeMedia.error ?? reorder.error} />
                  {!data.closed ? (
                    <SecondaryButton label={t('social.memories.addPhotos')} disabled={addPhotos.isPending} onPress={() => addPhotos.mutate()} />
                  ) : null}
                  <Field label={t('social.memories.words')} value={draftBody} onChangeText={setDraftBody} multiline maxLength={4000} style={styles.words} />
                  <Field
                    label={t('social.memories.when')}
                    value={draftDate}
                    onChangeText={setDraftDate}
                    placeholder={t('social.datePlaceholder')}
                    autoCapitalize="none"
                  />
                  {data.tags.length > 0 ? (
                    <>
                      <Label>{t('social.memories.taggedPeople')}</Label>
                      <View style={styles.chips}>
                        {data.tags.map((tag) => (
                          <Chip
                            key={`${tag.person_id ?? tag.profile_id}`}
                            label={tag.name}
                            removeLabel={t('social.memories.untag', { name: tag.name })}
                            onRemove={tag.can_remove ? () => untag.mutate(tag) : undefined}
                          />
                        ))}
                      </View>
                    </>
                  ) : null}
                  {data.collaborators.length > 0 ? (
                    <>
                      <Label>{t('social.memories.helpers')}</Label>
                      <View style={styles.chips}>
                        {data.collaborators.map((c) => (
                          <Chip
                            key={c.profile_id}
                            label={showName(c.name)}
                            removeLabel={t('social.memories.removeHelper', { name: showName(c.name) })}
                            onRemove={c.can_remove ? () => removeHelper.mutate(c.profile_id) : undefined}
                          />
                        ))}
                      </View>
                    </>
                  ) : null}
                  <ActionError error={update.error ?? untag.error ?? removeHelper.error} />
                  <View style={styles.row}>
                    <SmallButton
                      label={t('common.save')}
                      disabled={update.isPending || !draftDateOk || (!draftBody.trim() && data.media.length === 0)}
                      onPress={() => update.mutate()}
                    />
                    <SmallButton kind="plain" label={t('common.cancel')} onPress={() => setEditing(false)} />
                  </View>
                  {!draftDateOk ? <Note>{t('social.missing.date')}</Note> : null}
                </>
              ) : (
                <>
                  {data.media.length > 0 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.strip}>
                      {data.media.map((m, i) =>
                        m.url ? <Image key={m.id} source={{ uri: m.url }} style={styles.photo} accessibilityLabel={t('social.photos.photoN', { n: i + 1 })} /> : null,
                      )}
                    </ScrollView>
                  ) : null}
                  {data.body ? <Text style={styles.body}>{data.body}</Text> : null}
                  {data.tags.length > 0 ? <Note>{t('social.memories.with', { names: data.tags.map((x) => x.name).join(', ') })}</Note> : null}
                  {data.collaborators.length > 0 ? (
                    <Note>{t('social.memories.addedWith', { names: data.collaborators.map((x) => showName(x.name)).join(', ') })}</Note>
                  ) : null}
                  {/* Someone tagged in another person's memory can take their own tag off. */}
                  {!data.is_mine
                    ? data.tags
                        .filter((tag) => tag.can_remove)
                        .map((tag) => (
                          <TextButton key={`me-${tag.person_id ?? tag.profile_id}`} label={t('social.memories.untagMe')} onPress={() => untag.mutate(tag)} />
                        ))
                    : null}
                  {/* A helper can manage their own photos without the author's edit screen. */}
                  {!data.is_mine && data.media.some((m) => m.can_remove) ? (
                    <PhotoStrip
                      photos={data.media.filter((m) => m.can_remove).map((m) => ({ key: m.id, uri: m.url, canRemove: true }))}
                      size={80}
                      busy={removeMedia.isPending}
                      onRemove={(mediaId) => setRemovingPhoto(mediaId)}
                    />
                  ) : null}
                </>
              )}
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
                {editingComment?.id === c.id ? (
                  <>
                    <Field
                      label={t('social.memories.editComment')}
                      value={editingComment.body}
                      onChangeText={(body) => setEditingComment({ id: c.id, body })}
                      multiline
                      maxLength={2000}
                    />
                    <ActionError error={updateComment.error} />
                    <View style={styles.row}>
                      <SmallButton
                        label={t('common.save')}
                        disabled={!editingComment.body.trim() || updateComment.isPending}
                        onPress={() => updateComment.mutate(editingComment)}
                      />
                      <SmallButton kind="plain" label={t('common.cancel')} onPress={() => setEditingComment(null)} />
                    </View>
                  </>
                ) : (
                  <Text style={styles.body}>{c.body}</Text>
                )}
                <View style={styles.commentFoot}>
                  <Note>{c.edited ? `${ago(c.created_at)} · ${t('social.edited')}` : ago(c.created_at)}</Note>
                  {c.reactions.map((r) => (
                    <Note key={r.emoji}>{`${r.emoji} ${r.count}`}</Note>
                  ))}
                  {!data.closed ? (
                    <TextButton
                      label={c.my_reaction ? t('social.memories.unlike') : t('social.memories.like')}
                      onPress={() => react.mutate({ type: 'comment', target: c.id, emoji: c.my_reaction ? null : EMOJIS[0] })}
                    />
                  ) : null}
                  {c.mine && !data.closed && editingComment?.id !== c.id ? (
                    <TextButton label={t('social.edit')} onPress={() => setEditingComment({ id: c.id, body: c.body })} />
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

            {data.can_edit && !data.closed && !editing ? (
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
        visible={!!removingPhoto}
        title={t('social.photos.removeTitle')}
        message={t('social.photos.removeMessage')}
        confirmLabel={t('social.photos.removeYes')}
        danger
        busy={removeMedia.isPending}
        onConfirm={() => removingPhoto && removeMedia.mutate(removingPhoto)}
        onCancel={() => setRemovingPhoto(null)}
      />
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
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  words: { minHeight: 100, paddingTop: 14, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 4, minHeight: 36, borderRadius: 18, backgroundColor: colors.tint },
  chipText: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  chipX: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  chipXText: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 13 },
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
