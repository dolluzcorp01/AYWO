// P3 Pop Party: a quick plan. Put dates, places and food to a vote among family and friends only.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { Field, PrimaryButton } from '@/components/ui';
import { api } from '@/lib/api';
import { AudiencePicker } from '@/social/AudiencePicker';
import { ActionError, lines, Note, Page } from '@/social/parts';
import type { Audience } from '@/social/types';

export default function NewPopParty() {
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const [title, setTitle] = useState('');
  const [dates, setDates] = useState('');
  const [venues, setVenues] = useState('');
  const [menus, setMenus] = useState('');
  const [note, setNote] = useState('');
  const [audience, setAudience] = useState<Audience | null>(null);

  const hasOptions = lines(dates).length + lines(venues).length + lines(menus).length > 0;
  const create = useMutation({
    mutationFn: () =>
      api.rpc<string>('pop_party_create', {
        p_title: title.trim(),
        p_audience: audience,
        p_dates: lines(dates),
        p_venues: lines(venues),
        p_menus: lines(menus),
        p_note: note.trim() || null,
      }),
    onSuccess: (id) => {
      client.invalidateQueries({ queryKey: ['events'] });
      router.replace({ pathname: '/social/invites/[id]', params: { id } });
    },
  });

  return (
    <Page title={t('social.pop.new')} subtitle={t('social.pop.subtitle')}>
      <Field label={t('social.pop.name')} value={title} onChangeText={setTitle} maxLength={120} />
      <Note>{t('social.pop.oneEachLine')}</Note>
      <Field label={t('social.pop.topics.date')} value={dates} onChangeText={setDates} multiline style={styles.tall} placeholder={t('social.pop.datesPlaceholder')} />
      <Field label={t('social.pop.topics.venue')} value={venues} onChangeText={setVenues} multiline style={styles.tall} placeholder={t('social.pop.venuesPlaceholder')} />
      <Field label={t('social.pop.topics.menu')} value={menus} onChangeText={setMenus} multiline style={styles.tall} placeholder={t('social.pop.menusPlaceholder')} />
      <Field label={t('social.invites.note')} value={note} onChangeText={setNote} multiline maxLength={1000} />
      <AudiencePicker onChange={setAudience} />
      <Note>{t('social.pop.familyFriendsOnly')}</Note>
      <ActionError error={create.error} />
      <PrimaryButton
        label={create.isPending ? t('social.sending') : t('social.pop.start')}
        disabled={create.isPending}
        missing={!title.trim() ? t('social.missing.name') : !hasOptions ? t('social.missing.options') : !audience ? t('social.missing.whoSend') : null}
        onPress={() => create.mutate()}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  tall: { minHeight: 88, paddingTop: 14, textAlignVertical: 'top' },
});
