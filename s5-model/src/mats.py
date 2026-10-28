"""Cycles materials for the S5 model. Texture coordinates are object space in mm."""
import bpy

_cache = {}


def _new(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    return m, nt, bsdf


def _set(bsdf, **kw):
    names = {"base": "Base Color", "metal": "Metallic", "rough": "Roughness", "ior": "IOR",
             "coat": "Coat Weight", "coat_rough": "Coat Roughness", "aniso": "Anisotropic",
             "aniso_rot": "Anisotropic Rotation", "trans": "Transmission Weight", "spec": "Specular IOR Level",
             "film": "Thin Film Thickness", "film_ior": "Thin Film IOR", "emit": "Emission Color",
             "emit_s": "Emission Strength", "alpha": "Alpha", "sheen": "Sheen Weight", "sheen_rough": "Sheen Roughness"}
    for k, v in kw.items():
        sock = bsdf.inputs[names[k]]
        if k in ("base", "emit"):
            v = (*v, 1.0) if len(v) == 3 else v
        sock.default_value = v


def _coords(nt):
    tc = nt.nodes.new("ShaderNodeTexCoord")
    return tc.outputs["Object"]


def _bump(nt, height, strength, relief_mm, normal_in=None):
    """Bump from a 0..1 height field whose full range is relief_mm deep.

    The Bump node works in world units (metres) while the model lives under a
    root scaled 0.001, so the relief is converted here.
    """
    b = nt.nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = strength
    b.inputs["Distance"].default_value = relief_mm * 0.001
    nt.links.new(height, b.inputs["Height"])
    if normal_in is not None:
        nt.links.new(normal_in, b.inputs["Normal"])
    return b.outputs["Normal"]


def _noise(nt, co, scale, detail=2.0, rough=0.5):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    nt.links.new(co, n.inputs["Vector"])
    return n.outputs["Fac"]


def _radial_tangent(nt, axis="Z"):
    t = nt.nodes.new("ShaderNodeTangent")
    t.direction_type = "RADIAL"
    t.axis = axis
    return t.outputs["Tangent"]


def get(name):
    if name in _cache:
        return _cache[name]
    m = globals()["_" + name]()
    m.name = name
    _cache[name] = m
    return m


# ------------------------------------------------------------------ body

def _paint():
    """Magnesium body: black paint with a sand-blasted grain that sparkles in highlights."""
    m, nt, b = _new("paint")
    _set(b, base=(0.014, 0.014, 0.015), rough=0.4, coat=0.15, coat_rough=0.35, spec=0.5)
    co = _coords(nt)
    fine = _noise(nt, co, 16.0, 4.0, 0.7)
    grit = nt.nodes.new("ShaderNodeTexVoronoi")
    grit.inputs["Scale"].default_value = 9.0
    nt.links.new(co, grit.inputs["Vector"])
    h = nt.nodes.new("ShaderNodeMath")
    h.operation = "MULTIPLY_ADD"
    h.inputs[1].default_value = 0.6
    nt.links.new(grit.outputs["Distance"], h.inputs[0])
    nt.links.new(fine, h.inputs[2])
    nt.links.new(_bump(nt, h.outputs[0], 1.0, 0.006), b.inputs["Normal"])
    r = nt.nodes.new("ShaderNodeMapRange")
    r.inputs["To Min"].default_value = 0.32
    r.inputs["To Max"].default_value = 0.5
    nt.links.new(fine, r.inputs["Value"])
    nt.links.new(r.outputs["Result"], b.inputs["Roughness"])
    return m


def _leather(scale=1.0, warp=0.5, sub=0.35, crink=0.32, relief=0.21, rough_top=0.32):
    """Leatherette as on the S5 grip: ~1 mm pebbles split into smaller grains, crinkled tops.

    scale: pebbles per mm. sub / crink: weight of the sub-grains and of the ridged
    wrinkles. relief: depth of the full height range in mm.
    """
    m, nt, b = _new("leather")
    _set(b, base=(0.012, 0.012, 0.013), rough=0.5, spec=0.5, sheen=0.1, sheen_rough=0.4)
    co = _coords(nt)

    def node(kind, feature=None, **inputs):
        n = nt.nodes.new(kind)
        if feature:
            n.feature = feature
        for k, v in inputs.items():
            n.inputs[k].default_value = v
        return n

    def math(op, a, b_=None, v=None):
        n = nt.nodes.new("ShaderNodeMath")
        n.operation = op
        nt.links.new(a, n.inputs[0])
        if b_ is not None:
            nt.links.new(b_, n.inputs[1])
        elif v is not None:
            n.inputs[1].default_value = v
        return n.outputs[0]

    def plateau(vec, sc, width):
        e = node("ShaderNodeTexVoronoi", "DISTANCE_TO_EDGE", Scale=sc)
        nt.links.new(vec, e.inputs["Vector"])
        r = node("ShaderNodeMapRange", **{"From Max": width})
        r.interpolation_type = "SMOOTHSTEP"
        nt.links.new(e.outputs["Distance"], r.inputs["Value"])
        return r.outputs["Result"]

    wn = node("ShaderNodeTexNoise", Scale=0.6, Detail=3.0, Roughness=0.5)
    nt.links.new(co, wn.inputs["Vector"])
    mx = nt.nodes.new("ShaderNodeMix")
    mx.data_type = "VECTOR"
    mx.inputs["Factor"].default_value = warp
    nt.links.new(co, mx.inputs["A"])
    nt.links.new(wn.outputs["Color"], mx.inputs["B"])
    p = mx.outputs["Result"]
    big = plateau(p, scale, 0.14)
    small = plateau(p, scale * 2.4, 0.12)
    wr = node("ShaderNodeTexNoise", Scale=scale * 3.5, Detail=4.0, Roughness=0.55)
    nt.links.new(p, wr.inputs["Vector"])
    fold = nt.nodes.new("ShaderNodeMath")                  # 1 - 2|n - 0.5|: sharp ridges along the noise midline
    fold.operation = "MULTIPLY_ADD"
    nt.links.new(math("ABSOLUTE", math("SUBTRACT", wr.outputs["Fac"], v=0.5)), fold.inputs[0])
    fold.inputs[1].default_value = -2.0
    fold.inputs[2].default_value = 1.0
    ridged = math("POWER", fold.outputs[0], v=3.0)
    micro = node("ShaderNodeTexNoise", Scale=16.0, Detail=2.0, Roughness=0.5)
    nt.links.new(co, micro.inputs["Vector"])
    height = math("MULTIPLY", big, v=1.0 - sub - crink)
    height = math("ADD", height, math("MULTIPLY", small, v=sub))
    height = math("ADD", height, math("MULTIPLY", math("MULTIPLY", ridged, big), v=crink))
    height = math("ADD", height, math("MULTIPLY", micro.outputs["Fac"], v=0.05))
    nt.links.new(_bump(nt, height, 1.0, relief), b.inputs["Normal"])
    col = nt.nodes.new("ShaderNodeMix")
    col.data_type = "RGBA"
    col.inputs["A"].default_value = (0.004, 0.004, 0.0045, 1)
    col.inputs["B"].default_value = (0.015, 0.015, 0.016, 1)
    nt.links.new(big, col.inputs["Factor"])
    nt.links.new(col.outputs["Result"], b.inputs["Base Color"])
    rr = node("ShaderNodeMapRange", **{"From Min": 0.1, "From Max": 0.9, "To Min": 0.75, "To Max": rough_top})
    nt.links.new(height, rr.inputs["Value"])
    nt.links.new(rr.outputs["Result"], b.inputs["Roughness"])
    return m


def _interior():
    m, nt, b = _new("interior")
    _set(b, base=(0.006, 0.006, 0.006), rough=0.85, spec=0.2)
    return m


def _rubber():
    m, nt, b = _new("rubber")
    _set(b, base=(0.012, 0.012, 0.012), rough=0.72, spec=0.35)
    co = _coords(nt)
    nt.links.new(_bump(nt, _noise(nt, co, 6.0, 2.0), 1.0, 0.006), b.inputs["Normal"])
    return m


def _plastic():
    """Satin black plastic for buttons, doors and the lens barrel."""
    m, nt, b = _new("plastic")
    _set(b, base=(0.014, 0.014, 0.015), rough=0.36, spec=0.5)
    co = _coords(nt)
    nt.links.new(_bump(nt, _noise(nt, co, 11.0, 2.0), 1.0, 0.002), b.inputs["Normal"])
    return m


def _gloss_black():
    m, nt, b = _new("gloss_black")
    _set(b, base=(0.008, 0.008, 0.009), rough=0.12, coat=0.6, coat_rough=0.05)
    return m


def _dial_metal():
    """Black anodised aluminium on dials and knurls."""
    m, nt, b = _new("dial_metal")
    _set(b, base=(0.035, 0.035, 0.038), metal=1.0, rough=0.28, aniso=0.5)
    nt.links.new(_radial_tangent(nt), b.inputs["Tangent"])
    return m


def _spun_metal():
    """Spun (concentric brushed) dark aluminium for dial caps."""
    m, nt, b = _new("spun_metal")
    _set(b, base=(0.06, 0.06, 0.065), metal=1.0, rough=0.22, aniso=0.85)
    nt.links.new(_radial_tangent(nt), b.inputs["Tangent"])
    co = _coords(nt)
    sep = nt.nodes.new("ShaderNodeVectorMath")
    sep.operation = "LENGTH"
    xy = nt.nodes.new("ShaderNodeVectorMath")
    xy.operation = "MULTIPLY"
    xy.inputs[1].default_value = (1, 1, 0)
    nt.links.new(co, xy.inputs[0])
    nt.links.new(xy.outputs[0], sep.inputs[0])
    wave = nt.nodes.new("ShaderNodeTexNoise")
    wave.inputs["Scale"].default_value = 60.0
    wave.inputs["Detail"].default_value = 1.0
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(sep.outputs["Value"], comb.inputs["X"])
    nt.links.new(comb.outputs[0], wave.inputs["Vector"])
    nt.links.new(_bump(nt, wave.outputs["Fac"], 1.0, 0.0006), b.inputs["Normal"])
    return m


def _chrome():
    """Lens mount: bright chrome, brushed around the axis."""
    m, nt, b = _new("chrome")
    _set(b, base=(0.82, 0.82, 0.84), metal=1.0, rough=0.14, aniso=0.55)
    nt.links.new(_radial_tangent(nt), b.inputs["Tangent"])
    return m


def _steel():
    m, nt, b = _new("steel")
    _set(b, base=(0.62, 0.62, 0.64), metal=1.0, rough=0.24)
    return m


def _silver_logo():
    """Bright satin silver lettering: reads light even when it reflects a dark studio."""
    m, nt, b = _new("silver_logo")
    _set(b, base=(0.8, 0.8, 0.82), metal=0.35, rough=0.32, coat=0.5, coat_rough=0.1)
    return m


def _gold():
    m, nt, b = _new("gold")
    _set(b, base=(1.0, 0.72, 0.32), metal=1.0, rough=0.2)
    return m


def _print_white():
    m, nt, b = _new("print_white")
    _set(b, base=(0.78, 0.78, 0.78), rough=0.55, spec=0.4)
    return m


def _print_grey():
    m, nt, b = _new("print_grey")
    _set(b, base=(0.18, 0.18, 0.19), rough=0.5)
    return m


def _red_anod():
    m, nt, b = _new("red_anod")
    _set(b, base=(0.55, 0.012, 0.018), metal=1.0, rough=0.3)
    return m


def _red_button():
    m, nt, b = _new("red_button")
    _set(b, base=(0.62, 0.015, 0.02), rough=0.32, coat=0.4, coat_rough=0.2)
    return m


def _red_paint():
    m, nt, b = _new("red_paint")
    _set(b, base=(0.7, 0.02, 0.02), rough=0.45)
    return m


def _screen():
    """LCD cover glass over a black panel."""
    m, nt, b = _new("screen")
    _set(b, base=(0.004, 0.0045, 0.006), rough=0.03, coat=1.0, coat_rough=0.02, spec=0.6)
    return m


def _lens_glass():
    """Coated optical glass: thin film gives the green / magenta reflections."""
    m, nt, b = _new("lens_glass")
    _set(b, base=(1, 1, 1), rough=0.0, ior=1.62, trans=1.0, film=320.0, film_ior=1.38)
    return m


def _lens_glass_b():
    m, nt, b = _new("lens_glass_b")
    _set(b, base=(1, 1, 1), rough=0.0, ior=1.7, trans=1.0, film=520.0, film_ior=1.45)
    return m


def _sensor():
    m, nt, b = _new("sensor")
    _set(b, base=(0.02, 0.05, 0.09), metal=0.3, rough=0.08, coat=1.0, coat_rough=0.02, film=380.0, film_ior=1.5)
    return m


def _lamp():
    m, nt, b = _new("lamp")
    _set(b, base=(0.55, 0.5, 0.42), rough=0.25, trans=0.6, ior=1.5)
    return m


def _lens_plastic():
    """Lens barrel: fine-textured matte polycarbonate."""
    m, nt, b = _new("lens_plastic")
    _set(b, base=(0.018, 0.018, 0.019), rough=0.4, spec=0.5)
    co = _coords(nt)
    nt.links.new(_bump(nt, _noise(nt, co, 8.0, 3.0, 0.6), 1.0, 0.004), b.inputs["Normal"])
    return m


def _lens_rubber():
    m, nt, b = _new("lens_rubber")
    _set(b, base=(0.013, 0.013, 0.013), rough=0.55, spec=0.45)
    return m


def printed(name, base, image_path, print_rough=0.5):
    """Copy of material `base` with an RGBA print (UV mapped) laid over its colour."""
    src = get(base)
    m = src.copy()
    m.name = name
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(image_path, check_existing=True)
    tex.extension = "CLIP"
    tex.interpolation = "Cubic"
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = b.inputs["Base Color"].default_value
    nt.links.new(tex.outputs["Alpha"], mix.inputs["Factor"])
    nt.links.new(tex.outputs["Color"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], b.inputs["Base Color"])
    if not b.inputs["Roughness"].is_linked:
        rm = nt.nodes.new("ShaderNodeMix")
        rm.data_type = "FLOAT"
        rm.inputs["A"].default_value = b.inputs["Roughness"].default_value
        rm.inputs["B"].default_value = print_rough
        nt.links.new(tex.outputs["Alpha"], rm.inputs["Factor"])
        nt.links.new(rm.outputs["Result"], b.inputs["Roughness"])
    _cache[name] = m
    return m
