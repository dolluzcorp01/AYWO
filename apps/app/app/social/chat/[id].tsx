// One chat: text, photos, voice notes, replies. Live over the WebSocket, and fetched on a timer when it is down.
// A long press reports someone else's message. One-to-one chats can block the other person; the person who made a group
// chat can remove people from it.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { useIsFocused, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { CameraIcon, CloseIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Text, TextInput } from '@/components/Text';
import { useVoiceInput } from '@/voice/useVoiceInput';
import { VoiceButton } from '@/voice/VoiceButton';
import { ConfirmDialog, Field, SmallButton, TextButton, TopBar } from '@/components/ui';
import { api, uploadFile } from '@/lib/api';
import type { PickedFile } from '@/lib/api';
import { showPhone } from '@/lib/phone';
import { useTimeAgo } from '@/lib/time';
import { BlockDialog, ReportDialog } from '@/ops/Report';
import { pickPhotos } from '@/social/media';
import { PeoplePicker } from '@/social/AudiencePicker';
import { ActionError, Gate, newClientId, Note, useGoBack, useName } from '@/social/parts';
import type { ChatPage, Message } from '@/social/types';
import { FETCH_WHEN_OFFLINE_MS, useChatSocket } from '@/social/useChatSocket';
import { VoicePlayer, VoiceRecorder } from '@/social/voice';
import { colors, fonts, gradients, minTapSize } from '@/theme/tokens';

