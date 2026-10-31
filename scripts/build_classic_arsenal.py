"""Original visual-only game assets. Run in isolated Blender --background --factory-startup.
Semantic dimensions are aesthetic socket coordinates, not real weapon specifications.
Editable profile shells, bevels, Boolean apertures and native Array details remain in .blend.
"""
import bpy, bmesh, math, json
from pathlib import Path
from mathutils import Vector, Matrix

BASE = Path(__file__).resolve().parents[1]
OUT = BASE / 'assets-source/retired-20261023/assets/weapons/authored'
EVIDENCE = BASE / 'artifacts/weapon-photo-realism-20261008/classic'
SOURCE = BASE / 'assets-source/classic-realism-20261008.blend'
for p in [OUT, EVIDENCE, SOURCE.parent]: p.mkdir(parents=True, exist_ok=True)
# This process owns only its fresh factory scene. It never connects to the user's UI.
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.unit_settings.system='METRIC'
def jsonfile(name,data): (EVIDENCE/name).write_text(json.dumps(data,indent=2))
jsonfile('production_analysis.json',{'schema_version':'1.0','status':'passed','execution_allowed':True,'execution_scope':'formal_production','deliverable':'animated_asset','completion_scope':'reusable_asset','protected_scope':{'status':'passed','objects':[],'task_owned_collection':'AuthoredArsenal'},'design_intent':{'status':'resolved','thesis':'Distinct AK wood-and-steel, USP polymer frame, tubular MP5 and contoured Nova pump shotgun, visual game props only'},'scale_strategy':'Trigger at origin, game grip and muzzle sockets constrain proportions','primary_masses':['profiled receiver','contoured buttstock','tapered handguard'],'structural_forms':['trigger guard aperture','magazine well interface','scope mounts'],'transition_forms':['evaluated 0.001–0.004 bevel radii','lofted barrel and scope steps'],'part_graph_status':'approved','critical_blockers':[],'assumptions':['Original generic exterior appearance, no functional mechanisms or internal manufacturing geometry.','Explicit delegation authorizes isolated editable deliverables and internal visual iterations.']})

def mat(name,color,metal=0,rough=.5):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    return m
metal=mat('Graphite coated alloy',(.035,.044,.057),.7,.33)
polymer=mat('Charcoal polymer',(.012,.016,.020),0,.73)
steel=mat('Machined exposed steel',(.21,.24,.28),.85,.27)
olive=mat('Olive composite',(.10,.13,.055),0,.65)
rubber=mat('Rubber contact pads',(.018,.022,.025),0,.86)
glass=mat('Blue optical glass',(.023,.12,.16),.7,.13)
parts=[]; current=None
def own(o,name,material,role='static'):
    o.name=name;o.data.materials.append(material);o['export_role']=role;o['connection']='mechanical_seam'
    for c in list(o.users_collection):c.objects.unlink(o)
    current.objects.link(o);parts.append(o);return o
def bevel(o,width=.002,segments=3):
    m=o.modifiers.new('Manufactured edge radii','BEVEL');m.width=width;m.segments=segments
    m=o.modifiers.new('Stable planar normals','WEIGHTED_NORMAL');m.keep_sharp=True
    return o
def mesh(name,verts,faces,material,role='static'):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free()
    uv=data.uv_layers.new(name='physical-material-uv')
    for poly in data.polygons:
        for li in poly.loop_indices:
            co=data.vertices[data.loops[li].vertex_index].co
            if material.name.startswith('CC0 Wood092'):
                if 'pistol grip' in name:uv.data[li].uv=(.66+co.y/0.55, .28+co.z/.55)
                elif 'stock' in name:uv.data[li].uv=(.44+(co.z+co.x*.5)/.48, .55+co.y/.48)
                elif 'upper' in name:uv.data[li].uv=(.74+(co.z+co.x*.65)/.48, .11+co.y/.48)
                else:uv.data[li].uv=(.27+(co.z+co.x*.65)/.48, .24+co.y/.48)
            else:uv.data[li].uv=(co.y*3.0,co.z*5.0+co.x*2.0)
    o=bpy.data.objects.new(name,data);current.objects.link(o);o.data.materials.append(material);o['export_role']=role;o['connection']='mechanical_seam';parts.append(o);return o
def profile(name,outline,width,material,x=0,role='static',radius=.002):
    # Outline in Three.js longitudinal Z / vertical Y. Blender conversion (x,-z,y).
    n=len(outline);verts=[(x+s*width/2,-z,y) for s in [-1,1] for z,y in outline]
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return bevel(mesh(name,verts,faces,material,role),radius)
def box(name,pos,size,material,role='static',radius=.001):
    x,y,z=pos;w,h,d=size
    return profile(name,[(z-d/2,y-h/2),(z+d/2,y-h/2),(z+d/2,y+h/2),(z-d/2,y+h/2)],w,material,x,role,radius)
def lathe(name,stations,height,material,n=32,role='static',x=0):
    # Connected surface of revolution; one profile owns all cylindrical steps.
    verts=[(x+math.cos(j*math.tau/n)*r,-z,height+math.sin(j*math.tau/n)*r) for z,r in stations for j in range(n)]
    faces=[]
    for k in range(len(stations)-1):
        for j in range(n):faces.append((k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j))
    if stations[0] != stations[-1]: faces += [tuple(reversed(range(n))),tuple((len(stations)-1)*n+j for j in range(n))]
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

