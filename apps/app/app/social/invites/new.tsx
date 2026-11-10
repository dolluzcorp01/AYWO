// New invite. Everyone invited comes from the sender's own tree or groups.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';
import { Field, Label, Pills, PrimaryButton, SecondaryButton } from '@/components/ui';
import { api } from '@/lib/api';
import { AudiencePicker } from '@/social/AudiencePicker';
import { InviteCard } from '@/social/InviteCard';
import { ActionError, Note, Page, parseDateTime } from '@/social/parts';
import { EVENT_KINDS, FREE_DESIGNS } from '@/social/types';
import type { Audience, Design, EventKind } from '@/social/types';

const CANVA_START = 'https://www.canva.com/create/invitations/';

export default function NewInvite() {
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const [kind, setKind] = useState<EventKind | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [place, setPlace] = useState('');
  const [note, setNote] = useState('');
  const [canva, setCanva] = useState('');
  const [design, setDesign] = useState<Design>('classic');
  const [audience, setAudience] = useState<Audience | null>(null);

  const startsAt = parseDateTime(date, time);
  const canvaOk = canva.trim() === '' || /^https:\/\/(www\.)?canva\.(com|link)\//.test(canva.trim());

  const create = useMutation({
    mutationFn: () =>
      api.rpc<string>('event_create', {
        p_kind: kind,
        p_title: title.trim(),
        p_starts_at: startsAt?.toISOString(),
        p_audience: audience,
        p_place: place.trim() || null,
        p_note: note.trim() || null,
        p_canva_url: canva.trim() || null,
        p_design: design,
      }),
    onSuccess: (id) => {
      client.invalidateQueries({ queryKey: ['events'] });
      client.invalidateQueries({ queryKey: ['social-home'] });
      router.replace({ pathname: '/social/invites/[id]', params: { id } });
    },
  });

  return (
    <Page title={t('social.invites.new')}>
      <Label>{t('social.invites.kind')}</Label>
      <Pills options={EVENT_KINDS.map((k) => ({ value: k as EventKind, label: t(`social.invites.kinds.${k}`) }))} value={kind} onChange={setKind} />
      <Field label={t('social.invites.titleField')} value={title} onChangeText={setTitle} maxLength={120} />
      <Field label={t('social.dateLabel')} value={date} onChangeText={setDate} placeholder={t('social.datePlaceholder')} autoCapitalize="none" />
      <Field label={t('social.timeLabel')} value={time} onChangeText={setTime} placeholder={t('social.timePlaceholder')} autoCapitalize="none" />
      {date && time && !startsAt ? <Note>{t('social.dateHelp')}</Note> : null}
      <Field label={t('social.invites.place')} value={place} onChangeText={setPlace} maxLength={200} />
      <Field label={t('social.invites.note')} value={note} onChangeText={setNote} multiline maxLength={1000} />

      <Label>{t('social.invites.design')}</Label>
      <Pills options={FREE_DESIGNS.map((d) => ({ value: d, label: t(`social.invites.designs.${d}`) }))} value={design} onChange={setDesign} />
      <InviteCard design={design} title={title || t('social.invites.titleField')} kindLabel={kind ? t(`social.invites.kinds.${kind}`) : ''} />
      <Note>{t('social.invites.premiumLater')}</Note>

      <SecondaryButton label={t('social.invites.openCanva')} onPress={() => void Linking.openURL(CANVA_START)} />
      <Field label={t('social.invites.canvaLink')} value={canva} onChangeText={setCanva} autoCapitalize="none" placeholder={t('social.invites.canvaPlaceholder')} />
      {!canvaOk ? <Note>{t('social.invites.canvaHelp')}</Note> : null}

      <AudiencePicker onChange={setAudience} />
      <ActionError error={create.error} />
      <PrimaryButton
        label={create.isPending ? t('social.sending') : t('social.invites.send')}
        disabled={!kind || !title.trim() || !startsAt || !audience || !canvaOk || create.isPending}
        onPress={() => create.mutate()}
      />
    </Page>
  );
}
