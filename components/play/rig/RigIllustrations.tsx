import { rigShapes } from "@/lib/rig-artwork";
import type { GearManifest } from "@/types/gear";

/** Hand-drawn SVG silhouettes: an editorial scene, not product CAD. */
export function Guitar({ duo = false }: { duo?: boolean }) {
  return <g strokeLinejoin="round">
    <ellipse cx="70" cy="472" rx="59" ry="12" fill="#242b29" opacity=".12" />
    <path d="M70 246v206m-1-28-46 41m48-41 48 41" fill="none" stroke="#414842" strokeWidth="7" strokeLinecap="round" />
    <path d={duo
      ? rigShapes.duoBody
      : rigShapes.fgnBody}
      fill={duo ? "#c7af79" : "#343b3b"} stroke={duo ? "#9d8656" : "#181e20"} strokeWidth="3" />
    <path d={duo ? rigShapes.duoPickguard : "M27 291c-10 44-20 72 3 109"}
      fill={duo ? "#eee9d7" : "none"} stroke={duo ? "#958c70" : "#5b6360"} strokeWidth="2" />
    <path d="M58 42h22l-3 286H59Z" fill={duo ? "#b89566" : "#684f3d"} stroke="#544d40" strokeWidth="2" />
    <path d={duo ? "M57 43 53 13Q52 1 61 2l19 6 14 31-16 13Z" : "M57 45 53 10 83 0l-5 50Z"} fill={duo ? "#c8ac7e" : "#252b2d"} stroke="#655d4a" strokeWidth="2" />
    {[12,23,34].map(y => <g key={y}><rect x="47" y={y} width="8" height="6" rx="2" fill="#a7aba8"/><rect x="82" y={y + 5} width="8" height="6" rx="2" fill="#a7aba8"/></g>)}
    {Array.from({ length: 21 }, (_, i) => <path key={i} d={`M58 ${66 + i * 12}h20`} stroke={duo ? "#e4d0a6" : "#b7aba0"} strokeWidth="1.3" />)}
    {[90,114,138,174,210,246,282].map(y => <circle key={y} cx="69" cy={y} r="2" fill={duo ? "#5e4c38" : "#dad5bc"} />)}
    {[317,357].map(y => <rect key={y} x="49" y={y} width="40" height={duo ? 12 : 23} rx="3" fill={duo ? "#dedbcc" : "#181d1e"} stroke={duo ? "#9f9c8f" : "#777e7b"} />)}
    <rect x="47" y="390" width="44" height="14" rx="2" fill="#a8afaa" stroke="#424b47" />
    {Array.from({length:6},(_,i) => <path key={i} d={`M${60+i*3.2} 29V401`} stroke="#dad9c7" strokeWidth=".65" opacity=".85" />)}
    <circle cx="110" cy="363" r="7" fill={duo ? "#b0b6b1" : "#727b73"} stroke="#252b29" />
    <circle cx="111" cy="391" r="6" fill={duo ? "#b0b6b1" : "#727b73"} stroke="#252b29" />
    <circle cx="98" cy="416" r="4" fill="#151c1b" stroke="#b6b9a7" strokeWidth="2" />
  </g>;
}