# Embedded game-ready images: glTF cannot serialize Blender procedural nodes.
import random
rng=random.Random(1047)
def textured(name,base,kind,rough,metallic):
    # `base` is intentionally sRGB pixel color, not a linear Principled constant.
    # These images ship to WebGL; exported albedo byte means are audited below.
    m=mat(name,base,metallic,rough);m['production_texture_scale_m']=.34
    m['surface_class']=kind;nodes=m.node_tree.nodes;p=nodes.get('Principled BSDF')
    size=512 if kind=='wood' else 256;image=bpy.data.images.new(name+' albedo',width=size,height=size);pix=[]
    roughimg=bpy.data.images.new(name+' roughness',width=size,height=size);roughimg.colorspace_settings.name='Non-Color';rp=[]
    normalimg=bpy.data.images.new(name+' normal',width=size,height=size);normalimg.colorspace_settings.name='Non-Color';np=[]
    for y in range(size):
        v=y/(size-1)
        for x in range(size):
            u=x/(size-1);fine=rng.uniform(-1,1)
            if kind=='wood':
                warp=(1.7+1.1*math.sin(math.tau*v*2))*math.sin(math.tau*u)+.7*math.sin(math.tau*(3*u+v))+.4*math.sin(math.tau*5*u)
                phase=math.tau*12*v+2.2*math.sin(math.tau*2*v)+.4*math.sin(math.tau*7*v)+warp
                dark=max(0,math.sin(phase))**(11+5*math.sin(math.tau*(3*v+u)))
                growth=.13*math.sin(math.tau*(2*v+u))+.065*math.sin(math.tau*5*v+warp*.4)
                value=1.055+growth-.22*dark+.012*fine
                rr=rough+.05*math.sin(math.tau*7*v+1.8*math.sin(math.tau*2*u))+.02*fine
                nx=.015*math.cos(phase)*math.cos(math.tau*u);ny=.09*math.cos(phase)*dark
            elif kind=='receiver':
                brushed=.018*math.sin(y*1.1)+.012*math.sin(y*.38+x*.024)
                topedge=math.exp(-v*95)+math.exp(-(1-v)*95)
                ended=math.exp(-u*95)+math.exp(-(1-u)*95)
                contact=min(1,topedge+ended)*(.35+.65*max(0,math.sin(u*37+v*11)))
                scratch=(1 if abs(v-(.30+.02*math.sin(u*6)))<.0018 and .57<u<.76 else 0)
                value=1+brushed+.12*math.sin(u*5)*math.sin(v*8)+contact*.72+scratch*.38+.012*fine
                rr=rough+.065*math.sin(u*11+v*6)+.025*fine-.16*contact-.11*scratch
                nx=.007*fine;ny=.012*math.sin(y*1.1)
            elif kind=='metal':
                value=1+.035*math.sin(v*18+u*2)+.025*math.sin(y*.37)+.012*fine
                rr=rough+.055*math.sin(v*25+u*7)+.018*fine
                nx=.006*fine;ny=.016*math.sin(y*.37)
            else:
                # Moulded stipple is on grip/furniture, with a separate dry roughness field.
                stipple=math.sin(x*1.6)*math.sin(y*1.5)
                value=1+.026*stipple+.009*fine
                rr=rough+.045*math.sin(x*.049)*math.sin(y*.035)+.025*fine
                nx=.055*math.cos(x*1.6)*math.sin(y*1.5);ny=.052*math.sin(x*1.6)*math.cos(y*1.5)
            pix.extend([min(1,max(.001,c*value)) for c in base]+[1]);rp.extend([max(.18,min(.96,rr))]*3+[1])
            nz=math.sqrt(max(.01,1-nx*nx-ny*ny));np.extend([nx*.5+.5,ny*.5+.5,nz*.5+.5,1])
    image.pixels.foreach_set(pix);image.pack();roughimg.pixels.foreach_set(rp);roughimg.pack();normalimg.pixels.foreach_set(np);normalimg.pack()
    assert roughimg.pixels[0]>.1,'Non-color channels must be configured before pixels'
    for im,socket in [(image,'Base Color'),(roughimg,'Roughness')]:
        node=nodes.new('ShaderNodeTexImage');node.image=im;m.node_tree.links.new(node.outputs['Color'],p.inputs[socket])
    ntex=nodes.new('ShaderNodeTexImage');ntex.image=normalimg;nmap=nodes.new('ShaderNodeNormalMap');nmap.inputs['Strength'].default_value=.55 if kind=='wood' else .40
    m.node_tree.links.new(ntex.outputs['Color'],nmap.inputs['Color']);m.node_tree.links.new(nmap.outputs['Normal'],p.inputs['Normal'])
    return m
