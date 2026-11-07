# Pigu · The Soft Studio

单模型 3D 软体互动网页。v1.4.1 保留饱满的球面轮廓，将两侧连接为连续表面，丁字裤贴合窄臀沟；按压产生局部凹陷及周围轻微鼓起，肌肉层带动柔和回弹。回弹过程保留体积场的平滑法线，避免位置恢复后残留凹坑阴影。

访问：<https://Shay-sponge.github.io/pigu/>

## 操作

- **Slap**：点击或触摸模型；画布获得焦点后也可按空格或 Enter。
- **Squish**：按住会局部压陷，拖动可揉捏，松开后恢复。
- **Orbit**：拖动旋转；Back / Three-quarter / Side 切换视角。
- 右侧面板调节软度、回弹、力度、配色及慢动作；手机点右上角设置。
- 声音默认关闭，点击声音按钮开启；相机按钮保存当前画布；Reset studio 重置。

## 开发与构建

Node.js 22.12+，无需 API key、后端或 Blender。

```sh
npm ci
npm run dev
```

开发入口：<http://localhost:5188/pigu/>。

```sh
npm run build
npm run preview
```

生产构建预览：<http://localhost:4188/pigu/>。

## GitHub Pages

Vite 的 `base` 为 `/pigu/`，模型、字体、脚本和首页链接均使用该前缀。
GitHub 仓库 Settings → Pages → Source 选择 **GitHub Actions**。
推送到 `main` 后，`.github/workflows/pages.yml` 自动检查、构建和发布 `dist/`。

```sh
git add src public scripts index.html package.json package-lock.json vite.config.ts
git commit -m "Update playground"
git push origin main
```

改仓库名时需同步更新 `vite.config.ts` 的 `base`。
回退已发布版本时使用 `git revert <commit>` 后推送，不需要重写历史。

## 技术与模型来源

Three.js r186 `WebGLRenderer` + Cannon ES，120 Hz 固定物理步长，12 个肌肉弹簧节点及局部皮肤压陷层。
拍打沿实际接触面的法线向内作用；皮肤层用局部压陷和补偿鼓起表现体积感，肌肉层随拉伸逐渐增加阻力。
速度在三个方向均有阻尼，中线固定于共同躯干；参数最大时也保留衰减，避免持续晃动或拉开两侧。
运行时读取 `public/models/adult-torso.json` 和 `torso-caps.json`；
固定泳装由程序材质绘制。全部运行资源随网站发布，不依赖外部 CDN。

模型基于 MakeHuman CC0 基础人体及 25 岁成年 morph。生成脚本将两个近球体、中央连接体与身体平滑合并，再重新生成连续外表面。
球体在竖直和前后方向使用相同半径，保留完整的下半圆弧；通过体积合并处理与大腿的连接，避免旧臀沟被拉成薄片。
`three-mesh-bvh` 仅在生成模型时用于距离和射线查询，不进入浏览器运行包。
来源提交、参数、模型 SHA-256 见 `public/models/manifest.json`，
许可见 `public/licenses/MakeHuman-CC0.txt`。这是视觉软体近似，未使用人体组织实测参数，也不提供硬件力反馈。
参考 Three.js [`physics_ammo_volume`](https://github.com/mrdoob/three.js/blob/r160/examples/physics_ammo_volume.html) 的软体阻尼、体积和刚度区分，以及 [XPBD](https://matthias-research.github.io/pages/publications/XPBD.pdf) 中形变与耗散的思路；本项目并未改为 Ammo 或 XPBD 求解器。
`gluteShape` 记录球体中心、半径、连接范围及体积采样精度；相同输入可生成相同模型字节。
模型请求附带本次构建标识，更新后不会继续复用前一版的浏览器模型缓存。

已保存生成后的模型，日常构建不会重新下载或生成。需要重新生成时：

```sh
npm run assets
npm run build
```

## 验证

```sh
npm run check
npm run test:tissue
npm run build
```

浏览器控制台只读诊断：

```js
window.__pigu.diagnostics()
```

`dist/assets/pigu-build.json` 记录构建 ID 和输入文件 SHA-256，
可与浏览器返回的 `build` 及线上资源核对。
需要支持 WebGL 2 的浏览器；手机尺寸模拟不能替代真实 iOS、Android 或微信内置浏览器测试。
