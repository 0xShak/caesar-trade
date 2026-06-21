import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
} from "@apollo/client";

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
const httpLink = new HttpLink({
  uri: "/graphql",
  credentials: "include",
});

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

export const apolloClient = new ApolloClient({
  link: ApolloLink.from([authLink, httpLink]),
  cache: new InMemoryCache(),
});
