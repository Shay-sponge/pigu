# Pigu · The Soft Studio

单模型 3D 软体互动网页。v1.6.0 保留已确认的 1.5.0 人体模型，调整皮肤交互：捏合产生小皮褶和两侧浅压痕，拖动表现局部牵拉，拍打仅有短促浅压缩和有限余动。

访问：<https://Shay-sponge.github.io/pigu/>

## 操作

- **Slap**：点击或触摸模型；画布获得焦点后也可按空格或 Enter。
- **Squish**：按住轻捏出小皮褶，拖动牵拉表层；越拉越难继续伸长，松开后先快速恢复再缓慢收尾。
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
拍打沿接触面法线短促向内作用，表面压缩较浅；捏合使用两个浅接触区和中间的局部皮褶，牵拉通过切向位移表现。肌肉层的位移和冲量均减小。
表层采用快速弹性响应与少量延迟恢复的组合，快速项用解析阻尼振子积分，避免时间步长把短暂冲击吞掉。切向牵拉随位移增加逐渐受限。
速度在三个方向均有阻尼，中线固定于共同躯干；参数最大时也保留衰减，避免持续晃动或拉开两侧。
运行时读取 `public/models/adult-torso.json` 和 `torso-caps.json`；
泳装为独立布料表面，具有厚度、包边与缝线；与人体共享实时顶点和法线属性，局部形变没有额外一帧延迟。全部运行资源随网站发布，不依赖外部 CDN。

模型基于 MakeHuman CC0 基础人体及 25 岁成年 morph。生成脚本使用克制的体形参数、连续人体曲面细分、轻微后向比例调整及较自然的腿部站距，保持骨盆、腰部、臀褶与大腿的原始连接关系。
体形参考 [Voda Swim 成人比基尼产品摄影](https://www.vodaswim.com/products/two-tab-bottom) 和 [BONDI BORN 泳装产品多角度摄影](https://bondiborn.com.au/products/jayde-bikini-bottom-mocha-pearl)，仅用于形态与布料观察；照片不随网站发布，不作为模型纹理，也没有做真人身份复刻或扫描重建。
来源提交、参数、模型 SHA-256 见 `public/models/manifest.json`，
许可见 `public/licenses/MakeHuman-CC0.txt`。这是视觉软体近似，未使用人体组织实测参数，也不提供硬件力反馈。
参考 Three.js [`physics_ammo_volume`](https://github.com/mrdoob/three.js/blob/r160/examples/physics_ammo_volume.html) 的软体阻尼、体积和刚度区分，以及 [XPBD](https://matthias-research.github.io/pages/publications/XPBD.pdf) 中形变与耗散的思路；本项目并未改为 Ammo 或 XPBD 求解器。
皮肤行为参考 [Everett & Sommers 的黏弹性综述](https://pmc.ncbi.nlm.nih.gov/articles/PMC3465619/)、[Sachs 等的分层皮肤模型](https://pmc.ncbi.nlm.nih.gov/articles/PMC8154831/) 和 [Flynn & McCormack 的压缩起褶研究](https://doi.org/10.1016/j.jbiomech.2009.10.007)。这些文献支持响应类型；局部形变场、幅度和恢复时间为交互调参，没有声称复现论文中的有限元求解或临床标定参数。
`gluteShape` 记录拓扑方法、细分、比例调整与截面；相同输入可生成相同模型字节。
接触点通过被点击三角形的重心坐标映射回原始表面，重复点击已形变区域时仍跟随同一块皮肤。肌肉节点根据本次模型实际后表面定位，腰部和大腿过渡区的位移逐渐衰减。
模型请求附带本次构建标识，更新后不会继续复用前一版的浏览器模型缓存。

已保存生成后的模型，日常构建不会重新下载或生成。需要重新生成时：

```sh
npm run assets
npm run build
```

## 验证

```sh
npm run check
npm run test:model
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
