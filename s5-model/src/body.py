"""S5 body shell as a signed-distance field -> marching cubes mesh.

Run with any Python that has numpy, scipy and scikit-image:
    python body.py --h 0.25 --out ../build/body.npz
The mesh is saved as vertices, faces and a per-face material index
(0 paint, 1 leatherette, 2 mount interior).
"""
import argparse
import time

import numpy as np
from skimage.measure import marching_cubes

import dims as D
from sdf import (band, catmull_rom, d_round, fillet_polygon, i_round,
                 sd_box2, sd_circle, sd_polygon, smoothstep, u_round)

LEATHER_DEPTH = 0.3


# ---------------------------------------------------------------- profiles

def chassis_yz():
    v = [(D.Y_FRONT, 0), (D.Y_BACK, 0), (D.Y_BACK, D.Z_SHOULDER),
         (D.Y_TOPBAND, D.Z_SHOULDER), (1.8, D.Z_LEATHER_TOP + 0.4), (D.Y_FRONT, D.Z_LEATHER_TOP)]
    return fillet_polygon(v, [2.2, 2.2, 1.8, 1.4, 0.4, 0.6])


def grip_xy():
    front = catmull_rom([(D.GRIP_X_IN, 3.5), (-48.8, -4.0), (-50.4, -11.5), (-53.8, -18.0),
                         (-58.5, -21.0), (-64.0, D.GRIP_Y_FRONT), (-70.0, -21.5), (-75.2, -19.6),
                         (-79.6, -15.4), (-82.6, -9.0), (-84.3, -2.0), (D.X_MIN, 5.0)], 16)
    back = np.array([(D.X_MIN, 60.0), (D.GRIP_X_IN, 60.0)])
    return np.vstack([front, back])


def grip_front_scale(z):
    """Lofting factor: how far forward the grip reaches at height z (1 = full)."""
    zk = np.array([-2, 5, 54, 58, 62.5, 67, 70.5, 73.5, 80])
    yk = np.array([-18.7, -19.2, -19.2, -18.0, -15.9, -17.6, -21.0, -21.9, -21.6])
    return np.interp(z, zk, yk) / D.GRIP_Y_FRONT


def grip_yz():
    v = [(-35, 0), (D.Y_BACK, 0), (D.Y_BACK, D.Z_SHOULDER), (D.PLATEAU_Y_BACK + 4.0, D.Z_SHOULDER),
         (D.PLATEAU_Y_BACK, D.Z_PLATEAU), (-1.5, D.Z_PLATEAU), (-22.5, 72.3), (-35, 66)]
    return fillet_polygon(v, [0, 2.2, 1.8, 2.0, 2.5, 6.0, 3.5, 0])


def hump_trapezoid():
    """EVF hump in front view: vertical walls, then sloped shoulders up to the top."""
    hw, zk, top = D.HUMP_HW_WALL, D.HUMP_Z_KNEE, D.HUMP_HW_TOP
    k = (hw - top) / (D.HUMP_Z_TOP - zk)
    up = top - (104 - D.HUMP_Z_TOP) * k
    lo = hw + (zk - 60) * D.HUMP_WALL_SLOPE
    v = [(-lo, 60), (lo, 60), (hw, zk), (up, 104), (-up, 104), (-hw, zk)]
    return fillet_polygon(v, [0, 0, 4.0, 0, 0, 4.0])


def hump_taper(y):
    """The hump is widest at its LUMIX face and narrows toward the eyepiece."""
    return 1.0 - (1.0 - D.HUMP_TAPER) * smoothstep(4.0, 16.0, y)


def front_yz():
    v = [(D.HUMP_Y_FRONT, 58.0), (D.HUMP_Y_FRONT, 88.6), (20.5, D.HUMP_Z_TOP), (47.5, D.HUMP_Z_TOP),
         (50.5, 91.6), (50.5, 62.5), (10.0, 62.5), (10.0, 58.0)]
    return fillet_polygon(v, [0, 1.5, 6.0, 1.5, 1.5, 1.5, 0, 0])


