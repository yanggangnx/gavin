"""S5 body parts: dials, buttons, mount, EVF, LCD, hot shoe, doors, lugs, logos."""
import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

import body as B
import dims as D
import mats as M
from geom import (TAU, font, lathe, merge_meshes, mesh_from_npz, obj, place,
                  pyramid_band, ribs, rounded_box, rounded_slab, rrect, sweep_circle, text_mesh, torus)
from sdf import sd_polygon

FONT_SEMI = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"
FONT_BOLD = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"
FONT_MED = "/usr/share/fonts/opentype/inter/Inter-Medium.otf"

UP = (0, 0, 1)
BACK_N = (0, 1, 0)
FRONT_N = (0, -1, 0)


class Ctx:
    def __init__(self, root, coll):
        self.root = root
        self.coll = coll

    def add(self, name, me, mats, matrix=None):
        return obj(name, me, self.root, [M.get(m) for m in mats], matrix, self.coll)


def grip_top_z(y):
    """Height of the grip/plateau top at depth y (from the SDF side profile)."""
    zs = np.linspace(60, 90, 3001)
    d = sd_polygon(np.full_like(zs, y), zs, B.grip_yz())
    inside = zs[d <= 0]
    return float(inside.max())


def at(pos, normal=UP, up=(0, 1, 0)):
    return place(normal, up, pos)


# ------------------------------------------------------------------ shell

def shell(c, npz):
    me = mesh_from_npz("S5_body_shell", npz)
    return c.add("S5_Body", me, ["paint", "leather", "interior"])


# ------------------------------------------------------------------ dials

def _knurled_dial(name, R, root, z_band, n_col, n_row, depth, lower, upper, mats_lower, mats_upper):
    n = n_col * 4
    lo = lathe(name + "_lo", lower, n, mats=mats_lower)
    hi = lathe(name + "_hi", upper, n, mats=mats_upper)
    band = pyramid_band(name + "_kn", root, z_band[0], z_band[1], n_col, n_row, depth)
    band.polygons.foreach_set("material_index", np.zeros(len(band.polygons), np.int32))
    return merge_meshes(name, [lo, band, hi], sharp=28)


def _radial_labels(c, name, items, center, z, radius, cap, fnt, mat="print_white", up_out=True):
    for i, (label, ang) in enumerate(items):
        a = math.radians(ang)
        out = Vector((math.cos(a), math.sin(a), 0))
        pos = Vector((center[0], center[1], z)) + out * radius
        me = text_mesh(f"{name}_{i}", label, fnt, cap, depth=0.03)
        c.add(f"{name}_{i}", me, [mat], at(pos, UP, out if up_out else -out))


def mode_dial(c):
    d = D.MODE_DIAL
    R, root = d["r"], d["r"] - 0.5
    lower = [(0, -0.8), (10.6, -0.8), (10.6, 0.0), (10.95, 0.25), (10.95, 1.55), (root, 1.85), (root, 2.3)]
    upper = [(root, 8.0), (11.25, 8.35), (10.95, 8.6), (8.1, 8.6), (7.9, 8.45), (7.5, 8.45), (3.0, 8.55), (0, 8.62)]
    me = _knurled_dial("ModeDial", R, root, (2.3, 8.0), 60, 5, 0.5, lower, upper,
                       [0] * 6, [0, 0, 1, 1, 2, 2, 2])
    ob = c.add("ModeDial", me, ["dial_metal", "paint", "spun_metal"], at((d["x"], d["y"], d["z0"])))
    top = d["z0"] + 8.6
    items = [("S", 284), ("M", 251.6), ("M", 215.5), ("S&Q", 183), ("C1", 148), ("C2", 111.3), ("C3", 76),
             ("iA", 37), ("P", 356.7), ("A", 323.7)]
    _radial_labels(c, "ModeDial_lbl", items, (d["x"], d["y"]), top, 9.45, 1.75, font(FONT_SEMI))
    # creative-video mark: small camera body next to its M
    a = math.radians(215.5 + 11)
    p = Vector((d["x"], d["y"], top)) + Vector((math.cos(a), math.sin(a), 0)) * 9.5
    c.add("ModeDial_cam", rounded_box("cam", 1.3, 0.9, 0.03, 0.15, 2), ["print_white"],
          at(p, UP, (math.cos(a), math.sin(a), 0)))
    _power_lever(c, d)
    return ob


def _power_lever(c, d):
    """ON/OFF lever: a collar under the mode dial with a thumb tab."""
    ang = math.degrees(math.atan2(D.POWER_LEVER["y"] - d["y"], D.POWER_LEVER["x"] - d["x"]))
    collar = lathe("PowerCollar", [(11.2, -0.5), (12.6, -0.5), (12.6, 0.9), (12.3, 1.2), (11.2, 1.2), (11.2, -0.5)], 96)
    c.add("PowerCollar", collar, ["dial_metal"], at((d["x"], d["y"], d["z0"])))
    tab = rounded_box("PowerTab", 5.5, 3.4, 2.2, 0.7, 3)
    a = math.radians(ang)
    out = Vector((math.cos(a), math.sin(a), 0))
    pos = Vector((d["x"], d["y"], d["z0"] + 1.0)) + out * 14.2
    c.add("PowerTab", tab, ["dial_metal"], at(pos, UP, (-math.sin(a), math.cos(a), 0)))
    mark = rounded_box("PowerMark", 2.2, 0.45, 0.03, 0.1, 1)
    c.add("PowerMark", mark, ["print_white"], at(pos + Vector((0, 0, 1.11)), UP, (-math.sin(a), math.cos(a), 0)))
    f = font(FONT_SEMI)
    for s, p in (("ON", (-54.6, 23.4)), ("OFF", (-53.4, 26.6))):
        c.add("Print_" + s, text_mesh(s, s, f, 1.5, 0.03), ["print_white"],
              at((p[0], p[1], D.Z_PLATEAU + 0.005), UP, (0, -1, 0)))


