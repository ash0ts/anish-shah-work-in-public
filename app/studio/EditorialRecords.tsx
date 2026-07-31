"use client";

import { useMemo, useState } from "react";
import type {
  EditorialRecord,
  EditorialRecordList,
} from "@/lib/server/editorial";
import type {
  EditorialRecordPatch,
  EditorialVisibility,
} from "@/lib/server/editorial-policy";
import styles from "./studio.module.css";

type ListResponse = {
  records: EditorialRecord[];
  pagination: { limit: number; offset: number; total: number };
  error?: string;
};

const PAGE_SIZE = 50;

function displayVisibility(value: EditorialVisibility): string {
  return value.replaceAll("_", " ");
}

export function EditorialRecords({
  initial,
  isLocalSandbox,
}: {
  initial: EditorialRecordList;
  isLocalSandbox: boolean;
}) {
  const [records, setRecords] = useState<EditorialRecord[]>(initial.records);
  const [draft, setDraft] = useState<EditorialRecord | null>(
    initial.records[0] ? { ...initial.records[0] } : null,
  );
  const [pagination, setPagination] = useState(initial.pagination);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<"save" | "publish" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadRecords(offset = 0, search = activeQuery) {
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (search) params.set("q", search);
      const response = await fetch(`/api/studio/records?${params}`, {
        cache: "no-store",
      });
      const result = (await response.json()) as ListResponse;
      if (!response.ok) {
        setMessage(result.error ?? "Editorial records could not be loaded.");
        return;
      }
      setRecords(result.records);
      setPagination(result.pagination);
      setDraft((current) => {
        const next =
          result.records.find((record) => record.id === current?.id) ??
          result.records[0] ??
          null;
        return next ? { ...next } : null;
      });
    } catch {
      setMessage("Editorial records could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  const sourceRecord = useMemo(
    () => records.find((record) => record.id === draft?.id) ?? null,
    [draft?.id, records],
  );
  const changed = Boolean(
    draft &&
      sourceRecord &&
      (draft.featured !== sourceRecord.featured ||
        draft.sortOrder !== sourceRecord.sortOrder ||
        draft.approvedPublicWording !==
          sourceRecord.approvedPublicWording ||
        draft.caveat !== sourceRecord.caveat ||
        draft.visibility !== sourceRecord.visibility),
  );

  async function saveDraft() {
    if (!draft || !sourceRecord || !changed) return;
    const patch: EditorialRecordPatch = {};
    if (draft.featured !== sourceRecord.featured) {
      patch.featured = draft.featured;
    }
    if (draft.sortOrder !== sourceRecord.sortOrder) {
      patch.sortOrder = draft.sortOrder;
    }
    if (
      draft.approvedPublicWording !== sourceRecord.approvedPublicWording
    ) {
      patch.approvedPublicWording = draft.approvedPublicWording;
    }
    if (draft.caveat !== sourceRecord.caveat) {
      patch.caveat = draft.caveat;
    }
    if (draft.visibility !== sourceRecord.visibility) {
      patch.visibility = draft.visibility;
    }

    setPending("save");
    setMessage(null);
    try {
      const response = await fetch(
        `/api/studio/records/${encodeURIComponent(draft.id)}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "if-match": JSON.stringify(sourceRecord.revision),
          },
          body: JSON.stringify(patch),
        },
      );
      const result = (await response.json()) as {
        record?: EditorialRecord;
        error?: string;
      };
      if (!response.ok || !result.record) {
        setMessage(result.error ?? "The editorial change could not be saved.");
        return;
      }

      setRecords((current) =>
        current.map((record) =>
          record.id === result.record?.id ? result.record : record,
        ),
      );
      setDraft({ ...result.record });
      setMessage(
        isLocalSandbox
          ? "Editorial change saved and audited in local D1 only."
          : "Editorial change saved and audited.",
      );
    } catch {
      setMessage("The editorial change could not be saved.");
    } finally {
      setPending(null);
    }
  }

  async function publish() {
    if (
      !window.confirm(
        isLocalSandbox
          ? "Create a local-only snapshot from every record currently marked public? This will not affect production."
          : "Create a new publication snapshot from every record currently marked public?",
      )
    ) {
      return;
    }

    setPending("publish");
    setMessage(null);
    try {
      const response = await fetch("/api/studio/publish", { method: "POST" });
      const result = (await response.json()) as {
        publication?: { recordCount: number; contentHash: string };
        error?: string;
      };
      if (!response.ok || !result.publication) {
        setMessage(result.error ?? "The publication snapshot was not created.");
        return;
      }
      setMessage(
        isLocalSandbox
          ? `Created local-only snapshot · ${result.publication.recordCount.toLocaleString()} records · ${result.publication.contentHash.slice(0, 12)}.`
          : `Published ${result.publication.recordCount.toLocaleString()} records · ${result.publication.contentHash.slice(0, 12)}.`,
      );
    } catch {
      setMessage("The publication snapshot was not created.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className={styles.editorialWorkspace} aria-labelledby="records-title">
      <div className={styles.workspaceHeader}>
        <div>
          <p className={styles.eyebrow}>Editorial surface</p>
          <h3 id="records-title">Public records</h3>
          {isLocalSandbox ? (
            <p className={styles.workspaceScope}>
              Local draft state · production is unchanged
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void publish()}
          disabled={pending !== null}
        >
          {pending === "publish"
            ? isLocalSandbox
              ? "Creating…"
              : "Publishing…"
            : isLocalSandbox
              ? "Create local snapshot"
              : "Publish snapshot"}
        </button>
      </div>

      <form
        className={styles.recordSearch}
        onSubmit={(event) => {
          event.preventDefault();
          const normalized = query.trim();
          setActiveQuery(normalized);
          void loadRecords(0, normalized);
        }}
      >
        <label htmlFor="editorial-search">Find a sanitized record</label>
        <div className={styles.inputRow}>
          <input
            id="editorial-search"
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Title, slug, or stable ID"
          />
          <button type="submit" disabled={loading}>
            Search
          </button>
        </div>
      </form>

      <div className={styles.recordWorkspace}>
        <div className={styles.recordList} aria-busy={loading}>
          <div className={styles.recordListMeta}>
            <span>
              {pagination.total.toLocaleString()} record
              {pagination.total === 1 ? "" : "s"}
            </span>
            <span>
              {pagination.total === 0
                ? "0"
                : `${pagination.offset + 1}–${Math.min(
                    pagination.offset + pagination.limit,
                    pagination.total,
                  )}`}
            </span>
          </div>
          {records.map((record) => (
            <button
              type="button"
              key={record.id}
              className={`${styles.recordButton} ${
                draft?.id === record.id ? styles.recordButtonActive : ""
              }`}
              onClick={() => setDraft({ ...record })}
            >
              <span>{record.title}</span>
              <small>
                {record.recordType} · {displayVisibility(record.visibility)}
              </small>
            </button>
          ))}
          {!loading && records.length === 0 ? (
            <p className={styles.emptyState}>
              No sanitized records match this view.
            </p>
          ) : null}
          <div className={styles.pager}>
            <button
              type="button"
              className={styles.quietButton}
              disabled={loading || pagination.offset === 0}
              onClick={() =>
                void loadRecords(
                  Math.max(0, pagination.offset - PAGE_SIZE),
                )
              }
            >
              Previous
            </button>
            <button
              type="button"
              className={styles.quietButton}
              disabled={
                loading ||
                pagination.offset + pagination.limit >= pagination.total
              }
              onClick={() =>
                void loadRecords(pagination.offset + PAGE_SIZE)
              }
            >
              Next
            </button>
          </div>
        </div>

        <div className={styles.recordEditor}>
          {draft ? (
            <>
              <div className={styles.readonlyRecord}>
                <span>{draft.recordType}</span>
                <h4>{draft.title}</h4>
                <p>{draft.summary || "No public summary supplied."}</p>
                <code>{draft.id}</code>
              </div>

              <div className={styles.compactFields}>
                <label>
                  Visibility
                  <select
                    value={draft.visibility}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        visibility: event.target.value as EditorialVisibility,
                      })
                    }
                  >
                    {[
                      "public",
                      "review_required",
                      "private",
                      "excluded",
                    ].map((value) => (
                      <option value={value} key={value}>
                        {displayVisibility(value as EditorialVisibility)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Sort order
                  <input
                    type="number"
                    min={-100000}
                    max={100000}
                    step={1}
                    value={draft.sortOrder}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        sortOrder: Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>

              <label className={styles.checkField}>
                <input
                  type="checkbox"
                  checked={draft.featured}
                  onChange={(event) =>
                    setDraft({ ...draft, featured: event.target.checked })
                  }
                />
                Feature this record
              </label>

              <label className={styles.textField}>
                Public wording
                <textarea
                  rows={5}
                  maxLength={600}
                  value={draft.approvedPublicWording}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      approvedPublicWording: event.target.value,
                    })
                  }
                  placeholder="Optional reviewed wording; plain text only"
                />
              </label>

              <label className={styles.textField}>
                Public caveat
                <textarea
                  rows={3}
                  maxLength={600}
                  value={draft.caveat}
                  onChange={(event) =>
                    setDraft({ ...draft, caveat: event.target.value })
                  }
                  placeholder="Scope, timing, attribution, or methodology"
                />
              </label>

              <div className={styles.editorActions}>
                <button
                  type="button"
                  disabled={!changed || pending !== null}
                  onClick={() => void saveDraft()}
                >
                  {pending === "save" ? "Saving…" : "Save audited change"}
                </button>
                {changed ? (
                  <button
                    type="button"
                    className={styles.quietButton}
                    disabled={pending !== null}
                    onClick={() =>
                      sourceRecord && setDraft({ ...sourceRecord })
                    }
                  >
                    Discard
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <p className={styles.emptyState}>
              Select a record to review its editable public fields.
            </p>
          )}
        </div>
      </div>

      {message ? (
        <p className={styles.workspaceMessage} role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
