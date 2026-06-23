import process from "node:process";
import Fastify from "fastify";
import { createYoga } from "graphql-yoga";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/use/ws";
import { PrivyClient } from "@privy-io/server-auth";
import { loadEnv } from "@caesar/config";
import { getPool } from "@caesar/db";
import { schema } from "./schema.js";
import { buildContext, buildWsContext, getEmbeddedWallet } from "./auth.js";

const env = loadEnv();
// Railway (and most PaaS) inject PORT and route to 0.0.0.0; fall back to 4000 locally.
const PORT = Number(process.env.PORT) || 4000;

// Browser origins allowed to call the API with credentials (comma-separated),
// e.g. "https://app.trycaesar.xyz". The frontend lives on a different origin than
// the API in production, so this must list the exact origin(s) — "*" is invalid
// once credentials are included. Defaults to local dev.
const CORS_ORIGINS = (process.env.CORS_ORIGIN ?? "http://localhost:3010")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = Fastify({ logger: true });

const yoga = createYoga({
  schema,
  graphqlEndpoint: "/graphql",
  graphiql: true,
  logging: false,
  // Cross-origin: the SPA (app.trycaesar.xyz) calls this API (api.trycaesar.xyz)
  // with credentials + a Privy Bearer token, so we echo the exact origin and allow
  // the auth headers. Yoga answers the preflight on the shared /graphql route.
  cors: {
    origin: CORS_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type", "privy-id-token", "accept"],
  },
  // Per-request Privy auth (Phase 2): verify Authorization + privy-id-token →
  // { auth: { userId, idToken } | null }. Public reads still work when null.
  context: ({ request }) => buildContext(request.headers),
});

/**
 * Drive Yoga via its universal `fetch` adapter using Fastify's already-parsed
 * body. This sidesteps the Node-stream ownership fight between Fastify's body
 * parser and Yoga's raw-request reader (which otherwise hangs the handler).
 * Queries/mutations + GraphiQL work over this path; streaming subscriptions
 * (Phase 4) will use Yoga's own SSE/WS transport.
 */
app.route({
  url: "/graphql",
  method: ["GET", "POST", "OPTIONS"],
  handler: async (req, reply) => {
    const response = await yoga.fetch(`http://localhost:${PORT}${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body:
        req.method === "POST" && req.body != null
          ? typeof req.body === "string"
            ? req.body
            : JSON.stringify(req.body)
          : undefined,
    });
    response.headers.forEach((value, key) => reply.header(key, value));
    reply.status(response.status);
    reply.send(await response.text());
    return reply;
  },
});

/**
 * Spike C — Privy token verification round-trip. The web `/spike-privy` page
 * logs in then POSTs { accessToken, identityToken } here; we verify the access
 * token server-side and extract the embedded EVM wallet (Phase 2). The identity
 * token lets us decode the user object locally (no rate-limited API call).
 */
app.post("/api/spike/privy-verify", async (req, reply) => {
  if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) {
    return reply
      .status(400)
      .send({ ok: false, error: "PRIVY_APP_ID/PRIVY_APP_SECRET not set in .env" });
  }
  const body = (req.body ?? {}) as { accessToken?: unknown; identityToken?: unknown };
  const accessToken = typeof body.accessToken === "string" ? body.accessToken : undefined;
  const identityToken = typeof body.identityToken === "string" ? body.identityToken : undefined;
  if (!accessToken) {
    return reply.status(400).send({ ok: false, error: "missing accessToken" });
  }

  const privy = new PrivyClient(env.PRIVY_APP_ID, env.PRIVY_APP_SECRET);
  try {
    const claims = await privy.verifyAuthToken(accessToken);
    const wallet = await getEmbeddedWallet({ userId: claims.userId, idToken: identityToken });
    return reply.send({
      ok: true,
      userId: claims.userId,
      identityTokenReceived: identityToken != null,
      embeddedWalletAddress: wallet?.address ?? null,
    });
  } catch (err) {
    return reply.status(401).send({ ok: false, error: (err as Error).message });
  }
});

app.get("/health", async () => ({ ok: true }));

// Diagnostic: surfaces the RAW DB error that the GraphQL layer masks. Reports the
// DATABASE_URL host (password redacted) plus a live query result or the driver
// error. TEMPORARY — remove once the DB connection is confirmed.
app.get("/health/db", async (_req, reply) => {
  const url = process.env.DATABASE_URL ?? "(unset)";
  const host = url.replace(/\/\/[^@]*@/, "//***@");
  try {
    const r = await getPool().query("select count(*)::int n from markets");
    return reply.send({ ok: true, host, markets: r.rows[0].n });
  } catch (e) {
    const err = e as { message?: string; code?: string };
    return reply
      .status(500)
      .send({ ok: false, host, code: err.code ?? null, error: (err.message ?? String(e)).slice(0, 400) });
  }
});

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`Caesar API listening — GraphQL at http://localhost:${PORT}/graphql`);

    // Phase 4 realtime — attach a graphql-ws WebSocket server to Fastify's
    // underlying Node HTTP server. HTTP-upgrade requests at /graphql are handled
    // here; ordinary POST/GET still flow through the Yoga HTTP bridge above, so
    // both transports share the one /graphql path.
    const wss = new WebSocketServer({ server: app.server, path: "/graphql" });
    useServer(
      {
        schema,
        // Auth from connectionParams (FE sends authorization + privy-id-token).
        context: (ctx) =>
          buildWsContext(ctx.connectionParams as Record<string, unknown> | undefined),
      },
      wss,
    );
    app.log.info(`GraphQL subscriptions (graphql-ws) on ws://0.0.0.0:${PORT}/graphql`);
  })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
