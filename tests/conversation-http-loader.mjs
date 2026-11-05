import { resolve as base } from "./content-connector-loader.mjs";
export async function resolve(specifier, context, next) {
  if (specifier === "@/app/chatgpt-auth") return { url: new URL("./conversation-auth-stub.mjs", import.meta.url).href, shortCircuit: true };
  return base(specifier, context, next);
}