def drive_dial(c):
    d = D.DRIVE_DIAL
    R, root = d["r"], d["r"] - 0.5
    lower = [(0, -0.8), (10.0, -0.8), (10.0, 0.0), (10.35, 0.25), (10.35, 0.95), (10.55, 1.0), (10.55, 1.6),
             (10.35, 1.65), (root, 1.9), (root, 2.3)]
    upper = [(root, 8.0), (10.4, 8.35), (10.1, 8.6), (7.6, 8.6), (7.4, 8.45), (7.0, 8.45), (3.0, 8.55), (0, 8.62)]
    me = _knurled_dial("DriveDial", R, root, (2.3, 8.0), 56, 5, 0.5, lower, upper,
                       [0, 0, 0, 0, 1, 1, 0, 0, 0], [0, 0, 2, 2, 3, 3, 3])
    ob = c.add("DriveDial", me, ["dial_metal", "red_anod", "paint", "spun_metal"], at((d["x"], d["y"], d["z0"])))
    top = d["z0"] + 8.6
    f = font(FONT_SEMI)
    ctr = Vector((d["x"], d["y"], top))
    # single, burst, 6K photo, self timer, interval icons
    for i, ang in enumerate((176.4, 213, 250, 287, 326)):
        a = math.radians(ang)
        out = Vector((math.cos(a), math.sin(a), 0))
        p = ctr + out * 8.9
        if i == 0:
            me = _frame_icon(1.6, 1.25, 0.22)
        elif i == 1:
            me = merge_meshes("burst", [_frame_icon(1.4, 1.1, 0.2, (0.25, 0.25)), _frame_icon(1.4, 1.1, 0.2, (-0.25, -0.25))], sharp=None, weld_dist=0)
        elif i == 2:
            me = text_mesh("6K", "6K", f, 1.3, 0.03)
        elif i == 3:
            me = merge_meshes("timer", [_ring_icon(0.8, 0.2), rounded_box("h", 0.18, 0.7, 0.03, 0.05, 1)], sharp=None, weld_dist=0)
        else:
            me = text_mesh("G", "G", f, 1.5, 0.03)
        c.add(f"DriveDial_icon{i}", me, ["print_white"], at(p, UP, out))
    # index marks next to both dials
    for x in (20.4, -20.4):
        c.add("DialIndex", rounded_box("idx", 0.5, 1.3, 0.03, 0.1, 1), ["print_white"],
              at((x, 20.1, D.Z_SHOULDER + 0.005), UP, (1, 0, 0)))
    return ob


def _frame_icon(w, h, t, off=(0, 0)):
    import bmesh
    bm = bmesh.new()
    outer = rrect(off[0], off[1], w / 2, h / 2, 0.12, 2)
    inner = rrect(off[0], off[1], w / 2 - t, h / 2 - t, 0.05, 2)
    vo = [bm.verts.new((x, y, 0.03)) for x, y in outer]
    vi = [bm.verts.new((x, y, 0.03)) for x, y in inner]
    n = len(vo)
    for i in range(n):
        bm.faces.new((vo[i], vo[(i + 1) % n], vi[(i + 1) % n], vi[i]))
    me = bpy.data.meshes.new("frame")
    bm.to_mesh(me)
    bm.free()
    return me


def _ring_icon(r, t):
    import bmesh
    bm = bmesh.new()
    n = 32
    vo = [bm.verts.new((r * math.cos(TAU * i / n), r * math.sin(TAU * i / n), 0.03)) for i in range(n)]
    vi = [bm.verts.new(((r - t) * math.cos(TAU * i / n), (r - t) * math.sin(TAU * i / n), 0.03)) for i in range(n)]
    for i in range(n):
        bm.faces.new((vo[i], vo[(i + 1) % n], vi[(i + 1) % n], vi[i]))
    me = bpy.data.meshes.new("ring")
    bm.to_mesh(me)
    bm.free()
    return me


