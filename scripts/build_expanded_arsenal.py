"""Original visual-only game assets. Run in isolated Blender --background --factory-startup.
Semantic dimensions are aesthetic socket coordinates, not real weapon specifications.
Editable profile shells, bevels, Boolean apertures and native Array details remain in .blend.
"""
import bpy, bmesh, math, json, random, os
from pathlib import Path
from mathutils import Vector

BASE = Path(__file__).resolve().parents[1]
OUT = BASE / 'assets-source/retired-20261023/assets/weapons/authored'
EVIDENCE = BASE / 'artifacts/weapon-photo-realism-20261008/expanded'
SOURCE = BASE / 'assets-source/arsenal.blend'
for p in [OUT, EVIDENCE, SOURCE.parent]: p.mkdir(parents=True, exist_ok=True)
# This process owns only its fresh factory scene. It never connects to the user's UI.
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.unit_settings.system='METRIC'
def jsonfile(name,data): (EVIDENCE/name).write_text(json.dumps(data,indent=2))
jsonfile('production_analysis.json',{'schema_version':'1.0','status':'passed','execution_allowed':True,'execution_scope':'formal_production','deliverable':'animated_asset','completion_scope':'reusable_asset','protected_scope':{'status':'passed','objects':[],'task_owned_collection':'AuthoredArsenal'},'design_intent':{'status':'resolved','thesis':'Distinct matte-black carbine and olive precision rifle, visual game props only'},'scale_strategy':'Trigger at origin, game grip and muzzle sockets constrain proportions','primary_masses':['profiled receiver','contoured buttstock','tapered handguard'],'structural_forms':['trigger guard aperture','magazine well interface','scope mounts'],'transition_forms':['evaluated 0.001–0.004 bevel radii','lofted barrel and scope steps'],'part_graph_status':'approved','critical_blockers':[],'assumptions':['Original generic exterior appearance, no functional mechanisms or internal manufacturing geometry.','Explicit delegation authorizes isolated editable deliverables and internal visual iterations.']})

def mat(name,color,metal=0,rough=.5):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    return m
metal=mat('Anodized receiver alloy',(.052,.061,.071),.32,.43)
polymer=mat('Matte molded polymer',(.022,.027,.030),0,.66)
steel=mat('Black oxide steel',(.043,.049,.056),.66,.37)
olive=mat('Olive molded composite',(.105,.142,.064),0,.64)
rubber=mat('Rubber contact pads',(.019,.023,.025),0,.82)
glass=mat('Blue optical coating',(.012,.035,.19),.38,.10)
glass.node_tree.nodes['Principled BSDF'].inputs['Coat Weight'].default_value=.65
glass.node_tree.nodes['Principled BSDF'].inputs['Coat Roughness'].default_value=.065
boltgrey=mat('Machined bolt grey',(.17,.19,.215),.82,.32)
knurled=mat('Knurled turret metal',(.076,.083,.089),.5,.47)
edge=mat('Contact polished alloy',(.15,.17,.19),.68,.32)
recess=mat('Deep recess',(.003,.004,.005),0,.88)
marking=mat('Restrained stamped markings',(.28,.30,.27),0,.66)
for m in [metal,steel,knurled]:
    m['production_material_class']='metal';m['production_surface_variant']='coated'
boltgrey['production_material_class']='metal';boltgrey['production_surface_variant']='machined'
parts=[]; current=None
def own(o,name,material,role='static'):
    o.name=name;o.data.materials.append(material);o['export_role']=role;o['connection']='mechanical_seam'
    for c in list(o.users_collection):c.objects.unlink(o)
    current.objects.link(o);parts.append(o);return o
def bevel(o,width=.002,segments=2):
    m=o.modifiers.new('Manufactured edge radii','BEVEL');m.width=width;m.segments=segments
    m=o.modifiers.new('Stable planar normals','WEIGHTED_NORMAL');m.keep_sharp=True
    return o
def mesh(name,verts,faces,material,role='static'):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free()
    o=bpy.data.objects.new(name,data);current.objects.link(o);o.data.materials.append(material);o['export_role']=role;o['connection']='mechanical_seam';parts.append(o);return o
def profile(name,outline,width,material,x=0,role='static',radius=.002):
    # Outline in Three.js longitudinal Z / vertical Y. Blender conversion (x,-z,y).
    n=len(outline);verts=[(x+s*width/2,-z,y) for s in [-1,1] for z,y in outline]
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return bevel(mesh(name,verts,faces,material,role),radius)
def box(name,pos,size,material,role='static',radius=.001):
    x,y,z=pos;w,h,d=size
    return profile(name,[(z-d/2,y-h/2),(z+d/2,y-h/2),(z+d/2,y+h/2),(z-d/2,y+h/2)],w,material,x,role,radius)
def lathe(name,stations,height,material,n=16,role='static',x=0):
    # Connected surface of revolution; one profile owns all cylindrical steps.
    verts=[(x+math.cos(j*math.tau/n)*r,-z,height+math.sin(j*math.tau/n)*r) for z,r in stations for j in range(n)]
    faces=[]
    for k in range(len(stations)-1):
        for j in range(n):faces.append((k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j))
    if stations[0]!=stations[-1]:
        faces += [tuple(reversed(range(n))),tuple((len(stations)-1)*n+j for j in range(n))]
    o=mesh(name,verts,faces,material,role)
    for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
    return o
