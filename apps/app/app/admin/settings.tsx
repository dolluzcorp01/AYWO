// App settings that change the live apps without a new release: forced update, maintenance, feature switches,
// what's new. Below them, crash reports from the apps.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { useAdminAccess } from '@/admin/access';
import type { AdminConfig, AppHealth, ConfigKey } from '@/admin/types';
import { Actions, AdminPage, adminStyles, Checkbox, DataTable, Field, FilterChips, formatDate, FormDialog, Message, Panel, Pill, QueryState, SecondaryButton } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import { api } from '@/lib/api';

export default function AdminSettings() {
  const { t } = useTranslation();
  const access = useAdminAccess();
  const [tab, setTab] = useState<'controls' | 'health'>(access.can(['settings']) ? 'controls' : 'health');
  return (
    <AdminPage title={t('admin.settings.title')} subtitle={t('admin.settings.subtitle')} gates={['settings', 'analytics']}>
      {access.can(['settings']) ? (
        <FilterChips
          value={tab}
          onChange={setTab}
          options={[
            { value: 'controls', label: t('admin.settings.controls') },
            { value: 'health', label: t('admin.settings.health') },
          ]}
        />
      ) : null}
      {tab === 'controls' ? <Controls /> : <Health />}
    </AdminPage>
  );
}

function Controls() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['admin', 'config'], queryFn: () => api.get<AdminConfig>('/admin/config') });
  const [pending, setPending] = useState<{ key: ConfigKey; value: Record<string, unknown> } | null>(null);

  return (
    <QueryState query={query}>
      {(config) => {
        const updated = (key: ConfigKey) =>
          t('admin.settings.updated', { when: formatDate(config[key].updated_at, i18n.language), name: config[key].updated_by_name ?? t('admin.settings.setup') });
        return (
          <>
            <VersionPanel config={config} onSave={(key, value) => setPending({ key, value })} updated={updated} />
            <MaintenancePanel value={config.maintenance.value} onSave={(value) => setPending({ key: 'maintenance', value })} updated={updated('maintenance')} />
            <FeaturesPanel value={config.features.value as Record<string, boolean>} onSave={(value) => setPending({ key: 'features', value })} updated={updated('features')} />
            <WhatsNewPanel value={config.whats_new.value} onSave={(value) => setPending({ key: 'whats_new', value })} updated={updated('whats_new')} />
            {pending ? (
              <FormDialog
                title={t('admin.settings.confirmTitle')}
                text={t(`admin.settings.confirm.${pending.key}`)}
                fields={[{ name: 'reason', label: t('admin.common.reason'), minLength: 5, multiline: true }]}
                confirmLabel={t('admin.common.save')}
                danger={pending.key === 'maintenance' || pending.key === 'min_version'}
                onCancel={() => setPending(null)}
                onConfirm={async ({ reason }) => {
                  await api.patch(`/admin/config/${pending.key}`, { value: pending.value, reason });
                  await client.invalidateQueries({ queryKey: ['admin', 'config'] });
                  setPending(null);
                }}
              />
            ) : null}
          </>
        );
      }}
    </QueryState>
  );
}

function VersionPanel({ config, onSave, updated }: { config: AdminConfig; onSave: (key: ConfigKey, value: Record<string, unknown>) => void; updated: (key: ConfigKey) => string }) {
  const { t } = useTranslation();
  const min = config.min_version.value as { ios: string; android: string };
  const latest = config.latest_version.value as { ios: string; android: string };
  const [minIos, setMinIos] = useState(min.ios);
  const [minAndroid, setMinAndroid] = useState(min.android);
  const [latestIos, setLatestIos] = useState(latest.ios);
  const [latestAndroid, setLatestAndroid] = useState(latest.android);
  const ok = (v: string) => /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v.trim());
  return (
    <Panel title={t('admin.settings.versions')}>
      <Text style={adminStyles.cellMuted}>{t('admin.settings.versionsHelp')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <View style={{ flexBasis: 240, flexGrow: 1 }}><Field label={t('admin.settings.minIos')} value={minIos} onChange={setMinIos} maxLength={11} /></View>
        <View style={{ flexBasis: 240, flexGrow: 1 }}><Field label={t('admin.settings.minAndroid')} value={minAndroid} onChange={setMinAndroid} maxLength={11} /></View>
      </View>
      <Text style={adminStyles.cellMuted}>{updated('min_version')}</Text>
      <Actions>
        <SecondaryButton label={t('admin.settings.saveMin')} danger disabled={!ok(minIos) || !ok(minAndroid)} onPress={() => onSave('min_version', { ios: minIos.trim(), android: minAndroid.trim() })} />
      </Actions>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <View style={{ flexBasis: 240, flexGrow: 1 }}><Field label={t('admin.settings.latestIos')} value={latestIos} onChange={setLatestIos} maxLength={11} /></View>
        <View style={{ flexBasis: 240, flexGrow: 1 }}><Field label={t('admin.settings.latestAndroid')} value={latestAndroid} onChange={setLatestAndroid} maxLength={11} /></View>
      </View>
      <Text style={adminStyles.cellMuted}>{updated('latest_version')}</Text>
      <Actions>
        <SecondaryButton label={t('admin.settings.saveLatest')} disabled={!ok(latestIos) || !ok(latestAndroid)} onPress={() => onSave('latest_version', { ios: latestIos.trim(), android: latestAndroid.trim() })} />
      </Actions>
    </Panel>
  );
}

