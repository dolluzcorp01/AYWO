// B2 / S-04: 'Is this you?' A person's number matched someone saved in a family tree.
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, ErrorText, Loading, LoadFailed, Muted, NeonPanel, PrimaryButton, SecondaryButton } from '@/components/ui';
import { claimDetails, firstName, rememberNotMe } from '@/lib/account';
import { api } from '@/lib/api';
import { useErrorText } from '@/lib/errors';
import { colors, fonts } from '@/theme/tokens';

export default function IsThisYou() {
  const { t } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const { next, name } = useLocalSearchParams<{ next?: string; name?: string }>();
  const candidates = useQuery({ queryKey: ['claim-candidates'], queryFn: claimDetails, gcTime: 0 });
  // T-ACC-03: one number can match several people. They answer one at a time.
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const list = candidates.data;
  const candidate = list?.[index];

  function carryOn(params: { next?: string; name?: string }) {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => !!v)) as Record<string, string>;
    router.replace({ pathname: '/after-login', params: clean });
  }

  useEffect(() => {
    if (list && !candidate) carryOn({ next, name });
    // Only when the answers run out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, candidate]);

  async function yes() {
    if (!candidate) return;
    setBusy(true);
    setFailure(null);
    try {
      const treeId = await api.rpc<string>('claim_confirm', { p_person: candidate.person_id });
      // Back through the one place that decides, so a nameless account still gets the profile step.
      carryOn({ next: next ?? `/tree/${treeId}`, name: candidate.display_name });
    } catch (error) {
      setFailure(error);
      setBusy(false);
    }
  }

  async function notMe() {
    if (!candidate) return;
    setBusy(true);
    await rememberNotMe(candidate.person_id).catch(() => undefined);
    setBusy(false);
    setIndex(index + 1);
  }

  if (candidates.isError) {
    return (
      <Screen>
        <LoadFailed message={errorText(candidates.error)} onRetry={() => candidates.refetch()} />
      </Screen>
    );
  }
  if (!candidate) {
    return (
      <Screen>
        <Loading label={t('tree.loading')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <NeonPanel style={styles.panel}>
          <Text style={styles.eyebrow}>{t('claim.familyHere')}</Text>
          <Avatar personId={candidate.person_id} size={116} photoUrl={candidate.photo_url} ring />
          <Text accessibilityRole="header" style={styles.question}>{t('claim.isThisYou')}</Text>
          <Text style={styles.name}>{candidate.display_name}</Text>
        </NeonPanel>
        <Card style={styles.facts}>
          {candidate.parents.length > 0 ? <Fact text={t('claim.childOf', { names: candidate.parents.join(' & ') })} /> : null}
          {candidate.partners.length > 0 ? (
            <Fact text={t(candidate.married ? 'claim.marriedTo' : 'claim.partnerOf', { names: candidate.partners.join(', ') })} />
          ) : null}
          <Fact text={t('claim.inFamilyPeople', { tree: candidate.tree_name, count: candidate.people })} />
        </Card>
        <Muted>
          {candidate.added_by
            ? t('claim.explainBy', { name: candidate.added_by, first: firstName(candidate.added_by) })
            : t('claim.explain')}
        </Muted>
        {failure ? <ErrorText>{errorText(failure)}</ErrorText> : null}
      </ScrollView>
      <View style={styles.buttons}>
        <PrimaryButton label={t('claim.yes')} onPress={yes} disabled={busy} />
        <SecondaryButton label={t('claim.notMe')} onPress={notMe} disabled={busy} />
      </View>
    </Screen>
  );
}

function Fact({ text }: { text: string }) {
  return (
    <View style={styles.fact}>
      <View style={styles.dot} />
      <Text style={styles.factText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 14, paddingTop: 20, paddingBottom: 16 },
  panel: { alignItems: 'center', gap: 12 },
  eyebrow: { color: colors.logoYellow, fontFamily: fonts.extrabold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  question: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 30, letterSpacing: -0.8 },
  name: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 18, textAlign: 'center' },
  facts: { gap: 10 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.logoPurple },
  factText: { flex: 1, color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
  buttons: { gap: 10 },
});
