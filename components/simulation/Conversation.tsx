"use client";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { useMachine } from "@xstate/react";
import Link from "next/link";
import { animate } from "animejs";
import { SITE_COPY } from "@/lib/copy";
import { WORKSPACE_MESSAGES } from "@/lib/simulation/conversation-messages";
import type { InternetObject } from "@/lib/simulation/personal-internet";
import {
  workspaceMachine,
  type WorkspacePanel,
} from "@/lib/simulation/workspace-machine";
import { ObjectSprite } from "./ObjectSprite";
import { ArtifactWindow } from "./ArtifactWindow";
import styles from "./Conversation.module.css";

const subscribeHydration = () => () => {};
const copy = SITE_COPY.simulation;
const positions = [
  [20, 22],
  [55, 18],
  [82, 40],
  [73, 76],
  [39, 79],
  [15, 58],
];

function SourceLinks({
  ids,
  catalog,
}: {
  ids: string[];
  catalog: InternetObject[];
}) {
  return (
    <ul>
      {ids.flatMap((id) => {
        const object = catalog.find((item) => item.id === id);
        return object
          ? [
              <li key={id}>
                <a href={object.href}>{object.title}</a>
                {object.citations.length > 0 && (
                  <ul>
                    {object.citations.map((source) => (
                      <li key={source.id}>
                        <a href={source.href}>{source.title}</a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>,
            ]
          : [];
      })}
    </ul>
  );
}

export function Conversation({
  catalog,
  featuredIds,
}: {
  catalog: InternetObject[];
  featuredIds: string[];
}) {
  const [state, send] = useMachine(workspaceMachine, { input: { catalog } });
  const context = state.context;
  const [question, setQuestion] = useState("");
  const [search, setSearch] = useState("");
  const [still, setStill] = useState(false);
  const [notice, setNotice] = useState("");
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  const root = useRef<HTMLDivElement>(null);
  const companion = useRef<HTMLButtonElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const focusOrigin = useRef<HTMLElement | null>(null);
  const stateRef = useRef(context);
  const objects = featuredIds.flatMap(
    (id) => catalog.find((object) => object.id === id) ?? [],
  );
  const selected = context.selectedIds.flatMap(
    (id) => catalog.find((object) => object.id === id) ?? [],
  );
  const lastReply = context.messages.at(-1);
  const complete = context.opened && context.connected && context.investigated;

  useEffect(() => {
    stateRef.current = context;
  }, [context]);
  useEffect(() => {
    // Only interface IDs go in history. Questions/replies remain in React memory.
    const base = history.state;
    history.replaceState(
      { ...base, internetWorkspace: { openIds: [], panel: "explore" } },
      "",
    );
    const back = (event: PopStateEvent) => {
      const saved = event.state?.internetWorkspace;
      send({
        type: "RESTORE",
        openIds: Array.isArray(saved?.openIds)
          ? saved.openIds.filter((id: unknown) => typeof id === "string")
          : [],
        panel: ["chat", "journal"].includes(saved?.panel)
          ? saved.panel
          : "explore",
      });
      requestAnimationFrame(
        () => focusOrigin.current?.isConnected && focusOrigin.current.focus(),
      );
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const current = stateRef.current;
      if (current.openIds.length && current.panel === "explore")
        send({ type: "CLOSE", id: current.openIds.at(-1)! });
      else send({ type: "PANEL", panel: "explore" });
      requestAnimationFrame(
        () => focusOrigin.current?.isConnected && focusOrigin.current.focus(),
      );
    };
    window.addEventListener("popstate", back);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("popstate", back);
      window.removeEventListener("keydown", escape);
    };
  }, [send]);
  useEffect(() => {
    if (
      !context.openIds.length &&
      !context.messages.length &&
      !context.connection
    )
      return;
    if (
      still ||
      document.hidden ||
      matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active)")
        .matches ||
      !companion.current
    )
      return;
    const motion = animate(companion.current, {
      rotate: [0, -9, 7, 0],
      y: [0, -8, 0],
      duration: 380,
      ease: "outQuad",
    });
    const stop = () => {
      if (document.hidden) motion.revert();
    };
    document.addEventListener("visibilitychange", stop);
    return () => {
      motion.revert();
      document.removeEventListener("visibilitychange", stop);
    };
  }, [context.openIds, context.connection, context.messages, still]);

  function remember(openIds: string[], panel: WorkspacePanel) {
    history.pushState(
      { ...history.state, internetWorkspace: { openIds, panel } },
      "",
    );
  }
  function open(object: InternetObject, origin: HTMLElement) {
    focusOrigin.current = origin;
    remember(
      [...context.openIds.filter((id) => id !== object.id), object.id].slice(
        -2,
      ),
      "explore",
    );
    send({ type: "OPEN", id: object.id });
    setNotice(`${object.label} opened.`);
    requestAnimationFrame(() => {
      const headings =
        root.current?.querySelectorAll<HTMLElement>("[data-window] h2");
      headings?.[headings.length - 1]?.focus({
        preventScroll: matchMedia("(min-width: 900px)").matches,
      });
    });
  }
  function panel(next: WorkspacePanel) {
    remember(context.openIds, next);
    send({ type: "PANEL", panel: next });
  }
  function ask(ids: string[]) {
    remember(context.openIds, "chat");
    send({ type: "ASK", ids });
    setQuestion(
      ids.length === 2 ? copy["prompt-connection"] : copy["prompt-object"],
    );
    requestAnimationFrame(() => questionRef.current?.focus());
  }
  function submit(text: string) {
    send({ type: "SEND", question: text });
    setQuestion("");
    setNotice("Authored reply added. No model request was made.");
  }
  const linkedPositions = context.connection?.supported
    ? context.connection.ids.map((id) => positions[featuredIds.indexOf(id)])
    : [];

  return (
    <div
      ref={root}
      className={styles.experience}
      data-panel={context.panel}
      data-ready={hydrated}
      data-still={still}
    >
      <header className={styles.toolbar}>
        <div>
          <span className={styles.identifier}>
            4N1SH<span aria-hidden="true">.net</span>
          </span>
          <h1>{copy["conversation-title"]}</h1>
        </div>
        <div className={styles.toolbarActions}>
          <button
            disabled={!hydrated}
            aria-pressed={still}
            onClick={() => setStill(!still)}
          >
            {copy["still-label"]}
          </button>
          <Link href="/play" prefetch={false}>
            {copy["leave-label"]} ↗
          </Link>
        </div>
      </header>
      <div className={styles.worldLayout}>
        <section className={styles.explore} aria-label="Explore workspace">
          <div className={styles.workspaceTop}>
            <p>{copy["conversation-summary"]}</p>
            <button
              disabled={!hydrated}
              aria-pressed={context.trail}
              onClick={() => send({ type: "TRAIL" })}
            >
              {copy["trail-label"]} {context.trail ? "−" : "+"}
            </button>
          </div>
          {context.trail && (
            <div className={styles.trail} aria-label="Optional trail">
              <span data-done={context.opened}>01 {copy["trail-open"]}</span>
              <span data-done={context.connected}>
                02 {copy["trail-connect"]}
              </span>
              <span data-done={context.investigated}>
                03 {copy["trail-ask"]}
              </span>
              {complete && (
                <button onClick={() => panel("journal")}>
                  {copy["trail-complete"]} ↗
                </button>
              )}
            </div>
          )}
          <div className={styles.field}>
            <div className={styles.wallNote} aria-hidden="true">
              {copy["wall-note"]}
              <span>↘</span>
            </div>
            <svg
              className={styles.wires}
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {linkedPositions.length === 2 &&
                linkedPositions.every(Boolean) && (
                  <path
                    d={`M${linkedPositions[0][0]} ${linkedPositions[0][1]} Q50 50 ${linkedPositions[1][0]} ${linkedPositions[1][1]}`}
                  />
                )}
            </svg>
            {objects.map((object, index) => (
              <div
                key={object.id}
                className={styles.object}
                data-object={object.id}
                data-highlight={
                  lastReply?.sourceIds.includes(object.id) || undefined
                }
                data-selected={context.selectedIds.includes(object.id)}
                style={
                  {
                    "--x": `${positions[index % positions.length][0]}%`,
                    "--y": `${positions[index % positions.length][1]}%`,
                    "--mobile-y": `${positions[index % positions.length][1] * 5.4}px`,
                    "--tilt": `${[-7, 5, 8, -5, 6, -4][index % 6]}deg`,
                  } as CSSProperties
                }
              >
                <a
                  href={object.href}
                  onClick={(event) => {
                    if (
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    open(object, event.currentTarget);
                  }}
                  aria-label={`Open ${object.label}`}
                >
                  <ObjectSprite kind={object.kind} variant={index} />
                  <span>{object.label}</span>
                </a>
                <button
                  className={styles.selectObject}
                  disabled={!hydrated}
                  aria-label={`Select ${object.label} for connection`}
                  aria-pressed={context.selectedIds.includes(object.id)}
                  onClick={() => send({ type: "SELECT", id: object.id })}
                >
                  {context.selectedIds.includes(object.id) ? "✓" : "+"}
                </button>
              </div>
            ))}
            <button
              ref={companion}
              className={styles.companion}
              disabled={!hydrated}
              onClick={() => {
                focusOrigin.current = companion.current;
                ask(context.selectedIds);
              }}
              aria-label="Talk to 4N1SH"
            >
              <span
                className={styles.sprite}
                data-frame={
                  context.connection ? 2 : context.openIds.length ? 3 : 0
                }
              />
              <span className={styles.bubble}>
                {context.connection
                  ? copy["reaction-connect"]
                  : context.openIds.length
                    ? copy["reaction-open"]
                    : copy["reaction-idle"]}
              </span>
            </button>
            <span className={styles.stamp} aria-hidden="true">
              {copy["workspace-stamp"]}
            </span>
            {context.openIds.map((id, index) => {
              const object = catalog.find((entry) => entry.id === id)!;
              return (
                <ArtifactWindow
                  key={id}
                  object={object}
                  index={index}
                  still={still}
                  selected={context.selectedIds.includes(id)}
                  select={() => send({ type: "SELECT", id })}
                  ask={() => ask([id])}
                  close={() => {
                    send({ type: "CLOSE", id });
                    requestAnimationFrame(() => focusOrigin.current?.focus());
                  }}
                />
              );
            })}
          </div>
          <div className={styles.connectionTray} aria-label="Connect objects">
            <div>
              <small>{copy["connect-label"]}</small>
              <p>
                {selected.length
                  ? selected.map((object) => object.label).join(" + ")
                  : copy["connect-instruction"]}
              </p>
            </div>
            <button
              disabled={selected.length !== 2}
              onClick={() => {
                send({ type: "CONNECT" });
                setNotice(
                  "Connection checked against documented topics and sources.",
                );
              }}
            >
              {copy["connect-label"]} ↗
            </button>
          </div>
          {context.connection && (
            <section
              className={styles.connectionResult}
              aria-label="Documented connection"
            >
              <h2>
                {context.connection.supported
                  ? copy["connection-found"]
                  : copy["connection-missing"]}
              </h2>
              <p>
                {context.connection.topics
                  .map((topic) => topic.label)
                  .join(" · ")}
                {context.connection.citations.length > 0 &&
                  ` · ${context.connection.citations.length} shared ${context.connection.citations.length === 1 ? "source" : "sources"}`}
              </p>
              <p>{WORKSPACE_MESSAGES.connectionLimit}</p>
              <button onClick={() => ask(context.connection!.ids)}>
                {copy["ask-pair"]} ↗
              </button>
            </section>
          )}
          <details className={styles.archive}>
            <summary>
              {copy["browse-label"]} <span>{catalog.length}</span>
            </summary>
            <label>
              {copy["search-label"]}
              <input
                value={search}
                disabled={!hydrated}
                onChange={(event) =>
                  setSearch(event.target.value.slice(0, 120))
                }
                type="search"
              />
            </label>
            <ul>
              {catalog
                .filter((object) =>
                  `${object.title} ${object.text} ${object.topics.map((topic) => topic.label).join(" ")}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((object) => (
                  <li key={object.id}>
                    <a
                      href={object.href}
                      onClick={(event) => {
                        if (
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey
                        )
                          return;
                        event.preventDefault();
                        open(object, event.currentTarget);
                      }}
                    >
                      {object.label} ↗
                    </a>
                  </li>
                ))}
            </ul>
          </details>
        </section>
        <aside className={styles.side}>
          <section className={styles.messenger} aria-label="4N1SH messenger">
            <header className={styles.windowBar}>
              <h2>
                <span className={styles.onlineDot} aria-hidden="true" /> 4N1SH /
                messenger
              </h2>
              <span aria-hidden="true">↗</span>
            </header>
            <p className={styles.demoLabel}>{WORKSPACE_MESSAGES.demo}</p>
            <div
              className={styles.messages}
              role="log"
              aria-label="Conversation"
              aria-live="polite"
              aria-relevant="additions"
            >
              <div className={styles.greeting}>
                <span
                  className={styles.sprite}
                  data-frame="1"
                  aria-hidden="true"
                />
                <p>{copy["messenger-welcome"]}</p>
              </div>
              {context.messages.map((message, index) => (
                <div key={index} className={styles.exchange}>
                  <p className={styles.question}>{message.question}</p>
                  <p className={styles.reply}>{message.text}</p>
                  {message.sourceIds.length > 0 && (
                    <details>
                      <summary>
                        {copy["sources-label"]} · {message.sourceIds.length}
                      </summary>
                      <SourceLinks ids={message.sourceIds} catalog={catalog} />
                    </details>
                  )}
                </div>
              ))}
            </div>
            <div className={styles.composer}>
              {selected.length > 0 && (
                <p className={styles.attached}>
                  {copy["attached-label"]}:{" "}
                  {selected.map((object) => object.label).join(" + ")}
                </p>
              )}
              <div className={styles.prompts}>
                <button
                  disabled={!hydrated}
                  onClick={() =>
                    submit(
                      context.selectedIds.length === 2
                        ? copy["prompt-connection"]
                        : copy["prompt-tools"],
                    )
                  }
                >
                  {context.selectedIds.length === 2
                    ? copy["prompt-connection"]
                    : copy["prompt-tools"]}
                </button>
                <button
                  disabled={!hydrated}
                  onClick={() => submit(copy["prompt-teaching"])}
                >
                  {copy["prompt-teaching"]}
                </button>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submit(question);
                }}
              >
                <label htmlFor="internet-question">
                  {copy["question-label"]}
                </label>
                <div>
                  <textarea
                    id="internet-question"
                    ref={questionRef}
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    maxLength={800}
                    rows={2}
                    disabled={!hydrated}
                  />
                  <button
                    type="submit"
                    disabled={!hydrated || !question.trim()}
                    aria-label="Send question"
                  >
                    ↗
                  </button>
                </div>
              </form>
            </div>
          </section>
          <section className={styles.journal} aria-label="Discovery journal">
            <header className={styles.windowBar}>
              <h2>{copy["journal-label"]}</h2>
              <span aria-hidden="true">✳</span>
            </header>
            <div>
              <p>
                {complete && context.trail
                  ? copy["trail-finished"]
                  : copy["journal-intro"]}
              </p>
              {context.journalIds.length ? (
                <SourceLinks ids={context.journalIds} catalog={catalog} />
              ) : (
                <p>{copy["journal-empty"]}</p>
              )}
            </div>
          </section>
          <nav className={styles.dock} aria-label="Workspace">
            <button
              disabled={!hydrated}
              aria-pressed={context.panel === "explore"}
              onClick={() => panel("explore")}
            >
              <span aria-hidden="true">✳</span>
              {copy["explore-label"]}
            </button>
            <button
              disabled={!hydrated}
              aria-pressed={context.panel === "chat"}
              onClick={() => panel("chat")}
            >
              <span aria-hidden="true">↗</span>
              {copy["chat-label"]}
            </button>
            <button
              disabled={!hydrated}
              aria-pressed={context.panel === "journal"}
              onClick={() => panel("journal")}
            >
              <span aria-hidden="true">▤</span>
              {copy["journal-label"]}
              {context.journalIds.length > 0 && (
                <small>{context.journalIds.length}</small>
              )}
            </button>
          </nav>
          <p className={styles.smallPrint}>
            {WORKSPACE_MESSAGES.disclosure}
          </p>
        </aside>
      </div>
      <div role="status" className={styles.srOnly}>
        {notice}
      </div>
      <details className={styles.privacy}>
        <summary>{copy["preview-notes"]}</summary>
        <p>
          {WORKSPACE_MESSAGES.privacy}
        </p>
      </details>
      <noscript>
        <p className={styles.noScript}>
          {WORKSPACE_MESSAGES.noScript}
        </p>
      </noscript>
    </div>
  );
}
