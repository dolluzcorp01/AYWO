// Posters and books: print, ship with tracking, deliver. Refunds go back through Razorpay or Stripe.
// The full shipping address opens only with a reason, which is recorded.
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { useAdminAccess } from '@/admin/access';
import type { Fulfilment, OrderAddress, OrderPage, OrderRow } from '@/admin/types';
import { Actions, AdminPage, adminStyles, DataTable, DialogFrame, DownloadList, Facts, Field, FilterChips, formatDate, FormDialog, Message, Missing, money, Pager, Pill, QueryState, SearchBox, SecondaryButton, useAction, usePagedList, useRefreshAfter, useKept } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import { api } from '@/lib/api';

const NEXT: Partial<Record<Fulfilment, Fulfilment>> = { queued: 'printing', printing: 'shipped', shipped: 'delivered' };
// One step back, for a step clicked by mistake. Cancelled and refunded orders never go back.
const BACK: Partial<Record<Fulfilment, Fulfilment>> = { printing: 'queued', shipped: 'printing', delivered: 'shipped' };
/** The list row, with the short number staff read out to a customer and the tracking link. */
type Order = OrderRow & { order_no?: string; tracking_url?: string | null };

export default function AdminOrders() {
  const { t, i18n } = useTranslation();
  const access = useAdminAccess();
  const refreshAfter = useRefreshAfter();
  // A dashboard card opens the step it counted.
  const params = useLocalSearchParams<{ step?: string }>();
  const asked = (['queued', 'printing', 'shipped', 'delivered', 'cancelled', 'all'] as (Fulfilment | 'all')[]).find((s) => s === params.step);
  const [step, setStep] = useKept<Fulfilment | 'all'>('step', 'queued', asked);
  const [q, setQ] = useKept('q', '');
  const [moving, setMoving] = useState<OrderRow | null>(null);
  const [correcting, setCorrecting] = useState<Order | null>(null);
  const [undoing, setUndoing] = useState<Order | null>(null);
  const [address, setAddress] = useState<OrderRow | null>(null);
  // afterCancel: the refund offered straight after a cancel, so a paid order is not left cancelled and unrefunded.
  const [refunding, setRefunding] = useState<{ row: OrderRow; afterCancel: boolean } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<OrderRow | null>(null);
  const { query, page, setPage } = usePagedList<Order>(['admin', 'orders'], '/admin/orders', { fulfilment: step === 'all' ? undefined : step, q });
  const counts = (query.data as OrderPage | undefined)?.counts ?? {};
  const canShip = access.can(['orders']);
  const canRefund = access.can(['payments']);
  // An order step or a refund also moves the work queue and its badge, the dashboard, and the Payments totals.
  const refresh = () => refreshAfter('orders', 'work', 'payments');

  const columns: Column<Order>[] = [
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
          {row.order_no ? <Text style={adminStyles.cellMuted}>{t('admin.orders.orderNo', { number: row.order_no })}</Text> : null}
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
          {row.status === 'paid' && row.fulfilment === 'cancelled' ? <Pill label={t('admin.orders.notRefunded')} alert /> : null}
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
          {canShip && row.status === 'paid' && row.fulfilment === 'shipped' ? (
            <SecondaryButton label={t('admin.orders.correctTracking')} onPress={() => setCorrecting(row)} />
          ) : null}
          {canShip && row.product !== 'premium_invite' ? <SecondaryButton label={t('admin.orders.address')} onPress={() => setAddress(row)} /> : null}
          {canShip && row.status === 'paid' && BACK[row.fulfilment] ? (
            <SecondaryButton label={t('admin.orders.undoStep')} onPress={() => setUndoing(row)} />
          ) : null}
          {canShip && row.status === 'paid' && ['queued', 'printing', 'shipped'].includes(row.fulfilment) ? (
            <SecondaryButton label={t('admin.orders.cancel')} danger onPress={() => setCancelling(row)} />
          ) : null}
          {canRefund && row.can_refund ? <SecondaryButton label={t('admin.orders.refund')} danger onPress={() => setRefunding({ row, afterCancel: false })} /> : null}
        </Actions>
      ),
    },
  ];

  const chip = (value: Fulfilment | 'all') => ({
    value,
    label: value === 'all' ? t('admin.payments.all') : `${t(`admin.orders.steps.${value}`)}${counts[value] !== undefined ? ` (${counts[value]})` : ''}`,
  });

  // The rows on the screen now, as a spreadsheet. Only what the list already shows: never the street address.
  const sheetHeaders = [
    t('admin.orders.csv.number'), t('admin.orders.order'), t('admin.orders.quantity'), t('admin.orders.csv.buyer'), t('admin.orders.cityState'),
    t('admin.orders.country'), t('admin.orders.csv.amount'), t('admin.orders.csv.currency'), t('admin.orders.csv.coupon'), t('admin.orders.step'),
    t('admin.orders.carrier'), t('admin.orders.tracking'), t('admin.orders.paid'),
  ];
  const sheetRows = (rows: Order[]) =>
    rows.map((row) => [
      row.order_no ?? row.id,
      t(`admin.orders.products.${row.product}`),
      String(row.quantity),
      row.buyer_name ?? '',
      row.city ?? '',
      row.country ?? '',
      String(row.amount_minor / 100),
      row.currency,
      row.coupon ?? '',
      row.status === 'refunded' ? t('admin.payments.orderStatus.refunded') : t(`admin.orders.steps.${row.fulfilment}`),
      row.carrier ?? '',
      row.tracking_number ?? '',
      row.paid_at ? formatDate(row.paid_at, i18n.language) : '',
    ]);

  return (
    <AdminPage title={t('admin.orders.title')} subtitle={t('admin.orders.subtitle')} gates={['orders', 'payments']}>
      <FilterChips value={step} onChange={setStep} options={[chip('queued'), chip('printing'), chip('shipped'), chip('delivered'), chip('cancelled'), chip('all')]} />
      <SearchBox placeholder={t('admin.orders.search')} onSearch={setQ} initial={q} />
      {done ? <Message text={done} good /> : null}
      <QueryState query={query} isEmpty={(data) => data.rows.length === 0} emptyText={t('admin.orders.empty')}>
        {(data) => (
          <>
            <DataTable columns={columns} rows={data.rows} rowKey={(row) => row.id} />
            <Pager page={page} total={data.total} onPage={setPage} />
            <DownloadList fileName="aywo-orders" title={t('admin.orders.title')} headers={sheetHeaders} rows={sheetRows(data.rows)} />
          </>
        )}
      </QueryState>
      {moving ? (
        <StepDialog
          row={moving}
          to={NEXT[moving.fulfilment] as Fulfilment}
          onDone={async () => {
            setDone(t('admin.orders.stepDone', { step: t(`admin.orders.steps.${NEXT[moving.fulfilment]}`) }));
            await refresh();
          }}
          onClose={() => setMoving(null)}
        />
      ) : null}
      {correcting ? (
        <TrackingDialog
          row={correcting}
          onDone={async () => {
            setDone(t('admin.orders.trackingDone'));
            await refresh();
          }}
          onClose={() => setCorrecting(null)}
        />
      ) : null}
      {undoing ? (
        <FormDialog
          title={t('admin.orders.undoTitle')}
          text={t('admin.orders.undoText', { from: t(`admin.orders.steps.${undoing.fulfilment}`), to: t(`admin.orders.steps.${BACK[undoing.fulfilment]}`) })}
          fields={[{ name: 'reason', label: t('admin.common.reason'), minLength: 5, multiline: true }]}
          confirmLabel={t('admin.orders.undoStep')}
          onCancel={() => setUndoing(null)}
          onConfirm={async ({ reason }) => {
            await api.post(`/admin/orders/${undoing.id}/step-back`, { reason });
            setDone(t('admin.orders.undoDone', { step: t(`admin.orders.steps.${BACK[undoing.fulfilment]}`) }));
            setUndoing(null);
            await refresh();
          }}
        >
          {undoing.fulfilment === 'shipped' ? <Message text={t('admin.orders.undoClearsTracking')} alert /> : null}
        </FormDialog>
      ) : null}
      {address ? <AddressDialog row={address} onClose={() => setAddress(null)} /> : null}
      {cancelling ? (
        <FormDialog
          title={t('admin.orders.cancelTitle')}
          text={t('admin.orders.cancelText')}
          confirmLabel={t('admin.orders.cancel')}
          cancelLabel={t('admin.orders.keepOrder')}
          danger
          onCancel={() => setCancelling(null)}
          onConfirm={async () => {
            // The server takes no reason for a cancel; the refund that follows asks for one.
            await api.post(`/admin/orders/${cancelling.id}/step`, { fulfilment: 'cancelled' });
            const row = cancelling;
            setCancelling(null);
            if (canRefund && row.can_refund) {
              setDone(null);
              setRefunding({ row, afterCancel: true });
            } else {
              setDone(t('admin.orders.cancelDoneNoRefund'));
            }
            await refresh();
          }}
        >
          <Message text={t('admin.orders.cancelNoRefund', { amount: money(cancelling.amount_minor, cancelling.currency, i18n.language) })} alert />
          <Message text={canRefund && cancelling.can_refund ? t('admin.orders.cancelThenRefund') : canRefund ? t('admin.orders.cancelRefundElsewhere') : t('admin.orders.cancelNeedsPayments')} alert={!(canRefund && cancelling.can_refund)} />
        </FormDialog>
      ) : null}
      {refunding ? (
        <FormDialog
          title={t('admin.orders.refundTitle', { amount: money(refunding.row.amount_minor, refunding.row.currency, i18n.language) })}
          text={refunding.afterCancel ? t('admin.orders.refundAfterCancelText') : t('admin.orders.refundText')}
          fields={[{ name: 'reason', label: t('admin.common.reason'), minLength: 5, multiline: true }]}
          confirmLabel={t('admin.orders.refund')}
          cancelLabel={refunding.afterCancel ? t('admin.orders.refundLater') : undefined}
          danger
          onCancel={() => {
            if (refunding.afterCancel) setDone(t('admin.orders.cancelDoneNoRefund'));
            setRefunding(null);
          }}
          onConfirm={async ({ reason }) => {
            await api.post(`/admin/orders/${refunding.row.id}/refund`, { reason });
            setDone(t('admin.orders.refundDone', { amount: money(refunding.row.amount_minor, refunding.row.currency, i18n.language) }));
            setRefunding(null);
            await refresh();
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
  const urlOk = !url.trim() || /^https:\/\/\S+$/.test(url.trim());
  const missing = [shipping && !tracking.trim() && t('admin.orders.needTracking'), shipping && !urlOk && t('admin.orders.trackingUrlBad')];

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
          <Field label={t('admin.orders.carrier')} value={carrier} onChange={setCarrier} maxLength={60} placeholder={t('admin.orders.carrierExample')} />
          <Field label={t('admin.orders.tracking')} value={tracking} onChange={setTracking} maxLength={80} />
          <Field label={t('admin.orders.trackingUrl')} value={url} onChange={setUrl} maxLength={300} placeholder="https://" error={urlOk ? null : t('admin.orders.trackingUrlBad')} />
        </>
      ) : null}
      {action.failure ? <Message text={action.failure} alert /> : null}
      <Missing reasons={missing} />
      <Actions>
        <SecondaryButton label={t('admin.common.cancel')} onPress={onClose} disabled={action.busy} />
        <SecondaryButton main label={t(`admin.orders.moveTo.${to}`)} onPress={save} disabled={action.busy || missing.some(Boolean)} />
      </Actions>
    </DialogFrame>
  );
}

/** A shipped order whose tracking number or courier was typed wrongly. Saved with a reason; the buyer is told. */
function TrackingDialog({ row, onDone, onClose }: { row: Order; onDone: () => Promise<void>; onClose: () => void }) {
  const { t } = useTranslation();
  const [carrier, setCarrier] = useState(row.carrier ?? '');
  const [tracking, setTracking] = useState(row.tracking_number ?? '');
  const [url, setUrl] = useState(row.tracking_url ?? '');
  const [reason, setReason] = useState('');
  const action = useAction();
  const urlOk = !url.trim() || /^https:\/\/\S+$/.test(url.trim());
  const same = carrier.trim() === (row.carrier ?? '') && tracking.trim() === (row.tracking_number ?? '') && url.trim() === (row.tracking_url ?? '');
  const missing = [
    !tracking.trim() && t('admin.orders.needTracking'),
    !urlOk && t('admin.orders.trackingUrlBad'),
    same && t('admin.orders.trackingSame'),
    reason.trim().length < 5 && t('admin.common.needsText', { field: t('admin.common.reason'), count: 5 }),
  ];

  async function save() {
    const ok = await action.run(() =>
      api.post(`/admin/orders/${row.id}/tracking`, {
        carrier: carrier.trim() || undefined,
        tracking_number: tracking.trim(),
        tracking_url: url.trim() || undefined,
        reason: reason.trim(),
      }),
    );
    if (ok) {
      await onDone();
      onClose();
    }
  }

  return (
    <DialogFrame title={t('admin.orders.correctTrackingTitle')} text={t('admin.orders.correctTrackingText')}>
      <Field label={t('admin.orders.carrier')} value={carrier} onChange={setCarrier} maxLength={60} placeholder={t('admin.orders.carrierExample')} />
      <Field label={t('admin.orders.tracking')} value={tracking} onChange={setTracking} maxLength={80} />
      <Field label={t('admin.orders.trackingUrl')} value={url} onChange={setUrl} maxLength={300} placeholder="https://" error={urlOk ? null : t('admin.orders.trackingUrlBad')} />
      <Field label={t('admin.common.reason')} value={reason} onChange={setReason} multiline maxLength={500} />
      {action.failure ? <Message text={action.failure} alert /> : null}
      <Missing reasons={missing} />
      <Actions>
        <SecondaryButton label={t('admin.common.cancel')} onPress={onClose} disabled={action.busy} />
        <SecondaryButton main label={t('admin.orders.saveTracking')} onPress={save} disabled={action.busy || missing.some(Boolean)} />
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
              main
              label={t('admin.orders.showAddress')}
              disabled={reason.trim().length < 5 || action.busy}
              onPress={() => action.run(async () => setData(await api.post<OrderAddress>(`/admin/orders/${row.id}/address`, { reason: reason.trim() })))}
            />
          </Actions>
          <Missing reasons={[reason.trim().length < 5 && t('admin.common.needsText', { field: t('admin.common.reason'), count: 5 })]} />
        </>
      )}
      <Actions>
        <SecondaryButton label={t('admin.work.close')} onPress={onClose} />
      </Actions>
    </DialogFrame>
  );
}