def front2d(x, z, trap):
    return u_round(sd_circle(x, z, 0, D.MOUNT_Z, D.BOSS_R), sd_polygon(x, z, trap), 3.0)


# ---------------------------------------------------------------- leather

def leather_mask(x, y, z, dfront):
    w = 0.6
    sm = lambda v: smoothstep(-w / 2, w / 2, v)
    zlo = 1.6 + 4.4 * smoothstep(-46.5, -49.5, x)
    a = sm(1.6 - y) * sm(z - zlo) * sm(D.Z_LEATHER_TOP - z) * sm(dfront - 1.3)
    for b in (D.FN_FRONT, D.LENS_RELEASE):
        a = a * sm(sd_circle(x, z, b["x"], b["z"], b["bezel"] + 0.15))
    bd = D.S5_BADGE
    a = a * sm(sd_box2(x, z, (bd["x0"] + bd["x1"]) / 2, (bd["z0"] + bd["z1"]) / 2,
                       (bd["x1"] - bd["x0"]) / 2 + 0.2, (bd["z1"] - bd["z0"]) / 2 + 0.2, 1.0))
    b = sm(-83.6 - x) * band(y, 0.4, D.SD_DOOR["y0"] - 0.6, w) * band(z, 6.0, D.Z_LEATHER_TOP, w)
    c = sm(x - 46.6) * band(y, 0.4, 11.0, w) * band(z, 1.6, D.Z_LEATHER_TOP, w)
    d = sm(y - 46.2) * band(x, -78.5, -54.0, w) * band(z, 3.5, 66.0, w)
    for k in ("AFON", "Q", "BACK", "DISP"):
        bb = D.BACK_BUTTONS[k]
        d = d * sm(sd_circle(x, z, bb["x"], bb["z"], bb["bezel"] + 0.8))
    cd = D.CONTROL_DIAL
    d = d * sm(sd_circle(x, z, cd["x"], cd["z"], cd["r"] + 1.0))
    return np.maximum(np.maximum(a, b), np.maximum(c, d))


# ---------------------------------------------------------------- recesses

