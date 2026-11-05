// Test-only identity seam; owner-policy, origins, bodies, sessions and SQL stay real.
export async function getChatGPTUser() { return globalThis.__CONVERSATION_TEST_USER__ ?? null; }
