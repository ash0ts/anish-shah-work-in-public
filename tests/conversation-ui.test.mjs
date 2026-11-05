import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
import { createActor } from "xstate";
import bundle from "../content/public/anish-content.public.v1.json" with { type: "json" };
import manifest from "../content/presentation/simulation.v1.json" with { type: "json" };
const { personalInternetFrom } = await tsImport(
  "../lib/server/simulation/conversation/workspace.ts",
  import.meta.url,
);
const { connectObjects, authoredReply } = await tsImport(
  "../lib/simulation/personal-internet.ts",
  import.meta.url,
);
const { workspaceMachine } = await tsImport(
  "../lib/simulation/workspace-machine.ts",
  import.meta.url,
);
const { applyCopyDeckToBundle } = await tsImport(
  "../lib/copy.ts",
  import.meta.url,
);
const { catalog, featuredIds } = personalInternetFrom(
  applyCopyDeckToBundle(bundle),
);
const [a, b, c] = featuredIds;
const byId = (id) => catalog.find((object) => object.id === id);

test("reviewed starting objects span four work types; all links and sources come from the public archive", () => {
  assert.equal(manifest.workspace.stage, "authored-visual-slice");
  assert.equal(featuredIds.length, 6);
  assert.deepEqual(
    new Set(featuredIds.map((id) => byId(id).kind)),
    new Set(["terminal", "notebook", "document", "poster"]),
  );
  assert.equal(catalog.length, 88);
  assert(
    catalog.every(
      (object) =>
        object.href.startsWith("/work/") && object.id.startsWith("group:"),
    ),
  );
  assert(
    catalog
      .flatMap((object) => object.citations)
      .every((citation) =>
        bundle.evidence.some(
          (source) =>
            source.id === citation.id && source.access === "public_web",
        ),
      ),
  );
});
test("hidden projects disappear from objects, search catalog, and possible relationships, including all-hidden archive", () => {
  const hidden = structuredClone(bundle);
  hidden.workGroups.find((group) => group.id === a).publicationState =
    "private";
  const result = personalInternetFrom(hidden);
  assert(!result.featuredIds.includes(a));
  assert(!result.catalog.some((object) => object.id === a));
  for (const group of hidden.workGroups) group.publicationState = "private";
  assert.deepEqual(personalInternetFrom(hidden), {
    catalog: [],
    featuredIds: [],
  });
});
test("connections use exact shared topic and evidence IDs, never title or affiliation guesses", () => {
  const result = connectObjects(byId(a), byId(b));
  assert(result.supported);
  assert(
    result.topics.every(
      (topic) =>
        byId(a).topics.some((x) => x.id === topic.id) &&
        byId(b).topics.some((x) => x.id === topic.id),
    ),
  );
  assert.equal(
    connectObjects(byId(a), { ...byId(b), topics: [], citations: [] })
      .supported,
    false,
  );
  assert.equal(connectObjects(byId(a), byId(a)).supported, false);
});
test("XState owns bounded windows, selection, connection, conversation, journal, and optional trail", () => {
  const actor = createActor(workspaceMachine, { input: { catalog } }).start();
  for (const id of [a, b, c]) actor.send({ type: "OPEN", id });
  assert.deepEqual(actor.getSnapshot().context.openIds, [b, c]);
  actor.send({ type: "OPEN", id: "not-visible" });
  assert.deepEqual(actor.getSnapshot().context.openIds, [b, c]);
  actor.send({ type: "SELECT", id: a });
  actor.send({ type: "SELECT", id: b });
  actor.send({ type: "CONNECT" });
  assert.equal(actor.getSnapshot().value, "connecting");
  assert(actor.getSnapshot().context.connected);
  actor.send({ type: "ASK", ids: [a, b] });
  assert.equal(
    actor.getSnapshot().context.messages.length,
    0,
    "Ask opens composer; no request or reply yet",
  );
  actor.send({ type: "SEND", question: "How do these connect?" });
  assert(actor.getSnapshot().context.investigated);
  assert.equal(
    actor.getSnapshot().context.trail,
    false,
    "progress never forces the optional trail",
  );
  actor.send({ type: "TRAIL" });
  assert(actor.getSnapshot().context.trail);
  for (let i = 0; i < 6; i++) actor.send({ type: "SEND", question: "MCP" });
  assert.equal(actor.getSnapshot().context.messages.length, 4);
  actor.send({ type: "RESTORE", openIds: ["hidden", a], panel: "journal" });
  assert.deepEqual(actor.getSnapshot().context.openIds, [a]);
  actor.send({ type: "CLOSE", id: a });
  assert.deepEqual(actor.getSnapshot().context.openIds, []);
  actor.stop();
});
test("authored answers state their actual basis and never fabricate missing evidence", () => {
  const related = authoredReply(catalog, "How do these connect?", [a, b]);
  assert.match(related.text, /not evidence that one project caused/);
  assert.deepEqual(related.sourceIds, [a, b]);
  const unsupported = authoredReply(catalog, "purple unicorn biscuits", []);
  assert.equal(unsupported.sourceIds.length, 0);
  assert.match(unsupported.text, /cannot improvise/);
  const source = authoredReply(catalog, "Explain this project", [a]);
  assert.deepEqual(source.sourceIds, [a]);
  assert(source.text.includes(byId(a).text));
});
test("slice has no provider requests, transcript storage, or free-text GET transport", async () => {
  const files = [
    "components/simulation/Conversation.tsx",
    "lib/simulation/workspace-machine.ts",
    "lib/simulation/personal-internet.ts",
  ];
  for (const file of files) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(
      text,
      /fetch\(|localStorage|sessionStorage|document\.cookie|setInterval|name="(?:question|query|message)"/,
    );
  }
});
