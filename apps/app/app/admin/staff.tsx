// AYWO Admin only: the team. Team roles are named sets of permissions ("Support", "Moderator"); give someone a role
// and they get exactly its permissions, and changing the role changes everyone in it. People can be added before their
// first sign-in: the invite waits for their number. Every staff member uses an authenticator app as a second step.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PhoneField } from '@/components/PhoneField';
import { toE164 } from '@/lib/phone';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { GRANTABLE } from '@/admin/types';
import type { Grantable, StaffPage, StaffRole, StaffRow, TeamRole } from '@/admin/types';
import { Actions, AdminPage, adminStyles, Checkbox, DataTable, DialogFrame, Field, FilterChips, FormDialog, formatDate, Message, Pager, Panel, Pill, QueryState, SecondaryButton, useAction, usePagedList } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import { api } from '@/lib/api';

export default function AdminStaff() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [removing, setRemoving] = useState<StaffRow | null>(null);
  const [resetting, setResetting] = useState<StaffRow | null>(null);
  const [role, setRole] = useState<TeamRole | 'new' | null>(null);
  const { query, page, setPage } = usePagedList<StaffRow>(['admin', 'staff'], '/admin/staff');
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => api.get<TeamRole[]>('/admin/roles') });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['admin', 'staff'] });
    await client.invalidateQueries({ queryKey: ['admin', 'roles'] });
  };
  const invites = (query.data as StaffPage | undefined)?.invites ?? [];

  const columns: Column<StaffRow>[] = [
    {
      key: 'name',
      label: t('admin.staff.name'),
      flex: 1.4,
      render: (row) => (
        <View>
          <Text style={adminStyles.cellStrong}>{row.is_me ? t('admin.staff.you', { name: row.display_name }) : row.display_name || t('admin.users.noName')}</Text>
          <Text style={adminStyles.cellMuted}>{row.phone_masked ?? '-'}</Text>
        </View>
      ),
    },
    {
      key: 'role',
      label: t('admin.staff.role'),
      flex: 1,
      render: (row) => (
        <Actions>
          <Pill label={row.team_role ?? t(`admin.roles.${row.role}`)} />
          {row.blocked_at ? <Pill label={t('admin.users.blocked')} alert /> : null}
        </Actions>
      ),
    },
    {
      key: 'permissions',
      label: t('admin.staff.permissions'),
      flex: 2,
      render: (row) => (row.role === 'aywo_admin' ? t('admin.staff.everything') : row.permissions.map((p) => t(`admin.permissions.${p}`)).join(', ')),
    },
    {
      key: 'safety',
      label: t('admin.staff.twoStep'),
      flex: 0.9,
      render: (row) => <Pill label={row.two_step ? t('admin.staff.twoStepOn') : t('admin.staff.twoStepOff')} alert={!row.two_step} />,
    },
    { key: 'work', label: t('admin.staff.openWork'), flex: 0.6, render: (row) => `${row.open_work}` },
    { key: 'seen', label: t('admin.users.lastActive'), render: (row) => formatDate(row.last_active_at, i18n.language) },
    {
      key: 'actions',
      label: t('admin.common.actions'),
      flex: 1.8,
      render: (row) =>
        row.is_me ? (
          <Text style={adminStyles.cellMuted}>-</Text>
        ) : (
          <Actions>
            <SecondaryButton label={t('admin.staff.change')} onPress={() => setEditing(row)} />
            {row.two_step ? <SecondaryButton label={t('admin.staff.reset')} onPress={() => setResetting(row)} /> : null}
            <SecondaryButton label={t('admin.staff.remove')} danger onPress={() => setRemoving(row)} />
          </Actions>
        ),
    },
  ];

  const roleColumns: Column<TeamRole>[] = [
    {
      key: 'name',
      label: t('admin.staff.teamRole'),
      flex: 1.2,
      render: (r) => (
        <View>
          <Text style={adminStyles.cellStrong}>{r.name}</Text>
          {r.description ? <Text style={adminStyles.cellMuted}>{r.description}</Text> : null}
        </View>
      ),
    },
    { key: 'perms', label: t('admin.staff.permissions'), flex: 2.2, render: (r) => r.permissions.map((p) => t(`admin.permissions.${p}`)).join(', ') },
    { key: 'members', label: t('admin.staff.members'), flex: 0.6, render: (r) => `${r.members}` },
    { key: 'edit', label: t('admin.common.actions'), flex: 0.7, render: (r) => <SecondaryButton label={t('admin.staff.change')} onPress={() => setRole(r)} /> },
  ];

  return (
    <AdminPage title={t('admin.staff.title')} subtitle={t('admin.staff.subtitle')} gates={['staff']}>
      <Actions>
        <SecondaryButton label={t('admin.staff.add')} onPress={() => setAdding(true)} />
      </Actions>
      <QueryState query={query} isEmpty={(data) => data.rows.length === 0} emptyText={t('admin.staff.empty')}>
        {(data) => (
          <>
            <DataTable columns={columns} rows={data.rows} rowKey={(row) => row.profile_id} />
            <Pager page={page} total={data.total} onPage={setPage} />
          </>
        )}
      </QueryState>

      {invites.length > 0 ? (
        <Panel title={t('admin.staff.invites')}>
          {invites.map((inv) => (
            <View key={inv.phone_key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <Text style={adminStyles.cellStrong}>
                {inv.phone_masked} · {inv.team_role ?? t(`admin.roles.${inv.role}`)} ·{' '}
                {inv.expired ? t('admin.staff.inviteExpired') : t('admin.staff.inviteUntil', { when: formatDate(inv.expires_at, i18n.language) })}
              </Text>
              <SecondaryButton
                label={t('admin.staff.cancelInvite')}
                onPress={async () => {
                  await api.del(`/admin/staff-invites/${inv.phone_key}`);
                  await refresh();
                }}
              />
            </View>
          ))}
        </Panel>
      ) : null}

      <Panel title={t('admin.staff.teamRoles')} actions={<SecondaryButton label={t('admin.staff.newRole')} onPress={() => setRole('new')} />}>
        <Text style={adminStyles.cellMuted}>{t('admin.staff.teamRolesHelp')}</Text>
        <QueryState query={roles} isEmpty={(rows) => rows.length === 0}>
          {(rows) => <DataTable columns={roleColumns} rows={rows} rowKey={(r) => r.id} />}
        </QueryState>
      </Panel>

      {adding ? <StaffDialog roles={roles.data ?? []} onDone={refresh} onClose={() => setAdding(false)} /> : null}
      {editing ? <StaffDialog row={editing} roles={roles.data ?? []} onDone={refresh} onClose={() => setEditing(null)} /> : null}
      {role ? <RoleDialog role={role === 'new' ? null : role} onDone={refresh} onClose={() => setRole(null)} /> : null}
      {removing ? (
        <FormDialog
          title={t('admin.staff.removeTitle', { name: removing.display_name || t('admin.users.noName') })}
          text={t('admin.staff.removeText')}
          confirmLabel={t('admin.staff.remove')}
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await api.del(`/admin/staff/${removing.profile_id}`);
            await refresh();
            setRemoving(null);
          }}
        />
      ) : null}
      {resetting ? (
        <FormDialog
          title={t('admin.staff.resetTitle', { name: resetting.display_name || t('admin.users.noName') })}
          text={t('admin.staff.resetText')}
          fields={[{ name: 'reason', label: t('admin.common.reason'), minLength: 5, multiline: true }]}
          confirmLabel={t('admin.staff.reset')}
          danger
          onCancel={() => setResetting(null)}
          onConfirm={async ({ reason }) => {
            await api.post(`/admin/staff/${resetting.profile_id}/two-step-reset`, { reason });
            await refresh();
            setResetting(null);
          }}
        />
      ) : null}
    </AdminPage>
  );
}