def front_dial_and_shutter(c):
    d = D.FRONT_DIAL
    zb = grip_top_z(d["y"])
    slope = grip_top_z(d["y"] + 0.5) - grip_top_z(d["y"] - 0.5)
    tilt = math.atan(slope)                         # the head falls away toward the front
    n_axis = Vector((0, -math.sin(tilt), math.cos(tilt)))
    base = Vector((d["x"], d["y"], zb - 0.3))
    m = place(n_axis, (0, math.cos(tilt), math.sin(tilt)), base)
    root = 8.5
    sr = D.SHUTTER_R
    prof = [(0, -1.2), (8.3, -1.2), (8.3, 0.4), (8.5, 0.6), (root, 0.8), (root, 3.9), (8.95, 4.15), (9.0, 4.4),
            (8.2, 5.1), (sr + 1.0, 5.1), (sr + 0.8, 4.8), (0, 4.8)]
    me = lathe("FrontDial", prof, 44 * 4, mats=[0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2],
               radial=ribs(44, 0.55, root, 0.8, 3.9, flat=0.0))
    c.add("FrontDial", me, ["dial_metal", "spun_metal", "paint"], m)
    ring = lathe("ShutterRing", [(sr - 0.1, 4.7), (sr + 0.5, 4.7), (sr + 0.5, 5.2), (sr + 0.3, 5.45), (sr - 0.1, 5.45),
                                 (sr - 0.1, 4.7)], 128)
    c.add("ShutterRing", ring, ["dial_metal"], m)
    collar = lathe("FrontDialCollar", [(0, -3.0), (10.6, -3.0), (10.6, -0.4), (10.1, 0.3), (8.4, 0.45), (0, 0.45)], 128)
    c.add("FrontDialCollar", collar, ["paint"], m)
    btn = lathe("Shutter", [(0, 4.6), (sr - 0.25, 4.6), (sr - 0.25, 5.9), (sr - 0.45, 6.25), (sr - 1.0, 6.35),
                            (2.0, 6.2), (0, 6.15)], 128)
    return c.add("ShutterButton", btn, ["gloss_black"], m)


def rear_dial(c):
    d = D.REAR_DIAL
    root = d["r"] - 0.35
    z0 = 73.3
    prof = [(0, -0.5), (9.2, -0.5), (9.2, 0.9), (root, 1.0), (root, 3.6), (9.6, 3.85), (9.3, 4.15), (8.8, 4.3), (0, 4.3)]
    me = lathe("RearDial", prof, 56 * 4, mats=[0, 0, 0, 0, 0, 0, 1, 1],
               radial=ribs(56, 0.35, root, 1.0, 3.6, flat=0.35))
    c.add("RearDial", me, ["dial_metal", "spun_metal"], at((d["x"], d["y"], z0)))
    # focal plane mark on the plateau
    p = Vector((-76.1, 19.1, D.Z_PLATEAU + 0.005))
    c.add("FocalPlane_ring", _ring_icon(0.9, 0.2), ["print_white"], at(p))
    c.add("FocalPlane_bar", rounded_box("fp", 4.6, 0.2, 0.03, 0.05, 1), ["print_white"], at(p + Vector((0, 0, 0.015))))
    c.add("FocalPlane_tick", rounded_box("fp", 0.2, 1.1, 0.03, 0.05, 1), ["print_white"],
          at(p + Vector((0, -0.9, 0.015))))


# ------------------------------------------------------------------ buttons

def button(c, name, pos, normal, up, r, h, mat="plastic", bezel=None, dome=0.12, label=None, icon=None):
    m = place(normal, up, pos)
    prof = [(0, -0.8), (r, -0.8), (r, h - 0.35), (r - 0.12, h - 0.08), (r - 0.4, h), (0, h + dome)]
    ob = c.add(name, lathe(name, prof, 96), [mat], m)
    if bezel:
        ri, ro, bh = bezel
        bp = [(ri, -0.6), (ro, -0.6), (ro, bh - 0.2), (ro - 0.2, bh), (ri + 0.15, bh), (ri, bh - 0.15), (ri, -0.6)]
        c.add(name + "_bezel", lathe(name + "_b", bp, 96), ["paint"], m)
    top = Vector(pos) + Vector(normal).normalized() * (h + dome + 0.002)
    if label:
        s, cap, fnt = label
        me = text_mesh(name + "_lbl", s, font(fnt), cap, 0.02)
        c.add(name + "_lbl", me, ["print_white"], place(normal, up, top))
    if icon is not None:
        c.add(name + "_icon", icon, ["print_white"], place(normal, up, top))
    return ob


def top_buttons(c):
    for lbl, x, y in D.TOP_BUTTONS:
        z = D.Z_PLATEAU
        icon = None
        label = (lbl, 1.25, FONT_BOLD) if lbl != "EV" else None
        if lbl == "EV":
            icon = merge_meshes("ev", [_frame_icon(2.6, 2.6, 0.22), _ev_glyph()], sharp=None, weld_dist=0)
        button(c, "Btn_" + lbl, (x, y, z), UP, (0, -1, 0), D.TOP_BUTTON_R, 1.25,
               bezel=(D.TOP_BUTTON_R + 0.1, D.TOP_BUTTON_R + 0.8, 0.35), label=label, icon=icon)
    r = D.REC_BUTTON
    button(c, "Btn_REC", (r["x"], r["y"], D.Z_PLATEAU), UP, (0, -1, 0), r["r"], 1.05, mat="red_button",
           bezel=(r["r"] + 0.1, r["r"] + 1.2, 0.55), dome=0.25)


def _ev_glyph():
    import bmesh
    bm = bmesh.new()
    s = 1.3 - 0.22
    tri = [(-s, -s, 0.03), (s, s, 0.03), (-s, s, 0.03)]
    bm.faces.new([bm.verts.new(p) for p in tri])
    me = bpy.data.meshes.new("evtri")
    bm.to_mesh(me)
    bm.free()
    return me


