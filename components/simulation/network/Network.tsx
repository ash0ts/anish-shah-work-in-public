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
import { SITE_COPY } from "@/lib/copy";
import { networkMachine } from "@/lib/simulation/network/machine";
import {
  CHARACTERS,
  CHARACTER_IDS,
  type CharacterId,
} from "@/lib/simulation/network/characters";
import {
  ENCOUNTERS,
  PROGRAMS,
  type Program,
} from "@/lib/simulation/network/battle";
import {
  pageCatalog,
  type CatalogDomain,
  type CatalogPage,
  type Discovery,
} from "@/lib/simulation/network/catalog-contract";
import {
  PROGRESS_KEY,
  progressSchema,
} from "@/lib/simulation/network/progress";
import {
  CONVERSATION_VERSION,
  searchConversationSources,
  type ConversationReply,
  type RecentTurn,
} from "@/lib/simulation/conversation-contract";
import { CONVERSATION_MESSAGES } from "@/lib/simulation/conversation-messages";
import { World } from "./World";
import { restoreDeviceProgress } from "./restore-progress";
import {
  visibleDiscoveries,
  visibleExchanges,
} from "@/lib/simulation/network/visibility";
import { BattleControls } from "./BattleControls";
import { FolderPanel } from "./FolderPanel";
import { fixtureCatalog } from "@/lib/simulation/network/fixtures";
import styles from "./Network.module.css";
const copy = SITE_COPY.simulation;
const subscribe = () => () => {};
type Exchange = RecentTurn & {
  character: CharacterId;
  source: string;
  reaction: string;
  cards: ConversationReply["cards"];
};
function Portrait({
  character,
  reaction = false,
}: {
  character: CharacterId;
  reaction?: boolean;
}) {
  return (
    <span
      className={styles.portrait}
      style={
        {
          "--row": CHARACTERS[character].row,
          "--frame": reaction ? 3 : 0,
        } as CSSProperties
      }
      aria-hidden="true"
    />
  );
}
export function Network({
  initial,
  featuredIds,
  synthetic,
  previewWork,
}: {
  initial: CatalogPage;
  featuredIds: string[];
  synthetic: boolean;
  previewWork: Discovery[];
}) {
  const [state, send] = useMachine(networkMachine);
  const context = state.context,
    fighting = state.matches("battling"),
    panel = ["folder", "dialogue", "detail", "journal"].find((name) =>
      state.matches(name as "folder"),
    );
  const [catalog, setCatalog] = useState<Discovery[]>(initial.items),
    [page, setPage] = useState(initial);
  const [domain, setDomain] = useState<CatalogDomain>("work"),
    [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false),
    [notice, setNotice] = useState("");
  const [still, setStill] = useState(false),
    [stepMode, setStepMode] = useState(false),
    [capability, setCapability] = useState(false);
  const [remember, setRemember] = useState(false),
    [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Exchange[]>([]),
    [sending, setSending] = useState(false);
  const [queue, setQueue] = useState<Program[]>(["Pulse", "Guard", "Sweep"]);
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const root = useRef<HTMLDivElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    focusOrigin = useRef<HTMLElement | null>(null);
  const dialogTitle = useRef<HTMLHeadingElement>(null),
    questionRef = useRef<HTMLTextAreaElement>(null);
  const sessionRevision = useRef<number | null>(null),
    inFlight = useRef(false),
    fetchSequence = useRef(0),
    requestController = useRef<AbortController | null>(null);
  const refs = useRef({ context, catalog, messages, panel });
  const selected = context.selected.flatMap(
    (id) => catalog.find((item) => item.id === id) ?? [],
  );
  const character = CHARACTERS[context.character];
  const activeBattle = context.battle;
  useEffect(() => {
    refs.current = { context, catalog, messages, panel };
  }, [context, catalog, messages, panel]);
  useEffect(() => {
    const media = matchMedia(
      "(prefers-reduced-motion: reduce), (forced-colors: active)",
    );
    const update = () => {
      setCapability(!media.matches);
      if (media.matches) setStepMode(true);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const pause = () => {
      if ((document.hidden || !document.hasFocus()) && !refs.current.panel)
        send({ type: "PAUSE" });
    };
    const back = (event: PopStateEvent) => {
      const target = event.state?.networkPanel;
      if (
        target &&
        ["FOLDER", "CHAT", "JOURNAL", "INSPECT"].includes(target.type)
      ) {
        if (
          target.type !== "INSPECT" ||
          refs.current.catalog.some((item) => item.id === target.id)
        )
          send(target);
        return;
      }
      send({ type: "CLOSE" });
      focusOrigin.current?.focus();
    };
    document.addEventListener("visibilitychange", pause);
    window.addEventListener("blur", pause);
    window.addEventListener("popstate", back);
    return () => {
      document.removeEventListener("visibilitychange", pause);
      window.removeEventListener("blur", pause);
      window.removeEventListener("popstate", back);
      requestController.current?.abort();
    };
  }, [send]);
  useEffect(() => {
    if (panel) {
      if (!dialog.current?.open) dialog.current?.showModal();
      dialogTitle.current?.focus();
    } else if (dialog.current?.open) {
      dialog.current.close();
      focusOrigin.current?.focus();
    }
  }, [panel]);
  useEffect(() => {
    if (
      !fighting ||
      stepMode ||
      still ||
      !capability ||
      activeBattle?.outcome !== "active"
    )
      return;
    const timer = setInterval(() => {
      if (!document.hidden && document.hasFocus())
        send({ type: "BATTLE", action: { type: "step" } });
    }, 1200);
    return () => clearInterval(timer);
  }, [fighting, stepMode, still, capability, activeBattle?.outcome, send]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await restoreDeviceProgress(
          localStorage.getItem(PROGRESS_KEY),
          initial.items,
          previewWork,
          synthetic,
          controller.signal,
        );
        if (!result?.saved || controller.signal.aborted) return;
        send({ type: "RESTORE", ...result.saved });
        setCatalog(result.items);
        setRemember(true);
        setStepMode(result.saved.stepMode);
        setNotice(
          "Saved progress restored against the current catalog. Unavailable discoveries were removed.",
        );
      } catch {
        if (!controller.signal.aborted)
          setNotice(
            "Saved progress could not be verified. It remains on this device; exploration still works.",
          );
      }
    })();
    return () => controller.abort();
  }, [initial.items, previewWork, synthetic, send]);
  useEffect(() => {
    if (!remember) return;
    try {
      const data = progressSchema.parse({
        version: 1,
        discoveries: context.discoveries,
        equipped: context.equipped,
        completed: context.completed,
        stepMode,
        sound: false,
      });
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
    } catch {
      // Surface an external storage failure without changing game state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotice("Progress could not be saved. Exploration still works.");
    }
  }, [
    remember,
    context.discoveries,
    context.equipped,
    context.completed,
    stepMode,
  ]);
  function open(type: "FOLDER" | "CHAT" | "JOURNAL" | "INSPECT", id?: string) {
    if (!panel && !focusOrigin.current?.isConnected)
      focusOrigin.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : root.current;
    const target = type === "INSPECT" ? { type, id } : { type };
    if (!panel)
      history.pushState({ ...history.state, networkPanel: target }, "");
    else history.replaceState({ ...history.state, networkPanel: target }, "");
    if (type === "INSPECT" && id) send({ type, id });
    else if (type !== "INSPECT") send({ type });
  }
  function close() {
    if (history.state?.networkPanel) history.back();
    send({ type: "CLOSE" });
    focusOrigin.current?.focus();
  }
  function walk(dx: number, dy: number) {
    if (fighting) send({ type: "BATTLE", action: { type: "move", dx, dy } });
    else
      send({
        type: "WALK",
        x: context.position.x + dx,
        y: context.position.y + dy,
      });
  }
  function visit(character: CharacterId) {
    send({ type: "MEET", character });
    setNotice(CHARACTERS[character].greeting);
    const domain =
      character === "index"
        ? "myanimelist"
        : character === "loop"
          ? "spotify"
          : "work";
    setSearch("");
    void load(domain);
    open("FOLDER");
  }
  async function load(nextDomain: CatalogDomain, q = "", number = 1) {
    const sequence = ++fetchSequence.current;
    setDomain(nextDomain);
    setLoading(true);
    try {
      if (synthetic) {
        const fixture =
          nextDomain === "work"
            ? { ...pageCatalog(previewWork, "work", q, number), fixture: true }
            : fixtureCatalog(nextDomain, q, number);
        setPage(fixture);
        setCatalog((current) =>
          [
            ...new Map(
              [...current, ...fixture.items].map((item) => [item.id, item]),
            ).values(),
          ].slice(-240),
        );
        return;
      }
      const response = await fetch(
        `/api/simulation/catalog?${new URLSearchParams({ domain: nextDomain, q, page: String(number) })}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("catalog");
      const data = (await response.json()) as CatalogPage;
      if (sequence !== fetchSequence.current) return;
      setPage(data);
      setCatalog((current) =>
        [
          ...new Map(
            [
              ...current.filter(
                (item) =>
                  item.domain !== nextDomain ||
                  (data.status === "ready" &&
                    (nextDomain === "work" ||
                      item.version === data.items[0]?.version)),
              ),
              ...data.items,
            ].map((item) => [item.id, item]),
          ).values(),
        ].slice(-240),
      );
      if (data.status !== "ready")
        setMessages((current) =>
          current.filter(
            (m) =>
              !m.sourceIds.some((id) => id.startsWith(`saved:${nextDomain}:`)),
          ),
        );
    } catch {
      if (sequence === fetchSequence.current) {
        setPage({
          ...initial,
          domain: nextDomain,
          items: [],
          total: 0,
          nextPage: null,
          status: "unavailable",
        });
        setNotice(
          "The saved catalog is unavailable. No refresh was requested.",
        );
      }
    } finally {
      if (sequence === fetchSequence.current) setLoading(false);
    }
  }
  function authored(
    text: string,
    cards: ConversationReply["cards"],
    status = "answered",
  ) {
    const answer = cards.length
      ? cards
          .map(
            (card) =>
              `${card.title}: ${card.text}${card.limit ? ` ${card.limit}` : ""}`,
          )
          .join(" ")
      : CONVERSATION_MESSAGES.status.no_evidence;
    return {
      question: text,
      answer:
        status === "screened" ? CONVERSATION_MESSAGES.status.screened : answer,
      sourceIds: cards.map((c) => c.id),
      character: context.character,
      source: "Authored archive reply",
      reaction: character.reaction,
      cards,
    };
  }
  async function ask(text: string) {
    if (inFlight.current || !text.trim()) return;
    inFlight.current = true;
    setSending(true);
    setQuestion("");
    const controller = new AbortController();
    requestController.current = controller;
    try {
      let reply: Exchange;
      if (synthetic)
        reply = authored(
          text,
          selected.length
            ? selected
            : searchConversationSources(catalog, text).slice(0, 3),
        );
      else {
        if (sessionRevision.current === null) {
          const start = await fetch("/api/simulation/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ version: CONVERSATION_VERSION }),
            signal: controller.signal,
          });
          if (!start.ok) throw new Error("session");
          sessionRevision.current = (await start.json()).revision;
        }
        const response = await fetch("/api/simulation/turn", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "if-match": String(sessionRevision.current),
          },
          body: JSON.stringify({
            version: CONVERSATION_VERSION,
            requestId: crypto.randomUUID(),
            message: text.slice(0, 800),
            inspectId: null,
            character: context.character,
            selectedIds: selected.map((item) => item.id),
            context: messages
              .slice(-4)
              .map(({ question, answer, sourceIds }) => ({
                question: question.slice(0, 800),
                answer: answer.slice(0, 1200),
                sourceIds,
              })),
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          sessionRevision.current = null;
          if (response.status === 409) {
            setMessages([]);
            setCatalog([]);
            setPage((current) => ({
              ...current,
              items: [],
              total: 0,
              nextPage: null,
            }));
            setHighlightIds([]);
            setNotice(
              "The source or conversation changed. Search the chip folder again to load current discoveries.",
            );
            return;
          }
          throw new Error("turn");
        }
        const data = (await response.json()) as ConversationReply;
        setHighlightIds(
          data.dialogue?.highlightIds ?? data.cards.map((card) => card.id),
        );
        sessionRevision.current = data.revision;
        const visible = new Set(data.visibleIds);
        setMessages((current) => visibleExchanges(current, visible));
        setCatalog((current) => visibleDiscoveries(current, visible));
        setPage((current) => ({
          ...current,
          items: visibleDiscoveries(current.items, visible),
        }));
        reply = data.dialogue
          ? {
              question: text,
              answer: data.dialogue.sections.map((s) => s.text).join("\n\n"),
              reaction: data.dialogue.reaction,
              sourceIds: data.cards.map((card) => card.id),
              character: context.character,
              source: "Gemini · sourced reply",
              cards: data.cards,
            }
          : authored(text, data.cards, data.status);
      }
      setMessages((current) => [...current, reply].slice(-8));
      setNotice("Reply added. Sources are available inside the message.");
    } catch {
      if (!controller.signal.aborted) {
        setMessages((current) =>
          [
            ...current,
            authored(
              text,
              searchConversationSources(
                catalog.filter((item) => item.domain === "work"),
                text,
              ).slice(0, 3),
            ),
          ].slice(-8),
        );
        setNotice(
          "Live conversation is unavailable. This reply uses the local archive; no retry was made.",
        );
      }
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }
  const details = selected.at(-1);
  const shared =
    selected.length === 2
      ? selected[0].topics.filter((t) =>
          selected[1].topics.some((other) => other.id === t.id),
        )
      : [];
  return (
    <div
      className={styles.network}
      ref={root}
      onPointerDownCapture={(event) => {
        if (!panel && event.target instanceof Element)
          focusOrigin.current =
            event.target.closest<HTMLElement>(
              "button, a, select, [tabindex]",
            ) ?? root.current;
      }}
      onFocusCapture={(event) => {
        if (!panel) focusOrigin.current = event.target;
      }}
      data-network-ready={ready}
      data-state={String(state.value)}
    >
      <header className={styles.topbar}>
        <div>
          <span className={styles.kicker}>{copy["network-eyebrow"]}</span>
          <h1>
            4N1SH<span aria-hidden="true">.net</span>
          </h1>
        </div>
        <div className={styles.actions}>
          <button
            disabled={!ready}
            aria-pressed={still}
            onClick={() => {
              setStill(!still);
              setStepMode(true);
            }}
          >
            {copy["still-label"]}
          </button>
          <button
            disabled={!ready}
            onClick={() =>
              send({ type: state.matches("paused") ? "CLOSE" : "PAUSE" })
            }
          >
            {state.matches("paused")
              ? copy["network-resume"]
              : copy["network-pause"]}
          </button>
          <Link href="/play?view=directory" prefetch={false}>
            {copy["leave-label"]} ↗
          </Link>
        </div>
      </header>
      <section
        className={styles.viewport}
        aria-label="Personal network world"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || panel) return;
          const directions: Record<string, [number, number]> = {
            ArrowUp: [0, -1],
            w: [0, -1],
            ArrowDown: [0, 1],
            s: [0, 1],
            ArrowLeft: [-1, 0],
            a: [-1, 0],
            ArrowRight: [1, 0],
            d: [1, 0],
          };
          if (directions[event.key]) {
            event.preventDefault();
            walk(...directions[event.key]);
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (fighting) send({ type: "BATTLE", action: { type: "use" } });
            else {
              const { x, y } = context.position;
              const nearby = [
                { id: "patch" as const, x: 1, y: 2 },
                { id: "index" as const, x: 7, y: 2 },
                { id: "loop" as const, x: 5, y: 7 },
              ].find((n) => Math.abs(n.x - x) + Math.abs(n.y - y) <= 2);
              if (nearby) visit(nearby.id);
              else open("FOLDER");
            }
          }
        }}
      >
        <div className={styles.zoneLabels}>
          <button disabled={!ready} onClick={() => visit("patch")}>
            01 / {copy["network-workshop"]}
          </button>
          <button disabled={!ready} onClick={() => visit("index")}>
            02 / {copy["network-media"]}
          </button>
          <button disabled={!ready} onClick={() => visit("loop")}>
            03 / {copy["network-frequency"]}
          </button>
        </div>
        {ready && capability && !still ? (
          <World
            view={{
              position: context.position,
              battle: activeBattle,
              fighting,
              paused: !!panel || state.matches("paused"),
              character: context.character,
              chips: catalog.map(({ id, domain }) => ({ id, domain })),
              highlightIds,
            }}
            move={(x, y) => send({ type: "WALK", x, y })}
            meet={(id) => {
              visit(id);
            }}
            inspect={(id) => open("INSPECT", id)}
            fail={() => {
              setCapability(false);
              setStepMode(true);
            }}
          />
        ) : (
          <div className={styles.staticWorld}>
            {CHARACTER_IDS.map((id) => (
              <button
                disabled={!ready}
                key={id}
                onClick={() => {
                  send({ type: "MEET", character: id });
                  open("CHAT");
                }}
              >
                <Portrait character={id} />
                <strong>{CHARACTERS[id].name}</strong>
                <span>{CHARACTERS[id].greeting}</span>
              </button>
            ))}
          </div>
        )}
        {state.matches("paused") && (
          <div className={styles.paused}>
            <strong>Network paused</strong>
            <button onClick={() => send({ type: "CLOSE" })}>
              {copy["network-resume"]}
            </button>
          </div>
        )}
        <div className={styles.worldFooter}>
          <span>
            {fighting
              ? `GLITCH / ${activeBattle?.encounter.toUpperCase()}`
              : "ARROWS / WASD · TAP TO WALK · ENTER TO INSPECT"}
          </span>
          <span>{context.discoveries.length} DISCOVERED</span>
        </div>
      </section>
      <div className={styles.controlDeck}>
        <div className={styles.companion}>
          <Portrait
            character={context.character}
            reaction={selected.length > 0}
          />
          <div>
            <label htmlFor="network-character">Companion</label>
            <select
              id="network-character"
              value={context.character}
              onChange={(event) =>
                send({
                  type: "MEET",
                  character: event.target.value as CharacterId,
                })
              }
            >
              {CHARACTER_IDS.map((id) => (
                <option key={id} value={id}>
                  {CHARACTERS[id].name}
                </option>
              ))}
            </select>
            <p>
              {notice ||
                (selected.length ? character.reaction : character.greeting)}
            </p>
          </div>
        </div>
        <div className={styles.dpad} aria-label="Directional controls">
          {(
            [
              [0, -1, "↑", "Up"],
              [-1, 0, "←", "Left"],
              [0, 1, "↓", "Down"],
              [1, 0, "→", "Right"],
            ] as const
          ).map(([dx, dy, icon, label]) => (
            <button
              key={label}
              disabled={!ready || !!panel || state.matches("paused")}
              aria-label={label}
              onClick={() => walk(dx, dy)}
            >
              {icon}
            </button>
          ))}
        </div>
        <nav className={styles.dock} aria-label="Network tools">
          <button disabled={!ready} onClick={() => open("FOLDER")}>
            <span aria-hidden="true">▣</span>{" "}
            <span>{copy["network-folder"]}</span>
          </button>
          <button disabled={!ready} onClick={() => open("CHAT")}>
            <span aria-hidden="true">↗</span> <span>{copy["chat-label"]}</span>
          </button>
          <button disabled={!ready} onClick={() => open("JOURNAL")}>
            <span aria-hidden="true">▤</span>{" "}
            <span>{copy["journal-label"]}</span>
          </button>
        </nav>
      </div>
      {fighting && activeBattle && (
        <BattleControls
          activeBattle={activeBattle}
          stepMode={stepMode}
          setStepMode={setStepMode}
          capability={capability}
          still={still}
          send={send}
          open={open}
        />
      )}
      <details className={styles.encounters}>
        <summary>
          {copy["network-encounters"]} · {context.completed.length}/3
        </summary>
        <p>
          Fictional glitches, not collection items. Retry or skip without losing
          discoveries.
        </p>
        <div className={styles.actions}>
          {ENCOUNTERS.map((id, i) => (
            <button
              disabled={!ready}
              key={id}
              onClick={() => send({ type: "ENCOUNTER", encounter: id })}
            >
              {i + 1}.{" "}
              {id === "tutorial"
                ? copy["network-first-contact"]
                : id === "crosswire"
                  ? copy["network-crosswire"]
                  : copy["network-glitch"]}{" "}
              {context.completed.includes(id) ? "✓" : ""}
            </button>
          ))}
        </div>
      </details>
      <details className={styles.foundations}>
        <summary>Characters & source navigation</summary>
        <p>{CONVERSATION_MESSAGES.disclosure}</p>
        {CHARACTER_IDS.map((id) => (
          <p key={id}>
            <strong>{CHARACTERS[id].name}</strong> — {CHARACTERS[id].voice}
          </p>
        ))}
        <ul>
          {initial.items
            .filter((item) => featuredIds.includes(item.id))
            .map((item) => (
              <li key={item.id}>
                <a href={item.href}>{item.title}</a> — {item.text}
              </li>
            ))}
        </ul>
        <Link href="/work" prefetch={false}>
          Complete Work archive ↗
        </Link>
        <noscript>
          <p>{CONVERSATION_MESSAGES.noScript}</p>
        </noscript>
      </details>
      <dialog
        ref={dialog}
        className={styles.panel}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        aria-labelledby="network-panel-title"
      >
        <header className={styles.panelBar}>
          <h2 id="network-panel-title" ref={dialogTitle} tabIndex={-1}>
            {panel === "folder"
              ? copy["network-folder"]
              : panel === "dialogue"
                ? `${character.name} / messenger`
                : panel === "journal"
                  ? "Discoveries"
                  : "Discovery chip"}
          </h2>
          <button onClick={close} aria-label="Close panel">
            ×
          </button>
        </header>
        {panel === "folder" && (
          <FolderPanel
            context={context}
            catalog={catalog}
            activeBattle={activeBattle}
            queue={queue}
            setQueue={setQueue}
            domain={domain}
            load={load}
            search={search}
            setSearch={setSearch}
            loading={loading}
            page={page}
            synthetic={synthetic}
            send={send}
            open={open}
            close={close}
          />
        )}
        {panel === "detail" && details && (
          <article className={styles.detail}>
            <span className={styles.kicker}>{details.provenance}</span>
            <h3>{details.title}</h3>
            <p>{details.text}</p>
            {details.limit && <p>{details.limit}</p>}
            {details.updatedAt && (
              <p>
                {details.stale ? "Saved snapshot · " : ""}Updated{" "}
                {new Date(details.updatedAt).toISOString().slice(0, 10)}
              </p>
            )}
            <a href={details.href}>Open source collection or project ↗</a>
            <div className={styles.actions}>
              <button
                onClick={() => {
                  send({ type: "CHAT" });
                  requestAnimationFrame(() => questionRef.current?.focus());
                }}
              >
                {copy["ask-label"]}
              </button>
              <button onClick={() => send({ type: "FOLDER" })}>
                Inspect another
              </button>
            </div>
            <h4>Equip this discovery</h4>
            <div className={styles.actions}>
              {context.equipped.map((slot, index) => (
                <button
                  key={index}
                  onClick={() => {
                    send({
                      type: "EQUIP",
                      index,
                      program: slot.program,
                      discoveryId: details.id,
                    });
                    setNotice(
                      `${slot.program} equipped with ${details.title}. The game effect has not changed.`,
                    );
                  }}
                >
                  Slot {index + 1} / {slot.program}
                </button>
              ))}
            </div>
            {selected.length === 2 && (
              <p>
                {shared.length
                  ? `Shared metadata: ${shared.map((t) => t.label).join(", ")}. Shared metadata does not establish influence or collaboration.`
                  : "No documented shared topic or metadata connects this pair."}
              </p>
            )}
          </article>
        )}
        {panel === "dialogue" && (
          <div className={styles.chat}>
            <p>{CONVERSATION_MESSAGES.processing}</p>
            <p>
              {selected.length
                ? `Attached: ${selected.map((item) => item.title).join(" + ")}`
                : "Ask about the visible archive, or attach a discovery."}
            </p>
            <div
              className={styles.messages}
              role="log"
              aria-live="polite"
              aria-label="Conversation"
            >
              {messages.map((m, i) => (
                <article key={i}>
                  <p className={styles.question}>{m.question}</p>
                  <small>
                    {CHARACTERS[m.character].name} · {m.source}
                  </small>
                  <p>{m.answer}</p>
                  <p className={styles.reaction}>
                    Fictional reaction: {m.reaction}
                  </p>
                  {m.cards.length > 0 && (
                    <details>
                      <summary>Sources · {m.cards.length}</summary>
                      {m.cards.map((card) => (
                        <div key={card.id}>
                          <a href={card.href}>{card.title}</a>
                          <p>{card.text}</p>
                          {card.limit && <p>{card.limit}</p>}
                          {card.period && <small>{card.period}</small>}
                        </div>
                      ))}
                    </details>
                  )}
                </article>
              ))}
            </div>
            <div className={styles.actions}>
              <button
                disabled={sending}
                onClick={() => void ask("What does this source actually show?")}
              >
                What does this show?
              </button>
              <button
                disabled={sending}
                onClick={() => void ask("How do these discoveries connect?")}
              >
                Find a connection
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void ask(question);
              }}
            >
              <label htmlFor="network-question">{copy["question-label"]}</label>
              <textarea
                ref={questionRef}
                id="network-question"
                maxLength={800}
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <button disabled={sending || !question.trim()}>
                {sending ? "Waiting…" : "Send question"}
              </button>
            </form>
          </div>
        )}
        {panel === "journal" && (
          <div className={styles.detail}>
            <p>Discoveries stay available whether you battle, skip, or lose.</p>
            <ul>
              {context.discoveries.flatMap((id) => {
                const item = catalog.find((c) => c.id === id);
                return item
                  ? [
                      <li key={id}>
                        <a href={item.href}>{item.title}</a>
                      </li>,
                    ]
                  : [];
              })}
            </ul>
            <p>
              {context.completed.length} encounters completed ·{" "}
              {context.discoveries.length} discoveries
            </p>
            <label>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => {
                  setRemember(e.target.checked);
                  if (!e.target.checked) {
                    try {
                      localStorage.removeItem(PROGRESS_KEY);
                    } catch {
                      setNotice(
                        "Device storage is unavailable. Progress stays in memory.",
                      );
                    }
                  }
                }}
              />{" "}
              Remember progress on this device
            </label>
            <p>
              Only discovery IDs, programs, completed encounters and
              preferences. Never collection contents or conversation text.
            </p>
            <button
              onClick={() => {
                try {
                  localStorage.removeItem(PROGRESS_KEY);
                } catch {
                  setNotice(
                    "Device storage is unavailable. Clear this site's storage in browser settings.",
                  );
                }
                setRemember(false);
                send({
                  type: "RESTORE",
                  discoveries: [],
                  completed: [],
                  equipped: PROGRAMS.map((program) => ({
                    program,
                    discoveryId: null,
                  })),
                });
                setMessages([]);
                setNotice(
                  "Device progress and this conversation were cleared.",
                );
              }}
            >
              Reset progress
            </button>
          </div>
        )}
      </dialog>
      <details className={styles.privacy}>
        <summary>{copy["preview-notes"]}</summary>
        <p>{CONVERSATION_MESSAGES.retention}</p>
        <p>
          Exploration reads accepted snapshots only. No provider refresh,
          scraping, automatic model request, Strava or Travel data. Collection
          game-display and Google-processing permissions are separate.
        </p>
        <a href="/studio">Local Studio setup ↗</a>
      </details>
      <p role="status" className={styles.srOnly}>
        {notice}
      </p>
    </div>
  );
}