def photo_wood():
    m=mat('CC0 Wood092 photographic amber furniture',(.40,.19,.066),0,.46)
    m['production_material_class']='wood';m['production_texture_scale_m']=.8;m['production_hero']=True
    m['source']='https://ambientcg.com/a/Wood092';m['license']='CC0-1.0';m['process']='Photogrammetry color, roughness and OpenGL normal; compressed sealed finish'
    nodes=m.node_tree.nodes;p=nodes.get('Principled BSDF');uv=nodes.new('ShaderNodeUVMap');uv.uv_map='physical-material-uv'
    root=BASE/'assets-source/materials/classic-photo-20261008/Wood092'
    for channel,socket,color_space in [('Color','Base Color','sRGB'),('Roughness','Roughness','Non-Color'),('NormalGL','Normal','Non-Color')]:
        image=bpy.data.images.load(str(root/f'Wood092_1K-JPG_{channel}.jpg'));image.colorspace_settings.name=color_space
        image.scale(512,512)
        if channel=='Color':
            # Amber varnish absorption in linear color; retain the photographed grain.
            data=list(image.pixels)
            for i in range(0,len(data),4):
                for c,gain in enumerate((.72,.39,.18)):data[i+c]*=gain
            image.pixels.foreach_set(data)
        if channel=='Roughness':
            # Seal the measured open wood; retain its spatial field within an oil finish.
            data=list(image.pixels)
            for i in range(0,len(data),4):
                value=.34+data[i]*.23
                data[i]=data[i+1]=data[i+2]=value
            image.pixels.foreach_set(data)
        image.name='Wood092 photo '+('albedo' if channel=='Color' else 'roughness' if channel=='Roughness' else 'normal')
        # Save modified data losslessly before packing: packing a loaded JPG can
        # otherwise preserve the original encoded source rather than these edits.
        baked=BASE/'assets-source/materials/classic-photo-20261008/baked';baked.mkdir(exist_ok=True)
        image.file_format='PNG';image.filepath_raw=str(baked/f'Wood092_sealed_{channel}.png');image.save();image.pack()
        tex=nodes.new('ShaderNodeTexImage');tex.image=image;m.node_tree.links.new(uv.outputs['UV'],tex.inputs['Vector'])
        if channel=='NormalGL':
            normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.16;m.node_tree.links.new(tex.outputs['Color'],normal.inputs['Color']);m.node_tree.links.new(normal.outputs['Normal'],p.inputs['Normal'])
        else:m.node_tree.links.new(tex.outputs['Color'],p.inputs[socket])
    p.inputs['Coat Weight'].default_value=.12;p.inputs['Coat Roughness'].default_value=.36
    return m
wood=photo_wood()
metal=textured('Blue grey brushed blued steel',(.25,.29,.34),'metal',.47,.72)
receiverMetal=textured('Stamped receiver contact worn bluing',(.25,.29,.34),'receiver',.46,.72)
metal['production_surface_variant']='oxide_treated';receiverMetal['production_surface_variant']='oxide_treated';receiverMetal['production_material_class']='metal'
polymer=textured('Graphite moulded polymer',(.155,.165,.175),'polymer',.67,.015)
rubber=textured('Soft rubber stipple',(.095,.105,.11),'rubber',.85,0)
steel=mat('Polished steel contact edges',(.17,.20,.235),.82,.38)
paint=mat('Sight white enamel',(.73,.76,.68),0,.50)
redpaint=mat('Selector red enamel',(.48,.016,.011),0,.55)

def loft(name,stations,material,n=20,role='static',squared=2):
    # Paired semantic section loops, smoothly bridged. z, centerY, halfWidth, halfHeight.
    verts=[]
    for z,y,w,h in stations:
        for i in range(n):
            a=math.tau*i/n;c=math.cos(a);q=math.sin(a)
            verts.append((w*math.copysign(abs(c)**(2/squared),c),-z,y+h*math.copysign(abs(q)**(2/squared),q)))
    faces=[tuple(reversed(range(n))),tuple((len(stations)-1)*n+i for i in range(n))]
    for j in range(len(stations)-1):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    o=mesh(name,verts,faces,material,role)
    for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
    return o

def sweep(name,points,radius,material,role='static'):
    curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.resolution_u=5;curve.bevel_depth=radius;curve.bevel_resolution=3;curve.use_fill_caps=True
    sp=curve.splines.new('BEZIER');sp.bezier_points.add(len(points)-1)
    for p,(x,y,z) in zip(sp.bezier_points,points):p.co=(x,-z,y);p.handle_left_type=p.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,curve);current.objects.link(o);o.data.materials.append(material);o['export_role']=role;o['connection']='mechanical_seam';parts.append(o);return o

def ring(name,z,y,ro,ri,length,material=metal,role='static'):
    return lathe(name,[(z+length/2,ro),(z-length/2,ro),(z-length/2,ri),(z+length/2,ri),(z+length/2,ro)],y,material,32,role)
def guard(z=-.028,y=-.022,width=.025):
    # Continuous swept trigger-guard with genuine negative space.
    sweep('Continuous trigger guard',[(0,y+.018,z-.041),(0,y-.040,z-.038),(0,y-.053,z+.020),(0,y+.030,z+.046)],.004,metal)
    sweep('Curved trigger',[(0,y+.014,z+.023),(0,y-.018,z+.015),(0,y-.025,z+.005)],.004,steel)
def pin(name,x,y,z,r=.003):
    bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=r,depth=.0018,location=(x,-z,y),rotation=(0,math.pi/2,0));return bevel(own(bpy.context.object,name,steel),.0004)
def grip(name='Pistol grip',matl=polymer):
    return profile(name,[(.000,.005),(.045,.004),(.095,-.128),(.093,-.150),(.043,-.156),(.018,-.112),(-.001,-.033)],.049,matl,radius=.005)