function MaintenancePanel({ value, onSave, updated }: { value: Record<string, unknown>; onSave: (v: Record<string, unknown>) => void; updated: string }) {
  const { t } = useTranslation();
  const [on, setOn] = useState(Boolean(value.on));
  const [message, setMessage] = useState(String(value.message ?? ''));
  return (
    <Panel title={t('admin.settings.maintenance')} actions={value.on ? <Pill label={t('admin.settings.maintenanceOn')} alert /> : null}>
      <Text style={adminStyles.cellMuted}>{t('admin.settings.maintenanceHelp')}</Text>
      <Checkbox label={t('admin.settings.maintenanceSwitch')} checked={on} onChange={setOn} />
      <Field label={t('admin.settings.maintenanceMessage')} value={message} onChange={setMessage} multiline maxLength={300} />
      <Text style={adminStyles.cellMuted}>{updated}</Text>
      <Actions>
        <SecondaryButton label={t('admin.common.save')} danger={on} onPress={() => onSave({ on, message: message.trim() })} />
      </Actions>
    </Panel>
  );
}

function FeaturesPanel({ value, onSave, updated }: { value: Record<string, boolean>; onSave: (v: Record<string, unknown>) => void; updated: string }) {
  const { t } = useTranslation();
  const [flags, setFlags] = useState(value);
  return (
    <Panel title={t('admin.settings.features')}>
      <Text style={adminStyles.cellMuted}>{t('admin.settings.featuresHelp')}</Text>
      {Object.keys(flags).map((key) => (
        <Checkbox key={key} label={t(`admin.settings.feature.${key}`, { defaultValue: key })} checked={flags[key]} onChange={(on) => setFlags((old) => ({ ...old, [key]: on }))} />
      ))}
      <Text style={adminStyles.cellMuted}>{updated}</Text>
      <Actions>
        <SecondaryButton label={t('admin.common.save')} onPress={() => onSave(flags)} />
      </Actions>
    </Panel>
  );
}

function WhatsNewPanel({ value, onSave, updated }: { value: Record<string, unknown>; onSave: (v: Record<string, unknown>) => void; updated: string }) {
  const { t } = useTranslation();
  const [version, setVersion] = useState(String(value.version ?? '1.0.0'));
  const [items, setItems] = useState(((value.items as string[] | undefined) ?? []).join('\n'));
  const list = items.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 6);
  return (
    <Panel title={t('admin.settings.whatsNew')}>
      <Text style={adminStyles.cellMuted}>{t('admin.settings.whatsNewHelp')}</Text>
      <Field label={t('admin.settings.forVersion')} value={version} onChange={setVersion} maxLength={11} />
      <Field label={t('admin.settings.whatsNewItems')} value={items} onChange={setItems} multiline maxLength={900} />
      <Text style={adminStyles.cellMuted}>{updated}</Text>
      <Actions>
        <SecondaryButton label={t('admin.common.save')} disabled={!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version.trim())} onPress={() => onSave({ version: version.trim(), items: list })} />
      </Actions>
    </Panel>
  );
}

function Health() {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState<'1' | '7' | '30'>('7');
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['admin', 'health', days], queryFn: () => api.get<AppHealth>(`/admin/health?days=${days}`) });
  const columns: Column<AppHealth['errors'][number]>[] = [
    {
      key: 'msg',
      label: t('admin.settings.crash'),
      flex: 2.4,
      render: (e) => (
        <View style={{ gap: 4 }}>
          <Text style={adminStyles.cellStrong}>{e.message}</Text>
          <Text style={adminStyles.cellMuted}>{e.routes.filter(Boolean).join(', ') || '-'}</Text>
          {open === e.fingerprint && e.stack ? <Text selectable style={adminStyles.cellMuted}>{e.stack}</Text> : null}
        </View>
      ),
    },
    { key: 'count', label: t('admin.settings.times'), flex: 0.6, render: (e) => `${e.count}` },
    { key: 'people', label: t('admin.settings.people'), flex: 0.6, render: (e) => `${e.people}` },
    { key: 'where', label: t('admin.settings.where'), render: (e) => `${e.platforms.join(', ')} · ${e.versions.filter(Boolean).join(', ') || '-'}` },
    { key: 'last', label: t('admin.settings.lastSeen'), render: (e) => formatDate(e.last_seen, i18n.language) },
    {
      key: 'more',
      label: t('admin.common.actions'),
      flex: 0.7,
      render: (e) => (e.stack ? <SecondaryButton label={open === e.fingerprint ? t('admin.work.close') : t('admin.settings.stack')} onPress={() => setOpen(open === e.fingerprint ? null : e.fingerprint)} /> : '-'),
    },
  ];
  return (
    <>
      <Text style={adminStyles.cellMuted}>{t('admin.settings.healthHelp')}</Text>
      <FilterChips
        value={days}
        onChange={setDays}
        options={[
          { value: '1', label: t('admin.analytics.lastDays', { count: 1 }) },
          { value: '7', label: t('admin.analytics.lastDays', { count: 7 }) },
          { value: '30', label: t('admin.analytics.lastDays', { count: 30 }) },
        ]}
      />
      <QueryState query={query}>
        {(data) => (
          <>
            <ServerHealth data={data} />
            <Text style={adminStyles.cellStrong}>{t('admin.ops.appCrashes')}</Text>
            {data.errors.length === 0 ? (
              <Message text={t('admin.settings.noCrashes')} />
            ) : (
              <>
                <Message text={t('admin.settings.crashTotal', { count: data.total })} />
                <DataTable columns={columns} rows={data.errors} rowKey={(e) => e.fingerprint} />
              </>
            )}
          </>
        )}
      </QueryState>
    </>
  );
}

