// Admin side > Staff > Team roles: every permission against every role in one grid. AYWO Admin ticks and unticks
// boxes, sees what changed, and saves once; the confirm lists each role's gains and losses and how many people they
// reach. AYWO Admin's own column and the AYWO-Admin-only rows (staff, audit) are locked: the server never grants those.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CheckIcon } from '@/components/Icons';
import { GRANTABLE } from '@/admin/types';
import type { Grantable, TeamRole } from '@/admin/types';
import { adminStyles, FormDialog, Message, Missing, SecondaryButton } from '@/admin/ui';
import { api } from '@/lib/api';
import { colors, fonts } from '@/theme/tokens';

/** Rows only AYWO Admin has. Shown so nobody wonders whether a team role could have them. */
const ADMIN_ONLY = ['staff', 'audit'] as const;

type Draft = Record<string, Grantable[]>;

function sameSet(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export function RolesGrid({ roles, editable, onSaved, onEditRole }: {
  roles: TeamRole[];
  /** AYWO Admin: tick and save. Otherwise the grid only shows. */
  editable: boolean;
  onSaved: () => Promise<unknown>;
  /** Name and description stay in the role's own dialog. */
  onEditRole?: (role: TeamRole) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>({});
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);

  const current = (role: TeamRole): Grantable[] => draft[role.id] ?? role.permissions;
  const changed = useMemo(() => roles.filter((r) => draft[r.id] && !sameSet(draft[r.id], r.permissions)), [roles, draft]);
  // Ticks not saved yet: closing or refreshing the page asks first, so they are not lost without a word.
  const unsaved = changed.length > 0;
  useEffect(() => {
    if (!unsaved || typeof globalThis.addEventListener !== 'function') return;
    const warn = (event: { preventDefault: () => void; returnValue?: string }) => {
      event.preventDefault();
      event.returnValue = '';
    };
    globalThis.addEventListener('beforeunload', warn as never);
    return () => globalThis.removeEventListener('beforeunload', warn as never);
  }, [unsaved]);
  const changeCount = changed.reduce((n, r) => {
    const now = current(r);
    return n + now.filter((p) => !r.permissions.includes(p)).length + r.permissions.filter((p) => !now.includes(p)).length;
  }, 0);
  const empty = roles.find((r) => current(r).length === 0);

  function toggle(role: TeamRole, perm: Grantable) {
    setSaved(false);
    const now = current(role);
    const next = now.includes(perm) ? now.filter((p) => p !== perm) : [...now, perm];
    setDraft((d) => ({ ...d, [role.id]: next }));
  }

  const label = (p: string) => t(`admin.permissions.${p}`);

  return (
    <View style={styles.wrap}>
      <View style={styles.legend}>
        <Text style={adminStyles.cellMuted}>{editable ? t('admin.rolesGrid.helpEdit') : t('admin.rolesGrid.helpView')}</Text>
      </View>

      <View style={styles.table}>
        <View style={[styles.tr, styles.head]}>
          <View style={styles.first}>
            <Text style={styles.headText}>{t('admin.rolesGrid.permission')}</Text>
          </View>
          <View style={styles.cell}>
            <Text style={styles.headText}>{t('admin.roles.aywo_admin')}</Text>
            <Text style={styles.headSub}>{t('admin.rolesGrid.everything')}</Text>
          </View>
          {roles.map((r) => (
            <View key={r.id} style={styles.cell}>
              {editable && onEditRole ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('admin.staff.editRole', { name: r.name })}
                  onPress={() => onEditRole(r)}
                  style={({ hovered }: { hovered?: boolean }) => [styles.roleName, hovered && styles.roleNameHover]}
                >
                  <Text style={[styles.headText, styles.link]}>{r.name}</Text>
                </Pressable>
              ) : (
                <Text style={styles.headText}>{r.name}</Text>
              )}
              <Text style={styles.headSub}>{t('admin.rolesGrid.people', { count: r.members })}</Text>
            </View>
          ))}
        </View>

        {GRANTABLE.map((p, i) => (
          <View key={p} style={[styles.tr, i % 2 === 1 && styles.striped]}>
            <View style={styles.first}>
              <Text style={styles.permName}>{label(p)}</Text>
              <Text style={styles.permHelp}>{t(`admin.permissionHelp.${p}`)}</Text>
            </View>
            <View style={styles.cell}>
              <Box on locked label={`${t('admin.roles.aywo_admin')}: ${label(p)}`} />
            </View>
            {roles.map((r) => {
              const on = current(r).includes(p);
              const moved = on !== r.permissions.includes(p);
              return (
                <View key={r.id} style={[styles.cell, moved && styles.moved]}>
                  <Box on={on} locked={!editable} label={`${r.name}: ${label(p)}`} onPress={() => toggle(r, p)} />
                </View>
              );
            })}
          </View>
        ))}

        {ADMIN_ONLY.map((p) => (
          <View key={p} style={[styles.tr, styles.adminOnly]}>
            <View style={styles.first}>
              <Text style={styles.permName}>{label(p)}</Text>
              <Text style={styles.permHelp}>{t(`admin.permissionHelp.${p}`)}</Text>
            </View>
            <View style={styles.cell}>
              <Box on locked label={`${t('admin.roles.aywo_admin')}: ${label(p)}`} />
            </View>
            {roles.map((r) => (
              <View key={r.id} style={styles.cell}>
                <Box on={false} locked label={`${r.name}: ${label(p)}`} />
              </View>
            ))}
          </View>
        ))}
      </View>
      <Text style={adminStyles.cellMuted}>{t('admin.rolesGrid.adminOnlyNote')}</Text>

      {saved ? <Message text={t('admin.rolesGrid.saved')} good /> : null}
      {editable && changed.length > 0 ? (
        <View style={styles.saveBar}>
          <Text style={styles.saveText}>{t('admin.rolesGrid.unsaved', { count: changeCount })}</Text>
          <Missing reasons={[empty && t('admin.rolesGrid.needOne', { name: empty.name })]} />
          <View style={styles.saveButtons}>
            <SecondaryButton label={t('admin.rolesGrid.discard')} onPress={() => setDraft({})} />
            <SecondaryButton main label={t('admin.rolesGrid.save')} disabled={!!empty} onPress={() => setConfirming(true)} />
          </View>
        </View>
      ) : null}

      {confirming ? (
        <FormDialog
          title={t('admin.rolesGrid.confirmTitle')}
          text={t('admin.rolesGrid.confirmText')}
          confirmLabel={t('admin.rolesGrid.save')}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            // One role at a time; a failure stops here and the rest stay unsaved and marked.
            for (const r of changed) {
              await api.patch(`/admin/roles/${r.id}`, { name: r.name, description: r.description ?? undefined, permissions: current(r) });
              setDraft((d) => {
                const { [r.id]: _done, ...rest } = d;
                return rest;
              });
            }
            await onSaved();
            setConfirming(false);
            setSaved(true);
          }}
        >
          {changed.map((r) => {
            const now = current(r);
            const gains = now.filter((p) => !r.permissions.includes(p)).map(label);
            const losses = r.permissions.filter((p) => !now.includes(p)).map(label);
            return (
              <View key={r.id} style={styles.change}>
                <Text style={adminStyles.cellStrong}>{t('admin.rolesGrid.roleLine', { name: r.name, count: r.members })}</Text>
                {gains.length ? <Text style={styles.gain}>{t('admin.staff.roleGains', { list: gains.join(', ') })}</Text> : null}
                {losses.length ? <Text style={styles.loss}>{t('admin.staff.roleLoses', { list: losses.join(', ') })}</Text> : null}
              </View>
            );
          })}
        </FormDialog>
      ) : null}
    </View>
  );
}