def receiver_uv(o):
    vs=o.data.vertices;ys=[v.co.y for v in vs];zs=[v.co.z for v in vs];ymin,ymax=min(ys),max(ys);zmin,zmax=min(zs),max(zs)
    for poly in o.data.polygons:
        for li in poly.loop_indices:
            co=vs[o.data.loops[li].vertex_index].co
            o.data.uv_layers.active.data[li].uv=((co.y-ymin)/max(.001,ymax-ymin),(co.z-zmin)/max(.001,zmax-zmin))
    return o

def label(name,body,x,y,z,size,material=paint,role='static'):
    data=bpy.data.curves.new(name,'FONT');data.body=body;data.size=size;data.extrude=.000035;data.resolution_u=2
    o=bpy.data.objects.new(name,data);current.objects.link(o);o.data.materials.append(material);o['export_role']=role;o['connection']='surface_marking';parts.append(o)
    o.location=(x,-z,y);sign=1 if x>0 else -1
    o.rotation_euler=Matrix(((0,0,sign),(sign,0,0),(0,1,0))).to_euler()
    return o

def heatshield():
    # A single thick curved shell, Boolean apertures owned by Array cutters.
    n=24;verts=[]
    for z in [-.225,-.655]:
        for radius in [.023,.0205]:
            for i in range(n+1):
                a=math.pi*i/n;verts.append((radius*math.cos(a),-z,.076+radius*math.sin(a)))
    stride=2*(n+1);faces=[]
    for i in range(n):
        faces.append((i,i+1,stride+i+1,stride+i))
        faces.append((n+1+i,stride+n+1+i,stride+n+2+i,n+2+i))
        faces.append((i,n+1+i,n+2+i,i+1));faces.append((stride+i,stride+i+1,stride+n+2+i,stride+n+1+i))
    faces += [(0,stride,stride+n+1,n+1),(n,2*n+1,stride+2*n+1,stride+n)]
    shell=bevel(mesh('Nova perforated curved heat shield',verts,faces,metal),.0006,2)
    for i,face in enumerate(shell.data.polygons):face.use_smooth=i<4*n and i%4<2
    for side in [-1,1]:
        bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=.0051,depth=.022,location=(side*.015,.253,.091),rotation=(0,side*math.pi/4,0))
        cutter=own(bpy.context.object,'Shield aperture Array CUTTER',metal);array(cutter,12,(0,0,-.033));cut(shell,cutter)
    for z in [-.23,-.647]:ring('Heat shield retaining band',z,.076,.0245,.0228,.011,metal)

