// Tells a signed-in person about a new chat message wherever they are in the app.
//
// Before this, a message that arrived while someone was on Home or in the tree changed nothing they could see: the
// red number on Chat was only fetched once a minute, and nothing said who had written. Now the number updates the
// moment the message arrives, and a small card at the top says who wrote and what, and opens the chat when tapped.
// Sits once in the root layout. While the app is closed this cannot run: that is what phone notifications are for.
import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, AppState, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatIcon, CloseIcon } from '@/components/Icons';
import { Text } from '@/components/Text';
import { useMe } from '@/lib/account';
import { useRouter } from '@/lib/router';
import type { Message } from '@/social/types';
import { useChatSocket } from '@/social/useChatSocket';
import { colors, fonts, minTapSize, radius, shadows } from '@/theme/tokens';

const SHOW_MS = 6000;

export function MessageWatch() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const [note, setNote] = useState<Message | null>(null);
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
      if (!message.deleted) setNote(message);
    },
    // Messages sent while the connection was down are not sent again: fetch the numbers afresh.
    refreshCounts,
  );

  // Coming back to the app after a while: the numbers may be old.
  useEffect(() => {
    const watch = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshCounts();
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
    if (note && pathname === `/social/chat/${note.chat_id}`) setNote(null);
  }, [pathname, note]);

  if (!note) return null;
  const words = note.media_kind === 'photo' ? t('social.chat.photo') : note.media_kind === 'voice' ? t('social.chat.voiceNote') : (note.body ?? '');
  return (
    <View pointerEvents="box-none" style={[styles.layer, { top: insets.top + 12 }]}>
      <Animated.View style={[styles.card, { opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('social.chat.newFrom', { name: note.sender_name })}
          accessibilityHint={t('social.chat.openHint')}
          onPress={() => {
            const chatId = note.chat_id;
            setNote(null);
            router.push({ pathname: '/social/chat/[id]', params: { id: chatId } });
          }}
          style={styles.open}
        >
          <View style={styles.mark}>
            <ChatIcon color={colors.white} size={20} width={2} />
          </View>
          <View style={styles.words}>
            <Text style={styles.from} numberOfLines={1}>{t('social.chat.newFrom', { name: note.sender_name })}</Text>
            <Text style={styles.body} numberOfLines={2}>{words}</Text>
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
