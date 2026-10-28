"""Dark studio with animated strip lights for product light-sweep shots.

Three shots on one timeline (30 fps), switched by camera markers:
  1-150    hero orbit, a strip light sweeps across the top plate and grip
  151-270  lens close-up, a ring of light slides over the front element
  271-390  top-down glide over the dials with a raking sweep
"""
import math

import bpy
from mathutils import Euler, Vector


FPS = 30


def _look(ob, target, up=(0, 0, 1)):
    """Aim -Z at target; keep the euler continuous with the current one so keys don't spin."""
    from mathutils import Matrix
    f = (Vector(target) - ob.location).normalized()
    r = f.cross(Vector(up))
    if r.length < 1e-6:
        r = f.cross(Vector((0, 1, 0)))
    r.normalize()
    u = r.cross(f)
    ob.rotation_euler = Matrix((r, u, -f)).transposed().to_euler("XYZ", ob.rotation_euler)


def _area(name, size, size_y, radiance, color=(1, 1, 1), shape="RECTANGLE"):
    """Area light set by surface radiance, so highlights stay consistent when resized."""
    ld = bpy.data.lights.new(name, "AREA")
    ld.shape = shape
    ld.size, ld.size_y = size, size_y
    area = size * size_y if shape == "RECTANGLE" else math.pi * size * size / 4
    ld.energy = radiance * math.pi * area
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _key(ob, frame, **kw):
    for k, v in kw.items():
        tgt = ob if hasattr(ob, k) else ob.data
        setattr(tgt, k, v)
        tgt.keyframe_insert(k, frame=frame)


def _ease(ob):
    ad = ob.animation_data
    if ad and ad.action:
        for fc in _fcurves(ad.action):
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
                kp.easing = "EASE_IN_OUT"


def _fcurves(action):
    if hasattr(action, "fcurves"):
        return action.fcurves
    out = []
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                out.extend(bag.fcurves)
    return out


def world_and_floor():
    sc = bpy.context.scene
    w = bpy.data.worlds.new("Studio")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1)
    bg.inputs["Strength"].default_value = 0.0
    # glossy black floor that fades into the dark
    bpy.ops.mesh.primitive_plane_add(size=3.0, location=(0, 0, -0.0002))
    fl = bpy.context.active_object
    fl.name = "Floor"
    m = bpy.data.materials.new("floor")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.004, 0.004, 0.005, 1)
    b.inputs["Roughness"].default_value = 0.22
    b.inputs["Specular IOR Level"].default_value = 0.35
    fl.data.materials.append(m)
    return fl


