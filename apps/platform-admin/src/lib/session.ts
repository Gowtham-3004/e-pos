import { create } from 'zustand';
import type { Permission, RoleCode, User } from '@elixir/contracts';
import { roleByCode } from '@elixir/domain';

/** Platform staff session (prototype: PIN sign-in against `t-platform` users). Persisted in localStorage `pa-session`. */
export interface PlatformSession {
  userId: string;
  name: string;
  role: RoleCode;
  signedInAt: string;
}

const KEY = 'pa-session';

function load(): PlatformSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PlatformSession) : null;
  } catch {
    return null;
  }
}

interface SessionState {
  session: PlatformSession | null;
  signIn: (u: User) => void;
  signOut: () => void;
}

export const useSession = create<SessionState>((set) => ({
  session: load(),
  signIn: (u) => {
    const s: PlatformSession = { userId: u.id, name: u.name, role: u.role, signedInAt: new Date().toISOString() };
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable — session lives in memory only */
    }
    set({ session: s });
  },
  signOut: () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    set({ session: null });
  },
}));

/** Signed-in session — only call inside the authenticated shell. */
export function useCurrentSession(): PlatformSession & { permissions: Permission[]; roleName: string } {
  const s = useSession((x) => x.session)!;
  const role = roleByCode(s.role);
  return { ...s, permissions: role?.permissions ?? [], roleName: role?.name ?? s.role };
}