def recesses(body, x, y, z):
    """Pockets for separate parts (doors, LCD, buttons) and the mount throat."""
    # mount throat and mirror box
    throat = i_round(sd_circle(x, z, 0, D.MOUNT_Z, 26.6), np.maximum(-12 - y, y - 9.0), 0)
    box = i_round(sd_box2(x, z, 0, D.MOUNT_Z, 23.0, 17.5, 3.0), np.maximum(2.0 - y, y - (D.SENSOR_Y + 1.5)), 0)
    body = d_round(body, np.minimum(throat, box), 0.4)
    # front buttons
    for b, depth in ((D.FN_FRONT, 0.8), (D.LENS_RELEASE, 1.0)):
        cyl = np.maximum(sd_circle(x, z, b["x"], b["z"], b["bezel"] + 0.15), np.maximum(-10 - y, y - depth))
        body = d_round(body, cyl, 0.25)
    cyl = np.maximum(sd_circle(x, z, D.AF_LAMP["x"], D.AF_LAMP["z"], D.AF_LAMP["r"] + 0.2),
                     np.maximum(-10 - y, y - (D.Y_TOPBAND + 0.8)))
    body = d_round(body, cyl, 0.15)
    bd = D.S5_BADGE
    plate = np.maximum(sd_box2(x, z, (bd["x0"] + bd["x1"]) / 2, (bd["z0"] + bd["z1"]) / 2,
                               (bd["x1"] - bd["x0"]) / 2, (bd["z1"] - bd["z0"]) / 2, 1.0),
                       np.maximum(-10 - y, y - 0.4))
    body = d_round(body, plate, 0.2)
    # back: LCD bed and control dial well
    l = D.LCD
    bed = np.maximum(sd_box2(x, z, (l["x0"] + l["x1"]) / 2, (l["z0"] + l["z1"]) / 2,
                             (l["x1"] - l["x0"]) / 2 + 0.8, (l["z1"] - l["z0"]) / 2 + 0.8, 2.5),
                     np.maximum(D.Y_BACK - 0.8 - y, y - 60))
    body = d_round(body, bed, 0.3)
    cd = D.CONTROL_DIAL
    well = np.maximum(sd_circle(x, z, cd["x"], cd["z"], cd["r"] + 0.6), np.maximum(D.Y_BACK - 1.2 - y, y - 60))
    body = d_round(body, well, 0.3)
    # side doors sit flush in shallow beds
    for p in D.PORT_DOORS:
        bed = np.maximum(sd_box2(y, z, (p["y0"] + p["y1"]) / 2, (p["z0"] + p["z1"]) / 2,
                                 (p["y1"] - p["y0"]) / 2 + 0.25, (p["z1"] - p["z0"]) / 2 + 0.25, 1.6),
                         np.maximum(D.X_MAX - 0.7 - x, x - 60))
        body = d_round(body, bed, 0.2)
    s = D.SD_DOOR
    bed = np.maximum(sd_box2(y, z, (s["y0"] + s["y1"]) / 2, (s["z0"] + s["z1"]) / 2,
                             (s["y1"] - s["y0"]) / 2 + 0.25, (s["z1"] - s["z0"]) / 2 + 0.25, 2.0),
                     np.maximum(x - (D.X_MIN + 0.7), -100 - x))
    body = d_round(body, bed, 0.2)
    r = D.REMOTE_COVER
    bed = np.maximum(sd_box2(y, z, (r["y0"] + r["y1"]) / 2, (r["z0"] + r["z1"]) / 2,
                             (r["y1"] - r["y0"]) / 2 + 0.2, (r["z1"] - r["z0"]) / 2 + 0.2, 1.8),
                     np.maximum(x - (D.X_MIN + 0.6), -100 - x))
    body = d_round(body, bed, 0.2)
    # bottom: battery door bed and tripod socket
    b = D.BATTERY_DOOR
    bed = np.maximum(sd_box2(x, y, (b["x0"] + b["x1"]) / 2, (b["y0"] + b["y1"]) / 2,
                             (b["x1"] - b["x0"]) / 2 + 0.25, (b["y1"] - b["y0"]) / 2 + 0.25, 3.0),
                     np.maximum(z - 0.6, -10 - z))
    body = d_round(body, bed, 0.2)
    t = D.TRIPOD
    hole = np.maximum(sd_circle(x, y, t["x"], t["y"], 5.6), np.maximum(z - 0.5, -10 - z))
    hole = np.minimum(hole, np.maximum(sd_circle(x, y, t["x"], t["y"], 3.3), np.maximum(z - 9.0, -10 - z)))
    body = d_round(body, hole, 0.2)
    # the rear dial sits in a pocket cut down to the deck
    rd = D.REAR_DIAL
    pocket = np.maximum(sd_circle(x, y, rd["x"], rd["y"], rd["r"] + 0.9), D.Z_SHOULDER - z)
    body = d_round(body, pocket, 0.8)
    # stereo mic slots on the hump slope
    for mx, my in D.MIC_HOLES:
        slot = np.maximum(sd_box2(x, y, mx, my, 1.5, 0.45, 0.45), np.maximum(80 - z, z - 120))
        slot = np.maximum(slot, -(z - 90))
        body = d_round(body, slot, 0.12)
    return body


# ---------------------------------------------------------------- field