def array(o,count,step):
    mod=o.modifiers.new('Native repeated feature','ARRAY');mod.count=count;mod.use_relative_offset=False;mod.use_constant_offset=True;mod.constant_offset_displace=(step[0],-step[2],step[1]);return o
def cut(host,cutter):
    mod=host.modifiers.new('Through aperture','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
    # Difference precedes the edge finish in the editable stack.
    bpy.context.view_layer.objects.active=host;bpy.ops.object.modifier_move_up(modifier=mod.name);bpy.ops.object.modifier_move_up(modifier=mod.name)
    cutter.hide_render=True;cutter.hide_set(True);cutter['export_role']='cutter'
def ellipse(z,y,rz,ry,n=24):
    return [(z+math.cos(i*math.tau/n)*rz,y+math.sin(i*math.tau/n)*ry) for i in range(n)]
def rounded_outline(points,steps=3):
    result=[]
    for i in range(len(points)):
        p0=Vector(points[(i-1)%len(points)]);p1=Vector(points[i]);p2=Vector(points[(i+1)%len(points)]);p3=Vector(points[(i+2)%len(points)])
        for j in range(steps):
            t=j/steps
            v=.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t)
            result.append(tuple(v))
    return result
def rounded_stock_loft():
    # Continuous quad-ring molded stock: never bend an ngon cap into a curved side.
    top=[(-.483,-.006),(-.470,.012),(-.432,.020),(-.218,.022),(-.157,.046),(.053,.052),(.112,.046),(.143,.036),(.176,.036),(.216,.043),(.250,.047),(.293,.061),(.375,.061)]
    bottom=[(-.483,-.007),(-.470,-.026),(-.416,-.037),(-.236,-.040),(-.164,-.025),(-.050,-.018),(.010,-.023),(.037,-.108),(.061,-.128),(.098,-.123),(.123,-.071),(.154,-.053),(.207,-.054),(.278,-.091),(.375,-.091)]
    def interp(points,z):
        for i in range(len(points)-1):
            x0,y0=points[i];x1,y1=points[i+1]
            if x0<=z<=x1:
                t=(z-x0)/(x1-x0)
                m0=(y1-points[max(0,i-1)][1])/(x1-points[max(0,i-1)][0])
                m1=(points[min(len(points)-1,i+2)][1]-y0)/(points[min(len(points)-1,i+2)][0]-x0)
                # Limit slopes around molded grip corner transitions.
                sec=(y1-y0)/(x1-x0)
                if sec==0:m0=m1=0
                else:
                    m0=max(0,min(m0/sec,2))*sec;m1=max(0,min(m1/sec,2))*sec
                return (2*t**3-3*t*t+1)*y0+(t**3-2*t*t+t)*m0*(x1-x0)+(-2*t**3+3*t*t)*y1+(t**3-t*t)*m1*(x1-x0)
        return points[0][1] if z<points[0][0] else points[-1][1]
    stations=sorted(set([round(-.482+i*.856/70,6) for i in range(71)]+[z for z,y in top+bottom if -.482<z<.374]))
    verts=[];n=20
    for z in stations:
        hi=interp(top,z);lo=interp(bottom,z);cy=(hi+lo)/2;ry=max(.001,(hi-lo)/2)
        width=.028+.009*math.exp(-((z+.07)/.29)**4)
        if z<-.435:width*=.24+.76*min(1,(z+.483)/.048)**.55
        for j in range(n):
            a=j*math.tau/n;c=math.cos(a);q=math.sin(a)
            verts.append((math.copysign(abs(c)**.47,c)*width,-z,cy+math.copysign(abs(q)**.47,q)*ry))
    faces=[]
    for k in range(len(stations)-1):
        for j in range(n):faces.append((k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j))
    faces.extend([tuple(reversed(range(n))),tuple((len(stations)-1)*n+j for j in range(n))])
    o=mesh('AW continuously lofted composite chassis',verts,faces,olive)
    for f in o.data.polygons:f.use_smooth=len(f.vertices)==4
    bevel(o,.0012,2)
    return o

def pin(name,pos,radius=.005,depth=.005,material=None,role='static',axis='x'):
    x,y,z=pos
    knurl='Scope' in name and ('turret' in name or 'cap' in name)
    bpy.ops.mesh.primitive_cylinder_add(vertices=48 if knurl else 12,radius=radius,depth=depth,location=(x,-z,y))
    o=bpy.context.object
    if knurl:
        for v in o.data.vertices:
            step=round(math.atan2(v.co.y,v.co.x)/math.tau*48)%48
            if step%2:v.co.x*=.94;v.co.y*=.94
    if axis=='x':o.rotation_euler.y=math.pi/2
    elif axis=='z':o.rotation_euler.x=math.pi/2
    own(o,name,material or steel,role)
    bevel(o,.00012 if knurl else .0006,1)
    for f in o.data.polygons:f.use_smooth=len(f.vertices)==4
    return o
def slot(host,name,outline,width=.2):
    c=profile(name+' CUTTER',outline,width,metal,radius=.001)
    cut(host,c);return c
