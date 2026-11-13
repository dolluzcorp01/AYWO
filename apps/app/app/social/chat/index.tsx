// P2 chat list. AYWO Plus only: without it the server refuses and Gate shows the way to Plus.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { EmptyState, PrimaryButton } from '@/components/ui';
import { api } from '@/lib/api';
import { useTimeAgo } from '@/lib/time';
import { InviteFamily } from '@/social/InviteFamily';
import { Gate, Page, Row, useName } from '@/social/parts';
import type { ChatRow } from '@/social/types';
import { FETCH_WHEN_OFFLINE_MS, useChatSocket } from '@/social/useChatSocket';

export default function ChatList() {
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const ago = useTimeAgo();
  const showName = useName();
  const connected = useChatSocket(() => client.invalidateQueries({ queryKey: ['chats'] }));
  const chats = useQuery({
    queryKey: ['chats'],
    queryFn: () => api.rpc<ChatRow[]>('chat_list'),
    refetchInterval: connected ? false : FETCH_WHEN_OFFLINE_MS,
  });

  function preview(chat: ChatRow): string {
    const last = chat.last;
    if (!last) return t('social.chat.noMessagesYet');
    if (last.deleted) return t('social.chat.deleted');
    if (last.media_kind === 'photo') return t('social.chat.photo');
    if (last.media_kind === 'voice') return t('social.chat.voiceNote');
    return last.body ?? '';
  }

  return (
    <Page title={t('social.chat.title')} subtitle={t('social.chat.subtitle')}>
      <Gate query={chats} plusMessage={t('social.chat.plusBody')}>
        {(list) => (
          <>
            <PrimaryButton label={t('social.chat.new')} onPress={() => router.push('/social/chat/new')} />
            {list.length === 0 ? (
              <InviteFamily title={t('social.chat.inviteTitle')} help={t('social.chat.inviteHelp')} fallback={<EmptyState message={t('social.chat.empty')} />} />
            ) : null}
            {list.map((chat) => (
              <Row
                key={chat.id}
                title={showName(chat.name)}
                subtitle={`${preview(chat)}${chat.last_message_at ? ` · ${ago(chat.last_message_at)}` : ''}`}
                badge={chat.unread}
                onPress={() => router.push({ pathname: '/social/chat/[id]', params: { id: chat.id } })}
              />
            ))}
          </>
        )}
      </Gate>
    </Page>
  );
}
