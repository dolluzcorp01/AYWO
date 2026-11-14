// One invite or Pop Party: details, RSVP, polls, sharing, the Canva link and premium designs.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Share, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card, ConfirmDialog, Field, Pills, PrimaryButton, SecondaryButton, SectionTitle, SmallButton, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { startOrder } from '@/pay/order';
import { InviteCard } from '@/social/InviteCard';
import { ActionError, Gate, Note, Page, parseDateTime, Row, useName, useWhen } from '@/social/parts';
import { FREE_DESIGNS, PREMIUM_DESIGNS } from '@/social/types';
import type { Design, EventDetail, PollRow, RsvpAnswer } from '@/social/types';
import { colors, fonts } from '@/theme/tokens';

function PollCard({ poll, onVote, busy }: { poll: PollRow; onVote: (option: string) => void; busy: boolean }) {
  const { t } = useTranslation();
  const most = Math.max(...poll.options.map((o) => o.votes), 0);
  return (
    <Card style={styles.card}>
      <SectionTitle>{t(`social.pop.topics.${poll.topic}`)}</SectionTitle>
      {poll.closed ? <Note>{t('social.pop.pollClosed')}</Note> : null}
      {poll.options.map((o) => (
        <Row
          key={o.id}
          title={poll.my_option === o.id ? t('social.pop.yourVote', { label: o.label }) : o.label}
          subtitle={`${t('social.pop.votes', { count: o.votes })}${most > 0 && o.votes === most ? ` · ${t('social.pop.leading')}` : ''}`}
          onPress={poll.closed || busy ? undefined : () => onVote(o.id)}
        />
      ))}
    </Card>
  );
}

