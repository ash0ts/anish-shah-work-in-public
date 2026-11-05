/** Server-revalidated visibility applies equally to Work and saved collections. */
export function visibleDiscoveries<T extends { id: string }>(
  items: T[],
  visibleIds: ReadonlySet<string>,
): T[] {
  return items.filter((item) => visibleIds.has(item.id));
}

export function visibleExchanges<T extends { sourceIds: string[] }>(
  messages: T[],
  visibleIds: ReadonlySet<string>,
): T[] {
  return messages.filter((message) =>
    message.sourceIds.every((id) => visibleIds.has(id)),
  );
}
