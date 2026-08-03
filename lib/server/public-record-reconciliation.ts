export async function reconcileStalePublicRecords(
  database: D1Database,
  currentIds: ReadonlySet<string>,
  updatedAt: string,
): Promise<number> {
  const result = await database
    .prepare(
      `UPDATE public_records
       SET publication_state = 'review_required', slug = NULL, updated_at = ?
       WHERE NOT EXISTS (
         SELECT 1
         FROM json_each(?) AS current_record
         WHERE current_record.value = public_records.id
       )`,
    )
    .bind(updatedAt, JSON.stringify([...currentIds].sort()))
    .run();

  return Number(result.meta.changes) || 0;
}