/** Adds someone when no row is given, otherwise changes that person's role. A team role or hand-picked permissions. */
function StaffDialog({ row, roles, onDone, onClose }: { row?: StaffRow; roles: TeamRole[]; onDone: () => Promise<unknown>; onClose: () => void }) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>(row?.role ?? 'sub_admin');
  const [team, setTeam] = useState<string>(row?.team_role_id ?? (row ? 'custom' : roles[0]?.id ?? 'custom'));
  const [granted, setGranted] = useState<Grantable[]>(row?.permissions ?? []);
  const [invited, setInvited] = useState(false);
  const action = useAction();

  const e164 = toE164(phone);
  const phoneOk = !!row || !!e164;
  const ready = phoneOk && (role === 'aywo_admin' || team !== 'custom' || granted.length > 0);

  async function save() {
    const body = {
      role,
      permissions: role === 'sub_admin' && team === 'custom' ? granted : [],
      team_role_id: role === 'sub_admin' && team !== 'custom' ? team : null,
    };
    let waitsForSignIn = false;
    const ok = await action.run(async () => {
      if (row) await api.patch(`/admin/staff/${row.profile_id}`, body);
      else {
        const answer = await api.post<{ invited?: boolean }>('/admin/staff', { phone: e164, ...body });
        waitsForSignIn = !!answer?.invited;
      }
      await onDone();
    });
    if (ok && waitsForSignIn) setInvited(true);
    else if (ok) onClose();
  }

  if (invited) {
    return (
      <DialogFrame title={t('admin.staff.invitedTitle')} text={t('admin.staff.invitedText')}>
        <Actions>
          <SecondaryButton label={t('admin.work.close')} onPress={onClose} />
        </Actions>
      </DialogFrame>
    );
  }

  return (
    <DialogFrame title={row ? t('admin.staff.changeTitle', { name: row.display_name || t('admin.users.noName') }) : t('admin.staff.addTitle')} text={row ? undefined : t('admin.staff.addText')}>
      {row ? null : <PhoneField label={t('admin.staff.phone')} value={phone} onChangeText={setPhone} invalid={!!phone && !e164} />}
      <FilterChips
        value={role}
        onChange={setRole}
        options={[
          { value: 'sub_admin', label: t('admin.roles.sub_admin') },
          { value: 'aywo_admin', label: t('admin.roles.aywo_admin') },
        ]}
      />
      {role === 'sub_admin' ? (
        <>
          <Text style={adminStyles.fieldLabel}>{t('admin.staff.teamRole')}</Text>
          <FilterChips value={team} onChange={setTeam} options={[...roles.map((r) => ({ value: r.id, label: r.name })), { value: 'custom', label: t('admin.staff.custom') }]} />
          {team === 'custom' ? (
            GRANTABLE.map((p) => (
              <Checkbox
                key={p}
                label={`${t(`admin.permissions.${p}`)}: ${t(`admin.permissionHelp.${p}`)}`}
                checked={granted.includes(p)}
                onChange={(on) => setGranted((old) => (on ? [...old, p] : old.filter((x) => x !== p)))}
              />
            ))
          ) : (
            <Text style={adminStyles.cellMuted}>
              {(roles.find((r) => r.id === team)?.permissions ?? []).map((p) => t(`admin.permissions.${p}`)).join(', ')}
            </Text>
          )}
        </>
      ) : (
        <Text style={adminStyles.cellMuted}>{t('admin.staff.adminHelp')}</Text>
      )}
      {action.failure ? <Message text={action.failure} alert /> : null}
      <Actions>
        <SecondaryButton label={t('admin.common.cancel')} onPress={onClose} disabled={action.busy} />
        <SecondaryButton label={t('admin.common.save')} onPress={save} disabled={action.busy || !ready} />
      </Actions>
    </DialogFrame>
  );
}

