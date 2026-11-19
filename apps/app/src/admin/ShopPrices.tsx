// Admin > Offers > Shop prices: what the poster, the book and the premium invite cost, for buyers in India (rupees)
// and everywhere else (US dollars). A change needs a reason, goes to the audit log, and reaches the next order made.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useAdminAccess } from './access';
import { adminStyles, DataTable, DialogFrame, Field, formatDate, Message, Missing, money, QueryState, SecondaryButton, useAction, useRefreshAfter } from './ui';
import type { Column } from './ui';

type ShopProduct = 'tree_poster' | 'family_book' | 'premium_invite';
interface ShopPrice {
  product: ShopProduct;
  inr_minor: number;
  usd_minor: number;
  updated_at: string | null;
  updated_by_name: string | null;
}

// The same limits the database keeps: the payment companies' lowest amounts, and a ceiling that catches a slipped digit.
const LIMITS = { inr: { min: 100, max: 10_000_000 }, usd: { min: 50, max: 200_000 } };

/** "799" or "799.50" as paise or cents. null when it is not an amount of money. */
function toMinor(text: string): number | null {
  const clean = text.trim().replace(/,/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}
const toText = (minor: number) => (minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2));

export function ShopPrices() {
  const { t, i18n } = useTranslation();
  const access = useAdminAccess();
  const mayChange = access.can(['payments']);
  const query = useQuery({ queryKey: ['admin', 'shop-prices'], queryFn: () => api.get<ShopPrice[]>('/admin/shop-prices') });
  const [editing, setEditing] = useState<ShopPrice | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const columns: Column<ShopPrice>[] = [
    { key: 'product', label: t('admin.shopPrices.product'), flex: 1.3, render: (p) => <Text style={adminStyles.cellStrong}>{t(`admin.orders.products.${p.product}`)}</Text> },
    { key: 'inr', label: t('admin.shopPrices.india'), render: (p) => money(p.inr_minor, 'INR', i18n.language) },
    { key: 'usd', label: t('admin.shopPrices.abroad'), render: (p) => money(p.usd_minor, 'USD', i18n.language) },
    {
      key: 'changed',
      label: t('admin.shopPrices.lastChanged'),
      flex: 1.3,
      render: (p) => (p.updated_at ? t('admin.shopPrices.changedBy', { name: p.updated_by_name ?? t('admin.users.noName'), when: formatDate(p.updated_at, i18n.language) }) : t('admin.shopPrices.never')),
    },
    {
      key: 'actions',
      label: t('admin.shopPrices.actions'),
      render: (p) => (mayChange ? <SecondaryButton label={t('admin.shopPrices.change')} onPress={() => { setDone(null); setEditing(p); }} /> : '-'),
    },
  ];

  return (
    <>
      <Text style={adminStyles.cellMuted}>{t('admin.shopPrices.help')}</Text>
      {mayChange ? null : <Message text={t('admin.shopPrices.viewOnly')} />}
      {done ? <Message text={done} good /> : null}
      <QueryState query={query}>{(rows) => <DataTable columns={columns} rows={rows} rowKey={(p) => p.product} />}</QueryState>
      {editing ? (
        <PriceDialog
          price={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setDone(t('admin.shopPrices.saved', { product: t(`admin.orders.products.${editing.product}`) }));
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

function PriceDialog({ price, onClose, onSaved }: { price: ShopPrice; onClose: () => void; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const refreshAfter = useRefreshAfter();
  const action = useAction();
  const [inr, setInr] = useState(toText(price.inr_minor));
  const [usd, setUsd] = useState(toText(price.usd_minor));
  const [reason, setReason] = useState('');
  const inrMinor = toMinor(inr);
  const usdMinor = toMinor(usd);
  const inrBad = inrMinor === null || inrMinor < LIMITS.inr.min || inrMinor > LIMITS.inr.max;
  const usdBad = usdMinor === null || usdMinor < LIMITS.usd.min || usdMinor > LIMITS.usd.max;
  const same = inrMinor === price.inr_minor && usdMinor === price.usd_minor;
  const product = t(`admin.orders.products.${price.product}`);
  // A price moved to less than half or more than double is very often a typing slip: say so before it is saved.
  const bigJump =
    !inrBad && !usdBad && ((inrMinor as number) > price.inr_minor * 2 || (inrMinor as number) < price.inr_minor / 2 || (usdMinor as number) > price.usd_minor * 2 || (usdMinor as number) < price.usd_minor / 2);

  async function save() {
    const ok = await action.run(() => api.patch(`/admin/shop-prices/${price.product}`, { inr_minor: inrMinor, usd_minor: usdMinor, reason: reason.trim() }));
    if (!ok) return;
    // The shop keeps its product list for a while; drop it so the new price shows there straight away.
    void refreshAfter('shop-prices');
    void client.invalidateQueries({ queryKey: ['shop-products'] });
    onSaved();
  }

  return (
    <DialogFrame title={t('admin.shopPrices.dialogTitle', { product })} text={t('admin.shopPrices.dialogText')}>
      <Field label={t('admin.shopPrices.indiaField')} value={inr} onChange={setInr} maxLength={10} error={inrBad ? t('admin.shopPrices.badInr') : undefined} />
      <Field label={t('admin.shopPrices.abroadField')} value={usd} onChange={setUsd} maxLength={10} error={usdBad ? t('admin.shopPrices.badUsd') : undefined} />
      {!inrBad && !usdBad && !same ? (
        <View style={styles.preview}>
          <Text style={adminStyles.cellStrong}>{t('admin.shopPrices.preview')}</Text>
          <Text style={adminStyles.cellMuted}>
            {t('admin.shopPrices.previewIndia', { before: money(price.inr_minor, 'INR', i18n.language), now: money(inrMinor as number, 'INR', i18n.language) })}
          </Text>
          <Text style={adminStyles.cellMuted}>
            {t('admin.shopPrices.previewAbroad', { before: money(price.usd_minor, 'USD', i18n.language), now: money(usdMinor as number, 'USD', i18n.language) })}
          </Text>
        </View>
      ) : null}
      {bigJump && !same ? <Message text={t('admin.shopPrices.bigJump')} alert /> : null}
      {price.product === 'premium_invite' ? <Text style={adminStyles.cellMuted}>{t('admin.shopPrices.inviteNote')}</Text> : null}
      <Field label={t('admin.shopPrices.reason')} value={reason} onChange={setReason} multiline maxLength={500} />
      {action.failure ? <Message text={action.failure} alert /> : null}
      <Missing reasons={[(inrBad || usdBad) && t('admin.shopPrices.needPrices'), !inrBad && !usdBad && same && t('admin.shopPrices.needChange'), reason.trim().length < 5 && t('admin.shopPrices.needReason')]} />
      <View style={styles.buttons}>
        <SecondaryButton label={t('admin.common.cancel')} onPress={onClose} disabled={action.busy} />
        <SecondaryButton main label={t('admin.shopPrices.save')} onPress={() => void save()} disabled={action.busy || inrBad || usdBad || same || reason.trim().length < 5} />
      </View>
    </DialogFrame>
  );
}

const styles = StyleSheet.create({
  preview: { gap: 4 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 4 },
});
