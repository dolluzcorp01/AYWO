// One invitation in the list, drawn as a card you would want to open: a calendar leaf with the day on the left
// (coloured by the kind of function), then the title, who hosts, the time, and where this person stands.
// Before this each invitation was a plain line of grey text, the same as every other list in the app.
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { CalendarIcon, ChevronIcon, FriendsIcon, GiftIcon, HeartIcon, InviteIcon, PartyIcon, RingsIcon } from '@/components/Icons';
import { Text } from '@/components/Text';
import { useName } from '@/social/parts';
import type { EventKind, EventRow } from '@/social/types';
import { colors, fonts, gradients, radius, shadows } from '@/theme/tokens';

type IconType = (p: { color: string; size?: number; width?: number }) => ReactNode;

/** Each kind of function has its own colour and sign, so the list can be read at a glance. */
const LOOK: Record<EventKind, { strong: string; soft: string; icon: IconType }> = {
  wedding: { strong: '#D9480F', soft: '#FFF1E6', icon: RingsIcon },
  engagement: { strong: '#C2255C', soft: '#FDEEF4', icon: HeartIcon },
  birthday: { strong: '#8E26E1', soft: '#F4ECFD', icon: GiftIcon },
  sixtieth: { strong: '#B7791F', soft: '#FFF7DB', icon: GiftIcon },
  eightieth: { strong: '#B7791F', soft: '#FFF7DB', icon: GiftIcon },
  housewarming: { strong: '#0B8F4D', soft: '#E8F7EF', icon: InviteIcon },
  get_together: { strong: '#1C7ED6', soft: '#E9F3FD', icon: FriendsIcon },
  // A remembrance day stays quiet: the app's own indigo, no bright colour.
  death_anniversary: { strong: '#4A4E8F', soft: '#EEEFF8', icon: CalendarIcon },
  pop_party: { strong: '#E8590C', soft: '#FFF3D6', icon: PartyIcon },
};

function daysAway(at: Date): number {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((start(at) - start(new Date())) / 86_400_000);
}