export function OrangeAmp() {
  return <g strokeLinejoin="round">
    <ellipse cx="130" cy="207" rx="136" ry="15" fill="#28302c" opacity=".13" />
    <path d="M12 6 30-12h223L236 6Z" fill="#dc792e" stroke="#9f4b1c" />
    <path d="M236 6 253-12v190l-17 19Z" fill="#b25b29" stroke="#8a4823" />
    <rect x="10" y="4" width="226" height="193" rx="9" fill="#dc742e" stroke="#974c26" strokeWidth="2" />
    <path d="M97-10v-8q0-5 5-5h58q5 0 5 5v8" fill="none" stroke="#3c3931" strokeWidth="8" />
    <rect x="23" y="19" width="200" height="25" rx="2" fill="#eee4bf" stroke="#783c24" />
    {[45,65,85,105,125,145,165,185].map(x=><g key={x}><circle cx={x} cy="31" r="5" fill="#3c4036"/><path d={`M${x} 28v3`} stroke="#f0e7d0"/></g>)}
    <circle cx="211" cy="31" r="4" fill="#202b25" />
    <rect x="25" y="53" width="195" height="128" rx="4" fill="#ada07a" stroke="#563f28" strokeWidth="4" />
    <rect x="28" y="56" width="189" height="122" rx="2" fill="url(#rig-weave)" />
    <rect x="89" y="66" width="67" height="20" rx="2" fill="#eee5c6" stroke="#635843" />
    <text x="122" y="81" textAnchor="middle" fill="#332e22" fontSize="12" fontWeight="800">ORANGE</text>
    <rect x="34" y="194" width="24" height="8" rx="3" fill="#343a31"/><rect x="189" y="194" width="24" height="8" rx="3" fill="#343a31"/>
    {[18,229].map(x=>[12,187].map(y=><circle key={`${x}-${y}`} cx={x} cy={y} r="3" fill="#a9a58a"/>))}
  </g>;
}

export function Op1Field() {
  return <g strokeLinejoin="round">
    <path d="M0 7h292v110q0 5-7 5H6q-6 0-6-5Z" fill="#9da29b" stroke="#626d64" />
    <rect width="292" height="115" rx="6" fill="#e2e3da" stroke="#77827a" strokeWidth="1.5" />
    <rect x="10" y="10" width="62" height="44" rx="2" fill="#293b39" />
    <circle cx="28" cy="30" r="10" fill="none" stroke="#75aca9"/><circle cx="54" cy="30" r="10" fill="none" stroke="#75aca9"/>
    <path d="M22 41h39M28 25v10m-5-5h10m21-5v10m-5-5h10" stroke="#b7cec4" strokeWidth="1.5" />
    {["#799eb1","#659b77","#d0ae52","#c87964"].map((color,i)=><g key={color}><circle cx={93+i*27} cy="28" r="10" fill={color} stroke="#5f6e63"/><path d={`M${93+i*27} 20v5`} stroke="#f5f2e3" strokeWidth="2"/></g>)}
    {Array.from({length:5},(_,i)=><path key={i} d={`M218 ${15+i*6}h52`} stroke="#919a92" strokeWidth="2" />)}
    {Array.from({length:14},(_,i)=><g key={i}><rect x={11+i*19.3} y="64" width="17.2" height="42" rx="2" fill="#f6f4e8" stroke="#9da59a" strokeWidth=".7" />{![2,6,9,13].includes(i)&&<rect x={24+i*19.3} y="64" width="9" height="23" rx="2" fill="#4d5953" />}</g>)}
    {Array.from({length:8},(_,i)=><circle key={i} cx={84+i*17} cy="50" r="3" fill="#c0c6b9" stroke="#9ba795" />)}
  </g>;
}

export function KoAmp() {
  return <g strokeLinejoin="round">
    <path d="M12 24 35 5h114l-20 19Z" fill="#d6d6ca" stroke="#8a9182" />
    <path d="M129 24 149 5v132l-20 24Z" fill="#929e8c" stroke="#76816d" />
    <rect x="9" y="23" width="122" height="141" rx="12" fill="#bdc4b4" stroke="#6e7a68" strokeWidth="2" />
    <path d="M42 17V2q0-8 9-8h51q9 0 9 8v13" fill="none" stroke="#3f493e" strokeWidth="9" />
    <rect x="22" y="36" width="95" height="25" rx="3" fill="#e5e4d5" />
    {[36,57,78].map(x=><circle key={x} cx={x} cy="48" r="6" fill="#3a443b"/>)}
    <circle cx="101" cy="48" r="7" fill="#e6763d" />
    <rect x="23" y="73" width="94" height="76" rx="4" fill="#4b5648" />
    <rect x="23" y="73" width="94" height="76" rx="4" fill="url(#rig-grille)" />
    <rect x="81" y="127" width="28" height="14" rx="2" fill="#bec7b3" />
    <text x="95" y="137" fill="#293b2b" textAnchor="middle" fontSize="8" fontWeight="700">EP–35</text>
  </g>;
}