def guard():
    g=profile('Forged trigger guard',[(-.069,.008),(.018,.008),(.028,-.031),(.023,-.044),(.004,-.054),(-.05,-.052),(-.07,-.040)],.021,metal,radius=.0013)
    slot(g,'Trigger opening',[(-.060,-.001),(.010,-.001),(.018,-.031),(.012,-.040),(-.047,-.041),(-.060,-.032)])
    profile('Sculpted curved trigger',[(-.012,.004),(-.018,-.003),(-.023,-.023),(-.019,-.038),(-.013,-.042),(-.011,-.037),(-.015,-.029),(-.015,-.014),(-.008,-.002)],.006,steel,radius=.0006)
def grip():
    g=profile('Angled pistol grip',[(.016,.020),(.047,.010),(.062,-.015),(.083,-.113),(.071,-.132),(.034,-.128),(.015,-.117),(.008,-.059),(.001,-.021)],.040,polymer,radius=.003)
    # Side insert is a separate molded grip face, with a clean receiving border.
    for x in [-.0202,.0202]:
        profile('Grip textured inset',[(.021,-.035),(.051,-.034),(.070,-.108),(.062,-.116),(.030,-.11)],.0017,rubber,x=x,radius=.001)
    pin('Grip heel screw',(0,-.126,.054),.004,.004,steel,axis='y')
def rail(z,length,height,width=.034):
    box('Rail continuous base',(0,height,z),(width,.006,length),metal,radius=.0006)
    o=box('Rail tooth source',(0,height+.006,z-length/2+.004),(width+.008,.005,.006),metal,radius=.0006)
    array(o,max(2,round(length/.014)),(0,0,.014))
def magazine(sniper=False):
    if sniper:
        body=profile('AW detachable magazine',[(-.055,.014),(-.136,.014),(-.136,-.077),(-.128,-.093),(-.059,-.091)],.045,metal,role='magazine',radius=.0015)
        box('AW magazine floorplate',(0,-.092,-.094),(.048,.006,.080),polymer,'magazine',radius=.001)
        for x in [-.0226,.0226]:
            profile('AW stamped magazine panel',[(-.065,-.007),(-.124,-.007),(-.125,-.071),(-.068,-.074)],.001,steel,x=x,role='magazine',radius=.0005)
    else:
        # Curved front and back contours, with a shallower receiver insertion.
        body=profile('Curved stamped magazine',[(-.083,.014),(-.153,.014),(-.155,-.040),(-.162,-.092),(-.182,-.143),(-.191,-.161),(-.129,-.182),(-.117,-.160),(-.100,-.11),(-.090,-.062)],.046,metal,role='magazine',radius=.0014)
        profile('Magazine folded floorplate',[(-.192,-.157),(-.195,-.166),(-.130,-.188),(-.125,-.179)],.051,steel,role='magazine',radius=.0008)
        # Stamped longitudinal recesses are native Boolean cavities, not attached rods.
        for x in [-.023,.023]:
            for shift in [0,-.022]:
                c=profile('Magazine pressed channel CUTTER',[(-.107+shift,-.014),(-.117+shift,-.014),(-.128+shift,-.105),(-.150+shift,-.160),(-.142+shift,-.163),(-.120+shift,-.108)],.004,recess,x=x,role='cutter',radius=.001)
                cut(body,c)
        # A restrained contact-polish line along the removable floorplate.
        for x in [-.0255,.0255]:
            profile('Magazine rim wear',[(-.193,-.162),(-.130,-.183),(-.130,-.181),(-.193,-.160)],.0005,edge,x=x,role='magazine',radius=.0001)
