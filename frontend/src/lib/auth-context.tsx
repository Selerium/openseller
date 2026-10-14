"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { api } from "./api";

// Exported because the nav derives what to show from `role`, and a nav that cannot name the
// role it branches on would have to take `any` and re-check the string at every call site.
export interface User {
  id: string;
  name: string;
  email?: string;
  /** Absent only on responses predating this field; treat undefined as "assume verified". */
  emailVerified?: boolean;
  role: string;
  firstTime: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  refreshUser: () => Promise<void>;
  /**
   * Signed in with an unverified address, which is the state a user lands in after changing
   * their email. Not the same as signed out.
   *
   * The distinction matters because the two produce nearly identical failures. Changing an
   * address revokes verification, so the next token refresh answers 403, which the client used
   * to handle exactly like a 401: user set to null, AuthGate renders nothing, and the browser
   * sits on a blank page. Sending them to /login to discover they are already logged in, or
   * bouncing them off the page they were on, is both wrong. With this flag a gate can instead
   * say "check your inbox" and leave them where they are.
   *
   * Deliberately not a redirect. The account is still theirs and still usable; a pending
   * verification should not look like a lost session.
   */
  verificationPending: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  refreshUser: async () => {},
  verificationPending: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  const refreshUser = useCallback(async () => {
    try {
      const res = await api<User>("/me");
      setUser(res.data);
      // `=== false`, not `!res.data.emailVerified`: the field is absent on responses from an
      // older backend, and treating that as unverified would flag every signed-in user as
      // pending. Only an explicit false means the address needs confirming.
      setPending(res.data.emailVerified === false);
    } catch (err) {
      setUser(null);
      // The status is what makes this catch two different things rather than one.
      //
      // 401 means no session: wrong/expired credentials, or the refresh token is gone. 403 means
      // a session that exists but is not allowed through, and for a shopper who just changed
      // their address that is exactly what checkTokens answers once the 15-minute access token
      // lapses. Collapsing both into `pending = false` was what made the unverified case
      // indistinguishable from being signed out: AuthGate rendered nothing and GuestGate had no
      // reason to keep /login open, so the user was shown an empty page with no way to ask for
      // the mail that would fix it.
      //
      // Anything else is left alone rather than assumed to be a verification problem. A network
      // blip or a 500 should not tell the shopper their address needs confirming.
      setPending((err as { status?: number })?.status === 403);
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  return (
    <AuthContext.Provider value={{ user, loading, refreshUser, verificationPending: pending }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
