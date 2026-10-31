# 沙线行动 · SANDLINE

基于 Three.js、TypeScript、Vite 和 Rapier 的单机战术射击游戏，支持电脑与手机浏览器。

**[在线游玩](https://ihca.cn/sandline/)** · [资源接入说明](ASSETS.md) · [许可与署名](NOTICE.md) · [开发记录](DEVLOG.md)

本仓库同步至 **2026-10-31 / 0.39-bloodstrike-team-rounds**，包含最新游戏源码、测试、构建和资源处理脚本。第三方模型、地图、贴图和音频延续原仓库的独立资源发布方式：源码可以安装、编译和运行核心测试，本地完整游玩还需要补齐授权资源。直接体验请打开在线版。

## 玩法

- **Bloodstrike 血战**：3v3 / 5v5 / 8v8 / 10v10。首局全员 USP 和匕首，每次击杀获得 $600，余额跨局保留；第二局起在己方出生补给区买枪。全歼对方赢一回合，先赢 3 回合获胜，阵亡后观战队友。
- **经典沙漠 2 / Dust2**：安放 C4、守点、拆弹与回合胜负。
- **仓库突击 / Assault**：护送人质、守卫救援区和队伍协作。
- **沙漠旧城、雪地竞技场**：自由交火、刀战、手枪战、军备竞赛、据点守卫。
- 支持最多 20 人的机器人队伍、掩体与侧翼战术、不同部位命中伤害、跑步、蹲伏、跳跃、投雷及枪械补给。
- 第一人称换枪、拉栓、换弹与匕首动作；脚步材质、雪地踩踏、空间枪声和战斗反馈。
- 手机摇杆、拖动瞄准、开火辅助与可选陀螺仪；电脑键鼠控制。

这是单机机器人对战，目前不提供联网多人匹配。

## 安装、测试与构建

需要 Node.js **22.15 或更新版本**及 npm。

```sh
git clone https://github.com/xilinnihao-afk/sandline-threejs-fps.git
cd sandline-threejs-fps
npm ci
npm run test:core
npm run build
```

上述命令不需要二进制素材。配置本地完整游戏时，请先按 [ASSETS.md](ASSETS.md) 补齐资源，再运行：

```sh
npm run dev
# http://localhost:5190/
```

`npm run preview` 预览正式构建，`npm run typecheck` 检查 TypeScript。`npm test` 执行全部原项目测试，其中部分需要模型、地图、音效或历史制作夹具；它们明确列在 [scripts/asset-dependent-tests.json](scripts/asset-dependent-tests.json)，不会在核心测试中假装通过。

## 操作

| 操作 | 电脑按键 |
| --- | --- |
| 移动 / 奔跑 / 跳跃 | WASD / Shift / 空格 |
| 瞄准 / 开火 | 鼠标 / 左键 |
| 换弹 / 蹲下 / 手雷 | R / C / G |
| 切换已拥有的武器 | 数字 1–8 / 滚轮 |
| 匕首劈砍 / 刺击 | 左键 / 右键或 Q |
| 商店 / 快捷购买 | B / 商店内数字 1–9 |
| 目标交互 | E |
| 暂停 | Esc |

手机横屏使用左侧摇杆、右侧瞄准区域和操作按钮。低性能设备建议 3v3 或 5v5。

## 代码结构

| 目录 | 内容 |
| --- | --- |
| `src/game/` | 回合、赏金、武器、命中、机器人、地图和目标 |
| `src/render/` | 场景、人物、手臂、动画、特效、音频 |
| `src/ui/` | HUD、商店、键鼠、触屏、陀螺仪、加载流程 |
| `src/analytics/` | 可选的统计接口 |
| `tests/` | 玩法、输入、动画、声音与资源回归测试 |
| `scripts/` | 构建、资源准备与核心测试入口 |
| `minitool/runtime/` | 小工具运行时与共享运动适配源码 |
| `public/assets/` | 资源元数据与署名；二进制资源另行提供 |

公开配置在 `public/site-config.js`，源码发行版默认关闭第三方统计和个人反馈二维码。不要把服务端凭据写入前端。

## 验证

当前线上游戏完整资源环境通过 **479 项测试**。本源码发行版单独验证了干净依赖安装、**215 项核心测试**、TypeScript 与生产构建。电脑和手机视口验证不能替代实体设备性能测试。

## 许可与反馈

原创代码采用 [MIT License](LICENSE)。第三方素材保留各自许可；代码许可不授予模型、地图或音频的再分发权，详情见 [NOTICE.md](NOTICE.md)。旧版开发截图保留在开发记录中，不代表最新版全部界面。

问题请通过 GitHub Issues 提交设备、浏览器、复现步骤和预期行为。

## Donate

如果喜欢沙线行动，可以通过支付宝自愿支持开发。捐赠不影响游戏和源码访问。

<a href="donate-alipay.png"><img src="donate-alipay.png" alt="通过支付宝自愿支持沙线行动开发" width="280"></a>