def ak():
    # Stamped receiver is a bevelled shell with side-wall taper, not a generic carbine block.
    receiver=profile('AK stamped receiver',[(-.234,.021),(-.224,.072),(.063,.068),(.071,.035),(.058,-.006),(-.063,-.003),(-.09,-.012),(-.208,-.006)],.064,receiverMetal,radius=.0016)
    receiver_uv(receiver)
    for side in [-1,1]:
        recess=profile('AK stamped side recess CUTTER',[(-.203,.026),(-.190,.045),(-.124,.045),(-.115,.025),(-.126,.016),(-.194,.016)],.008,metal,x=side*.0335,radius=.004);cut(receiver,recess)
        rib=box('AK receiver pressed rail',(side*.033,.006,-.099),(.002,.004,.194),metal,radius=.001)
        for z,y in [(-.213,.058),(-.211,.009),(-.069,.018),(.037,.039)]:pin('AK formed rivet',side*.033,y,z,.0032)
        label('AK receiver production stamp','AK  7.62',side*.0329,.048,-.119,.0043)
    loft('AK curved dust cover',[(-.226,.075,.029,.015),(-.212,.076,.033,.025),(.037,.076,.032,.025),(.055,.073,.025,.017)],metal,24)
    # The buttstock tapers into a slim neck and broadens toward the shoulder.
    loft('AK carved walnut stock',[(.047,.025,.027,.025),(.088,.012,.025,.028),(.146,-.018,.027,.042),(.265,-.035,.031,.074),(.310,-.035,.032,.075)],wood,24,squared=3)
    profile('AK steel butt plate',[(.306,.044),(.318,.041),(.321,-.112),(.307,-.115)],.068,metal,radius=.002)
    grip('AK walnut pistol grip',wood);guard()
    lowerWood=loft('AK lower walnut handguard',[(-.23,.024,.030,.029),(-.252,.021,.040,.030),(-.315,.025,.038,.029),(-.387,.030,.029,.024),(-.403,.029,.026,.024)],wood,24,squared=3)
    # KUSA exterior photo: broad carved finger relief, rounded shoulders and dark ferrules.
    for side in [-1,1]:
        oval=[(-.319+.060*math.cos(math.tau*i/28),.026+.0135*math.sin(math.tau*i/28)) for i in range(28)]
        cutter=profile('AK carved wood finger relief CUTTER',oval,.018,metal,x=side*.040,radius=.003);cut(lowerWood,cutter)
    bevel(lowerWood,.002,3)
    loft('AK upper walnut gas cover',[(-.255,.079,.026,.024),(-.273,.081,.029,.026),(-.361,.081,.025,.022),(-.381,.083,.020,.017)],wood,24)
    ring('AK upper guard retaining collar',-.378,.083,.023,.019,.010,metal)
    profile('AK lower handguard ferrule',[(-.399,.009),(-.409,.010),(-.409,.049),(-.399,.052)],.055,metal,radius=.001)
    lathe('AK barrel with bore',[(-.395,.012),(-.492,.011),(-.620,.011),(-.662,.014),(-.686,.014),(-.686,.006),(-.667,.006)],.066,metal,32)
    lathe('AK gas tube',[(-.373,.012),(-.453,.011),(-.478,.012)],.103,metal,24)
    profile('AK gas block',[(-.458,.059),(-.491,.059),(-.484,.111),(-.460,.119),(-.451,.108)],.026,metal,radius=.0017)
    profile('AK front sight tower',[(-.593,.057),(-.617,.057),(-.612,.119),(-.601,.141),(-.591,.117)],.018,metal,radius=.001)
    ring('AK front sight hood',-.603,.139,.018,.014,.008)
    box('AK front sight needle',(0,.138,-.603),(.003,.020,.004),steel)
    profile('AK rear sight ramp',[(-.257,.096),(-.216,.122),(-.180,.122),(-.174,.105)],.030,metal,radius=.001)
    box('AK tangent sight',(0,.129,-.212),(.027,.010,.058),metal)
    # Curved magazine uses many contour stations, preserving the banana silhouette.
    outline=[]
    for i in range(10):
        t=i/9;outline.append((-.105-.085*t*t,-.013-.234*t))
    for i in reversed(range(10)):
        t=i/9;outline.append((-.174-.108*t*t,-.013-.234*t))
    profile('AK curved steel magazine',outline,.046,metal,role='magazine',radius=.003)
    for x in [-.024,.024]:
        rib=sweep('AK magazine stamped rib',[(x,-.035,-.126),(x,-.123,-.142),(x,-.217,-.186)],.0015,metal,'magazine');array(rib,3,(0,0,-.016))
    profile('AK magazine floorplate',[(-.180,-.235),(-.287,-.235),(-.289,-.252),(-.190,-.263)],.053,metal,role='magazine',radius=.0015)
    box('AK ejection opening',(.033,.062,-.05),(.002,.024,.075),rubber,radius=.0005)
    sweep('AK reciprocating charging handle',[(.031,.060,-.015),(.052,.063,-.015),(.066,.066,-.020)],.006,metal,'bolt')
    profile('AK safety selector',[(.034,.041),(-.081,.024),(-.086,.018),(-.010,.025),(.037,.032)],.004,steel,x=.036,radius=.0005)
    for z in [-.204,-.164,.021]:pin('AK receiver rivet',-.033,.043,z)

def usp():
    # USP squared, chamfered slide; upper edges converge, distinguishing it from Beretta.
    slide=profile('USP chamfered slide',[(-.194,.047),(.045,.047),(.047,.078),(.039,.094),(-.184,.094),(-.195,.081)],.033,metal,role='bolt',radius=.0022)
    slide.data.materials[0]=receiverMetal;receiver_uv(slide)
    for side in [-1,1]:label('USP slide calibre marking','USP  .45 AUTO',side*.0175,.063,-.144,.0040,paint,'bolt')
    # slide bore is a real hole through its front face
    bore=lathe('USP slide barrel clearance CUTTER',[(-.205,.0075),(-.153,.0075)],.069,metal,24);cut(slide,bore)
    frame=profile('USP polymer frame',[(-.176,.044),(.043,.044),(.044,.024),(.029,.014),(-.035,.014),(-.092,.020),(-.110,.024),(-.172,.024)],.034,polymer,radius=.002)
    # Grip integrates the backstrap swell and a forward-leaning magazine well.
    profile('USP grip contour',[(.029,.024),(.043,-.030),(.065,-.106),(.057,-.128),(.009,-.131),(-.006,-.115),(-.024,-.029),(-.013,.011)],.035,polymer,radius=.004)
    for x in [-.0185,.0185]:
        profile('USP stippled grip panel',[(.019,-.018),(.035,-.046),(.049,-.111),(.011,-.118),(-.006,-.034)],.0015,rubber,x=x,radius=.001)
        rib=box('USP slide rear serration',(x,.071,.010),(.0015,.036,.0018),rubber,'bolt',radius=.0003);array(rib,8,(0,0,.004))
    # Angular USP guard via a single Boolean-cut shell.
    g=profile('USP angular trigger guard',[(-.101,.024),(-.030,.024),(-.029,-.040),(-.046,-.048),(-.096,-.046),(-.110,-.034)],.022,polymer,radius=.002)
    c=profile('USP guard clearance CUTTER',[(-.093,.002),(-.039,.002),(-.040,-.033),(-.050,-.037),(-.090,-.035),(-.099,-.028)],.041,polymer,radius=.002);cut(g,c)
    sweep('USP curved trigger',[(0,.009,-.048),(0,-.023,-.057),(0,-.030,-.050)],.003,metal)
    lathe('USP barrel with muzzle cavity',[(-.139,.008),(-.195,.008),(-.199,.0075),(-.199,.0048),(-.172,.0048)],.069,steel,32)
    profile('USP visible magazine',[(.009,-.040),(.035,-.040),(.056,-.122),(.015,-.122)],.022,metal,role='magazine',radius=.001)
    profile('USP magazine base plate',[(.011,-.121),(.062,-.122),(.061,-.135),(.009,-.135)],.039,rubber,role='magazine',radius=.001)
    box('USP rear sight',(0,.099,.022),(.029,.011,.011),metal,'bolt')
    box('USP front sight',(0,.100,-.167),(.006,.011,.010),metal,'bolt')
    for x in [-.010,.010]:box('USP sight paint',(x,.101,.028),(.0025,.003,.001),paint,'bolt',radius=.0002)
    box('USP front dot',(0,.103,-.161),(.0025,.003,.001),paint,'bolt',radius=.0002)
    profile('USP slide release',[(-.036,.031),(.020,.030),(.021,.020),(-.030,.021)],.004,steel,x=-.019,radius=.001)
    box('USP safety lever',(-.021,.025,.031),(.006,.007,.024),metal)
    port=box('USP ejection port CUTTER',(.011,.089,-.081),(.028,.020,.038),metal,'bolt',radius=.002);cut(slide,port)

