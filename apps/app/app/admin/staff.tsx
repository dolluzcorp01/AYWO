// AYWO Admin only: the team. Team roles are named sets of permissions ("Support", "Moderator"); give someone a role
// and they get exactly its permissions, and changing the role changes everyone in it. People can be added before their
// first sign-in: the invite waits for their number. Every staff member uses an authenticator app as a second step.
import { useQuery } from '@tanstack/react-query';
import { PhoneField } from '@/components/PhoneField';
import { toE164 } from '@/lib/phone';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { GRANTABLE } from '@/admin/types';
import type { FormerStaff, Grantable, StaffInvite, StaffPage, StaffRole, StaffRow, TeamRole } from '@/admin/types';
import { Actions, AdminPage, adminStyles, Checkbox, DataTable, DialogFrame, Field, FilterChips, FormDialog, formatDate, Message, Missing, Pager, Panel, Pill, QueryState, SecondaryButton, useAction, usePagedList, useRefreshAfter } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import { api } from '@/lib/api';
import { RolesGrid } from '@/admin/RolesGrid';

export default function AdminStaff() {
  const { t, i18n } = useTranslation();
  const refreshAfter = useRefreshAfter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [removing, setRemoving] = useState<StaffRow | null>(null);
  const [resetting, setResetting] = useState<StaffRow | null>(null);
  const [role, setRole] = useState<TeamRole | 'new' | null>(null);
  const [cancelling, setCancelling] = useState<StaffInvite | null>(null);
  const [changingInvite, setChangingInvite] = useState<StaffInvite | null>(null);
  // An account that already exists: someone removed from staff, or picked on their page under Users.
  const [person, setPerson] = useState<Picked | null>(null);
  const router = useRouter();
  const params = useLocalSearchParams<{ add?: string; name?: string }>();
  useEffect(() => {
    if (params.add) {
      setPerson({ profile_id: params.add, display_name: params.name ?? null });
      // Taken out of the address, so a refresh does not open the box again.
      router.setParams({ add: undefined, name: undefined });
    }
  }, [params.add, params.name, router]);
  const renew = useAction();
  const { query, page, setPage } = usePagedList<StaffRow>(['admin', 'staff'], '/admin/staff');
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => api.get<TeamRole[]>('/admin/roles') });
  // Staff changes also move the dashboard's staff counts and the role pills on the Users page.
  const refresh = () => refreshAfter('staff', 'roles', 'users');
  const invites = (query.data as StaffPage | undefined)?.invites ?? [];
  const former = (query.data as StaffPage | undefined)?.former ?? [];

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


  return (
    <AdminPage title={t('admin.staff.title')} subtitle={t('admin.staff.subtitle')} gates={['staff']}>
      <Actions>
        <SecondaryButton main label={t('admin.staff.add')} onPress={() => setAdding(true)} />
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
              <Actions>
                {inv.expired ? (
                  <SecondaryButton
                    main
                    label={t('admin.staff.renewInvite')}
                    disabled={renew.busy}
                    onPress={async () => {
                      const ok = await renew.run(() =>
                        api.patch(`/admin/staff-invites/${inv.phone_key}`, { role: inv.role, permissions: inv.team_role_id ? [] : inv.permissions, team_role_id: inv.team_role_id }),
                      );
                      if (ok) await refresh();
                    }}
                  />
                ) : null}
                <SecondaryButton label={t('admin.staff.change')} onPress={() => setChangingInvite(inv)} />
                <SecondaryButton label={t('admin.staff.cancelInvite')} danger onPress={() => setCancelling(inv)} />
              </Actions>
            </View>
          ))}
          {renew.failure ? <Message text={renew.failure} alert /> : null}
          <Text style={adminStyles.cellMuted}>{t('admin.staff.invitesHelp')}</Text>
        </Panel>
      ) : null}

      {former.length > 0 ? (
        <Panel title={t('admin.staff.former')}>
          <Text style={adminStyles.cellMuted}>{t('admin.staff.formerHelp')}</Text>
          {former.map((f) => (
            <View key={f.profile_id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <View>
                <Text style={adminStyles.cellStrong}>
                  {f.display_name || t('admin.users.noName')} · {f.phone_masked ?? '-'}
                </Text>
                <Text style={adminStyles.cellMuted}>
                  {t('admin.staff.formerWas', { role: f.team_role ?? t(`admin.roles.${f.role}`), when: formatDate(f.removed_at, i18n.language) })}
                </Text>
              </View>
              <SecondaryButton main label={t('admin.staff.addBack')} onPress={() => setPerson(f)} />
            </View>
          ))}
        </Panel>
      ) : null}

      <Panel title={t('admin.staff.teamRoles')} actions={<SecondaryButton main label={t('admin.staff.newRole')} onPress={() => setRole('new')} />}>
        <Text style={adminStyles.cellMuted}>{t('admin.staff.teamRolesHelp')}</Text>
        <QueryState query={roles} isEmpty={(rows) => rows.length === 0}>
          {(rows) => <RolesGrid roles={rows} editable onSaved={refresh} onEditRole={(r) => setRole(r)} />}
        </QueryState>
      </Panel>

      {adding ? <StaffDialog roles={roles.data ?? []} onDone={refresh} onClose={() => setAdding(false)} /> : null}
      {editing ? <StaffDialog row={editing} roles={roles.data ?? []} onDone={refresh} onClose={() => setEditing(null)} /> : null}
      {person ? <StaffDialog person={person} roles={roles.data ?? []} onDone={refresh} onClose={() => setPerson(null)} /> : null}
      {changingInvite ? <StaffDialog invite={changingInvite} roles={roles.data ?? []} onDone={refresh} onClose={() => setChangingInvite(null)} /> : null}
      {role ? <RoleDialog role={role === 'new' ? null : role} onDone={refresh} onClose={() => setRole(null)} /> : null}
      {cancelling ? (
        <FormDialog
          title={t('admin.staff.cancelInviteTitle', { phone: cancelling.phone_masked })}
          text={t('admin.staff.cancelInviteText')}
          confirmLabel={t('admin.staff.cancelInvite')}
          cancelLabel={t('admin.staff.keepInvite')}
          danger
          onCancel={() => setCancelling(null)}
          onConfirm={async () => {
            await api.del(`/admin/staff-invites/${cancelling.phone_key}`);
            await refresh();
            setCancelling(null);
          }}
        />
      ) : null}
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

/** An existing account to make staff. A removed staff member brings the role and permissions they had. */
type Picked = { profile_id: string; display_name: string | null } & Partial<Pick<FormerStaff, 'phone_masked' | 'role' | 'team_role_id' | 'permissions'>>;

/**
 * One box for four jobs: add by phone number (nothing given), change a staff member (row), make an existing account
 * staff without typing its number (person), or change a waiting invite (invite). A team role or hand-picked permissions.
 */
function StaffDialog({ row, person, invite, roles, onDone, onClose }: { row?: StaffRow; person?: Picked; invite?: StaffInvite; roles: TeamRole[]; onDone: () => Promise<unknown>; onClose: () => void }) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  // What they have now, had before, or were invited with. A team role that has since been deleted falls back to hand-picked.
  const from = row ?? invite ?? (person?.role ? person : undefined);
  const knownTeam = from?.team_role_id && roles.some((r) => r.id === from.team_role_id) ? from.team_role_id : null;
  const [role, setRole] = useState<StaffRole>(from?.role ?? 'sub_admin');
  const [team, setTeam] = useState<string>(knownTeam ?? (from ? 'custom' : roles[0]?.id ?? 'custom'));
  const [granted, setGranted] = useState<Grantable[]>(from?.permissions ?? []);
  const [invited, setInvited] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const action = useAction();

  const e164 = toE164(phone);
  const phoneOk = !!row || !!person || !!invite || !!e164;
  const missing = [
    !phoneOk && t('admin.staff.needPhone'),
    role === 'sub_admin' && team === 'custom' && granted.length === 0 && t('admin.staff.needPermission'),
  ];
  const ready = !missing.some(Boolean);
  // Making someone an AYWO Admin hands over everything, so it is never one chip and Save.
  const promoting = role === 'aywo_admin' && row?.role !== 'aywo_admin';
  const who = row
    ? row.display_name || t('admin.users.noName')
    : person
      ? person.display_name || t('admin.users.noName')
      : invite
        ? invite.phone_masked
        : phone.trim();

  async function save() {
    const body = {
      role,
      permissions: role === 'sub_admin' && team === 'custom' ? granted : [],
      team_role_id: role === 'sub_admin' && team !== 'custom' ? team : null,
    };
    let waitsForSignIn = false;
    const ok = await action.run(async () => {
      if (row) await api.patch(`/admin/staff/${row.profile_id}`, body);
      else if (invite) await api.patch(`/admin/staff-invites/${invite.phone_key}`, body);
      else if (person) await api.post('/admin/staff', { profile_id: person.profile_id, ...body });
      else {
        const answer = await api.post<{ invited?: boolean }>('/admin/staff', { phone: e164, ...body });
        waitsForSignIn = !!answer?.invited;
      }
      await onDone();
    });
    if (ok && waitsForSignIn) setInvited(true);
    else if (ok) onClose();
  }

  if (confirming && !invited) {
    return (
      <DialogFrame title={t('admin.staff.promoteTitle', { name: who })} text={t('admin.staff.promoteText', { name: who })}>
        <Message text={t('admin.staff.promoteWarn')} alert />
        {action.failure ? <Message text={action.failure} alert /> : null}
        <Actions>
          <SecondaryButton label={t('admin.staff.promoteBack')} onPress={() => setConfirming(false)} disabled={action.busy} />
          <SecondaryButton main label={t('admin.staff.promoteConfirm')} danger onPress={save} disabled={action.busy} />
        </Actions>
      </DialogFrame>
    );
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
    <DialogFrame
      title={row ? t('admin.staff.changeTitle', { name: who }) : invite ? t('admin.staff.changeInviteTitle', { phone: who }) : person ? t('admin.staff.addPersonTitle', { name: who }) : t('admin.staff.addTitle')}
      text={row ? undefined : invite ? t('admin.staff.changeInviteText') : person ? t('admin.staff.addPersonText') : t('admin.staff.addText')}
    >
      {row || person || invite ? null : <PhoneField label={t('admin.staff.phone')} value={phone} onChangeText={setPhone} invalid={!!phone && !e164} />}
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
      <Missing reasons={missing} />
      <Actions>
        <SecondaryButton label={t('admin.common.cancel')} onPress={onClose} disabled={action.busy} />
        <SecondaryButton main label={t('admin.common.save')} onPress={promoting ? () => setConfirming(true) : save} disabled={action.busy || !ready} />
      </Actions>
    </DialogFrame>
  );
}