def build(h, chunk=24):
    x = np.arange(-90.0, 53.0 + h, h, dtype=np.float32)
    y = np.arange(-25.0, 54.0 + h, h, dtype=np.float32)
    z = np.arange(-1.5, 96.5 + h, h, dtype=np.float32)
    nx, ny, nz = len(x), len(y), len(z)
    print(f"grid {nx}x{ny}x{nz} = {nx*ny*nz/1e6:.1f}M voxels")

    Y2, Z2 = np.meshgrid(y, z, indexing="ij")
    X2z, Z2x = np.meshgrid(x, z, indexing="ij")
    X2y, Y2x = np.meshgrid(x, y, indexing="ij")
    t0 = time.time()
    d_ch_yz = sd_polygon(Y2, Z2, chassis_yz()).astype(np.float32)
    d_gr_yz = sd_polygon(Y2, Z2, grip_yz()).astype(np.float32)
    d_fr_yz = sd_polygon(Y2, Z2, front_yz()).astype(np.float32)
    trap = hump_trapezoid()
    d_fr_xz = front2d(X2z, Z2x, trap).astype(np.float32)
    d_trap = sd_polygon(X2z, Z2x, trap).astype(np.float32)
    taper = hump_taper(y).astype(np.float32)
    d_gr_xy = sd_polygon(X2y, Y2x, grip_xy()).astype(np.float32)
    print(f"2D profiles {time.time()-t0:.1f}s")

    d_sides = np.maximum(x - D.X_MAX, -60.0 - x).astype(np.float32)
    vol = np.empty((nx, ny, nz), np.float32)
    X3 = x[:, None, None]
    Y3 = y[None, :, None]
    for k0 in range(0, nz, chunk):
        k1 = min(nz, k0 + chunk)
        zc = z[k0:k1]
        Z3 = zc[None, None, :]
        chassis = i_round(d_sides[:, None, None], d_ch_yz[None, :, k0:k1], 2.5)
        # grip lofted: scale the front part of the outline per slice
        s = grip_front_scale(zc).astype(np.float32)
        g = np.empty((nx, ny, k1 - k0), np.float32)
        blend = smoothstep(3.0, -9.0, y)        # ease the loft in so the side wall has no crease
        for kk, sk in enumerate(s):
            sc = 1.0 + (sk - 1.0) * blend
            yp = y / sc
            fj = (yp - y[0]) / h
            j0 = np.clip(np.floor(fj).astype(int), 0, ny - 2)
            t = np.clip(fj - j0, 0, 1)
            col = d_gr_xy[:, j0] * (1 - t) + d_gr_xy[:, j0 + 1] * t
            g[:, :, kk] = col * (0.5 + 0.5 * sc)
        grip = i_round(g, d_gr_yz[None, :, k0:k1], 3.0)
        # fillet: grip root into the front face, plateau wall into the shoulder
        r_front = 5.0 * smoothstep(3.0, 0.0, Y3) * smoothstep(4.0, 7.0, Z3) * smoothstep(68.0, 65.0, Z3)
        r_plat = 0.8 * smoothstep(72.0, 74.0, Z3) * smoothstep(D.PLATEAU_Y_BACK - 1.0, D.PLATEAU_Y_BACK - 4.0, Y3) \
            * smoothstep(-2.0, 1.0, Y3)
        body = u_round(chassis, grip, (r_front + r_plat).astype(np.float32))
        # boss + neck fillet: a shallow block on the front face only
        yb = 10.0 - 8.0 * smoothstep(64.0, 68.0, Z3)
        boss = i_round(d_fr_xz[:, None, k0:k1], np.maximum(np.maximum(D.HUMP_Y_FRONT - Y3, Y3 - yb), Z3 - 80.0), 1.5)
        # hump, tapering toward the back: sample the outline at x / taper(y)
        hump2d = np.empty((nx, ny, k1 - k0), np.float32)
        for j in range(ny):
            f = taper[j]
            fi = (x / f - x[0]) / h
            i0 = np.clip(np.floor(fi).astype(int), 0, nx - 2)
            t = np.clip(fi - i0, 0, 1)[:, None]
            hump2d[:, j, :] = (d_trap[i0, k0:k1] * (1 - t) + d_trap[i0 + 1, k0:k1] * t) * f
        hump = i_round(hump2d, d_fr_yz[None, :, k0:k1], 1.5)
        body = u_round(body, np.minimum(boss, hump), 1.2)
        body = recesses(body, X3, Y3, Z3)
        L = leather_mask(X3, Y3, Z3, d_fr_xz[:, None, k0:k1])
        vol[:, :, k0:k1] = body - LEATHER_DEPTH * L
    print(f"field {time.time()-t0:.1f}s")
    return vol, (x[0], y[0], z[0]), trap


