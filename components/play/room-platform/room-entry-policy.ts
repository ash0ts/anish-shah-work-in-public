/** Navigating to Play is intent. Directory mode and capability failures win. */
export function shouldOpenRoom(input: {
  directory: boolean;
  eligible: boolean;
  entered: boolean;
  failed: boolean;
  attempted: boolean;
}) {
  return !input.directory && input.eligible && !input.entered &&
    !input.failed && !input.attempted;
}

export function roomDirectoryHref(search: string) {
  const query = new URLSearchParams(search);
  query.set("view", "directory");
  return `/play?${query.toString()}`;
}
