// Home cards that bring people back for good reasons: family birthdays and anniversaries coming up, and a memory
// from this day in an earlier year.
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { PhotoIcon } from '@/components/Icons';
import { Text } from '@/components/Text';
import { api } from '@/lib/api';
import { firstName } from '@/lib/account';
import type { FamilyDate, OnThisDay } from '@/ops/types';
import { colors, fonts, radius, shadows } from '@/theme/tokens';

export function FamilyDates() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const dates = useQuery({ queryKey: ['family-dates'], queryFn: () => api.rpc<FamilyDate[]>('upcoming_dates', { p_days: 30 }), staleTime: 30 * 60_000 });
  const list = (dates.data ?? []).slice(0, 8);
  if (list.length === 0) return null;
  const when = (d: FamilyDate) =>
    d.days === 0 ? t('ops.dates.today') : d.days === 1 ? t('ops.dates.tomorrow') : new Date(`${d.date}T00:00:00`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
  return (
    <View style={styles.block}>
      <View style={styles.headRow}>
        <Text accessibilityRole="header" style={styles.section}>{t('ops.dates.title')}</Text>
        <Pressable accessibilityRole="button" onPress={() => router.push('/calendar')} hitSlop={10}>
          <Text style={styles.seeAll}>{t('calendar.seeAll')}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {list.map((d) => (
          <Pressable
            key={`${d.kind}-${d.person_id}`}
            accessibilityRole="button"
            accessibilityLabel={`${d.kind === 'birthday' ? t('ops.dates.birthday', { name: d.name }) : t('ops.dates.anniversary', { names: d.name })}, ${when(d)}`}
            onPress={() => router.push({ pathname: '/person/[personId]', params: { personId: d.person_id, treeId: d.tree_id } })}
            style={[styles.date, d.days === 0 && styles.today]}
          >
            <Avatar personId={d.person_id} size={44} name={d.name} />
            <Text style={styles.name} numberOfLines={1}>{d.kind === 'birthday' ? firstName(d.name) : d.name}</Text>
            <Text style={styles.what} numberOfLines={1}>
              {d.kind === 'birthday'
                ? d.turns ? t('ops.dates.turns', { count: d.turns }) : t('ops.dates.birthdayShort')
                : t('ops.dates.years', { count: d.turns ?? 0 })}
            </Text>
            <Text style={[styles.when, d.days === 0 && styles.whenToday]}>{when(d)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export function OnThisDayCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const memories = useQuery({ queryKey: ['on-this-day'], queryFn: () => api.rpc<OnThisDay[]>('on_this_day'), staleTime: 60 * 60_000 });
  const first = memories.data?.[0];
  if (!first) return null;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/social/memories/[id]', params: { id: first.id } })} style={styles.memory}>
      <View style={styles.memoryIcon}>
        <PhotoIcon color={colors.logoOrange} size={22} />
      </View>
      <View style={styles.memoryText}>
        <Text style={styles.eyebrow}>{t('ops.dates.onThisDay', { count: first.years })}</Text>
        <Text style={styles.memoryTitle} numberOfLines={2}>{first.body ?? t('social.home.memories')}</Text>
        <Text style={styles.what}>{firstName(first.author_name)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: { gap: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  seeAll: { color: colors.logoPurple, fontFamily: fonts.bold, fontSize: 14 },
  section: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18, letterSpacing: -0.3 },
  strip: { gap: 10, paddingRight: 8 },
  date: {
    width: 112,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.card,
  },
  today: { borderColor: colors.logoOrange, borderWidth: 2 },
  name: { color: colors.text, fontFamily: fonts.bold, fontSize: 14, marginTop: 4, maxWidth: '100%' },
  what: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12 },
  when: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 12 },
  whenToday: { color: colors.logoOrange },
  memory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: radius.card,
    backgroundColor: '#FFF6EE',
    borderWidth: 1,
    borderColor: '#F6DCC5',
  },
  memoryIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  memoryText: { flex: 1, minWidth: 0, gap: 2 },
  eyebrow: { color: colors.logoOrange, fontFamily: fonts.extrabold, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  memoryTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
});
