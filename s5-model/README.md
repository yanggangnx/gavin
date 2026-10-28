# LUMIX S5 + S 20-60mm 3D 模型

初代松下 LUMIX S5 机身，装 LUMIX S 20-60mm F3.5-5.6 套机镜头，按 1:1 毫米尺寸建模。
用于高端产品演示的扫光动画：深色影棚、细长灯条扫过机身，材质和倒角按 Cycles 特写的要求做。

![主镜头](renders/shot1_hero.png)

| 镜头特写 | 顶部拨盘 |
| --- | --- |
| ![](renders/shot2_lens.png) | ![](renders/shot3_top.png) |

白底产品照（暗棚柔光箱布光，抠到白底，和官方产品图同角度对照）：

| 正面斜侧 | 背面斜侧 |
| --- | --- |
| ![](renders/photo_beauty.png) | ![](renders/photo_beauty_back.png) |

预览动画（640×360，低采样）：`renders/S5_lightsweep_preview.mp4`

## 文件

| 文件 | 内容 |
| --- | --- |
| `out/S5_2060.blend` | 完整场景：模型、材质、灯光、三台相机、13 秒扫光动画。贴图已打包进文件 |
| `out/S5_2060.glb` | glTF 2.0，只有模型，PBR 基础材质 + 镜头印字贴图，机身网格减面 50% |
| `out/S5_2060.fbx` | FBX，给 C4D / Maya / 3ds Max 用，内容同 glb |
| `out/textures/` | 镜头印字贴图（镜筒、焦距刻度、前圈文字） |

`.blend` 用 Blender 5.2 保存，用 5.2 或更新的版本打开。旧版本打不开就用 FBX / glb，或者用 `build.sh` 在你的 Blender 里重新生成。

## 场景和动画

打开 `.blend` 后直接按 F12 渲染当前帧，Ctrl+F12 渲染整段动画。默认 1920×1080、30 fps，Cycles 256 采样（自适应）+ 降噪，色彩用 AgX Punchy。

| 帧 | 相机 | 画面 |
| --- | --- | --- |
| 1–150 | `Cam_Hero` | 前侧方环绕推近，灯条从左到右扫过顶盖、握把和镜头 |
| 151–270 | `Cam_Lens` | 镜头正面特写，竖灯条横扫，一圈环形光在前组镜片里滑过 |
| 271–390 | `Cam_Top` | 俯拍滑过拨盘和热靴，灯条从前往后掠过顶面 |

时间线上的标记负责切换相机。灯光都是面光，按表面亮度设的：

- `Light_SweepStrip`：主扫光灯条（2.2 m × 1.8 cm），三段动画都靠它。改关键帧位置就能改扫光路线。
- `Light_RimLeft` / `Light_RimRight`：两侧竖向轮廓灯条，勾出机身边缘。
- `Light_GradientCard`：左侧大柔光板，让黑色机身表面有渐变反光。
- `Light_TopFill`：顶部很弱的补光，保证暗部不死黑。
- `Light_LensRing`：发光圆环，只在镜头特写那段亮，做镜片里的环形倒影；它对相机不可见。

所有灯对相机都不可见，只出现在反射里。四盏主灯用了灯光链接，只照亮相机，所以黑色光面地板上不会出现灯条的反光。对焦用三个空物体 `Focus_Hero` / `Focus_Lens` / `Focus_Top`，移动它们就能改焦点。

## 模型结构

所有物体在集合 `LUMIX_S5` 里，挂在 `S5_Root` 下。`S5_Root` 缩放 0.001，所以网格数据是毫米，场景是米。
坐标：X=0 在光轴上，镜头朝 −Y，Z=0 是机身底面。

