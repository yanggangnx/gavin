"""Signed-distance helpers (numpy). Negative inside, units in mm.

2D profiles are evaluated once on 2D grids and broadcast into 3D, so a body
built from extruded profiles costs little more than its 2D outlines.
"""
import numpy as np


# ---------------------------------------------------------------- 2D outlines

def fillet_polygon(verts, radii, seg_len=0.15):
    """Closed polygon with a circular fillet of radius radii[i] at vertex i.

    Works for convex and concave corners. Returns (N, 2) points.
    """
    v = np.asarray(verts, float)
    n = len(v)
    if np.isscalar(radii):
        radii = [radii] * n
    out = []
    for i in range(n):
        p, a, b = v[i], v[i - 1], v[(i + 1) % n]
        r = radii[i]
        if r <= 0:
            out.append(p)
            continue
        u = (a - p) / np.linalg.norm(a - p)
        w = (b - p) / np.linalg.norm(b - p)
        cosang = np.clip(np.dot(u, w), -1, 1)
        half = np.arccos(cosang) / 2
        if half < 1e-4 or half > np.pi / 2 - 1e-4:
            out.append(p)
            continue
        t = r / np.tan(half)
        t = min(t, 0.49 * np.linalg.norm(a - p), 0.49 * np.linalg.norm(b - p))
        rr = t * np.tan(half)
        t1, t2 = p + u * t, p + w * t
        bis = (u + w) / np.linalg.norm(u + w)
        c = p + bis * rr / np.sin(half)
        a1 = np.arctan2(*(t1 - c)[::-1])
        a2 = np.arctan2(*(t2 - c)[::-1])
        da = (a2 - a1 + np.pi) % (2 * np.pi) - np.pi
        k = max(2, int(abs(da) * rr / seg_len) + 1)
        for s in np.linspace(0, 1, k):
            ang = a1 + da * s
            out.append(c + rr * np.array([np.cos(ang), np.sin(ang)]))
    return np.array(out)


def catmull_rom(points, n_per=24, closed=False):
    """Centripetal Catmull-Rom spline through points."""
    p = np.asarray(points, float)
    if closed:
        p = np.vstack([p[-1], p, p[0], p[1]])
    else:
        p = np.vstack([2 * p[0] - p[1], p, 2 * p[-1] - p[-2]])
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        t0 = 0.0
        t1 = t0 + np.linalg.norm(p1 - p0) ** 0.5
        t2 = t1 + np.linalg.norm(p2 - p1) ** 0.5
        t3 = t2 + np.linalg.norm(p3 - p2) ** 0.5
        for t in np.linspace(t1, t2, n_per, endpoint=False):
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    if not closed:
        out.append(p[-2])
    return np.array(out)


def sd_polygon(px, py, verts):
    """Exact signed distance to a closed polygon (Inigo Quilez)."""
    v = np.asarray(verts, float)
    d = (px - v[0, 0]) ** 2 + (py - v[0, 1]) ** 2
    s = np.ones_like(px)
    n = len(v)
    for i in range(n):
        j = i - 1
        ex, ey = v[j, 0] - v[i, 0], v[j, 1] - v[i, 1]
        wx, wy = px - v[i, 0], py - v[i, 1]
        ee = ex * ex + ey * ey
        if ee == 0:
            continue
        t = np.clip((wx * ex + wy * ey) / ee, 0, 1)
        bx, by = wx - ex * t, wy - ey * t
        np.minimum(d, bx * bx + by * by, out=d)
        c1 = py >= v[i, 1]
        c2 = py < v[j, 1]
        c3 = ex * wy > ey * wx
        flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
        s[flip] *= -1
    return s * np.sqrt(d)


def sd_box2(px, py, cx, cy, hx, hy, r=0.0):
    qx = np.abs(px - cx) - hx + r
    qy = np.abs(py - cy) - hy + r
    return (np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2)
            + np.minimum(np.maximum(qx, qy), 0) - r)


def sd_circle(px, py, cx, cy, r):
    return np.sqrt((px - cx) ** 2 + (py - cy) ** 2) - r


# ---------------------------------------------------------------- operators

def u_round(a, b, r):
    """Union with a circular fillet of radius r (r may be an array)."""
    r = np.asarray(r, dtype=a.dtype)
    ua = np.maximum(r - a, 0)
    ub = np.maximum(r - b, 0)
    return np.maximum(r, np.minimum(a, b)) - np.sqrt(ua * ua + ub * ub)


def i_round(a, b, r):
    """Intersection with a circular round of radius r."""
    ua = np.maximum(r + a, 0)
    ub = np.maximum(r + b, 0)
    return np.minimum(-r, np.maximum(a, b)) + np.sqrt(ua * ua + ub * ub)


def d_round(a, b, r):
    """a minus b, rounded edge of radius r."""
    return i_round(a, -b, r)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def band(x, lo, hi, w):
    """~1 inside [lo, hi], soft edges of width w."""
    return smoothstep(lo - w / 2, lo + w / 2, x) * (1 - smoothstep(hi - w / 2, hi + w / 2, x))
