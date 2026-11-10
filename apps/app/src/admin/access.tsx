import type { Href } from 'expo-router';
import { createContext, useContext } from 'react';
import type { AdminMe, Permission } from './types';

interface AdminAccess extends AdminMe {
  /** At least one of these is held. An empty list means every staff member. */
  can: (gates: readonly Permission[]) => boolean;
}

const Context = createContext<AdminAccess | null>(null);

export function accessFrom(me: AdminMe): AdminAccess {
  return {
    ...me,
    can: (gates) => gates.length === 0 || gates.some((gate) => me.permissions.includes(gate)),
  };
}

export const AdminAccessProvider = Context.Provider;

export function useAdminAccess(): AdminAccess {
  const access = useContext(Context);
  if (!access) throw new Error('useAdminAccess outside the admin layout');
  return access;
}

// The server refuses these routes on its own too. Hiding a menu item is only a courtesy.
export const MENU: { key: string; href: Href; gates: readonly Permission[]; group: 'work' | 'people' | 'business' | 'system' }[] = [
  { key: 'dashboard', href: '/admin', gates: [], group: 'work' },
  { key: 'work', href: '/admin/work', gates: ['support', 'moderation', 'takedowns', 'dictionary', 'orders'], group: 'work' },
  { key: 'tickets', href: '/admin/tickets', gates: ['support'], group: 'work' },
  { key: 'reports', href: '/admin/reports', gates: ['moderation'], group: 'work' },
  { key: 'takedowns', href: '/admin/takedowns', gates: ['takedowns'], group: 'work' },
  { key: 'dictionary', href: '/admin/dictionary', gates: ['dictionary'], group: 'work' },
  { key: 'users', href: '/admin/users', gates: ['users', 'support'], group: 'people' },
  { key: 'trees', href: '/admin/trees', gates: ['trees'], group: 'people' },
  { key: 'orders', href: '/admin/orders', gates: ['orders', 'payments'], group: 'business' },
  { key: 'payments', href: '/admin/payments', gates: ['payments'], group: 'business' },
  { key: 'offers', href: '/admin/offers', gates: ['marketing'], group: 'business' },
  { key: 'analytics', href: '/admin/analytics', gates: ['analytics'], group: 'business' },
  { key: 'settings', href: '/admin/settings', gates: ['settings', 'analytics'], group: 'system' },
  { key: 'staff', href: '/admin/staff', gates: ['staff'], group: 'system' },
  { key: 'broadcast', href: '/admin/broadcast', gates: ['staff'], group: 'system' },
  { key: 'audit', href: '/admin/audit', gates: ['audit'], group: 'system' },
];
