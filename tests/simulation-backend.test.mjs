import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

register("./content-connector-loader.mjs", import.meta.url);

const [
  approvalsModule,
  groundingModule,
  healthModule,
  maintenanceModule,
  policyModule,
  repositoryModule,
  runtimeModule,
  serviceModule,
  sessionCryptoModule,
  validationModule,
] = await Promise.all([
  import("../lib/server/simulation/approvals.ts"),
  import("../lib/server/simulation/grounding.ts"),
  import("../lib/server/simulation/health.ts"),
  import("../lib/server/maintenance.ts"),
  import("../lib/server/simulation/policy.ts"),
  import("../lib/server/simulation/repository.ts"),
  import("../lib/server/simulation/runtime.ts"),
  import("../lib/server/simulation/service.ts"),
  import("../lib/server/simulation/session-crypto.ts"),
  import("../lib/server/simulation/validation.ts"),
]);

const {
  disableSimulationProviderApproval,
  listSimulationProviderApprovals,
  providerApprovedForSimulationModel,
  upsertSimulationProviderApproval,
  validateSimulationProviderApproval,
} = approvalsModule;
const { getSimulationHealthSummary, simulationProviderApprovalDigest } =
  healthModule;
const { resolveSimulationGrounding } = groundingModule;
const { getStudioHealth } = maintenanceModule;
const {
  allowedEntityIds,
  authoredFallback,
  simulationExperienceEnabled,
  simulationManifest,
  trustedActions,
} = policyModule;
const {
  claimSimulationDailyBudget,
  createSimulationSession,
  getSimulationSession,
  pruneSimulationRetention,
  releaseSimulationTurn,
  reserveSimulationTurn,
} = repositoryModule;
const {
  simulationAiMode,
  simulationAiTransport,
  simulationRuntimeConfiguration,
} = runtimeModule;
const {
  resolveSimulationProviderTurn,
  SimulationServiceError,
  startSimulationSession,
  submitSimulationTurn,
} = serviceModule;
const {
  SIMULATION_COOKIE_NAME,
  createSimulationSessionToken,
  hashSimulationSessionToken,
  simulationSessionCookie,
} = sessionCryptoModule;
const {
  normalizeVisitorText,
  validateModelTurnOutput,
  validateSimulationTurnRequest,
} = validationModule;

const { handleSimulationSessionPost, handleSimulationTurnPost } =
  await import("../lib/server/simulation/http.ts");
const { throttleSimulationApi } =
  await import("../worker/rate-limiting.ts");

const hmacKey = Buffer.alloc(32, 71).toString("base64");
const publicBundle = JSON.parse(
  readFileSync(
    new URL("../content/public/anish-content.public.v1.json", import.meta.url),
    "utf8",
  ),
);
const localRuntime = {
  DB: null,
  NODE_ENV: "development",
  SITE_URL: "http://localhost:3000",
  SIMULATION_EXPERIENCE_MODE: "campaign-v1",
  SIMULATION_AI_MODE: "fixture",
  SIMULATION_SESSION_HMAC_KEY: hmacKey,
  SIMULATION_DAILY_MODEL_LIMIT: "4",
};

