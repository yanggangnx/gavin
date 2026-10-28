"""Mesh builders for Blender: lathe bodies, knurled bands, rounded boxes, text.

All builders return bpy mesh datablocks in millimetres; objects are parented
to a root empty scaled 0.001 so the scene itself is in metres.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

TAU = 2 * math.pi


def set_sharp(me, angle_deg):
    """Mark edges sharper than angle_deg (and open borders) as sharp."""
    a = math.radians(angle_deg)
    bm = bmesh.new()
    bm.from_mesh(me)
    for e in bm.edges:
        if not e.is_manifold:
            e.smooth = False
        else:
            e.smooth = e.calc_face_angle(0.0) < a
    bm.to_mesh(me)
    bm.free()


def _mesh(name, verts, faces, mat_idx=None, loop_uv=None, smooth=True, sharp=30.0):
    me = bpy.data.meshes.new(name)
    me.from_pydata(np.asarray(verts, float).tolist(), [], [list(map(int, f)) for f in faces])
    if mat_idx is not None:
        me.polygons.foreach_set("material_index", np.asarray(mat_idx, np.int32))
    if loop_uv is not None:
        uvl = me.uv_layers.new(name="UVMap")
        uvl.data.foreach_set("uv", np.asarray(loop_uv, np.float32).ravel())
    me.polygons.foreach_set("use_smooth", np.full(len(me.polygons), smooth))
    if smooth and sharp:
        set_sharp(me, sharp)
    me.validate()
    me.update()
    return me


def obj(name, me, parent=None, mats=(), matrix=None, coll=None):
    ob = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(ob)
    if parent is not None:
        ob.parent = parent
    for m in mats:
        me.materials.append(m)
    if matrix is not None:
        ob.matrix_basis = matrix
    return ob


def weld(me, dist=1e-4):
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bm.to_mesh(me)
    bm.free()
    return me


def fix_normals(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()


def merge_meshes(name, meshes, sharp=30.0, weld_dist=1e-4):
    bm = bmesh.new()
    for me in meshes:
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    if weld_dist:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=weld_dist)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.polygons.foreach_set("use_smooth", np.full(len(me.polygons), True))
    if sharp:
        set_sharp(me, sharp)
    return me


# ------------------------------------------------------------------ lathe

def lathe(name, prof, n=128, mats=None, uv=False, sharp=30.0, radial=None, th0=0.0, uv_z=None):
    """Revolve a profile around local Z.

    prof: [(r, z), ...] from the bottom axis outward/up/inward to the top
    axis, so normals face out. mats: material index per profile segment.
    radial(theta, z, r) -> r', optional displacement (knurls, flats).
    """
    p = np.asarray(prof, float)
    m = len(p)
    th = th0 + np.linspace(0, TAU, n, endpoint=False)
    R = np.repeat(p[None, :, 0], n, 0)
    Z = np.repeat(p[None, :, 1], n, 0)
    if radial is not None:
        R = radial(th[:, None], Z, R)
    on_axis = p[:, 0] < 1e-9
    verts, index = [], -np.ones((n, m), int)
    axis_idx = {}
    for j in range(m):
        if on_axis[j]:
            axis_idx[j] = len(verts)
            verts.append((0, 0, p[j, 1]))
            index[:, j] = axis_idx[j]
        else:
            for i in range(n):
                index[i, j] = len(verts)
                verts.append((R[i, j] * math.cos(th[i]), R[i, j] * math.sin(th[i]), Z[i, j]))
    faces, fm, luv = [], [], []
    vlen = np.concatenate([[0], np.cumsum(np.hypot(np.diff(p[:, 0]), np.diff(p[:, 1])))])
    vlen = vlen / max(vlen[-1], 1e-9)
    if uv_z is not None:                       # v linear in z over uv_z=(z0, z1)
        vlen = (p[:, 1] - uv_z[0]) / (uv_z[1] - uv_z[0])
        uv = True
    for j in range(m - 1):
        for i in range(n):
            i2 = (i + 1) % n
            a, b, c, d = index[i, j], index[i2, j], index[i2, j + 1], index[i, j + 1]
            u0, u1 = i / n, (i + 1) / n
            if on_axis[j] and on_axis[j + 1]:
                continue
            if on_axis[j]:
                f, uvs = (a, c, d), [(u0, vlen[j]), (u1, vlen[j + 1]), (u0, vlen[j + 1])]
            elif on_axis[j + 1]:
                f, uvs = (a, b, d), [(u0, vlen[j]), (u1, vlen[j]), (u0, vlen[j + 1])]
            else:
                f, uvs = (a, b, c, d), [(u0, vlen[j]), (u1, vlen[j]), (u1, vlen[j + 1]), (u0, vlen[j + 1])]
            faces.append(f)
            luv.extend(uvs)
            fm.append(0 if mats is None else mats[j])
    return _mesh(name, verts, faces, fm, luv if uv else None, sharp=sharp)


def knurl_pyramid(n_col, z0, z1, n_row, depth, root):
    """radial() for a square-pyramid knurl band between z0 and z1."""
    def f(th, z, r):
        inband = (z > z0 - 1e-6) & (z < z1 + 1e-6) & (np.abs(r - root) < 1e-6)
        u = (th / TAU * n_col) % 1.0 * 2 - 1
        v = ((z - z0) / (z1 - z0) * n_row) % 1.0 * 2 - 1
        v = np.where(z >= z1 - 1e-6, -1.0, v)
        h = 1 - np.maximum(np.abs(u), np.abs(v))
        return np.where(inband, r + depth * h, r)
    return f


def pyramid_band(name, root, z0, z1, n_col, n_row, depth, sub=4, n_flat_top=0):
    """Knurled ring of square pyramids with ridge-following triangulation."""
    nu, nv = n_col * sub, n_row * sub
    verts = []
    for j in range(nv + 1):
        z = z0 + (z1 - z0) * j / nv
        v = (j % sub) / sub * 2 - 1 if j < nv else -1
        for i in range(nu):
            th = TAU * i / nu
            u = (i % sub) / sub * 2 - 1
            r = root + depth * (1 - max(abs(u), abs(v)))
            verts.append((r * math.cos(th), r * math.sin(th), z))
    faces = []
    for j in range(nv):
        for i in range(nu):
            i2 = (i + 1) % nu
            a, b = j * nu + i, j * nu + i2
            c, d = (j + 1) * nu + i2, (j + 1) * nu + i
            uc = ((i % sub) + 0.5) / sub * 2 - 1
            vc = ((j % sub) + 0.5) / sub * 2 - 1
            if uc * vc > 0:
                faces += [(a, b, c), (a, c, d)]
            else:
                faces += [(a, b, d), (b, c, d)]
    return _mesh(name, verts, faces, sharp=25)


def ribs(n, depth, root, z0=None, z1=None, flat=0.35):
    """radial() for straight axial ribs (gear teeth if flat=0)."""
    def f(th, z, r):
        sel = np.abs(r - root) < 1e-6
        if z0 is not None:
            sel &= (z > z0 - 1e-6) & (z < z1 + 1e-6)
        t = (th / TAU * n) % 1.0
        tri = 1 - np.abs(t * 2 - 1)               # 0 at the groove, 1 at the crest
        h = np.clip(tri / max(1e-6, 1 - flat), 0, 1)
        return np.where(sel, r + depth * h, r)
    return f


# ------------------------------------------------------------------ boxes

def rounded_box(name, sx, sy, sz, r, seg=4, sharp=None):
    """Box centred at the origin with all edges rounded by r."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    if r > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=r, segments=seg, profile=0.5, affect="EDGES",
                        clamp_overlap=True)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.polygons.foreach_set("use_smooth", np.full(len(me.polygons), True))
    if sharp:
        set_sharp(me, sharp)
    return me


