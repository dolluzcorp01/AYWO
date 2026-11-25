// What is waiting for staff, in one place: the numbers on the menu, the list on the dashboard, and the notice that
// appears when something new comes in.
//
// Before this the admin panel had no notifications. A new family word, a help ticket or a paid order showed only as
// one number among thirty on the dashboard, so staff had to go looking. The counts come from the dashboard the server
// already sends (only the areas this person is granted), asked again every half minute while the panel is open.
import type { Href } from 'expo-router';
import type { Dashboard } from './types';

export type WaitingKey = 'tickets' | 'reports' | 'takedowns' | 'words' | 'wordReports' | 'orders';

export interface WaitingItem {
  key: WaitingKey;
  count: number;
  /** The menu item that carries this number. */
  menu: string;
  href: Href;
}

/** Everything with at least one thing waiting, in the order staff should look at it. */
export function waitingFrom(data: Dashboard | undefined): WaitingItem[] {
  if (!data) return [];
  const all: WaitingItem[] = [
    { key: 'reports', count: data.moderation?.open ?? 0, menu: 'reports', href: '/admin/reports' },
    { key: 'takedowns', count: data.takedowns?.open ?? 0, menu: 'takedowns', href: '/admin/takedowns' },
    { key: 'tickets', count: data.support?.open ?? 0, menu: 'tickets', href: '/admin/tickets' },
    { key: 'orders', count: data.orders?.queued ?? 0, menu: 'orders', href: { pathname: '/admin/orders', params: { step: 'queued' } } },
    { key: 'words', count: data.dictionary?.pending_terms ?? 0, menu: 'dictionary', href: '/admin/dictionary' },
    { key: 'wordReports', count: data.dictionary?.open_reports ?? 0, menu: 'dictionary', href: { pathname: '/admin/dictionary', params: { tab: 'reports' } } },
  ];
  return all.filter((item) => item.count > 0);
}

/** The number beside each menu item. Two kinds can share one item (new words and reported words, on Dictionary). */
export function menuCounts(items: WaitingItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.menu] = (counts[item.menu] ?? 0) + item.count;
  return counts;
}

/** What has grown since the last look: each with how many more. Nothing on the first look, when there is no "before". */
export function arrivals(before: WaitingItem[] | null, now: WaitingItem[]): WaitingItem[] {
  if (!before) return [];
  const was = new Map(before.map((item) => [item.key, item.count]));
  return now
    .map((item) => ({ ...item, count: item.count - (was.get(item.key) ?? 0) }))
    .filter((item) => item.count > 0);
}
