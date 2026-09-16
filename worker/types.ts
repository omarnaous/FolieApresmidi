import type { Context } from 'hono';
import type { Permission, StaffRole } from '../shared/api';
import type { DB } from './db/client';

export interface CustomerPrincipal {
  id: string;
  /** KV key of the session, for logout */
  sessionKey: string;
}

export interface StaffPrincipal {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  permissions: Permission[];
  sessionKey: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    db: DB;
    customer: CustomerPrincipal | null;
    staff: StaffPrincipal | null;
  };
};

export type Ctx = Context<AppEnv>;