def rounded_slab(name, outline, z0, z1, r_top=0.3, r_bot=0.0, seg=3):
    """Extrude a closed 2D outline (N,2) from z0 to z1, round the cap edges."""
    pts = np.asarray(outline, float)
    bm = bmesh.new()
    vb = [bm.verts.new((x, y, z0)) for x, y in pts]
    vt = [bm.verts.new((x, y, z1)) for x, y in pts]
    n = len(pts)
    area = 0.5 * np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
    order = range(n) if area > 0 else range(n - 1, -1, -1)
    order = list(order)
    bm.faces.new([vt[i] for i in order])
    bm.faces.new([vb[i] for i in reversed(order)])
    for k in range(n):
        i, i2 = order[k], order[(k + 1) % n]
        bm.faces.new((vb[i], vb[i2], vt[i2], vt[i]))
    bm.normal_update()
    sel = []
    for e in bm.edges:
        zs = [v.co.z for v in e.verts]
        if abs(zs[0] - zs[1]) < 1e-9:
            if r_top > 0 and abs(zs[0] - z1) < 1e-9:
                sel.append(e)
    if sel:
        bmesh.ops.bevel(bm, geom=sel, offset=r_top, segments=seg, profile=0.5, affect="EDGES", clamp_overlap=True)
    if r_bot > 0:
        sel = [e for e in bm.edges if all(abs(v.co.z - z0) < 1e-9 for v in e.verts)]
        bmesh.ops.bevel(bm, geom=sel, offset=r_bot, segments=seg, profile=0.5, affect="EDGES", clamp_overlap=True)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.polygons.foreach_set("use_smooth", np.full(len(me.polygons), True))
    set_sharp(me, 40)
    return me


