import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  assertPreviewConfiguration,
  assertStagingConfiguration,
  expectedPreviewCoordinates,
  expectedStagingCoordinates,
  previewConfiguration,
  safeGeneratedWorkerBase,
  stagingConfiguration,
} from "../scripts/lib/hosted-config-contract.mjs";
import {
  collectOpenPullRequestNumbers,
  ownedPreviewDomainRecord,
  previewPrFromWorkerName,
  previewResourceCoordinates,
} from "../scripts/lib/preview-resource-contract.mjs";

register("./content-connector-loader.mjs", import.meta.url);

const { productionOriginResponse } = await import("../worker/production-origin.ts");
const { hostedDeploymentBoundaryResponse } = await import("../worker/deployment-boundary.ts");
const { requiresHostedAccessIdentity } = await import("../worker/access.ts");
const { securedResponse, securityPolicy } = await import("../worker/security-headers.ts");
const { previewConnectorSnapshot, previewStravaSnapshot } = await import(
  "../lib/server/preview-connector-fixtures.ts"
);
const { projectConnectorSnapshotForPublic } = await import(
  "../lib/server/connectors/public-gallery.ts"
);
const {
  getCollectionScreenFoundation,
  getDiscogsScreenFoundation,
  getMovementScreenFoundation,
  getSpotifyScreenFoundation,
  previewFixtureForPlayRoute,
} = await import("../lib/server/play-screen-foundation.ts");

const contentVersion = "b".repeat(16);
const releaseSha = "a".repeat(40);
const productionD1Id = [
  "b9dbe711", "1cb2", "4d9d", "b8a9", "e8c9817a8284",
].join("-");
const productionKvId = ["ffa5a21ac0794aa0", "b6dfc0b5d1bb3c71"].join("");
const productionAccessAudience = [
  "d4e795ec79fe4cb854aad43bd5d22722",
  "75505c6054f218fde92f6b633ca5c735",
].join("");

function generatedBase() {
  return {
    main: "index.js",
    compatibility_date: "2026-07-30",
    compatibility_flags: ["nodejs_compat"],
    jsx_factory: "React.createElement",
    jsx_fragment: "React.Fragment",
    no_bundle: true,
    rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
    assets: { directory: "../client" },
    vars: {},
    triggers: {},
    durable_objects: { bindings: [] },
    d1_databases: [{
      binding: "DB",
      database_name: "site-creator-d1",
      database_id: "00000000-0000-4000-8000-000000000000",
    }],
  };
}

function stagingEnvironment() {
  return {
    STAGING_VALIDATED_SHA: releaseSha,
    RELEASE_VALIDATED_SHA: releaseSha,
    STAGING_CLOUDFLARE_D1_DATABASE_ID: "11111111-1111-4111-8111-111111111111",
    STAGING_CLOUDFLARE_D1_DATABASE_NAME: "anish-shah-work-in-public-staging",
    STAGING_CLOUDFLARE_PUBLICATION_CACHE_ID: "1".repeat(32),
    STAGING_CF_ACCESS_AUD: "staging-access-audience",
    STAGING_OWNER_RATE_LIMIT_NAMESPACE_ID: "99001001",
    STAGING_ARTWORK_RATE_LIMIT_NAMESPACE_ID: "99001002",
    STAGING_PROMOTION_RATE_LIMIT_NAMESPACE_ID: "99001003",
    STAGING_OAUTH_CALLBACK_RATE_LIMIT_NAMESPACE_ID: "99001004",
    OWNER_EMAILS: "owner@example.com",
    CF_ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
  };
}

