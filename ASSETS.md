# 本地资源接入

公开仓库包含最新版源码、测试和资源元数据，不附带第三方模型、BSP 地图、贴图或音频文件。`npm ci`、`npm run test:core`、`npm run build` 可以独立运行；完整游玩请使用 [在线版](https://ihca.cn/sandline/)，或在具备相应使用权的情况下配置本地资源。

[ASSET-MANIFEST.json](ASSET-MANIFEST.json) 记录版本 `0.39-bloodstrike-team-rounds` 的全部原始公开资源路径、大小与 SHA-256。此清单用于核对本地资源，不是下载器或再分发授权。

## 目录

将授权资源按清单路径放回项目的 `public/assets/`，保留仓库已有元数据：

| 目录 | 用途 |
| --- | --- |
| `characters/` | 七种角色 GLB、`locomotion.glb` 动画供体 |
| `runtime/` | CS16 第一人称手臂、AK、经典匕首及其他枪械模型 |
| `maps/dust2/` | Dust2 BSP、导航、地图贴图和天空 |
| `maps/assault/` | Assault BSP、导航、地图贴图和天空 |
| `maps/bloodstrike/` | Bloodstrike BSP、导航与地图贴图 |
| `hostages/` | 人质模型 |
| `environment/` | 环境表面贴图与反射光照 |
| `audio/` | 枪械、脚步、环境、UI、音乐与语音 |
| `ui/` | 地图预览和商店枪械图片 |

精确文件名见资源清单，以及 `src/render/soldierRoster.ts`、`public/assets/runtime/manifest.json` 和各地图的 `manifest.json`。替换模型还需匹配加载器的骨骼、朝向、节点命名与尺寸；只改成相同文件名不足以完成适配。

## 测试夹具

`scripts/asset-dependent-tests.json` 显式列出需要资源的测试文件。`npm run test:core` 只运行其他测试；`npm test` 仍运行全部测试并报告缺失资源。

部分制作回归还需要原项目的 `assets-source/` 归档、`artifacts/` 制作报告及历史源文件，例如旧模型与衍生模型的顶点比较。这些本地制作夹具没有纳入公开仓库。仅补齐运行资源仍不足以运行全部历史制作测试；可单独运行所需测试文件：

```sh
node --import tsx --test tests/bounty.test.ts
```

## 署名

资源来源记录保留在 `public/assets/CREDITS.html`、`public/assets/audio/CREDITS.html` 和各子目录元数据中。Mixamo 动画、Valve / Counter-Strike 相关地图及模型、Sketchfab 模型、CC0 / CC BY 资源分别适用原权利人的条款，不受本项目 MIT 源码许可统一覆盖。
