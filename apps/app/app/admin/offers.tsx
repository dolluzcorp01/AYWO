// Marketing: coupons for posters, books and premium invites; scrolling banners in the app and on the website;
// promotional push messages to people who switched them on. Plus discounts inside the iPhone and Android apps must use
// Apple's and Google's own offer codes, so coupons here never touch Plus.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import type { Announcement, Campaign, Coupon } from '@/admin/types';
import { Actions, AdminPage, adminStyles, Checkbox, DataTable, DialogFrame, Field, FilterChips, formatDate, FormDialog, Message, money, Pill, QueryState, SecondaryButton, useAction } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import { api } from '@/lib/api';

type Tab = 'coupons' | 'banners' | 'messages';
const PRODUCTS = ['tree_poster', 'family_book', 'premium_invite'] as const;

/** A date box in yyyy-mm-dd; empty means none. Turned into the start or end of that day, India time. */
function dayToIso(day: string, endOfDay: boolean): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.trim())) return null;
  return `${day.trim()}T${endOfDay ? '23:59:59' : '00:00:00'}+05:30`;
}
const isoToDay = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

export default function AdminOffers() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('coupons');
  return (
    <AdminPage title={t('admin.offers.title')} subtitle={t('admin.offers.subtitle')} gates={['marketing']}>
      <FilterChips
        value={tab}
        onChange={setTab}
        options={[
          { value: 'coupons', label: t('admin.offers.coupons') },
          { value: 'banners', label: t('admin.offers.banners') },
          { value: 'messages', label: t('admin.offers.messages') },
        ]}
      />
      {tab === 'coupons' ? <Coupons /> : tab === 'banners' ? <Banners /> : <Messages />}
    </AdminPage>
  );
}