- `S5_Body`：机身外壳（含握把、顶盖、取景器凸起、卡口座），约 170 万面。漆面、皮纹、卡口内腔三种材质按面分配。皮纹区域比漆面高 0.3 mm，边缘是真实的台阶。
- 拨盘：`ModeDial`（模式拨盘，金字塔滚花，顶面刻 iA/P/A/S/M/C1–C3/S&Q）、`DriveDial`（驱动模式拨盘，带红色细环）、`FrontDial` + `ShutterButton`（快门和前拨盘，跟着握把头部倾斜）、`RearDial`（后拨盘，嵌在凹槽里）、`ControlDial` + `Btn_MenuSet`（背面转盘）。
- 按钮：顶部 WB / ISO / 曝光补偿、红色录像键、ON/OFF 拨杆；背面回放、LVF、AF 模式键和对焦模式拨杆、摇杆、AF ON、Q、返回、DISP.；正面 Fn 键、镜头释放键、对焦辅助灯。按键上的字是浮起 0.02 mm 的真实几何。
- 卡口：`MountRing`（镀铬，周向拉丝）、4 个卡口爪、6 颗十字螺丝、锁定销、11 个金色触点、红色对位点、传感器和滤镜。
- 取景器：`Eyecup`（橡胶眼罩，带人眼传感器窗口）、目镜玻璃；`HotShoe_*` 热靴（金属导轨、触点、锁孔）。
- 屏幕：`LCD_Body` / `LCD_Glass` 挂在 `LCD_Pivot` 下，绕 Z 轴转动 `LCD_Pivot` 就能把屏幕翻出来（−180° 是翻到侧面朝前）。翻开后能看到机身上的弧形拨槽。
- 侧面和底部：接口盖 ×2（皮纹面，压印 MIC、耳机图标、HDMI、SS）、SD 卡仓门（滑锁槽和箭头）、REMOTE 盖、电池仓门和锁扣、三脚架螺孔、背带环 ×2。
- 标识：LUMIX（银色浮雕字）、S5 铭牌、Panasonic、REMOTE、ON/OFF、S C MF、焦平面标记。
- 镜头 `Lens_20-60`（空物体，所有镜头零件都挂在它下面，整体移动就能做装卸镜头）：
  - 外部：卡口、固定镜筒（印“20-60”、最近对焦距离、S 标、指示线、AF/MF）、变焦环（160 条竖纹 + 焦距刻度）、对焦环（240 条细纹）、遮光罩卡口（三个缺口）、滤镜螺纹、前圈文字。
  - 内部：带阶梯消光纹的内筒、5 片镀膜镜片（镀膜用 Thin Film 做出绿/紫反光）、9 叶光圈。镜头是收回状态（87.2 mm）。

## 重新生成 / 修改

模型全部由脚本生成，`src/dims.py` 里是所有尺寸：

```bash
./build.sh /Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13
```

Blender 自带的 Python 需要先装上 `numpy scipy scikit-image pillow`。也可以 `pip install bpy==5.2.3` 后用普通 Python 3.13 跑。渲染成片和预览动画用 `tools/render_all.sh <python>`。

| 脚本 | 作用 |
| --- | --- |
| `src/dims.py` | 尺寸和部件坐标（毫米） |
| `src/sdf.py`、`src/body.py` | 机身外壳：正视、顶视、侧视轮廓的有向距离场，求交后加圆角，握把按高度放样，再用 marching cubes 转成网格；眼罩同理 |
| `src/geom.py` | 车削体、金字塔滚花、竖纹、圆角盒、文字等网格工具 |
| `src/parts_body.py`、`src/parts_lens.py` | 机身零件和镜头 |
| `src/mats.py`、`src/prints.py` | 材质和镜头印字贴图 |
| `src/scene.py` | 影棚、灯光、相机和动画 |
| `src/render.py`、`src/preview.py` | 渲染：动画帧、白底产品照（`--photo`）、和参考图同比例的正交对照视图（`--check`） |
| `tools/swatch.py` | 皮纹材质调参小样 |
| `src/export.py` | 导出 glb / fbx |

尺寸怎么来的见 [MEASUREMENTS.md](MEASUREMENTS.md)。

## 已知限制

- 皮纹（约 1 mm 的颗粒、细粒和褶皱，深 0.2 mm）和漆面喷砂颗粒是 Blender 程序化纹理，只在 `.blend` 里有。glb / fbx 只带基础颜色和粗糙度；要在别的软件里用，需要另外烘焙法线贴图。
- 尺寸是按官方外形尺寸和产品图量的，并用你提供的正面、顶部、背面和两侧照片逐个视角叠图校准过，部件位置误差约 ±1 mm。
- 接口盖、卡仓门都是关着的，里面的接口没有建。底部细节比较简化。
- 屏幕是关机的黑色。
- 镜头固定在收回状态，没有做变焦伸缩。

参考图来源：[Imaging Resource 上的 Panasonic S5 产品图](https://old.imaging-resource.com/PRODS/panasonic-s5/panasonic-s5A.HTM)；镜头规格来自 [Panasonic S-R2060 页面](https://panasonic.com/au/consumer/lumix-cameras-video-cameras/lumix-camera-lenses/lumix-s-lenses/s-r2060.html)。