function Box({ on, locked, label, onPress }: { on: boolean; locked?: boolean; label: string; onPress?: () => void }) {
  const { t } = useTranslation();
  const text = `${label}: ${on ? t('admin.rolesGrid.yes') : t('admin.rolesGrid.no')}`;
  if (locked || !onPress) {
    return (
      <View accessible accessibilityLabel={text} style={[styles.box, on ? styles.boxOn : styles.boxOff, styles.boxLocked]}>
        {on ? <CheckIcon color={colors.white} size={14} /> : <Text style={styles.cross}>✕</Text>}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={({ hovered }: { hovered?: boolean }) => [styles.box, on ? styles.boxOn : styles.boxOff, styles.boxClick, hovered && styles.boxHover]}
    >
      {on ? <CheckIcon color={colors.white} size={14} /> : <Text style={styles.cross}>✕</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  legend: { gap: 4 },
  table: { borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 12, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center', minHeight: 54 },
  head: { backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.cardBorder, minHeight: 60 },
  striped: { backgroundColor: '#FBFAF8' },
  adminOnly: { backgroundColor: colors.tint },
  first: { flex: 2.6, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  cell: { flex: 1, minWidth: 90, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 4 },
  moved: { backgroundColor: '#FFF4D6' },
  headText: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 13, textAlign: 'center' },
  headSub: { color: colors.muted, fontFamily: fonts.medium, fontSize: 11, textAlign: 'center' },
  link: { color: colors.relation, textDecorationLine: 'underline' },
  roleName: { borderRadius: 6, paddingHorizontal: 4, cursor: 'pointer' },
  roleNameHover: { backgroundColor: colors.tint },
  permName: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  permHelp: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12 },
  box: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.good },
  boxOff: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.line },
  boxLocked: { opacity: 0.55 },
  boxClick: { cursor: 'pointer' },
  boxHover: { transform: [{ scale: 1.1 }], borderColor: colors.relation },
  cross: { color: colors.muted, fontSize: 12, fontFamily: fonts.bold },
  saveBar: { gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#FFF4D6', borderWidth: 1, borderColor: '#F3D58A' },
  saveText: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  saveButtons: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  change: { gap: 2, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  gain: { color: colors.good, fontFamily: fonts.semibold, fontSize: 13 },
  loss: { color: colors.alert, fontFamily: fonts.semibold, fontSize: 13 },
});