def front_buttons(c):
    f = D.FN_FRONT
    button(c, "Btn_FnFront", (f["x"], 0.8, f["z"]), FRONT_N, UP, f["r"], 1.55, dome=0.2,
           bezel=(f["r"] + 0.15, f["bezel"], 0.95))
    l = D.LENS_RELEASE
    button(c, "Btn_LensRelease", (l["x"], 1.0, l["z"]), FRONT_N, UP, l["r"], 1.6, dome=0.18,
           bezel=(l["r"] + 0.15, l["bezel"], 0.85))
    a = D.AF_LAMP
    m = at((a["x"], D.Y_TOPBAND + 0.8, a["z"]), FRONT_N, UP)
    c.add("AFLamp", lathe("AFLamp", [(0, -0.5), (a["r"], -0.5), (a["r"], 0.7), (a["r"] - 0.2, 0.82), (0, 0.85)], 48),
          ["lamp"], m)
    # S5 badge plate + letters
    b = D.S5_BADGE
    cx, cz = (b["x0"] + b["x1"]) / 2, (b["z0"] + b["z1"]) / 2
    plate = rounded_slab("S5plate", rrect(0, 0, (b["x1"] - b["x0"]) / 2 - 0.15, (b["z1"] - b["z0"]) / 2 - 0.15, 0.9),
                         0, 0.62, r_top=0.12)
    c.add("S5_Plate", plate, ["gloss_black"], at((cx, 0.4, cz), FRONT_N, UP))
    me = text_mesh("S5", "S5", font(FONT_SEMI), 4.0, 0.12, spacing=1.05, stretch=1.08)
    c.add("S5_Letters", me, ["silver_logo"], at((cx + 0.2, 0.4 - 0.62, cz), FRONT_N, UP))
    # LUMIX on the hump face
    me = text_mesh("LUMIX", "LUMIX", font(FONT_SEMI), 5.0, 0.22, spacing=1.12)
    w = me_width(me)
    me.transform(Matrix.Diagonal((28.0 / w, 1, 1, 1)))
    c.add("Logo_LUMIX", me, ["silver_logo"], at((0.3, D.HUMP_Y_FRONT, 83.7), FRONT_N, UP))
    # red mount index dot on the boss
    p = (-26.4, D.BOSS_Y - 0.01, 18.6)
    c.add("RedDot_Body", lathe("rd", [(0, 0), (0.6, 0), (0.6, 0.05), (0, 0.06)], 32), ["red_paint"], at(p, FRONT_N, UP))


def me_width(me):
    xs = [v.co.x for v in me.vertices]
    return max(xs) - min(xs)


def back_buttons(c):
    bb = D.BACK_BUTTONS
    y = D.Y_BACK
    pl = bb["PLAY"]
    icon = merge_meshes("play", [_frame_icon(2.7, 2.1, 0.2), _tri_icon(0.75)], sharp=None, weld_dist=0)
    button(c, "Btn_Play", (pl["x"], y, pl["z"]), BACK_N, UP, pl["r"], 1.0, bezel=(pl["r"] + 0.12, pl["bezel"], 0.4),
           icon=icon)
    lv = bb["LVF"]
    button(c, "Btn_LVF", (lv["x"], y, lv["z"]), BACK_N, UP, lv["r"], 1.0, bezel=(lv["r"] + 0.12, lv["bezel"], 0.4),
           label=("LVF", 1.15, FONT_SEMI))
    af = bb["AFMODE"]
    boss = lathe("AFBoss", [(0, -0.5), (af["bezel"], -0.5), (af["bezel"], 0.6), (af["bezel"] - 0.5, 1.25),
                             (af["r"] + 0.6, 1.25), (af["r"] + 0.25, 0.95), (0, 0.95)], 96)
    c.add("AFMode_Boss", boss, ["paint"], at((af["x"], y, af["z"]), BACK_N, UP))
    grid = [_frame_icon(2.6, 2.0, 0.18)]
    for gx in (-0.55, 0, 0.55):
        for gy in (-0.35, 0.35):
            grid.append(rounded_box("g", 0.32, 0.32, 0.03, 0.04, 1))
            grid[-1].transform(Matrix.Translation((gx, gy, 0.0)))
    button(c, "Btn_AFMode", (af["x"], y + 0.95, af["z"]), BACK_N, UP, af["r"], 1.1,
           icon=merge_meshes("afgrid", grid, sharp=None, weld_dist=0))
    # focus mode lever riding on the boss rim
    a = math.radians(20)
    p = Vector((af["x"] - math.sin(a) * 7.6, y + 1.1, af["z"] + math.cos(a) * 7.6))
    c.add("FocusLever", rounded_box("fl", 2.6, 4.6, 2.4, 0.6, 3), ["dial_metal"],
          place(BACK_N, (-math.sin(a), 0, math.cos(a)), p))
    for s, dx in (("S", 3.6), ("C", 0.0), ("MF", -4.2)):
        c.add("Print_" + s, text_mesh(s, s, font(FONT_SEMI), 1.3, 0.03), ["print_white"],
              at((af["x"] + dx, 45.6, D.Z_SHOULDER + 0.005), UP, (0, -1, 0)))
    js = D.JOYSTICK
    c.add("Joystick_Base", lathe("jb", [(0, -0.5), (js["bezel"], -0.5), (js["bezel"], 0.35), (js["bezel"] - 0.4, 0.7),
                                        (js["r"] + 0.5, 0.55), (js["r"] + 0.4, 0.3), (0, 0.3)], 96),
          ["paint"], at((js["x"], y, js["z"]), BACK_N, UP))
    root = js["r"] - 0.2
    stick = lathe("Joystick", [(0, 0), (root, 0), (root, 2.2), (js["r"] - 0.5, 2.55), (0, 2.6)], 96,
                  radial=ribs(36, 0.2, root, 0.0, 2.2, flat=0.3))
    c.add("Joystick", stick, ["rubber"], at((js["x"], y + 0.3, js["z"]), BACK_N, UP))
    c.add("Joystick_Top", pyramid_disc(js["r"] - 0.55, 0.12), ["rubber"], at((js["x"], y + 0.3 + 2.6, js["z"]), BACK_N, UP))
    for k, lbl, cap in (("AFON", "AFON", 1.1), ("Q", "Q", 1.8), ("DISP", "DISP.", 1.0)):
        b = bb[k]
        button(c, "Btn_" + k, (b["x"], y, b["z"]), BACK_N, UP, b["r"], 1.05,
               bezel=(b["r"] + 0.15, b["bezel"], 0.55), label=(lbl, cap, FONT_SEMI))
    b = bb["BACK"]
    button(c, "Btn_Back", (b["x"], y, b["z"]), BACK_N, UP, b["r"], 1.05, bezel=(b["r"] + 0.15, b["bezel"], 0.55),
           icon=_return_icon())
    c.add("Print_Trash", _trash_icon(), ["print_white"], at((-47.9, y + 0.01, 6.0), BACK_N, UP))
    control_dial(c)