test("staging config uses only isolated resources and exact noindex-ready boundaries", () => {
  const expected = expectedStagingCoordinates(stagingEnvironment(), contentVersion);
  const config = stagingConfiguration(generatedBase(), expected);
  assert.doesNotThrow(() => assertStagingConfiguration(config, expected));
  assert.equal(config.name, "anish-shah-work-in-public-staging");
  assert.deepEqual(config.routes, [
    { pattern: "staging.anish-shah-is.online", custom_domain: true },
  ]);
  assert.equal(config.vars.DEPLOYMENT_TIER, "staging");
  assert.equal(config.vars.PUBLIC_CONTENT_MODE, "d1_kv_required");
  assert.equal(config.vars.PLAY_EXPERIENCE_MODE, "my-room-2001");
  assert.equal(config.vars.PRODUCTION_SITE_URL, "https://anish-shah-is.online");
  assert.equal(config.observability.logs.invocation_logs, false);
  assert.deepEqual(config.triggers.crons, ["47 * * * *"]);

  assert.throws(
    () => expectedStagingCoordinates({
      ...stagingEnvironment(),
      STAGING_CLOUDFLARE_D1_DATABASE_ID: productionD1Id,
    }, contentVersion),
    /must differ/,
  );
  assert.throws(
    () => expectedStagingCoordinates({
      ...stagingEnvironment(),
      STAGING_CLOUDFLARE_PUBLICATION_CACHE_ID: productionKvId,
    }, contentVersion),
    /must differ/,
  );
  assert.throws(
    () => expectedStagingCoordinates({
      ...stagingEnvironment(),
      STAGING_CF_ACCESS_AUD: productionAccessAudience,
    }, contentVersion),
    /must differ/,
  );
  assert.throws(
    () => expectedStagingCoordinates({
      ...stagingEnvironment(),
      STAGING_OWNER_RATE_LIMIT_NAMESPACE_ID: "88001001",
    }, contentVersion),
    /non-production/,
  );
});

test("preview config has no durable, secret, cron, Studio, or OAuth capability", () => {
  const expected = expectedPreviewCoordinates({
    RELEASE_VALIDATED_SHA: releaseSha,
    PREVIEW_PR_NUMBER: "42",
    PREVIEW_CF_ACCESS_AUD: "preview-access-audience",
    CF_ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
  }, contentVersion);
  const config = previewConfiguration(generatedBase(), expected);
  assert.doesNotThrow(() => assertPreviewConfiguration(config, expected));
  assert.equal(config.name, "anish-shah-work-in-public-pr-42");
  assert.deepEqual(config.d1_databases, []);
  assert.deepEqual(config.kv_namespaces, []);
  assert.deepEqual(config.ratelimits, []);
  assert.equal(config.triggers, undefined);
  assert.equal(config.vars.PUBLIC_CONTENT_MODE, "static_preview");
  assert.equal(config.vars.DEPLOYMENT_TIER, "preview");
  assert.equal(config.vars.PLAY_EXPERIENCE_MODE, "my-room-2001");
  assert.equal("OWNER_EMAILS" in config.vars, false);
  assert.equal("CONNECTOR_ENCRYPTION_KEY" in config.vars, false);
  assert.doesNotThrow(() =>
    safeGeneratedWorkerBase({
      ...generatedBase(),
      queues: { producers: [], consumers: [] },
    }),
  );

  for (const malicious of [
    { services: [{ binding: "PRODUCTION", service: "anish-shah-work-in-public" }] },
    { r2_buckets: [{ binding: "PRIVATE", bucket_name: "owner-private" }] },
    { secrets_store_secrets: [{ binding: "TOKEN", store_id: "private" }] },
    { d1_databases: [{ binding: "DB", database_name: "production", database_id: "22222222-2222-4222-8222-222222222222" }] },
  ]) {
    assert.throws(
      () => safeGeneratedWorkerBase({ ...generatedBase(), ...malicious }),
      /forbidden|non-placeholder/,
    );
  }
});

test("host routing accepts only the exact origin for each declared tier", () => {
  const options = { development: false, sitesRuntime: false };
  const production = {
    DEPLOYMENT_TIER: "production",
    SITE_URL: "https://anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "d1_kv_required",
  };
  const staging = {
    DEPLOYMENT_TIER: "staging",
    SITE_URL: "https://staging.anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "d1_kv_required",
  };
  const preview = {
    DEPLOYMENT_TIER: "preview",
    PREVIEW_PR_NUMBER: "42",
    SITE_URL: "https://pr-42.anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "static_preview",
  };
  assert.equal(productionOriginResponse(
    new Request("https://anish-shah-is.online/work"), production, options,
  ), null);
  assert.equal(productionOriginResponse(
    new Request("https://staging.anish-shah-is.online/work"), staging, options,
  ), null);
  assert.equal(productionOriginResponse(
    new Request("https://pr-42.anish-shah-is.online/work"), preview, options,
  ), null);
  assert.equal(productionOriginResponse(
    new Request("https://anish-shah-is.online/work"), staging, options,
  )?.status, 421);
  assert.equal(productionOriginResponse(
    new Request("https://pr-43.anish-shah-is.online/work"), preview, options,
  )?.status, 421);
  assert.equal(productionOriginResponse(
    new Request("https://staging.anish-shah-is.online/work"),
    { ...staging, PUBLIC_CONTENT_MODE: "static_preview" }, options,
  )?.status, 503);
});

