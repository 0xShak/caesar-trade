import process from "node:process";
import Fastify from "fastify";
import { createYoga } from "graphql-yoga";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/use/ws";
import { PrivyClient } from "@privy-io/server-auth";
import { loadEnv } from "@caesar/config";
import { schema } from "./schema.js";

const env = loadEnv();
const PORT = 4000;

const app = Fastify({ logger: true });

const yoga = createYoga({
  schema,
  graphqlEndpoint: "/graphql",
  graphiql: true,
  logging: false,
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
 * token server-side. Embedded-wallet extraction (getUser) is wired next session
 * once real Privy creds + an interactive login exist.
 */
app.post("/api/spike/privy-verify", async (req, reply) => {
  if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) {
    return reply
      .status(400)
      .send({ ok: false, error: "PRIVY_APP_ID/PRIVY_APP_SECRET not set in .env" });
  }
  const body = (req.body ?? {}) as { accessToken?: unknown; identityToken?: unknown };
  const accessToken = typeof body.accessToken === "string" ? body.accessToken : undefined;
  if (!accessToken) {
    return reply.status(400).send({ ok: false, error: "missing accessToken" });
  }

  const privy = new PrivyClient(env.PRIVY_APP_ID, env.PRIVY_APP_SECRET);
  try {
    const claims = await privy.verifyAuthToken(accessToken);
    return reply.send({
      ok: true,
      userId: claims.userId,
      identityTokenReceived: typeof body.identityToken === "string",
    });
  } catch (err) {
    return reply.status(401).send({ ok: false, error: (err as Error).message });
  }
});

app.get("/health", async () => ({ ok: true }));

app
  .listen({ port: PORT, host: "127.0.0.1" })
  .then(() => {
    app.log.info(`Caesar API listening — GraphQL at http://localhost:${PORT}/graphql`);

    // Phase 4 realtime — attach a graphql-ws WebSocket server to Fastify's
    // underlying Node HTTP server. HTTP-upgrade requests at /graphql are handled
    // here; ordinary POST/GET still flow through the Yoga HTTP bridge above, so
    // both transports share the one /graphql path.
    const wss = new WebSocketServer({ server: app.server, path: "/graphql" });
    useServer({ schema }, wss);
    app.log.info("GraphQL subscriptions (graphql-ws) on ws://localhost:4000/graphql");
  })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
