import type { CodegenConfig } from "@graphql-codegen/cli";

/**
 * graphql-codegen config: turns the SDL contract into typed resolver +
 * operation types. Run with `pnpm --filter @caesar/graphql-schema codegen`.
 */
const config: CodegenConfig = {
  schema: "./src/schema.graphql",
  generates: {
    "./src/generated.ts": {
      plugins: ["typescript", "typescript-resolvers"],
      config: {
        useIndexSignature: true,
        scalars: {
          DateTime: "string",
          JSON: "unknown",
        },
      },
    },
  },
};

export default config;