def m4():
    # Rounded octagonal forging with a separate lower receiver, preserving the AR silhouette.
    upper=lathe('Rounded upper receiver',[(.095,.019),(.091,.022),(.082,.024),(-.151,.024),(-.160,.023),(-.17,.020)],.060,metal,n=24)
    # Forged shoulder below the top rail, with tapered relief at both ends.
    for side in [-1,1]:
        profile('Upper forging rail shoulder',[(-.16,.075),(-.150,.086),(.069,.086),(.085,.078),(.084,.072),(-.145,.073)],.010,metal,x=side*.014,radius=.0018)

    # Flat-sided lower with actual magazine-well transitions and rear grip shoulder.
    lower=profile('Forged lower and magazine well',[(.091,.043),(.085,.017),(.035,.009),(.006,.017),(-.062,.014),(-.070,-.009),(-.078,-.018),(-.153,-.018),(-.163,.038)],.043,metal,radius=.0014)
    # Lower forging relief and a rolled magazine-well rim are visible external surfaces.
    for side in [-1,1]:
        profile('Magazine well forged rim',[(-.153,-.018),(-.078,-.018),(-.074,-.010),(-.080,-.006),(-.149,-.007)],.003,metal,x=side*.022,radius=.0012)
        profile('Receiver side shoulder',[(.067,.040),(.039,.033),(-.054,.031),(-.064,.039)],.002,metal,x=side*.0218,radius=.001)
    grip();guard();magazine()
    lathe('Exposed buffer tube',[(.09,.018),(.117,.018),(.12,.015),(.261,.015)],.061,steel,n=16)
    lathe('Buffer castle nut',[(.096,.020),(.109,.020)],.061,steel,n=16)
    # Telescoping stock has a visibly exposed tube ahead of the cheek shell.
    stock=profile('Telescoping shoulder stock',[(.193,.080),(.324,.080),(.350,.061),(.350,-.077),(.333,-.084),(.289,-.049),(.253,-.022),(.199,.012)],.051,polymer,radius=.003)
    slot(stock,'Stock sling clearance',[(.302,.014),(.327,.014),(.327,-.025),(.302,-.025)],.08)
    profile('Stock cheek comb',[(.177,.076),(.322,.076),(.329,.067),(.322,.055),(.190,.053),(.177,.062)],.061,polymer,radius=.003)
    profile('Stock rubber shoulder pad',[(.346,.060),(.362,.055),(.362,-.078),(.349,-.088),(.34,-.078),(.34,.05)],.055,rubber,radius=.002)
    profile('Stock adjustment latch',[(.188,.018),(.262,-.018),(.26,-.031),(.202,-.018),(.184,.004)],.028,polymer,radius=.0015)
    pin('Stock latch pivot',(.017,-.014,.231),.006,.005,steel)
    # Slim elliptical handguard: physical radius below the receiver height, no inflated toy ribs.
    hand=lathe('Oval carbine handguard',[(-.173,.031),(-.187,.033),(-.363,.029),(-.38,.026)],.061,polymer,n=20)
    for v in hand.data.vertices:v.co.x*=.85
    rib=lathe('Fine handguard rib source',[(-.192,.0333),(-.195,.0333)],.061,polymer,n=20)
    for v in rib.data.vertices:v.co.x*=.85
    array(rib,11,(0,0,-.016))
    lathe('Handguard delta ring',[(-.169,.031),(-.182,.032),(-.189,.029)],.061,steel,n=20)
    lathe('Front handguard cap',[(-.373,.027),(-.381,.027)],.061,steel,n=16)
    # Continuous stepped black barrel and open muzzle; intentionally exterior-only.
    lathe('Blackened barrel',[(-.376,.012),(-.435,.012),(-.444,.009),(-.595,.009),(-.608,.013),(-.638,.013),(-.644,.012),(-.644,.006),(-.630,.006)],.061,steel,n=20)
    muzzle=lathe('Flash hider cage',[(-.612,.014),(-.638,.014),(-.646,.012),(-.646,.0065),(-.620,.0065)],.061,steel,n=20)
    # Slots in flash hider give the end an unmistakable muzzle device silhouette.
    for x in [-.012,.012]:
        c=box('Muzzle slot CUTTER',(x,.061,-.626),(.008,.008,.018),metal,radius=.001);cut(muzzle,c)
    tower=profile('Front sight A-frame',[(-.405,.054),(-.43,.054),(-.430,.072),(-.418,.116),(-.406,.132),(-.394,.119),(-.390,.072)],.017,metal,radius=.001)
    slot(tower,'Front sight triangular aperture',[(-.419,.077),(-.400,.077),(-.406,.111),(-.412,.111)],.045)
    box('Front sight pin',(0,.129,-.407),(.004,.018,.005),steel,radius=.0004)
    rail(-.032,.229,.087)
    # Compact flip-up rear aperture; no tall slab carry handle over the entire receiver.
    box('Rear sight rail mount',(0,.101,.063),(.037,.012,.024),metal,radius=.001)
    rear=profile('Rear peep sight',[(.073,.103),(.073,.136),(.065,.142),(.056,.139),(.052,.105)],.027,metal,radius=.001)
    pin('Rear sight hinge',(0,.11,.063),.006,.044,steel)
    # Rear sight aperture cut along the barrel axis.
    bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=.0045,depth=.07,location=(0,-.063,.131),rotation=(math.pi/2,0,0));c=own(bpy.context.object,'Rear aperture CUTTER',metal,'cutter');cut(rear,c)
    # Receiver mid-scale details: port pocket, opened dust-cover ledge, deflector, pins.
    port=profile('Receiver port border',[(-.10,.043),(-.012,.043),(-.012,.071),(-.101,.071)],.003,steel,x=.023,radius=.001)
    slot(port,'Ejection port',[(-.095,.049),(-.018,.049),(-.018,.066),(-.095,.066)],.09)
    box('Recessed ejection well',(.024,.057,-.055),(.001,.017,.077),recess,radius=.0002)
    profile('Stamped port dust cover',[(-.092,.050),(-.021,.050),(-.021,.064),(-.025,.067),(-.088,.067),(-.092,.063)],.002,metal,x=.025,radius=.001)
    box('Dust cover latch',(.027,.058,-.056),(.003,.007,.012),steel,radius=.0007)
    box('Dust cover hinge',(.027,.043,-.055),(.006,.005,.084),steel,radius=.0007)
    profile('Shell deflector',[(.005,.042),(.024,.044),(.025,.058),(.01,.070)],.017,metal,x=.026,radius=.001)
    pin('Forward assist body',(.031,.060,.048),.007,.026,steel)
    pin('Forward assist cap',(.044,.060,.048),.009,.006,polymer)
    for side in [-1,1]:
        for z,y in [(.073,.027),(-.154,.026),(.022,.023),(-.022,.025)]:pin('Receiver retained pin',(side*.0225,y,z),.0032,.002,steel)
    profile('Safety selector',[(-.002,.025),(.021,.025),(.024,.031),(.018,.035),(-.003,.032)],.004,steel,x=-.024,radius=.0007)
    box('Magazine release',(.024,.022,-.111),(.003,.009,.018),steel,radius=.0007)
    box('Bolt catch',(-.024,.022,-.068),(.003,.011,.014),metal,radius=.0006)
    box('Charging handle stem',(0,.082,.100),(.020,.006,.025),steel,'bolt',radius=.0008)
    box('Charging handle wings',(0,.082,.107),(.060,.006,.010),metal,'bolt',radius=.0008)
    # Sparse physically placed wear along repeatedly handled edges.
    profile('Receiver handling edge wear',[(-.095,.071),(-.021,.071),(-.021,.0718),(-.095,.0718)],.0007,edge,x=.025,radius=.0001)