def _tri_icon(s):
    import bmesh
    bm = bmesh.new()
    pts = [(-0.45 * s, -0.6 * s, 0.03), (0.65 * s, 0, 0.03), (-0.45 * s, 0.6 * s, 0.03)]
    bm.faces.new([bm.verts.new(p) for p in pts])
    me = bpy.data.meshes.new("tri")
    bm.to_mesh(me)
    bm.free()
    return me


def _return_icon():
    """Hook arrow: in from the left along the top, round the right side, back left with a head."""
    r, cx = 0.62, 0.35
    pts = [(-0.75, r, 0.03)]
    pts += [(cx + r * math.cos(a), r * math.sin(a), 0.03) for a in np.linspace(math.pi / 2, -math.pi / 2, 16)]
    pts += [(-0.35, -r, 0.03)]
    arc = sweep_circle("ret", pts, 0.13, 6, closed=False)
    import bmesh
    bm = bmesh.new()
    tri = [(-0.95, -r, 0.03), (-0.3, -r + 0.45, 0.03), (-0.3, -r - 0.45, 0.03)]
    bm.faces.new([bm.verts.new(p) for p in tri])
    head = bpy.data.meshes.new("rh")
    bm.to_mesh(head)
    bm.free()
    return merge_meshes("return", [arc, head], sharp=None, weld_dist=0)


def _trash_icon():
    parts = [_frame_icon(1.4, 1.7, 0.18, (0, -0.25)), rounded_box("lid", 1.9, 0.2, 0.03, 0.05, 1)]
    parts[1].transform(Matrix.Translation((0, 0.8, 0.015)))
    return merge_meshes("trash", parts, sharp=None, weld_dist=0)


def pyramid_disc(r, h, n=9):
    """Small disc covered in a grid of bumps (joystick cap)."""
    import bmesh
    bm = bmesh.new()
    res = 40
    grid = {}
    for i in range(res + 1):
        for j in range(res + 1):
            x = -r + 2 * r * i / res
            y = -r + 2 * r * j / res
            if x * x + y * y <= (r + 1e-6) ** 2:
                u = (x / (2 * r) * n) % 1.0 * 2 - 1
                v = (y / (2 * r) * n) % 1.0 * 2 - 1
                zz = h * (1 - max(abs(u), abs(v))) * (1 - (x * x + y * y) / r / r) ** 0.25
                grid[(i, j)] = bm.verts.new((x, y, zz))
    for i in range(res):
        for j in range(res):
            q = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            if all(k in grid for k in q):
                bm.faces.new([grid[k] for k in q])
    me = bpy.data.meshes.new("pdisc")
    bm.to_mesh(me)
    bm.free()
    return me


