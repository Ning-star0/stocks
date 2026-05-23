# 克制高级动效实现规范

## Summary

当前项目使用 CSS + Tailwind 维护统一动效，不引入 Framer Motion。动效目标是低幅度、短时长、轻反馈，让金融数据和 AI 策略内容保持主视觉。

## 已采用的统一配置

- `lib/motion.ts` 统一导出 duration、easing、staggerDelay 和 motion class 名称。
- 页面进入使用 320ms 的轻微 fade + 8px 上移。
- 卡片进入使用 260ms 的 fade + 6px 上移 + 0.99 到 1 的轻缩放。
- hover 只做 1-2px 位移、轻阴影和轻边框变化。
- badge 状态出现使用 150ms 的 opacity + 0.96 到 1 scale。
- 数字刷新使用 180ms 的 opacity + 2px 上移，不做夸张 count-up。

## Loading 规范

- AI 分析、AI 决策等长任务使用 `LoadingInsight`。
- Loading 文案按阶段表达：读取行情数据、分析技术指标、综合新闻情绪、生成策略观察。
- 不显示假的百分比进度。
- 保留旧数据可见，局部区域展示低透明 sweep/shimmer。
- 按钮级短请求可以继续使用小型 spinner。

## 表格与折叠区

- 表格 hover 使用 `.table-row-focus`。
- 左侧强调线必须绘制在首个 `td` 内，不能挂在 `tr::before` 上，避免浏览器把伪元素当成额外表格列导致表头和内容错位。
- 折叠区使用 grid rows + opacity 过渡，chevron 旋转 180 度，duration 280ms。

## Reduced Motion

在 `prefers-reduced-motion: reduce` 下：

- 禁用位移动画、shimmer、sweep 和 dots 流动效果。
- 保留最基础 opacity 过渡。
- 禁止 pulse、bounce、夸张 scale、旋转入场等高干扰动画。
