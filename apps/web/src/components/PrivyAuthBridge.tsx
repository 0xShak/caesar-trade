import { useEffect } from "react";
import { useApolloClient } from "@apollo/client";
import { usePrivy, useIdentityToken } from "@privy-io/react-auth";
import { setAuthTokenGetter } from "@/lib/apollo";

/**
 * Bridges Privy auth → Apollo (bible §6 auth headers). The Apollo auth link
 * resolves tokens **per request** (async), so this component just keeps the
 * live `getAccessToken` fn + identity token in a module ref and registers an
 * async getter the link awaits. Fetching at request time (rather than caching +
 * racing a refetch) means the first authed query never goes out token-less.
 *
 * On login/logout transitions we refetch auth-scoped queries so `me` reloads
 * under the new identity.
 */
let liveGetAccessToken: (() => Promise<string | null>) | null = null;
let identityTokenRef: string | undefined;

setAuthTokenGetter(async () => {
  const accessToken = liveGetAccessToken ? await liveGetAccessToken() : null;
  return { accessToken: accessToken ?? undefined, identityToken: identityTokenRef };
});

export function PrivyAuthBridge() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const apollo = useApolloClient();

  // Assign synchronously in render (not an effect): this component is mounted
  // before <App>, so it renders first in the commit where `authenticated` flips
  // true — making the token getter live BEFORE AccountMenu/TosGate's GetMe
  // useQuery dispatches in that same commit. An effect would run too late and
  // the first authed query would go out token-less.
  liveGetAccessToken = ready && authenticated ? getAccessToken : null;
  identityTokenRef = identityToken ?? undefined;

  useEffect(() => {
    // Belt-and-suspenders on login/logout: reload active observable queries so
    // `me` reflects the new identity. reFetchObservableQueries (vs refetchQueries
    // by name) never throws when no query is currently active.
    void apollo.reFetchObservableQueries();
  }, [authenticated, apollo]);

  return null;
}