def control_dial(c):
    cd = D.CONTROL_DIAL
    base = Vector((cd["x"], D.Y_BACK - 1.2, cd["z"]))
    root = cd["r"] - 0.25
    prof = [(0, -0.4), (12.1, -0.4), (12.1, 0.1), (root, 0.2), (root, 2.25), (12.2, 2.55), (11.8, 2.75),
            (6.4, 2.75), (6.2, 2.5), (0, 2.5)]
    me = lathe("ControlDial", prof, 100 * 4, mats=[0] * 9, radial=ribs(100, 0.25, root, 0.2, 2.25, flat=0.3))
    m = at(base, BACK_N, UP)
    c.add("ControlDial", me, ["dial_metal"], m)
    # raised ticks on the face
    ticks = []
    for i in range(40):
        a = TAU * i / 40
        t = rounded_box("t", 0.35, 1.9, 0.12, 0.05, 1)
        t.transform(Matrix.Rotation(a - math.pi / 2, 4, "Z") @ Matrix.Translation((0, 9.9, 0.06)))
        t.transform(Matrix.Rotation(0, 4, "Z"))
        ticks.append(t)
    tk = merge_meshes("ticks", ticks, sharp=None, weld_dist=0)
    c.add("ControlDial_ticks", tk, ["dial_metal"], place(BACK_N, UP, base + Vector((0, 2.75, 0))))
    for ang in (90, 180, 270, 0):
        a = math.radians(ang)
        t = _tri_icon(0.9)
        t.transform(Matrix.Rotation(a, 4, "Z") @ Matrix.Translation((7.4, 0, 0)))
        c.add("ControlDial_arrow", t, ["print_white"], place(BACK_N, UP, base + Vector((0, 2.76, 0))))
    btn = lathe("MenuSet", [(0, 2.3), (cd["set_r"], 2.3), (cd["set_r"], 3.0), (cd["set_r"] - 0.3, 3.35), (0, 3.5)], 96)
    c.add("Btn_MenuSet", btn, ["plastic"], m)
    for s, dz in (("MENU", 0.75), ("/SET", -0.85)):
        me = text_mesh(s, s, font(FONT_SEMI), 1.2, 0.02)
        c.add("MenuSet_" + s, me, ["print_white"], place(BACK_N, UP, base + Vector((0, 3.51, dz))))


# ------------------------------------------------------------------ mount

def mount(c):
    ax = Vector((0, D.BOSS_Y, D.MOUNT_Z))
    m = place(FRONT_N, UP, ax)
    face = D.BOSS_Y - D.MOUNT_FACE_Y                 # ring height above the boss
    prof = [(25.8, -3.5), (26.6, -3.5), (26.6, 0.0), (32.25, 0.0), (32.25, face - 0.35), (31.9, face),
            (26.25, face), (25.8, face - 0.4), (25.8, -3.5)]
    c.add("MountRing", lathe("MountRing", prof, 256), ["chrome"], m)
    # bayonet tabs behind the face
    tabs = []
    for a0, a1 in ((22, 66), (112, 152), (202, 246), (292, 334)):
        p = [(24.4, -2.6), (25.9, -2.6), (25.9, -0.9), (24.4, -0.9), (24.4, -2.6)]
        seg = lathe("tab", p, 64)
        # keep only the arc between a0..a1 by squashing outside verts onto the ring
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(seg)
        kill = [v for v in bm.verts if not (a0 <= (math.degrees(math.atan2(v.co.y, v.co.x)) % 360) <= a1)]
        bmesh.ops.delete(bm, geom=kill, context="VERTS")
        bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
        bm.to_mesh(seg)
        bm.free()
        tabs.append(seg)
    c.add("MountTabs", merge_meshes("tabs", tabs, sharp=30, weld_dist=0), ["chrome"], m)
    # screws
    for a in (10, 70, 137, 190, 240, 306):
        r = math.radians(a)
        p = Vector((math.cos(r) * 28.8, math.sin(r) * 28.8, face))
        head = lathe("screw", [(0, -0.4), (1.3, -0.4), (1.3, 0.02), (1.1, 0.1), (0, 0.12)], 32)
        hm = m @ Matrix.Translation(p)
        c.add("MountScrew", head, ["steel"], hm)
        for rot in (0, 90):
            sl = rounded_box("slot", 1.7, 0.32, 0.06, 0.05, 1)
            sl.transform(Matrix.Rotation(math.radians(rot + a), 4, "Z") @ Matrix.Translation((0, 0, 0.1)))
            c.add("MountScrewSlot", sl, ["interior"], hm)
    r = math.radians(219.5)
    c.add("RedDot_Mount", lathe("rd", [(0, 0), (0.55, 0), (0.55, 0.04), (0, 0.05)], 32), ["red_paint"],
          m @ Matrix.Translation((math.cos(r) * 28.1, math.sin(r) * 28.1, face)))
    # lens lock pin
    r = math.radians(-58)
    c.add("LockPin", lathe("pin", [(0, -1), (1.1, -1), (1.1, 0.55), (0.9, 0.75), (0, 0.8)], 32), ["steel"],
          m @ Matrix.Translation((math.cos(r) * 29.7, math.sin(r) * 29.7, face - 0.6)))
    # contact block with 11 gold pads
    blk = lathe("cblk", [(19.6, -3.0), (25.75, -3.0), (25.75, 0.3), (19.6, 0.3), (19.6, -3.0)], 256)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(blk)
    kill = [v for v in bm.verts if not (56 <= (math.degrees(math.atan2(v.co.y, v.co.x)) % 360) <= 124)]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
    bm.to_mesh(blk)
    bm.free()
    c.add("ContactBlock", blk, ["plastic"], m)
    for i in range(11):
        a = math.radians(63 + 54 * i / 10)
        pad = rounded_box("pad", 0.9, 1.6, 0.12, 0.2, 2)
        pad.transform(Matrix.Rotation(a - math.pi / 2, 4, "Z"))
        c.add("Contact", pad, ["gold"], m @ Matrix.Translation((math.cos(a) * 21.3, math.sin(a) * 21.3, 0.33)))
    # sensor stack
    s = Vector((0, D.SENSOR_Y, D.MOUNT_Z))
    c.add("SensorFrame", rounded_box("sf", 47, 38, 1.2, 1.0, 2), ["interior"], place(FRONT_N, UP, s + Vector((0, 0.6, 0))))
    c.add("SensorGlass", rounded_box("sg", 38.6, 26.2, 0.6, 0.3, 2), ["sensor"], place(FRONT_N, UP, s + Vector((0, -0.3, 0))))


