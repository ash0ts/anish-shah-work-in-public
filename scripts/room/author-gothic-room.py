"""Original, deterministic PS2-era diorama; Blender 5.2.3 LTS only.

Run from the repository root with Blender --background --factory-startup
--python scripts/room/author-gothic-room.py. Geometry, UVs, coarse material
patches and light pools are authored here; no downloaded art or provider data.
Coordinates below use the runtime's Y-up convention. The exported GLB and
editable .blend are build inputs, never runtime authoring dependencies.
"""
import bpy
import hashlib
import json
import math
import random
from pathlib import Path
from mathutils import Vector, Matrix

if bpy.app.version != (5, 2, 3):
    raise RuntimeError("Use pinned Blender 5.2.3 LTS for room authoring")

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets/room/gothic-hardware"
OUT.mkdir(parents=True, exist_ok=True)
LAYOUT = json.loads((ROOT / "scripts/room/gothic-layout.json").read_text())
random.seed(2081)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

# One 512-square, opaque, original material atlas. A 4x4 grid of deliberately
# coarse painted patches: plaster, timber, metal, paper, fabric, screen, etc.
# Algorithmic material authoring is deterministic, not imported image editing.
COLORS = [
    (112, 111, 111), (74, 55, 51), (43, 51, 57), (211, 193, 155),
    (72, 62, 78), (19, 37, 48), (50, 85, 123), (134, 112, 80),
    (28, 32, 42), (124, 66, 69), (61, 89, 86), (151, 139, 122),
    (192, 133, 77), (93, 186, 197), (64, 74, 102), (224, 211, 179),
]
atlas = bpy.data.images.new("Original worn-material atlas", width=512, height=512, alpha=False)
pixels = []
for y in range(512):
    for x in range(512):
        tile = (y // 128) * 4 + x // 128
        u, v = x % 128, y % 128
        # Quantized grain retains a low-resolution, illustrated material feel.
        noise = ((u // 2 * 137 + v // 2 * 79 + tile * 71) % 31 - 15) / 900
        shade = 1 + noise
        if tile == 1:  # worn wood, not a uniform brown rectangle
            shade += .07 * math.sin(u * .7 + math.sin(v * .06) * 2)
            if (u + int(math.sin(v * .045) * 6)) % 31 < 2:
                shade -= .13
        elif tile == 3:  # paper edges
            shade -= .1 if v % 7 == 0 else 0
        elif tile == 4:  # threadbare cloth
            shade += (.04 if (u // 3 + v // 3) % 2 else -.04)
        elif tile == 5:  # quiet phosphor; no fabricated UI or live data
            shade -= .12 if v % 4 == 0 else 0
            shade += .2 * max(0, 1 - ((u - 64)**2 + (v - 64)**2) / 7000)
        elif tile in (2, 6, 7, 11):
            shade += .04 * math.sin(v * .8)
            if ((u * 7 + v * 13) % 401) < 2:
                shade += .17
        # Wear is restrained to patch edges; no per-frame noise.
        if min(u, v, 127-u, 127-v) < 3 and tile not in (5, 8, 13):
            shade *= .84
        pixels.extend([min(1, c / 255 * shade) for c in COLORS[tile]] + [1])
atlas.pixels.foreach_set(pixels)
atlas.filepath_raw = str(OUT / "material-atlas.png")
atlas.file_format = "PNG"
atlas.save()
atlas.pack()
atlas.filepath = "//material-atlas.png"

material = bpy.data.materials.new("Baked ink / paper / hardware")
material.use_nodes = True
nodes = material.node_tree.nodes
nodes.clear()
tex = nodes.new("ShaderNodeTexImage")
tex.image = atlas
tex.interpolation = "Closest"
emit = nodes.new("ShaderNodeEmission")
output = nodes.new("ShaderNodeOutputMaterial")
material.node_tree.links.new(tex.outputs["Color"], emit.inputs["Color"])
material.node_tree.links.new(emit.outputs[0], output.inputs["Surface"])

def xyz(p):
    return (p[0], -p[2], p[1])

class Mesh:
    def __init__(self):
        self.vertices, self.faces, self.tiles, self.tints = [], [], [], []

    def face(self, points, tile=2, tint=(1, 1, 1)):
        start = len(self.vertices)
        self.vertices.extend(points)
        self.faces.append(tuple(range(start, start + len(points))))
        self.tiles.append(tile)
        self.tints.append(tint)

    def box(self, size, p, tile=2, rot=(0, 0, 0), tint=(1, 1, 1), bevel=0):
        # Chamfered boxes use a short bevel modifier before the final merge.
        # The hand-authored ring topology keeps triangulation predictable.
        sx, sy, sz = (s / 2 for s in size)
        b = min(bevel, sx * .6, sy * .6, sz * .6)
        rings = []
        from mathutils import Euler
        matrix = Euler(rot, "XYZ").to_matrix()
        for y, inset in [(-sy, b), (-sy+b, 0), (sy-b, 0), (sy, b)] if b else [(-sy, 0), (sy, 0)]:
            ring = [(-sx+inset, y, -sz+inset), (sx-inset, y, -sz+inset),
                    (sx-inset, y, sz-inset), (-sx+inset, y, sz-inset)]
            rings.append([tuple(matrix @ Vector(v) + Vector(p)) for v in ring])
        self.face(list(reversed(rings[0])), tile, tint)
        self.face(rings[-1], tile, tint)
        for a, z in zip(rings, rings[1:]):
            for i in range(4):
                self.face([a[i], a[(i+1)%4], z[(i+1)%4], z[i]], tile, tint)

    def rod(self, a, b, radius=.025, tile=2, sides=6, end_radius=None, tint=(1, 1, 1)):
        a, b = Vector(a), Vector(b)
        direction = (b-a).normalized()
        tangent = direction.cross(Vector((0, 1, 0)))
        if tangent.length < .01:
            tangent = direction.cross(Vector((1, 0, 0)))
        tangent.normalize()
        bitangent = direction.cross(tangent).normalized()
        top = radius if end_radius is None else end_radius
        rings = [[tuple(c + (tangent*math.cos(i*2*math.pi/sides) + bitangent*math.sin(i*2*math.pi/sides))*r)
                  for i in range(sides)] for c, r in [(a, radius), (b, top)]]
        self.face(list(reversed(rings[0])), tile, tint)
        self.face(rings[1], tile, tint)
        for i in range(sides):
            self.face([rings[0][i], rings[0][(i+1)%sides], rings[1][(i+1)%sides], rings[1][i]], tile, tint)

    def wire(self, points, tile=8, radius=.018):
        for a, b in zip(points, points[1:]):
            self.rod(a, b, radius, tile, 5)

    def finish(self, name, parent=None, world=(0, 0, 0)):
        data = bpy.data.meshes.new(name)
        # Runtime-coordinate winding is reversed by the authoring face builders.
        data.from_pydata([xyz(v) for v in self.vertices], [], [tuple(reversed(f)) for f in self.faces])
        data.update()
        uv = data.uv_layers.new(name="Atlas")
        colors = data.color_attributes.new(name="BakedLight", type="FLOAT_COLOR", domain="CORNER")
        data.color_attributes.active_color = colors
        for polygon, tile, tint in zip(data.polygons, self.tiles, self.tints):
            n = Vector((polygon.normal.x, polygon.normal.z, -polygon.normal.y))
            center = sum((Vector(self.vertices[i]) for i in polygon.vertices), Vector()) / len(polygon.vertices)
            wp = center + Vector(world)
            # Constant baked key plus spatial warm reading/cool hardware pools.
            key = .70 + .26 * max(0, n.dot(Vector((.35, .8, .45)).normalized()))
            warm = math.exp(-((wp.x+2.1)**2 + (wp.y-1.5)**2 + (wp.z+1.3)**2) / 5)
            cool = math.exp(-((wp.x-2.0)**2 + (wp.y-1.8)**2 + (wp.z+1.3)**2) / 4)
            light = (key + warm*.24, key + warm*.13 + cool*.08, key + cool*.24)
            for j, li in enumerate(polygon.loop_indices):
                # Insets keep nearest filtering out of adjacent material patches.
                corners = [(0, 0), (1, 0), (1, 1), (0, 1)]
                if len(polygon.vertices) == 4:
                    u, v = corners[j]
                else:
                    u, v = (.5 + .47*math.cos(j*2*math.pi/len(polygon.vertices)),
                            .5 + .47*math.sin(j*2*math.pi/len(polygon.vertices)))
                uv.data[li].uv = ((tile % 4 * 128 + 4 + u*120)/512, (tile // 4 * 128 + 4 + v*120)/512)
                colors.data[li].color = tuple(min(1, light[k]*tint[k]) for k in range(3)) + (1,)
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(material)
        obj.parent = parent
        return obj

def shell():
    b = Mesh()
    # Heavy cutaway slab; low front edges keep the room open to inspection.
    b.box((9.7, .38, 7.5), (0, -.23, 0), 8, bevel=.06)
    for i in range(19):
        x = -4.5+i*.5
        for j in range(3):
            b.box((.485, .035, 2.39), (x, -.02, -2.45+j*2.45), 1,
                  tint=(.83+(i%4)*.035, .89+(j%3)*.025, 1))
    b.box((9.5, 5.35, .23), (0, 2.62, -3.55), 0, tint=(.63, .69, .79))
    # Asymmetric stepped left wall, no tall right wall masking the desk.
    b.box((.23, 4.2, 3.6), (-4.65, 2.04, -1.82), 0, tint=(.63, .65, .73))
    b.box((.23, 1.05, 3.6), (-4.65, .47, 1.78), 0, tint=(.7, .7, .74))
    b.box((.23, .53, 7.1), (4.65, .22, 0), 2)
    for y in [.18, .45, 4.95]:
        b.box((9.4, .065, .1), (0, y, -3.38), 2)
    for x in [-4.35, -3.75, 3.5, 4.35]:
        b.box((.08, 4.6, .12), (x, 2.65, -3.37), 2)
    # Tall original lancet window, irregular tracery and static city silhouette.
    arch = [(-1.06, 1.48), (-1.06, 3.25), (-.92, 3.76), (-.59, 4.3), (.22, 5.02),
            (.94, 4.15), (1.26, 3.57), (1.37, 3.11), (1.37, 1.48)]
    b.face([(x, y, -3.405) for x, y in arch], 5, (.72, 1, 1))
    for a, c in zip(arch, arch[1:]+arch[:1]):
        b.rod((a[0],a[1],-3.27),(c[0],c[1],-3.27), .075, 7, 5)
    b.box((2.7,.13,.46),(.16,1.44,-3.2),11)
    for x, h, width in [(-.88,.64,.3),(-.53,1.03,.27),(-.18,.8,.35),(.2,1.54,.3),(.58,1.14,.25),(.91,.71,.37)]:
        b.box((width,h,.035),(x,1.57+h/2,-3.37),8)
        for yy in range(int(h/.18)-1):
            b.box((.025,.04,.01),(x+.05,1.7+yy*.18,-3.34),13,tint=(.62,.78,.8))
    b.rod((.2,1.5,-3.22),(.2,4.88,-3.22),.025,2)
    for points in [[(-1,2.8,-3.22),(-.5,3.05,-3.22),(.2,4.1,-3.22)],
                   [(1.3,2.8,-3.22),(.8,3.2,-3.22),(.2,4.1,-3.22)]]:
        b.wire(points,7,.027)
    # Overhead cable trunks and hand-set clips: static, not animated noise.
    for offset in [0,.065,.13]:
        points=[(-4.55,4.65-offset,-3.13),(-2.2,4.55-offset,-3.13),(-1.25,4.67-offset,-3.13),
                (-.9,5.12-offset,-3.13),(1.45,5.12-offset,-3.13),(2.05,4.68-offset,-3.13),(4.1,4.68-offset,-3.13),(4.1,1.0,-3.13)]
        b.wire(points,8,.022)
    for x in [-3.7,-2.2,2.6,3.7]:
        b.box((.09,.33,.055),(x,4.62,-3.08),7)
    # Threadbare, stepped rug rather than a glowing circular platform.
    b.box((3.6,.025,2.9),(-.35,.02,.9),4)
    for x in [-2.07,1.37]:
        b.box((.07,.008,2.8),(x,.039,.9),9)
    for z in [-.46,2.26]:
        b.box((3.5,.008,.08),(-.35,.041,z),7)
    # Low reading seat and loose folded cloth.
    b.box((1.65,.27,1.52),(-2.75,.18,.3),1,bevel=.035)
    b.box((1.55,.23,1.4),(-2.75,.44,.3),4,bevel=.09,tint=(.84,.83,.92))
    b.box((1.6,.65,.22),(-2.75,.64,-.32),4,rot=(-.13,0,0),bevel=.06)
    b.box((.75,.11,1.1),(-2.5,.6,.5),9,rot=(0,.1,0),bevel=.03)
    # Original cut-paper eclipse diagram, not franchise art or personal data.
    b.box((.98,1.45,.06),(3.5,3.55,-3.35),1)
    b.box((.85,1.3,.02),(3.5,3.55,-3.3),3)
    b.rod((3.5,3.74,-3.28),(3.5,3.74,-3.26),.26,8,12)
    b.rod((3.61,3.81,-3.24),(3.61,3.81,-3.22),.22,3,12)
    for i in range(3):
        b.box((.58-i*.09,.015,.01),(3.5,3.14+i*.09,-3.27),2)
    return b.finish("room-shell")

def book(b, x, y, z, width, height, tile, lean=0):
    b.box((width,height,.43),(x,y+height/2,z),tile,rot=(0,0,lean))
    b.box((max(.035,width-.035),height-.065,.04),(x,y+height/2,z-.22),3,rot=(0,0,lean))
    for h in [.07,height-.09]:
        b.box((width*.75,.018,.015),(x,y+h,z+.222),7)
    b.box((width*.48,.055,.013),(x,y+height*.62,z+.223),11)

def shelf(b, m):
    # Uneven stepped silhouette; two interlocked shelves instead of one box.
    for x, h in [(-1.13,3.8),(.39,3.8),(1.05,3.24)]:
        b.box((.12,h,.69),(x,h/2,0),1)
        b.box((.035,h,.03),(x-.035,h/2,.365),7,tint=(.75,.7,.63))
    b.box((2.2,3.4,.07),(-.03,1.74,-.34),1,tint=(.59,.64,.69))
    for y in [.16,.94,1.75,2.57,3.42]:
        b.box((2.33,.12,.73),(-.04,y,0),1)
        b.box((2.33,.026,.028),(-.04,y+.048,.38),7)
    # Three upward metal tips; angular fantasy details, no recognizable relic.
    for x, h in [(-1.13,4.05),(.39,4.05),(1.05,3.55)]:
        b.rod((x,h-.3,0),(x,h,0),.08,2,4,end_radius=0)
    tiles=[9,14,10,3,6,11,8,7]
    for row,y in enumerate([.23,1.01,1.82,2.64]):
        x=-.98
        for i in range(11):
            width=.12+(i%3)*.035
            h=.47+((i*5+row*3)%5)*.045
            dest=m if row==2 and i==5 else b
            book(dest,x+width/2,y,.02,width,h,tiles[(i+row*3)%len(tiles)],.025 if i==9 else 0)
            x+=width+.02
    # Piles, pages and one ribbon visible above the low shelf.
    for i in range(4):
        b.box((.62,.075,.48),(.79,3.55+i*.085,.015),[3,14,9,11][i],rot=(0,(i-2)*.06,0))
    # Original two-horn bookend: a small angular relic, not a franchise mask.
    b.box((.33,.28,.22),(-.64,3.66,0),11,rot=(0,-.12,0),bevel=.06)
    for side in [-1,1]:
        b.rod((-.64+side*.12,3.76,0),(-.64+side*.24,4.05,-.02),.06,7,4,end_radius=.012)
        b.box((.055,.018,.012),(-.64+side*.08,3.69,.12),8,rot=(0,0,side*.15))
    # Reading table and an open book: narrative anchor beside the shelf.
    b.box((1.16,.09,.9),(.48,.69,1.07),1)
    for x in [.03,.93]:
        b.box((.09,.65,.7),(x,.34,1.07),2)
    for side in [-1,1]:
        b.box((.43,.045,.57),(.48+side*.2,.79,1.07),3,rot=(0,0,side*.12))
        for j in range(5):
            b.box((.26,.008,.012),(.48+side*.21,.825, .88+j*.085),11)
    b.box((.025,.012,.66),(.5,.835,1.1),9)
    # Articulated warm desk lamp, faceted shade and ceramic switch.
    b.rod((1.04,.75,.75),(1.04,.8,.75),.16,2,10)
    b.wire([(1.04,.8,.75),(1.08,1.23,.75),(.8,1.52,.75),(.65,1.47,.75)],7,.025)
    b.rod((.65,1.5,.75),(.65,1.29,.75),.08,12,8,end_radius=.24)
    b.rod((.65,1.285,.75),(.65,1.275,.75),.21,15,8)

def computer(b,m):
    b.box((2.92,.16,1.45),(0,1.14,0),1,bevel=.035)
    b.box((2.9,.03,.07),(0,1.21,.7),11)
    for x in [-1.3,1.3]:
        b.box((.13,1.12,1.26),(x,.55,0),2)
    b.rod((-1.3,.18,-.57),(1.3,.94,-.57),.035,2)
    b.rod((-1.3,.94,-.57),(1.3,.18,-.57),.035,2)
    # Heavy CRT: stepped depth and an angled neck; no black flat rectangle TV.
    b.box((1.38,1.08,.83),(-.3,1.98,-.22),11,bevel=.11)
    b.box((1.52,1.16,.16),(-.3,1.98,.23),11,bevel=.045)
    b.box((1.23,.86,.025),(-.3,2.035,.322),8,bevel=.03)
    b.box((1.1,.72,.025),(-.3,2.035,.343),5,bevel=.035)
    b.box((.75,.15,.63),(-.3,1.36,-.13),2,bevel=.03)
    b.box((.32,.24,.3),(-.3,1.5,-.2),11)
    for i in range(4):
        b.box((.1,.025,.015),(-.7+i*.19,1.51,.335),2)
    b.box((.03,.03,.02),(.28,1.52,.337),13)
    # Quiet pixel cursor is an interaction, never fake live analytics.
    m.box((.09,.025,.01),(-.72,2.27,.363),13)
    for i,w in enumerate([.59,.35,.67,.45]):
        m.box((w,.014,.01),(-.73+w/2,2.17-i*.075,.365),13,tint=(.75,.9,.85))
    # Smoked cobalt tower with inset internals and ribbed case rails. Opaque
    # atlas + inset geometry avoids sorting and alpha overdraw on phones.
    b.box((.62,1.5,1.03),(1.02,1.97,-.09),6,bevel=.04)
    b.box((.49,1.34,.025),(1.02,1.97,.443),5)
    for x in [.76,1.28]:
        b.box((.04,1.38,.04),(x,1.97,.47),6,tint=(1,1,1))
    for y in [1.5,2.18]:
        b.rod((1.02,y,.466),(1.02,y,.486),.16,2,12)
        b.rod((1.02,y,.489),(1.02,y,.5),.045,13,8)
        for i in range(4):
            angle=i*math.pi/2
            b.box((.16,.036,.01),(1.02+.07*math.cos(angle),y+.07*math.sin(angle),.492),6,rot=(0,0,angle+.45))
    for y in [2.47,2.55]:
        b.box((.38,.045,.035),(1.02,y,.48),2)
    b.box((.025,.06,.02),(1.21,2.36,.49),13)
    # Bulky cream keyboard with separate keycaps and coiled wire.
    b.box((1.43,.12,.43),(-.37,1.28,.46),11,rot=(.07,0,0),bevel=.025)
    for row in range(4):
        for i in range(12):
            b.box((.089,.025,.064),(-.97+i*.108,1.355,.31+row*.085),3 if i%5 else 2)
    b.box((.44,.03,.06),(-.3,1.36,.625),3)
    b.box((.16,.09,.25),(.59,1.31,.5),11,bevel=.035)
    for dx in [0,.055]:
        b.wire([(.62+dx,1.24,.45),(.74+dx,1.23,.05),(.5+dx,1.23,-.55),(.3+dx,.78,-.7),(.5+dx,.2,-.82),(1.7,.1,-.83),(1.9,.15,-1.3)],8)
    # Squat stool, power brick, loose notes and a three-spine manual stack.
    b.rod((-.35,.59,1.0),(-.35,.67,1.0),.42,4,8)
    b.rod((-.35,.08,1.0),(-.35,.58,1.0),.065,2)
    for i in range(3):
        a=i*math.pi*2/3
        b.rod((-.35,.16,1),(-.35+math.cos(a)*.4,.06,1+math.sin(a)*.4),.035,2)
    for i in range(3):
        b.box((.48,.07,.63),(-1.05,1.31+i*.075,-.2),[3,9,14][i],rot=(0,i*.08,0))
    b.box((.33,.16,.45),(.7,.13,-.1),8)

def blockout(b,m,ident,size):
    # An explicit wire-edged volume, not a falsely finished prop. Labels live
    # in the semantic dock; no decorative asset embeds public UI wording.
    w,h,d=size
    b.box((w,.09,d),(0,.06,0),8)
    for x in [-w/2,w/2]:
        for z in [-d/2,d/2]:
            b.rod((x,.1,z),(x,h,z),.012,11,4)
    for y in [.11,h]:
        for z in [-d/2,d/2]:
            b.rod((-w/2,y,z),(w/2,y,z),.012,11,4)
        for x in [-w/2,w/2]:
            b.rod((x,y,-d/2),(x,y,d/2),.012,11,4)
    m.box((w*.65,.025,.025),(0,h/2,d/2),13)

shell()
for ident, layout in LAYOUT["props"].items():
    parent = bpy.data.objects.new("OBJ__"+ident,None)
    bpy.context.collection.objects.link(parent)
    parent.location=xyz(layout["position"])
    parent.rotation_euler.z=layout["rotation"]
    parent.scale=(layout["scale"],)*3
    b,m=Mesh(),Mesh()
    if ident=="read":
        shelf(b,m)
    elif ident=="play":
        computer(b,m)
    else:
        blockout(b,m,ident,layout["size"])
    b.finish("body__"+ident,parent,layout["position"])
    m.finish("motion__"+ident,parent,layout["position"])

# Recalculate outward normals for authored disconnected solids before export.
for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        continue
    bpy.context.view_layer.objects.active=obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)

bpy.context.scene.world.color=(.03,.035,.05)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/"room.blend"),compress=True)
bpy.ops.export_scene.gltf(filepath=str(OUT/"room-source.glb"),export_format="GLB",
    export_yup=True,export_animations=False,export_cameras=False,export_lights=False,
    export_vertex_color="ACTIVE",export_all_vertex_colors=True,
    export_image_format="AUTO",export_materials="EXPORT",export_extras=False)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
provenance={"authoringTool":"Blender","version":"5.2.3 LTS","originalArtwork":True,
    "generatorSha256":sha(Path(__file__)),"layoutSha256":sha(ROOT/"scripts/room/gothic-layout.json"),
    "sourceSha256":sha(OUT/"room-source.glb"),"editableSha256":sha(OUT/"room.blend"),
    "atlasSha256":sha(OUT/"material-atlas.png")}
(OUT/"provenance.json").write_text(json.dumps(provenance,indent=2)+"\n")
print("ROOM_AUTHORING_COMPLETE",json.dumps(provenance))
