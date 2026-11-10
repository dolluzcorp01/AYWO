// Frequently asked questions. Public, grouped, and each answer opens on tap.
import { pricesFor } from '@aywo/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { DownIcon, UpIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, SectionTitle, TopBar } from '@/components/ui';
import { LegalLinks } from '@/legal/LegalLinks';
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

function Question({ group, id }: { group: string; id: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
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
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TopBar title={t('legal.faq.title')} subtitle={t('legal.faq.subtitle')} onBack={close} />
        {GROUPS.map((group) => (
          <View key={group.id} style={styles.group}>
            <SectionTitle>{t(`legal.faq.${group.id}.title`)}</SectionTitle>
            {group.questions.map((id) => (
              <Question key={id} group={group.id} id={id} />
            ))}
          </View>
        ))}
        <LegalLinks current="faq" />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 16, paddingBottom: 24 },
  group: { gap: 8 },
  card: { paddingVertical: 4, paddingHorizontal: 14 },
  question: { minHeight: minTapSize, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  questionText: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 15, lineHeight: 21 },
  answer: { color: colors.muted, fontFamily: fonts.medium, fontSize: 15, lineHeight: 23, paddingBottom: 12 },
});