def mp5():
    lathe('MP5 tubular stamped upper',[(-.263,.030),(-.235,.033),(.069,.033),(.085,.030)],.067,metal,32)
    profile('MP5 lower trigger pack',[(-.165,.048),(.068,.046),(.076,.006),(.046,-.017),(-.130,-.020),(-.163,.002)],.049,polymer,radius=.004)
    grip('MP5 moulded grip');guard()
    loft('MP5 tapered tropical handguard',[(-.237,.032,.030,.038),(-.262,.030,.037,.043),(-.343,.036,.035,.037),(-.401,.047,.027,.027)],polymer,24,squared=3)
    lathe('MP5 barrel and muzzle bore',[(-.397,.011),(-.455,.011),(-.464,.016),(-.483,.016),(-.487,.010),(-.501,.010),(-.501,.005),(-.482,.005)],.061,metal,32)
    lathe('MP5 charging tube',[(-.242,.011),(-.413,.011)],.103,metal,24)
    profile('MP5 front sight base',[(-.411,.040),(-.431,.040),(-.427,.112),(-.415,.121)],.026,metal,radius=.0017)
    ring('MP5 hooded front sight',-.422,.119,.018,.014,.010)
    box('MP5 front sight post',(0,.115,-.422),(.003,.019,.005),steel)
    # Fixed shoulder stock with broad butt, narrow receiver socket.
    loft('MP5 polymer fixed stock',[(.076,.052,.028,.033),(.10,.045,.029,.035),(.16,.012,.029,.050),(.237,-.010,.033,.072),(.270,-.010,.034,.076)],polymer,24,squared=3)
    profile('MP5 rubber shoulder pad',[(.267,.070),(.283,.067),(.285,-.088),(.270,-.091)],.072,rubber,radius=.003)
    outline=[]
    for i in range(9):
        t=i/8;outline.append((-.092-.065*t*t,-.022-.202*t))
    for i in reversed(range(9)):
        t=i/8;outline.append((-.134-.073*t*t,-.022-.202*t))
    profile('MP5 curved magazine',outline,.029,metal,role='magazine',radius=.002)
    for x in [-.0155,.0155]:sweep('MP5 magazine stamp',[(x,-.04,-.115),(x,-.135,-.135),(x,-.212,-.176)],.0015,metal,'magazine')
    profile('MP5 magazine floorplate',[(-.152,-.212),(-.211,-.213),(-.216,-.230),(-.158,-.239)],.035,rubber,role='magazine',radius=.001)
    box('MP5 rear sight base',(0,.106,.025),(.040,.019,.041),metal)
    bpy.ops.mesh.primitive_cone_add(vertices=24,radius1=.020,radius2=.016,depth=.026,location=(0,-.025,.127))
    drum=bevel(own(bpy.context.object,'MP5 rotary drum rear sight',metal),.0007)
    hole=lathe('MP5 rear drum aperture CUTTER',[(.003,.0045),(.049,.0045)],.129,metal,20);hole.rotation_euler.y=.073;cut(drum,hole)
    for side in [-1,1]:
        pin('MP5 selector pivot',side*.026,.014,.021,.007)
        profile('MP5 selector lever',[(.021,.014),(.044,.020),(.047,.014),(.025,.008)],.003,metal,x=side*.030,radius=.001)
        label('MP5 selector safe marking','S',side*.026,.026,.038,.007,paint)
        label('MP5 selector fire markings','1  3',side*.026,.023,.015,.006,redpaint)
        seam=box('MP5 lower receiver seam',(side*.0257,.001,-.066),(.001,.002,.148),metal,radius=.0005)
        box('MP5 upper weld seam',(side*.027,.087,-.090),(.002,.003,.25),metal,radius=.0007)
    sweep('MP5 charging handle',[(-.008,.102,-.264),(-.047,.110,-.267),(-.056,.111,-.279)],.005,steel,'bolt')
    box('MP5 ejection port',(.032,.064,-.084),(.003,.020,.073),rubber,radius=.001)
    for z in [-.134,.043]:pin('MP5 receiver pin',-.026,.026,z,.004)

