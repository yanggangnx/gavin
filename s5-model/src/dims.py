"""LUMIX S5 + S 20-60mm dimensions, in mm.

Axes: X = 0 on the optical axis, +X toward the camera's left (no grip), the
grip is on -X. Y = 0 on the front leather face, the lens points to -Y, the back
is +Y. Z = 0 on the bottom plate. Measured from Panasonic press photos and the
official 132.6 x 97.1 x 81.9 mm envelope (see HANDOFF.md).
"""

# body envelope
X_MIN, X_MAX = -84.8, 47.8          # grip side wall, left side wall
Y_FRONT, Y_BACK = 0.0, 47.0         # leather front face, back plate
Z_SHOULDER = 74.5                   # top plate on both shoulders
Z_PLATEAU = 78.0                    # raised top of the grip
Z_LEATHER_TOP = 67.0
Y_TOPBAND = 2.6                     # top plate front face sits back from the leather

# grip
GRIP_X_IN = -48.3
GRIP_Y_FRONT = -21.9
PLATEAU_Y_BACK = 29.5               # plateau ramps down to the rear deck behind this

# EVF hump
HUMP_Y_FRONT = -1.5
HUMP_Z_TOP = 94.6
HUMP_HW_TOP = 14.5                  # half width at the top
HUMP_HW_WALL = 19.9                 # half width at the knee
HUMP_Z_KNEE = 83.9
HUMP_WALL_SLOPE = 0.14              # lower walls lean in 8 deg, the upper ones 27 deg
HUMP_TAPER = 0.87                   # behind Y=16 the hump is 87 % as wide as its face

# mount
MOUNT_Z = 40.2
BOSS_R = 35.0
BOSS_Y = HUMP_Y_FRONT               # boss face is coplanar with the hump face
MOUNT_RING_R_OUT = 32.25
MOUNT_RING_R_IN = 25.8              # L-mount throat 51.6
MOUNT_FACE_Y = -2.7                 # lens flange plane
SENSOR_Y = MOUNT_FACE_Y + 20.0      # L-mount flange back 20 mm

# top controls (x, y) and sizes
MODE_DIAL = dict(x=-34.1, y=20.1, r=11.85, z0=Z_SHOULDER, z1=83.3)
DRIVE_DIAL = dict(x=33.3, y=19.5, r=11.0, z0=Z_SHOULDER, z1=83.3)
FRONT_DIAL = dict(x=-64.4, y=-13.9, r=9.0)
SHUTTER_R = 4.9
REAR_DIAL = dict(x=-69.1, y=31.7, r=9.9, z0=Z_SHOULDER - 1.4, z1=77.6)
TOP_BUTTONS = [("WB", -57.0, 3.6), ("ISO", -65.4, 3.6), ("EV", -74.5, 3.6)]
TOP_BUTTON_R = 3.35
REC_BUTTON = dict(x=-61.9, y=16.8, r=3.6)
POWER_LEVER = dict(x=-47.6, y=24.0)
HOTSHOE = dict(x0=-10.8, x1=10.8, y0=25.6, y1=44.0)
MIC_HOLES = [(7.8, 18.7), (-7.8, 18.7)]

# front controls (x, z)
FN_FRONT = dict(x=-42.8, z=53.0, r=3.25, bezel=4.75)
LENS_RELEASE = dict(x=-36.2, z=18.4, r=4.2, bezel=5.7)
AF_LAMP = dict(x=37.1, z=70.6, r=1.7)
S5_BADGE = dict(x0=26.5, x1=40.5, z0=59.6, z1=66.0)

# back controls (x, z), all on the back plate at Y_BACK
EYECUP = dict(x=-0.8, hx=20.5, z0=62.0, z1=95.0, y0=47.6, y1=60.6)
BACK_BUTTONS = {
    "PLAY": dict(x=35.8, z=62.2, r=2.6, bezel=3.6),
    "LVF": dict(x=24.7, z=62.2, r=2.6, bezel=3.6),
    "AFMODE": dict(x=-29.3, z=63.1, r=3.25, bezel=7.0),
    "AFON": dict(x=-57.6, z=66.6, r=3.9, bezel=5.4),
    "Q": dict(x=-55.2, z=47.6, r=2.8, bezel=3.9),
    "BACK": dict(x=-53.3, z=9.4, r=3.0, bezel=4.0),
    "DISP": dict(x=-65.0, z=9.4, r=3.0, bezel=4.0),
}
JOYSTICK = dict(x=-47.4, z=60.7, r=3.2, bezel=6.0)
CONTROL_DIAL = dict(x=-58.7, z=26.3, r=12.55, set_r=5.6)
LCD = dict(x0=-44.6, x1=38.2, z0=4.3, z1=53.8, y0=Y_BACK, y1=50.0)

# sides
LUG_LEFT = dict(x=X_MAX, y=9.6, z=71.0)
LUG_RIGHT = dict(x=X_MIN, y=24.0, z=70.5)
PORT_DOORS = [dict(y0=11.6, y1=40.5, z0=41.5, z1=66.6),   # MIC / headphones, leather covered
              dict(y0=11.6, y1=40.5, z0=10.5, z1=40.9)]   # HDMI / USB-C
SD_DOOR = dict(y0=20.5, y1=45.0, z0=7.5, z1=66.5)
REMOTE_COVER = dict(y0=1.0, y1=17.5, z0=68.8, z1=76.0)

# bottom
TRIPOD = dict(x=0.0, y=21.0)
BATTERY_DOOR = dict(x0=-79.0, x1=-53.5, y0=-12.5, y1=27.0)

# lens S-R2060 (radius profile along -Y from the flange plane)
LENS_LEN = 87.2
LENS_FILTER = 67.0
LENS_D_MAX = 77.4
