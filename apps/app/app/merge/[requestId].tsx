// E5: 'Same person?' Two cards side by side, why AYWO thinks so, and one decision. Merging can be undone from History.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Avatar } from '@/components/Avatar';
import { CheckIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, EmptyState, ErrorText, Loading, LoadFailed, Muted, NeonPanel, PrimaryButton, TextButton, TopBar } from '@/components/ui';
import { useErrorText } from '@/lib/errors';
import { useApplyMerge, useDecideRequest, useMerge } from '@/tree/useEdit';
import type { MergePerson } from '@/tree/useEdit';
import { colors, fonts } from '@/theme/tokens';

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function shared(a: string[], b: string[]): string | undefined {
  return a.find((x) => b.some((y) => same(x, y)));
}

export default function MergeScreen() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const merge = useMerge(requestId);
  const apply = useApplyMerge(requestId);
  const decide = useDecideRequest();

  if (merge.isError) {
    return (
      <Screen>
        <TopBar title={t('merge.title')} onBack={() => goBack(router)} />
        <LoadFailed message={errorText(merge.error)} onRetry={() => merge.refetch()} />
      </Screen>
    );
  }
  if (!merge.data) {
    return (
      <Screen>
        <Loading label={t('tree.loading')} />
      </Screen>
    );
  }

  const [a, b] = merge.data.people;
  if (!a || !b || a.deleted || b.deleted || merge.data.status !== 'pending') {
    return (
      <Screen>
        <TopBar title={t('merge.title')} onBack={() => goBack(router)} />
        <EmptyState message={t('merge.alreadyDecided')} />
      </Screen>
    );
  }

  // Why AYWO thinks so, in plain words, from what the two entries share.
  const reasons: string[] = [];
  const partner = shared(a.partners, b.partners);
  const parent = shared(a.parents, b.parents);
  if (partner) reasons.push(t('merge.bothPartner', { name: partner }));
  if (parent) reasons.push(t('merge.bothChild', { name: parent }));
  if (same(a.display_name, b.display_name)) reasons.push(t('merge.namesMatch'));
  else reasons.push(t('merge.namesClose'));

  const busy = apply.isPending || decide.isPending;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TopBar title={t('merge.title')} onBack={() => goBack(router)} />
        <View style={styles.sides}>
          <Side person={a} />
          <Side person={b} />
          <View style={styles.equals}>
            <Text style={styles.equalsText}>=?</Text>
          </View>
        </View>
        <NeonPanel style={styles.why}>
          <Text style={styles.whyTitle}>{t('merge.why')}</Text>
          {reasons.map((reason) => (
            <View key={reason} style={styles.reason}>
              <View style={styles.reasonTick}>
                <CheckIcon color={colors.white} size={14} width={3} />
              </View>
              <Text style={styles.reasonText}>{reason}</Text>
            </View>
          ))}
        </NeonPanel>
        <Muted>{t('merge.explain', { name: a.display_name })}</Muted>
        {apply.isError ? <ErrorText>{errorText(apply.error)}</ErrorText> : null}
        {decide.isError ? <ErrorText>{errorText(decide.error)}</ErrorText> : null}
      </ScrollView>
      <PrimaryButton label={t('merge.yes')} disabled={busy} onPress={() => apply.mutate(undefined, { onSuccess: () => goBack(router) })} />
      <TextButton
        label={t('merge.no')}
        disabled={busy}
        onPress={() => decide.mutate({ requestId, decision: 'decline' }, { onSuccess: () => goBack(router) })}
      />
    </Screen>
  );
}

function Side({ person }: { person: MergePerson }) {
  const { t } = useTranslation();
  return (
    <Card style={styles.side}>
      <Avatar personId={person.id} size={72} photoUrl={person.photo_url} nameUnknown={person.name_unknown} />
      <Text style={styles.sideName}>{person.name_unknown ? t('tree.nameNotKnown') : person.display_name}</Text>
      {person.added_by ? <Text style={styles.sideNote}>{t('merge.addedBy', { name: person.added_by })}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 14, paddingBottom: 12 },
  sides: { flexDirection: 'row', gap: 10 },
  side: { flex: 1, alignItems: 'center', gap: 8, borderRadius: 22, minWidth: 0 },
  sideName: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15, textAlign: 'center' },
  sideNote: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12, textAlign: 'center' },
  equals: {
    position: 'absolute',
    left: '50%',
    marginLeft: -20,
    top: 36,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: colors.white,
    backgroundColor: colors.logoPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  equalsText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 13 },
  why: { gap: 10 },
  whyTitle: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 16 },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reasonTick: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.glass, alignItems: 'center', justifyContent: 'center' },
  reasonText: { flex: 1, color: colors.white, fontFamily: fonts.bold, fontSize: 14 },
});
