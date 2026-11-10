// One chat: text, photos, voice notes, replies. Live over the WebSocket, and fetched on a timer when it is down.
// A long press reports someone else's message. One-to-one chats can block the other person; the person who made a group
// chat can remove people from it.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { CameraIcon, CloseIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Text, TextInput } from '@/components/Text';
import { ConfirmDialog, SmallButton, TextButton, TopBar } from '@/components/ui';
import { api, uploadFile } from '@/lib/api';
import type { PickedFile } from '@/lib/api';
import { useTimeAgo } from '@/lib/time';
import { BlockDialog, ReportDialog } from '@/ops/Report';
import { pickPhotos } from '@/social/media';
import { ActionError, Gate, newClientId, Note, useGoBack, useName } from '@/social/parts';
import type { ChatPage, Message } from '@/social/types';
import { FETCH_WHEN_OFFLINE_MS, useChatSocket } from '@/social/useChatSocket';
import { VoicePlayer, VoiceRecorder } from '@/social/voice';
import { colors, fonts, gradients, minTapSize } from '@/theme/tokens';

const PAGE = 50;
type Pages = InfiniteData<ChatPage, string | null>;

function placeMessage(old: Pages | undefined, message: Message): Pages | undefined {
  if (!old || old.pages.length === 0) return old;
  const known = old.pages.some((page) => page.messages.some((m) => m.id === message.id));
  if (known) {
    return { ...old, pages: old.pages.map((page) => ({ ...page, messages: page.messages.map((m) => (m.id === message.id ? message : m)) })) };
  }
  const [first, ...rest] = old.pages;
  return { ...old, pages: [{ ...first, messages: [message, ...first.messages] }, ...rest] };
}

