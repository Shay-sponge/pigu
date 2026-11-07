# Pigu · The Soft Studio

单模型 3D 软体互动网页。基于原始单模型版，v1.2.0 扩展臀部圆弧、减弱尖突并上提下缘，保留拍打、按揉、松手回弹、旋转、换色、参数调节和图片导出。

访问：<https://Shay-sponge.github.io/pigu/>

## 操作

- **Slap**：点击或触摸模型；画布获得焦点后也可按空格或 Enter。
- **Squish**：按住模型拖动，松开后恢复。
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

Three.js r186 `WebGLRenderer` + Cannon ES，120 Hz 固定物理步长，12 个弹簧节点。
运行时读取 `public/models/adult-torso.json` 和 `torso-caps.json`；
固定泳装由程序材质绘制。全部运行资源随网站发布，不依赖外部 CDN。

模型基于 MakeHuman CC0 基础人体及 25 岁成年 morph，局部修形由本项目脚本生成。
来源提交、参数、模型 SHA-256 见 `public/models/manifest.json`，
许可见 `public/licenses/MakeHuman-CC0.txt`。这是视觉软体近似。
`gluteShape` 记录圆润与提臀参数；相同输入可生成相同模型字节。
模型请求附带本次构建标识，更新后不会继续复用前一版的浏览器模型缓存。

已保存生成后的模型，日常构建不会重新下载或生成。需要重新生成时：

```sh
npm run assets
npm run build
```

## 验证

```sh
npm run check
npm run build
```

浏览器控制台只读诊断：

```js
window.__pigu.diagnostics()
```

`dist/assets/pigu-build.json` 记录构建 ID 和输入文件 SHA-256，
可与浏览器返回的 `build` 及线上资源核对。
需要支持 WebGL 2 的浏览器；手机尺寸模拟不能替代真实 iOS、Android 或微信内置浏览器测试。