test("staging callbacks alone bypass identity while preview remains fully gated", () => {
  assert.equal(requiresHostedAccessIdentity("/work", "staging"), true);
  for (const provider of ["myanimelist", "spotify", "discogs"]) {
    assert.equal(
      requiresHostedAccessIdentity(
        `/api/connectors/${provider}/oauth/callback`,
        "staging",
      ),
      false,
      provider,
    );
    assert.equal(
      requiresHostedAccessIdentity(
        `/api/connectors/${provider}/oauth/callback/extra`,
        "staging",
      ),
      true,
      `${provider} near miss`,
    );
  }
  assert.equal(
    requiresHostedAccessIdentity("/api/connectors/spotify/oauth/callback", "preview"),
    true,
  );
  assert.equal(requiresHostedAccessIdentity("/work", "production"), false);

  const studio = hostedDeploymentBoundaryResponse(
    new Request("https://pr-42.anish-shah-is.online/studio"),
    "preview",
  );
  assert.equal(studio?.status, 404);
  const write = hostedDeploymentBoundaryResponse(
    new Request("https://pr-42.anish-shah-is.online/api/example", { method: "POST" }),
    "preview",
  );
  assert.equal(write?.status, 405);
  assert.equal(
    hostedDeploymentBoundaryResponse(
      new Request("https://pr-42.anish-shah-is.online/play"),
      "preview",
    ),
    null,
  );
});

test("sitemap publishes room routes only for the production-facing room mode", async () => {
  const previous = globalThis.__ANISH_CONNECTOR_TEST_ENV__;
  const sitemap = (await import("../app/sitemap.ts")).default;
  try {
    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
      PLAY_EXPERIENCE_MODE: "classic",
    };
    const classic = await sitemap();
    assert.equal(
      classic.filter(({ url }) => /\/play\/(?:watch|read|listen|collect|play|move)$/.test(url)).length,
      0,
    );

    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
      PLAY_EXPERIENCE_MODE: "my-room-2001",
    };
    const room = await sitemap();
    assert.deepEqual(
      room
        .filter(({ url }) => /\/play\/(?:watch|read|listen|collect|play|move)$/.test(url))
        .map(({ url }) => new URL(url).pathname)
        .sort(),
      [
        "/play/collect",
        "/play/listen",
        "/play/move",
        "/play/play",
        "/play/read",
        "/play/watch",
      ],
    );

    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
      DEPLOYMENT_TIER: "staging",
      SITE_URL: "https://staging.anish-shah-is.online",
      PRODUCTION_SITE_URL: "https://anish-shah-is.online",
      PUBLIC_CONTENT_MODE: "d1_kv_required",
      PLAY_EXPERIENCE_MODE: "my-room-2001",
    };
    assert.deepEqual(await sitemap(), []);
  } finally {
    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = previous;
  }
});

test("staging and preview responses are private and unindexable", () => {
  for (const tier of ["staging", "preview"]) {
    const response = securedResponse(
      new Response("page", { status: 200, headers: { "content-type": "text/html" } }),
      new Request(`https://${tier === "staging" ? "staging" : "pr-42"}.anish-shah-is.online/work`, {
        headers: { accept: "text/html" },
      }),
      "A".repeat(24),
      false,
      "/work",
      tier,
    );
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
    assert.match(response.headers.get("x-robots-tag") ?? "", /noimageindex/);
  }
});