# ------------------------------------------------------------------ top

def hot_shoe(c):
    h = D.HOTSHOE
    z = D.HUMP_Z_TOP
    cy = (h["y0"] + h["y1"]) / 2
    ly = h["y1"] - h["y0"]
    c.add("HotShoe_Base", rounded_box("hb", 20.8, ly - 0.4, 1.0, 0.4, 3), ["plastic"], at((0, cy, z + 0.3)))
    for sx in (-1, 1):
        wall = rounded_box("hw", 0.5, ly, 2.4, 0.2, 2)
        c.add("HotShoe_Wall", wall, ["steel"], at((sx * 10.55, cy, z + 1.2)))
        rail = rounded_box("hr", 2.0, ly - 1.0, 0.5, 0.2, 2)
        c.add("HotShoe_Rail", rail, ["steel"], at((sx * 9.6, cy + 0.5, z + 2.25)))
    c.add("HotShoe_Front", rounded_box("hf", 21.6, 1.0, 1.6, 0.3, 2), ["steel"], at((0, h["y0"] + 0.5, z + 0.8)))
    c.add("HotShoe_Plate", rounded_box("hp", 17.4, ly - 2.0, 0.3, 0.2, 2), ["plastic"], at((0, cy + 0.6, z + 0.9)))
    c.add("HotShoe_Center", lathe("hc", [(0, 0), (1.8, 0), (1.8, 0.25), (1.6, 0.35), (0, 0.36)], 48), ["steel"],
          at((0, 34.7, z + 1.05)))
    for i, (x, y) in enumerate(((2.4, 38.2), (-2.4, 38.2), (2.4, 40.8), (-2.4, 40.8))):
        c.add("HotShoe_Pin", lathe("hpin", [(0, 0), (0.85, 0), (0.85, 0.2), (0, 0.25)], 24),
              ["gold" if i == 0 else "steel"], at((x, y, z + 1.05)))
    c.add("HotShoe_Lock", rounded_box("hl", 1.6, 3.2, 0.1, 0.5, 3), ["interior"], at((0, 30.0, z + 1.06)))
    # Panasonic on the EVF housing top
    me = text_mesh("Panasonic", "Panasonic", font(FONT_BOLD), 1.75, 0.03)
    c.add("Print_Panasonic", me, ["print_grey"], at((0, 48.6, z + 0.005), UP, (0, -1, 0)))


def eyecup(c, npz):
    me = mesh_from_npz("Eyecup", npz)
    c.add("Eyecup", me, ["rubber", "screen", "interior"])
    c.add("EVF_Glass", rounded_box("eg", 19.4, 13.8, 0.6, 2.5, 4), ["lens_glass_b"],
          place(BACK_N, UP, (-0.4, 53.6, 79.4)))
    c.add("EVF_Back", rounded_box("eb", 22, 16, 0.5, 2.5, 3), ["interior"], place(BACK_N, UP, (-0.4, 51.8, 79.4)))


def lcd(c):
    l = D.LCD
    hx = (l["x1"] - l["x0"]) / 2
    hz = (l["z1"] - l["z0"]) / 2
    cx = (l["x0"] + l["x1"]) / 2
    cz = (l["z0"] + l["z1"]) / 2
    pivot = Vector((44.6, 48.6, cz))
    hinge = bpy.data.objects.new("LCD_Pivot", None)
    c.coll.objects.link(hinge)
    hinge.parent = c.root
    hinge.location = pivot
    hinge.empty_display_size = 5
    m = lambda mat: Matrix.Translation(-pivot) @ mat
    body = rounded_slab("LCD_Body", rrect(0, 0, hx, hz, 2.5, 6), -0.8, l["y1"] - l["y0"] - 0.25, r_top=0.6, r_bot=0.2)
    obj("LCD_Body", body, hinge, [M.get("plastic")], m(place(BACK_N, UP, (cx, l["y0"], cz))), c.coll)
    glass = rounded_slab("LCD_Glass", rrect(0, 0, hx - 0.8, hz - 0.8, 1.9, 6), 0, 0.28, r_top=0.15)
    obj("LCD_Glass", glass, hinge, [M.get("screen")], m(place(BACK_N, UP, (cx, l["y1"] - 0.25, cz))), c.coll)
    for z0, z1 in ((36.0, 53.6), (2.6, 19.5)):
        k = rounded_box("knuckle", 8.0, 3.4, z1 - z0, 0.8, 3)
        c.add("LCD_Knuckle", k, ["plastic"], at((42.6, 48.4, (z0 + z1) / 2)))
    bar = lathe("bar", [(0, 0), (1.4, 0), (1.4, 50.0), (0, 50.0)], 32)
    c.add("LCD_HingeBar", bar, ["plastic"], at((45.8, 48.6, 3.0)))
    return hinge


# ------------------------------------------------------------------ sides