function RoleDialog({ role, onDone, onClose }: { role: TeamRole | null; onDone: () => Promise<unknown>; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [granted, setGranted] = useState<Grantable[]>(role?.permissions ?? []);
  const [confirming, setConfirming] = useState<'save' | 'delete' | null>(null);
  const action = useAction();
  const members = role?.members ?? 0;
  const before = role?.permissions ?? [];
  const added = granted.filter((p) => !before.includes(p));
  const removed = before.filter((p) => !granted.includes(p));
  // Only a change of permissions reaches the people in the role. A new name or description is an ordinary save.
  const reGrants = members > 0 && (added.length > 0 || removed.length > 0);
  const names = (list: Grantable[]) => list.map((p) => t(`admin.permissions.${p}`)).join(', ');
  const missing = [name.trim().length < 2 && t('admin.staff.needRoleName'), granted.length === 0 && t('admin.staff.needRolePermission')];
  const ready = !missing.some(Boolean);

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

  if (confirming === 'delete' && role) {
    return (
      <DialogFrame title={t('admin.staff.deleteRoleTitle', { name: role.name })} text={t('admin.staff.deleteRoleText')}>
        {action.failure ? <Message text={action.failure} alert /> : null}
        <Actions>
          <SecondaryButton label={t('admin.offers.backToEdit')} onPress={() => setConfirming(null)} disabled={action.busy} />
          <SecondaryButton main label={t('admin.staff.deleteRole')} danger onPress={remove} disabled={action.busy} />
        </Actions>
      </DialogFrame>
    );
  }
  if (confirming === 'save' && role) {
    return (
      <DialogFrame title={t('admin.staff.roleConfirmTitle', { name: role.name })} text={t('admin.staff.roleChangesAll', { count: members })}>
        {added.length ? <Message text={t('admin.staff.roleGains', { list: names(added) })} alert /> : null}
        {removed.length ? <Message text={t('admin.staff.roleLoses', { list: names(removed) })} alert /> : null}
        {action.failure ? <Message text={action.failure} alert /> : null}
        <Actions>
          <SecondaryButton label={t('admin.offers.backToEdit')} onPress={() => setConfirming(null)} disabled={action.busy} />
          <SecondaryButton main label={t('admin.offers.confirmSave')} danger onPress={save} disabled={action.busy} />
        </Actions>
      </DialogFrame>
    );
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
      {role && members > 0 ? <Text style={adminStyles.cellMuted}>{t('admin.staff.deleteRoleBlocked')}</Text> : null}
      <Missing reasons={missing} />
      <Actions>
        {role && members === 0 ? <SecondaryButton label={t('admin.staff.deleteRole')} danger onPress={() => setConfirming('delete')} disabled={action.busy} /> : null}
        <SecondaryButton label={t('admin.common.cancel')} onPress={onClose} disabled={action.busy} />
        <SecondaryButton main label={t('admin.common.save')} onPress={reGrants ? () => setConfirming('save') : save} disabled={action.busy || !ready} />
      </Actions>
    </DialogFrame>
  );
}