const PAGE = 50;
// Photo and voice links are signed for one hour. The chat is fetched again well inside that, and a link already on
// screen is kept for a while so photos do not flicker and voice notes do not reload on every fetch.
const MEDIA_REFETCH_MS = 20 * 60_000;
const MEDIA_LINK_KEEP_MS = 30 * 60_000;
const MEDIA_RETRY_GAP_MS = 30_000;
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
  // Speak a message: one phrase at a time, added to what is typed; tap Send when it reads right.
  const textVoice = useVoiceInput(text, setText);
  const [reply, setReply] = useState<Message | null>(null);
  const [recording, setRecording] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [toDelete, setToDelete] = useState<Message | null>(null);
  // One "are you sure" for the small removals on this screen: what is asked, and what Yes does.
  const [asking, setAsking] = useState<{ title: string; yes: string; run: () => void } | null>(null);
  const [toReport, setToReport] = useState<Message | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [people, setPeople] = useState(false);
  // Tapping a message opens its choices (reply, edit, delete, report): easy to find with a mouse or a finger.
  const [chosen, setChosen] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  // One id for each thing being sent, kept until that send succeeds: trying the same words or the same photo again after
  // a dropped connection cannot post twice, and two different things sent close together never share an id (the server
  // answers a repeated id with the first message, so sharing one would silently lose the second).
  const lastTry = useRef<{ what: string; id: string } | null>(null);
  const whatIsSent = (input: { body?: string; file?: PickedFile }) => (input.file ? `file:${input.file.uri}` : `text:${input.body ?? ''}`);
  const key = ['chat', id];
  const me = useQuery({ queryKey: ['social-me'], queryFn: () => api.get<{ id: string }>('/me') });

  const myId = me.data?.id;

  // "Read" means the person could see it: this chat is the screen in front, and AYWO is open.
  const focused = useIsFocused();
  const [appOpen, setAppOpen] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setAppOpen(state === 'active'));
    return () => listener.remove();
  }, []);
  const watching = focused && appOpen;
  const watchingNow = useRef(watching);
  watchingNow.current = watching;

  const markRead = useMutation({
    mutationFn: () => api.rpc('chat_mark_read', { p_chat: id }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['chats'] });
      // The count on Home and on the tab bar.
      client.invalidateQueries({ queryKey: ['social-home'] });
    },
  });
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
      if (watchingNow.current) markRead.mutate();
    },
    () => client.invalidateQueries({ queryKey: key }),
  );

  const chat = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<ChatPage>(`/chats/${id}/messages?limit=${PAGE}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    // A live message is added to the first page, so a full page can hold more than PAGE: "older messages" must stay.
    getNextPageParam: (last) => (last.messages.length >= PAGE ? last.messages[last.messages.length - 1].created_at : null),
    // With the socket up nothing else fetches, and the signed photo and voice links would run out after an hour.
    refetchInterval: connected ? MEDIA_REFETCH_MS : FETCH_WHEN_OFFLINE_MS,
  });

  // Each message keeps the link it was first shown with until that link is getting old.
  const mediaLinks = useRef(new Map<string, { url: string; at: number }>());
  const lastMediaRetry = useRef(0);
  const fetchedAt = chat.dataUpdatedAt;
  const messages = useMemo(() => {
    const all = chat.data?.pages.flatMap((page) => page.messages) ?? [];
    const at = fetchedAt || Date.now();
    return all.map((m) => {
      if (!m.media_url) return m;
      const kept = mediaLinks.current.get(m.id);
      if (kept && at - kept.at < MEDIA_LINK_KEEP_MS) return kept.url === m.media_url ? m : { ...m, media_url: kept.url };
      mediaLinks.current.set(m.id, { url: m.media_url, at });
      return m;
    });
  }, [chat.data, fetchedAt]);
  // A photo or voice note that will not load: most likely its link ran out. Get new links, but not in a loop.
  function mediaFailed(messageId: string) {
    mediaLinks.current.delete(messageId);
    if (Date.now() - lastMediaRetry.current < MEDIA_RETRY_GAP_MS) return;
    lastMediaRetry.current = Date.now();
    void chat.refetch();
  }

  const newestId = messages[0]?.id;
  useEffect(() => {
    if (newestId && watching) markRead.mutate();
    // A new newest message, or coming back to this chat, marks it read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId, watching]);

  const send = useMutation({
    mutationFn: async (input: { body?: string; file?: PickedFile; kind?: 'photo' | 'voice'; ms?: number }) => {
      const what = whatIsSent(input);
      if (lastTry.current?.what !== what) lastTry.current = { what, id: newClientId() };
      const clientId = lastTry.current.id;
      const mediaPath = input.file ? await uploadFile('chat', input.file) : null;
      return api.post<Message>(`/chats/${id}/messages`, {
        body: input.body ?? null,
        media_path: mediaPath,
        media_kind: input.kind ?? null,
        media_ms: input.ms ?? null,
        reply_to: reply?.id ?? null,
        client_id: clientId,
      });
    },
    onSuccess: (message, input) => {
      if (lastTry.current?.what === whatIsSent(input)) lastTry.current = null;
      client.setQueryData<Pages>(key, (old) => placeMessage(old, message));
      setReply(null);
      if (input.body) setText('');
    },
  });

  const edit = useMutation({
    mutationFn: (input: { messageId: string; body: string }) => api.rpc('message_update', { p_message: input.messageId, p_body: input.body.trim() }),
    onSuccess: () => {
      setEditing(null);
      setText('');
      client.invalidateQueries({ queryKey: key });
    },
  });
  const rename = useMutation({
    mutationFn: (name: string) => api.rpc('chat_rename', { p_chat: id, p_name: name.trim() }),
    onSuccess: () => {
      setRenaming(null);
      client.invalidateQueries({ queryKey: key });
      client.invalidateQueries({ queryKey: ['chats'] });
    },
  });
  const leave = useMutation({
    mutationFn: () => api.rpc('chat_leave', { p_chat: id }),
    onSuccess: () => {
      setLeaving(false);
      client.invalidateQueries({ queryKey: ['chats'] });
      goBack();
    },
  });

  const remove = useMutation({
    mutationFn: (messageId: string) => api.rpc('message_delete', { p_message: messageId }),
    onSettled: () => {
      setToDelete(null);
      client.invalidateQueries({ queryKey: key });
    },
  });

  // A picked photo waits here for a look and a tap on Send: a wrong tap in the gallery no longer goes to everyone.
  const [photoToSend, setPhotoToSend] = useState<PickedFile | null>(null);
  async function sendPhoto() {
    const [photo] = await pickPhotos(1);
    if (photo) setPhotoToSend(photo);
  }

  const first = chat.data?.pages[0];
  const title = first ? showName(first.chat.name) : t('social.chat.title');
  // Until AYWO knows who is signed in, "the other person" could be the person themself: no Block until then.
  const other = myId ? members.data?.find((m) => m.profile_id !== myId) : undefined;
  // In a one-to-one chat, the other person's number under their name, when this person may see it (the card's rule).
  const direct = first?.chat.kind === 'direct';
  const otherNumber = useQuery({
    queryKey: ['profile-number', other?.profile_id],
    queryFn: () => api.rpc<string | null>('profile_number', { p_profile: other?.profile_id }),
    enabled: direct && !!other,
    staleTime: 5 * 60_000,
  });
  const subtitle = first?.chat.kind === 'group'
    ? t('social.chat.memberCount', { count: first.chat.members })
    : direct && otherNumber.data ? showPhone(otherNumber.data) : undefined;
  const iMadeIt = !!myId && !!members.data?.some((m) => m.creator && m.profile_id === myId);
  // Null while the list of members shows; a list (even empty) while people are being ticked to add.
  const [adding, setAdding] = useState<string[] | null>(null);
  const addMembers = useMutation({
    mutationFn: () => api.rpc('chat_add_members', { p_chat: id, p_members: adding ?? [] }),
    onSuccess: () => {
      setAdding(null);
      void members.refetch();
      client.invalidateQueries({ queryKey: ['chats'] });
    },
  });
  const removeMember = useMutation({
    mutationFn: (profileId: string) => api.rpc('chat_remove_member', { p_chat: id, p_profile: profileId }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['chat-members', id] });
      client.invalidateQueries({ queryKey: key });
    },
  });

  function renderMessage({ item }: { item: Message }) {
    const mine = item.sender_id !== null && item.sender_id === myId;
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
        accessibilityHint={t('social.chat.choicesHint')}
        onPress={() => setChosen(item)}
        onLongPress={() => setChosen(item)}
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
          <Image source={{ uri: item.media_url }} style={styles.photo} accessibilityLabel={t('social.chat.photo')} onError={() => mediaFailed(item.id)} />
        ) : null}
        {item.media_kind === 'voice' && item.media_url ? <VoicePlayer url={item.media_url} ms={item.media_ms} onDark={mine} onStale={() => mediaFailed(item.id)} /> : null}
        {item.body ? <Text style={[styles.body, mine && styles.onMine]}>{item.body}</Text> : null}
        <Text style={[styles.time, mine && styles.onMine]}>{item.edited ? `${ago(item.created_at)} · ${t('social.edited')}` : ago(item.created_at)}</Text>
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
            {first.chat.kind === 'group' && first.chat.can_rename ? (
              <TextButton label={t('social.chat.rename')} onPress={() => setRenaming(first.chat.name ?? '')} />
            ) : null}
            {first.chat.kind === 'group' ? <TextButton label={t('ops.chat.people')} onPress={() => setPeople(true)} /> : null}
            {first.chat.kind === 'group' ? <TextButton label={t('social.chat.leave')} danger onPress={() => setLeaving(true)} /> : null}
          </View>
        ) : null}
        {/* Whose message is whose depends on knowing who is signed in: nothing is drawn on a guess. */}
        <Gate query={me}>
          {() => (
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
              // The list is drawn upside down (newest at the bottom), which also flips this note: flip it back.
              ListEmptyComponent={
                <View style={styles.unflip}>
                  <Note>{t('social.chat.sayHello')}</Note>
                </View>
              }
              ListFooterComponent={
                chat.hasNextPage ? <TextButton label={t('social.chat.older')} onPress={() => chat.fetchNextPage()} disabled={chat.isFetchingNextPage} /> : undefined
              }
            />
          )}
        </Gate>
          )}
        </Gate>

        {!connected ? <Note>{t('social.chat.reconnecting')}</Note> : null}
        {micDenied ? <Note>{t('social.chat.micDenied')}</Note> : null}
        <ActionError error={send.error} />
        <ActionError error={remove.error} />

        {editing ? (
          <View style={styles.replying}>
            <Text numberOfLines={1} style={styles.replyingText}>
              {t('social.chat.editing')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('social.cancel')}
              onPress={() => {
                setEditing(null);
                setText('');
              }}
              style={styles.iconButton}
            >
              <CloseIcon color={colors.muted} size={16} />
            </Pressable>
          </View>
        ) : null}
        <ActionError error={edit.error} />
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
            <VoiceButton voice={textVoice} size={44} />
            {editing ? (
              <SmallButton
                label={t('common.save')}
                disabled={!text.trim() || edit.isPending}
                onPress={() => edit.mutate({ messageId: editing.id, body: text })}
              />
            ) : text.trim() ? (
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

      {/* The choices for one message. */}
      <ConfirmDialog
        visible={!!chosen}
        title={t('social.chat.messageChoices')}
        confirmLabel={t('social.chat.reply')}
        onConfirm={() => {
          setReply(chosen);
          setChosen(null);
        }}
        onCancel={() => setChosen(null)}
      >
        {chosen && chosen.sender_id === myId && !chosen.media_kind ? (
          <TextButton
            label={t('social.edit')}
            onPress={() => {
              setEditing(chosen);
              setReply(null);
              setText(chosen.body ?? '');
              setChosen(null);
            }}
          />
        ) : null}
        {chosen && chosen.sender_id === myId ? (
          <TextButton
            label={t('social.delete')}
            danger
            onPress={() => {
              setToDelete(chosen);
              setChosen(null);
            }}
          />
        ) : null}
        {chosen && chosen.sender_id !== myId ? (
          <TextButton
            label={t('ops.report.short')}
            onPress={() => {
              setToReport(chosen);
              setChosen(null);
            }}
          />
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        visible={renaming !== null}
        title={t('social.chat.rename')}
        confirmLabel={t('common.save')}
        busy={rename.isPending}
        onConfirm={() => renaming?.trim() && rename.mutate(renaming)}
        onCancel={() => setRenaming(null)}
      >
        <Field label={t('social.chat.chatName')} value={renaming ?? ''} onChangeText={setRenaming} maxLength={80} />
        <ActionError error={rename.error} />
      </ConfirmDialog>
      <ConfirmDialog
        visible={leaving}
        title={t('social.chat.leaveTitle')}
        message={t('social.chat.leaveMessage')}
        confirmLabel={t('social.chat.leave')}
        danger
        busy={leave.isPending}
        onConfirm={() => leave.mutate()}
        onCancel={() => setLeaving(false)}
      >
        <ActionError error={leave.error} />
      </ConfirmDialog>
      <ConfirmDialog
        visible={!!asking}
        title={asking?.title ?? ''}
        confirmLabel={asking?.yes ?? ''}
        danger
        onConfirm={() => {
          asking?.run();
          setAsking(null);
        }}
        onCancel={() => setAsking(null)}
      />
      <ConfirmDialog
        visible={!!photoToSend}
        title={t('social.chat.sendPhotoTitle')}
        confirmLabel={t('social.chat.sendPhotoYes')}
        onConfirm={() => {
          if (photoToSend) send.mutate({ file: photoToSend, kind: 'photo' });
          setPhotoToSend(null);
        }}
        onCancel={() => setPhotoToSend(null)}
      >
        {photoToSend ? <Image source={{ uri: photoToSend.uri }} style={styles.photoPreview} resizeMode="contain" accessibilityLabel={t('social.chat.photo')} /> : null}
      </ConfirmDialog>
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
            {iMadeIt && m.profile_id !== myId ? (
              <TextButton label={t('ops.chat.remove')} danger disabled={removeMember.isPending} onPress={() => setAsking({ title: t('social.groups.removeTitle', { name: showName(m.name) }), yes: t('ops.chat.remove'), run: () => removeMember.mutate(m.profile_id) })} />
            ) : null}
          </View>
        ))}
        {members.isError ? (
          <>
            <ActionError error={members.error} />
            <TextButton label={t('social.chat.tryAgain')} onPress={() => void members.refetch()} />
          </>
        ) : null}
        <ActionError error={removeMember.error} />
        {adding ? (
          <>
            <PeoplePicker chosen={adding} onChange={setAdding} exclude={(members.data ?? []).map((m) => m.profile_id)} />
            <ActionError error={addMembers.error} />
            <SmallButton label={t('social.groups.addChosen')} disabled={adding.length === 0 || addMembers.isPending} onPress={() => addMembers.mutate()} />
            {adding.length === 0 ? <Note>{t('social.missing.tickSomeone')}</Note> : null}
            <TextButton label={t('social.cancel')} onPress={() => setAdding(null)} />
          </>
        ) : (
          <SmallButton kind="plain" label={t('social.groups.addPeople')} onPress={() => setAdding([])} />
        )}
      </ConfirmDialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  photoPreview: { width: '100%', height: 260, borderRadius: 12 },
  fill: { flex: 1 },
  unflip: { transform: [{ scaleY: -1 }] },
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
