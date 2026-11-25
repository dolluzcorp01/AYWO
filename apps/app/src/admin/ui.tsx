// Shared pieces of the admin panel: page frame, table, search, paging, dialogs. Web only, using the frozen tokens.
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { usePathname } from 'expo-router';
import { useRouter } from '@/lib/router';
import { Children, cloneElement, isValidElement, useEffect, useRef, useState } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { StyleProp, TextStyle } from 'react-native';
import { Spinner } from '@/components/Loaders';
import { Bouncy, PageEnter, Rise, softLift } from '@/components/Motion';
import { Card, EmptyState, Heading, Muted } from '@/components/ui';
import { ApiFailure, api } from '@/lib/api';
import { colors, fonts, gradients, minTapSize, radius, shadows } from '@/theme/tokens';
import { useAdminAccess } from './access';
import { AdminNames } from './AdminNames';
import { downloadSheet, sheetDay } from './sheet';
import type { Page, Permission } from './types';

// How far down each admin page was scrolled, so the browser's Back button returns to the same place and not to
// the top. Kept only while the panel is open. A page opened from the menu or a link starts at the top as usual.
const scrolledTo = new Map<string, number>();
let cameBack = false;
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    cameBack = true;
    setTimeout(() => {
      cameBack = false;
    }, 2000);
  });
}

export const PAGE_SIZE = 25;
// Below this window width the admin pages use a phone's thinner edges.
const PHONE_WIDTH = 600;
// The narrowest a table can be and still be read. With less room each row becomes a card instead.
const TABLE_MIN = 680;

export function formatDate(iso: string | null | undefined, language: string): string {
  if (!iso) return '-';
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short', hour12: true }).format(new Date(iso));
}

export function useErrorText() {
  const { t } = useTranslation();
  return (error: unknown): string =>
    error instanceof ApiFailure ? t(error.messageKey, { defaultValue: t('admin.common.failed') }) : t('admin.common.failed');
}

/** The 12-hour second-step proof ran out, or the second step was reset. The layout then asks for the code again. */
export function isTwoStepFailure(error: unknown): boolean {
  return error instanceof ApiFailure && (error.code === 'admin_two_step_required' || error.code === 'admin_two_step_setup');
}

/** After a failed action: when the reason is the second step, wake the layout so it asks for the code over the page. */
function useTwoStepWatch() {
  const client = useQueryClient();
  return (error: unknown) => {
    if (isTwoStepFailure(error)) void client.invalidateQueries({ queryKey: ['admin', 'me'] });
  };
}

/**
 * Reloads what an action changed: the named lists, and always the work badge in the menu and the dashboard counts.
 * useRefreshAfter()('orders', 'work') reloads ['admin', 'orders'], ['admin', 'work'], ['admin', 'me'], ['admin', 'dashboard'].
 */
export function useRefreshAfter() {
  const client = useQueryClient();
  return async (...lists: string[]): Promise<void> => {
    await Promise.all([...new Set([...lists, 'me', 'dashboard'])].map((list) => client.invalidateQueries({ queryKey: ['admin', list] })));
  };
}