def face_materials(verts, faces, trap):
    c = verts[faces].mean(axis=1)
    x, y, z = c[:, 0], c[:, 1], c[:, 2]
    dfront = front2d(x, z, trap)
    mat = np.zeros(len(faces), np.int8)
    mat[leather_mask(x, y, z, dfront) > 0.5] = 1
    inside = (np.sqrt(x ** 2 + (z - D.MOUNT_Z) ** 2) < 27.2) & (y > -1.0) & (y < D.SENSOR_Y + 3)
    mat[inside] = 2
    return mat


# ---------------------------------------------------------------- eyecup

def build_eyecup(h):
    e = D.EYECUP
    x = np.arange(-24.0, 23.0 + h, h, dtype=np.float32)
    y = np.arange(49.0, 62.0 + h, h, dtype=np.float32)
    z = np.arange(59.5, 97.5 + h, h, dtype=np.float32)
    X, Y, Z = x[:, None, None], y[None, :, None], z[None, None, :]
    zc = (e["z0"] + e["z1"]) / 2
    t = np.clip((Y - 50.0) / 10.6, 0, 1)
    hx, hz = 19.4 + 1.1 * t, (e["z1"] - e["z0"]) / 2 - 1.0 + 1.0 * t
    outer2d = sd_box2(X, Z, e["x"], zc, hx, hz, 8.5)
    xr = (X - e["x"]) / e["hx"]
    y_rear = e["y1"] - 2.2 * (1 - np.clip(xr * xr, 0, 1))
    outer = i_round(outer2d, np.maximum(50.0 - Y, Y - y_rear), 2.8)
    wx, wz, wcx, wcz = 10.2, 7.35, -0.4, 79.4
    s = np.clip((Y - 53.8) / 6.0, 0, 1)
    hole = sd_box2(X, Z, wcx, wcz, wx + 3.2 * s, wz + 2.8 * s, 3.0 + 3.0 * s)
    hole = np.maximum(hole, 50.8 - Y)
    cup = d_round(outer, hole, 1.1)
    sensor = np.maximum(sd_box2(X, Z, -0.4, 68.6, 2.6, 1.0, 0.9), 57.0 - Y)
    cup = d_round(cup, sensor, 0.25)
    return cup, (x[0], y[0], z[0])


def eyecup_materials(verts, faces):
    c = verts[faces].mean(axis=1)
    mat = np.zeros(len(faces), np.int8)
    sx = np.abs(c[:, 0] + 0.4) < 2.7
    sz = np.abs(c[:, 2] - 68.6) < 1.1
    mat[sx & sz & (c[:, 1] > 56.0)] = 1
    return mat


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--h", type=float, default=0.25)
    ap.add_argument("--out", default="body.npz")
    ap.add_argument("--part", default="body", choices=["body", "eyecup"])
    a = ap.parse_args()
    if a.part == "eyecup":
        vol, origin = build_eyecup(a.h)
        verts, faces, _, _ = marching_cubes(vol, 0.0, spacing=(a.h,) * 3, gradient_direction="ascent")
        verts += np.array(origin, np.float32)
        mat = eyecup_materials(verts, faces)
        np.savez_compressed(a.out, verts=verts.astype(np.float32), faces=faces.astype(np.int32), mat=mat)
        print("eyecup", len(faces), "faces ->", a.out)
        return
    vol, origin, trap = build(a.h)
    t0 = time.time()
    verts, faces, _, _ = marching_cubes(vol, 0.0, spacing=(a.h, a.h, a.h), gradient_direction="ascent")
    verts += np.array(origin, np.float32)
    print(f"marching cubes {time.time()-t0:.1f}s: {len(verts)} verts, {len(faces)} faces")
    mat = face_materials(verts, faces, trap)
    np.savez_compressed(a.out, verts=verts.astype(np.float32), faces=faces.astype(np.int32), mat=mat)
    print("saved", a.out)


if __name__ == "__main__":
    main()
