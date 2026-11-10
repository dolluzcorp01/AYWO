// Posters and books: print, ship with tracking, deliver. Refunds go back through Razorpay or Stripe.
// The full shipping address opens only with a reason, which is recorded.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { useAdminAccess } from '@/admin/access';
import type { Fulfilment, OrderAddress, OrderPage, OrderRow } from '@/admin/types';
import { Actions, AdminPage, adminStyles, DataTable, DialogFrame, Facts, Field, FilterChips, formatDate, FormDialog, Message, money, Pager, Pill, QueryState, SearchBox, SecondaryButton, useAction, usePagedList } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import { api } from '@/lib/api';

const NEXT: Partial<Record<Fulfilment, Fulfilment>> = { queued: 'printing', printing: 'shipped', shipped: 'delivered' };

export default function AdminOrders() {
  const { t, i18n } = useTranslation();
  const access = useAdminAccess();
  const client = useQueryClient();
  const [step, setStep] = useState<Fulfilment | 'all'>('queued');
  const [q, setQ] = useState('');
  const [moving, setMoving] = useState<OrderRow | null>(null);
  const [address, setAddress] = useState<OrderRow | null>(null);
  const [refunding, setRefunding] = useState<OrderRow | null>(null);
  const [cancelling, setCancelling] = useState<OrderRow | null>(null);
  const { query, page, setPage } = usePagedList<OrderRow>(['admin', 'orders'], '/admin/orders', { fulfilment: step === 'all' ? undefined : step, q });
  const counts = (query.data as OrderPage | undefined)?.counts ?? {};
  const canShip = access.can(['orders']);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['admin', 'orders'] });
    await client.invalidateQueries({ queryKey: ['admin', 'work'] });
  };

  const columns: Column<OrderRow>[] = [
    {
      key: 'what',
      label: t('admin.orders.order'),
      flex: 1.6,
      render: (row) => (
        <View>
          <Text style={adminStyles.cellStrong}>
            {t(`admin.orders.products.${row.product}`)} {row.quantity > 1 ? `x ${row.quantity}` : ''}
          </Text>
          <Text style={adminStyles.cellMuted}>{row.buyer_name ?? '-'} · {[row.city, row.country].filter(Boolean).join(', ') || '-'}</Text>
        </View>
      ),
    },
    {
      key: 'paid',
      label: t('admin.orders.paid'),
      render: (row) => (
        <View>
          <Text style={adminStyles.cellStrong}>{money(row.amount_minor, row.currency, i18n.language)}</Text>
          {row.coupon ? <Text style={adminStyles.cellMuted}>{t('admin.orders.withCoupon', { code: row.coupon, off: money(row.discount_minor, row.currency, i18n.language) })}</Text> : null}
          <Text style={adminStyles.cellMuted}>{formatDate(row.paid_at, i18n.language)}</Text>
        </View>
      ),
    },
    {
      key: 'step',
      label: t('admin.orders.step'),
      render: (row) => (
        <View style={{ gap: 4 }}>
          <Pill label={row.status === 'refunded' ? t('admin.payments.orderStatus.refunded') : t(`admin.orders.steps.${row.fulfilment}`)} alert={row.status === 'refunded'} />
          {row.tracking_number ? <Text style={adminStyles.cellMuted}>{[row.carrier, row.tracking_number].filter(Boolean).join(' ')}</Text> : null}
        </View>
      ),
    },
    {
      key: 'actions',
      label: t('admin.common.actions'),
      flex: 1.8,
      render: (row) => (
        <Actions>
          {canShip && row.status === 'paid' && NEXT[row.fulfilment] ? (
            <SecondaryButton label={t(`admin.orders.moveTo.${NEXT[row.fulfilment]}`)} onPress={() => setMoving(row)} />
          ) : null}
          {canShip && row.product !== 'premium_invite' ? <SecondaryButton label={t('admin.orders.address')} onPress={() => setAddress(row)} /> : null}
          {canShip && row.status === 'paid' && ['queued', 'printing', 'shipped'].includes(row.fulfilment) ? (
            <SecondaryButton label={t('admin.orders.cancel')} danger onPress={() => setCancelling(row)} />
          ) : null}
          {access.can(['payments']) && row.can_refund ? <SecondaryButton label={t('admin.orders.refund')} danger onPress={() => setRefunding(row)} /> : null}
        </Actions>
      ),
    },
  ];

  const chip = (value: Fulfilment | 'all') => ({
    value,
    label: value === 'all' ? t('admin.payments.all') : `${t(`admin.orders.steps.${value}`)}${counts[value] !== undefined ? ` (${counts[value]})` : ''}`,
  });

  return (
    <AdminPage title={t('admin.orders.title')} subtitle={t('admin.orders.subtitle')} gates={['orders', 'payments']}>
      <FilterChips value={step} onChange={setStep} options={[chip('queued'), chip('printing'), chip('shipped'), chip('delivered'), chip('cancelled'), chip('all')]} />
      <SearchBox placeholder={t('admin.orders.search')} onSearch={setQ} />
      <QueryState query={query} isEmpty={(data) => data.rows.length === 0} emptyText={t('admin.orders.empty')}>
        {(data) => (
          <>
            <DataTable columns={columns} rows={data.rows} rowKey={(row) => row.id} />
            <Pager page={page} total={data.total} onPage={setPage} />
          </>
        )}
      </QueryState>
      {moving ? <StepDialog row={moving} to={NEXT[moving.fulfilment] as Fulfilment} onDone={refresh} onClose={() => setMoving(null)} /> : null}
      {address ? <AddressDialog row={address} onClose={() => setAddress(null)} /> : null}
      {cancelling ? (
        <FormDialog
          title={t('admin.orders.cancelTitle')}
          text={t('admin.orders.cancelText')}
          confirmLabel={t('admin.orders.cancel')}
          danger
          onCancel={() => setCancelling(null)}
          onConfirm={async () => {
            await api.post(`/admin/orders/${cancelling.id}/step`, { fulfilment: 'cancelled' });
            await refresh();
            setCancelling(null);
          }}
        />
      ) : null}
      {refunding ? (
        <FormDialog
          title={t('admin.orders.refundTitle', { amount: money(refunding.amount_minor, refunding.currency, i18n.language) })}
          text={t('admin.orders.refundText')}
          fields={[{ name: 'reason', label: t('admin.common.reason'), minLength: 5, multiline: true }]}
          confirmLabel={t('admin.orders.refund')}
          danger
          onCancel={() => setRefunding(null)}
          onConfirm={async ({ reason }) => {
            await api.post(`/admin/orders/${refunding.id}/refund`, { reason });
            await refresh();
            setRefunding(null);
          }}
        />
      ) : null}
    </AdminPage>
  );
}

