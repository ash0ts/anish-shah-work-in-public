// Test-only wrapper around the unmodified built application. Never deployed.
import { withEnv } from "cloudflare:workers";
import { AsyncLocalStorage } from "node:async_hooks";
import application from "../../dist/server/index.js";

const observations = new AsyncLocalStorage();
const digest = crypto.subtle.digest.bind(crypto.subtle);
crypto.subtle.digest = async (algorithm, data) => {
  const observation = observations.getStore();
  if (observation && new TextDecoder().decode(data).startsWith('{"schemaVersion":"1.1","baseContentVersion":')) {
    observation.validations += 1;
  }
  return digest(algorithm, data);
};

const observationWorker = {
  async fetch(request, bindings, context) {
    const state = request.headers.get("x-fixture-state") ?? "public";
    const row = bindings.FIXTURES[state];
    if (!row) return new Response("Unknown fixture", { status: 400 });
    const observation = { reads: 0, validations: 0 };
    const database = {
      prepare(sql) {
        if (!sql.includes("publication.current")) throw new Error("Unexpected fixture query");
        return { async first() {
          observation.reads += 1;
          return row === "missing" ? null : row;
        } };
      },
    };
    const env = { ...bindings, DB: database, WORK_RATE_LIMITER: { async limit() { return { success: true }; } } };
    return observations.run(observation, () => withEnv(env, async () => {
      const response = await application.fetch(request, env, context);
      // Consume streaming SSR inside the context, including late metadata.
      const body = await response.text();
      const headers = new Headers(response.headers);
      headers.set("x-fixture-publication-reads", String(observation.reads));
      headers.set("x-fixture-publication-validations", String(observation.validations));
      return new Response(body, { status: response.status, headers });
    }));
  },
};

export default observationWorker;
