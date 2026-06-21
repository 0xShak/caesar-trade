import { readFileSync } from "node:fs";

/**
 * The Phase 0 Caesar GraphQL contract (SDL), loaded verbatim from the
 * colocated `schema.graphql`. The API server builds the executable schema from
 * this string + its resolver map.
 */
export const typeDefs: string = readFileSync(
  new URL("./schema.graphql", import.meta.url),
  "utf8",
);
