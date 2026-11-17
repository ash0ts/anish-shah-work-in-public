import Link from "next/link";
import { SITE_COPY } from "@/lib/copy";
import { rigHref, sceneGuitars, sceneModes, sceneRoute, type RigSceneState, type RigView } from "@/lib/rig-scene";
import type { GearManifest } from "@/types/gear";
import { Guitar, Headphones, KoAmp, MiniBoard, Op1Field, OrangeAmp, KoPedal } from "./RigIllustrations";
import styles from "./RigScene.module.css";

function copy(key: string) {
  if (!(key in SITE_COPY.play)) throw new Error(`Unknown scene copy: ${key}`);
  return SITE_COPY.play[key as keyof typeof SITE_COPY.play];
}

type Props = { manifest: GearManifest; state: RigSceneState; view: RigView; active: Set<number> };

export function RigArtwork({ manifest, state, view, active }: Props) {
  const tape = state.scene !== "home";
  const portable = state.scene === "portable";
  const control = tape && view.bank === 2;
  const guitarJack = state.guitar === "fgn" ? "146 386" : "300 406";
  const guitarNames = Object.fromEntries(manifest.items.filter(i=>i.kind==='guitar').map(i=>[i.id,`${i.brand} ${i.model}`]));
  return <svg className={styles.art} viewBox="0 0 1200 680" fontFamily="Arial, sans-serif" role="group" aria-labelledby="rig-art-title rig-art-desc" data-scene={state.scene} data-guitar={state.guitar}>
    <title id="rig-art-title">{copy("rig-scene-title")}</title><desc id="rig-art-desc">{copy("rig-scene-alt")}</desc>
    <defs>
      <pattern id="rig-weave" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 0h5M0 0v5" fill="none" stroke="#655e45" strokeWidth="1" opacity=".5" /></pattern>
      <pattern id="rig-grille" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#a6af99" opacity=".55"/></pattern>
      <pattern id="rig-rug" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M0 0h16M0 8h16" stroke="#8e775c" strokeWidth=".7" opacity=".28" /></pattern>
    </defs>
    <rect width="1200" height="680" fill="#efefe6" />
    <path d="M0 366H1200V680H0Z" fill="#e3e4d6"/>
    <path d="M0 355h1200v11H0Z" fill="#d1d5c5"/>
    <path d="M0 356h1200" stroke="#9ea894" opacity=".65"/>
    <path d="M27 0h265v354H27Z" fill="#f8f6eb" opacity=".55"/>
    <path d="M27 366 292 366 645 680 122 680Z" fill="#f7f3df" opacity=".32"/>
    <path d="M386 409 822 430 854 631 280 617Z" fill="#b9ae8a" stroke="#a99d7c"/>
    <path d="M386 409 822 430 854 631 280 617Z" fill="url(#rig-rug)"/>
    <path d="M397 424 807 444 834 615 302 602Z" fill="none" stroke="#ddd2af" strokeWidth="3"/>
    {Array.from({length:33},(_,i)=><path key={i} d={`M${282+i*17} ${619+i*.43}l-3 9`} stroke="#a99c7c" strokeWidth="2"/>)}
    <ellipse cx="786" cy="564" rx="307" ry="19" fill="#687760" opacity=".1" />
    <path d="M477 317 463 546m613-229 23 244M490 315l38 214m518-214-18 228" stroke="#788571" strokeWidth="8" strokeLinecap="round"/>
    <path d="M440 300 480 281h642l22 19Z" fill="#bec6b0" stroke="#9da88f"/>
    <path d="M440 300h704v15H440Z" fill="#87977e" stroke="#6a7c64"/>
    <path d="M455 308h673" stroke="#b1bea3"/>
    <path d="M513 121h275" stroke="#95a18c" strokeWidth="1"/>
    <text x="513" y="105" fill="#52614d" fontSize="11" letterSpacing="2">OP–1 / EP–35</text>
    <text x="45" y="31" fill="#687361" fontSize="10" letterSpacing="2">01 / 02</text>
    <text x="1090" y="651" fill="#687361" fontSize="10" letterSpacing="2">SA550XDM</text>

    <g className={styles.cables} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={`M${guitarJack} C190 527 281 527 346 485 S358 432 397 432`} stroke="#f4f1e4" strokeWidth="9"/>
      <path data-cable="guitar-board" d={`M${guitarJack} C190 527 281 527 346 485 S358 432 397 432`} stroke="#a24a2a" strokeWidth="4"/>
      {tape ? <><path d="M771 446C824 447 824 344 812 329S462 340 463 245Q463 195 500 195" stroke="#f4f1e4" strokeWidth="9"/><path data-cable="opus-op1" d="M771 446C824 447 824 344 812 329S462 340 463 245Q463 195 500 195" stroke="#a24a2a" strokeWidth="4"/></> : null}
      {tape && !portable ? <path data-cable="op1-phones" d="M792 195C831 195 794 228 817 276" stroke="#a24a2a" strokeWidth="4"/> : null}
      {portable ? <path data-cable="op1-ep35" d="M792 195C848 170 865 213 907 213S941 187 965 178" stroke="#a24a2a" strokeWidth="4"/> : null}
      {control ? <path data-cable="g3-op1-control" d="M743 442C797 431 781 356 754 355H469Q441 355 441 304V230Q441 178 493 178" stroke="#4b7586" strokeWidth="2.5" strokeDasharray="7 7"/> : null}
      {portable ? <path data-cable="ep127-control" d="M911 591Q1173 574 1115 312" stroke="#4b7586" strokeWidth="2.5" strokeDasharray="3 8" /> : null}
    </g>

    <g transform="translate(66 45) scale(.82)">
      {state.guitar==='fgn' ? <ellipse cx="70" cy="472" rx="68" ry="17" fill="none" stroke="#a24a2a" strokeWidth="2"/> : null}
      <a href={rigHref(view,state,{guitar:'fgn'})} aria-label={copy("rig-scene-fgn-label")} aria-current={state.guitar==='fgn'?'true':undefined} className={styles.object}><title>{guitarNames[sceneGuitars.fgn]}</title><Guitar/></a>
    </g>
    <g transform="translate(220 65) scale(.82)">
      {state.guitar==='duo' ? <ellipse cx="70" cy="472" rx="68" ry="17" fill="none" stroke="#a24a2a" strokeWidth="2"/> : null}
      <a href={rigHref(view,state,{guitar:'duo'})} aria-label={copy("rig-scene-duo-label")} aria-current={state.guitar==='duo'?'true':undefined} className={styles.object}><title>{guitarNames[sceneGuitars.duo]}</title><Guitar duo/></a>
    </g>
    <text x="108" y="466" textAnchor="middle" fill="#303d33" fontSize="13" fontWeight="700">FGN</text>
    <text x="108" y="483" textAnchor="middle" fill="#63705d" fontSize="10">FLUENCE MODERN</text>
    <text x="276" y="486" textAnchor="middle" fill="#303d33" fontSize="13" fontWeight="700">DUO–SONIC</text>
    <text x="276" y="503" textAnchor="middle" fill="#63705d" fontSize="10">FENDER</text>

    <a href="#gear-op1-field" className={styles.object} aria-label={`OP-1 field · ${copy("rig-scene-inventory-label")}`}><g transform="translate(500 180)"><Op1Field/></g></a>
    <a href="#gear-te-ep35" className={styles.object} aria-label={`EP-35 · ${copy("rig-scene-inventory-label")}`}><g transform="translate(950 132)"><KoAmp/></g></a>
    <g transform="translate(814 229) scale(.65)" opacity={tape&&!portable?1:.35}><Headphones/></g>
    <text x="948" y="339" fontSize="11" fill="#54614e">EP–35 / {copy("rig-optional-label")}</text>
    <a href="#gear-orange-crush-20rt" className={styles.object} aria-label={`Orange Crush 20RT · ${copy("rig-scene-inventory-label")}`}><g transform="translate(865 390)"><OrangeAmp/></g></a>
    <a href={rigHref(view,state,{},'workbench')} className={styles.object} aria-label={copy("rig-scene-board-body")}><g transform="translate(397 411) matrix(.68 .04 -.12 .39 0 0)"><MiniBoard manifest={manifest} active={active}/></g></a>
    <a href="#gear-te-ep127" className={styles.object} aria-label={`EP-127 · ${copy("rig-scene-inventory-label")}`}><g transform="translate(830 569)"><KoPedal/></g></a>
    <text x="884" y="645" textAnchor="middle" fill="#52614b" fontSize="10">EP–127</text>
    <text x="551" y="656" textAnchor="middle" fill="#52614b" fontSize="11" letterSpacing="1.4">G3S / SCHMIDT ARRAY</text>
    {!tape ? <g fill="none" strokeLinecap="round"><path d="M771 446C822 446 803 625 1030 625C1160 625 1140 490 1076 421" stroke="#f4f1e4" strokeWidth="9"/><path data-cable="board-orange" d="M771 446C822 446 803 625 1030 625C1160 625 1140 490 1076 421" stroke="#a24a2a" strokeWidth="4"/></g> : null}
    <g fill="#f7f3e6" stroke="#a24a2a" strokeWidth="2">
      <circle cx="397" cy="432" r="5"/><circle cx="771" cy="446" r="5"/>
      {portable?<circle cx="965" cy="178" r="4"/>:null}
      {tape?<><circle cx="500" cy="195" r="4"/><circle cx="792" cy="195" r="4"/></>:<circle cx="1076" cy="421" r="4"/>}
    </g>
    <g fill="#80361d" fontSize="11" fontWeight="700"><text x="382" y="421">A</text><text x="779" y="435">{tape?'G':'B'}</text></g>
  </svg>;
}

