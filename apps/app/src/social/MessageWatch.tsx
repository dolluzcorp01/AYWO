// Tells a signed-in person about a new chat message, and any other news (an answer to their invitation, a new
// invitation, a comment, an alert), wherever they are in the app.
//
// Before this, a message that arrived while someone was on Home or in the tree changed nothing they could see: the
// red number on Chat was only fetched once a minute, and nothing said who had written. Now the number updates the
// moment the message arrives, and a small card at the top says who wrote and what, and opens the chat when tapped.
// Sits once in the root layout. While the app is closed this cannot run: that is what phone notifications are for.
import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'expo-router';
import type { Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, AppState, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatIcon, CloseIcon } from '@/components/Icons';
import { Text } from '@/components/Text';
import { useMe } from '@/lib/account';
import { refreshNotices } from '@/lib/notices';
import { useRouter } from '@/lib/router';
import type { Message } from '@/social/types';
import { useChatSocket } from '@/social/useChatSocket';
import { colors, fonts, minTapSize, radius, shadows } from '@/theme/tokens';

const SHOW_MS = 6000;

/** What the card says and where a tap goes: a chat message, or any other piece of news. */
interface Shown {
  key: string;
  title: string;
  body: string;
  open: Href;
  /** The screen this is about: the card is not shown, and goes away, while the person is already there. */
  at: string;
}

export function MessageWatch() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const [note, setNote] = useState<Shown | null>(null);
  const appear = useRef(new Animated.Value(0)).current;
  const latest = useRef({ pathname, myId: me.data?.id });
  latest.current = { pathname, myId: me.data?.id };

  const refreshCounts = () => {
    void client.invalidateQueries({ queryKey: ['social-home'] });
    void client.invalidateQueries({ queryKey: ['chats'] });
  };

  useChatSocket(
    (message) => {
      // The sender's own phones get their message back too.
      if (!message.sender_id || message.sender_id === latest.current.myId) return;
      refreshCounts();
      // Already reading that chat: the message is on the screen, a card about it would only be in the way.
      if (latest.current.pathname === `/social/chat/${message.chat_id}`) return;
      if (message.deleted) return;
      const words = message.media_kind === 'photo' ? t('social.chat.photo') : message.media_kind === 'voice' ? t('social.chat.voiceNote') : (message.body ?? '');
      setNote({
        key: message.id,
        title: t('social.chat.newFrom', { name: message.sender_name }),
        body: words,
        open: { pathname: '/social/chat/[id]', params: { id: message.chat_id } },
        at: `/social/chat/${message.chat_id}`,
      });
    },
    // Messages sent while the connection was down are not sent again: fetch the numbers afresh.
    () => {
      refreshCounts();
      refreshNotices(client);
    },
    (notice) => {
      // The bell's number, the list, and whatever screen the news is about (who is coming, the alerts, the requests).
      refreshNotices(client);
      refreshCounts();
      for (const key of ['events', 'event', 'alerts', 'posts', 'post', 'activity', 'groups']) void client.invalidateQueries({ queryKey: [key] });
      const at = notice.path.split('?')[0] ?? notice.path;
      if (latest.current.pathname === at) return;
      setNote({ key: notice.id, title: notice.title, body: notice.body, open: notice.path as Href, at });
    },
  );

  // Coming back to the app after a while: the numbers may be old.
  useEffect(() => {
    const watch = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshCounts();
        refreshNotices(client);
      }
    });
    return () => watch.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!note) return;
    appear.setValue(0);
    Animated.timing(appear, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start();
    const timer = setTimeout(() => setNote(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [note, appear]);

  // Opening the chat by any other way puts the card away.
  useEffect(() => {
    if (note && pathname === note.at) setNote(null);
  }, [pathname, note]);

  if (!note) return null;
  return (
    <View pointerEvents="box-none" style={[styles.layer, { top: insets.top + 12 }]}>
      <Animated.View style={[styles.card, { opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${note.title}. ${note.body}`}
          accessibilityHint={t('social.chat.openHint')}
          onPress={() => {
            const open = note.open;
            setNote(null);
            router.push(open);
          }}
          style={styles.open}
        >
          <View style={styles.mark}>
            <ChatIcon color={colors.white} size={20} width={2} />
          </View>
          <View style={styles.words}>
            <Text style={styles.from} numberOfLines={1}>{note.title}</Text>
            <Text style={styles.body} numberOfLines={2}>{note.body}</Text>
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => setNote(null)} style={styles.close}>
          <CloseIcon size={18} color={colors.muted} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 16 },
  card: {
    width: '100%',
    maxWidth: 480,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.raised,
  },
  open: { flex: 1, minWidth: 0, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 14, paddingVertical: 10 },
  mark: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.logoIndigo, alignItems: 'center', justifyContent: 'center' },
  words: { flex: 1, minWidth: 0 },
  from: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  body: { color: colors.muted, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  close: { width: minTapSize, height: minTapSize, alignItems: 'center', justifyContent: 'center' },
});
