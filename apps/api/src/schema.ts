import { createSchema } from "graphql-yoga";
import { typeDefs } from "@caesar/graphql-schema";
import { resolvers } from "./resolvers/index.js";

/** Executable schema: the SDL contract from @caesar/graphql-schema + Phase 0 resolvers. */
export const schema = createSchema({
  typeDefs,
  resolvers,
});