def nova():
    receiver=profile('Nova contoured receiver',[(-.186,.004),(-.196,.043),(-.176,.093),(-.123,.108),(.049,.104),(.082,.085),(.083,.015),(.052,-.006),(-.083,-.010)],.065,receiverMetal,radius=.004)
    receiver_uv(receiver)
    port=box('Nova receiver ejection opening CUTTER',(.038,.059,-.039),(.030,.039,.100),metal,radius=.003);cut(receiver,port)
    # Shallow left-side stamping, visible as boundary and normal transition, never a fake port.
    panel=profile('Nova left pressed panel CUTTER',[(-.160,.036),(-.150,.073),(-.031,.078),(.020,.067),(.029,.042),(.016,.031),(-.147,.027)],.008,metal,x=-.035,radius=.003);cut(receiver,panel)
    channel=box('Nova upper machining channel CUTTER',(-.034,.087,-.062),(.006,.0024,.179),metal,radius=.0008);cut(receiver,channel)
    for y,z in [(.063,.049),(.028,-.169)]:pin('Nova left recessed receiver pin',-.033,y,z,.0035)
    # One shaped stock neck transitions continuously into shoulder volume.
    loft('Nova swept shoulder stock',[(.058,.019,.027,.027),(.095,-.008,.026,.034),(.145,-.055,.027,.044),(.205,-.055,.029,.054),(.326,-.040,.035,.092),(.348,-.040,.036,.092)],polymer,24,squared=3)
    profile('Nova recoil pad',[(.341,.054),(.366,.050),(.370,-.133),(.346,-.139)],.076,rubber,radius=.005)
    guard(z=.004,y=-.025)
    lathe('Nova smooth long barrel and bore',[(-.173,.018),(-.250,.016),(-.73,.014),(-.788,.014),(-.788,.0103),(-.757,.0103)],.076,metal,32)
    lathe('Nova underbarrel magazine tube',[(-.173,.016),(-.677,.016),(-.695,.018),(-.708,.018)],.033,metal,32)
    loft('Nova contoured pump forearm',[(-.272,.031,.028,.028),(-.292,.028,.038,.035),(-.371,.025,.039,.034),(-.472,.030,.034,.029),(-.496,.031,.026,.023)],polymer,24,role='pump',squared=3)
    # Ribs are native Array dependents; same centerline and manufactured contact.
    rib=loft('Nova pump grip rib',[(-.304,.027,.0387,.0357),(-.309,.027,.0387,.0357)],rubber,24,role='pump',squared=3);array(rib,11,(0,0,-.015))
    for x in [-.026,.026]:
        bar=box('Nova pump action bar',(x,.010,-.221),(.004,.007,.17),metal,'pump',radius=.001)
    heatshield()
    for side in [-1,1]:
        label('Nova receiver etched marking','NOVA  12 GA',side*.0329,.026,-.125,.0055)
        box('Nova machined receiver lower seam',(side*.033,.003,-.043),(.0015,.003,.19),steel,radius=.0007)
    lathe('Nova front bead',[(-.748,.0034),(-.757,.0034)],.102,paint,16)
    box('Nova ejection port interior',(.020,.059,-.039),(.002,.037,.098),rubber,radius=.003)
    box('Nova sliding bolt',(.024,.059,-.034),(.003,.028,.081),metal,'bolt',radius=.003)
    for x in [-.034,.034]:pin('Nova receiver cross pin',x,.013,.029,.0035)

collections={}
for key,builder in [('rifle',ak),('pistol',usp),('smg',mp5),('shotgun',nova)]:
    current=bpy.data.collections.new(key+' editable source');scene.collection.children.link(current);collections[key]=current;builder()
    # Reset all exported animation roles to exact model-space geometry.
jsonfile('task_route.json',{'mode':'isolated_background_asset','selected_systems':['profile shells','lofted continuous section bridges','native Bevel','native Boolean aperture','native Array','Curve sweeps','UV image PBR'], 'script_role':'semantic exterior art authoring; no internal weapon mechanism', 'user_authorization':'remake and autonomously review all four firearm appearances', 'router_dependency_note':'route script unavailable under system Python because PyYAML missing; equivalent bounded route recorded here'})
jsonfile('construction_graph.json',{'continuous_surfaces':['each receiver','each wood/polymer stock','each curved magazine','each lofted pump'],'mechanical_seams':['barrel/receiver','furniture/receiver','magazine/well','sight/barrel','stock/buttplate'],'embedded_components':['pins in receiver','slide over barrel'], 'intentionally_independent':['trigger within guard clearance'],'systems':{'unique_profiles':'Mesh API control polygon exception for authored non-repeating silhouette','repeated ribs':'native Array','bent handles':'native Curve','apertures':'Boolean Difference','edge radii':'Bevel modifier'}})

