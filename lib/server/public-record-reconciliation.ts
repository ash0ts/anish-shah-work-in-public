// Cloudflare D1 permits at most 100 bound parameters per query. Each stale
// record update reserves one parameter for the shared `updated_at` value.
const STALE_RECORD_BATCH_SIZE = 99;

export async function reconcileStalePublicRecords(
  database: D1Database,
  currentIds: ReadonlySet<string>,
  updatedAt: string,
): Promise<number> {
  const existingRows = await database
    .prepare(`SELECT id FROM public_records`)
    .all<{ id: string }>();
  const staleIds = (existingRows.results ?? [])
    .map((row) => row.id)
    .filter((id) => !currentIds.has(id));

  for (
    let start = 0;
    start < staleIds.length;
    start += STALE_RECORD_BATCH_SIZE
  ) {
    const batch = staleIds.slice(start, start + STALE_RECORD_BATCH_SIZE);
    const predicate = batch.map(() => "?").join(", ");
    await database
      .prepare(
        `UPDATE public_records
         SET publication_state = 'review_required', updated_at = ?
         WHERE id IN (${predicate})`,
      )
      .bind(updatedAt, ...batch)
      .run();
  }

  return staleIds.length;
}
