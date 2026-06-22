import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
  split,
} from "@apollo/client";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { getMainDefinition } from "@apollo/client/utilities";
import { createClient } from "graphql-ws";

/**
 * Auth token getter (bible §6 headers).
 *
 * TODO(next session): wire this to Privy — return the cached Privy access
 * token + identity token so the auth link can attach them. For now it returns
 * undefined so unauthenticated GraphQL reads still work.
 */
export type AuthTokens = {
  accessToken?: string;
  identityToken?: string;
};

let getAuthTokens: () => AuthTokens = () => ({});

/** Allows the Privy layer to register a live token getter once authenticated. */
export function setAuthTokenGetter(getter: () => AuthTokens): void {
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
    connectionParams: () => {
      const { accessToken, identityToken } = getAuthTokens();
      const params: Record<string, string> = {};
      if (accessToken) params["authorization"] = `Bearer ${accessToken}`;
      if (identityToken) params["privy-id-token"] = identityToken;
      return params;
    },
  }),
);

const authLink = new ApolloLink((operation, forward) => {
  const { accessToken, identityToken } = getAuthTokens();

  operation.setContext(({ headers = {} }: { headers?: Record<string, string> }) => {
    const next: Record<string, string> = {
      ...headers,
      "x-graphql-operation": operation.operationName ?? "anonymous",
    };
    if (accessToken) next["Authorization"] = `Bearer ${accessToken}`;
    if (identityToken) next["privy-id-token"] = identityToken;
    return { headers: next };
  });

  return forward(operation);
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