def lugs(c):
    for name, l, sx in (("Lug_L", D.LUG_LEFT, 1), ("Lug_R", D.LUG_RIGHT, -1)):
        x = l["x"]
        post = lathe("post", [(0, -1.0), (2.2, -1.0), (2.2, 0.6), (2.9, 1.1), (3.0, 2.0), (2.6, 2.9), (1.6, 3.4),
                              (0, 3.5)], 64)
        c.add(name + "_post", post, ["steel"], place((sx, 0, 0), UP, (x, l["y"], l["z"])))
        ring = torus("ring", 2.9, 0.9, 64, 18)
        c.add(name + "_ring", ring, ["steel"], place((0, 1, 0), (sx, 0, 0), (x + sx * 5.0, l["y"], l["z"])))


def doors(c):
    for i, p in enumerate(D.PORT_DOORS):
        cy, cz = (p["y0"] + p["y1"]) / 2, (p["z0"] + p["z1"]) / 2
        outline = rrect(0, 0, (p["y1"] - p["y0"]) / 2, (p["z1"] - p["z0"]) / 2, 1.5, 6)
        me = rounded_slab(f"PortDoor{i}", outline, -0.7, 0.0, r_top=0.35)
        c.add(f"PortDoor{i}", me, ["leather"], place((1, 0, 0), UP, (D.X_MAX, cy, cz)))
    f = font(FONT_BOLD)
    side = lambda y, z: place((1, 0, 0), UP, (D.X_MAX + 0.01, y, z))
    for s, y, z, cap in (("MIC", 31.0, 62.5, 1.7), ("HDMI", 31.0, 33.0, 1.6), ("SS", 31.0, 20.5, 1.6)):
        c.add("Emboss_" + s, text_mesh(s, s, f, cap, 0.08), ["paint"], side(y, z))
    band = sweep_circle("band", [(1.25 * math.cos(a), 1.25 * math.sin(a), 0.04) for a in np.linspace(0, math.pi, 16)],
                        0.13, 6, closed=False)
    cups = [rounded_box("cup", 0.65, 1.2, 0.08, 0.2, 2) for _ in range(2)]
    cups[0].transform(Matrix.Translation((1.25, -0.4, 0.04)))
    cups[1].transform(Matrix.Translation((-1.25, -0.4, 0.04)))
    phones = merge_meshes("phones", [band] + cups, sharp=None, weld_dist=0)
    c.add("Emboss_Phones", phones, ["paint"], side(31.0, 56.0))
    s = D.SD_DOOR
    cy, cz = (s["y0"] + s["y1"]) / 2, (s["z0"] + s["z1"]) / 2
    me = rounded_slab("SDDoor", rrect(0, 0, (s["y1"] - s["y0"]) / 2, (s["z1"] - s["z0"]) / 2, 1.9, 6), -0.7, 0.0,
                      r_top=0.4)
    c.add("SDDoor", me, ["paint"], place((-1, 0, 0), UP, (D.X_MIN, cy, cz)))
    for y in (28.2, 29.0):
        c.add("SDDoor_slide", rounded_box("g", 0.3, 21.0, 0.12, 0.1, 1), ["gloss_black"],
              place((-1, 0, 0), UP, (D.X_MIN - 0.03, y, 36.5)))
    arrow = _tri_icon(1.5)
    c.add("SDDoor_arrow", arrow, ["paint"], place((-1, 0, 0), UP, (D.X_MIN - 0.04, 31.7, 44.0)))
    r = D.REMOTE_COVER
    cy, cz = (r["y0"] + r["y1"]) / 2, (r["z0"] + r["z1"] - 1.0) / 2
    me = rounded_slab("Remote", rrect(0, 0, (r["y1"] - r["y0"]) / 2, (r["z1"] - 1.0 - r["z0"]) / 2, 1.6, 6), -0.6, 0.0,
                      r_top=0.3)
    c.add("RemoteCover", me, ["rubber"], place((-1, 0, 0), UP, (D.X_MIN, cy, cz)))
    me = text_mesh("REMOTE", "REMOTE", font(FONT_SEMI), 1.3, 0.02)
    c.add("Print_REMOTE", me, ["print_grey"], place((-1, 0, 0), UP, (D.X_MIN - 0.002, cy, cz)))
    b = D.BATTERY_DOOR
    cx, cy = (b["x0"] + b["x1"]) / 2, (b["y0"] + b["y1"]) / 2
    me = rounded_slab("Battery", rrect(0, 0, (b["x1"] - b["x0"]) / 2, (b["y1"] - b["y0"]) / 2, 2.8, 6), -0.6, 0.0,
                      r_top=0.3)
    c.add("BatteryDoor", me, ["paint"], place((0, 0, -1), (0, 1, 0), (cx, cy, 0.0)))
    c.add("BatteryLatch", rounded_box("bl", 9.0, 3.2, 1.4, 0.6, 3), ["plastic"], at((cx, b["y0"] + 3.0, 0.6)))
    t = D.TRIPOD
    c.add("TripodInsert", lathe("ti", [(3.2, 0.5), (5.5, 0.5), (5.5, 0.05), (5.3, -0.05), (3.4, -0.05), (3.2, 0.1),
                                       (3.2, 0.5)], 64), ["steel"], at((t["x"], t["y"], 0.0)))
    c.add("TripodHole", lathe("th", [(0, 8.0), (3.2, 8.0), (3.2, 0.5)], 48), ["interior"],
          at((t["x"], t["y"], 0.0)))