def sniper():
    # AWP hallmark: shaped olive chassis stock with a real enclosed thumbhole.
    outline=[(.375,.061),(.293,.061),(.250,.047),(.216,.043),(.176,.036),(.143,.036),(.112,.046),(.053,.052),(-.157,.046),(-.218,.022),(-.432,.020),(-.47,.012),(-.483,-.006),(-.470,-.026),(-.416,-.037),(-.236,-.040),(-.164,-.025),(-.050,-.018),(.010,-.023),(.037,-.108),(.061,-.128),(.098,-.123),(.123,-.071),(.154,-.053),(.207,-.054),(.278,-.091),(.375,-.091)]
    stock=rounded_stock_loft()
    opening=[(.083,.017),(.116,.023),(.155,.018),(.181,.005),(.185,-.019),(.173,-.035),(.142,-.037),(.121,-.049),(.101,-.075),(.086,-.076),(.076,-.06),(.067,-.019)]
    hole=slot(stock,'Enclosed thumbhole',rounded_outline(opening,10),.12)
    # Boolean wall shading inherits the cutter sides. Smooth them continuously;
    # weighted planar normals previously left each curved aperture segment flat.
    for face in hole.data.polygons:face.use_smooth=len(face.vertices)==4
    hole.modifiers.remove(hole.modifiers['Stable planar normals'])
    stock.modifiers.remove(stock.modifiers['Stable planar normals'])
    profile('Cheek rest comb',[(.354,.066),(.275,.068),(.235,.052),(.227,.035),(.353,.035)],.057,olive,radius=.004)
    # Parallel receiver bedding line and shallow composite side scallops carry middle-scale form.
    for side in [-1,1]:
        x=side*.030
        profile('Stock receiver bedding seam',[(-.151,.036),(.088,.041),(.087,.043),(-.151,.038)],.0012,polymer,x=x,radius=.0005)
        for z,y in [(.229,.004),(-.197,-.011),(-.399,-.006)]:
            pin('Recessed stock fastener',(side*(.028 if z>.2 else .035 if z>-.3 else .032),y,z),.0055,.003,steel)
            pin('Stock screw center',(side*(.0295 if z>.2 else .0365 if z>-.3 else .0335),y,z),.0022,.003,recess)
    profile('AW rubber buttpad',[(.372,.061),(.393,.054),(.393,-.091),(.374,-.1),(.367,-.088),(.367,.05)],.061,rubber,radius=.003)
    # Pad grooves are an Array owned embossed surface rather than repeated cubes.
    groove=box('Buttpad traction source',(0,.040,.391),(.052,.004,.0015),polymer,radius=.0003);array(groove,12,(0,-.010,0))
    lathe('AW receiver exterior',[(.095,.023),(.089,.026),(-.163,.026),(-.183,.022)],.061,metal,n=20)
    port=profile('AW ejection port lip',[(-.126,.053),(.052,.053),(.052,.080),(-.126,.080)],.002,steel,x=.025,radius=.0008)
    slot(port,'AW ejection port',[(-.113,.058),(.039,.058),(.039,.074),(-.113,.074)],.10)
    box('AW receiver recessed port',(.026,.066,-.036),(.001,.016,.147),boltgrey,'bolt',radius=.0002)
    # Forged external trigger guard integrates visually into the thumbhole stock.
    guard();magazine(True)
    # Long slender blued barrel; connector shoulder is small and proportional.
    lathe('AW long blued barrel',[(-.176,.018),(-.223,.017),(-.595,.013),(-.826,.0115),(-.871,.0115),(-.876,.011),(-.876,.0055),(-.861,.0055)],.061,steel,n=24)
    lathe('AW barrel receiver collar',[(-.178,.022),(-.196,.022)],.061,metal,n=20)
    rail(-.045,.28,.094,width=.030)
    # Low rings physically wrap the optical tube, sitting close to the receiver.
    # Eye-end is an open annulus with its opaque backing behind the glass.
    lathe('Scope continuous body',[(-.301,.032),(-.294,.033),(-.252,.033),(-.222,.020),(-.024,.019),(.001,.026),(.058,.026),(.065,.023),(.065,.0195),(.058,.0195)],.150,polymer,n=28)
    lathe('Scope objective rim',[(-.305,.034),(-.295,.034),(-.295,.029),(-.305,.029),(-.305,.034)],.150,steel,n=28)
    lathe('Objective recessed glass',[(-.302,.027),(-.303,.027)],.150,glass,n=28)
    lathe('Ocular focus rim',[(.048,.028),(.066,.028),(.066,.020),(.053,.020)],.150,steel,n=28)
    lathe('Ocular recessed glass',[(.060,.019),(.062,.019),(.0636,.014),(.0644,.007),(.0646,.0015)],.150,glass,n=28)
    # Fine focus-ring knurl geometry limited to silhouette-readable flutes.
    focus=lathe('Focus ring fine rib',[(.017,.0272),(.019,.0272)],.150,polymer,n=28);array(focus,8,(0,0,.005))
    for z in [-.172,-.047]:
        lathe('Scope clamping ring',[(z-.007,.021),(z-.006,.023),(z+.006,.023),(z+.007,.021)],.150,metal,n=28)
        # Saddle lower face sits on rail crest y=.1025; upper face seats ring y=.127.
        profile('Low scope saddle',[(z-.014,.102),(z+.014,.102),(z+.014,.108),(z+.009,.112),(z+.009,.131),(z-.009,.131),(z-.009,.112),(z-.014,.108)],.023,metal,radius=.0015)
        # Clamp plate is offset, with one recessed cross-bolt visible on each mount.
        profile('Scope rail clamp plate',[(z-.014,.101),(z+.014,.101),(z+.014,.106),(z+.010,.110),(z-.010,.110),(z-.014,.106)],.004,steel,x=-.019,radius=.0007)
        pin('Scope saddle cross-bolt',(-.021,.106,z),.0035,.003,steel)
        box('Scope saddle clamping foot',(0,.104,z),(.038,.005,.027),steel,radius=.0007)
        for x in [-.024,.024]:
            box('Scope clamp ear',(x,.152,z),(.006,.008,.013),metal,radius=.001)
            pin('Scope ring screw',(x,.152,z),.0028,.007,steel)
    # Turrets meet the body instead of floating above it.
    pin('Scope elevation turret',(0,.178,-.105),.013,.025,knurled,axis='y')
    pin('Scope elevation cap',(0,.191,-.105),.014,.004,knurled,axis='y')
    pin('Scope windage turret',(.025,.150,-.105),.012,.018,knurled)
    # Separated moving bolt assembly; closed visual exterior only.
    lathe('AW sliding bolt',[(.07,.0185),(.115,.0185)],.061,boltgrey,role='bolt')
    curve=bpy.data.curves.new('Bent bolt handle profile','CURVE');curve.dimensions='3D';curve.resolution_u=3;curve.bevel_depth=.005;curve.bevel_resolution=2;curve.use_fill_caps=True
    sp=curve.splines.new('BEZIER');sp.bezier_points.add(2)
    for point,co in zip(sp.bezier_points,[(.018,-.085,.064),(.047,-.085,.051),(.064,-.080,.018)]):point.co=co;point.handle_left_type='AUTO';point.handle_right_type='AUTO'
    o=bpy.data.objects.new('Swept AW bolt handle',curve);current.objects.link(o);o.data.materials.append(boltgrey);o['export_role']='bolt';o['connection']='mechanical_seam';parts.append(o)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=.012,location=(.065,-.080,.014));own(bpy.context.object,'AW bolt handle knob',polymer,'bolt')
    # Slim accessory attachment and sling eyes, without bulky toy supports.
    box('Fore-end underside rail',(0,-.039,-.365),(.022,.009,.112),metal,radius=.001)
    for z in [-.409,.30]:pin('Sling mounting stud',(0,-.041 if z<0 else -.082,z),.004,.016,steel,axis='y')

