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
  <a class="stage-nav-item" href="intention.html">3 优先意图</a>
  <a class="stage-nav-item" href="initiative.html">4 沟通策略</a>
  <a class="stage-nav-item" href="implementation.html">5 执行建议</a>
  <a class="stage-nav-item" href="master.html">6 汇总</a>
</nav>
```

## 图表与完整视图（每个阶段报告均须遵守）

- 使用内联 SVG、内嵌 CSS 和 JS，不依赖外部 CDN。**弹窗放大不等于修复图形**：图形在任何视图中不得断线、边缘裁切、标签与节点互相覆盖。
- 对 WBS 树和甘特图，先依据真实节点数、标签实测尺寸计算 SVG 的 viewBox、行距、列宽、连接点和画布尺寸；若文字很长，换行或扩大节点，不得以缩小字号或截断掩盖内容。连线端点接触节点边界而不穿越节点，甘特表头/日期刻度须与对应栏位对齐；超过视口时保留原始宽度及双向滚动。
- 每张图需有标题、图例、坐标轴及单位（适用时），缺失实测数据须标注「示意图」。报告内先呈现可点击预览；完整图在弹窗中保留图形原生宽高与滚动范围，手机也能横向滚动。**不能只把缩小的 SVG 在弹窗继续按百分比缩小**。
- 每个包含图形的 HTML 报告必须把下面组件的 CSS、HTML、JS **直接嵌入该 HTML**，不能只引用本规范文件或 Dashboard 的脚本。一个报告有多张图时每张预览都用 `data-graphic` 指向本页唯一的图 ID。图的 SVG 必须有 `viewBox` 与明确的原生 `width`、`height`，例如 `<svg id="wbs-graphic" width="1400" height="900" viewBox="0 0 1400 900">`。

```html
<style>
.graphic-preview{display:block;max-width:100%;overflow:auto;border:1px solid #d7e0e6;background:#fff}
.graphic-preview svg{display:block;max-width:none;height:auto}
.graphic-open{display:block;margin:8px 0;cursor:pointer}
.graphic-overlay[hidden]{display:none}
.graphic-overlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:12px}
.graphic-dialog{background:#fff;color:#1f2a37;width:min(96vw,1600px);height:min(94vh,1100px);display:flex;flex-direction:column;border:1px solid #d7e0e6}
.graphic-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid #d7e0e6}
.graphic-canvas{overflow:auto;flex:1;padding:24px}
.graphic-canvas svg{display:block;max-width:none!important;max-height:none!important;flex:none}
body.graphic-is-open{overflow:hidden}
@media print{.graphic-open,.graphic-overlay{display:none!important}}
</style>
<!-- Replace the SVG below with the real, complete diagram. Keep the source SVG inside the preview. -->
<button type="button" class="graphic-open" data-graphic="wbs-graphic" aria-haspopup="dialog">查看完整 WBS 图形 ↗</button>
<div class="graphic-preview"><svg id="wbs-graphic" width="1400" height="900" viewBox="0 0 1400 900" role="img" aria-label="WBS 完整图形"><!-- validated nodes and lines --></svg></div>
<div id="graphic-overlay" class="graphic-overlay" hidden>
  <div class="graphic-dialog" role="dialog" aria-modal="true" aria-label="完整图形">
    <div class="graphic-toolbar"><strong id="graphic-title">完整图形</strong><button type="button" id="graphic-close">关闭 ✕</button></div>
    <div id="graphic-canvas" class="graphic-canvas"></div>
  </div>
</div>
<script>
(()=>{
 const overlay=document.getElementById('graphic-overlay'),canvas=document.getElementById('graphic-canvas');
 const close=document.getElementById('graphic-close'),title=document.getElementById('graphic-title');
 let returnFocus;
 document.querySelectorAll('.graphic-open[data-graphic]').forEach(button=>button.addEventListener('click',()=>{
   const source=document.getElementById(button.dataset.graphic);
   if(!source||!overlay||!canvas)return;
   returnFocus=button;canvas.replaceChildren(source.cloneNode(true));
   const svg=canvas.querySelector('svg');if(svg){svg.removeAttribute('id');
     const box=source.viewBox.baseVal;
     svg.style.width=(Number(source.getAttribute('width'))||box.width||1200)+'px';
     svg.style.height=(Number(source.getAttribute('height'))||box.height||800)+'px';}
   title.textContent=button.textContent.trim();overlay.hidden=false;
   document.body.classList.add('graphic-is-open');close.focus();
 }));
 function hide(){overlay.hidden=true;canvas.replaceChildren();document.body.classList.remove('graphic-is-open');returnFocus?.focus()}
 close?.addEventListener('click',hide);
 overlay?.addEventListener('click',event=>{if(event.target===overlay)hide()});
 document.addEventListener('keydown',event=>{if(!overlay?.hidden){if(event.key==='Escape')hide();if(event.key==='Tab'){
   const nodes=[...overlay.querySelectorAll('button,[tabindex]:not([tabindex="-1"])')];
   if(nodes.length){const first=nodes[0],last=nodes[nodes.length-1];
     if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
     else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}}}});
})();
</script>
```

交付前检查：逐图验证 SVG 元素的边界和连接端点；用桌面和窄屏打开弹窗，逐项检查文字、连线、节点、甘特日期刻度和横纵滚动；无法完成检查时标为待验证，不能声称「图形正确」。

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