def rrect(cx, cy, hx, hy, r, n=8):
    """Rounded rectangle outline points (CCW)."""
    pts = []
    for (sx, sy, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ccx, ccy = cx + sx * (hx - r), cy + sy * (hy - r)
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((ccx + r * math.cos(a), ccy + r * math.sin(a)))
    return np.array(pts)


def torus(name, R, r, nu=48, nv=16):
    verts, faces = [], []
    for i in range(nu):
        a = TAU * i / nu
        for j in range(nv):
            b = TAU * j / nv
            verts.append(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
    for i in range(nu):
        for j in range(nv):
            i2, j2 = (i + 1) % nu, (j + 1) % nv
            faces.append((i * nv + j, i2 * nv + j, i2 * nv + j2, i * nv + j2))
    me = _mesh(name, verts, faces, sharp=None)
    fix_normals(me)
    return me


def sweep_circle(name, path, r, nv=12, closed=True):
    """Tube of radius r along a polyline path (N,3)."""
    P = np.asarray(path, float)
    n = len(P)
    verts, faces = [], []
    for i in range(n):
        t = P[(i + 1) % n] - P[i - 1] if closed else P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
        t = t / np.linalg.norm(t)
        a = np.array([0, 0, 1.0]) if abs(t[2]) < 0.9 else np.array([1.0, 0, 0])
        nrm = np.cross(t, a)
        nrm /= np.linalg.norm(nrm)
        bin_ = np.cross(t, nrm)
        for j in range(nv):
            b = TAU * j / nv
            verts.append(P[i] + r * (math.cos(b) * nrm + math.sin(b) * bin_))
    m = n if closed else n - 1
    for i in range(m):
        i2 = (i + 1) % n
        for j in range(nv):
            j2 = (j + 1) % nv
            faces.append((i * nv + j, i2 * nv + j, i2 * nv + j2, i * nv + j2))
    me = _mesh(name, verts, faces, sharp=None)
    fix_normals(me)
    return me


def mesh_from_npz(name, path, scale=1.0):
    d = np.load(path)
    v, f = d["verts"] * scale, d["faces"]
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(v))
    me.vertices.foreach_set("co", v.ravel())
    me.loops.add(f.size)
    me.loops.foreach_set("vertex_index", f.ravel())
    me.polygons.add(len(f))
    me.polygons.foreach_set("loop_start", np.arange(0, f.size, 3))
    if "mat" in d:
        me.polygons.foreach_set("material_index", d["mat"].astype(np.int32))
    me.update(calc_edges=True)
    me.validate()
    me.polygons.foreach_set("use_smooth", np.full(len(f), True))
    return me


# ------------------------------------------------------------------ text

_fonts = {}


def font(path):
    if path not in _fonts:
        _fonts[path] = bpy.data.fonts.load(path)
    return _fonts[path]


def text_mesh(name, s, fnt, cap_h, depth=0.05, align="CENTER", spacing=1.0, stretch=1.0, bevel=0.0):
    """Text in the local XY plane, reading along +X, front face at z=depth, back at z=0."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = s
    cu.font = fnt
    cu.size = cap_h / 0.727
    cu.space_character = spacing
    cu.align_x = align
    cu.align_y = "CENTER"
    cu.extrude = depth / 2
    cu.bevel_depth = bevel
    cu.resolution_u = 4
    tmp = bpy.data.objects.new(name + "_tmp", cu)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(cu)
    me.transform(Matrix.Diagonal((stretch, 1, 1, 1)) @ Matrix.Translation((0, 0, depth / 2)))
    me.polygons.foreach_set("use_smooth", np.full(len(me.polygons), False))
    return me


def place(normal, up, pos):
    """Matrix taking local +Z to `normal`, local +Y to `up`, origin to pos."""
    z = Vector(normal).normalized()
    y = Vector(up)
    y = (y - y.project(z)).normalized()
    x = y.cross(z)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = Vector(pos)
    return m