export default function ChatRoom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const client = useQueryClient();
  const goBack = useGoBack();
  const ago = useTimeAgo();
  const showName = useName();

  const [text, setText] = useState('');
  const [reply, setReply] = useState<Message | null>(null);
  const [recording, setRecording] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [toDelete, setToDelete] = useState<Message | null>(null);
  const [toReport, setToReport] = useState<Message | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [people, setPeople] = useState(false);
  // Kept until a send succeeds, so trying again after a dropped connection cannot post twice.
  const clientId = useRef(newClientId());
  const key = ['chat', id];
  const me = useQuery({ queryKey: ['social-me'], queryFn: () => api.get<{ id: string }>('/me') });

  const markRead = useMutation({ mutationFn: () => api.rpc('chat_mark_read', { p_chat: id }) });
  // People this person blocked, or who blocked them: their live messages are left out too, like the fetched ones.
  const hidden = useQuery({ queryKey: ['hidden-people'], queryFn: () => api.rpc<string[]>('social_hidden_people') });
  const members = useQuery({
    queryKey: ['chat-members', id],
    queryFn: () => api.rpc<{ profile_id: string; name: string; creator: boolean }[]>('chat_members_list', { p_chat: id }),
  });

  const connected = useChatSocket(
    (message) => {
      if (message.chat_id !== id) return;
      if (message.sender_id && hidden.data?.includes(message.sender_id)) return;
      client.setQueryData<Pages>(key, (old) => placeMessage(old, message));
      markRead.mutate();
    },
    () => client.invalidateQueries({ queryKey: key }),
  );

  const chat = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<ChatPage>(`/chats/${id}/messages?limit=${PAGE}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => (last.messages.length === PAGE ? last.messages[last.messages.length - 1].created_at : null),
    refetchInterval: connected ? false : FETCH_WHEN_OFFLINE_MS,
  });

  const messages = useMemo(() => chat.data?.pages.flatMap((page) => page.messages) ?? [], [chat.data]);
  const newestId = messages[0]?.id;
  useEffect(() => {
    if (newestId) {
      markRead.mutate(undefined, { onSuccess: () => client.invalidateQueries({ queryKey: ['chats'] }) });
    }
    // Only a new newest message should mark the chat read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId]);

  const send = useMutation({
    mutationFn: async (input: { body?: string; file?: PickedFile; kind?: 'photo' | 'voice'; ms?: number }) => {
      const mediaPath = input.file ? await uploadFile('chat', input.file) : null;
      return api.post<Message>(`/chats/${id}/messages`, {
        body: input.body ?? null,
        media_path: mediaPath,
        media_kind: input.kind ?? null,
        media_ms: input.ms ?? null,
        reply_to: reply?.id ?? null,
        client_id: clientId.current,
      });
    },
    onSuccess: (message, input) => {
      clientId.current = newClientId();
      client.setQueryData<Pages>(key, (old) => placeMessage(old, message));
      setReply(null);
      if (input.body) setText('');
    },
  });

  const remove = useMutation({
    mutationFn: (messageId: string) => api.rpc('message_delete', { p_message: messageId }),
    onSettled: () => {
      setToDelete(null);
      client.invalidateQueries({ queryKey: key });
    },
  });

  async function sendPhoto() {
    const [photo] = await pickPhotos(1);
    if (photo) send.mutate({ file: photo, kind: 'photo' });
  }

  const first = chat.data?.pages[0];
  const title = first ? showName(first.chat.name) : t('social.chat.title');
  const subtitle = first?.chat.kind === 'group' ? t('social.chat.memberCount', { count: first.chat.members }) : undefined;
  const other = members.data?.find((m) => m.profile_id !== me.data?.id);
  const iMadeIt = !!members.data?.some((m) => m.creator && m.profile_id === me.data?.id);
  const removeMember = useMutation({
    mutationFn: (profileId: string) => api.rpc('chat_remove_member', { p_chat: id, p_profile: profileId }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['chat-members', id] });
      client.invalidateQueries({ queryKey: key });
    },
  });

  function renderMessage({ item }: { item: Message }) {
    const mine = item.sender_id !== null && item.sender_id === me.data?.id;
    if (item.deleted) {
      return (
        <View style={[styles.bubble, styles.theirs]}>
          <Text style={styles.deleted}>{t('social.chat.deleted')}</Text>
        </View>
      );
    }
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityHint={t('social.chat.replyHint')}
        onPress={() => setReply(item)}
        onLongPress={() => (mine ? setToDelete(item) : setToReport(item))}
        accessibilityActions={mine ? undefined : [{ name: 'longpress', label: t('ops.report.short') }]}
        onAccessibilityAction={() => (mine ? undefined : setToReport(item))}
        style={[styles.bubble, mine ? styles.mine : styles.theirs]}
      >
        {!mine && first?.chat.kind === 'group' ? <Text style={styles.sender}>{showName(item.sender_name)}</Text> : null}
        {item.reply ? (
          <View style={styles.quote}>
            <Text style={[styles.quoteName, mine && styles.onMine]}>{showName(item.reply.sender_name)}</Text>
            <Text numberOfLines={2} style={[styles.quoteBody, mine && styles.onMine]}>
              {item.reply.body ?? (item.reply.media_kind === 'photo' ? t('social.chat.photo') : t('social.chat.voiceNote'))}
            </Text>
          </View>
        ) : null}
        {item.media_kind === 'photo' && item.media_url ? (
          <Image source={{ uri: item.media_url }} style={styles.photo} accessibilityLabel={t('social.chat.photo')} />
        ) : null}
        {item.media_kind === 'voice' && item.media_url ? <VoicePlayer url={item.media_url} ms={item.media_ms} onDark={mine} /> : null}
        {item.body ? <Text style={[styles.body, mine && styles.onMine]}>{item.body}</Text> : null}
        <Text style={[styles.time, mine && styles.onMine]}>{ago(item.created_at)}</Text>
      </Pressable>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <TopBar title={title} subtitle={subtitle} onBack={goBack} />
        {first ? (
          <View style={styles.tools}>
            {first.chat.kind === 'direct' && other ? <TextButton label={t('ops.block.short')} onPress={() => setBlocking(true)} /> : null}
            {first.chat.kind === 'group' ? <TextButton label={t('ops.chat.people')} onPress={() => setPeople(true)} /> : null}
          </View>
        ) : null}
        <Gate query={chat as never} plusMessage={t('social.chat.plusBody')}>
          {() => (
            <FlatList
              inverted
              style={styles.fill}
              contentContainerStyle={styles.list}
              data={messages}
              keyExtractor={(m) => m.id}
              renderItem={renderMessage}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Note>{t('social.chat.sayHello')}</Note>}
              ListFooterComponent={
                chat.hasNextPage ? <TextButton label={t('social.chat.older')} onPress={() => chat.fetchNextPage()} disabled={chat.isFetchingNextPage} /> : undefined
              }
            />
          )}
        </Gate>

        {!connected ? <Note>{t('social.chat.reconnecting')}</Note> : null}
        {micDenied ? <Note>{t('social.chat.micDenied')}</Note> : null}
        <ActionError error={send.error} />

        {reply ? (
          <View style={styles.replying}>
            <Text numberOfLines={1} style={styles.replyingText}>
              {t('social.chat.replyingTo', { name: showName(reply.sender_name) })}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('social.cancel')} onPress={() => setReply(null)} style={styles.iconButton}>
              <CloseIcon color={colors.muted} size={16} />
            </Pressable>
          </View>
        ) : null}

        {recording ? (
          <VoiceRecorder
            onCancel={() => setRecording(false)}
            onDenied={() => {
              setRecording(false);
              setMicDenied(true);
            }}
            onDone={(file, ms) => {
              setRecording(false);
              send.mutate({ file, kind: 'voice', ms });
            }}
          />
        ) : (
          <View style={styles.composer}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('social.chat.sendPhoto')} onPress={() => void sendPhoto()} style={styles.iconButton}>
              <CameraIcon color={colors.relation} size={22} />
            </Pressable>
            <TextInput
              accessibilityLabel={t('social.chat.typeHere')}
              placeholder={t('social.chat.typeHere')}
              placeholderTextColor={colors.muted}
              value={text}
              onChangeText={setText}
              multiline
              maxLength={4000}
              style={styles.input}
            />
            {text.trim() ? (
              <SmallButton label={t('social.chat.send')} disabled={send.isPending} onPress={() => send.mutate({ body: text })} />
            ) : (
              <SmallButton
                label={t('social.chat.voice')}
                kind="plain"
                onPress={() => {
                  setMicDenied(false);
                  setRecording(true);
                }}
              />
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={!!toDelete}
        title={t('social.chat.deleteTitle')}
        confirmLabel={t('social.delete')}
        danger
        busy={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        onCancel={() => setToDelete(null)}
      />
      {toReport ? (
        <ReportDialog
          visible
          type="message"
          id={toReport.id}
          ownerId={toReport.sender_id}
          ownerName={showName(toReport.sender_name)}
          onClose={() => setToReport(null)}
        />
      ) : null}
      {blocking && other ? (
        <BlockDialog visible profileId={other.profile_id} name={showName(other.name)} blocked={false} onClose={(changed) => { setBlocking(false); if (changed) goBack(); }} />
      ) : null}
      <ConfirmDialog
        visible={people}
        title={t('ops.chat.people')}
        confirmLabel={t('ops.chat.done')}
        onConfirm={() => setPeople(false)}
        onCancel={() => setPeople(false)}
      >
        {(members.data ?? []).map((m) => (
          <View key={m.profile_id} style={styles.member}>
            <Text style={styles.memberName}>{showName(m.name)}{m.creator ? ` · ${t('ops.chat.madeIt')}` : ''}</Text>
            {iMadeIt && m.profile_id !== me.data?.id ? (
              <TextButton label={t('ops.chat.remove')} danger disabled={removeMember.isPending} onPress={() => removeMember.mutate(m.profile_id)} />
            ) : null}
          </View>
        ))}
        <ActionError error={removeMember.error} />
      </ConfirmDialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  tools: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  member: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: minTapSize },
  memberName: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  list: { gap: 8, paddingVertical: 12 },
  bubble: { maxWidth: '84%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  mine: { alignSelf: 'flex-end', backgroundColor: gradients.neon[0] },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  sender: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 13 },
  body: { color: colors.text, fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 },
  onMine: { color: colors.white },
  time: { color: colors.muted, fontFamily: fonts.medium, fontSize: 11 },
  deleted: { color: colors.muted, fontFamily: fonts.medium, fontSize: 14, fontStyle: 'italic' },
  photo: { width: 220, height: 220, borderRadius: 12 },
  quote: { borderStartWidth: 3, borderStartColor: colors.logoYellow, paddingStart: 8 },
  quoteName: { color: colors.text, fontFamily: fonts.bold, fontSize: 12 },
  quoteBody: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12 },
  replying: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6 },
  replyingText: { flex: 1, color: colors.muted, fontFamily: fonts.semibold, fontSize: 13 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 8 },
  iconButton: { width: minTapSize, height: minTapSize, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    minHeight: minTapSize,
    maxHeight: 120,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontFamily: fonts.medium,
    fontSize: 15,
  },
});
