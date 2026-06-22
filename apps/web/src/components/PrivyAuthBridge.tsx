import { useEffect } from "react";
import { useApolloClient } from "@apollo/client";
import { usePrivy, useIdentityToken } from "@privy-io/react-auth";
import { setAuthTokenGetter } from "@/lib/apollo";

/**
 * Bridges Privy auth → Apollo (bible §6 auth headers). Apollo's auth link reads
 * tokens synchronously, but Privy's `getAccessToken()` is async — so we keep a
 * module-level cache that this component refreshes on auth-state changes, and
 * register a synchronous getter that reads the cache. The identity token comes
 * from `useIdentityToken()` (already a sync string, refreshed by the SDK).
 *
 * On login/logout transitions we also reset the Apollo store so `me` (and any
 * other auth-scoped queries) refetch with the new identity.
 */
let cache: { accessToken?: string; identityToken?: string } = {};
setAuthTokenGetter(() => cache);

export function PrivyAuthBridge() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const apollo = useApolloClient();

  useEffect(() => {
    cache = { ...cache, identityToken: identityToken ?? undefined };
  }, [identityToken]);

  useEffect(() => {
    let cancelled = false;
    if (ready && authenticated) {
      void getAccessToken().then((token) => {
        if (cancelled) return;
        cache = { ...cache, accessToken: token ?? undefined };
        // Tokens are now attached — refetch auth-scoped queries (me, …).
        void apollo.refetchQueries({ include: ["GetMe"] });
      });
    } else if (ready && !authenticated) {
      cache = {};
      void apollo.refetchQueries({ include: ["GetMe"] });
    }
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, getAccessToken, apollo]);

  return null;
}