export default function InviteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const client = useQueryClient();
  const when = useWhen();
  const showName = useName();
  const [guests, setGuests] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [canva, setCanva] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [place, setPlace] = useState('');
  const [menu, setMenu] = useState('');
  const [paymentNote, setPaymentNote] = useState(false);
  // The host fixes a wrong date, title or place, and takes off someone invited by mistake.
  const [details, setDetails] = useState<{ title: string; date: string; time: string; place: string; note: string } | null>(null);
  const [uninviting, setUninviting] = useState<{ id: string; name: string } | null>(null);

  const key = ['event', id];
  const event = useQuery({ queryKey: key, queryFn: () => api.rpc<EventDetail>('event_detail', { p_event: id }) });
  const refresh = () => {
    client.invalidateQueries({ queryKey: key });
    client.invalidateQueries({ queryKey: ['events'] });
    client.invalidateQueries({ queryKey: ['social-home'] });
  };

  const rsvp = useMutation({
    mutationFn: (answer: RsvpAnswer) => api.rpc('rsvp_set', { p_event: id, p_answer: answer, p_guests: Number(guests) || 0 }),
    onSuccess: refresh,
  });
  const vote = useMutation({
    mutationFn: (input: { poll: string; option: string }) => api.rpc('poll_vote', { p_poll: input.poll, p_option: input.option }),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: () => api.rpc('event_cancel', { p_event: id }),
    onSettled: () => {
      setCancelling(false);
      refresh();
    },
  });
  const saveDetails = useMutation({
    mutationFn: (d: { title: string; date: string; time: string; place: string; note: string }) =>
      api.rpc('event_update', {
        p_event: id,
        p_title: d.title.trim(),
        p_starts_at: parseDateTime(d.date, d.time)?.toISOString() ?? null,
        p_place: d.place.trim() || null,
        p_note: d.note.trim() || null,
      }),
    onSuccess: () => {
      setDetails(null);
      refresh();
    },
  });
  const uninvite = useMutation({
    mutationFn: (profileId: string) => api.rpc('event_remove_invitee', { p_event: id, p_profile: profileId }),
    onSuccess: () => {
      setUninviting(null);
      refresh();
    },
  });
  const saveCanva = useMutation({
    mutationFn: () => api.rpc('event_update', { p_event: id, p_canva_url: canva.trim() }),
    onSuccess: () => {
      setCanva('');
      refresh();
    },
  });
  const setDesign = useMutation({
    mutationFn: (design: Design) => api.rpc('event_set_design', { p_event: id, p_design: design }),
    onSuccess: refresh,
  });
  const buyDesign = useMutation({
    mutationFn: async (design: Design) => {
      const me = await api.get<{ id: string }>('/me');
      return startOrder(
        { product: 'premium_invite', design_id: `${id}:${design}` },
        { description: t('social.invites.buyDescription'), methodLabel: t('social.invites.buyMethod') },
        { profileId: me.id },
      );
    },
    onSuccess: (result) => {
      if (result !== 'cancelled') setPaymentNote(true);
    },
  });
  const decide = useMutation({
    mutationFn: () =>
      api.rpc('pop_party_decide', {
        p_event: id,
        p_starts_at: parseDateTime(date, time)?.toISOString(),
        p_place: place.trim() || null,
        p_menu: menu.trim() || null,
      }),
    onSuccess: refresh,
  });

  return (
    <Page title={event.data?.title ?? t('social.invites.title')}>
      <Gate query={event}>
        {(e) => {
          const shareText = [
            t('social.invites.shareLead', { name: showName(e.host_name), title: e.title }),
            e.starts_at ? when(e.starts_at) : null,
            e.place,
            e.canva_url,
          ]
            .filter(Boolean)
            .join('\n');
          const isPop = e.kind === 'pop_party';
          return (
            <>
              <InviteCard
                design={e.design}
                title={e.title}
                kindLabel={t(`social.invites.kinds.${e.kind}`)}
                lines={[
                  t('social.invites.hostedBy', { name: showName(e.host_name) }),
                  e.starts_at ? when(e.starts_at) : t('social.pop.stillDeciding'),
                  e.place,
                  e.menu,
                  e.note,
                ]}
              />
              {e.cancelled ? <Text style={styles.warning}>{t('social.invites.cancelledLong')}</Text> : null}

              {!e.is_mine && !e.cancelled ? (
                <Card style={styles.card}>
                  <SectionTitle>{t('social.invites.rsvp')}</SectionTitle>
                  <Pills
                    options={(['yes', 'maybe', 'no'] as RsvpAnswer[]).map((a) => ({ value: a, label: t(`social.invites.answers.${a}`) }))}
                    value={e.my_answer}
                    onChange={(a) => rsvp.mutate(a)}
                  />
                  <Field label={t('social.invites.guests')} value={guests} onChangeText={setGuests} keyboardType="number-pad" maxLength={2} />
                  <ActionError error={rsvp.error} />
                </Card>
              ) : null}

              {e.polls.map((poll) => (
                <PollCard key={poll.id} poll={poll} busy={vote.isPending} onVote={(option) => vote.mutate({ poll: poll.id, option })} />
              ))}
              <ActionError error={vote.error} />

              {isPop && e.is_mine && !e.decided && !e.cancelled ? (
                <Card style={styles.card}>
                  <SectionTitle>{t('social.pop.decide')}</SectionTitle>
                  <Field label={t('social.dateLabel')} value={date} onChangeText={setDate} placeholder={t('social.datePlaceholder')} autoCapitalize="none" />
                  <Field label={t('social.timeLabel')} value={time} onChangeText={setTime} placeholder={t('social.timePlaceholder')} autoCapitalize="none" />
                  <Field label={t('social.invites.place')} value={place} onChangeText={setPlace} maxLength={200} />
                  <Field label={t('social.pop.menu')} value={menu} onChangeText={setMenu} maxLength={200} />
                  <ActionError error={decide.error} />
                  <SmallButton label={t('social.pop.settle')} disabled={!parseDateTime(date, time) || decide.isPending} onPress={() => decide.mutate()} />
                </Card>
              ) : null}

              {e.canva_url ? <SecondaryButton label={t('social.invites.seeDesign')} onPress={() => void Linking.openURL(e.canva_url as string)} /> : null}
              <PrimaryButton label={t('social.invites.share')} onPress={() => void Share.share({ message: shareText })} />

              <SectionTitle>{t('social.invites.whoIsComing', { yes: e.yes, invited: e.invited })}</SectionTitle>
              {e.people.map((p) => (
                <Row
                  key={p.profile_id}
                  title={showName(p.name)}
                  subtitle={`${p.answer ? t(`social.invites.answers.${p.answer}`) : t('social.invites.noAnswer')}${p.guests > 0 ? ` · ${t('social.invites.plusGuests', { count: p.guests })}` : ''}${e.is_mine && !e.cancelled ? ` · ${t('social.invites.tapToUninvite')}` : ''}`}
                  onPress={e.is_mine && !e.cancelled ? () => setUninviting({ id: p.profile_id, name: showName(p.name) }) : undefined}
                />
              ))}

              {e.is_mine && !e.cancelled ? (
                <>
                  {!isPop ? (
                    <Card style={styles.card}>
                      <SectionTitle>{t('social.invites.design')}</SectionTitle>
                      <Pills
                        options={[...FREE_DESIGNS, ...e.owned_designs].map((d) => ({ value: d, label: t(`social.invites.designs.${d}`) }))}
                        value={e.design}
                        onChange={(d) => setDesign.mutate(d)}
                      />
                      <SectionTitle>{t('social.invites.premium')}</SectionTitle>
                      <Note>{t('social.invites.premiumNote')}</Note>
                      {PREMIUM_DESIGNS.filter((d) => !e.owned_designs.includes(d)).map((d) => (
                        <View key={d} style={styles.premium}>
                          <InviteCard design={d} title={t(`social.invites.designs.${d}`)} />
                          {e.spare_designs > 0 ? (
                            <SmallButton label={t('social.invites.useBought')} onPress={() => setDesign.mutate(d)} disabled={setDesign.isPending} />
                          ) : (
                            <SmallButton label={t('social.invites.buy')} kind="yellow" onPress={() => buyDesign.mutate(d)} disabled={buyDesign.isPending} />
                          )}
                        </View>
                      ))}
                      {paymentNote ? <Note>{t('social.invites.paymentWait')}</Note> : null}
                      {paymentNote ? <TextButton label={t('social.invites.checkPayment')} onPress={refresh} /> : null}
                      <ActionError error={setDesign.error ?? buyDesign.error} />
                      <Field label={t('social.invites.canvaLink')} value={canva} onChangeText={setCanva} autoCapitalize="none" placeholder={t('social.invites.canvaPlaceholder')} />
                      <ActionError error={saveCanva.error} />
                      <SmallButton label={t('social.invites.saveCanva')} kind="plain" disabled={!canva.trim() || saveCanva.isPending} onPress={() => saveCanva.mutate()} />
                    </Card>
                  ) : null}
                  {!isPop || e.starts_at ? (
                    <SecondaryButton
                      label={t('social.invites.editDetails')}
                      onPress={() => {
                        const at = e.starts_at ? new Date(e.starts_at) : null;
                        const two = (n: number) => String(n).padStart(2, '0');
                        setDetails({
                          title: e.title,
                          date: at ? `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}` : '',
                          time: at ? `${two(at.getHours())}:${two(at.getMinutes())}` : '',
                          place: e.place ?? '',
                          note: e.note ?? '',
                        });
                      }}
                    />
                  ) : null}
                  <TextButton label={t('social.invites.cancel')} danger onPress={() => setCancelling(true)} />
                </>
              ) : null}
            </>
          );
        }}
      </Gate>
      <ConfirmDialog
        visible={!!details}
        title={t('social.invites.editDetails')}
        confirmLabel={t('common.save')}
        busy={saveDetails.isPending}
        onConfirm={() => details && details.title.trim() && parseDateTime(details.date, details.time) && saveDetails.mutate(details)}
        onCancel={() => setDetails(null)}
      >
        {details ? (
          <>
            <Field label={t('social.invites.titleField')} value={details.title} onChangeText={(v) => setDetails({ ...details, title: v })} maxLength={120} />
            <Field label={t('social.dateLabel')} value={details.date} onChangeText={(v) => setDetails({ ...details, date: v })} placeholder={t('social.datePlaceholder')} autoCapitalize="none" />
            <Field label={t('social.timeLabel')} value={details.time} onChangeText={(v) => setDetails({ ...details, time: v })} placeholder={t('social.timePlaceholder')} autoCapitalize="none" />
            {!parseDateTime(details.date, details.time) ? <Note>{t('social.missing.when')}</Note> : null}
            <Field label={t('social.invites.place')} value={details.place} onChangeText={(v) => setDetails({ ...details, place: v })} maxLength={200} />
            <Field label={t('social.invites.note')} value={details.note} onChangeText={(v) => setDetails({ ...details, note: v })} multiline maxLength={1000} />
            <Note>{t('social.invites.editTellsEveryone')}</Note>
            <ActionError error={saveDetails.error} />
          </>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        visible={!!uninviting}
        title={t('social.invites.uninviteTitle', { name: uninviting?.name ?? '' })}
        message={t('social.invites.uninviteMessage')}
        confirmLabel={t('social.invites.uninvite')}
        danger
        busy={uninvite.isPending}
        onConfirm={() => uninviting && uninvite.mutate(uninviting.id)}
        onCancel={() => setUninviting(null)}
      >
        <ActionError error={uninvite.error} />
      </ConfirmDialog>
      <ConfirmDialog
        visible={cancelling}
        title={t('social.invites.cancelTitle')}
        message={t('social.invites.cancelBody')}
        confirmLabel={t('social.invites.cancel')}
        danger
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onCancel={() => setCancelling(false)}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  premium: { gap: 8 },
  warning: { color: colors.alert, fontFamily: fonts.bold, fontSize: 15 },
});