function RoleDialog({ role, onDone, onClose }: { role: TeamRole | null; onDone: () => Promise<unknown>; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [granted, setGranted] = useState<Grantable[]>(role?.permissions ?? []);
  const action = useAction();

  async function save() {
    const body = { name: name.trim(), description: description.trim() || undefined, permissions: granted };
    const ok = await action.run(() => (role ? api.patch(`/admin/roles/${role.id}`, body) : api.post('/admin/roles', body)));
    if (ok) {
      await onDone();
      onClose();
    }
  }
  async function remove() {
    if (!role) return;
    const ok = await action.run(() => api.del(`/admin/roles/${role.id}`));
    if (ok) {
      await onDone();
      onClose();
    }
  }

  return (
    <DialogFrame title={role ? t('admin.staff.editRole', { name: role.name }) : t('admin.staff.newRole')} text={role?.members ? t('admin.staff.roleChangesAll', { count: role.members }) : undefined}>
      <Field label={t('admin.staff.roleName')} value={name} onChange={setName} maxLength={40} />
      <Field label={t('admin.offers.description')} value={description} onChange={setDescription} maxLength={200} />
      {GRANTABLE.map((p) => (
        <Checkbox
          key={p}
          label={`${t(`admin.permissions.${p}`)}: ${t(`admin.permissionHelp.${p}`)}`}
          checked={granted.includes(p)}
          onChange={(on) => setGranted((old) => (on ? [...old, p] : old.filter((x) => x !== p)))}
        />
      ))}
      {action.failure ? <Message text={action.failure} alert /> : null}
      <Actions>
        {role && role.members === 0 ? <SecondaryButton label={t('admin.staff.deleteRole')} danger onPress={remove} disabled={action.busy} /> : null}
        <SecondaryButton label={t('admin.common.cancel')} onPress={onClose} disabled={action.busy} />
        <SecondaryButton label={t('admin.common.save')} onPress={save} disabled={action.busy || name.trim().length < 2 || granted.length === 0} />
      </Actions>
    </DialogFrame>
  );
}
