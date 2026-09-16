import { createContext, useContext, type ReactNode } from 'react';
import type { Permission, StaffDTO } from './contract';

export const can = (staff: StaffDTO | null | undefined, perm: Permission): boolean =>
  !!staff && staff.status !== 'disabled' && (staff.role === 'owner' || staff.role === 'admin' || staff.permissions.includes(perm));

const StaffContext = createContext<StaffDTO | null>(null);

export function StaffProvider({ staff, children }: { staff: StaffDTO; children: ReactNode }) {
  return <StaffContext.Provider value={staff}>{children}</StaffContext.Provider>;
}

export function useStaff(): StaffDTO {
  const staff = useContext(StaffContext);
  if (!staff) throw new Error('useStaff outside of a signed-in admin');
  return staff;
}

export function useCan(): (perm: Permission) => boolean {
  const staff = useContext(StaffContext);
  return (perm) => can(staff, perm);
}
