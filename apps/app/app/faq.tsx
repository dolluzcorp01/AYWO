// Frequently asked questions. Public, grouped, and each answer opens on tap.
// The search box at the top finds the questions that fit what was typed; see faqSearch.ts for how.
import { pricesFor } from '@aywo/shared';
import { useRouter } from '@/lib/router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { DownIcon, UpIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, Field, SectionTitle, SmallButton, TextButton, TopBar } from '@/components/ui';
import { FAQ_GROUPS as GROUPS } from '@/legal/faqGroups';
import { LegalLinks } from '@/legal/LegalLinks';
import { type FaqEntry, searchFaq } from '@/legal/faqSearch';
import { usePublisher } from '@/legal/usePublisher';
import { useAppConfig } from '@/ops/appConfig';
import { colors, fonts, minTapSize } from '@/theme/tokens';


const india = pricesFor('razorpay');
const abroad = pricesFor('stripe');
const PRICES = {
  monthlyIndia: india.monthly.display,
  yearlyIndia: india.yearly.display,
  monthlyAbroad: abroad.monthly.display,
  yearlyAbroad: abroad.yearly.display,
};

// A question staff added in Admin > App settings is kept under "added.<id>"; the built-in ones are "<group>.<id>".
const ADDED = 'added';

function Question({ entry, startOpen }: { entry: FaqEntry; startOpen?: boolean }) {
  const [open, setOpen] = useState(!!startOpen);
  const Icon = open ? UpIcon : DownIcon;
  return (
    <Card style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.question}>
        <Text style={styles.questionText}>{entry.question}</Text>
        <Icon color={colors.text} size={18} />
      </Pressable>
      {open ? <Text style={styles.answer}>{entry.answer}</Text> : null}
    </Card>
  );
}

export default function Faq() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const [search, setSearch] = useState('');
  const publisher = usePublisher().words;
  const saved = useAppConfig().data?.faq;
  const tamil = i18n.language.startsWith('ta');
  // Every question with its answer and search words, in the language on screen: the built-in ones staff have not
  // hidden, then the ones staff added to that group. An added question with no Tamil shows in English.
  const byGroup = useMemo<{ id: string; entries: FaqEntry[] }[]>(() => {
    const words = { ...publisher, ...PRICES };
    const hidden = new Set(saved?.hidden ?? []);
    return GROUPS.map((group) => ({
      id: group.id,
      entries: [
        ...group.questions
          .filter((id) => !hidden.has(`${group.id}.${id}`))
          .map((id) => ({
            key: `${group.id}.${id}`,
            question: t(`legal.faq.${group.id}.${id}Q`, words),
            answer: t(`legal.faq.${group.id}.${id}A`, words),
            keywords: t(`legal.faq.${group.id}.${id}K`, { defaultValue: '' }),
          })),
        ...(saved?.items ?? [])
          .filter((item) => item.group === group.id && item.q?.en && item.a?.en)
          .map((item) => ({
            key: `${ADDED}.${item.id}`,
            question: (tamil && item.q.ta?.trim()) || item.q.en,
            answer: (tamil && item.a.ta?.trim()) || item.a.en,
            keywords: '',
          })),
      ],
    }));
  }, [t, publisher, saved, tamil]);
  const entries = useMemo(() => byGroup.flatMap((group) => group.entries), [byGroup]);
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
          byGroup
            .filter((group) => group.entries.length > 0)
            .map((group) => (
              <View key={group.id} style={styles.group}>
                <SectionTitle>{t(`legal.faq.${group.id}.title`)}</SectionTitle>
                {group.entries.map((entry) => (
                  <Question key={entry.key} entry={entry} />
                ))}
              </View>
            ))
        ) : found.length ? (
          <View style={styles.group}>
            <SectionTitle>{t('legal.faq.results')}</SectionTitle>
            {/* The best fit is shown already open, so one word typed is often the whole job. */}
            {found.map((entry, index) => (
              <Question key={`${entry.key}:${index === 0}`} entry={entry} startOpen={index === 0} />
            ))}
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