export function RigScene({ manifest, state, view, active }: Props) {
  const items = new Map(manifest.items.map(i=>[i.id,i]));
  const route = sceneRoute(state);
  const devices = ["fgn-dark-odyssey","fender-duo-sonic","orange-crush-20rt","op1-field","te-ep35","te-ep127"];
  const label = (id:string) => id==='headphones' ? copy('rig-scene-headphones-label') : items.get(id)?.model ?? id;
  return <section className={styles.scene} id="music-corner" aria-labelledby="music-corner-title" data-music-corner>
    <header className={styles.heading}><div><p className={styles.eyebrow}>00 / COLLECTION</p><h2 id="music-corner-title">{copy('rig-scene-title')}</h2></div><p>{copy('rig-scene-body')}</p></header>
    <div className={styles.console}>
      <nav aria-label={copy('rig-scene-label')} className={styles.tabs}>{sceneModes.map((scene,i)=><Link key={scene} href={rigHref(view,state,{scene})} scroll={false} prefetch={false} aria-current={state.scene===scene?'true':undefined}><span>0{i+1}</span>{copy(`rig-scene-${scene}-label`)}</Link>)}</nav>
      <nav aria-label={copy('rig-scene-guitar-label')} className={styles.guitars}>{(['fgn','duo'] as const).map(guitar=><Link key={guitar} href={rigHref(view,state,{guitar})} scroll={false} prefetch={false} aria-current={state.guitar===guitar?'true':undefined}><i aria-hidden="true"/>{copy(`rig-scene-${guitar}-label`)}</Link>)}</nav>
    </div>
    <RigArtwork manifest={manifest} state={state} view={view} active={active}/>
    <div className={styles.readout} aria-live="off">
      <div className={styles.routeStory}><p className={styles.eyebrow}>{copy('rig-scene-signal-label')} / 0{sceneModes.indexOf(state.scene)+1}</p><h3>{copy(`rig-scene-${state.scene}-title`)}</h3><p>{copy(`rig-scene-${state.scene}-body`)}</p></div>
      <ol className={styles.route} aria-label={copy('rig-scene-signal-label')}>{route.map(edge=><li key={edge.id} data-route={edge.id}><span className={styles.routeNumber}>{String(route.indexOf(edge)+1).padStart(2,'0')}</span><div><strong>{label(edge.from)}<b aria-hidden="true"> → </b>{label(edge.to)}</strong><small>{edge.fromPort} → {edge.toPort}{edge.internal?` · ${copy('rig-scene-internal-label')}`:''}</small></div></li>)}</ol>
    </div>
    <div className={styles.controlNote}><span className={styles.controlMark} aria-hidden="true"/><p>{view.bank===2?copy(state.scene!=='home'?'rig-scene-control-body':'rig-scene-unused-control-body'):copy('rig-scene-guitar-bank-body')}{state.scene==='portable'?` ${copy('rig-scene-ep127-body')}`:''}</p></div>
    <nav aria-label={copy('rig-scene-details-label')} className={styles.deviceIndex}>{devices.map((id,i)=>{const item=items.get(id)!;return <a key={id} href={`#gear-${id}`}><span>{String(i+1).padStart(2,'0')}</span><strong>{item.model}</strong><small>{copy(`rig-${item.status}-label`)} ↗</small></a>;})}</nav>
    <p className={styles.caption}>{copy('rig-scene-caption')}</p>
  </section>;
}