test("RSC presentation reads hosted tier from Cloudflare runtime bindings", async () => {
  const previous = globalThis.__ANISH_CONNECTOR_TEST_ENV__;
  globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
    DEPLOYMENT_TIER: "preview",
    PREVIEW_PR_NUMBER: "42",
    SITE_URL: "https://pr-42.anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "static_preview",
  };
  try {
    const [{ runtimeRootMetadata }, { PreviewEnvironmentNotice }, robotsModule, sitemapModule] =
      await Promise.all([
        import("../lib/server/root-metadata.ts"),
        import("../components/PreviewEnvironmentNotice.ts"),
        import("../app/robots.ts"),
        import("../app/sitemap.ts"),
      ]);
    const metadata = runtimeRootMetadata();
    assert.equal(
      metadata.title.default,
      "[PR #42] Anish Shah — Applied AI, in public",
    );
    assert.deepEqual(metadata.robots, {
      index: false,
      follow: false,
      noarchive: true,
      nosnippet: true,
    });
    const notice = renderToStaticMarkup(PreviewEnvironmentNotice());
    assert.match(notice, /Synthetic preview data · PR #42/);
    assert.match(notice, /Synthetic · PR #42/);
    assert.deepEqual(robotsModule.default(), {
      rules: { userAgent: "*", disallow: "/" },
    });
    assert.deepEqual(await sitemapModule.default(), []);
    assert.equal(metadata.metadataBase.origin, "https://anish-shah-is.online");
  } finally {
    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = previous;
  }
});

test("the preview marker stays in the header gap instead of covering page controls", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const rule = css.match(/\.preview-environment-notice\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(rule, "Expected the preview notice rule");
  assert.match(rule, /top:\s*0\.75rem/);
  assert.match(rule, /left:\s*50%/);
  assert.match(rule, /transform:\s*translateX\(-50%\)/);
  assert.doesNotMatch(rule, /bottom:|right:/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*preview-environment-notice__compact/);
});

test("preview blocks provider frames and serves only neutral artwork", async () => {
  const previewPolicy = securityPolicy("A".repeat(24), false, "preview");
  assert.match(previewPolicy, /frame-src 'none'/);
  assert.doesNotMatch(previewPolicy, /open\.spotify\.com|strava-embeds\.com/);
  assert.match(
    securityPolicy("A".repeat(24), false, "staging"),
    /frame-src https:\/\/open\.spotify\.com/,
  );

  const artwork = hostedDeploymentBoundaryResponse(
    new Request(
      "https://pr-42.anish-shah-is.online/api/connector-artwork/spotify/arbitrary",
    ),
    "preview",
  );
  assert.equal(artwork?.status, 200);
  assert.equal(artwork?.headers.get("x-preview-artwork"), "neutral-placeholder");
  assert.equal(artwork?.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  assert.doesNotMatch(
    await artwork?.text(),
    /open\.spotify\.com|i\.scdn\.co|myanimelist|hardcover|steam|strava/i,
  );
});

test("preview cleanup can detach only its exact domain and Worker pair", () => {
  const coordinates = previewResourceCoordinates("42");
  const records = [
    {
      id: "preview-domain-42",
      hostname: "pr-42.anish-shah-is.online",
      service: "anish-shah-work-in-public-pr-42",
    },
    {
      id: "staging-domain",
      hostname: "staging.anish-shah-is.online",
      service: "anish-shah-work-in-public-staging",
    },
    {
      id: "production-domain",
      hostname: "anish-shah-is.online",
      service: "anish-shah-work-in-public",
    },
    {
      id: "preview-domain-43",
      hostname: "pr-43.anish-shah-is.online",
      service: "anish-shah-work-in-public-pr-43",
    },
  ];
  assert.equal(
    ownedPreviewDomainRecord(records, coordinates)?.id,
    "preview-domain-42",
  );
  assert.equal(previewPrFromWorkerName("anish-shah-work-in-public"), null);
  assert.equal(
    ownedPreviewDomainRecord(records, previewResourceCoordinates("44")),
    null,
  );
  assert.throws(
    () => ownedPreviewDomainRecord([
      {
        id: "wrong-owner-domain",
        hostname: "pr-42.anish-shah-is.online",
        service: "anish-shah-work-in-public-staging",
      },
    ], coordinates),
    /Refusing to detach/,
  );
});

test("preview janitor accounts for open pull requests beyond the first page", async () => {
  const pages = [
    Array.from({ length: 100 }, (_, index) => ({ number: index + 1 })),
    [{ number: 101 }],
  ];
  const requested = [];
  const open = await collectOpenPullRequestNumbers(async (page, pageSize) => {
    requested.push({ page, pageSize });
    return pages[page - 1] ?? [];
  });

  assert.deepEqual(requested, [
    { page: 1, pageSize: 100 },
    { page: 2, pageSize: 100 },
  ]);
  assert.equal(open.has("1"), true);
  assert.equal(open.has("101"), true);
  assert.equal(open.size, 101);
});

test("preview fixtures activate only under an exact preview runtime", () => {
  const names = [
    "DEPLOYMENT_TIER",
    "PREVIEW_PR_NUMBER",
    "SITE_URL",
    "PRODUCTION_SITE_URL",
    "PUBLIC_CONTENT_MODE",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    DEPLOYMENT_TIER: "preview",
    PREVIEW_PR_NUMBER: "42",
    SITE_URL: "https://pr-42.anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "static_preview",
  });
  try {
    const ready = previewConnectorSnapshot(
      "myanimelist",
      new URLSearchParams("fixture=maximum-density"),
    );
    assert.equal(ready?.status, "ready");
    assert.equal(ready?.payload.library.length, 36);
    assert.match(ready?.payload.coverage, /Synthetic preview data/);
    assert.equal(ready?.payload.library[0].artwork.kind, "mal-cover");
    const projected = projectConnectorSnapshotForPublic(
      "myanimelist",
      ready.payload,
      new URLSearchParams("pageSize=12"),
    );
    assert.equal(projected.gallery.items.length, 12);
    assert.match(
      projected.gallery.items[0].artwork.src,
      /^\/api\/connector-artwork\/myanimelist\//,
    );
    assert.equal(
      "artwork" in previewConnectorSnapshot(
        "myanimelist",
        new URLSearchParams("fixture=missing-artwork"),
      ).payload.library[0],
      false,
    );
    assert.equal(
      previewConnectorSnapshot(
        "steam",
        new URLSearchParams("fixture=unavailable"),
      )?.status,
      "unavailable",
    );
    const strava = previewStravaSnapshot(new URLSearchParams());
    assert.equal(strava?.status, "ready");
    assert.equal(strava?.payload.embedStatus, "available");
    assert.match(
      strava?.payload.embed.embedUrl,
      /^https:\/\/www\.strava\.com\/athletes\/99999999999999999999\/latest-rides\/[a-f0-9]{40}$/,
    );
    assert.equal("previewNotice" in strava.payload, false);
    process.env.SITE_URL = "https://anish-shah-is.online";
    assert.equal(previewConnectorSnapshot("hardcover", new URLSearchParams()), null);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("all six direct room foundations use projected preview data without durable state", async () => {
  const previous = globalThis.__ANISH_CONNECTOR_TEST_ENV__;
  globalThis.__ANISH_CONNECTOR_TEST_ENV__ = {
    DEPLOYMENT_TIER: "preview",
    PREVIEW_PR_NUMBER: "42",
    SITE_URL: "https://pr-42.anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "static_preview",
  };
  try {
    const [watch, read, collect, play, listen, move, stale] = await Promise.all([
      getCollectionScreenFoundation("myanimelist", {
        fixture: "maximum-density",
        pageSize: "36",
      }),
      getCollectionScreenFoundation("hardcover", {
        fixture: "long-title",
        q: "記憶",
      }),
      getDiscogsScreenFoundation({
        fixture: "maximum-density",
        pageSize: "36",
      }),
      getCollectionScreenFoundation("steam", { fixture: "ready" }),
      getSpotifyScreenFoundation({ fixture: "ready" }),
      getMovementScreenFoundation({ fixture: "ready" }),
      getCollectionScreenFoundation("myanimelist", { fixture: "stale" }),
    ]);

    assert.equal(watch.state.status, "ready");
    assert.equal(watch.state.payload.gallery.items.length, 36);
    assert.equal(read.state.status, "ready");
    assert.equal(
      read.state.payload.gallery.items.some((item) =>
        /記憶と機械/.test(item.title),
      ),
      true,
    );
    assert.equal(collect.state.status, "ready");
    assert.equal(collect.state.payload.gallery.items.length, 36);
    assert.equal(play.state.status, "ready");
    assert.equal(listen.status, "ready");
    assert.equal(listen.payload.windows.short_term.tracks.length, 12);
    assert.equal(move.status, "ready");
    assert.equal(move.payload.embedStatus, "available");
    assert.equal(stale.state.status, "ready");
    assert.equal(stale.state.stale, true);
    assert.ok(
      new Date(stale.state.payload.freshUntil).getTime() < Date.now(),
    );
    assert.equal(
      previewFixtureForPlayRoute({ fixture: "missing-artwork" }),
      "missing-artwork",
    );
    assert.equal(previewFixtureForPlayRoute({}), undefined);
  } finally {
    globalThis.__ANISH_CONNECTOR_TEST_ENV__ = previous;
  }
});

test("preview Discogs fixtures preserve format and decade variation", () => {
  const names = [
    "DEPLOYMENT_TIER",
    "PREVIEW_PR_NUMBER",
    "SITE_URL",
    "PRODUCTION_SITE_URL",
    "PUBLIC_CONTENT_MODE",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    DEPLOYMENT_TIER: "preview",
    PREVIEW_PR_NUMBER: "42",
    SITE_URL: "https://pr-42.anish-shah-is.online",
    PRODUCTION_SITE_URL: "https://anish-shah-is.online",
    PUBLIC_CONTENT_MODE: "static_preview",
  });
  try {
    const snapshot = previewConnectorSnapshot(
      "discogs",
      new URLSearchParams("fixture=maximum-density&pageSize=36"),
    );
    assert.equal(snapshot?.status, "ready");
    const projected = projectConnectorSnapshotForPublic(
      "discogs",
      snapshot.payload,
      new URLSearchParams("pageSize=36"),
    );
    assert.equal(projected.provider, "discogs");
    assert.equal(projected.gallery.items.length, 36);
    assert.equal(projected.formats.length, 5);
    assert.ok(projected.decades.length > 4);
    assert.ok(projected.formatDecadeMatrix.length > 10);
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("preview workflows use trusted workflow_run deployment and never pull_request_target", async () => {
  const [deploy, cleanup, validate, metadata, prepare, cleanupScript] = await Promise.all([
    readFile(new URL("../.github/workflows/preview-deploy.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/preview-cleanup.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../scripts/write-preview-metadata.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/prepare-hosted-environment.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/preview-cleanup.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(deploy, /workflow_run:/);
  assert.match(deploy, /ref: \$\{\{ github\.workflow_sha \}\}/);
  assert.match(
    deploy,
    /workflow_run\.head_repository\.full_name == github\.repository/,
  );
  assert.match(deploy, /Revalidate the open PR and exact current head/);
  assert.match(deploy, /gh api "\$endpoint" --jq '\[\.state, \.head\.sha, \.head\.repo\.full_name\] \| @tsv'/);
  assert.match(deploy, /Recheck the PR immediately before privileged deployment/);
  assert.match(deploy, /--connect-timeout 5 --max-time 20 --proto '=https'/);
  assert.doesNotMatch(deploy, /curl[^\n]*--location/);
  assert.match(deploy, /printf '%s\\nPreview: %s\\n\\nValidated SHA:/);
  assert.match(deploy, /CLOUDFLARE_PREVIEW_API_TOKEN/);
  assert.match(deploy, /preview-production-guard\.mjs capture/);
  assert.match(deploy, /preview-production-guard\.mjs verify/);
  assert.match(
    deploy,
    /Verify production integrity guard[\s\S]*if: always\(\)/,
  );
  assert.match(validate, /Upload immutable preview build/);
  assert.match(validate, /github\.event\.pull_request\.head\.sha/);
  assert.match(validate, /PREVIEW_WORKFLOW_SHA/);
  assert.match(
    validate,
    /preview-build-\$\{\{ github\.event\.pull_request\.number \}\}-\$\{\{ github\.event\.pull_request\.head\.sha \}\}/,
  );
  assert.match(metadata, /process\.env\.PREVIEW_SOURCE_SHA/);
  assert.match(metadata, /sourceSha: releaseSha/);
  assert.match(metadata, /workflowSha/);
  assert.match(prepare, /bundle\.sourceSha !== bundle\.releaseSha/);
  assert.match(cleanup, /preview-cleanup\.mjs cleanup --apply/);
  assert.match(cleanup, /group: preview-/);
  assert.match(cleanup, /github\.workflow_sha/);
  assert.match(cleanupScript, /hostname: coordinates\.hostname/);
  assert.match(cleanupScript, /service: coordinates\.workerName/);
  assert.match(cleanupScript, /domains\.length > 1/);
  assert.doesNotMatch(`${deploy}\n${cleanup}\n${validate}`, /pull_request_target/);
});

test("Play propagates a preview fixture through every active stream", async () => {
  const [
    page,
    classic,
    streams,
    collection,
    gallery,
    discogs,
    spotify,
    movement,
  ] = await Promise.all([
    readFile(new URL("../app/play/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/play/ClassicPlayExperience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/PersonalStreams.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/play/CollectionStream.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/play/CollectionGallery.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/play/DiscogsStream.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/SpotifyStream.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/play/MovementStream.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /activePreviewFixtureRuntime\(\)/);
  assert.match(
    page,
    /<ClassicPlayExperience[\s\S]*fixture=\{fixture\}[\s\S]*initialStream=\{streamIdFromValue\(query\.stream\)\}/,
  );
  assert.match(classic, /<PersonalStreams[\s\S]*fixture=\{fixture\}/);
  assert.match(classic, /initialStream=\{initialStream\}/);
  assert.match(streams, /CollectionStream provider="myanimelist" fixture=\{fixture\}/);
  assert.match(streams, /DiscogsStream fixture=\{fixture\}/);
  assert.match(streams, /SpotifyStream[\s\S]*fixture=\{fixture\}/);
  assert.match(streams, /MovementStream[\s\S]*fixture=\{fixture\}/);
  assert.match(collection, /parameters\.set\("fixture", fixture\)/);
  assert.match(discogs, /parameters\.set\("fixture", fixture\)/);
  assert.match(spotify, /loadSpotifyFixture\(controller\.signal, fixture\)/);
  assert.match(spotify, /loadSpotify\(controller\.signal\)/);
  assert.match(movement, /new URLSearchParams\(\{ fixture \}\)/);
  assert.match(gallery, /input name="fixture" type="hidden" value=\{fixture\}/);
  assert.match(gallery, /parameters\.set\("fixture", fixture\)/);
  assert.match(discogs, /input name="fixture" type="hidden" value=\{fixture\}/);
  assert.match(discogs, /parameters\.set\("fixture", fixture\)/);
});

test("preview production guard pins the apex and production Worker", async () => {
  const source = await readFile(
    new URL("../scripts/preview-production-guard.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /PRODUCTION_WORKER_NAME = "anish-shah-work-in-public"/,
  );
  assert.match(source, /workers\/domains/);
  assert.match(source, /record\?\.hostname === productionHostname/);
  assert.match(source, /matching\[0\]\?\.service !== PRODUCTION_WORKER_NAME/);
  assert.match(source, /"deployments"[\s\S]*"status"[\s\S]*"--name"/);
  assert.match(source, /CLOUDFLARE_ACCOUNT_ID: PUBLIC_CLOUDFLARE_ACCOUNT_ID/);
  assert.match(source, /wrangler\.preview\.json/);
});

test("staging release bootstraps and verifies its isolated D1/KV publication", async () => {
  const [script, packageJson] = await Promise.all([
    readFile(new URL("../scripts/staging-release.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(
    packageJson.scripts["staging:bootstrap"],
    "node scripts/staging-release.mjs bootstrap",
  );
  assert.match(script, /action === "bootstrap"/);
  assert.match(script, /\/api\/studio\/publish/);
  assert.match(script, /\/api\/studio\/publication-checkpoint/);
  assert.match(script, /kvPointerMatches !== true/);
  assert.match(script, /STAGING_SITE_ORIGIN/);
});

test("staging Studio renders an explicit non-promotable boundary", async () => {
  const [page, promotion] = await Promise.all([
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/studio/PlayPromotionControls.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(page, /deploymentTier === "staging"[\s\S]*\? "staging"/);
  assert.match(promotion, /environment: "local" \| "staging" \| "hosted"/);
  assert.match(promotion, /Staging stays isolated\./);
  assert.match(promotion, /cannot issue, stage, accept, or apply production transfer codes/);
  assert.match(promotion, /environment === "staging" \? null/);
});
