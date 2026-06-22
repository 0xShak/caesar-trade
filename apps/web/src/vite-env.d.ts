/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRIVY_APP_ID?: string;
  /** Absolute GraphQL HTTP endpoint; the WS url is derived (http→ws). */
  readonly VITE_GRAPHQL_HTTP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