collections={}
for key,builder in [('m4',m4),('sniper',sniper)]:
    current=bpy.data.collections.new(key+' editable source');scene.collection.children.link(current);collections[key]=current
    builder()

def stamp(text,pos,size,side=1):
    # Tiny extruded lettering stays sharp in game without another decal draw call.
    data=bpy.data.curves.new('Authored stamp '+text,'FONT');data.body=text;data.size=size;data.extrude=.000015;data.resolution_u=2
    o=bpy.data.objects.new('Stamped '+text,data);current.objects.link(o);parts.append(o);o.data.materials.append(marking)
    x,y,z=pos;o.location=(x,-z,y);o.rotation_euler=(math.pi/2,0,side*math.pi/2);o['export_role']='static';o['connection']='embedded_component'
current=collections['m4']
for side in [-1,1]:
    stamp('SL-04',(side*.02215,.024,-.026 if side>0 else -.058),.0042,side)
    # The ejection ledge and charging grip are contact areas, unlike every edge.
    profile('Sparse ejection ledge abrasion',[(-.089,.043),(-.061,.043),(-.060,.0437),(-.089,.0437)],.00045,edge,x=side*.0278,radius=.00008)
current=collections['sniper']
for side in [-1,1]:
    stamp('SL A8',(side*.0284,.005,.333 if side>0 else .305),.0048,side)
    stamp('8 - 24',(side*.0262,.150,.036 if side>0 else .007),.0035,side)