/** The frame of every screen. Refuses the screen when the person lacks the permission, even at a typed-in address. */
export function AdminPage({
  title,
  subtitle,
  gates = [],
  children,
}: {
  title: string;
  subtitle?: string;
  gates?: readonly Permission[];
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const access = useAdminAccess();
  const router = useRouter();
  const pathname = usePathname();
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const windowHeight = useRef(0);
  // A phone has no room to give away: a thinner edge leaves more for the page.
  const phone = useWindowDimensions().width < PHONE_WIDTH;
  // Where to return to, decided once when the page opens. The lists arrive a moment later, so the jump waits until
  // the page is tall enough, and gives up after a few seconds rather than pulling someone back mid-read.
  const returnTo = useRef(cameBack ? scrolledTo.get(pathname) ?? 0 : 0);
  useEffect(() => {
    const giveUp = setTimeout(() => {
      returnTo.current = 0;
    }, 5000);
    return () => clearTimeout(giveUp);
  }, []);
  return (
    <ScrollView
      ref={scroller}
      style={styles.page}
      contentContainerStyle={[styles.pageBody, phone && styles.pageBodyPhone]}
      scrollEventThrottle={100}
      onLayout={(event) => {
        windowHeight.current = event.nativeEvent.layout.height;
      }}
      onScroll={(event) => {
        if (returnTo.current === 0) scrolledTo.set(pathname, event.nativeEvent.contentOffset.y);
      }}
      onContentSizeChange={(_, height) => {
        if (returnTo.current > 0 && height - windowHeight.current >= returnTo.current - 4) {
          scroller.current?.scrollTo({ y: returnTo.current, animated: false });
          returnTo.current = 0;
        }
      }}
    >
      {/* Each admin page eases in, like the pages of the app. */}
      <PageEnter style={styles.pageInner}>
        <Heading>{title}</Heading>
        {subtitle ? <Muted>{subtitle}</Muted> : null}
        {access.can(gates) ? (
          children
        ) : (
          <>
            <Message text={t('admin.common.notAllowed')} alert />
            <Text style={styles.cellMuted}>{t('admin.common.notAllowedHelp', { needs: gates.map((g) => t(`admin.permissions.${g}`, { defaultValue: g })).join(', ') })}</Text>
            <AdminNames />
            <View style={styles.actions}>
              <SecondaryButton main label={t('admin.common.backToDashboard')} onPress={() => router.navigate('/admin')} />
            </View>
          </>
        )}
      </PageEnter>
    </ScrollView>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Message({ text, alert, good }: { text: string; alert?: boolean; good?: boolean }) {
  return (
    <Text
      accessibilityRole={alert ? 'alert' : undefined}
      accessibilityLiveRegion={alert ? undefined : 'polite'}
      style={alert ? styles.alertText : good ? styles.goodText : styles.message}
    >
      {text}
    </Text>
  );
}

/** Under a button that is switched off: the first thing still missing. Pass each reason, or false when it is met. */
export function Missing({ reasons }: { reasons: (string | false | null | undefined)[] }) {
  const first = reasons.find((reason): reason is string => !!reason);
  return first ? (
    <Text accessibilityLiveRegion="polite" style={styles.missing}>
      {first}
    </Text>
  ) : null;
}

/** The Close button of a dialog with a text box. With unsent text it asks first, so a half-written answer is not lost. */
export function CloseGuard({ dirty, onClose }: { dirty: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  if (asking && dirty) {
    return (
      <View style={styles.guard}>
        <Message text={t('admin.common.unsentText')} alert />
        <View style={styles.actions}>
          <SecondaryButton label={t('admin.common.keepWriting')} onPress={() => setAsking(false)} />
          <SecondaryButton main label={t('admin.common.discardClose')} danger onPress={onClose} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.actions}>
      <SecondaryButton label={t('admin.work.close')} onPress={() => (dirty ? setAsking(true) : onClose())} />
    </View>
  );
}

/** Loading, error and empty states for one query. */
export function QueryState<T>({
  query,
  isEmpty,
  emptyText,
  children,
}: {
  query: UseQueryResult<T>;
  isEmpty?: (data: T) => boolean;
  emptyText?: string;
  children: (data: T) => ReactNode;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  if (query.data === undefined) {
    if (query.isError) {
      return (
        <View style={styles.state}>
          <Message text={errorText(query.error)} alert />
          <SecondaryButton label={t('admin.common.tryAgain')} onPress={() => query.refetch()} />
        </View>
      );
    }
    return (
      <View style={styles.state}>
        <Spinner label={t('admin.common.loading')} />
        <Message text={t('admin.common.loading')} />
      </View>
    );
  }
  if (isEmpty?.(query.data)) {
    return (
      <View style={styles.state}>
        <EmptyState message={emptyText ?? t('admin.common.empty')} />
      </View>
    );
  }
  return <>{children(query.data)}</>;
}

/** A paged list from the server. Going back to the first page happens by itself when a filter changes. */
/**
 * A filter, search or page number that survives the browser's Back button. It works like useState, but the value is
 * remembered for this page while the panel is open, and comes back only when the page is reached by Back or Forward.
 * A page opened from the menu or a dashboard card starts fresh: `asked` (from the address) or else `initial`.
 */
const kept = new Map<string, unknown>();
export function useKept<T>(name: string, initial: T, asked?: T): [T, (value: T) => void] {
  const key = `${usePathname()}|${name}`;
  const [value, setValue] = useState<T>(() => (cameBack && kept.has(key) ? (kept.get(key) as T) : asked ?? initial));
  // Recorded on every render, so the starting value is remembered too.
  kept.set(key, value);
  // The address changed while the page stayed open (another dashboard card, say): follow it.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else if (asked !== undefined) setValue(asked);
  }, [asked]);
  return [value, setValue];
}

export function usePagedList<T>(key: string[], path: string, filters: Record<string, string | undefined> = {}) {
  const [page, setPage] = useKept(`page:${key.join('/')}`, 0);
  const filterKey = JSON.stringify(filters);
  // A changed filter starts again at the first page. Not when the page first opens: Back returns to the page left.
  const lastFilters = useRef(filterKey);
  useEffect(() => {
    if (lastFilters.current !== filterKey) {
      lastFilters.current = filterKey;
      setPage(0);
    }
  }, [filterKey, setPage]);
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
  for (const [name, value] of Object.entries(filters)) {
    if (value) params.set(name, value);
  }
  const query = useQuery({
    queryKey: [...key, filterKey, page],
    queryFn: () => api.get<Page<T>>(`${path}?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
  return { query, page, setPage };
}

export interface Column<T> {
  key: string;
  label: string;
  flex?: number;
  render: (row: T) => ReactNode;
}

/** One row of a table. A marked row is tinted and pops twice, so the eye lands on it after a jump from the dashboard. */
function TableRow({ marked, children }: { marked: boolean; children: ReactNode }) {
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!marked) return undefined;
    let left = false;
    // People who asked their device for less motion get the tint alone.
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced || left) return;
      const up = () => Animated.timing(pop, { toValue: 1, duration: 170, useNativeDriver: false });
      const down = () => Animated.timing(pop, { toValue: 0, duration: 170, useNativeDriver: false });
      Animated.sequence([Animated.delay(350), up(), down(), up(), down()]).start();
    });
    return () => {
      left = true;
      pop.stopAnimation();
    };
  }, [marked, pop]);
  // Under the mouse a row is tinted, so the eye keeps its place across a wide table.
  const [over, setOver] = useState(false);
  if (!marked) {
    return (
      // A plain box, not a button: text in a row can still be selected and copied.
      <View role="row" {...({ onMouseEnter: () => setOver(true), onMouseLeave: () => setOver(false) } as object)} style={[styles.row, softLift, over && styles.rowOver]}>
        {children}
      </View>
    );
  }
  return (
    <Animated.View role="row" style={[styles.row, styles.rowMarked, { transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.012] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** One piece of a row's content: plain text gets the table's text style, anything else is shown as it is. */
function cellContent(content: ReactNode): ReactNode {
  return typeof content === 'string' || typeof content === 'number' ? <Text style={styles.cellText}>{content}</Text> : content;
}

/**
 * A table on a wide screen. Where there is not room for one (a phone, a tablet, a small laptop window) every row
 * becomes a card with each value under its heading, so nothing, least of all the action buttons, sits off the edge
 * waiting for a sideways scroll nobody knows to make.
 */
export function DataTable<T>({ columns, rows, rowKey, marked }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; marked?: (row: T) => boolean }) {
  const windowWidth = useWindowDimensions().width;
  // The room the table really has. Until it is measured, guess from the window: the side menu and the page edges.
  const [room, setRoom] = useState<number | null>(null);
  const stacked = (room ?? windowWidth - (windowWidth >= 820 ? 256 : 0) - 56) < TABLE_MIN;
  if (stacked) {
    return (
      <View role="list" style={styles.cards} onLayout={(event) => setRoom(event.nativeEvent.layout.width)}>
        {rows.map((row) => (
          <View key={rowKey(row)} role="listitem" style={[styles.rowCard, marked?.(row) && styles.rowCardMarked]}>
            {columns.map((column, index) => {
              const content = column.render(row);
              if (content === null || content === undefined || content === '') return null;
              // The last column holds the buttons on nearly every list: it gets the whole width.
              const whole = index === columns.length - 1 || (column.flex ?? 1) >= 2;
              return (
                <View key={column.key} style={[styles.cardField, whole && styles.cardFieldWhole]}>
                  {column.label ? <Text style={styles.headText}>{column.label}</Text> : null}
                  {cellContent(content)}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    );
  }
  // With room for a table it takes exactly the width it is given and long text wraps inside its column. It used to
  // sit in a sideways scroller and grow as wide as its content liked, which hid the last column on a laptop.
  return (
    <View onLayout={(event) => setRoom(event.nativeEvent.layout.width)}>
      <View role="table" style={styles.table}>
        <View role="row" style={[styles.row, styles.headRow]}>
          {columns.map((column) => (
            <View key={column.key} role="columnheader" style={[styles.cell, { flex: column.flex ?? 1 }]}>
              <Text style={styles.headText}>{column.label}</Text>
            </View>
          ))}
        </View>
        {rows.map((row) => (
          <TableRow key={rowKey(row)} marked={!!marked?.(row)}>
            {columns.map((column) => {
              const content = column.render(row);
              return (
                <View key={column.key} role="cell" style={[styles.cell, { flex: column.flex ?? 1 }]}>
                  {cellContent(content)}
                </View>
              );
            })}
          </TableRow>
        ))}
      </View>
    </View>
  );
}

/**
 * "Download this list": the rows on the screen as an Excel file with the AYWO logo and colours.
 * Only what the list already shows goes in, so the file never holds more than the person may see.
 */
export function DownloadList({ fileName, title, headers, rows }: { fileName: string; title: string; headers: string[]; rows: string[][] }) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const save = async () => {
    setState('busy');
    try {
      await downloadSheet(`${fileName}-${sheetDay()}`, {
        title,
        details: t('admin.common.sheetDetails', { count: rows.length, when: formatDate(new Date().toISOString(), i18n.language) }),
        footer: t('admin.common.sheetFooter'),
        headers,
        rows,
      });
      setState('idle');
    } catch {
      setState('failed');
    }
  };
  return (
    <View style={styles.download}>
      <View style={styles.actions}>
        <SecondaryButton label={state === 'busy' ? t('admin.common.downloading') : t('admin.common.downloadList')} disabled={state === 'busy'} onPress={() => void save()} />
      </View>
      {state === 'failed' ? <Message text={t('admin.common.downloadFailed')} alert /> : null}
      <Text style={styles.cellMuted}>{t('admin.common.downloadListHelp', { count: rows.length })}</Text>
    </View>
  );
}

export function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <View style={styles.pager}>
      <Text style={styles.cellMuted}>{t('admin.common.pageOf', { page: page + 1, pages, total })}</Text>
      <View style={styles.actions}>
        <SecondaryButton label={t('admin.common.previous')} disabled={page === 0} onPress={() => onPage(page - 1)} />
        <SecondaryButton label={t('admin.common.next')} disabled={page + 1 >= pages} onPress={() => onPage(page + 1)} />
      </View>
    </View>
  );
}

/** Searches when Enter or the button is pressed, so a half-typed word is never sent. */
export function SearchBox({ placeholder, onSearch, initial = '' }: { placeholder: string; onSearch: (q: string) => void; initial?: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState(initial);
  return (
    <View style={styles.search}>
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => onSearch(text.trim())}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        accessibilityLabel={placeholder}
        style={[styles.input, styles.searchInput]}
      />
      <SecondaryButton main label={t('admin.common.search')} onPress={() => onSearch(text.trim())} />
    </View>
  );
}

export function FilterChips<V extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
}) {
  return (
    <View style={styles.chips} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.chip, selected && styles.chipOn]}
          >
            <Text style={[styles.chipText, selected && styles.chipTextOn]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled,
  danger,
  main,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** The one action this page or box is for (Save, Send, New ...): filled, like the main button in the app. */
  main?: boolean;
}) {
  return (
    <Bouncy
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      to={0.96}
      hoverStyle={main ? undefined : danger ? styles.buttonDangerHover : styles.buttonHover}
      style={[styles.button, danger && styles.buttonDanger, main && (danger ? styles.buttonMainDanger : styles.buttonMain), disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, danger && styles.buttonTextDanger, main && styles.buttonTextMain]}>{label}</Text>
    </Bouncy>
  );
}

export function Actions({ children }: { children: ReactNode }) {
  return <View style={styles.actions}>{children}</View>;
}

export function Pill({ label, alert }: { label: string; alert?: boolean }) {
  return (
    <View style={[styles.pill, alert && styles.pillAlert]}>
      <Text style={[styles.pillText, alert && styles.pillTextAlert]}>{label}</Text>
    </View>
  );
}

/** A date with no time, as people read it: 17 Nov 2026. For offer and banner dates, which are whole days in India. */
export function formatDay(iso: string | null | undefined, language: string): string {
  if (!iso) return '-';
  return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}

/**
 * A number counted up from zero when the page opens, so a dashboard arrives instead of just being there.
 * Anything that is not a whole number (money, "12%") is shown as it is.
 */
function CountUp({ value, style }: { value: number | string; style: StyleProp<TextStyle> }) {
  const whole = typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 100000;
  const [shown, setShown] = useState(whole ? 0 : value);
  useEffect(() => {
    if (!whole) {
      setShown(value);
      return undefined;
    }
    const target = value as number;
    let left = false;
    let frame = 0;
    const started = Date.now();
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (left) return;
      if (reduced) {
        setShown(target);
        return;
      }
      const tick = () => {
        const part = Math.min(1, (Date.now() - started) / 600);
        // Fast at first, easing to a stop on the real number.
        setShown(Math.round(target * (1 - Math.pow(1 - part, 3))));
        if (part < 1 && !left) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    return () => {
      left = true;
      cancelAnimationFrame(frame);
    };
  }, [value, whole]);
  return <Text style={style}>{shown}</Text>;
}

/**
 * One number on a dashboard. A number above zero is in indigo under a thin band of the logo's colours; a zero is
 * quiet grey with no band, so the cards that have something in them are found at a glance.
 */
export function StatCard({ label, value, onPress, index = 0 }: { label: string; value: number | string; onPress?: () => void; /** Its place in the row, set by StatRow: later cards rise in a moment later. */ index?: number }) {
  const nothing = value === 0 || value === '0';
  const body = (
    <Card style={styles.statCard}>
      {nothing ? null : <LinearGradient colors={gradients.merge} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.statBand} />}
      <CountUp value={value} style={[styles.statValue, nothing && styles.statValueNone]} />
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
  return (
    <Rise delay={Math.min(index, 8) * 50} style={styles.stat}>
      {onPress ? (
        <Pressable accessibilityRole="link" onPress={onPress} style={({ hovered }: { hovered?: boolean }) => [styles.statLink, hovered && styles.statHover]}>
          {body}
        </Pressable>
      ) : (
        body
      )}
    </Rise>
  );
}

/** A row of number cards. They rise in one after another, left to right. */
export function StatRow({ children }: { children: ReactNode }) {
  return (
    <View style={styles.stats}>
      {Children.toArray(children).map((child, i) => (isValidElement<{ index?: number }>(child) ? cloneElement(child, { index: i }) : child))}
    </View>
  );
}

export function DialogFrame({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.backdrop}>
        <View style={styles.scrim} />
        {/* Never taller than the screen: on a short phone the inside scrolls, and the title stays in view. */}
        <View role="dialog" aria-label={title} style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.dialogTitle}>
            {title}
          </Text>
          <ScrollView style={styles.dialogScroll} contentContainerStyle={styles.dialogBody}>
            {text ? <Muted>{text}</Muted> : null}
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export interface DialogField {
  name: string;
  label: string;
  /** Text shorter than this keeps the confirm button off. 0 means optional. */
  minLength?: number;
  multiline?: boolean;
  initial?: string;
}

/** Asks for confirmation and any text it needs, then runs the action and shows its failure in place. */
export function FormDialog({
  title,
  text,
  fields = [],
  confirmLabel,
  cancelLabel,
  danger,
  blocked,
  onCancel,
  onConfirm,
  children,
}: {
  title: string;
  text?: string;
  fields?: DialogField[];
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Why the confirm button must stay off for a reason outside the fields, such as nobody picked yet. */
  blocked?: string | null;
  /** Extra warnings, shown above the fields. */
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: (values: Record<string, string>) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, field.initial ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const watchTwoStep = useTwoStepWatch();
  const short = fields.find((field) => (values[field.name] ?? '').trim().length < (field.minLength ?? 0));
  const ready = !short && !blocked;

  async function confirm() {
    setBusy(true);
    setFailure(null);
    try {
      await onConfirm(Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value.trim()])));
    } catch (error) {
      setFailure(errorText(error));
      watchTwoStep(error);
      setBusy(false);
    }
  }

  return (
    <DialogFrame title={title} text={text}>
      {children}
      {fields.map((field) => (
        <View key={field.name} style={styles.field}>
          <Text style={styles.fieldLabel}>{field.label}</Text>
          <TextInput
            value={values[field.name]}
            onChangeText={(value) => setValues((old) => ({ ...old, [field.name]: value }))}
            multiline={field.multiline}
            numberOfLines={field.multiline ? 3 : 1}
            accessibilityLabel={field.label}
            style={[styles.input, field.multiline && styles.inputTall]}
          />
        </View>
      ))}
      {failure ? <Message text={failure} alert /> : null}
      <Missing reasons={[blocked, short ? t('admin.common.needsText', { field: short.label, count: short.minLength ?? 1 }) : null]} />
      <View style={styles.dialogActions}>
        <SecondaryButton label={cancelLabel ?? t('admin.common.cancel')} onPress={onCancel} disabled={busy} />
        <SecondaryButton main label={confirmLabel} onPress={confirm} disabled={busy || !ready} danger={danger} />
      </View>
    </DialogFrame>
  );
}

/** A labelled text box. */
export function Field({
  label,
  value,
  onChange,
  multiline,
  placeholder,
  maxLength,
  help,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
  help?: string;
  /** What is wrong with what was typed, shown in red under the box. */
  error?: string | null;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        maxLength={maxLength}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        aria-invalid={error ? true : undefined}
        style={[styles.input, multiline && styles.inputTall, !!error && styles.inputBad]}
      />
      {help ? <Text style={styles.cellMuted}>{help}</Text> : null}
      {error ? <Message text={error} alert /> : null}
    </View>
  );
}

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => onChange(!checked)} style={adminStyles.check}>
      <View style={[adminStyles.checkBox, checked && adminStyles.checkBoxOn]} />
      <Text style={adminStyles.checkText}>{label}</Text>
    </Pressable>
  );
}

/** A white panel with a heading, for detail views. */
export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <Rise style={styles.panel}>
      <View style={styles.panelHead}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </Text>
        {actions}
      </View>
      {children}
    </Rise>
  );
}

/** Label and value pairs in two columns. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <View style={styles.facts}>
      {items.map(([label, value]) => (
        <View key={label} style={styles.fact}>
          <Text style={styles.cellMuted}>{label}</Text>
          {typeof value === 'string' || typeof value === 'number' ? <Text style={styles.cellText}>{value}</Text> : value}
        </View>
      ))}
    </View>
  );
}

/** A small bar chart: one bar per day. Values are written out for screen readers. */
export function Bars({ label, values, days }: { label: string; values: number[]; days: string[] }) {
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <View style={styles.chart} accessibilityLabel={`${label}: ${total}`}>
      <View style={styles.panelHead}>
        <Text style={styles.cellStrongText}>{label}</Text>
        <Text style={styles.statInline}>{total}</Text>
      </View>
      <View style={styles.bars}>
        {values.map((value, index) => (
          <View key={days[index]} style={styles.barSlot}>
            <View style={[styles.bar, { height: `${Math.max(value > 0 ? 6 : 2, (value / max) * 100)}%` }, value === 0 && styles.barZero]} />
          </View>
        ))}
      </View>
      <View style={styles.panelHead}>
        <Text style={styles.cellMuted}>{days[0]}</Text>
        <Text style={styles.cellMuted}>{days[days.length - 1]}</Text>
      </View>
    </View>
  );
}

/** Runs one staff action with a busy state and the failure shown in the person's language. */
export function useAction() {
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const watchTwoStep = useTwoStepWatch();
  async function run(work: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setFailure(null);
    try {
      await work();
      setBusy(false);
      return true;
    } catch (error) {
      setFailure(errorText(error));
      watchTwoStep(error);
      setBusy(false);
      return false;
    }
  }
  return { busy, failure, run, setFailure };
}

export function money(minor: number, currency: string, language: string): string {
  return new Intl.NumberFormat(language, { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 100);
}

export const adminStyles = StyleSheet.create({
  cellStrong: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  cellMuted: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  alertCell: { color: colors.alert, fontFamily: fonts.bold, fontSize: 13 },
  fieldLabel: { color: colors.text, fontFamily: fonts.bold, fontSize: 13 },
  field: { gap: 6 },
  input: {
    minHeight: minTapSize,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    color: colors.text,
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: minTapSize },
  checkBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.cardBorder, backgroundColor: colors.card },
  checkBoxOn: { borderColor: colors.logoPurple, backgroundColor: colors.logoPurple },
  checkText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, flexShrink: 1 },
});

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  pageBody: { padding: 28 },
  pageBodyPhone: { padding: 16 },
  pageInner: { width: '100%', maxWidth: 1240, gap: 16 },
  section: { gap: 10, marginTop: 8 },
  sectionTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18 },
  state: { alignItems: 'center', gap: 12, paddingVertical: 40 },
  message: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 15, textAlign: 'center' },
  alertText: { color: colors.alert, fontFamily: fonts.bold, fontSize: 14 },
  goodText: { color: colors.good, fontFamily: fonts.bold, fontSize: 14 },
  missing: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13 },
  guard: { gap: 8 },
  inputBad: { borderColor: colors.alert },
  table: {
    width: '100%',
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.cardBorder, minHeight: minTapSize, alignItems: 'center' },
  headRow: { backgroundColor: colors.background },
  // A row the dashboard pointed at: warm tint and an orange edge, above its neighbours while it pops.
  rowMarked: { backgroundColor: colors.warmTint, borderLeftWidth: 4, borderLeftColor: colors.logoOrange, zIndex: 1 },
  cards: { gap: 10 },
  rowCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 12,
    padding: 14,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 14,
  },
  rowCardMarked: { backgroundColor: colors.warmTint, borderLeftWidth: 4, borderLeftColor: colors.logoOrange },
  cardField: { flexGrow: 1, flexBasis: 120, minWidth: 0, gap: 3 },
  cardFieldWhole: { flexBasis: '100%' },
  download: { gap: 8 },
  cell: { paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center', minWidth: 0 },
  headText: { color: colors.muted, fontFamily: fonts.bold, fontSize: 12 },
  cellText: { color: colors.text, fontFamily: fonts.medium, fontSize: 14 },
  cellMuted: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  pager: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  search: { flexDirection: 'row', gap: 8, maxWidth: 560 },
  searchInput: { flex: 1 },
  input: adminStyles.input,
  inputTall: { minHeight: 84, paddingVertical: 10, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: minTapSize,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: colors.logoPurple, borderColor: colors.logoPurple },
  chipText: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  chipTextOn: { color: colors.white },
  button: {
    minHeight: minTapSize,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.logoIndigo,
    backgroundColor: colors.tint,
    cursor: 'pointer',
  },
  buttonHover: { backgroundColor: colors.tintDeep },
  buttonDanger: { borderColor: colors.alert, backgroundColor: colors.card },
  buttonDangerHover: { backgroundColor: colors.alertTint },
  buttonMain: { backgroundColor: colors.logoIndigo },
  buttonMainDanger: { backgroundColor: colors.alert },
  buttonText: { color: colors.logoIndigo, fontFamily: fonts.bold, fontSize: 14 },
  buttonTextDanger: { color: colors.alert },
  buttonTextMain: { color: colors.white },
  disabled: { opacity: 0.45 },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  pillAlert: { borderColor: colors.alert },
  pillText: { color: colors.muted, fontFamily: fonts.bold, fontSize: 12 },
  pillTextAlert: { color: colors.alert },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stat: { minWidth: 190, flexGrow: 1, flexBasis: 190 },
  // A number card that opens its list: the hand pointer, and it lifts a little under the mouse.
  statLink: { cursor: 'pointer', borderRadius: radius.card, flexGrow: 1, ...softLift },
  statHover: { transform: [{ translateY: -2 }], ...shadows.raised },
  statValue: { color: colors.logoIndigo, fontFamily: fonts.extrabold, fontSize: 30, letterSpacing: -0.6 },
  statValueNone: { color: colors.idleTab },
  statCard: { overflow: 'hidden', flexGrow: 1 },
  statBand: { position: 'absolute', top: 0, left: 0, right: 0, height: 4 },
  rowOver: { backgroundColor: colors.tint },
  statLabel: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 14 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.text, opacity: 0.45 },
  dialog: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '100%',
    gap: 12,
    padding: 22,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  dialogTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 20 },
  dialogScroll: { maxHeight: 640, flexShrink: 1 },
  dialogBody: { gap: 12 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  field: adminStyles.field,
  fieldLabel: adminStyles.fieldLabel,
  panel: { gap: 12, padding: 18, borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, columnGap: 24 },
  fact: { minWidth: 180, flexBasis: 180, flexGrow: 1, gap: 2 },
  chart: { gap: 8, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card, minWidth: 260, flexBasis: 300, flexGrow: 1 },
  bars: { height: 90, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: colors.logoIndigo },
  barZero: { backgroundColor: colors.cardBorder },
  cellStrongText: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  statInline: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 20 },
});