// ===== Coupons =====
function Coupons() {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<'active' | 'ended' | 'all'>('active');
  const [editing, setEditing] = useState<Coupon | 'new' | null>(null);
  const query = useQuery({ queryKey: ['admin', 'coupons', view], queryFn: () => api.get<Coupon[]>(`/admin/coupons?view=${view}`) });

  const off = (c: Coupon) => (c.kind === 'percent' ? `${c.value}%` : money(c.value, c.currency ?? 'INR', i18n.language));
  const columns: Column<Coupon>[] = [
    {
      key: 'code',
      label: t('admin.offers.code'),
      flex: 1.4,
      render: (c) => (
        <View>
          <Text style={adminStyles.cellStrong}>{c.code}</Text>
          <Text style={adminStyles.cellMuted}>{c.title}</Text>
        </View>
      ),
    },
    { key: 'off', label: t('admin.offers.off'), flex: 0.7, render: off },
    { key: 'on', label: t('admin.offers.on'), render: (c) => c.products.map((p) => t(`admin.orders.products.${p}`)).join(', ') },
    {
      key: 'when',
      label: t('admin.offers.when'),
      render: (c) => `${isoToDay(c.starts_at)} – ${c.ends_at ? isoToDay(c.ends_at) : t('admin.offers.noEnd')}`,
    },
    {
      key: 'used',
      label: t('admin.offers.used'),
      flex: 0.9,
      render: (c) => (
        <View>
          <Text style={adminStyles.cellStrong}>{c.max_uses ? `${c.uses} / ${c.max_uses}` : c.uses}</Text>
          <Text style={adminStyles.cellMuted}>{money(c.discount_given_minor, c.currency ?? 'INR', i18n.language)}</Text>
        </View>
      ),
    },
    {
      key: 'state',
      label: t('admin.offers.state'),
      flex: 0.9,
      render: (c) => (
        <Actions>
          <Pill label={c.running ? t('admin.offers.running') : c.active ? t('admin.offers.scheduled') : t('admin.offers.off_')} alert={!c.active} />
          {c.public ? <Pill label={t('admin.offers.shown')} /> : null}
        </Actions>
      ),
    },
    { key: 'edit', label: t('admin.common.actions'), flex: 0.7, render: (c) => <SecondaryButton label={t('admin.staff.change')} onPress={() => setEditing(c)} /> },
  ];

  return (
    <>
      <Text style={adminStyles.cellMuted}>{t('admin.offers.couponsHelp')}</Text>
      <Actions>
        <FilterChips
          value={view}
          onChange={setView}
          options={[
            { value: 'active', label: t('admin.offers.views.active') },
            { value: 'ended', label: t('admin.offers.views.ended') },
            { value: 'all', label: t('admin.payments.all') },
          ]}
        />
        <SecondaryButton label={t('admin.offers.newCoupon')} onPress={() => setEditing('new')} />
      </Actions>
      <QueryState query={query} isEmpty={(rows) => rows.length === 0} emptyText={t('admin.offers.noCoupons')}>
        {(rows) => <DataTable columns={columns} rows={rows} rowKey={(c) => c.id} />}
      </QueryState>
      {editing ? <CouponDialog coupon={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function CouponDialog({ coupon, onClose }: { coupon: Coupon | null; onClose: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const used = (coupon?.uses ?? 0) > 0;
  const [code, setCode] = useState(coupon?.code ?? '');
  const [title, setTitle] = useState(coupon?.title ?? '');
  const [description, setDescription] = useState(coupon?.description ?? '');
  const [kind, setKind] = useState<'percent' | 'amount'>(coupon?.kind ?? 'percent');
  const [value, setValue] = useState(coupon ? String(coupon.kind === 'amount' ? coupon.value / 100 : coupon.value) : '');
  const [currency, setCurrency] = useState<'INR' | 'USD'>(coupon?.currency ?? 'INR');
  const [products, setProducts] = useState<string[]>(coupon?.products ?? ['tree_poster', 'family_book']);
  const [starts, setStarts] = useState(isoToDay(coupon?.starts_at) || new Date().toISOString().slice(0, 10));
  const [ends, setEnds] = useState(isoToDay(coupon?.ends_at));
  const [maxUses, setMaxUses] = useState(coupon?.max_uses ? String(coupon.max_uses) : '');
  const [perUser, setPerUser] = useState(String(coupon?.per_user_limit ?? 1));
  const [newOnly, setNewOnly] = useState(coupon?.new_users_only ?? false);
  const [shown, setShown] = useState(coupon?.public ?? false);
  const [active, setActive] = useState(coupon?.active ?? true);
  const action = useAction();

  async function save() {
    const amount = Number(value);
    const body: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || null,
      products,
      starts_at: dayToIso(starts, false) ?? undefined,
      ends_at: ends ? dayToIso(ends, true) : null,
      max_uses: maxUses ? Number(maxUses) : null,
      per_user_limit: Number(perUser) || 1,
      new_users_only: newOnly,
      public: shown,
      active,
    };
    if (!used) {
      Object.assign(body, { code: code.trim().toUpperCase(), kind, value: kind === 'amount' ? Math.round(amount * 100) : Math.round(amount), currency: kind === 'amount' ? currency : null });
    }
    const ok = await action.run(() => (coupon ? api.patch(`/admin/coupons/${coupon.id}`, body) : api.post('/admin/coupons', body)));
    if (ok) {
      await client.invalidateQueries({ queryKey: ['admin', 'coupons'] });
      onClose();
    }
  }

  return (
    <DialogFrame title={coupon ? t('admin.offers.editCoupon', { code: coupon.code }) : t('admin.offers.newCoupon')} text={used ? t('admin.offers.usedNote') : undefined}>
      {!used ? <Field label={t('admin.offers.code')} value={code} onChange={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, ''))} maxLength={20} help={t('admin.offers.codeHelp')} /> : null}
      <Field label={t('admin.offers.titleLabel')} value={title} onChange={setTitle} maxLength={80} />
      <Field label={t('admin.offers.description')} value={description} onChange={setDescription} multiline maxLength={300} />
      {!used ? (
        <>
          <FilterChips value={kind} onChange={setKind} options={[{ value: 'percent', label: t('admin.offers.percent') }, { value: 'amount', label: t('admin.offers.amount') }]} />
          <Field label={kind === 'percent' ? t('admin.offers.percentValue') : t('admin.offers.amountValue')} value={value} onChange={(v) => setValue(v.replace(/[^\d.]/g, ''))} maxLength={7} />
          {kind === 'amount' ? <FilterChips value={currency} onChange={setCurrency} options={[{ value: 'INR', label: 'INR' }, { value: 'USD', label: 'USD' }]} /> : null}
        </>
      ) : null}
      <Text style={adminStyles.fieldLabel}>{t('admin.offers.on')}</Text>
      {PRODUCTS.map((p) => (
        <Checkbox key={p} label={t(`admin.orders.products.${p}`)} checked={products.includes(p)} onChange={(on) => setProducts((old) => (on ? [...old, p] : old.filter((x) => x !== p)))} />
      ))}
      <Field label={t('admin.offers.starts')} value={starts} onChange={setStarts} maxLength={10} placeholder="2026-11-03" />
      <Field label={t('admin.offers.ends')} value={ends} onChange={setEnds} maxLength={10} placeholder={t('admin.offers.noEnd')} />
      <Field label={t('admin.offers.maxUses')} value={maxUses} onChange={(v) => setMaxUses(v.replace(/\D/g, ''))} maxLength={7} placeholder={t('admin.offers.noLimit')} />
      <Field label={t('admin.offers.perUser')} value={perUser} onChange={(v) => setPerUser(v.replace(/\D/g, ''))} maxLength={3} />
      <Checkbox label={t('admin.offers.newOnly')} checked={newOnly} onChange={setNewOnly} />
      <Checkbox label={t('admin.offers.showInApp')} checked={shown} onChange={setShown} />
      <Checkbox label={t('admin.offers.activeLabel')} checked={active} onChange={setActive} />
      {action.failure ? <Message text={action.failure} alert /> : null}
      <Actions>
        <SecondaryButton label={t('admin.common.cancel')} onPress={onClose} disabled={action.busy} />
        <SecondaryButton label={t('admin.common.save')} onPress={save} disabled={action.busy || title.trim().length < 3 || products.length === 0 || (!used && (code.length < 4 || !value))} />
      </Actions>
    </DialogFrame>
  );
}

// ===== Banners =====
function Banners() {
  const { t } = useTranslation();
  const [view, setView] = useState<'active' | 'ended' | 'all'>('active');
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null);
  const query = useQuery({ queryKey: ['admin', 'announcements', view], queryFn: () => api.get<Announcement[]>(`/admin/announcements?view=${view}`) });

  const columns: Column<Announcement>[] = [
    {
      key: 'text',
      label: t('admin.offers.banner'),
      flex: 2,
      render: (a) => (
        <View>
          <Text style={adminStyles.cellStrong}>{a.title}</Text>
          {a.body ? <Text style={adminStyles.cellMuted}>{a.body}</Text> : null}
        </View>
      ),
    },
    { key: 'where', label: t('admin.offers.where'), render: (a) => a.placements.map((p) => t(`admin.offers.placements.${p}`)).join(', ') },
    { key: 'who', label: t('admin.offers.who'), flex: 0.8, render: (a) => t(`admin.offers.audiences.${a.audience}`) },
    { key: 'when', label: t('admin.offers.when'), render: (a) => `${isoToDay(a.starts_at)} – ${a.ends_at ? isoToDay(a.ends_at) : t('admin.offers.noEnd')}` },
    {
      key: 'stats',
      label: t('admin.offers.reach'),
      render: (a) => (
        <Text style={adminStyles.cellMuted}>
          {t('admin.offers.reachText', { seen: a.seen + a.visitor_views, clicked: a.clicked, closed: a.dismissed })}
        </Text>
      ),
    },
    {
      key: 'state',
      label: t('admin.offers.state'),
      flex: 0.8,
      render: (a) => <Pill label={a.running ? t('admin.offers.running') : a.active ? t('admin.offers.scheduled') : t('admin.offers.off_')} alert={!a.active} />,
    },
    { key: 'edit', label: t('admin.common.actions'), flex: 0.7, render: (a) => <SecondaryButton label={t('admin.staff.change')} onPress={() => setEditing(a)} /> },
  ];

  return (
    <>
      <Text style={adminStyles.cellMuted}>{t('admin.offers.bannersHelp')}</Text>
      <Actions>
        <FilterChips
          value={view}
          onChange={setView}
          options={[
            { value: 'active', label: t('admin.offers.views.active') },
            { value: 'ended', label: t('admin.offers.views.ended') },
            { value: 'all', label: t('admin.payments.all') },
          ]}
        />
        <SecondaryButton label={t('admin.offers.newBanner')} onPress={() => setEditing('new')} />
      </Actions>
      <QueryState query={query} isEmpty={(rows) => rows.length === 0} emptyText={t('admin.offers.noBanners')}>
        {(rows) => <DataTable columns={columns} rows={rows} rowKey={(a) => a.id} />}
      </QueryState>
      {editing ? <BannerDialog item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function BannerDialog({ item, onClose }: { item: Announcement | null; onClose: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [link, setLink] = useState(item?.link_url ?? '');
  const [linkLabel, setLinkLabel] = useState(item?.link_label ?? '');
  const [style, setStyle] = useState<Announcement['style']>(item?.style ?? 'offer');
  const [placements, setPlacements] = useState<Announcement['placements']>(item?.placements ?? ['app_banner']);
  const [audience, setAudience] = useState<Announcement['audience']>(item?.audience ?? 'everyone');
  const [region, setRegion] = useState<Announcement['region']>(item?.region ?? 'all');
  const [language, setLanguage] = useState<'all' | 'en' | 'ta'>((item?.languages?.[0] as 'en' | 'ta' | undefined) ?? 'all');
  const [starts, setStarts] = useState(isoToDay(item?.starts_at) || new Date().toISOString().slice(0, 10));
  const [ends, setEnds] = useState(isoToDay(item?.ends_at));
  const [priority, setPriority] = useState(String(item?.priority ?? 0));
  const [dismissible, setDismissible] = useState(item?.dismissible ?? true);
  const [active, setActive] = useState(item?.active ?? true);
  const action = useAction();
  const linkOk = !link.trim() || /^\/[A-Za-z0-9/_?=&.-]*$/.test(link.trim()) || /^https:\/\/\S+$/.test(link.trim());

  async function save() {
    const data = {
      title: title.trim(),
      body: body.trim() || null,
      link_url: link.trim() || null,
      link_label: linkLabel.trim() || null,
      style,
      placements,
      audience,
      region,
      languages: language === 'all' ? null : [language],
      starts_at: dayToIso(starts, false) ?? undefined,
      ends_at: ends ? dayToIso(ends, true) : null,
      priority: Math.min(100, Number(priority) || 0),
      dismissible,
      active,
    };
    const ok = await action.run(() => (item ? api.patch(`/admin/announcements/${item.id}`, data) : api.post('/admin/announcements', data)));
    if (ok) {
      await client.invalidateQueries({ queryKey: ['admin', 'announcements'] });
      onClose();
    }
  }

  const togglePlacement = (p: Announcement['placements'][number], on: boolean) =>
    setPlacements((old) => (on ? [...old, p] : old.filter((x) => x !== p)));

  return (
    <DialogFrame title={item ? t('admin.offers.editBanner') : t('admin.offers.newBanner')}>
      <Field label={t('admin.offers.bannerTitle')} value={title} onChange={setTitle} maxLength={80} help={t('admin.offers.bannerTitleHelp')} />
      <Field label={t('admin.offers.bannerBody')} value={body} onChange={setBody} multiline maxLength={200} />
      <Field label={t('admin.offers.link')} value={link} onChange={setLink} maxLength={300} placeholder="/offers" help={t('admin.offers.linkHelp')} />
      <Field label={t('admin.offers.linkLabel')} value={linkLabel} onChange={setLinkLabel} maxLength={30} />
      <Text style={adminStyles.fieldLabel}>{t('admin.offers.style')}</Text>
      <FilterChips value={style} onChange={setStyle} options={(['offer', 'info', 'celebration', 'warning'] as const).map((s) => ({ value: s, label: t(`admin.offers.styles.${s}`) }))} />
      <Text style={adminStyles.fieldLabel}>{t('admin.offers.where')}</Text>
      {(['app_banner', 'home_card', 'web_banner'] as const).map((p) => (
        <Checkbox key={p} label={t(`admin.offers.placementsHelp.${p}`)} checked={placements.includes(p)} onChange={(on) => togglePlacement(p, on)} />
      ))}
      <Text style={adminStyles.fieldLabel}>{t('admin.offers.who')}</Text>
      <FilterChips value={audience} onChange={setAudience} options={(['everyone', 'plus', 'free', 'visitors'] as const).map((a) => ({ value: a, label: t(`admin.offers.audiences.${a}`) }))} />
      <FilterChips value={region} onChange={setRegion} options={(['all', 'india', 'overseas'] as const).map((r) => ({ value: r, label: t(`admin.offers.regions.${r}`) }))} />
      <FilterChips value={language} onChange={setLanguage} options={[{ value: 'all', label: t('admin.offers.allLanguages') }, { value: 'en', label: 'English' }, { value: 'ta', label: 'தமிழ்' }]} />
      <Field label={t('admin.offers.starts')} value={starts} onChange={setStarts} maxLength={10} />
      <Field label={t('admin.offers.ends')} value={ends} onChange={setEnds} maxLength={10} placeholder={t('admin.offers.noEnd')} />
      <Field label={t('admin.offers.priority')} value={priority} onChange={(v) => setPriority(v.replace(/\D/g, ''))} maxLength={3} help={t('admin.offers.priorityHelp')} />
      <Checkbox label={t('admin.offers.dismissible')} checked={dismissible} onChange={setDismissible} />
      <Checkbox label={t('admin.offers.activeLabel')} checked={active} onChange={setActive} />
      {!linkOk ? <Message text={t('admin.offers.linkBad')} alert /> : null}
      {action.failure ? <Message text={action.failure} alert /> : null}
      <Actions>
        <SecondaryButton label={t('admin.common.cancel')} onPress={onClose} disabled={action.busy} />
        <SecondaryButton label={t('admin.common.save')} onPress={save} disabled={action.busy || title.trim().length < 3 || placements.length === 0 || !linkOk} />
      </Actions>
    </DialogFrame>
  );
}

// ===== Promotional messages =====
function Messages() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('/offers');
  const [audience, setAudience] = useState<'everyone' | 'plus' | 'free'>('everyone');
  const [region, setRegion] = useState<'all' | 'india' | 'overseas'>('all');
  const [language, setLanguage] = useState<'all' | 'en' | 'ta'>('all');
  const [asking, setAsking] = useState(false);
  const params = new URLSearchParams({ audience, region, ...(language === 'all' ? {} : { language }) });
  const count = useQuery({ queryKey: ['admin', 'campaign-count', params.toString()], queryFn: () => api.get<{ recipients: number; opted_in: number }>(`/admin/campaigns/count?${params}`) });
  const history = useQuery({ queryKey: ['admin', 'campaigns'], queryFn: () => api.get<Campaign[]>('/admin/campaigns') });
  const ready = title.trim().length >= 3 && body.trim().length >= 5 && /^\/[A-Za-z0-9/_-]*$/.test(link.trim() || '/');

  const columns: Column<Campaign>[] = [
    {
      key: 'msg',
      label: t('admin.offers.message'),
      flex: 2,
      render: (c) => (
        <View>
          <Text style={adminStyles.cellStrong}>{c.title}</Text>
          <Text style={adminStyles.cellMuted}>{c.body}</Text>
        </View>
      ),
    },
    { key: 'who', label: t('admin.offers.who'), render: (c) => t(`admin.offers.audiences.${c.audience}`) },
    { key: 'reach', label: t('admin.offers.reach'), render: (c) => t('admin.offers.sentOpened', { sent: c.recipients, opened: c.opened }) },
    { key: 'when', label: t('admin.offers.sentWhen'), render: (c) => `${formatDate(c.sent_at, i18n.language)}, ${c.sent_by_name ?? '-'}` },
  ];

  return (
    <>
      <Text style={adminStyles.cellMuted}>{t('admin.offers.messagesHelp')}</Text>
      <Field label={t('admin.broadcast.heading')} value={title} onChange={setTitle} maxLength={60} />
      <Field label={t('admin.broadcast.body')} value={body} onChange={setBody} multiline maxLength={180} />
      <Field label={t('admin.offers.opens')} value={link} onChange={setLink} maxLength={100} help={t('admin.offers.opensHelp')} />
      <FilterChips value={audience} onChange={setAudience} options={(['everyone', 'plus', 'free'] as const).map((a) => ({ value: a, label: t(`admin.offers.audiences.${a}`) }))} />
      <FilterChips value={region} onChange={setRegion} options={(['all', 'india', 'overseas'] as const).map((r) => ({ value: r, label: t(`admin.offers.regions.${r}`) }))} />
      <FilterChips value={language} onChange={setLanguage} options={[{ value: 'all', label: t('admin.offers.allLanguages') }, { value: 'en', label: 'English' }, { value: 'ta', label: 'தமிழ்' }]} />
      {count.data ? <Message text={t('admin.offers.willReach', { count: count.data.recipients, optedIn: count.data.opted_in })} /> : null}
      <Actions>
        <SecondaryButton label={t('admin.offers.send')} disabled={!ready || !count.data?.recipients} onPress={() => setAsking(true)} />
      </Actions>
      <QueryState query={history} isEmpty={(rows) => rows.length === 0} emptyText={t('admin.offers.noMessages')}>
        {(rows) => <DataTable columns={columns} rows={rows} rowKey={(c) => c.id} />}
      </QueryState>
      {asking ? (
        <FormDialog
          title={t('admin.offers.sendTitle', { count: count.data?.recipients ?? 0 })}
          text={t('admin.offers.sendText')}
          fields={[{ name: 'reason', label: t('admin.common.reason'), minLength: 5, multiline: true }]}
          confirmLabel={t('admin.offers.send')}
          onCancel={() => setAsking(false)}
          onConfirm={async ({ reason }) => {
            await api.post('/admin/campaigns', {
              title: title.trim(),
              body: body.trim(),
              link: link.trim() || undefined,
              audience,
              region,
              ...(language === 'all' ? {} : { language }),
              reason,
            });
            setTitle('');
            setBody('');
            setAsking(false);
            await client.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
          }}
        />
      ) : null}
    </>
  );
}