def lights():
    """Thin, distant strips: bright specular streaks, black diffuse."""
    L = {}
    L["sweep"] = _area("Light_SweepStrip", 2.2, 0.018, 240.0)
    L["rim_l"] = _area("Light_RimLeft", 0.018, 0.7, 160.0, (0.9, 0.95, 1.0))
    L["rim_l"].location = (0.55, 0.45, 0.22)
    _look(L["rim_l"], (0, 0.02, 0.05))
    L["rim_r"] = _area("Light_RimRight", 0.018, 0.7, 160.0, (1.0, 0.96, 0.92))
    L["rim_r"].location = (-0.62, 0.40, 0.25)
    _look(L["rim_r"], (-0.02, 0.02, 0.05))
    L["fill"] = _area("Light_TopFill", 1.0, 1.0, 0.5)
    L["fill"].location = (-0.05, 0.05, 0.9)
    _look(L["fill"], (-0.02, 0.0, 0.0))
    # large gradient card camera-left: long soft reflections that describe the shape
    L["card"] = _area("Light_GradientCard", 0.5, 1.2, 3.5)
    L["card"].location = (-0.75, -0.55, 0.35)
    _look(L["card"], (0, 0, 0.05))
    for ob in L.values():
        ob.visible_camera = False
    # emissive ring that slides over the front element in the lens shot
    from geom import torus
    me = torus("LensRingLight", 0.07, 0.0025, 96, 12)
    ring = bpy.data.objects.new("Light_LensRing", me)
    bpy.context.scene.collection.objects.link(ring)
    m = bpy.data.materials.new("ring_emit")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type == "BSDF_PRINCIPLED":
            nt.nodes.remove(n)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 0.0
    nt.links.new(em.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    me.materials.append(m)
    ring.visible_camera = False
    L["ring"] = ring
    L["ring_emit"] = em
    return L


def link_lights(L, coll):
    """Key lights only light the camera, so the glossy floor shows no light streaks."""
    for k in ("sweep", "rim_l", "rim_r", "card"):
        L[k].light_linking.receiver_collection = coll


def camera(name, lens=85.0):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.clip_start = 0.005
    cd.clip_end = 20
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = 5.6
    ob = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def focus_targets():
    """Empties at the points each shot keeps sharp (metres)."""
    out = []
    for name, loc in (("Focus_Hero", (-0.02, -0.01, 0.07)), ("Focus_Lens", (0.0, -0.088, 0.0402)),
                      ("Focus_Top", (-0.02, 0.02, 0.08))):
        e = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(e)
        e.location = loc
        e.empty_display_size = 0.01
        out.append(e)
    return out


def animate(L, focus_hero, focus_lens, focus_top):
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 1, 390

    # shot 1: hero orbit
    c1 = camera("Cam_Hero", 85)
    tgt = Vector((-0.018, -0.02, 0.045))
    for f, ang, dist, h in ((1, -62, 0.62, 0.17), (150, -28, 0.55, 0.13)):
        a = math.radians(ang - 90)
        c1.location = tgt + Vector((math.cos(a) * dist, math.sin(a) * dist, h))
        _look(c1, tgt)
        c1.keyframe_insert("location", frame=f)
        c1.keyframe_insert("rotation_euler", frame=f)
    c1.data.dof.focus_object = focus_hero
    c1.data.dof.aperture_fstop = 8

    # shot 2: lens close-up
    c2 = camera("Cam_Lens", 100)
    lt = Vector((0, -0.09, 0.0402))
    for f, ang, dist, h in ((151, -22, 0.36, 0.06), (270, 14, 0.33, 0.035)):
        a = math.radians(ang - 90)
        c2.location = lt + Vector((math.cos(a) * dist, math.sin(a) * dist, h))
        _look(c2, lt + Vector((0, 0.03, 0)))
        c2.keyframe_insert("location", frame=f)
        c2.keyframe_insert("rotation_euler", frame=f)
    c2.data.dof.focus_object = focus_lens
    c2.data.dof.aperture_fstop = 11

    # shot 3: top-down glide over the dials
    c3 = camera("Cam_Top", 70)
    for f, x in ((271, 0.045), (390, -0.075)):
        c3.location = (x, 0.05, 0.36)
        _look(c3, (x * 0.8, 0.02, 0.075), up=(0, -1, 0))
        c3.keyframe_insert("location", frame=f)
        c3.keyframe_insert("rotation_euler", frame=f)
    c3.data.dof.focus_object = focus_top
    c3.data.dof.aperture_fstop = 6.3

    for f, cam in ((1, c1), (151, c2), (271, c3)):
        mk = sc.timeline_markers.new(cam.name, frame=f)
        mk.camera = cam
    sc.camera = c1

    s = L["sweep"]
    body = (-0.018, 0.0, 0.05)

    def sweep(f, loc, up, target=body):
        s.location = loc
        _look(s, target, up)
        s.keyframe_insert("location", frame=f)
        s.keyframe_insert("rotation_euler", frame=f)

    # 1: strip (long axis front-back) crosses high above the body, left to right
    sweep(1, (0.70, -0.30, 0.70), (1, 0, 0))
    sweep(150, (-0.75, -0.25, 0.65), (1, 0, 0))
    # 2: vertical strip passes in front of the lens
    sweep(151, (0.40, -0.75, 0.10), (1, 0, 0), (0, -0.09, 0.04))
    sweep(270, (-0.40, -0.75, 0.06), (1, 0, 0), (0, -0.09, 0.04))
    # 3: strip (long axis left-right) rakes over the top plate from front to back
    sweep(271, (-0.02, -0.60, 0.30), (0, 1, 0), (-0.02, 0.0, 0.08))
    sweep(390, (-0.02, 0.60, 0.34), (0, 1, 0), (-0.02, 0.0, 0.08))
    for f in (150, 270):
        for fc in _fcurves(s.animation_data.action):
            for kp in fc.keyframe_points:
                if abs(kp.co[0] - f) < 0.5 or abs(kp.co[0] - f - 1) < 0.5:
                    kp.interpolation = "CONSTANT"
    r = L["ring"]
    em = L["ring_emit"]
    r.rotation_euler = Euler((math.radians(90), 0, 0))
    r.location = (0.02, -0.19, 0.06)
    r.keyframe_insert("location", frame=151)
    r.location = (-0.02, -0.19, 0.025)
    r.keyframe_insert("location", frame=270)
    st = em.inputs["Strength"]
    for f, v in ((150, 0.0), (158, 25.0), (262, 25.0), (270, 0.0)):
        st.default_value = v
        st.keyframe_insert("default_value", frame=f)
    return c1, c2, c3


def render_settings(samples=256, res=(1920, 1080)):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.015
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 12
    sc.cycles.glossy_bounces = 6
    sc.cycles.transmission_bounces = 12
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "AgX"
    try:
        sc.view_settings.look = "AgX - Punchy"
    except TypeError:
        pass
    sc.render.film_transparent = False
