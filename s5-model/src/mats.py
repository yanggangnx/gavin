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


def _bump(nt, height, strength, dist, normal_in=None):
    b = nt.nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = strength
    b.inputs["Distance"].default_value = dist
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
    """Magnesium body: black paint with a fine sand-blasted grain."""
    m, nt, b = _new("paint")
    _set(b, base=(0.016, 0.016, 0.017), rough=0.42, coat=0.25, coat_rough=0.28, spec=0.5)
    co = _coords(nt)
    g = _noise(nt, co, 9.0, 3.0, 0.65)
    nt.links.new(_bump(nt, g, 0.18, 0.004), b.inputs["Normal"])
    return m


def _leather():
    """Pebbled leatherette: rounded voronoi pebbles with soft crevices."""
    m, nt, b = _new("leather")
    _set(b, base=(0.011, 0.011, 0.012), rough=0.58, spec=0.45, sheen=0.15, sheen_rough=0.4)
    co = _coords(nt)
    warp = nt.nodes.new("ShaderNodeTexNoise")
    warp.inputs["Scale"].default_value = 1.6
    warp.inputs["Detail"].default_value = 2.0
    nt.links.new(co, warp.inputs["Vector"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "VECTOR"
    mix.inputs["Factor"].default_value = 0.25
    nt.links.new(co, mix.inputs["A"])
    nt.links.new(warp.outputs["Color"], mix.inputs["B"])
    edge = nt.nodes.new("ShaderNodeTexVoronoi")
    edge.feature = "DISTANCE_TO_EDGE"
    edge.inputs["Scale"].default_value = 2.3
    edge.inputs["Randomness"].default_value = 1.0
    nt.links.new(mix.outputs["Result"], edge.inputs["Vector"])
    f1 = nt.nodes.new("ShaderNodeTexVoronoi")
    f1.feature = "F1"
    f1.inputs["Scale"].default_value = 2.3
    f1.inputs["Randomness"].default_value = 1.0
    nt.links.new(mix.outputs["Result"], f1.inputs["Vector"])
    crev = nt.nodes.new("ShaderNodeMapRange")
    crev.inputs["From Min"].default_value = 0.0
    crev.inputs["From Max"].default_value = 0.22
    crev.interpolation_type = "SMOOTHSTEP"
    nt.links.new(edge.outputs["Distance"], crev.inputs["Value"])
    dome = nt.nodes.new("ShaderNodeMapRange")
    dome.inputs["From Min"].default_value = 0.0
    dome.inputs["From Max"].default_value = 0.75
    dome.inputs["To Min"].default_value = 1.0
    dome.inputs["To Max"].default_value = 0.0
    nt.links.new(f1.outputs["Distance"], dome.inputs["Value"])
    h = nt.nodes.new("ShaderNodeMath")
    h.operation = "MULTIPLY"
    nt.links.new(crev.outputs["Result"], h.inputs[0])
    nt.links.new(dome.outputs["Result"], h.inputs[1])
    fine = _noise(nt, co, 18.0, 2.0)
    add = nt.nodes.new("ShaderNodeMath")
    add.operation = "MULTIPLY_ADD"
    add.inputs[1].default_value = 0.12
    nt.links.new(fine, add.inputs[0])
    nt.links.new(h.outputs[0], add.inputs[2])
    nt.links.new(_bump(nt, add.outputs[0], 0.45, 0.02), b.inputs["Normal"])
    rr = nt.nodes.new("ShaderNodeMapRange")
    rr.inputs["To Min"].default_value = 0.72
    rr.inputs["To Max"].default_value = 0.5
    nt.links.new(crev.outputs["Result"], rr.inputs["Value"])
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
    nt.links.new(_bump(nt, _noise(nt, co, 6.0, 2.0), 0.12, 0.004), b.inputs["Normal"])
    return m


def _plastic():
    """Satin black plastic for buttons, doors and the lens barrel."""
    m, nt, b = _new("plastic")
    _set(b, base=(0.014, 0.014, 0.015), rough=0.36, spec=0.5)
    co = _coords(nt)
    nt.links.new(_bump(nt, _noise(nt, co, 11.0, 2.0), 0.08, 0.003), b.inputs["Normal"])
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
    nt.links.new(_bump(nt, wave.outputs["Fac"], 0.25, 0.002), b.inputs["Normal"])
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
    m, nt, b = _new("silver_logo")
    _set(b, base=(0.72, 0.72, 0.74), metal=1.0, rough=0.2)
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
    nt.links.new(_bump(nt, _noise(nt, co, 8.0, 3.0, 0.6), 0.2, 0.004), b.inputs["Normal"])
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