export function EventTile({ event: e, onPress }: { event: EventRow; onPress: () => void }) {
  const { t, i18n } = useTranslation();
  const showName = useName();
  const look = LOOK[e.kind] ?? LOOK.get_together;
  const at = e.starts_at ? new Date(e.starts_at) : null;
  const away = at ? daysAway(at) : null;
  const faded = e.cancelled || (away !== null && away < 0);
  const strong = faded ? colors.idleTab : look.strong;
  const soft = faded ? colors.tint : look.soft;
  const Sign = look.icon;

  const kind = t(`social.invites.kinds.${e.kind}`);
  const host = e.is_mine ? t('social.invites.youHost') : t('social.invites.hostedBy', { name: showName(e.host_name) });
  const time = at ? at.toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit', hour12: true }) : null;
  const weekday = at ? at.toLocaleDateString(i18n.language, { weekday: 'long' }) : null;
  const soon = away === 0 ? t('ops.dates.today') : away === 1 ? t('ops.dates.tomorrow') : null;
  const fullDate = at ? at.toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }) : t('social.pop.stillDeciding');

  // Where this person stands: said once, in colour.
  const status: { text: string; back: string; ink: string } | null = e.cancelled
    ? { text: t('social.invites.cancelled'), back: colors.alertTint, ink: colors.alert }
    : e.is_mine
      ? null
      : e.my_answer === 'yes'
        ? { text: t('social.invites.answers.yes'), back: '#E8F7EF', ink: colors.good }
        : e.my_answer === 'no'
          ? { text: t('social.invites.answers.no'), back: colors.tint, ink: colors.muted }
          : e.my_answer === 'maybe'
            ? { text: t('social.invites.answers.maybe'), back: '#FFF7DB', ink: '#8A5A00' }
            : { text: t('social.invites.waitingForYou'), back: colors.celebrationTint, ink: colors.ask };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[e.title, kind, host, fullDate, time, status?.text].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [styles.card, away === 0 && !e.cancelled && { borderColor: strong, borderWidth: 2 }, pressed && styles.pressed]}
    >
      {/* The calendar leaf: month on a coloured band, the day large underneath. No date yet shows the sign. */}
      <View style={[styles.leaf, { backgroundColor: soft }]}>
        {at ? (
          <>
            <View style={[styles.leafTop, { backgroundColor: strong }]}>
              <Text style={styles.leafMonth}>{at.toLocaleDateString(i18n.language, { month: 'short' })}</Text>
            </View>
            <Text style={[styles.leafDay, { color: strong }]}>{at.getDate()}</Text>
          </>
        ) : (
          <Sign color={strong} size={28} width={1.8} />
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.kindRow}>
          <Sign color={strong} size={14} width={2} />
          <Text style={[styles.kind, { color: strong }]} numberOfLines={1}>{kind}</Text>
        </View>
        <Text style={[styles.title, e.cancelled && styles.struck]} numberOfLines={2}>{e.title}</Text>
        <Text style={styles.host} numberOfLines={1}>{host}</Text>
        <View style={styles.chips}>
          {time ? (
            <View style={[styles.chip, { backgroundColor: soft }]}>
              <Text style={[styles.chipText, { color: strong }]}>{`${soon ?? weekday} · ${time}`}</Text>
            </View>
          ) : (
            <View style={[styles.chip, { backgroundColor: soft }]}>
              <Text style={[styles.chipText, { color: strong }]}>{t('social.pop.stillDeciding')}</Text>
            </View>
          )}
          {status ? (
            <View style={[styles.chip, { backgroundColor: status.back }]}>
              <Text style={[styles.chipText, { color: status.ink }]}>{status.text}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <ChevronIcon color={colors.idleTab} size={18} />
    </Pressable>
  );
}

/** The two ways to start, side by side: a formal invitation, or a quick plan the family votes on. */
export function StartTiles({ inviteLabel, popLabel, onInvite, onPop }: { inviteLabel: string; popLabel: string; onInvite: () => void; onPop: () => void }) {
  return (
    <View style={styles.starts}>
      <Pressable accessibilityRole="button" onPress={onInvite} style={({ pressed }) => [styles.start, pressed && styles.pressed]}>
        <LinearGradient colors={gradients.neon} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.startFill}>
          <View style={[styles.startSign, { backgroundColor: colors.glass }]}>
            <InviteIcon color={colors.white} size={22} width={1.9} />
          </View>
          <Text style={[styles.startText, { color: colors.white }]}>{inviteLabel}</Text>
        </LinearGradient>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onPop} style={({ pressed }) => [styles.start, pressed && styles.pressed]}>
        <LinearGradient colors={gradients.highlight} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.startFill}>
          <View style={[styles.startSign, { backgroundColor: 'rgba(255,255,255,.45)' }]}>
            <PartyIcon color={colors.text} size={22} width={1.9} />
          </View>
          <Text style={[styles.startText, { color: colors.text }]}>{popLabel}</Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 12,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    ...shadows.card,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  leaf: { width: 66, height: 76, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  leafTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 24, alignItems: 'center', justifyContent: 'center' },
  leafMonth: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  leafDay: { fontFamily: fonts.extrabold, fontSize: 30, lineHeight: 36, marginTop: 22 },
  body: { flex: 1, minWidth: 0, gap: 2 },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  kind: { fontFamily: fonts.extrabold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', flexShrink: 1 },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  struck: { textDecorationLine: 'line-through', color: colors.muted },
  host: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  chipText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 },
  starts: { flexDirection: 'row', gap: 12 },
  start: { flex: 1, borderRadius: radius.card, ...shadows.raised },
  startFill: { minHeight: 104, borderRadius: radius.card, padding: 14, justifyContent: 'space-between', gap: 10 },
  startSign: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  startText: { fontFamily: fonts.extrabold, fontSize: 16, lineHeight: 20 },
});
