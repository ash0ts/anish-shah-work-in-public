import Link from "next/link";
import type { CSSProperties } from "react";
import { SITE_COPY } from "@/lib/copy";
import { loopItems, selectRigView } from "@/lib/gear-model";
import type { GearItem, GearManifest, RigPrograms, GearStatus } from "@/types/gear";
import { RigScene } from "./RigScene";
import { rigHref, type RigSceneState } from "@/lib/rig-scene";
import styles from "./RigScreen.module.css";
import { ScreenNavigation } from "../room-screens/ScreenNavigation";
import { MatchCutSurface } from "../room-screens/MatchCutSurface";
import { ROOM_OBJECT_BY_ID } from "../room-platform/room-registry";

type View = ReturnType<typeof selectRigView>;
function copy(key: string) {
  if (!(key in SITE_COPY.play)) throw new Error(`Unknown rig copy: ${key}`);
  return SITE_COPY.play[key as keyof typeof SITE_COPY.play];
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
    <Link replace prefetch={false} href={`#gear-${item.id}`} className={styles.pedal} style={style} data-active={active} data-utility={utility}
      data-planned={item.status === "planned"} data-device={item.id}
      aria-label={`${item.brand} ${item.model} · ${copy(`rig-${item.status}-label`)}${item.loop ? ` · ${copy("rig-loop-label")} ${item.loop} · ${copy(active ? "rig-active-label" : "rig-bypassed-label")}` : ""}`}>
      <span className={styles.knobs} aria-hidden="true">{Array.from({ length: f.knobs }, (_, n) => <i key={n} />)}</span>
      <strong>{item.model}</strong>
      <small>{item.brand}</small>
      {item.loop ? <span className={styles.loop}>{String(item.loop).padStart(2, "0")}</span> : null}
      <span className={styles.stomps} aria-hidden="true">{Array.from({ length: f.switches || (item.id === "gigrig-g3s" ? 14 : 0) }, (_, n) => <i key={n} />)}</span>
    </Link>
  );
}

export function RigScreen({ manifest, programs, view, scene }: { manifest: GearManifest; programs: RigPrograms; view: View; scene: RigSceneState }) {
  const href = (v: View, change: Partial<View> = {}) => rigHref(v, scene, change, "workbench");
  const preset = programs.presets[view.preset - 1];
  const active = new Set(preset.loops);
  const pedals = manifest.items.filter(item => item.footprint && (item.placement === view.deck || item.placement === "both"));
  const statuses: GearStatus[] = ["owned", "incoming", "planned", "optional"];
  return (
    <main className={styles.page} data-gear-rig data-room-screen data-object="rig" id="main" tabIndex={-1}>
      <ScreenNavigation object={ROOM_OBJECT_BY_ID.rig} />
      <header className={styles.header}>
        <p className={styles.eyebrow}>{copy("rig-screen-eyebrow")}</p>
        <div><p className={styles.eyebrow}>{copy("rig-plan-label")}</p><h1>{copy("rig-screen-title")}</h1><p>{copy("rig-plan-body")}</p></div>

      </header>

      <MatchCutSurface objectId="rig" surface={ROOM_OBJECT_BY_ID.rig.matchCutSurface} className={styles.sceneSurface}>
        <RigScene manifest={manifest} state={scene} view={view} active={active} />
      </MatchCutSurface>

      <section className={styles.workbench} id="workbench" aria-labelledby="board-title">
        <header className={styles.sectionHeader}><div><p className={styles.eyebrow}>01 / SA550XDM</p><h2 id="board-title">{copy("rig-board-title")}</h2></div><p>{copy("rig-board-body")}</p></header>
        <nav className={styles.segment} aria-label={copy("rig-bank-label")}>
          {[1, 2].map(bank => <Link replace key={bank} href={href(view, { bank, preset: Math.min(view.preset, bank === 2 ? 7 : 14) })} scroll={false} prefetch={false} aria-current={view.bank === bank ? "true" : undefined}>{copy(`rig-bank-${bank}-label`)}</Link>)}
        </nav>
        <p className={styles.bankNote}>{copy(`rig-bank-${view.bank}-body`)}</p>
        <nav aria-label={copy("rig-presets-label")} className={styles.presets}>
          {programs.presets.slice(0, view.bank === 2 ? 7 : 14).map(p => <Link replace href={href(view, { preset: p.slot })} scroll={false} prefetch={false} key={p.slot} aria-current={view.preset === p.slot ? "true" : undefined}><span>{String(p.slot).padStart(2, "0")}</span>{copy(p.labelKey)}</Link>)}
        </nav>
        {view.bank === 2 ? <div className={styles.commands}><h3>{copy("rig-command-label")}</h3><ol start={8}>{programs.op1Commands.map(c => <li key={c.slot}><span>{c.slot}</span><strong>{copy(c.labelKey)}</strong><small>CC {c.cc}</small></li>)}</ol><p>{copy("rig-command-body")}</p><p>{copy("rig-bank-change-body")}</p></div> : null}
        <div className={styles.deckBar}>
          <nav className={styles.segment} aria-label={copy("rig-deck-label")}>
            {(["upper", "lower"] as const).map(deck => <Link replace key={deck} href={href(view, { deck })} scroll={false} prefetch={false} aria-current={view.deck === deck ? "true" : undefined}>{copy(`rig-${deck}-label`)}</Link>)}
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
        <ol className={styles.chain}>{loopItems(manifest.items).map(item => <li key={item.id} data-active={active.has(item.loop!)} data-gate={item.loop === 8}><Link replace prefetch={false} href={`#gear-${item.id}`}><span>{copy("rig-loop-label")} {item.loop}</span><strong>{item.model}</strong><small>{copy(active.has(item.loop!) ? "rig-active-label" : "rig-bypassed-label")}</small></Link></li>)}</ol>
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
            {item.legacyIds?.map(id => <span id={`gear-${id}`} key={id} aria-hidden="true" />)}<div className={styles.recordBody}><p>{copy(item.noteKey)}</p><dl><dt>{copy("rig-status-label")}</dt><dd>{copy(`rig-${item.status}-label`)}</dd><dt>{copy("rig-source-label")}</dt><dd>{copy(`rig-${item.provenance}-label`)}</dd>{item.loop ? <><dt>{copy("rig-loop-label")}</dt><dd>{item.loop}</dd></> : null}{!item.modelConfirmed ? <><dt>{copy("rig-model-label")}</dt><dd>{item.catalogQuery}</dd></> : null}</dl>{item.catalogUrl ? <a href={item.catalogUrl} rel="noreferrer">{copy("rig-catalog-label")} ↗</a> : null}</div>
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