/** Backups, background jobs and server errors: what the people running AYWO need to see first when something breaks. */
const STALE_HOURS = 36;
function ServerHealth({ data }: { data: AppHealth }) {
  const { t, i18n } = useTranslation();
  const lastGood = data.last_good_backup ? new Date(data.last_good_backup) : null;
  const hours = lastGood ? Math.round((Date.now() - lastGood.getTime()) / 3_600_000) : null;
  const lastRun = data.backups[0];
  const backupProblem = !lastGood || (hours !== null && hours > STALE_HOURS) || lastRun?.ok === false;
  const failing = data.job_status.filter((j) => j.failures_in_row >= 3);
  const mb = (bytes: number | null) => (bytes === null ? '-' : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

  const backupColumns: Column<AppHealth['backups'][number]>[] = [
    { key: 'when', label: t('admin.ops.when'), render: (b) => formatDate(b.started_at, i18n.language) },
    { key: 'result', label: t('admin.ops.result'), flex: 0.7, render: (b) => (b.ok === null ? t('admin.ops.running') : b.ok ? t('admin.ops.ok') : t('admin.ops.failed')) },
    { key: 'size', label: t('admin.ops.size'), flex: 0.6, render: (b) => mb(b.bytes) },
    { key: 'detail', label: t('admin.ops.detail'), flex: 2, render: (b) => b.error ?? b.object_key ?? '-' },
  ];
  const jobColumns: Column<AppHealth['job_status'][number]>[] = [
    { key: 'name', label: t('admin.ops.job'), render: (j) => j.name },
    { key: 'ok', label: t('admin.ops.lastOk'), render: (j) => (j.last_ok_at ? formatDate(j.last_ok_at, i18n.language) : '-') },
    { key: 'fails', label: t('admin.ops.failuresInRow'), flex: 0.6, render: (j) => `${j.failures_in_row}` },
    { key: 'err', label: t('admin.ops.lastError'), flex: 2, render: (j) => (j.failures_in_row > 0 ? (j.last_error ?? '-') : '-') },
  ];
  const errorColumns: Column<AppHealth['server_errors'][number]>[] = [
    { key: 'route', label: t('admin.ops.route'), render: (e) => e.route },
    { key: 'msg', label: t('admin.settings.crash'), flex: 2, render: (e) => e.message },
    { key: 'count', label: t('admin.settings.times'), flex: 0.5, render: (e) => `${e.count}` },
    { key: 'last', label: t('admin.settings.lastSeen'), render: (e) => formatDate(e.last_seen, i18n.language) },
  ];

  return (
    <>
      <Panel title={t('admin.ops.backups')}>
        <Message
          alert={backupProblem}
          text={
            lastGood
              ? t('admin.ops.lastGood', { when: formatDate(lastGood.toISOString(), i18n.language), count: hours ?? 0 })
              : t('admin.ops.noBackup')
          }
        />
        {data.backups.length ? <DataTable columns={backupColumns} rows={data.backups.slice(0, 7)} rowKey={(b) => `${b.id}`} /> : null}
      </Panel>
      <Panel title={t('admin.ops.jobs')}>
        <Message alert={failing.length > 0} text={failing.length ? t('admin.ops.jobsFailing', { names: failing.map((j) => j.name).join(', ') }) : t('admin.ops.jobsFine')} />
        {data.job_status.length ? <DataTable columns={jobColumns} rows={data.job_status} rowKey={(j) => j.name} /> : null}
      </Panel>
      <Panel title={t('admin.ops.serverErrors')}>
        <Message alert={data.server_error_total > 0} text={t('admin.ops.serverErrorTotal', { count: data.server_error_total })} />
        {data.server_errors.length ? <DataTable columns={errorColumns} rows={data.server_errors} rowKey={(e) => `${e.route}|${e.message}`} /> : null}
      </Panel>
    </>
  );
}
