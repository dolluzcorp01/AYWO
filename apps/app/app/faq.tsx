// Frequently asked questions. Public, grouped, and each answer opens on tap.
// The search box at the top finds the questions that fit what was typed; see faqSearch.ts for how.
import { pricesFor } from '@aywo/shared';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { DownIcon, UpIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, Field, SectionTitle, SmallButton, TextButton, TopBar } from '@/components/ui';
import { LegalLinks } from '@/legal/LegalLinks';
import { type FaqEntry, searchFaq } from '@/legal/faqSearch';
import { PUBLISHER } from '@/legal/publisher';
import { colors, fonts, minTapSize } from '@/theme/tokens';

const GROUPS: { id: string; questions: string[] }[] = [
  { id: 'start', questions: ['what', 'free', 'signIn', 'devices', 'language', 'importing'] },
  { id: 'tree', questions: ['whoSees', 'roles', 'noAccount', 'wrong', 'outsider', 'download'] },
  { id: 'safety', questions: ['number', 'remove', 'sos', 'sell', 'children'] },
  { id: 'plus', questions: ['includes', 'price', 'trial', 'family', 'pay', 'cancel', 'refund', 'failed'] },
  { id: 'orders', questions: ['what', 'delivery', 'damaged'] },
  { id: 'account', questions: ['delete', 'help'] },
];

const india = pricesFor('razorpay');
const abroad = pricesFor('stripe');
const WORDS = {
  ...PUBLISHER,
  monthlyIndia: india.monthly.display,
  yearlyIndia: india.yearly.display,
  monthlyAbroad: abroad.monthly.display,
  yearlyAbroad: abroad.yearly.display,
};

function Question({ group, id, startOpen }: { group: string; id: string; startOpen?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(!!startOpen);
  const Icon = open ? UpIcon : DownIcon;
  return (
    <Card style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.question}>
        <Text style={styles.questionText}>{t(`legal.faq.${group}.${id}Q`, WORDS)}</Text>
        <Icon color={colors.text} size={18} />
      </Pressable>
      {open ? <Text style={styles.answer}>{t(`legal.faq.${group}.${id}A`, WORDS)}</Text> : null}
    </Card>
  );
}

export default function Faq() {
  const { t } = useTranslation();
  const router = useRouter();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const [search, setSearch] = useState('');
  // Every question with its answer and search words, in the language on screen.
  const entries = useMemo<FaqEntry[]>(
    () =>
      GROUPS.flatMap((group) =>
        group.questions.map((id) => ({
          key: `${group.id}.${id}`,
          question: t(`legal.faq.${group.id}.${id}Q`, WORDS),
          answer: t(`legal.faq.${group.id}.${id}A`, WORDS),
          keywords: t(`legal.faq.${group.id}.${id}K`, { defaultValue: '' }),
        })),
      ),
    [t],
  );
  const searching = search.trim().length > 0;
  const found = useMemo(() => (searching ? searchFaq(entries, search) : []), [entries, search, searching]);
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TopBar title={t('legal.faq.title')} subtitle={t('legal.faq.subtitle')} onBack={close} />
        {/* Clear sits beside the box, not inside it: putting it inside rebuilt the box on the first letter typed,
            which took the cursor out of it. */}
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Field
              value={search}
              onChangeText={setSearch}
              placeholder={t('legal.faq.searchHint')}
              accessibilityLabel={t('legal.faq.search')}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              maxLength={80}
            />
          </View>
          {searching ? <TextButton label={t('legal.faq.clear')} onPress={() => setSearch('')} /> : null}
        </View>
        {!searching ? (
          GROUPS.map((group) => (
            <View key={group.id} style={styles.group}>
              <SectionTitle>{t(`legal.faq.${group.id}.title`)}</SectionTitle>
              {group.questions.map((id) => (
                <Question key={id} group={group.id} id={id} />
              ))}
            </View>
          ))
        ) : found.length ? (
          <View style={styles.group}>
            <SectionTitle>{t('legal.faq.results')}</SectionTitle>
            {found.map((entry, index) => {
              const [group, id] = entry.key.split('.');
              // The best fit is shown already open, so one word typed is often the whole job.
              return <Question key={`${entry.key}:${index === 0}`} group={group} id={id} startOpen={index === 0} />;
            })}
            <TextButton label={t('legal.faq.showAll')} onPress={() => setSearch('')} />
          </View>
        ) : (
          <View style={styles.none}>
            <Text style={styles.noneText}>{t('legal.faq.noMatch')}</Text>
            <View style={styles.noneButtons}>
              <SmallButton label={t('legal.contactLink')} onPress={() => router.push('/contact')} />
              <SmallButton kind="plain" label={t('legal.faq.showAll')} onPress={() => setSearch('')} />
            </View>
          </View>
        )}
        <LegalLinks current="faq" />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 16, paddingBottom: 24 },
  group: { gap: 8 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchBox: { flex: 1, minWidth: 0 },
  none: { gap: 12, alignItems: 'center', paddingVertical: 24 },
  noneText: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  noneButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  card: { paddingVertical: 4, paddingHorizontal: 14 },
  question: { minHeight: minTapSize, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  questionText: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 15, lineHeight: 21 },
  answer: { color: colors.muted, fontFamily: fonts.medium, fontSize: 15, lineHeight: 23, paddingBottom: 12 },
});
