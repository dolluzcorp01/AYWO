// One help ticket: the conversation with AYWO Support, a reply box, and closing it when sorted.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Field, SecondaryButton, SmallButton } from '@/components/ui';
import { api } from '@/lib/api';
import { useTimeAgo } from '@/lib/time';
import { ActionError, Gate, Note, Page } from '@/social/parts';
import type { Ticket } from '@/ops/types';
import { colors, fonts, radius } from '@/theme/tokens';

export default function HelpTicket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const client = useQueryClient();
  const ago = useTimeAgo();
  const [reply, setReply] = useState('');
  const key = ['ticket', id];
  const ticket = useQuery({ queryKey: key, queryFn: () => api.rpc<Ticket>('ticket_detail', { p_ticket: id }) });

  const send = useMutation({
    mutationFn: () => api.rpc<Ticket>('ticket_reply', { p_ticket: id, p_body: reply.trim() }),
    onSuccess: (data) => {
      setReply('');
      client.setQueryData(key, data);
      client.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
  const close = useMutation({
    mutationFn: () => api.rpc('ticket_close', { p_ticket: id }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: key });
      client.invalidateQueries({ queryKey: ['tickets'] });
    },
  });

  return (
    <Page title={ticket.data?.subject ?? t('ops.help.title')} subtitle={ticket.data ? t(`ops.help.status.${ticket.data.status}`) : undefined}>
      <Gate query={ticket}>
        {(data) => (
          <>
            <View style={styles.thread}>
              {(data.messages ?? []).map((m) => (
                <View key={m.id} style={[styles.bubble, m.from_staff ? styles.theirs : styles.mine]}>
                  <Text style={styles.who}>{m.from_staff ? t('ops.help.support') : t('ops.help.you')}</Text>
                  <Text style={styles.body}>{m.body}</Text>
                  <Text style={styles.time}>{ago(m.created_at)}</Text>
                </View>
              ))}
            </View>
            {data.status === 'closed' ? <Note>{t('ops.help.closedNote')}</Note> : <Note>{t('ops.help.replyTime')}</Note>}
            <Field label={t('ops.help.reply')} value={reply} onChangeText={setReply} maxLength={4000} multiline />
            <ActionError error={send.error} />
            <View style={styles.start}>
              <SmallButton label={t('ops.help.sendReply')} disabled={!reply.trim() || send.isPending} onPress={() => send.mutate()} />
            </View>
            {data.status !== 'closed' ? <SecondaryButton label={t('ops.help.solved')} disabled={close.isPending} onPress={() => close.mutate()} /> : null}
          </>
        )}
      </Gate>
    </Page>
  );
}

const styles = StyleSheet.create({
  thread: { gap: 10 },
  bubble: { maxWidth: '88%', borderRadius: radius.card, padding: 14, gap: 4 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.tint },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  who: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 13 },
  body: { color: colors.text, fontFamily: fonts.medium, fontSize: 15, lineHeight: 22 },
  time: { color: colors.muted, fontFamily: fonts.medium, fontSize: 11 },
  start: { alignSelf: 'flex-start' },
});
