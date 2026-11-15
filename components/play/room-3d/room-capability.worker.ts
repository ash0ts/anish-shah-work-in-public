// One bounded capability probe. No renderer, assets, providers, or scene data.
let supported = false;
try {
  const context = new OffscreenCanvas(1, 1).getContext("webgl2", {
    alpha: true, antialias: false, depth: true,
    failIfMajorPerformanceCaveat: true, powerPreference: "low-power", stencil: false,
  });
  supported = context !== null;
  context?.getExtension("WEBGL_lose_context")?.loseContext();
} catch {
  // Unsupported or blocked graphics retain the semantic directory.
}
self.postMessage({ supported });
self.close();