class SqliteD1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first(column) {
    const row = this.database.sqlite.prepare(this.sql).get(...this.values);
    if (column) return row?.[column] ?? null;
    return row ?? null;
  }

  async all() {
    return {
      success: true,
      results: this.database.sqlite.prepare(this.sql).all(...this.values),
      meta: {},
    };
  }

  async run() {
    const result = this.database.sqlite.prepare(this.sql).run(...this.values);
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

class SqliteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    const migration = readFileSync(
      new URL("../drizzle/0006_public_model_simulation.sql", import.meta.url),
      "utf8",
    ).replaceAll("--> statement-breakpoint", "");
    this.sqlite.exec(migration);
    this.sqlite.exec(`
      CREATE TABLE maintenance_state (
        key TEXT PRIMARY KEY NOT NULL,
        status TEXT NOT NULL,
        details_json TEXT DEFAULT '{}' NOT NULL,
        checked_at TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);
  }

  prepare(sql) {
    return new SqliteD1Statement(this, sql);
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.sqlite.close();
  }
}

async function withRuntime(bindings, callback) {
  const previous = globalThis.__ANISH_CONNECTOR_TEST_ENV__;
  globalThis.__ANISH_CONNECTOR_TEST_ENV__ = bindings;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete globalThis.__ANISH_CONNECTOR_TEST_ENV__;
    else globalThis.__ANISH_CONNECTOR_TEST_ENV__ = previous;
  }
}

function requestWithSession(token) {
  return new Request("http://localhost:3000/api/simulation/turn", {
    headers: { cookie: `${SIMULATION_COOKIE_NAME}=${token}` },
  });
}

test("campaign manifest exposes four bounded scenes and trusted fallbacks", () => {
  assert.equal(simulationManifest.schemaVersion, "1.0");
  assert.equal(simulationManifest.persona.displayName, "4N1SH");
  assert.equal(simulationManifest.persona.accessibleName, "Anish simulation");
  assert.equal(simulationManifest.workFactIds.length, 12);
  assert.equal(simulationManifest.metricIds.length, 4);
  assert.deepEqual(
    simulationManifest.scenes.map(({ id }) => id),
    ["act-1", "act-2", "act-3", "boss"],
  );
  assert.deepEqual(
    trustedActions("act-1").map(({ id }) => id),
    ["trace-the-system", "follow-the-people", "inspect-the-artifact"],
  );
  assert.equal(
    authoredFallback("act-2", "qualify").responseMode,
    "counter",
  );
  assert.equal(simulationExperienceEnabled(), false);
});

test("simulation HTTP writes reject cross-origin and oversized requests", async () => {
  const crossOrigin = await handleSimulationSessionPost(
    new Request("http://localhost:3000/api/simulation/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://untrusted.example",
      },
      body: JSON.stringify({
        mode: "tactical",
        difficulty: "story",
        curiosity: "systems",
      }),
    }),
  );
  assert.equal(crossOrigin.status, 403);

  const oversized = await handleSimulationTurnPost(
    new Request("http://localhost:3000/api/simulation/turn", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ padding: "x".repeat(2_100) }),
    }),
  );
  assert.equal(oversized.status, 413);
});

test("simulation API throttling fails closed and returns bounded retry state", async () => {
  const request = new Request("https://anish-shah-is.online/api/simulation/turn", {
    method: "POST",
    headers: { "cf-connecting-ip": "192.0.2.10" },
  });
  const missing = await throttleSimulationApi(
    { SIMULATION_EXPERIENCE_MODE: "campaign-v1" },
    request,
    false,
  );
  assert.equal(missing?.status, 503);

  const limited = await throttleSimulationApi(
    {
      SIMULATION_EXPERIENCE_MODE: "campaign-v1",
      RATE_LIMIT_SALT: "r".repeat(32),
      SIMULATION_RATE_LIMITER: {
        limit: async () => ({ success: false }),
      },
    },
    request,
    false,
  );
  assert.equal(limited?.status, 429);
  assert.equal(limited?.headers.get("retry-after"), "60");
});

test("timeouts, blocked responses, provider errors, and invalid output use authored fallback", async () => {
  const entityId = "group:products:wandb-mcp";
  const authored = {
    opponentLine: "The authored route stays available.",
    responseMode: "redirect",
    revealEntityIds: [entityId],
    visitorSignals: ["systems-thinking"],
  };
  const groundedInput = {
    sceneId: "act-1",
    actionId: "trace-the-system",
    facts: [],
    allowedEntityIds: [entityId],
    visitorSignals: [],
    curiosity: "systems",
    providerGrounding: null,
  };
  for (const error of [
    new DOMException("Timed out", "TimeoutError"),
    Object.assign(new Error("rate limited"), { status: 429 }),
    Object.assign(new Error("provider unavailable"), { status: 503 }),
    new Error("guardrail_blocked"),
  ]) {
    const result = await resolveSimulationProviderTurn({
      provider: {
        source: "generated",
        generateTurn: async () => {
          throw error;
        },
      },
      groundedInput,
      sceneId: "act-1",
      eligibleEntities: new Set([entityId]),
      authored,
    });
    assert.deepEqual(result, {
      source: "authored_fallback",
      opponent: authored,
    });
  }

  const malformed = await resolveSimulationProviderTurn({
    provider: {
      source: "generated",
      generateTurn: async () => ({ opponentLine: "missing contract fields" }),
    },
    groundedInput,
    sceneId: "act-1",
    eligibleEntities: new Set([entityId]),
    authored,
  });
  assert.equal(malformed.source, "authored_fallback");
  assert.deepEqual(malformed.opponent, authored);
});

test("turn grounding intersects manifest facts with visible work and public evidence", () => {
  const groupId = "group:products:wandb-mcp";
  const factId = "fact:work:wandb-mcp";
  const evidenceIds = [
    "evidence:web:cdcf0840eeee30b7",
    "evidence:web:39bc2aeed28f611d",
  ];
  const ready = resolveSimulationGrounding(publicBundle, "act-1");
  assert.equal(ready.allowedEntityIds.has(groupId), true);
  assert.deepEqual(
    ready.factCards.find((fact) => fact.id === factId)?.evidenceIds,
    evidenceIds,
  );

  const hiddenWork = structuredClone(publicBundle);
  hiddenWork.workGroups = hiddenWork.workGroups.filter(
    (group) => group.id !== groupId,
  );
  const hiddenGrounding = resolveSimulationGrounding(hiddenWork, "act-1");
  assert.equal(hiddenGrounding.allowedEntityIds.has(groupId), false);
  assert.equal(
    hiddenGrounding.factCards.some((fact) => fact.id === factId),
    false,
  );

  const partiallyRedacted = structuredClone(publicBundle);
  partiallyRedacted.evidence = partiallyRedacted.evidence.filter(
    (evidence) => evidence.id !== evidenceIds[0],
  );
  assert.deepEqual(
    resolveSimulationGrounding(partiallyRedacted, "act-1").factCards.find(
      (fact) => fact.id === factId,
    )?.evidenceIds,
    [evidenceIds[1]],
  );

  const fullyRedacted = structuredClone(publicBundle);
  fullyRedacted.evidence = fullyRedacted.evidence.filter(
    (evidence) => !evidenceIds.includes(evidence.id),
  );
  const noEvidenceGrounding = resolveSimulationGrounding(
    fullyRedacted,
    "act-1",
  );
  assert.equal(noEvidenceGrounding.allowedEntityIds.has(groupId), false);
  assert.equal(
    noEvidenceGrounding.factCards.some((fact) => fact.id === factId),
    false,
  );
});

test("visitor text is grapheme-bounded and rejects contact or secret material", () => {
  assert.equal(normalizeVisitorText("  systems   thinking  ").value, "systems thinking");
  assert.equal(normalizeVisitorText("🧠".repeat(280)).ok, true);
  assert.equal(normalizeVisitorText("🧠".repeat(281)).ok, false);
  for (const unsafe of [
    "email me at visitor@example.com",
    "see https://example.com",
    "call +1 (212) 555-1212",
    ["api_key=sk", "example", "example", "example"].join("-"),
  ]) {
    assert.deepEqual(normalizeVisitorText(unsafe).ok, false, unsafe);
  }
  const disallowed = validateSimulationTurnRequest({
    requestId: "018f7d86-c8dc-7f71-8999-8f5d4ab19cab",
    revision: 0,
    sceneId: "act-1",
    actionId: "trace-the-system",
    freeText: "A bounded thought",
  });
  assert.equal(disallowed.ok, false);
  if (!disallowed.ok) assert.equal(disallowed.code, "free_text_not_allowed");
});

test("model output accepts only scene-grounded IDs and nonfactual prose", () => {
  const [eligible] = allowedEntityIds("act-1");
  assert.ok(eligible);
  const valid = {
    opponentLine: "That artifact complicates the label.",
    responseMode: "acknowledge",
    revealEntityIds: [eligible],
    visitorSignals: ["systems-thinking"],
  };
  assert.deepEqual(validateModelTurnOutput(valid, "act-1"), valid);
  assert.equal(
    validateModelTurnOutput({ ...valid, revealEntityIds: ["private:record"] }, "act-1"),
    null,
  );
  assert.equal(
    validateModelTurnOutput({ ...valid, opponentLine: "A $2M claim." }, "act-1"),
    null,
  );
  assert.equal(
    validateModelTurnOutput({ ...valid, opponentLine: "Read [this](https://x.io)." }, "act-1"),
    null,
  );
  assert.equal(validateModelTurnOutput({ ...valid, extra: true }, "act-1"), null);
  assert.equal(
    validateModelTurnOutput(valid, "act-1", new Set()),
    null,
  );
});

test("session tokens are opaque and only their HMAC is stored", async () => {
  const token = createSimulationSessionToken();
  const hash = await hashSimulationSessionToken(token, hmacKey);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(hash, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(hash, token);
  const cookie = simulationSessionCookie(token);
  assert.match(cookie, /^__Host-anish_simulation=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
});

test("fixture campaign persists safe IDs while discarding optional visitor text", async () => {
  const database = new SqliteD1();
  try {
    await withRuntime({ ...localRuntime, DB: database }, async () => {
      assert.equal(simulationExperienceEnabled(), true);
      assert.equal(simulationAiMode(), "fixture");
      const created = await startSimulationSession(
        new Request("http://localhost:3000/api/simulation/session"),
        { mode: "action", difficulty: "standard", curiosity: "systems" },
      );
      const sessionRequest = requestWithSession(created.token);
      const turns = [
        {
          requestId: "018f7d86-c8dc-7f71-8999-8f5d4ab19ca1",
          revision: 0,
          sceneId: "act-1",
          actionId: "trace-the-system",
        },
        {
          requestId: "018f7d86-c8dc-7f71-8999-8f5d4ab19ca2",
          revision: 1,
          sceneId: "act-2",
          actionId: "qualify",
          freeText: "I care about evaluation rigor without flattening context",
        },
        {
          requestId: "018f7d86-c8dc-7f71-8999-8f5d4ab19ca3",
          revision: 2,
          sceneId: "act-3",
          actionId: "read",
          freeText: "Show me how research and teaching reinforce each other",
        },
        {
          requestId: "018f7d86-c8dc-7f71-8999-8f5d4ab19ca4",
          revision: 3,
          sceneId: "boss",
          actionId: "connect-the-facets",
        },
      ];
      let finalResponse;
      for (const turn of turns) {
        finalResponse = await submitSimulationTurn(sessionRequest, turn);
        assert.equal(finalResponse.source, "fixture");
        assert.equal(finalResponse.revision, turn.revision + 1);
        if (turn.revision === 0) {
          await assert.rejects(
            submitSimulationTurn(sessionRequest, {
              ...turn,
              requestId: "018f7d86-c8dc-7f71-8999-8f5d4ab19caa",
            }),
            (error) =>
              error instanceof SimulationServiceError &&
              error.code === "simulation_revision_conflict",
          );
        }
      }
      assert.equal(finalResponse.session.status, "complete");
      assert.equal(finalResponse.session.sceneId, "complete");
      assert.equal(finalResponse.session.remainingFreeTextTurns, 0);
      assert.equal(finalResponse.session.remainingGeneratedBeats, 0);

      const row = database.sqlite
        .prepare("SELECT * FROM simulation_sessions")
        .get();
      const serialized = JSON.stringify(row);
      assert.doesNotMatch(serialized, /evaluation rigor without/i);
      assert.doesNotMatch(serialized, /research and teaching reinforce/i);
      assert.doesNotMatch(serialized, new RegExp(created.token));
      assert.equal(row.free_text_turns, 2);
      assert.equal(row.generation_calls, 4);
      assert.equal(row.turn_count, 4);

      const duplicate = await submitSimulationTurn(sessionRequest, turns.at(-1));
      assert.deepEqual(duplicate, finalResponse);

      const storedResponse = JSON.parse(row.last_response_json);
      storedResponse.unexpectedPrivateField = "must not survive validation";
      database.sqlite
        .prepare(
          "UPDATE simulation_sessions SET last_response_json = ? WHERE session_hash = ?",
        )
        .run(JSON.stringify(storedResponse), row.session_hash);
      assert.equal(
        (await getSimulationSession(database, row.session_hash))?.lastResponse,
        null,
      );
      await assert.rejects(
        submitSimulationTurn(sessionRequest, {
          ...turns.at(-1),
          requestId: "018f7d86-c8dc-7f71-8999-8f5d4ab19caf",
        }),
        (error) =>
          error instanceof SimulationServiceError &&
          error.code === "simulation_revision_conflict",
      );
    });
  } finally {
    database.close();
  }
});

test("active generation leases reject concurrency and release without replay", async () => {
  const database = new SqliteD1();
  try {
    const sessionHash = "b".repeat(64);
    const now = new Date("2026-08-03T12:00:00.000Z");
    await createSimulationSession(
      database,
      sessionHash,
      { mode: "tactical", difficulty: "story", curiosity: "research" },
      now,
    );
    const firstRequest = "018f7d86-c8dc-7f71-8999-8f5d4ab19cb1";
    const secondRequest = "018f7d86-c8dc-7f71-8999-8f5d4ab19cb2";
    assert.equal(
      (await reserveSimulationTurn(database, sessionHash, 0, firstRequest, now))
        .status,
      "reserved",
    );
    assert.equal(
      (await reserveSimulationTurn(database, sessionHash, 0, secondRequest, now))
        .status,
      "turn_in_progress",
    );
    assert.equal(
      (await reserveSimulationTurn(database, sessionHash, 0, firstRequest, now))
        .status,
      "turn_in_progress",
    );
    await releaseSimulationTurn(database, sessionHash, 0, firstRequest);
    assert.equal(
      (await reserveSimulationTurn(database, sessionHash, 0, secondRequest, now))
        .status,
      "reserved",
    );
  } finally {
    database.close();
  }
});

test("repository enforces the daily model budget atomically", async () => {
  const database = new SqliteD1();
  try {
    const now = new Date("2026-08-03T12:00:00.000Z");
    assert.equal(await claimSimulationDailyBudget(database, 2, now), true);
    assert.equal(await claimSimulationDailyBudget(database, 2, now), true);
    assert.equal(await claimSimulationDailyBudget(database, 2, now), false);
    const row = database.sqlite
      .prepare("SELECT model_calls FROM simulation_daily_budget")
      .get();
    assert.equal(row.model_calls, 2);
  } finally {
    database.close();
  }
});

test("provider approvals require both scopes and expire closed", async () => {
  const database = new SqliteD1();
  try {
    const approvedAt = "2026-08-01T00:00:00.000Z";
    const approval = {
      provider: "spotify",
      scopes: ["game_display", "llm_context"],
      reference: "Owner-held permission record",
      approvedAt,
      expiresAt: "2026-09-01T00:00:00.000Z",
      enabled: true,
    };
    assert.deepEqual(validateSimulationProviderApproval(approval), approval);
    await upsertSimulationProviderApproval(approval, database);
    assert.equal(
      await providerApprovedForSimulationModel(
        "spotify",
        new Date("2026-08-15T00:00:00.000Z"),
        database,
      ),
      true,
    );
    assert.equal(
      await providerApprovedForSimulationModel(
        "spotify",
        new Date("2026-09-01T00:00:00.000Z"),
        database,
      ),
      false,
    );
    await disableSimulationProviderApproval("spotify", database);
    assert.equal((await listSimulationProviderApprovals(database))[0].enabled, false);
    assert.equal(
      validateSimulationProviderApproval({ ...approval, reference: "" }),
      null,
    );
  } finally {
    database.close();
  }
});

test("retention removes expired sessions and old aggregate budgets", async () => {
  const database = new SqliteD1();
  try {
    const old = new Date("2026-01-01T00:00:00.000Z");
    await createSimulationSession(
      database,
      "a".repeat(64),
      { mode: "tactical", difficulty: "story", curiosity: "surprise" },
      old,
    );
    await claimSimulationDailyBudget(database, 10, old);
    await pruneSimulationRetention(database, new Date("2026-08-03T00:00:00.000Z"));
    assert.equal(await getSimulationSession(database, "a".repeat(64)), null);
    assert.equal(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM simulation_daily_budget")
        .get().count,
      0,
    );
  } finally {
    database.close();
  }
});

test("health output is sanitized and approval digest omits references", async () => {
  const database = new SqliteD1();
  try {
    await upsertSimulationProviderApproval(
      {
        provider: "hardcover",
        scopes: ["game_display", "llm_context"],
        reference: "private-contact-and-terms-reference",
        approvedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: null,
        enabled: true,
      },
      database,
    );
    await withRuntime({ ...localRuntime, DB: database }, async () => {
      const health = await getSimulationHealthSummary(
        new Date("2026-08-03T00:00:00.000Z"),
        database,
      );
      assert.deepEqual(health.approvedProviders, ["hardcover"]);
      assert.equal("reference" in health, false);
      assert.equal(health.aiMode, "fixture");
      assert.equal(health.dailyModelLimit, 4);
      const digest = await simulationProviderApprovalDigest(database);
      assert.match(digest, /^[a-f0-9]{64}$/);
      assert.doesNotMatch(JSON.stringify(health), /private-contact/);

      const ownerHealth = await getStudioHealth();
      assert.equal(ownerHealth.simulation.campaignVersion, "meet-me-4n1sh-v1");
      assert.deepEqual(ownerHealth.simulation.approvedProviders, ["hardcover"]);
      assert.equal(ownerHealth.simulation.providerApprovalDigest, digest);
      assert.doesNotMatch(JSON.stringify(ownerHealth), /private-contact/);
    });
  } finally {
    database.close();
  }
});

test("scheduled Worker prunes simulation state with connector retention", () => {
  const worker = readFileSync(
    new URL("../worker/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(worker, /import \{ pruneSimulationRetention \}/);
  assert.match(worker, /await pruneSimulationRetention\(db, scheduledAt\)/);
});

test("hosted fixture mode fails closed and live mode requires Gateway BYOK", async () => {
  await withRuntime(
    {
      DEPLOYMENT_TIER: "production",
      NODE_ENV: "production",
      SIMULATION_EXPERIENCE_MODE: "campaign-v1",
      SIMULATION_AI_MODE: "fixture",
    },
    async () => {
      assert.equal(simulationAiMode(), "invalid");
      assert.equal(simulationRuntimeConfiguration().configured, false);
    },
  );
  await withRuntime(
    {
      DEPLOYMENT_TIER: "production",
      NODE_ENV: "production",
      SIMULATION_EXPERIENCE_MODE: "campaign-v1",
      SIMULATION_AI_MODE: "live",
      SIMULATION_PROVIDER: "anthropic",
      SIMULATION_MODEL: "claude-sonnet-5",
    },
    async () => {
      assert.equal(simulationRuntimeConfiguration().configured, false);
    },
  );
});

test("direct Anthropic transport is restricted to exact local development", async () => {
  const directLocal = {
    NODE_ENV: "development",
    SITE_URL: "http://localhost:3000",
    SIMULATION_EXPERIENCE_MODE: "campaign-v1",
    SIMULATION_AI_MODE: "live",
    SIMULATION_AI_TRANSPORT: "direct-local",
    SIMULATION_PROVIDER: "anthropic",
    SIMULATION_MODEL: "claude-sonnet-5",
    SIMULATION_LOCAL_ANTHROPIC_API_KEY: "l".repeat(40),
  };
  await withRuntime(directLocal, async () => {
    assert.equal(simulationAiTransport(), "direct-local");
    assert.equal(simulationRuntimeConfiguration().configured, true);
  });
  for (const invalid of [
    { ...directLocal, DEPLOYMENT_TIER: "staging" },
    { ...directLocal, DEPLOYMENT_TIER: "production" },
    { ...directLocal, SITE_URL: "https://anish-shah-is.online" },
    { ...directLocal, SITE_URL: "http://localhost:3001" },
    { ...directLocal, NODE_ENV: "production" },
  ]) {
    await withRuntime(invalid, async () => {
      assert.equal(simulationAiTransport(), "invalid");
      assert.equal(simulationRuntimeConfiguration().configured, false);
    });
  }
  const missingKey = { ...directLocal };
  delete missingKey.SIMULATION_LOCAL_ANTHROPIC_API_KEY;
  await withRuntime(missingKey, async () => {
    assert.equal(simulationAiTransport(), "direct-local");
    assert.equal(simulationRuntimeConfiguration().configured, false);
  });
  await withRuntime(
    { ...directLocal, SIMULATION_LOCAL_ANTHROPIC_API_KEY: `${"x".repeat(20)} y` },
    async () => {
      assert.equal(simulationRuntimeConfiguration().configured, false);
    },
  );
});

test("provider source enforces Gateway privacy headers and rejects hosted raw-key configuration", () => {
  const source = readFileSync(
    new URL("../lib/server/simulation/provider.ts", import.meta.url),
    "utf8",
  );
  for (const requirement of [
    '"cf-aig-collect-log": "false"',
    '"cf-aig-collect-log-payload": "false"',
    '"cf-aig-skip-cache": "true"',
    '"cf-aig-max-attempts": "1"',
    '"cf-aig-request-timeout": "7500"',
    "timeout: MODEL_TIMEOUT_MS",
    "maxRetries: 0",
    'anthropic: { thinking: { type: "disabled" } }',
    'redirect: "manual"',
    "response.status >= 300 && response.status < 400",
  ]) {
    assert.match(source, new RegExp(requirement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(source, /SIMULATION_ANTHROPIC_API_KEY/);
  assert.doesNotMatch(source, /process\.env\.ANTHROPIC_API_KEY/);
  assert.doesNotMatch(source, /temperature\s*:/);
  assert.doesNotMatch(source, /topP\s*:/);
  assert.doesNotMatch(source, /topK\s*:/);
});

test("local live-model launcher isolates shared env values from the app process", () => {
  const launcher = readFileSync(
    new URL("../scripts/run-local-simulation-live.mjs", import.meta.url),
    "utf8",
  );
  const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(launcher, /candidateStat\.mode & 0o077/);
  assert.match(launcher, /for \(const name of assignedNames\) delete childEnvironment\[name\]/);
  assert.match(launcher, /SIMULATION_AI_TRANSPORT: "direct-local"/);
  assert.match(launcher, /SIMULATION_LOCAL_ANTHROPIC_API_KEY: apiKey/);
  assert.doesNotMatch(launcher, /console\.(?:log|error)\([^\n]*apiKey/);
  for (const binding of [
    "RATE_LIMIT_SALT",
    "SIMULATION_SESSION_HMAC_KEY",
    "SIMULATION_AI_TRANSPORT",
    "SIMULATION_LOCAL_ANTHROPIC_API_KEY",
  ]) {
    assert.match(vite, new RegExp(`"${binding}"`));
  }
  assert.match(vite, /process\.env\[name\] \?\? localEnvironment\[name\]/);
  assert.match(
    vite,
    /process\.env\.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false"/,
  );
});
