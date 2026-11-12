// Family calendar: a month at a time. Birthdays, wedding anniversaries, remembrance days for those who have passed,
// and invitations. Tap a day to see just that day; tap it again to see the whole month.
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { ChevronIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { EmptyState, LoadFailed, Loading, TopBar } from '@/components/ui';
import { addMonths, monthGrid, ymd } from '@/calendar/month';
import { useCalendar } from '@/calendar/useCalendar';
import type { CalendarItem, CalendarKind } from '@/calendar/useCalendar';
import { useErrorText } from '@/lib/errors';
import { goBack } from '@/lib/nav';
import { colors, fonts, minTapSize, radius, shadows } from '@/theme/tokens';

const KIND_COLOUR: Record<CalendarKind, string> = {
  birthday: colors.logoOrange,
  anniversary: colors.logoPurple,
  remembrance: colors.muted,
  event: colors.whatsapp,
};
const KINDS: CalendarKind[] = ['birthday', 'anniversary', 'remembrance', 'event'];

export default function Calendar() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const today = ymd(new Date());
  // On a computer there is room: a wider month with taller days. Phones keep the compact one.
  const wide = useWindowDimensions().width >= 1000;
  const [[year, month0], setMonth] = useState<[number, number]>(() => [new Date().getFullYear(), new Date().getMonth()]);
  const [picked, setPicked] = useState<string | null>(null);

  const weeks = useMemo(() => monthGrid(year, month0), [year, month0]);
  const from = weeks[0][0].date;
  const to = weeks[weeks.length - 1][6].date;
  const calendar = useCalendar(from, to);
  const items = calendar.data ?? [];
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) map.set(item.date, [...(map.get(item.date) ?? []), item]);
    return map;
  }, [items]);

  const monthPrefix = `${year}-${String(month0 + 1).padStart(2, '0')}`;
  const shown = picked ? (byDay.get(picked) ?? []) : items.filter((i) => i.date.startsWith(monthPrefix));
  const isThisMonth = today.startsWith(monthPrefix);
  const lang = i18n.language;
  const monthTitle = new Date(year, month0, 1).toLocaleDateString(lang, { month: 'long', year: 'numeric' });
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 1 + i).toLocaleDateString(lang, { weekday: 'short' }));
  const dayTitle = (date: string) => {
    if (date === today) return t('calendar.today');
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' });
  };

  function move(by: number) {
    setMonth(addMonths(year, month0, by));
    setPicked(null);
  }

  function open(item: CalendarItem) {
    if (item.kind === 'event' && item.event_id) router.push({ pathname: '/social/invites/[id]', params: { id: item.event_id } });
    else if (item.person_id && item.tree_id) router.push({ pathname: '/person/[personId]', params: { personId: item.person_id, treeId: item.tree_id } });
  }

  // The month list goes under a heading for each day; one picked day needs no headings.
  const groups: [string, CalendarItem[]][] = picked ? [[picked, shown]] : [...new Set(shown.map((i) => i.date))].map((d) => [d, shown.filter((i) => i.date === d)]);

  return (
    <Screen>
      <TopBar title={t('calendar.title')} subtitle={t('calendar.subtitle')} onBack={() => goBack(router)} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.card, wide && styles.cardWide]}>
          <View style={styles.monthRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('calendar.previous')} onPress={() => move(-1)} style={styles.arrow}>
              <View style={styles.flip}>
                <ChevronIcon color={colors.text} size={20} />
              </View>
            </Pressable>
            <View style={styles.monthMiddle}>
              <Text accessibilityRole="header" style={styles.monthTitle}>{monthTitle}</Text>
              {!isThisMonth ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setMonth([new Date().getFullYear(), new Date().getMonth()]);
                    setPicked(null);
                  }}
                >
                  <Text style={styles.backToToday}>{t('calendar.backToToday')}</Text>
                </Pressable>
              ) : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('calendar.next')} onPress={() => move(1)} style={styles.arrow}>
              <ChevronIcon color={colors.text} size={20} />
            </Pressable>
          </View>

          <View style={styles.week}>
            {weekdays.map((w, i) => (
              <Text key={i} style={styles.weekday} numberOfLines={1}>{w}</Text>
            ))}
          </View>
          {weeks.map((week) => (
            <View key={week[0].date} style={styles.week}>
              {week.map((day) => {
                const here = byDay.get(day.date) ?? [];
                const kinds = KINDS.filter((k) => here.some((i) => i.kind === k));
                const isPicked = picked === day.date;
                return (
                  <Pressable
                    key={day.date}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isPicked }}
                    accessibilityLabel={`${dayTitle(day.date)}${here.length ? `, ${t('calendar.dayCount', { count: here.length })}` : ''}`}
                    onPress={() => {
                      if (!day.inMonth) {
                        const [y, m] = day.date.split('-').map(Number);
                        setMonth([y, m - 1]);
                        setPicked(day.date);
                      } else setPicked(isPicked ? null : day.date);
                    }}
                    style={[styles.cell, wide && styles.cellWide]}
                  >
                    <View style={[styles.dayCircle, wide && styles.dayCircleWide, day.date === today && styles.todayCircle, isPicked && styles.pickedCircle]}>
                      <Text style={[styles.dayNumber, wide && styles.dayNumberWide, !day.inMonth && styles.otherMonth, day.date === today && styles.todayNumber, isPicked && styles.pickedNumber]}>
                        {day.day}
                      </Text>
                    </View>
                    <View style={styles.dots}>
                      {kinds.map((k) => (
                        <View key={k} style={[styles.dot, { backgroundColor: KIND_COLOUR[k] }, !day.inMonth && styles.faint]} />
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}

          <View style={styles.legend}>
            {KINDS.map((k) => (
              <View key={k} style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: KIND_COLOUR[k] }]} />
                <Text style={styles.legendText}>{t(`calendar.kinds.${k}`)}</Text>
              </View>
            ))}
          </View>
        </View>

        {calendar.isError ? (
          <LoadFailed message={errorText(calendar.error)} onRetry={() => calendar.refetch()} />
        ) : !calendar.data ? (
          <Loading />
        ) : shown.length === 0 ? (
          <EmptyState message={picked ? t('calendar.nothingDay') : t('calendar.nothingMonth')} />
        ) : (
          groups.map(([date, list]) => (
            <View key={date} style={[styles.group, wide && styles.groupWide]}>
              <Text accessibilityRole="header" style={styles.groupTitle}>{dayTitle(date)}</Text>
              {list.map((item, i) => (
                <ItemRow key={`${item.kind}-${item.person_id ?? item.event_id}-${i}`} item={item} onPress={() => open(item)} />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function ItemRow({ item, onPress }: { item: CalendarItem; onPress: () => void }) {
  const { t, i18n } = useTranslation();
  const years = item.years ?? null;
  let title = item.name;
  let sub = '';
  if (item.kind === 'birthday') {
    title = item.me ? t('calendar.yourBirthday') : t('calendar.birthdayOf', { name: item.name });
    sub = years ? t('calendar.turns', { count: years }) : t('calendar.kinds.birthday');
  } else if (item.kind === 'anniversary') {
    sub = years ? t('calendar.married', { count: years }) : t('calendar.kinds.anniversary');
  } else if (item.kind === 'remembrance') {
    title = t('calendar.remembering', { name: item.name });
    sub = years ? t('calendar.yearsSince', { count: years }) : t('calendar.kinds.remembrance');
  } else {
    const time = item.starts_at ? new Date(item.starts_at).toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit' }) : '';
    sub = [item.event_kind ? t(`social.invites.kinds.${item.event_kind}`) : '', time, item.me ? t('social.invites.youHost') : ''].filter(Boolean).join(' · ');
  }
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <View style={[styles.rowMark, { backgroundColor: KIND_COLOUR[item.kind] }]} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>{title}</Text>
        {sub ? <Text style={styles.rowSub} numberOfLines={2}>{sub}</Text> : null}
      </View>
      <ChevronIcon color={colors.muted} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 14, paddingBottom: 24 },
  card: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    gap: 4,
    padding: 12,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.card,
  },
  cardWide: { maxWidth: 900, padding: 20 },
  cellWide: { minHeight: 84, paddingVertical: 8 },
  dayCircleWide: { width: 44, height: 44, borderRadius: 22 },
  dayNumberWide: { fontSize: 18 },
  groupWide: { maxWidth: 900 },
  monthRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  arrow: { width: minTapSize, height: minTapSize, alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: colors.tint },
  flip: { transform: [{ scaleX: -1 }] },
  monthMiddle: { flex: 1, alignItems: 'center', gap: 2 },
  monthTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18 },
  backToToday: { color: colors.logoPurple, fontFamily: fonts.bold, fontSize: 13 },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', color: colors.muted, fontFamily: fonts.semibold, fontSize: 12, paddingVertical: 4 },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 3, minHeight: minTapSize + 6 },
  dayCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  todayCircle: { borderWidth: 2, borderColor: colors.logoPurple },
  pickedCircle: { backgroundColor: colors.logoIndigo, borderColor: colors.logoIndigo },
  dayNumber: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15 },
  otherMonth: { color: colors.idleTab },
  todayNumber: { color: colors.logoPurple, fontFamily: fonts.extrabold },
  pickedNumber: { color: colors.white },
  dots: { flexDirection: 'row', gap: 3, height: 7, marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  faint: { opacity: 0.4 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 14, marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.cardBorder },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  group: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: 8 },
  groupTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: minTapSize + 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  rowMark: { width: 6, alignSelf: 'stretch', borderRadius: 3 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  rowSub: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
});
