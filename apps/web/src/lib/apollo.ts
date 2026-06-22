import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
  split,
} from "@apollo/client";
import { setContext } from "@apollo/client/link/context";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { getMainDefinition } from "@apollo/client/utilities";
import { createClient } from "graphql-ws";

/**
 * Auth token getter (bible §6 headers).
 *
 * The getter is **async** and resolved at request time: Privy's
 * `getAccessToken()` is async, so caching it and racing a refetch dropped the
 * token on the first authed query (it fired the instant `authenticated` flipped,
 * before the token was cached). Awaiting per-request removes that race entirely —
 * Privy caches/refreshes the token internally, so calling it each request is cheap.
 * Returns empty tokens when logged out, so public reads still work.
 */
export type AuthTokens = {
  accessToken?: string;
  identityToken?: string;
};

let getAuthTokens: () => Promise<AuthTokens> = async () => ({});

/** Allows the Privy layer to register a live token getter once authenticated. */
export function setAuthTokenGetter(getter: () => Promise<AuthTokens>): void {
  getAuthTokens = getter;
}

/** Vite proxies /graphql → api. credentials:include for the session cookie. */
const HTTP_URL = import.meta.env.VITE_GRAPHQL_HTTP_URL ?? "/graphql";

const httpLink = new HttpLink({
  uri: HTTP_URL,
  credentials: "include",
});

/**
 * WS endpoint for graphql-ws subscriptions. Derived from the HTTP url by
 * swapping the scheme (http→ws / https→wss). Relative paths (the Vite-proxied
 * default "/graphql") resolve against window.location, so dev works through the
 * existing proxy (vite server.proxy has ws:true). Falls back to the api default.
 */
function deriveWsUrl(httpUrl: string): string {
  try {
    const base =
      typeof window !== "undefined" ? window.location.origin : undefined;
    const u = new URL(httpUrl, base);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.toString();
  } catch {
    return "ws://localhost:4000/graphql";
  }
}

const wsLink = new GraphQLWsLink(
  createClient({
    url: deriveWsUrl(HTTP_URL),
    // graphql-ws lazily (re)connects; keep the socket up while subscriptions
    // are active and retry on transient drops so the live tape self-heals.
    lazy: true,
    retryAttempts: 10,
    connectionParams: async () => {
      const { accessToken, identityToken } = await getAuthTokens();
      const params: Record<string, string> = {};
      if (accessToken) params["authorization"] = `Bearer ${accessToken}`;
      if (identityToken) params["privy-id-token"] = identityToken;
      return params;
    },
  }),
);

const authLink = setContext(async (operation, { headers = {} }) => {
  const { accessToken, identityToken } = await getAuthTokens();
  const next: Record<string, string> = {
    ...(headers as Record<string, string>),
    "x-graphql-operation": operation.operationName ?? "anonymous",
  };
  if (accessToken) next["Authorization"] = `Bearer ${accessToken}`;
  if (identityToken) next["privy-id-token"] = identityToken;
  return { headers: next };
});

/**
 * Route by operation type: subscriptions go over the WS link, everything else
 * (queries/mutations) stays on the HTTP chain (authLink → httpLink).
 */
const splitLink = split(
  ({ query }) => {
    const def = getMainDefinition(query);
    return (
      def.kind === "OperationDefinition" && def.operation === "subscription"
    );
  },
  wsLink,
  ApolloLink.from([authLink, httpLink]),
);

export const apolloClient = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
});
