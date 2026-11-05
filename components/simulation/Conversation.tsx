"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { animate } from "animejs";
import { createMachine } from "xstate";
import { useMachine } from "@xstate/react";
import { SITE_COPY } from "@/lib/copy";
import {
  CONVERSATION_LIMITS,
  CONVERSATION_VERSION,
  conversationScene,
  searchConversationSources,
  type ConversationReply,
  type ConversationSource,
} from "@/lib/simulation/conversation-contract";
import { CONVERSATION_MESSAGES as messages } from "@/lib/simulation/conversation-messages";
import styles from "./Conversation.module.css";

const requestMachine = createMachine({
  id: "conversation",
  initial: "idle",
  states: {
    idle: { on: { SUBMIT: "pending" } },
    pending: { on: { RESOLVED: "idle", FAILED: "unavailable" } },
    unavailable: { on: { SUBMIT: "pending" } },
  },
});
const subscribeHydration = () => () => {};

type Props = {
  initialCards: ConversationSource[];
  choices: Array<{ label: string; sourceId: string }>;
  previewCatalog: ConversationSource[] | null;
  initialInspected: string[];
};

export function Conversation({
  initialCards,
  choices,
  previewCatalog,
  initialInspected,
}: Props) {
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState(initialCards);
  const [still, setStill] = useState(false);
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  const [state, send] = useMachine(requestMachine);
  const [message, setMessage] = useState("");
  const [inspected, setInspected] = useState(initialInspected);
  const [reaction, setReaction] = useState(0);
  const [transcript, setTranscript] = useState<
    Array<{ question: string; cards: ConversationSource[] }>
  >([]);
  const revision = useRef<number | null>(null);
  const pending = useRef(false);
  const retry = useRef<{
    question: string;
    inspectId: string | null;
    requestId: string;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const scene = conversationScene(inspected);
  const busy = state.matches("pending");
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (
      !sceneRef.current ||
      still ||
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      matchMedia("(forced-colors: active)").matches
    )
      return;
    const motion = animate(sceneRef.current, {
      opacity: [0.8, 1],
      translateY: [3, 0],
      duration: 220,
      ease: "outQuad",
    });
    return () => {
      motion.cancel();
    };
  }, [scene, still]);

  async function submit(question: string, inspectId: string | null = null) {
    if (pending.current || (!question.trim() && !inspectId)) return;
    pending.current = true;
    send({ type: "SUBMIT" });
    setMessage("Searching the archive…");
    controller.current = new AbortController();
    try {
      let reply: ConversationReply;
      if (previewCatalog) {
        const visibleIds = previewCatalog.map((card) => card.id);
        const inspectedIds = [
          ...new Set([...inspected, ...(inspectId ? [inspectId] : [])]),
        ]
          .filter((id) => visibleIds.includes(id))
          .slice(0, 3);
        const found = inspectId
          ? cards
          : searchConversationSources(previewCatalog, question).slice(0, 3);
        reply = {
          version: CONVERSATION_VERSION,
          revision: 0,
          source: "archive",
          scene: conversationScene(inspectedIds),
          inspectedIds,
          visibleIds,
          cards: found,
          status: found.length ? "answered" : "no_evidence",
        };
      } else {
        if (revision.current === null) {
          const response = await fetch("/api/simulation/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ version: CONVERSATION_VERSION }),
            signal: controller.current.signal,
          });
          if (!response.ok) throw new Error("session");
          revision.current = (
            (await response.json()) as { revision: number }
          ).revision;
        }
        if (
          !retry.current ||
          retry.current.question !== question ||
          retry.current.inspectId !== inspectId
        )
          retry.current = {
            question,
            inspectId,
            requestId: crypto.randomUUID(),
          };
        const response = await fetch("/api/simulation/turn", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "if-match": String(revision.current),
          },
          body: JSON.stringify({
            version: CONVERSATION_VERSION,
            requestId: retry.current.requestId,
            message: question.trim(),
            inspectId,
          }),
          signal: controller.current.signal,
        });
        if (!response.ok) {
          if (response.status === 410) revision.current = null;
          if (response.status === 409) {
            // Read-only reconciliation; never resubmit a paid turn automatically.
            const current = await fetch("/api/simulation/session", {
              cache: "no-store",
              signal: controller.current.signal,
            });
            if (current.ok)
              revision.current = (
                (await current.json()) as { revision: number }
              ).revision;
          }
          throw new Error("turn");
        }
        reply = (await response.json()) as ConversationReply;
        retry.current = null;
      }
      revision.current = reply.revision;
      setCards(reply.cards);
      setInspected(reply.inspectedIds);
      setReaction((value) => value + 1);
      setMessage(messages.status[reply.status]);
      send({ type: "RESOLVED" });
      setTranscript((previous) =>
        [
          ...previous
            .map((turn) => ({
              ...turn,
              cards: turn.cards.filter((card) =>
                reply.visibleIds.includes(card.id),
              ),
            }))
            .filter((turn) => turn.cards.length),
          ...(inspectId ? [] : [{ question, cards: reply.cards }]),
        ].slice(-4),
      );
    } catch {
      setMessage(messages.unavailable);
      send({ type: "FAILED" });
    } finally {
      pending.current = false;
    }
  }

  return (
    <div className={styles.experience}>
      <header className={styles.toolbar}>
        <span>4N1SH</span>
        <div>
          <button
            type="button"
            aria-pressed={still}
            onClick={() => setStill((value) => !value)}
          >
            Still presentation
          </button>
          <Link href="/play?view=directory" prefetch={false}>
            Leave
          </Link>
        </div>
      </header>
      <div className={styles.layout}>
        <div
          className={styles.scene}
          ref={sceneRef}
          data-scene={scene}
          data-still={still}
        >
          {/* Pre-encoded first-party artwork; no image service or remote fetch. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/assets/simulation/conversation-${scene}.webp`}
            alt="A fictional paper-masked keeper in an impossible archive."
            width={1536}
            height={1024}
          />
          <div className={styles.sceneLabel}>
            <span>
              {scene === "desk"
                ? "01 / THE DESK"
                : scene === "archive"
                  ? "02 / THE ARCHIVE"
                  : "03 / THE DOORWAY"}
            </span>
            <p>{SITE_COPY.simulation[`conversation-${scene}`]}</p>
          </div>
        </div>
        <section className={styles.dialogue} aria-label="Conversation">
          <span
            key={reaction}
            className={styles.portrait}
            data-reacting={reaction > 0 && !still}
            aria-hidden="true"
          />
          <span className={styles.eyebrow}>
            {SITE_COPY.simulation["conversation-eyebrow"]}
          </span>
          <h1>{SITE_COPY.simulation["conversation-title"]}</h1>
          <p>{SITE_COPY.simulation["conversation-summary"]}</p>
          <p className={styles.disclosure}>{messages.disclosure}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit(query);
            }}
          >
            <label htmlFor="conversation-question">Ask about the work</label>
            <textarea
              id="conversation-question"
              value={query}
              disabled={!hydrated}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={CONVERSATION_LIMITS.messageCharacters}
              rows={3}
              required
            />
            <div className={styles.actions}>
              <button disabled={!hydrated || busy} type="submit">
                {busy ? "Searching…" : "Ask 4N1SH"}
              </button>
            </div>
          </form>
          <noscript>
            <p>{messages.noScript}</p>
          </noscript>
          <div className={styles.prompts} aria-label="Suggested discoveries">
            {choices.map((choice) => (
              <a
                href={`/simulation?inspect=${encodeURIComponent(choice.sourceId)}#conversation-results`}
                key={choice.sourceId}
                onClick={(event) => {
                  event.preventDefault();
                  setQuery(choice.label);
                  void submit(choice.label);
                }}
              >
                {choice.label} ↗
              </a>
            ))}
          </div>
          <p role="status" aria-live="polite" className={styles.status}>
            {message}
          </p>
          <details className={styles.privacy}>
            <summary>How this conversation works</summary>
            <p>{messages.processing}</p>
            <p>{messages.retention}</p>
            <a
              href="https://aistudio.google.com/docs/terms"
              rel="noreferrer"
              target="_blank"
            >
              Gemini terms
            </a>
          </details>
        </section>
      </div>
      <section
        id="conversation-results"
        className={styles.results}
        aria-label="Sourced discoveries"
      >
        <header>
          <h2>
            {inspected.length >= 3
              ? "The door leads back to the work."
              : "Inspect the evidence."}
          </h2>
          <span>{Math.min(3, inspected.length)} / 3 discoveries</span>
        </header>
        {cards.length ? (
          <ul>
            {cards.map((card) => (
              <li key={card.id}>
                <span className={styles.eyebrow}>
                  {card.period ?? "Published record"}
                </span>
                <h3>
                  <Link href={card.href}>{card.title}</Link>
                </h3>
                <p>{card.text}</p>
                {card.limit ? (
                  <p className={styles.limit}>{card.limit}</p>
                ) : null}
                <details
                  onToggle={(event) => {
                    if (
                      event.currentTarget.open &&
                      !inspected.includes(card.id)
                    )
                      void submit("", card.id);
                  }}
                >
                  <summary>Evidence & discovery</summary>
                  <Link href={card.href}>Inspect the project ↗</Link>
                  {card.citations.map((citation) => (
                    <p key={citation.id}>
                      <Link href={citation.href}>{citation.title}</Link>
                    </p>
                  ))}
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            No matching record. <Link href="/work">Browse the work</Link> or try
            a project name.
          </p>
        )}
        {transcript.length > 1 ? (
          <details>
            <summary>Earlier in this conversation</summary>
            {transcript.slice(0, -1).map((turn, index) => (
              <div key={index}>
                <h3>{turn.question}</h3>
                {turn.cards.map((card) => (
                  <p key={card.id}>
                    <Link href={card.href}>{card.title}</Link>
                  </p>
                ))}
              </div>
            ))}
          </details>
        ) : null}
      </section>
    </div>
  );
}
