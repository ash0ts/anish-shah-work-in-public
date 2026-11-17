import { RIG_OBJECT_CONTRACT, type RigObjectId } from "../../../lib/rig-object-contract.ts";

type Vec3 = [number, number, number];
type Point = [number, number];
export type RigRoomMesh = { positions: number[]; colors: number[]; objects: { id: RigObjectId; firstVertex: number; vertexCount: number }[] };

/** Original, unlit low-poly shapes. Editorial proportions, not hardware CAD.
 * One merged mesh, one material, no textures, network reads or inventory preload.
 * Pure arrays also let tests measure the actual geometry without a WebGL context.
 */
export function buildRigRoomMesh(): RigRoomMesh {
  const positions: number[] = [], colors: number[] = [];
  const objects: RigRoomMesh["objects"] = [];
  let offset: Vec3 = [0, 0, 0];
  function triangle(a: Vec3, b: Vec3, c: Vec3, hex: number) {
    const u = b.map((v,i) => v-a[i]), v = c.map((n,i) => n-a[i]);
    const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const length = Math.hypot(...n);
    if (length < 1e-10) throw new Error("Degenerate rig face");
    const shade = .66 + .34 * Math.max(0, (n[0]*.3+n[1]*.8+n[2]*.5)/length);
    const rgb = [hex>>16&255, hex>>8&255, hex&255].map(channel => {
      const s = channel/255;
      return (s <= .04045 ? s/12.92 : ((s+.055)/1.055)**2.4) * shade;
    });
    for (const point of [a,b,c]) { positions.push(...point.map((n,i) => n+offset[i])); colors.push(...rgb); }
  }
  function box(x:number,y:number,z:number,w:number,h:number,d:number,color:number) {
    const p: Vec3[] = [[x-w/2,y-h/2,z-d/2],[x+w/2,y-h/2,z-d/2],[x+w/2,y+h/2,z-d/2],[x-w/2,y+h/2,z-d/2],
      [x-w/2,y-h/2,z+d/2],[x+w/2,y-h/2,z+d/2],[x+w/2,y+h/2,z+d/2],[x-w/2,y+h/2,z+d/2]];
    for (const [a,b,c,d] of [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]]) {
      triangle(p[a],p[b],p[c],color); triangle(p[a],p[c],p[d],color);
    }
  }
  function profile(points: Point[], z:number, depth:number, color:number) {
    // Ear clipping preserves the guitars' concave waists and cutaways.
    const area = points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p[0]*q[1]-q[0]*p[1];},0);
    const poly = area > 0 ? [...points] : [...points].reverse();
    const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const left=poly.map((_,i)=>i);
    while(left.length>2) {
      const ear=left.findIndex((b,i)=>{
        const a=left[(i+left.length-1)%left.length], c=left[(i+1)%left.length];
        return cross(poly[a],poly[b],poly[c])>1e-10 && !left.some(k=>k!==a&&k!==b&&k!==c&&
          cross(poly[a],poly[b],poly[k])>=0&&cross(poly[b],poly[c],poly[k])>=0&&cross(poly[c],poly[a],poly[k])>=0);
      });
      if(ear<0) throw new Error("Invalid rig silhouette");
      const a=poly[left[(ear+left.length-1)%left.length]],b=poly[left[ear]],c=poly[left[(ear+1)%left.length]];
      triangle([...a,z+depth/2],[...b,z+depth/2],[...c,z+depth/2],color);
      triangle([...c,z-depth/2],[...b,z-depth/2],[...a,z-depth/2],color);
      left.splice(ear,1);
    }
    for(let i=0;i<poly.length;i++) {
      const a=poly[i],b=poly[(i+1)%poly.length];
      triangle([...a,z-depth/2],[...b,z-depth/2],[...b,z+depth/2],color);
      triangle([...a,z-depth/2],[...b,z+depth/2],[...a,z+depth/2],color);
    }
  }
  function guitar(duo:boolean) {
    box(0,.04,0,.44,.07,.36,0x252b39); box(0,.48,-.06,.035,.9,.035,0x6e7888);
    profile([[-.04,.76],[-.12,.83],[-.15,.98],[-.23,.89],[-.20,.72],[-.16,.63],[-.24,.48],[-.27,.33],[-.20,.2],[-.08,.15],[.13,.17],[.24,.26],[.26,.40],[.17,.65],[.2,.81],[.14,.9],[.1,.74]],.02,.10,duo?0xcbb279:0x514269);
    if(duo) profile([[-.09,.72],[-.16,.64],[-.12,.55],[-.17,.38],[-.06,.27],[.08,.30],[.1,.45],[.04,.69]],.077,.012,0xe7dfc5);
    box(0,1.14,.025,.08,.85,.05,duo?0xbb925a:0x8e7858);
    box(0,1.13,.058,.065,.82,.012,duo?0xa98757:0x302b32);
    for(let i=0;i<12;i++) box(0,.79+i*.055,.067,.07,.005,.006,0xbcc4cb);
    profile([[-.04,1.54],[-.035,1.83],[.08,1.88],[.07,1.55]],.027,.055,duo?0xc7a16a:0x514269);
    for(let i=0;i<6;i++) {box(.09,1.59+i*.045,.03,.035,.02,.02,0xbfc5c9);box(-.023+i*.009,.97,.086,.002,1.15,.003,0xb8b5af);}
    for(const y of [.51,.65]) box(0,y,.087,.13,duo?.023:.06,.02,duo?0xe9e3d5:0x1f2430);
    box(0,.41,.087,.15,.035,.027,0xbac2c6);box(.15,.36,.085,.035,.035,.02,0xe1d4a9);
  }
  function amp(ep:boolean) {
    const w=ep?.35:.62,h=ep?.43:.58,d=ep?.23:.30;
    box(0,h/2,0,w,h,d,ep?0x8f9d88:0xc76b34);
    box(0,h*.43,d/2+.006,w*.85,h*.65,.014,ep?0x414d43:0x9b8966);
    for(let i=0;i<9;i++)box(-w*.39+i*w*.098,h*.43,d/2+.017,.008,h*.60,.004,ep?0x748473:0x5d5647);
    box(0,h*.85,d/2+.008,w*.88,h*.15,.018,0xd9cfb2);
    for(let i=0;i<4;i++)box(-w*.3+i*w*.2,h*.85,d/2+.026,.027,.027,.022,0x2a3039);
    box(-w*.18,h+.04,0,.025,.08,.03,0x303641);box(w*.18,h+.04,0,.025,.08,.03,0x303641);box(0,h+.08,0,w*.39,.025,.03,0x303641);
    box(0,h*.63,d/2+.023,w*.30,.06,.012,0xe5dcc3);
  }
  const builders: Record<RigObjectId, () => void> = {
    fgn: () => {offset=[-1.0,0,-.25];guitar(false);},
    duo: () => {offset=[-.45,0,-.20];guitar(true);},
    orange: () => {offset=[1.0,0,0];amp(false);},
    ep35: () => {offset=[.9,.71,-.23];amp(true);},
    board: () => {
      offset=[0,0,0];box(-.22,.10,.32,1.20,.16,.43,0x464d5f);box(-.22,.19,.32,1.15,.025,.40,0xaab0b1);
      for(let i=0;i<6;i++) {box(-.69+i*.18,.245,.22,.14,.085,.15,[0x674563,0xb69060,0x40756d,0x375376,0x924c40,0x47465e][i]);box(-.69+i*.18,.294,.22,.025,.012,.025,0xe8dab5);}
      box(-.22,.23,.43,1.06,.07,.13,0x292d3b);
      for(let i=0;i<7;i++)box(-.68+i*.15,.272,.44,.025,.013,.025,0xd4cebc);
      box(-.35,.271,.41,.16,.008,.04,0x86bdbb);
    },
    op1: () => {
      offset=[.35,0,-.23];box(.2,.7,0,1.2,.055,.34,0x76654f);
      for(const x of [-.3,.7])box(x,.35,0,.04,.7,.22,0x303a46);
      box(-.04,.75,0,.62,.045,.24,0xdadcd6);box(-.25,.778,-.055,.13,.008,.08,0x28424e);
      for(let i=0;i<14;i++)box(-.32+i*.041,.778,.04,.035,.012,.11,0xf1e8d1);
      for(let i=0;i<4;i++)box(-.12+i*.065,.792,-.06,.035,.025,.035,[0x81aab9,0x72a48b,0xd6b45d,0xca7d65][i]);
    },
    ep127: () => {
      offset=[.68,0,.42];box(0,.045,0,.33,.075,.15,0x95a38e);
      for(const x of [-.1,.1])box(x,.088,0,.09,.018,.11,0x343d37);
      box(0,.09,-.015,.05,.014,.04,0x27464b);
    },
  };
  for(const object of RIG_OBJECT_CONTRACT) {
    const start=positions.length/3;builders[object.id]();
    objects.push({id:object.id,firstVertex:start,vertexCount:positions.length/3-start});
  }
  return {positions,colors,objects};
}
