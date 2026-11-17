// The can / can't list for one role, and the mark used in every cell. Used on the Share screen and the roles page.
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { CheckIcon, CloseIcon } from '@/components/Icons';
import { Text } from '@/components/Text';
import { RIGHTS, type Right, type TreeRole } from '@/tree/roleRights';
import { colors, fonts } from '@/theme/tokens';

/** A tick, a cross, or a short word for the in-between answers. Always with words for screen readers. */
export function RightMark({ right, compact }: { right: Right; compact?: boolean }) {
  const { t } = useTranslation();
  const label = t(`roles.mark.${right}`);
  if (right === 'yes') {
    return (
      <View accessible accessibilityLabel={label} style={[styles.mark, styles.yes]}>
        <CheckIcon color={colors.white} size={14} />
      </View>
    );
  }
  if (right === 'no') {
    return (
      <View accessible accessibilityLabel={label} style={[styles.mark, styles.no]}>
        <CloseIcon color={colors.muted} size={12} />
      </View>
    );
  }
  return <Text style={[styles.partial, compact && styles.partialCompact]}>{t(`roles.mark.${right}Short`)}</Text>;
}

/** approveFirst: an Editor shared with "I approve first", whose changes wait like a Viewer's. */
export function RoleRightsList({ role, approveFirst }: { role: TreeRole; approveFirst?: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={styles.list}>
      {RIGHTS.map((r) => {
        const right: Right = approveFirst && role === 'editor' && r.key === 'change' ? 'approval' : r.by[role];
        return (
          <View key={r.key} style={styles.row}>
            <RightMark right={right} />
            <Text style={[styles.rowText, right === 'no' && styles.rowTextNo]}>{t(`roles.rights.${r.key}`)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { flex: 1, color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
  rowTextNo: { color: colors.muted, fontFamily: fonts.medium },
  mark: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  yes: { backgroundColor: colors.good },
  no: { backgroundColor: colors.line },
  partial: {
    color: colors.relation,
    fontFamily: fonts.bold,
    fontSize: 11,
    backgroundColor: colors.tint,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
    textAlign: 'center',
  },
  partialCompact: { fontSize: 10, paddingHorizontal: 6 },
});
