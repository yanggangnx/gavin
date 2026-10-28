"""LUMIX S 20-60mm F3.5-5.6 (S-R2060), shown at its retracted length.

Local lens frame: z = distance forward of the L-mount flange (world -Y),
x = world +X, y = world +Z. Profile radii from the Panasonic top view.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import dims as D
import mats as M
from geom import TAU, lathe, merge_meshes, obj, place, rounded_box, rrect

N = 960                      # angular resolution shared by every barrel part


def lens_root(c):
    """Empty at the flange centre; every lens part hangs off it."""
    e = bpy.data.objects.new("Lens_20-60", None)
    c.coll.objects.link(e)
    e.parent = c.root
    e.matrix_basis = place((0, -1, 0), (0, 0, 1), (0, D.MOUNT_FACE_Y, D.MOUNT_Z))
    e.empty_display_size = 40
    return e


def _add(c, parent, name, me, mats, matrix=None):
    return obj(name, me, parent, [m if not isinstance(m, str) else M.get(m) for m in mats], matrix, c.coll)


def _notches(th, z, r):
    """Hood bayonet: three notches cut into the front flange."""
    sel = (z > 80.35) & (z < 83.35) & (r > 36.0)
    a = np.degrees(th) % 360
    cut = np.zeros_like(r, bool)
    for a0 in (30, 150, 270):
        cut |= np.abs((a - a0 + 180) % 360 - 180) < 7.0
    return np.where(sel & cut, 35.0, r)


def build(c, tex):
    L = lens_root(c)
    # rear bayonet (inside the body) and visible chrome flange
    mount = [(14.8, -9.0), (22.0, -9.0), (22.0, -2.4), (25.3, -2.4), (25.3, -0.2), (30.4, -0.2), (30.4, 0.9),
             (29.8, 1.1)]
    _add(c, L, "Lens_Mount", lathe("Lens_Mount", mount, N // 4), ["chrome"])
    # fixed barrel: black rear ring, cone, printed barrel
    fixed = [(29.8, 1.0), (31.6, 1.0), (31.8, 1.3), (31.8, 4.0), (32.0, 4.3), (35.0, 9.6), (35.2, 10.0),
             (35.25, 20.0), (35.2, 29.4), (34.9, 29.7), (33.6, 29.8)]
    me = lathe("Lens_Barrel", fixed, N, uv_z=(9.8, 29.7))
    _add(c, L, "Lens_Barrel", me, [M.printed("lens_barrel_print", "lens_plastic", tex["barrel"])])
    # zoom ring: printed scale band + ribbed rubber grip
    zr_root = 35.4
    zoom = [(33.6, 29.9), (35.3, 29.95), (35.5, 30.2), (35.5, 32.8), (35.3, 33.1), (35.0, 33.4), (35.0, 33.9),
            (zr_root, 34.3), (zr_root, 53.7), (35.1, 54.1), (34.4, 54.3)]
    me = lathe("Lens_ZoomRing", zoom, N, mats=[0, 0, 0, 0, 0, 1, 1, 1, 1, 1], uv_z=(29.7, 33.0),
               radial=_ribs_z(160, 0.42, zr_root, 34.3, 53.7, 0.45))
    _add(c, L, "Lens_ZoomRing", me, [M.printed("lens_scale_print", "lens_plastic", tex["scale"]), "lens_rubber"])
    # front housing, focus ring and hood bayonet
    fr_root = 37.75
    front = [(34.4, 54.4), (35.5, 54.5), (35.7, 55.0), (37.8, 60.2), (38.0, 60.6), (38.0, 62.4), (37.8, 62.6),
             (fr_root, 62.8), (fr_root, 73.2), (37.9, 73.5), (37.7, 73.8), (34.4, 74.6), (34.2, 75.0),
             (34.2, 76.3), (36.4, 76.45), (36.6, 76.7), (36.6, 78.1), (36.4, 78.3), (34.7, 78.35), (34.7, 80.35),
             (36.4, 80.4), (36.6, 80.6), (36.6, 83.1), (36.4, 83.3), (34.7, 83.35), (34.7, 86.6), (34.45, 87.05),
             (34.0, 87.2), (33.65, 87.1), (33.5, 86.8), (33.5, 84.4), (33.3, 84.2)]
    mats = [0] * 6 + [1] * 3 + [0] * 23
    focus_rad = _ribs_z(240, 0.32, fr_root, 62.8, 73.2, 0.4)
    me = lathe("Lens_Front", front, N, mats=mats, radial=lambda th, z, r: _notches(th, z, focus_rad(th, z, r)))
    _add(c, L, "Lens_Front", me, ["lens_plastic", "lens_rubber"])
    # filter thread grooves
    th = [(33.5, 84.2)]
    for k in range(6):
        z = 84.4 + k * 0.45
        th += [(33.5, z), (33.15, z + 0.22)]
    th += [(33.5, 87.0)]
    _add(c, L, "Lens_Thread", lathe("Lens_Thread", th[::-1], N // 2, sharp=20), ["lens_plastic"])
    # front text ring (planar UV, texture seen from the front)
    _add(c, L, "Lens_TextRing", _annulus("Lens_TextRing", 28.6, 33.5, 84.2, tex_half=34.0),
         [M.printed("lens_front_print", "lens_plastic", tex["front"])])
    # inner barrel with light-trap steps down to the front element
    inner = [(28.6, 84.2)]
    for k in range(7):
        z = 84.0 - k * 0.55
        r = 28.4 - k * 0.5
        inner += [(r, z), (r - 0.35, z - 0.08), (r - 0.35, z - 0.45)]
    inner += [(24.6, 80.0), (24.3, 79.6)]
    _add(c, L, "Lens_InnerBarrel", lathe("Lens_InnerBarrel", inner, N // 2, sharp=25), ["interior"])
    optics(c, L)
    # hood alignment dot, red mount index, AF/MF switch
    _add(c, L, "Lens_HoodDot", _disc("hd", 0.55), ["print_white"], place((0, 1, 0), (0, 0, 1), (0, 34.72, 79.35)))
    a = math.radians(180)
    _add(c, L, "Lens_RedDot", _disc("rd", 0.6), ["red_paint"],
         place((math.cos(a), math.sin(a), 0), (0, 0, 1), (31.82 * math.cos(a), 31.82 * math.sin(a), 2.6)))
    _add(c, L, "Lens_AFMF_Well", rounded_box("w", 7.6, 5.0, 0.8, 0.35, 3), ["interior"],
         place((1, 0, 0), (0, 0, 1), (35.0, 0, 22.0)))
    _add(c, L, "Lens_AFMF_Knob", rounded_box("k", 2.8, 3.6, 1.6, 0.5, 3), ["lens_plastic"],
         place((1, 0, 0), (0, 0, 1), (35.5, 1.6, 22.0)))
    for k in range(4):
        _add(c, L, "Lens_AFMF_Rib", rounded_box("r", 2.2, 0.3, 0.25, 0.08, 1), ["lens_plastic"],
             place((1, 0, 0), (0, 0, 1), (36.35, 1.6, 20.8 + 0.8 * k)))
    return L


def _ribs_z(n, depth, root, z0, z1, flat):
    """Axial ribs with softened ends so they fade into the ring lips."""
    def f(th, z, r):
        sel = (np.abs(r - root) < 1e-6) & (z > z0 + 1e-6) & (z < z1 - 1e-6)
        t = (th / TAU * n) % 1.0
        tri = 1 - np.abs(t * 2 - 1)
        h = np.clip(tri / (1 - flat), 0, 1)
        return np.where(sel, r + depth * h, r)
    return f


def _annulus(name, r0, r1, z, tex_half, n=N // 2):
    verts, faces, uvs = [], [], []
    for i in range(n):
        a = TAU * i / n
        for r in (r0, r1):
            verts.append((r * math.cos(a), r * math.sin(a), z))
    for i in range(n):
        i2 = (i + 1) % n
        f = (2 * i, 2 * i + 1, 2 * i2 + 1, 2 * i2)
        faces.append(f)
        for k in f:
            x, y, _ = verts[k]
            uvs.append(((x + tex_half) / (2 * tex_half), (y + tex_half) / (2 * tex_half)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    uvl = me.uv_layers.new(name="UVMap")
    uvl.data.foreach_set("uv", np.asarray(uvs, np.float32).ravel())
    me.polygons.foreach_set("use_smooth", np.full(len(faces), True))
    return me


def _disc(name, r, n=32):
    return lathe(name, [(0, 0), (r, 0), (r, 0.04), (0, 0.05)], n)


def _element(name, r, z_back, z_front, sag_back, sag_front, n=192):
    """Lens element: spherical caps given as sag (positive bulges outward)."""
    prof = []
    for k in range(13):
        t = k / 12
        rr = r * t
        prof.append((rr, z_back - sag_back * (1 - t * t)))
    prof.append((r, z_front))
    for k in range(12, -1, -1):
        t = k / 12
        rr = r * t
        prof.append((rr, z_front + sag_front * (1 - t * t)))
    return lathe(name, prof, n, sharp=None)


def optics(c, L):
    """Front element, inner groups, iris and a dark inner tube for depth."""
    _add(c, L, "Lens_FrontElement", _element("FE", 24.3, 76.6, 80.0, -1.5, 4.2), ["lens_glass"])
    _add(c, L, "Lens_Element2", _element("E2", 20.5, 68.5, 71.0, 1.2, -1.8), ["lens_glass_b"])
    _add(c, L, "Lens_Element3", _element("E3", 15.5, 41.0, 45.0, 1.6, 1.4), ["lens_glass"])
    _add(c, L, "Lens_Element4", _element("E4", 13.5, 26.0, 29.0, 0.8, 1.2), ["lens_glass_b"])
    _add(c, L, "Lens_RearElement", _element("RE", 14.5, -8.6, -5.5, 1.0, 1.2), ["lens_glass"])
    # inner tube, normals facing the axis
    tube = [(15.0, -9.0), (17.0, 20.0), (19.0, 40.0), (21.5, 60.0), (24.4, 79.6)]
    me = lathe("Lens_Tube", tube, 192, sharp=None)
    me.flip_normals()
    _add(c, L, "Lens_Tube", me, ["interior"])
    # nine-blade iris
    bm = bmesh.new()
    n_out = 96
    outer = [bm.verts.new((21.0 * math.cos(TAU * i / n_out), 21.0 * math.sin(TAU * i / n_out), 50.0))
             for i in range(n_out)]
    inner = []
    for i in range(n_out):
        a = TAU * i / n_out
        k = (a / (TAU / 9)) % 1.0
        rr = 8.2 / math.cos((k - 0.5) * TAU / 9)
        inner.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), 50.0)))
    for i in range(n_out):
        i2 = (i + 1) % n_out
        bm.faces.new((outer[i], outer[i2], inner[i2], inner[i]))
    me = bpy.data.meshes.new("Lens_Iris")
    bm.to_mesh(me)
    bm.free()
    _add(c, L, "Lens_Iris", me, ["dial_metal"])
    # lens groups' retaining rings
    for z, r0, r1 in ((70.0, 20.4, 24.4), (43.0, 15.4, 19.2), (27.5, 13.4, 17.2)):
        ring = lathe("ret", [(r0, z - 0.8), (r1, z - 0.8), (r1, z + 0.8), (r0, z + 0.8), (r0, z - 0.8)], 192)
        _add(c, L, "Lens_Retainer", ring, ["interior"])