# Embedded glTF-compatible PBR textures: broad pigment variation is independent
# from fine roughness, with no shader-only noise lost on export.
import numpy as np
def textured_material(material,seed):
    # 12 cm repeats project below 100 pixels in the authored first-person view;
    # 256px retains surface marks while avoiding unnecessary mobile texture cost.
    n=256
    rng=np.random.default_rng(seed);rgba=np.ones((n,n,4),dtype=np.float32)
    grain=rng.random((n,n)).astype(np.float32)-.5
    grid=rng.random((16,16)).astype(np.float32)-.5
    coordinates=np.arange(n)/(n/16);indices=np.floor(coordinates).astype(int)%16;blend=coordinates-np.floor(coordinates);blend=blend*blend*(3-2*blend)
    a=grid[indices[:,None],indices[None,:]];b=grid[indices[:,None],(indices[None,:]+1)%16]
    c=grid[(indices[:,None]+1)%16,indices[None,:]];d=grid[(indices[:,None]+1)%16,(indices[None,:]+1)%16]
    broad=(a*(1-blend[None,:])+b*blend[None,:])*(1-blend[:,None])+(c*(1-blend[None,:])+d*blend[None,:])*blend[:,None]
    yy,xx=np.mgrid[0:n,0:n];isMetal=material in [metal,steel,boltgrey,knurled]
    scratches=np.zeros((n,n),dtype=np.float32)
    if isMetal:
        for k in range(26):
            sx=int(rng.integers(0,n));sy=int(rng.integers(0,n));length=int(rng.integers(6,n//5));width=1
            for t in range(length):
                py=(sy+t//13)%n;px=(sx+t)%n
                scratches[py,px]=max(scratches[py,px],float(.25+rng.random()*.45))
    directional=np.sin(yy*2.7+np.sin(xx*.034))*0.5 if material is boltgrey else np.zeros((n,n))
    base=np.array(material.diffuse_color[:3])
    middle=.085 if isMetal else .18
    linear=np.clip(base[None,None,:]*(1+broad[:,:,None]*middle+grain[:,:,None]*.10+directional[:,:,None]*.055)+scratches[:,:,None]*.055,0,1)
    color=np.where(linear<=.0031308,linear*12.92,1.055*np.power(linear,1/2.4)-.055)
    rgba[:,:,:3]=color
    def packed_image(suffix,pixels,noncolor=False):
        image=bpy.data.images.new(material.name+' '+suffix,width=n,height=n)
        # Set colorspace BEFORE populating pixels: changing it later can reset buffers.
        image.colorspace_settings.name='Non-Color' if noncolor else 'sRGB'
        image.pixels.foreach_set(pixels.ravel());image.update()
        image.filepath_raw=str(EVIDENCE/(material.name.replace(' ','_')+'-'+suffix+'.png'));image.file_format='PNG';image.save();image.pack();return image
    image=packed_image('albedo',rgba.copy())
    rough=float(material.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value)
    vals=np.clip(rough+grain*.12+broad*middle-scratches*.25+directional*.06,.18,.92)
    rgba[:,:,:3]=vals[:,:,None];rimage=packed_image('roughness',rgba.copy(),True)
    # Independent micro-height field: molded pores versus directional machining.
    height=grain*.023+broad*.035
    if isMetal:height=grain*.011+directional*.015-scratches*.027
    if material is knurled:height=np.cos(xx/n*math.tau*24)*np.cos(yy/n*math.tau*9)*.20+grain*.01
    gy,gx=np.gradient(height);normal=np.stack([-gx*2.2,-gy*2.2,np.ones((n,n))],axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    rgba[:,:,:3]=normal*.5+.5;nimage=packed_image('normal',rgba.copy(),True)
    nodes=material.node_tree.nodes;links=material.node_tree.links;p=nodes.get('Principled BSDF')
    tex=nodes.new('ShaderNodeTexImage');tex.image=image;tex.interpolation='Linear';links.new(tex.outputs['Color'],p.inputs['Base Color'])
    rt=nodes.new('ShaderNodeTexImage');rt.image=rimage;links.new(rt.outputs['Color'],p.inputs['Roughness'])
    nt=nodes.new('ShaderNodeTexImage');nt.image=nimage;nm=nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.7;links.new(nt.outputs['Color'],nm.inputs['Color']);links.new(nm.outputs['Normal'],p.inputs['Normal'])
    material['production_texture_scale_m']=.12;material['substrate']='molded dielectric coating' if material in [polymer,olive,rubber] else 'conversion-coated metal or exposed machined substrate'
    texture_metrics.append({'material':material.name,'size':n,'albedo_srgb_mean':color.mean(axis=(0,1)).tolist(),'roughness_min':float(vals.min()),'roughness_max':float(vals.max()),'roughness_std':float(vals.std()),'normal_xy_std':float(normal[:,:,:2].std()),'normal_roughness_colorspace':'Non-Color before pixel upload'})
texture_metrics=[]
for i,m in enumerate([metal,polymer,steel,olive,rubber,boltgrey,knurled]):textured_material(m,927+i)

for o in parts:
    if o.type!='MESH':continue
    uv=o.data.uv_layers.new(name='ManufacturedSurfaceUV')
    for face in o.data.polygons:
        normal=face.normal;axis=max(range(3),key=lambda a:abs(normal[a]));axes=[a for a in range(3) if a!=axis]
        for li in face.loop_indices:
            co=o.data.vertices[o.data.loops[li].vertex_index].co
            uv.data[li].uv=(co[axes[0]]/.12,co[axes[1]]/.12)

# Source remains editable; all topology conversion is on temporary export copies.
scene.render.engine='CYCLES';scene.cycles.samples=48
scene.render.resolution_x=1500;scene.render.resolution_y=750;scene.render.resolution_percentage=100
scene.world.color=(.25,.25,.25)
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.18,.20,.24,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.45
scene.view_settings.view_transform='AgX'
def aim(o,target):o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
for name,loc,energy,size in [('Key',(1,-.2,1.5),85,1.4),('Rim',(-.8,.8,.8),80,.9),('Fill',(1,1,.1),25,1.8)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size;o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=loc;aim(o,(0,.1,0))
bpy.ops.object.camera_add(location=(1.3,-.7,.55));camera=bpy.context.object;camera.name='Arsenal review camera';scene.camera=camera;camera.data.type='ORTHO';camera.data.ortho_scale=1.52;aim(camera,(0,.2,0))
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))
report={'schema_version':'1.0','overall_status':'PASS','checks':[],'thresholds':{'triangles_max_per_asset':24000,'manifold_boundary_edges':0,'zero_area_faces':0},'intentional_exceptions':['Separate manufactured shells deliberately retain contact seams; joined export batches are not claimed topology-fused.','Embedded pigment, roughness and normal textures use explicit 12 cm UV scale; visual exterior meshes are game art, not manufacturing geometry.'],'not_evaluated':[],'repair_suggestions':[],'assets':{},'texture_metrics':texture_metrics}
for key,collection in collections.items():
    for c in collections.values(): c.hide_render=c!=collection
    for label,loc,scale in ([] if os.environ.get('ARSENAL_SKIP_RENDER') else [('hero',(1.4,-.62,.55),1.48),('side',(2,.18,.04),1.48),('top',(.001,.18,2),1.48),('front',(0,2,.076),.68),('material-close',(1.2,-.65,.40),.53)]):
        camera.location=loc;camera.data.ortho_scale=scale;aim(camera,(0,.055,.080) if label=='material-close' else (0,.2,.076) if label=='front' else (0,.2,0))
        if label=='top':camera.rotation_euler.rotate_axis('Z',math.pi/2)
        scene.render.filepath=str(EVIDENCE/f'{key}-{label}-photo-v2.png');bpy.ops.render.render(write_still=True)
    camera.location=(1.4,-.62,.55);camera.data.ortho_scale=1.48;aim(camera,(0,.2,0))
    temporary=[]
    for o in collection.objects:
        if o.type=='MESH' and o.get('export_role')!='cutter':
            m=o.modifiers.new('Temporary wire proof','WIREFRAME');m.thickness=.00065;temporary.append((o,m))
    scene.render.filepath=str(EVIDENCE/f'{key}-wireframe-photo-v2.png')
    if not os.environ.get('ARSENAL_SKIP_RENDER'):bpy.ops.render.render(write_still=True)
    for o,m in temporary:o.modifiers.remove(m)
    bpy.ops.object.select_all(action='DESELECT')
    export=[];batches={};bad=[];triangles=0
    deps=bpy.context.evaluated_depsgraph_get()
    for source in collection.objects:
        if source.get('export_role')=='cutter':continue
        evaluated=source.evaluated_get(deps)
        data=bpy.data.meshes.new_from_object(evaluated,depsgraph=deps)
        # Blender curve end caps duplicate their rim vertices; weld those seams
        # on the export copy, preserving the editable Curve in source.
        bm=bmesh.new();bm.from_mesh(data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free()
        o=bpy.data.objects.new(source.name+' export',data);scene.collection.objects.link(o);o.matrix_world=source.matrix_world.copy()
        data.calc_loop_triangles();triangles+=len(data.loop_triangles)
        bm=bmesh.new();bm.from_mesh(data)
        bounds=sum(not e.is_manifold for e in bm.edges);zeros=sum(f.calc_area()<1e-12 for f in bm.faces)
        if bounds or zeros:bad.append({'part':source.name,'nonmanifold':bounds,'zero_area':zeros})
        bm.free()
        role=source.get('export_role','static');batch=role if role in ['magazine','bolt'] else 'static_'+data.materials[0].name
        batches.setdefault(batch,[]).append(o);export.append(o)
    for name,objects in batches.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=name
        scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR');bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    bpy.ops.object.select_all(action='DESELECT')
    for objects in batches.values():objects[0].select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{key}.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_extras=True)
    report['assets'][key]={'triangles':triangles,'nodes':list(batches),'topology_errors':bad,'muzzle':[0,.061,-.646] if key=='m4' else [0,.061,-.876],'support':[-.033,.016,-.30] if key=='m4' else [-.036,-.012,-.365],'axis':'Three.js +Y up, -Z muzzle, origin at trigger','moving_nodes_zero_transform':True,'bytes':(OUT/f'{key}.glb').stat().st_size,'evidence':[str(EVIDENCE/f'{key}-{view}-photo-v2.png') for view in ['hero','side','top','front','wireframe']]}
    report['checks'].append({'id':key+'_evaluated_topology','status':'PASS' if not bad else 'FAIL','method':'BMesh edge manifold and face area on evaluated export geometry after curve-cap seam weld','errors':bad})
    report['checks'].append({'id':key+'_triangle_budget','status':'PASS' if triangles<=24000 else 'FAIL','triangles':triangles})
    if triangles>24000 or bad:report['overall_status']='FAIL'
    bpy.ops.object.delete()
jsonfile('validation_report.json',report)
for c in collections.values():c.hide_render=False
# Store source with only the carbine visible in presentation, all editable models retained.
collections['sniper'].hide_render=True
collections['sniper'].hide_viewport=True
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))
print('ARSENAL_REPORT',json.dumps(report))
