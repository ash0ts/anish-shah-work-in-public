import Link from "next/link";
import type { CSSProperties } from "react";
import { SITE_COPY } from "@/lib/copy";
import { loopItems, selectRigView } from "@/lib/gear-model";
import type { GearItem, GearManifest, RigPrograms, GearStatus } from "@/types/gear";
import styles from "./RigScreen.module.css";

type View = ReturnType<typeof selectRigView>;
function copy(key: string) {
  if (!(key in SITE_COPY.play)) throw new Error(`Unknown rig copy: ${key}`);
  return SITE_COPY.play[key as keyof typeof SITE_COPY.play];
}
function href(view: View, change: Partial<View> = {}) {
  const v = { ...view, ...change };
  return `/play/rig?bank=${v.bank}&preset=${v.preset}&deck=${v.deck}#workbench`;
}

function Pedal({ item, active, manifest }: { item: GearItem; active: boolean; manifest: GearManifest }) {
  const f = item.footprint!;
  const w = f.rotation === 90 ? f.h : f.w, h = f.rotation === 90 ? f.w : f.h;
  const style = {
    left: `${f.x / manifest.build.widthMm * 100}%`, top: `${f.y / manifest.build.depthMm * 100}%`,
    width: `${w / manifest.build.widthMm * 100}%`, height: `${h / manifest.build.depthMm * 100}%`,
    "--pedal-color": f.color,
  } as CSSProperties;
  const utility = !item.loop && item.id !== "tuner-unconfirmed";
  return (
    <a href={`#gear-${item.id}`} className={styles.pedal} style={style} data-active={active} data-utility={utility}
      data-planned={item.status === "planned"} data-device={item.id}
      aria-label={`${item.brand} ${item.model} · ${copy(`rig-${item.status}-label`)}${item.loop ? ` · ${copy("rig-loop-label")} ${item.loop} · ${copy(active ? "rig-active-label" : "rig-bypassed-label")}` : ""}`}>
      <span className={styles.knobs} aria-hidden="true">{Array.from({ length: f.knobs }, (_, n) => <i key={n} />)}</span>
      <strong>{item.model}</strong>
      <small>{item.brand}</small>
      {item.loop ? <span className={styles.loop}>{String(item.loop).padStart(2, "0")}</span> : null}
      <span className={styles.stomps} aria-hidden="true">{Array.from({ length: f.switches || (item.id === "gigrig-g3s" ? 14 : 0) }, (_, n) => <i key={n} />)}</span>
    </a>
  );
}

