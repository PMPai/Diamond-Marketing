# Report Style — HTML 报告统一设计规范

所有阶段 HTML 报告共享统一的视觉规范。无外部 CDN 依赖，完全离线可用。

## 配色

```
--color-bg:       #F8F9FA
--color-surface:  #FFFFFF
--color-primary:  #1A56DB   (钻石蓝)
--color-accent:   #E0245E   (强调/警示)
--color-success:  #0E9F6E
--color-warning:  #E3A008
--color-text:     #1F2A37
--color-muted:    #6B7280
--color-border:   #E5E7EB
```

## 字体

```css
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", sans-serif; }
code { font-family: "SF Mono", "Fira Code", monospace; }
```

## 组件

### 卡片

`.card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; padding: 24px; margin-bottom: 16px; }`

### 表格

`table { width: 100%; border-collapse: collapse; }`
`th { background: #F3F4F6; font-weight: 600; }`
`td, th { padding: 10px 12px; border-bottom: 1px solid var(--color-border); text-align: left; }`

### 标签/徽章

```html
<span class="badge badge-fact">事实</span>
<span class="badge badge-assumption">假设</span>
<span class="badge badge-estimate">估算</span>
<span class="badge badge-gap">待验证</span>
```

颜色：fact=success, assumption=warning, estimate=muted, gap=accent。

### 证据引用

`<sup class="evidence-ref"><a href="#SRC-001">[SRC-001]</a></sup>`

### 置信度指示

```html
<span class="confidence" data-level="high">●●● 高置信</span>
<span class="confidence" data-level="medium">●●○ 中置信</span>
<span class="confidence" data-level="low">●○○ 低置信</span>
```

## 导航

每份 HTML 报告开头包含阶段导航条：

```html
<nav class="stage-nav">
  <a class="stage-nav-item active" href="information.html">1 信息收集</a>
  <a class="stage-nav-item" href="insights.html">2 深度分析</a>
  <a class="stage-nav-item" href="goal.html">3 优先目标</a>
  <a class="stage-nav-item" href="initiative.html">4 沟通策略</a>
  <a class="stage-nav-item" href="implementation.html">5 执行建议</a>
  <a class="stage-nav-item" href="../Master.html">6 汇总</a>
</nav>
```

## 图表

- 使用纯 SVG（内联），无外部依赖。
- 图表必须含标题、图例、坐标轴标注、单位。
- 没有测量数据时标注「示意图」。
- 响应式：max-width: 100%；较窄视口时切换到纵向布局。

## 状态语义

| 状态 | 颜色 | 含义 |
|------|------|------|
| done | success | 已完成 |
| in_progress | primary | 进行中 |
| waiting_data | warning | 等待补资料 |
| failed | accent | 失败 |
| pending | muted | 待执行 |

## 布局

- max-width: 960px; margin: 0 auto; padding: 24px 16px;
- 报告标题使用 `<h1>`，小节标题使用 `<h2>`，子小节使用 `<h3>`。
- 复杂图形可缩放或分层展开，不压小字号塞进一屏。
- 桌面和较窄视口（768px 以下）均需检查。

## 打印

```css
@media print { .stage-nav { display: none; } body { font-size: 11pt; } }
```