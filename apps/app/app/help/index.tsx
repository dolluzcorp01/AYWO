// Help centre: quick answers first, then a question to AYWO Support. Answers come back here and as a notification.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card, Field, Pills, PrimaryButton, SectionTitle, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { useTimeAgo } from '@/lib/time';
import { ActionError, Gate, Note, Page, Row } from '@/social/parts';
import { TICKET_CATEGORIES as CATEGORIES } from '@/ops/types';
import type { Ticket, TicketCategory as Category } from '@/ops/types';
import { colors, fonts } from '@/theme/tokens';

export default function HelpCentre() {
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const ago = useTimeAgo();
  const tickets = useQuery({ queryKey: ['tickets'], queryFn: () => api.rpc<Ticket[]>('ticket_list') });
  const [writing, setWriting] = useState(false);
  const [category, setCategory] = useState<Category | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const create = useMutation({
    mutationFn: () => api.rpc<Ticket>('ticket_create', { p_subject: subject.trim(), p_category: category, p_body: body.trim() }),
    onSuccess: (ticket) => {
      client.invalidateQueries({ queryKey: ['tickets'] });
      setWriting(false);
      setSubject('');
      setBody('');
      setCategory(null);
      router.push({ pathname: '/help/[id]', params: { id: ticket.id } });
    },
  });

  return (
    <Page title={t('ops.help.title')} subtitle={t('ops.help.subtitle')}>
      <Card style={styles.block}>
        <SectionTitle>{t('ops.help.quick')}</SectionTitle>
        <TextButton label={t('ops.help.faq')} onPress={() => router.push('/faq')} />
        <TextButton label={t('ops.help.sos')} onPress={() => router.push('/social/sos')} />
        <TextButton label={t('ops.help.privacy')} onPress={() => router.push('/settings/privacy')} />
      </Card>

      {writing ? (
        <Card style={styles.block}>
          <SectionTitle>{t('ops.help.newTitle')}</SectionTitle>
          <Note>{t('ops.help.topic')}</Note>
          <Pills options={CATEGORIES.map((c) => ({ value: c, label: t(`help.categories.${c}`) }))} value={category} onChange={setCategory} />
          {category === 'safety' ? <Text style={styles.urgent}>{t('ops.help.safetyNote')}</Text> : null}
          <Field label={t('ops.help.subject')} value={subject} onChangeText={setSubject} maxLength={120} />
          <Field label={t('ops.help.body')} value={body} onChangeText={setBody} maxLength={4000} multiline />
          <ActionError error={create.error} />
          <PrimaryButton
            label={t('ops.help.send')}
            disabled={!category || subject.trim().length < 3 || !body.trim() || create.isPending}
            onPress={() => create.mutate()}
          />
          <TextButton label={t('social.cancel')} onPress={() => setWriting(false)} />
        </Card>
      ) : (
        <PrimaryButton label={t('ops.help.ask')} onPress={() => setWriting(true)} />
      )}

      <SectionTitle>{t('ops.help.yours')}</SectionTitle>
      <Gate query={tickets}>
        {(list) =>
          list.length === 0 ? (
            <Note>{t('ops.help.none')}</Note>
          ) : (
            <View style={styles.list}>
              {list.map((ticket) => (
                <Row
                  key={ticket.id}
                  title={ticket.subject}
                  subtitle={`${t(`ops.help.status.${ticket.status}`)} · ${ago(ticket.updated_at)}`}
                  urgent={ticket.status === 'waiting'}
                  onPress={() => router.push({ pathname: '/help/[id]', params: { id: ticket.id } })}
                />
              ))}
            </View>
          )
        }
      </Gate>
    </Page>
  );
}

const styles = StyleSheet.create({
  block: { gap: 10 },
  list: { gap: 8 },
  urgent: { color: colors.alert, fontFamily: fonts.bold, fontSize: 14, lineHeight: 20 },
});