function StepDialog({ row, to, onDone, onClose }: { row: OrderRow; to: Fulfilment; onDone: () => Promise<void>; onClose: () => void }) {
  const { t } = useTranslation();
  const [carrier, setCarrier] = useState(row.carrier ?? '');
  const [tracking, setTracking] = useState(row.tracking_number ?? '');
  const [url, setUrl] = useState('');
  const action = useAction();
  const shipping = to === 'shipped';

  async function save() {
    const ok = await action.run(() =>
      api.post(`/admin/orders/${row.id}/step`, {
        fulfilment: to,
        ...(shipping ? { carrier: carrier.trim() || undefined, tracking_number: tracking.trim(), tracking_url: url.trim() || undefined } : {}),
      }),
    );
    if (ok) {
      await onDone();
      onClose();
    }
  }

  return (
    <DialogFrame title={t(`admin.orders.moveTo.${to}`)} text={t('admin.orders.buyerTold')}>
      {shipping ? (
        <>
          <Field label={t('admin.orders.carrier')} value={carrier} onChange={setCarrier} maxLength={60} placeholder="India Post" />
          <Field label={t('admin.orders.tracking')} value={tracking} onChange={setTracking} maxLength={80} />
          <Field label={t('admin.orders.trackingUrl')} value={url} onChange={setUrl} maxLength={300} placeholder="https://" />
        </>
      ) : null}
      {action.failure ? <Message text={action.failure} alert /> : null}
      <Actions>
        <SecondaryButton label={t('admin.common.cancel')} onPress={onClose} disabled={action.busy} />
        <SecondaryButton label={t('admin.common.save')} onPress={save} disabled={action.busy || (shipping && !tracking.trim())} />
      </Actions>
    </DialogFrame>
  );
}

function AddressDialog({ row, onClose }: { row: OrderRow; onClose: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [data, setData] = useState<OrderAddress | null>(null);
  const action = useAction();
  const s = data?.shipping;

  return (
    <DialogFrame title={t('admin.orders.addressTitle')} text={data ? undefined : t('admin.orders.addressText')}>
      {data ? (
        s ? (
          <Facts
            items={[
              [t('admin.orders.shipTo'), s.name],
              [t('admin.orders.street'), [s.line1, s.line2].filter(Boolean).join(', ')],
              [t('admin.orders.cityState'), `${s.city}, ${s.state} ${s.postal_code}`],
              [t('admin.orders.country'), s.country],
              [t('admin.orders.phone'), s.phone],
              [t('admin.orders.quantity'), String(data.quantity)],
              [t('admin.orders.design'), data.design_id ?? '-'],
            ]}
          />
        ) : (
          <Message text={t('admin.orders.noAddress')} />
        )
      ) : (
        <>
          <Field label={t('admin.common.reason')} value={reason} onChange={setReason} multiline maxLength={500} />
          {action.failure ? <Message text={action.failure} alert /> : null}
          <Actions>
            <SecondaryButton
              label={t('admin.orders.showAddress')}
              disabled={reason.trim().length < 5 || action.busy}
              onPress={() => action.run(async () => setData(await api.post<OrderAddress>(`/admin/orders/${row.id}/address`, { reason: reason.trim() })))}
            />
          </Actions>
        </>
      )}
      <Actions>
        <SecondaryButton label={t('admin.work.close')} onPress={onClose} />
      </Actions>
    </DialogFrame>
  );
}