export function RigScreen({ manifest, programs, view }: { manifest: GearManifest; programs: RigPrograms; view: View }) {
  const preset = programs.presets[view.preset - 1];
  const active = new Set(preset.loops);
  const pedals = manifest.items.filter(item => item.footprint && (item.placement === view.deck || item.placement === "both"));
  const statuses: GearStatus[] = ["owned", "incoming", "planned", "optional"];
  return (
    <main className={styles.page} data-gear-rig id="main">
      <nav aria-label={copy("rig-nav-label")} className={styles.nav}>
        <Link href="/play?view=directory" prefetch={false}>← {copy("rig-back-label")}</Link>
        <span>{copy("rig-screen-eyebrow")}</span>
      </nav>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>{copy("rig-plan-label")}</p><h1>{copy("rig-screen-title")}</h1><p>{copy("rig-plan-body")}</p></div>
        <svg className={styles.guitar} viewBox="0 0 120 300" aria-hidden="true" focusable="false">
          <path d="M51 94V24l-7-14 9-8 21 8-10 23v66c21 23 7 34 24 55 38 43 24 99-28 99-55 0-76-51-36-96 21-23 1-41 27-63Z" fill="currentColor" />
          <path d="M53 26h9v156h-9zM43 168h29v11H43zM43 190h29v11H43zM43 217h29v5H43z" fill="var(--rig-paper)" />
          <path d="M54 27v195m3-195v195m3-195v195" stroke="var(--rig-ink)" strokeWidth=".7" />
          <circle cx="79" cy="211" r="5" fill="var(--rig-paper)" />
          <path d="M81 241c45 42-63 55-15 55" fill="none" stroke="currentColor" strokeWidth="3" />
        </svg>
      </header>

      <section className={styles.workbench} id="workbench" aria-labelledby="board-title">
        <header className={styles.sectionHeader}><div><p className={styles.eyebrow}>01 / SA550XDM</p><h2 id="board-title">{copy("rig-board-title")}</h2></div><p>{copy("rig-board-body")}</p></header>
        <nav className={styles.segment} aria-label={copy("rig-bank-label")}>
          {[1, 2].map(bank => <Link key={bank} href={href(view, { bank, preset: Math.min(view.preset, bank === 2 ? 7 : 14) })} scroll={false} prefetch={false} aria-current={view.bank === bank ? "true" : undefined}>{copy(`rig-bank-${bank}-label`)}</Link>)}
        </nav>
        <p className={styles.bankNote}>{copy(`rig-bank-${view.bank}-body`)}</p>
        <nav aria-label={copy("rig-presets-label")} className={styles.presets}>
          {programs.presets.slice(0, view.bank === 2 ? 7 : 14).map(p => <Link href={href(view, { preset: p.slot })} scroll={false} prefetch={false} key={p.slot} aria-current={view.preset === p.slot ? "true" : undefined}><span>{String(p.slot).padStart(2, "0")}</span>{copy(p.labelKey)}</Link>)}
        </nav>
        {view.bank === 2 ? <div className={styles.commands}><h3>{copy("rig-command-label")}</h3><ol start={8}>{programs.op1Commands.map(c => <li key={c.slot}><span>{c.slot}</span><strong>{copy(c.labelKey)}</strong><small>CC {c.cc}</small></li>)}</ol><p>{copy("rig-command-body")}</p><p>{copy("rig-bank-change-body")}</p></div> : null}
        <div className={styles.deckBar}>
          <nav className={styles.segment} aria-label={copy("rig-deck-label")}>
            {(["upper", "lower"] as const).map(deck => <Link key={deck} href={href(view, { deck })} scroll={false} prefetch={false} aria-current={view.deck === deck ? "true" : undefined}>{copy(`rig-${deck}-label`)}</Link>)}
          </nav>
          <span className={styles.activeKey}><i aria-hidden="true" />{copy("rig-active-label")} / {copy(preset.labelKey)}</span>
        </div>
        <div className={styles.boardScroll} tabIndex={0} role="region" aria-label={copy("rig-board-title")}>
          <div className={styles.board} data-deck={view.deck}>
            <div className={styles.rails} aria-hidden="true" />
            {pedals.map(item => <Pedal key={item.id} item={item} active={Boolean(item.loop && active.has(item.loop))} manifest={manifest} />)}
            <span className={styles.boardBadge} aria-hidden="true">SCHMIDT ARRAY / 550 XDM</span>
          </div>
        </div>
        <p className={styles.fine}>{copy("rig-plan-fit-body")}</p>
        <p className={styles.fine}>{copy("rig-preset-body")}</p>
      </section>

      <section className={styles.section} aria-labelledby="signal-chain-title">
        <header className={styles.sectionHeader}><div><p className={styles.eyebrow}>02 / AUDIO</p><h2 id="signal-chain-title">{copy("rig-chain-title")}</h2></div><p>{copy("rig-chain-body")}</p></header>
        <div className={styles.input}><span>{copy("rig-guitar-label")}</span><b aria-hidden="true">→</b><span>{copy("rig-detector-label")}</span><b aria-hidden="true">→</b><span>G3S IN</span></div>
        <ol className={styles.chain}>{loopItems(manifest.items).map(item => <li key={item.id} data-active={active.has(item.loop!)} data-gate={item.loop === 8}><a href={`#gear-${item.id}`}><span>{copy("rig-loop-label")} {item.loop}</span><strong>{item.model}</strong><small>{copy(active.has(item.loop!) ? "rig-active-label" : "rig-bypassed-label")}</small></a></li>)}</ol>
        <p className={styles.eyebrow}>{copy("rig-output-label")}</p>
        <div className={styles.outputs}>
          <article><span className={styles.port}>B / OUT 2</span><h3>{copy("rig-amp-label")}</h3><p>{copy("rig-amp-body")}</p></article>
          <article><span className={styles.port}>C · G · H / OPUS</span><h3>{copy("rig-record-label")}</h3><p>{copy("rig-record-body")}</p><p className={styles.fine}>{copy("rig-usb-body")}</p></article>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="collection-title">
        <header className={styles.sectionHeader}><div><p className={styles.eyebrow}>03 / INVENTORY</p><h2 id="collection-title">{copy("rig-inventory-title")}</h2></div><p>{copy("rig-inventory-body")}</p></header>
        {statuses.map(status => {
          const items = manifest.items.filter(item => item.status === status);
          return items.length ? <div className={styles.collection} key={status}><h3>{copy(`rig-${status}-label`)} <span>{String(items.length).padStart(2, "0")}</span></h3><div>{items.map(item => <details className={styles.record} id={`gear-${item.id}`} key={item.id}>
            <summary><span><small>{item.brand}</small><strong>{item.model}</strong></span><span>{copy(`rig-${item.placement}-location`)}</span><b aria-hidden="true">+</b></summary>
            <div className={styles.recordBody}>{item.legacyIds?.map(id => <span id={`gear-${id}`} key={id} aria-hidden="true" />)}<p>{copy(item.noteKey)}</p><dl><dt>{copy("rig-status-label")}</dt><dd>{copy(`rig-${item.status}-label`)}</dd><dt>{copy("rig-source-label")}</dt><dd>{copy(`rig-${item.provenance}-label`)}</dd>{item.loop ? <><dt>{copy("rig-loop-label")}</dt><dd>{item.loop}</dd></> : null}{!item.modelConfirmed ? <><dt>{copy("rig-model-label")}</dt><dd>{item.catalogQuery}</dd></> : null}</dl>{item.catalogUrl ? <a href={item.catalogUrl} rel="noreferrer">{copy("rig-catalog-label")} ↗</a> : null}</div>
          </details>)}</div></div> : null;
        })}
      </section>

      <section className={styles.notes} aria-labelledby="choices-title"><div><p className={styles.eyebrow}>04 / BUILD LOG</p><h2 id="choices-title">{copy("rig-build-title")}</h2></div><ol>{[1,2,3].map(n => <li key={n}>{copy(`rig-choice-${n}-body`)}</li>)}</ol><div><h3>{copy("rig-power-title")}</h3><p>{copy("rig-power-body")}</p></div></section>
      <footer className={styles.footer}><div><h2>{copy("rig-equipboard-title")}</h2><p>{copy("rig-equipboard-body")}</p><p className={styles.fine}>{copy("rig-source-note")}</p><p className={styles.fine}>{copy("rig-private-body")}</p></div><div className={styles.downloads}>
        <a href="/data/gear.v1.json" download>{copy("rig-json-label")} ↓</a>
        <a href="/data/equipboard-checklist.tsv" download>{copy("rig-checklist-label")} ↓</a>
        <a href="/data/equipboard-catalog-requests.md" download>{copy("rig-catalog-requests-label")} ↓</a>
        {manifest.profile.equipboardProfileUrl ? <a href={manifest.profile.equipboardProfileUrl} rel="noreferrer">{copy("rig-equipboard-link")} ↗</a> : null}
      </div></footer>
    </main>
  );
}