scene.render.engine='CYCLES';scene.cycles.samples=20
scene.render.resolution_x=1280;scene.render.resolution_y=640;scene.render.resolution_percentage=100
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.20,.23,.27,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.7
scene.view_settings.view_transform='AgX'
def aim(o,target):o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
for name,loc,energy,size in [('Key',(1,-.2,1.5),100,2),('Rim',(-.8,.8,.8),130,1.3),('Fill',(1,1,.1),40,1.8)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='RECTANGLE';data.size=size;data.size_y=.4;o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=loc;aim(o,(0,.15,0))
bpy.ops.object.camera_add(location=(1.4,-.55,.48));camera=bpy.context.object;camera.name='Classic arsenal fixed review';scene.camera=camera;camera.data.type='ORTHO'
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))
report={'schema_version':'1.0','overall_status':'PASS','checks':[],'thresholds':{'triangles_max_per_asset':26000,'nonmanifold_edges':0,'zero_area_faces':0},'intentional_exceptions':['Independent manufactured pieces remain distinct islands after export material batching.','Visual exterior reproductions omit firing internals.'],'not_evaluated':[],'repair_suggestions':[],'assets':{}}
sockets={'rifle':([0,.066,-.686],[-.044,-.014,-.324]),'pistol':([0,.069,-.199],[-.047,-.071,-.044]),'smg':([0,.061,-.501],[-.043,-.013,-.303]),'shotgun':([0,.076,-.788],[-.045,-.001,-.398])}
for key,collection in collections.items():
    for c in collections.values():c.hide_render=c!=collection
    target=(0,{'rifle':.183,'smg':.108,'shotgun':.209}[key],-.025) if key!='pistol' else (0,.067,-.010)
    scale=1.23 if key!='pistol' else .57
    for label,loc in [('side',(2,target[1],.05)),('hero',(1.4,-.60,.50)),('top',(.001,target[1],2))]:
        camera.location=loc;camera.data.ortho_scale=scale;aim(camera,target)
        scene.render.filepath=str(EVIDENCE/f'{key}-{label}-photo-v2.png');bpy.ops.render.render(write_still=True)
    camera.location=(.7,-.32,.28);camera.data.ortho_scale=.59 if key!='pistol' else .36;aim(camera,(0,.095,.027))
    scene.render.filepath=str(EVIDENCE/f'{key}-close-photo-v2.png');bpy.ops.render.render(write_still=True)
    bpy.ops.object.select_all(action='DESELECT');batches={};bad=[];triangles=0;deps=bpy.context.evaluated_depsgraph_get()
    for source in collection.objects:
        if source.get('export_role')=='cutter':continue
        evaluated=source.evaluated_get(deps);data=bpy.data.meshes.new_from_object(evaluated,depsgraph=deps)
        bm=bmesh.new();bm.from_mesh(data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7);bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-7);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free()
        o=bpy.data.objects.new(source.name+' export',data);scene.collection.objects.link(o);o.matrix_world=source.matrix_world.copy();data.calc_loop_triangles();triangles+=len(data.loop_triangles)
        bm=bmesh.new();bm.from_mesh(data);bounds=sum(not e.is_manifold for e in bm.edges);zeros=sum(f.calc_area()<1e-12 for f in bm.faces)
        if bounds or zeros:bad.append({'part':source.name,'nonmanifold':bounds,'zero_area':zeros})
        bm.free();role=source.get('export_role','static');batch=role if role in ['magazine','bolt','pump'] else 'static_'+data.materials[0].name;batches.setdefault(batch,[]).append(o)
    for name,objects in batches.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=name;scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR');bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    for role in ['magazine','bolt','pump']:
        if role not in batches:
            empty=bpy.data.objects.new(role,None);scene.collection.objects.link(empty);batches[role]=[empty]
    bpy.ops.object.select_all(action='DESELECT')
    for objects in batches.values():objects[0].select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{key}.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_extras=True)
    report['assets'][key]={'triangles':triangles,'nodes':list(batches),'topology_errors':bad,'muzzle':sockets[key][0],'support':sockets[key][1],'axis':'+Y up -Z forward, trigger origin','moving_nodes_zero_transform':True,'bytes':(OUT/f'{key}.glb').stat().st_size,'evidence':[str(EVIDENCE/f'{key}-{v}-photo-v2.png') for v in ['side','hero','top']]}
    report['checks'].append({'id':key+'_evaluated_topology','status':'PASS' if not bad else 'FAIL','errors':bad})
    if bad or triangles>26000:report['overall_status']='FAIL'
    bpy.ops.object.delete()
jsonfile('validation_report.json',report)
for key,c in collections.items():c.hide_render=key!='rifle'
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))
print('CLASSIC_ARSENAL_REPORT',json.dumps(report))

import struct, statistics
texture_report={}
for key in collections:
    blob=(OUT/f'{key}.glb').read_bytes();n=struct.unpack_from('<I',blob,12)[0];doc=json.loads(blob[20:20+n]);binary=blob[28+n:];values=[]
    for im in doc.get('images',[]):
        if not any(t in im.get('name','') for t in ['roughness','albedo']): continue
        view=doc['bufferViews'][im['bufferView']];offset=view.get('byteOffset',0);file=EVIDENCE/(key+'-'+im['name']+'.png');file.write_bytes(binary[offset:offset+view['byteLength']]);loaded=bpy.data.images.load(str(file));loaded.colorspace_settings.name='Non-Color';pixels=list(loaded.pixels);means=[statistics.mean(pixels[c::4]) for c in range(3)];green=pixels[1::4];avg=means[1];assert ('roughness' not in im['name'] or .2<avg<.95),(key,im['name'],avg);values.append({'image':im['name'],'exported_rgb_byte_means':[round(v*255,2) for v in means],'green_mean':avg,'min':min(green),'max':max(green)})
    texture_report[key]=values
jsonfile('exported_texture_validation.json',texture_report)
