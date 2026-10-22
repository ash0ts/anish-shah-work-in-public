/** Reviewed, public-safe additions; never rewrite the immutable migration inputs. */
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const DATE_BASIS = new Set(["event_date", "publication_date", "upload_date", "unknown"]);

function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

export function applyPortfolioUpdates(curation, workGroups, updates) {
  if (updates.schemaVersion !== "1.0" || !DATE.test(updates.reviewedAt)) {
    throw new Error("Portfolio updates require a version and explicit review date");
  }
  for (const key of Object.keys(updates)) {
    if (!["schemaVersion", "reviewedAt", "items", "entities", "groups", "metricObservations"].includes(key)) {
      throw new Error(`Unknown portfolio update field: ${key}`);
    }
  }
  for (const key of ["items", "entities", "groups", "metricObservations"]) {
    if (!Array.isArray(updates[key])) throw new Error(`Missing update list: ${key}`);
  }
  unique(updates.items.map((item) => item.id), "update item");
  unique(updates.entities.map((entity) => entity.id), "update entity");
  unique(updates.groups.map((group) => group.id), "update group");
  const next = structuredClone(curation);
  const groups = structuredClone(workGroups);
  const existingItems = new Set(next.supplementalItems.map((item) => item.id));
  for (const [index, item] of updates.items.entries()) {
    if (!/^item:up-\d{4}$/u.test(item.id) || existingItems.has(item.id)) {
      throw new Error(`Invalid or reused update item: ${item.id}`);
    }
    if (!DATE_BASIS.has(item.dateBasis) || !item.location || !item.status?.trim()) {
      throw new Error(`Update item lacks date basis, location, or status: ${item.id}`);
    }
    if (item.dateStart && !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/u.test(item.dateStart)) {
      throw new Error(`Invalid update date: ${item.id}`);
    }
    if (item.dateStart && item.dateStart > updates.reviewedAt) {
      throw new Error(`Update date follows its review: ${item.id}`);
    }
    if (!item.primaryUrl && item.materials !== "not-public") {
      throw new Error(`Missing artifact must explicitly identify nonpublic materials: ${item.id}`);
    }
    if (item.materials === "not-public" && item.primaryUrl) {
      throw new Error(`Nonpublic materials cannot expose an artifact URL: ${item.id}`);
    }
    if (item.primaryUrl && !/^https:\/\//u.test(item.primaryUrl)) {
      throw new Error(`Invalid public artifact URL: ${item.id}`);
    }
    next.supplementalItems.push({
      ...item,
      sourceSnapshotId: "snapshot:portfolio-updates-v1",
      sourceLine: index + 2,
      capturedAt: updates.reviewedAt,
    });
  }
  for (const entity of updates.entities) {
    const existing = next.forcedEntities.find((candidate) => candidate.id === entity.id);
    if (existing) {
      for (const key of ["slug", "primaryLegacyId"]) {
        if (entity[key] && entity[key] !== existing[key]) throw new Error(`Cannot replace entity ${key}`);
      }
      existing.memberItemIds = [...new Set([...(existing.memberItemIds || []), ...(entity.memberItemIds || [])])];
      if (entity.representativeItemId) existing.representativeItemId = entity.representativeItemId;
    } else {
      next.forcedEntities.push(entity);
    }
  }
  for (const group of updates.groups) {
    if (groups.groups.some((candidate) => candidate.id === group.id)) {
      throw new Error(`Cannot replace existing group: ${group.id}`);
    }
    groups.groups.push(group);
  }
  for (const observation of updates.metricObservations) {
    if (!DATE.test(observation.date_recorded) || observation.date_recorded > updates.reviewedAt ||
        observation.source_system !== "owner_review" || observation.source_url ||
        !observation.item || !observation.metric || !observation.unit || !observation.period ||
        !observation.source_name || !observation.notes || !Number.isFinite(Number(observation.value))) {
      throw new Error("A metric observation requires a dated, scoped, public-safe owner review");
    }
  }
  return { curation: next, workGroups: groups };
}