export function Headphones() {
  return <g fill="none" stroke="#363f38" strokeWidth="7" strokeLinecap="round">
    <path d="M5 54V33a31 31 0 0 1 62 0v21" />
    <path d="M12 47V32a24 24 0 0 1 48 0v15" strokeWidth="2" />
    <rect x="0" y="42" width="16" height="31" rx="7" fill="#39443e"/>
    <rect x="57" y="42" width="16" height="31" rx="7" fill="#39443e"/>
  </g>;
}

export function MiniBoard({ manifest, active }: { manifest: GearManifest; active: Set<number> }) {
  return <g strokeLinejoin="round">
    <rect y="10" width="550" height="460" rx="14" fill="#7e887b" stroke="#2e3b33" strokeWidth="4" />
    <rect width="550" height="460" rx="14" fill="#d0d2c3" stroke="#47544a" strokeWidth="4" />
    {[40,150,260].map(y=><rect key={y} x="15" y={y} width="520" height="55" fill="#737d70" rx="2"/>)}
    {manifest.items.filter(i=>i.footprint && (i.placement==='upper'||i.placement==='both')).map(item=>{
      const f=item.footprint!;
      const w=f.rotation===90?f.h:f.w,h=f.rotation===90?f.w:f.h;
      const on=Boolean(item.loop && active.has(item.loop));
      return <g key={item.id} transform={`translate(${f.x} ${f.y})`} data-scene-pedal={item.id} data-active={on}>
        <rect width={w} height={h} rx="4" fill={f.color} stroke={on?'#e8ac56':'#424c44'} strokeWidth={on?4:2}/>
        {Array.from({length:f.knobs},(_,i)=><circle key={i} cx={10+(i%3)*((w-20)/2)} cy={13+Math.floor(i/3)*18} r="5" fill="#dcdfcf" stroke="#525d53"/>)}
        {item.loop ? <><circle cx={w/2} cy={h-15} r="5" fill="#cad0c2"/><circle cx={w/2} cy={h-28} r="3" fill={on?'#f4bc60':'#626b5c'}/></> : null}
        {item.id==='gigrig-g3s' ? <><text x="15" y="38" fill="#eff1e3" fontSize="24" fontWeight="800">G3S</text><rect x="85" y="22" width="68" height="30" fill="#6a9693"/>{Array.from({length:14},(_,i)=><circle key={i} cx={21+(i%7)*(w-42)/6} cy={i<7?14:h-15} r="5" fill="#e2e3cd" />)}</> : null}
        {item.id==='lehle-dual-expression' ? <rect x="8" y="12" width={w-16} height={h-24} rx="15" fill="#b68359"/> : null}
      </g>;
    })}
    <path d="M225 462v12h100v-12" fill="none" stroke="#52604f" strokeWidth="7"/>
  </g>;
}

export function KoPedal() {
  return <g strokeLinejoin="round">
    <path d="M0 8h119v42H0Z" fill="#5a6658"/>
    <rect width="119" height="45" rx="4" fill="#c4c9bb" stroke="#667360" strokeWidth="1.5"/>
    <rect x="8" y="7" width="35" height="31" rx="2" fill="#4c594e"/>
    <rect x="76" y="7" width="35" height="31" rx="2" fill="#4c594e"/>
    <rect x="48" y="7" width="23" height="13" rx="1" fill="#2b3a30"/>
    <text x="59" y="17" textAnchor="middle" fontSize="7" fill="#b3d5b3">127</text>
    <circle cx="60" cy="31" r="5" fill="#db794c"/>
  </g>;
}
