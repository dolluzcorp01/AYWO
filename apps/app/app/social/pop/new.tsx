// P3 Pop Party: a quick plan. Put dates, places and food to a vote among family and friends only.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/lib/router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { DateField, TimeField } from '@/components/DateTimeField';
import { ConfirmDialog, Field, Label, PrimaryButton, SecondaryButton } from '@/components/ui';
import { api } from '@/lib/api';
import { AudiencePicker } from '@/social/AudiencePicker';
import { ActionError, lines, Note, Page, Row, todayIso, useDateOption } from '@/social/parts';
import { DateTimeRow } from '@/components/DateTimeRow';
import type { Audience } from '@/social/types';

export default function NewPopParty() {
  const { t } = useTranslation();
  const router = useRouter();
  const client = useQueryClient();
  const [title, setTitle] = useState('');
  // Date choices are picked from the calendar, not typed: each is kept as '2026-12-25' or '2026-12-25 18:30'.
  const [dates, setDates] = useState<string[]>([]);
  const [pickDate, setPickDate] = useState('');
  const [pickTime, setPickTime] = useState('');
  const showDate = useDateOption();
  const [venues, setVenues] = useState('');
  const [menus, setMenus] = useState('');
  const [note, setNote] = useState('');
  const [audience, setAudience] = useState<Audience | null>(null);
  const [asking, setAsking] = useState(false);

  const picked = pickDate ? (pickTime ? `${pickDate} ${pickTime.padStart(5, '0')}` : pickDate) : null;
  // A date picked but not yet added still counts: pressing Start must not quietly lose it.
  const allDates = picked && !dates.includes(picked) ? [...dates, picked] : dates;
  const hasOptions = allDates.length + lines(venues).length + lines(menus).length > 0;
  function addDate() {
    setDates(allDates);
    setPickDate('');
    setPickTime('');
  }
  const create = useMutation({
    mutationFn: () =>
      api.rpc<string>('pop_party_create', {
        p_title: title.trim(),
        p_audience: audience,
        p_dates: allDates,
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
      <Label>{t('social.pop.dateChoices')}</Label>
      {dates.map((d) => (
        <Row key={d} title={showDate(d)} subtitle={t('social.tapToRemove')} onPress={() => setDates(dates.filter((x) => x !== d))} />
      ))}
      <DateTimeRow>
        <DateField label={t('social.dateLabel')} value={pickDate} onChange={setPickDate} min={todayIso()} optional />
        {pickDate ? <TimeField label={t('social.pop.timeOptional')} value={pickTime} onChange={setPickTime} optional /> : null}
      </DateTimeRow>
      {pickDate ? <SecondaryButton label={t('social.pop.addDate')} onPress={addDate} /> : null}
      <Note>{t('social.pop.oneEachLine')}</Note>
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
        onPress={() => setAsking(true)}
      />
      {/* It goes to everyone at once and cannot be called back unseen, so one look before it leaves. */}
      <ConfirmDialog
        visible={asking}
        title={t('social.sendAsk.title')}
        message={t(audience?.type === 'tree' ? 'social.sendAsk.wholeTree' : 'social.sendAsk.chosen')}
        confirmLabel={t('social.sendAsk.yes')}
        busy={create.isPending}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          create.mutate();
        }}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  tall: { minHeight: 88, paddingTop: 14, textAlignVertical: 'top' },
});
