// Shared pieces of the staff panel: page frame, table, search, paging, dialogs. Web only, using the frozen tokens.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Spinner } from '@/components/Loaders';
import { Card, Heading, Muted } from '@/components/ui';
import { ApiFailure, api } from '@/lib/api';
import { colors, fonts, minTapSize } from '@/theme/tokens';
import { useAdminAccess } from './access';
import type { Page, Permission } from './types';

export const PAGE_SIZE = 25;

export function formatDate(iso: string | null | undefined, language: string): string {
  if (!iso) return '-';
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function useErrorText() {
  const { t } = useTranslation();
  return (error: unknown): string =>
    error instanceof ApiFailure ? t(error.messageKey, { defaultValue: t('admin.common.failed') }) : t('admin.common.failed');
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
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageBody}>
      <View style={styles.pageInner}>
        <Heading>{title}</Heading>
        {subtitle ? <Muted>{subtitle}</Muted> : null}
        {access.can(gates) ? children : <Message text={t('admin.common.notAllowed')} alert />}
      </View>
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

export function Message({ text, alert }: { text: string; alert?: boolean }) {
  return (
    <Text accessibilityRole={alert ? 'alert' : undefined} style={alert ? styles.alertText : styles.message}>
      {text}
    </Text>
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
        <Message text={emptyText ?? t('admin.common.empty')} />
      </View>
    );
  }
  return <>{children(query.data)}</>;
}

/** A paged list from the server. Going back to the first page happens by itself when a filter changes. */
export function usePagedList<T>(key: string[], path: string, filters: Record<string, string | undefined> = {}) {
  const [page, setPage] = useState(0);
  const filterKey = JSON.stringify(filters);
  useEffect(() => setPage(0), [filterKey]);
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

export function DataTable<T>({ columns, rows, rowKey }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string }) {
  return (
    <ScrollView horizontal contentContainerStyle={styles.tableScroll}>
      <View role="table" style={styles.table}>
        <View role="row" style={[styles.row, styles.headRow]}>
          {columns.map((column) => (
            <View key={column.key} role="columnheader" style={[styles.cell, { flex: column.flex ?? 1 }]}>
              <Text style={styles.headText}>{column.label}</Text>
            </View>
          ))}
        </View>
        {rows.map((row) => (
          <View key={rowKey(row)} role="row" style={styles.row}>
            {columns.map((column) => {
              const content = column.render(row);
              return (
                <View key={column.key} role="cell" style={[styles.cell, { flex: column.flex ?? 1 }]}>
                  {typeof content === 'string' || typeof content === 'number' ? (
                    <Text style={styles.cellText}>{content}</Text>
                  ) : (
                    content
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
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
export function SearchBox({ placeholder, onSearch }: { placeholder: string; onSearch: (q: string) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
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
      <SecondaryButton label={t('admin.common.search')} onPress={() => onSearch(text.trim())} />
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
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, danger && styles.buttonDanger, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, danger && styles.buttonTextDanger]}>{label}</Text>
    </Pressable>
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

export function StatCard({ label, value, onPress }: { label: string; value: number; onPress?: () => void }) {
  const body = (
    <Card>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
  return onPress ? (
    <Pressable accessibilityRole="link" onPress={onPress} style={styles.stat}>
      {body}
    </Pressable>
  ) : (
    <View style={styles.stat}>{body}</View>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <View style={styles.stats}>{children}</View>;
}

export function DialogFrame({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.backdrop}>
        <View style={styles.scrim} />
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
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  text?: string;
  fields?: DialogField[];
  confirmLabel: string;
  danger?: boolean;
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
  const ready = fields.every((field) => (values[field.name] ?? '').trim().length >= (field.minLength ?? 0));

  async function confirm() {
    setBusy(true);
    setFailure(null);
    try {
      await onConfirm(Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value.trim()])));
    } catch (error) {
      setFailure(errorText(error));
      setBusy(false);
    }
  }

  return (
    <DialogFrame title={title} text={text}>
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
      <View style={styles.dialogActions}>
        <SecondaryButton label={t('admin.common.cancel')} onPress={onCancel} disabled={busy} />
        <SecondaryButton label={confirmLabel} onPress={confirm} disabled={busy || !ready} danger={danger} />
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
  help?: string;
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
        style={[styles.input, multiline && styles.inputTall]}
      />
      {help ? <Text style={styles.cellMuted}>{help}</Text> : null}
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
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </Text>
        {actions}
      </View>
      {children}
    </View>
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
  async function run(work: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setFailure(null);
    try {
      await work();
      setBusy(false);
      return true;
    } catch (error) {
      setFailure(errorText(error));
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
  pageInner: { width: '100%', maxWidth: 1240, gap: 16 },
  section: { gap: 10, marginTop: 8 },
  sectionTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18 },
  state: { alignItems: 'center', gap: 12, paddingVertical: 40 },
  message: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 15, textAlign: 'center' },
  alertText: { color: colors.alert, fontFamily: fonts.bold, fontSize: 14 },
  tableScroll: { flexGrow: 1 },
  table: {
    flex: 1,
    minWidth: 820,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.cardBorder, minHeight: minTapSize, alignItems: 'center' },
  headRow: { backgroundColor: colors.background },
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
    borderColor: colors.logoPurple,
    backgroundColor: colors.card,
  },
  buttonDanger: { borderColor: colors.alert },
  buttonText: { color: colors.relation, fontFamily: fonts.bold, fontSize: 14 },
  buttonTextDanger: { color: colors.alert },
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
  statValue: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 30, letterSpacing: -0.6 },
  statLabel: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 14 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.text, opacity: 0.45 },
  dialog: {
    width: '100%',
    maxWidth: 560,
    gap: 12,
    padding: 22,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  dialogTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 20 },
  dialogScroll: { maxHeight: 640 },
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
