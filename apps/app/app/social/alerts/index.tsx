// P4 alerts, free for everyone: ones received and ones sent. Opening this screen marks them as seen.
// The sender can mark an alert sorted (blood found, help arrived) or delete one sent by mistake.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/lib/router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card, ConfirmDialog, EmptyState, Field, PrimaryButton, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { useTimeAgo } from '@/lib/time';
import { ActionError, Gate, Note, Page, Row, useName } from '@/social/parts';
import type { AlertRow, HomeCounts } from '@/social/types';
import { colors, fonts } from '@/theme/tokens';

export default function Alerts() {
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const ago = useTimeAgo();
  const showName = useName();
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => api.rpc<AlertRow[]>('alerts_list') });
  const counts = useQuery({ queryKey: ['social-home'], queryFn: () => api.rpc<HomeCounts>('social_home_counts') });
  const markSeen = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api.rpc('alert_mark_seen', { p_alert: id }))),
    onSuccess: () => client.invalidateQueries({ queryKey: ['social-home'] }),
  });

  const [deleting, setDeleting] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ['alerts'] });
  // The sender corrects the words of an alert already sent (a wrong hospital name).
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const update = useMutation({
    mutationFn: (input: { id: string; body: string }) => api.rpc('alert_update', { p_alert: input.id, p_body: input.body.trim() }),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
  });
  // Answering an alert opens a one-to-one chat with its sender. Chat needs AYWO Plus: without it the server says so,
  // and the way to Plus is shown under that alert.
  const reply = useMutation({
    mutationFn: (input: { alert: string; sender: string }) => api.rpc<string>('chat_open_direct', { p_other: input.sender }),
    onSuccess: (chatId) => {
      client.invalidateQueries({ queryKey: ['chats'] });
      router.push({ pathname: '/social/chat/[id]', params: { id: chatId } });
    },
  });
  const close = useMutation({
    mutationFn: (input: { id: string; closed: boolean }) => api.rpc('alert_close', { p_alert: input.id, p_closed: input.closed }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.rpc('alert_delete', { p_alert: id }),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
  });

  const unseen = (alerts.data ?? []).filter((a) => !a.seen).map((a) => a.id).join(',');
  useEffect(() => {
    if (unseen) markSeen.mutate(unseen.split(','));
    // Runs only when the list of unseen alerts changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseen]);

  return (
    <Page title={t('social.alerts.title')} subtitle={t('social.alerts.subtitle')}>
      {(counts.data?.incoming_sos ?? []).map((sos) => (
        <Row
          key={sos.id}
          urgent
          title={t('social.home.sosFrom', { name: showName(sos.name) })}
          onPress={() => router.push({ pathname: '/social/sos/watch/[id]', params: { id: sos.id } })}
        />
      ))}
      <PrimaryButton label={t('social.alerts.new')} onPress={() => router.push('/social/alerts/new')} />
      <Gate query={alerts}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState message={t('social.alerts.empty')} />
          ) : (
            <>
              {list.map((a) => (
                <Card key={a.id} style={[styles.card, a.closed && styles.closed]}>
                  <View style={styles.top}>
                    <Text style={styles.kind}>{t(`social.alerts.kinds.${a.kind}`)}</Text>
                    {a.closed ? <Text style={styles.sorted}>{t('social.alerts.sorted')}</Text> : null}
                    {a.blood_group ? <Text style={styles.blood}>{t('social.alerts.bloodNeeded', { group: a.blood_group })}</Text> : null}
                  </View>
                  <Text style={styles.body}>{a.body}</Text>
                  <Note>
                    {a.is_mine
                      ? t('social.alerts.sentTo', { count: a.recipients ?? 0, when: ago(a.created_at) })
                      : t('social.alerts.from', { name: showName(a.sender_name), when: ago(a.created_at) })}
                    {a.edited ? ` · ${t('social.edited')}` : ''}
                  </Note>
                  {!a.is_mine && a.sender_id ? (
                    <View style={styles.actions}>
                      <TextButton
                        label={t('social.alerts.replyInChat')}
                        disabled={reply.isPending}
                        onPress={() => reply.mutate({ alert: a.id, sender: a.sender_id })}
                      />
                    </View>
                  ) : null}
                  {reply.variables?.alert === a.id ? <ActionError error={reply.error} /> : null}
                  {a.is_mine ? (
                    <View style={styles.actions}>
                      <TextButton
                        label={a.closed ? t('social.alerts.reopen') : t('social.alerts.markSorted')}
                        disabled={close.isPending}
                        onPress={() => close.mutate({ id: a.id, closed: !a.closed })}
                      />
                      <TextButton label={t('social.edit')} onPress={() => setEditing({ id: a.id, body: a.body })} />
                      <TextButton label={t('social.delete')} danger onPress={() => setDeleting(a.id)} />
                    </View>
                  ) : null}
                </Card>
              ))}
            </>
          )
        }
      </Gate>
      <ActionError error={close.error ?? remove.error} />
      <ConfirmDialog
        visible={!!editing}
        title={t('social.alerts.editTitle')}
        confirmLabel={t('common.save')}
        busy={update.isPending}
        onConfirm={() => editing && editing.body.trim() && update.mutate(editing)}
        onCancel={() => setEditing(null)}
      >
        {editing ? (
          <>
            <Field label={t('social.alerts.message')} value={editing.body} onChangeText={(body) => setEditing({ ...editing, body })} multiline maxLength={500} />
            {!editing.body.trim() ? <Note>{t('social.missing.message')}</Note> : null}
            <Note>{t('social.alerts.editNote')}</Note>
            <ActionError error={update.error} />
          </>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        visible={!!deleting}
        title={t('social.alerts.deleteTitle')}
        message={t('social.alerts.deleteMessage')}
        confirmLabel={t('social.delete')}
        danger
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6 },
  closed: { opacity: 0.7 },
  sorted: { color: colors.whatsapp, fontFamily: fonts.extrabold, fontSize: 13 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  top: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  kind: { color: colors.alert, fontFamily: fonts.extrabold, fontSize: 14 },
  blood: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 14 },
  body: { color: colors.text, fontFamily: fonts.medium, fontSize: 15, lineHeight: 22 },
});
