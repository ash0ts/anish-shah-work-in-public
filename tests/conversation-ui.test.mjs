import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";
register("./content-connector-loader.mjs", import.meta.url);
const { conversationScene, searchConversationSources, CONVERSATION_LIMITS } =
  await import("../lib/simulation/conversation-contract.ts");
const source = (file) =>
  readFile(new URL(`../${file}`, import.meta.url), "utf8");
test("three distinct discoveries progress to the doorway without scores or visitor assessment", () => {
  assert.equal(conversationScene([]), "desk");
  assert.equal(conversationScene(["a"]), "archive");
  assert.equal(conversationScene(["a", "b", "c"]), "doorway");
  assert.equal(CONVERSATION_LIMITS.messageCharacters, 800);
  assert.deepEqual(searchConversationSources([], "unavailable evidence"), []);
});
test("semantic conversation has no game engine, persistence, or free-text GET transport", async () => {
  const ui = await source("components/simulation/Conversation.tsx");
  assert.doesNotMatch(
    ui,
    /phaser|localStorage|sessionStorage|document\.cookie|setInterval|name="(?:question|query|message)"/,
  );
  assert.match(ui, /<noscript>/);
  assert.match(ui, /<textarea/);
  assert.match(ui, /<details/);
  assert.match(ui, /AbortController/);
  assert.match(ui, /retry\.current\.requestId/);
  assert.match(ui, /prefers-reduced-motion/);
  assert.match(ui, /forced-colors/);
  assert.match(ui, /visibleIds\.includes/);
});
