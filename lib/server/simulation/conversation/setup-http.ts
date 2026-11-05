import { z } from "zod";
import { readBoundedJsonBody } from "../../request-security";
import { claimSimulationDailyBudget } from "../budget-repository";
import { CONVERSATION_LIMITS } from "@/lib/simulation/conversation-contract";
import {
  CONVERSATION_HEADERS,
  conversationFailure,
  conversationOwner,
  requestRevision,
} from "./http";
import {
  conversationDatabase,
  ConversationError,
  decryptGeminiKey,
  publicGeminiConfiguration,
  readGeminiConfiguration,
  saveGeminiKey,
  writeGeminiConfiguration,
} from "./settings";
import { testGeminiConnection } from "./provider";
import {
  googlePermissionSummaries,
  permissionInput,
  saveGooglePermission,
} from "./permissions";

const configurationInput = z.union([
  z.object({ key: z.string().min(20).max(256) }).strict(),
  z.object({ enabled: z.boolean() }).strict(),
]);
export async function handleConversationSetup(
  request: Request,
  action: "get" | "save" | "test" | "permission",
) {
  try {
    const owner = await conversationOwner(request, action !== "get");
    if (!owner.ok) return owner.response;
    const json = (value: unknown) =>
      Response.json(value, { headers: CONVERSATION_HEADERS });
    if (action === "get")
      return json({
        configuration: publicGeminiConfiguration(
          await readGeminiConfiguration(),
        ),
        permissions: await googlePermissionSummaries(),
      });
    const revision = requestRevision(request);
    const body = await readBoundedJsonBody(request, { maxBytes: 2_048 });
    if (!body.ok) return body.response;
    if (action === "permission") {
      const parsed = permissionInput.safeParse(body.value);
      if (!parsed.success) throw new ConversationError("permission_invalid");
      return json({
        permission: await saveGooglePermission(
          parsed.data,
          revision,
          owner.user.email,
        ),
      });
    }
    if (action === "save") {
      const parsed = configurationInput.safeParse(body.value);
      if (!parsed.success) throw new ConversationError("input_invalid");
      if ("key" in parsed.data)
        return json({
          configuration: publicGeminiConfiguration(
            await saveGeminiKey(parsed.data.key, revision, owner.user.email),
          ),
        });
      const current = await readGeminiConfiguration();
      if (
        parsed.data.enabled &&
        (!current.tested || !(await decryptGeminiKey(current)))
      )
        throw new ConversationError("test_required", 409);
      return json({
        configuration: publicGeminiConfiguration(
          await writeGeminiConfiguration(
            { ...current, enabled: parsed.data.enabled },
            revision,
            owner.user.email,
          ),
        ),
      });
    }
    if (!z.object({}).strict().safeParse(body.value).success)
      throw new ConversationError("input_invalid");
    const current = await readGeminiConfiguration();
    if (current.testingUntil && Date.parse(current.testingUntil) > Date.now())
      throw new ConversationError("test_in_progress", 409);
    const key = await decryptGeminiKey(current);
    if (!key) throw new ConversationError("key_required", 409);
    // CAS wins before the paid synthetic request; concurrent tests never double bill.
    const reserved = await writeGeminiConfiguration(
      {
        ...current,
        tested: false,
        enabled: false,
        testingUntil: new Date(Date.now() + 15_000).toISOString(),
      },
      revision,
      owner.user.email,
    );
    let passed = false;
    const budget = await claimSimulationDailyBudget(
      conversationDatabase(),
      CONVERSATION_LIMITS.dailyCalls,
    );
    if (budget) {
      try {
        passed = await testGeminiConnection(
          key,
          AbortSignal.timeout(CONVERSATION_LIMITS.deadlineMilliseconds),
        );
      } catch {
        /* Never expose provider errors or request details. */
      }
    }
    const next = await writeGeminiConfiguration(
      { ...reserved, tested: passed, testingUntil: null },
      reserved.revision,
      owner.user.email,
    );
    return json({
      configuration: publicGeminiConfiguration(next),
      test: passed ? "passed" : budget ? "failed" : "budget",
    });
  } catch (error) {
    return conversationFailure(error);
  }
}
