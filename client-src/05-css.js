    /* ------------------------------------------------------------------ */
    /* Stylesheet (single inline <style>, iw- prefixed, DSH theme tokens)  */
    /* ------------------------------------------------------------------ */

    const CSS = `
.iw-root{position:relative;display:flex;flex-direction:column;flex:1 1 auto;width:100%;height:100%;min-height:420px;min-width:0;box-sizing:border-box;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;overflow:hidden}
.iw-root *{box-sizing:border-box}
.iw-body{display:flex;flex:1 1 auto;min-height:0;min-width:0}

/* ---------- sidebar ---------- */
.iw-sidebar{display:flex;flex-direction:column;width:264px;flex:0 0 264px;min-height:0;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-layer-1))}
.iw-brand{display:flex;align-items:center;gap:9px;padding:14px 14px 10px;flex:0 0 auto}
.iw-brand-icon{display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-brand-primary)}
.iw-brand-text{min-width:0}
.iw-brand-title{font-size:13.5px;font-weight:600;white-space:nowrap}
.iw-brand-sub{font-size:10.5px;color:var(--dsw-alias-label-secondary);opacity:.8;white-space:nowrap}
.iw-side-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:2px 8px 10px}
.iw-side-section{display:flex;align-items:center;justify-content:space-between;padding:6px 6px 4px 10px}
.iw-side-section-title{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-secondary)}
.iw-side-empty{display:flex;flex-direction:column;gap:6px;padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.iw-link-btn{display:inline-flex;align-items:center;gap:4px;border:0;background:none;padding:0;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer}
.iw-link-btn:hover{text-decoration:underline}
.iw-ws-list{display:flex;flex-direction:column;gap:2px}
.iw-ws{min-width:0}
.iw-ws-row{position:relative;display:flex;align-items:center;gap:6px;padding:6px 6px 6px 4px;border-radius:8px;cursor:pointer;min-width:0}
.iw-ws-row:hover{background:var(--dsw-alias-bg-layer-2)}
.iw-ws-row.active{background:var(--dsw-alias-bg-layer-2)}
.iw-ws-chevron{display:flex;align-items:center;justify-content:center;width:18px;height:18px;flex:0 0 auto;border:0;background:transparent;padding:0;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:5px}
.iw-ws-chevron:hover{color:var(--dsw-alias-label-primary)}
.iw-ws-icon{flex:0 0 auto;color:var(--dsw-alias-label-secondary)}
.iw-ws-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.iw-ws-row.active .iw-ws-name{font-weight:600}
.iw-row-actions{display:flex;align-items:center;gap:1px;flex:0 0 auto;opacity:0;transition:opacity .12s}
.iw-ws-row:hover .iw-row-actions,.iw-ws-row.active .iw-row-actions,.iw-conv:hover .iw-conv-actions,.iw-row-actions:focus-within{opacity:1}
.iw-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:0 0 auto}
.iw-icon-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.iw-icon-btn:disabled{opacity:.4;cursor:default}
.iw-menu{position:absolute;right:4px;top:30px;z-index:60;min-width:142px;display:flex;flex-direction:column;gap:2px;padding:4px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));box-shadow:0 8px 24px rgba(0,0,0,.18)}
.iw-menu-fixed{position:fixed;right:auto;top:auto;z-index:260;min-width:152px}
.iw-menu-item{display:flex;align-items:center;gap:7px;width:100%;padding:7px 9px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
.iw-menu-item:hover{background:var(--dsw-alias-bg-layer-2)}
.iw-menu-item.danger{color:var(--dsw-alias-state-error-primary)}
.iw-ws-convs{display:flex;flex-direction:column;gap:1px;margin:2px 0 6px 18px;padding-left:6px;border-left:1px solid var(--dsw-alias-border-l1)}
.iw-conv-new{display:flex;align-items:center;gap:5px;margin:3px 0;padding:5px 8px;border:1px dashed var(--dsw-alias-border-l1);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;text-align:left}
.iw-conv-new:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.iw-conv-new:disabled{opacity:.5;cursor:default}
.iw-conv-empty{padding:5px 8px;font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.75}
.iw-conv{display:flex;align-items:center;gap:4px;padding:6px 6px 6px 8px;border-radius:8px;cursor:pointer;min-width:0}
.iw-conv:hover{background:var(--dsw-alias-bg-layer-2)}
.iw-conv.active{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 13%,transparent)}
.iw-conv-main{display:flex;flex-direction:column;gap:0;flex:1 1 auto;min-width:0}
.iw-conv-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px}
.iw-conv.active .iw-conv-title{font-weight:600}
.iw-conv-time{font-size:10.5px;color:var(--dsw-alias-label-secondary);opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-side-footer{flex:0 0 auto;border-top:1px solid var(--dsw-alias-border-l1);padding:8px 12px 10px;display:flex;flex-direction:column;gap:6px}
.iw-settings-row,.iw-side-entry{display:flex;align-items:center;gap:7px;width:100%;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12.5px;cursor:pointer;text-align:left}
.iw-settings-row:hover,.iw-side-entry:hover{background:var(--dsw-alias-bg-layer-2)}
.iw-settings-gear{flex:0 0 auto;color:var(--dsw-alias-label-secondary)}
.iw-settings-state{display:flex;align-items:center;gap:5px;margin-left:auto;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.iw-settings-state.on{color:var(--dsw-alias-state-success-primary)}
.iw-status-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-warn-primary,#d69e2e);flex:0 0 auto}
.iw-status-dot.on{background:var(--dsw-alias-state-success-primary,#2f855a)}

/* ---------- main column ---------- */
.iw-main{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0}
.iw-topbar{display:flex;align-items:center;gap:8px;height:48px;padding:0 16px;flex:0 0 auto;border-bottom:1px solid var(--dsw-alias-border-l1)}
.iw-crumbs{display:flex;align-items:center;gap:7px;min-width:0;flex:0 1 auto;overflow:hidden;white-space:nowrap;font-size:13px}
.iw-crumb{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;max-width:240px}
.iw-crumb-sep{color:var(--dsw-alias-label-secondary);opacity:.5}
.iw-crumb-strong{color:var(--dsw-alias-label-primary);font-weight:600;overflow:hidden;text-overflow:ellipsis;max-width:320px}
.iw-topbar-spacer{flex:1 1 auto}
.iw-topbar-tasks{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
.iw-topbar-tasks:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.iw-topbar-tasks.busy{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
.iw-task-list{display:flex;flex-direction:column;gap:8px}
.iw-task-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}
.iw-task-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}
.iw-task-title{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-task-meta{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-task-progress{display:flex;align-items:center;gap:8px;min-width:0}
.iw-task-progress .iw-progress-track{flex:1 1 auto;height:4px}
.iw-task-stage{flex:0 0 auto;font-size:11px;color:var(--dsw-alias-label-secondary)}
.iw-canvas{flex:1 1 auto;min-height:0;overflow-y:auto;padding:24px 32px 8px;scroll-behavior:auto}
.iw-canvas-inner{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px;align-content:start;width:100%;max-width:1480px;margin:0 auto;padding-bottom:8px}
.iw-canvas-caption{grid-column:1/-1;display:flex;align-items:baseline;gap:10px;min-width:0;margin-bottom:2px}
.iw-canvas-caption-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.iw-canvas-caption-meta{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.75}
.iw-canvas-empty{grid-column:1/-1;display:flex;align-items:center;justify-content:center;min-height:340px}
.iw-canvas-empty .iw-home{width:100%;max-width:760px}
.iw-canvas-loading{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.iw-canvas-hint{grid-column:1/-1;display:flex;flex-direction:column;align-items:center;gap:8px;padding:72px 20px;text-align:center;color:var(--dsw-alias-label-secondary)}
.iw-canvas-hint-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.iw-canvas-hint-desc{font-size:12px;max-width:440px;line-height:1.7}

/* ---------- preview cards ---------- */
.iw-card{display:flex;flex-direction:column;gap:7px;min-width:0;cursor:pointer;position:relative}
.iw-card-wrap{min-width:0}
.iw-thumb{position:relative;width:100%;aspect-ratio:4/3;border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}
.iw-thumb-img{display:block;width:100%;height:100%;object-fit:cover}
.iw-img-fail{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;width:100%;height:100%;min-height:80px;padding:10px;font-size:11px;color:var(--dsw-alias-label-secondary);text-align:center;background:var(--dsw-alias-bg-layer-2)}
.iw-mini-btn{border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:10.5px;padding:2px 7px;cursor:pointer}
.iw-mini-btn:hover{border-color:var(--dsw-alias-border-l2)}
.iw-card-actions{position:absolute;top:8px;right:8px;z-index:3;display:flex;align-items:center;gap:6px;opacity:0;transition:opacity .12s}
.iw-card:hover .iw-card-actions,.iw-card:focus-within .iw-card-actions{opacity:1}
.iw-card-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;width:26px;height:26px;padding:0;border-radius:999px;border:1px solid rgba(255,255,255,.3);background:rgba(0,0,0,.55);color:#fff;cursor:pointer;backdrop-filter:blur(2px);font:inherit;font-size:11px;white-space:nowrap}
.iw-card-btn:hover:not(:disabled){background:rgba(0,0,0,.78)}
.iw-card-btn.confirm{width:auto;padding:0 9px;background:var(--dsw-alias-state-error-primary,#c53030);border-color:transparent}
.iw-card-btn:disabled{opacity:.5;cursor:default}
.iw-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.iw-card-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.iw-card-meta{flex:0 0 auto;font-size:10.5px;opacity:.7}
.iw-card-skel{cursor:default}
.iw-skel{position:relative;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.iw-skel::before{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent) 50%,transparent 80%);background-size:200% 100%;animation:iwShimmer 1.5s linear infinite}
.iw-skel-center{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:100%;height:100%;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.iw-skel-pct{font-size:10.5px;opacity:.8}
.iw-skel-elapsed{font-size:10px;color:var(--dsw-alias-label-secondary);opacity:.95;font-variant-numeric:tabular-nums}
.iw-elapsed{flex:0 0 auto;font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}
.iw-group-elapsed{font-size:10.5px;opacity:.85}
.iw-skel-stop{position:absolute;top:8px;right:8px;z-index:2;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;border:1px solid rgba(255,255,255,.3);background:rgba(0,0,0,.55);color:#fff;cursor:pointer;padding:0}
.iw-skel-stop:hover{background:rgba(0,0,0,.78)}

/* ---------- batch group ---------- */
.iw-group{grid-column:1/-1;min-width:0;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 26%,var(--dsw-alias-border-l1));border-radius:14px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,var(--dsw-alias-bg-layer-1));padding:12px}
.iw-group.is-running{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 42%,var(--dsw-alias-border-l1))}
.iw-group-head{display:flex;align-items:center;gap:9px;min-width:0;padding:0 2px 10px;flex-wrap:wrap}
.iw-group-num{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:0 0 auto;border-radius:50%;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent);color:var(--dsw-alias-brand-primary);font-size:10px;font-weight:700}
.iw-group-badge{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;padding:1px 8px;border-radius:999px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-brand-primary);font-size:10.5px;font-weight:600;white-space:nowrap}
.iw-group-prompt{flex:1 1 200px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.iw-group-meta{flex:0 0 auto;font-size:10.5px;color:var(--dsw-alias-label-secondary);opacity:.78;white-space:nowrap}
.iw-group-cancel{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;height:22px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
.iw-group-cancel:hover{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.iw-group-progress{height:2px;margin:-4px 2px 10px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.iw-group-progress-bar{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary);transition:width .4s}
.iw-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px;min-width:0}
.iw-single-grid{grid-column:1/-1;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px;min-width:0;align-content:start}

/* ---------- error / cancelled turn ---------- */
/* v1.3: error/cancelled turn = ONE normal grid cell in the single flow
   (same 4:3 footprint as an image card; no full-width row, no group). */
.iw-error-card{display:flex;flex-direction:column;gap:7px;min-width:0;position:relative;cursor:default}
.iw-error-face{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:100%;aspect-ratio:4/3;min-height:0;padding:12px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 42%,transparent);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,var(--dsw-alias-bg-layer-1));overflow:hidden}
.iw-error-card.is-cancelled .iw-error-face{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.iw-error-icon{display:flex;align-items:center;justify-content:center;width:30px;height:30px;flex:0 0 auto;border-radius:50%;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}
.iw-error-card.is-cancelled .iw-error-icon{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.iw-error-title{font-size:12.5px;font-weight:600;color:var(--dsw-alias-state-error-primary)}
.iw-error-card.is-cancelled .iw-error-title{color:var(--dsw-alias-label-primary)}
.iw-error-summary{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;max-width:100%;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary);text-align:center;word-break:break-word}
.iw-error-foot{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.iw-error-meta{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85}
.iw-error-actions{display:flex;align-items:center;gap:4px;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end}
.iw-error-action{display:inline-flex;align-items:center;justify-content:center;gap:3px;height:22px;padding:0 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;cursor:pointer;white-space:nowrap}
.iw-error-action:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.iw-error-action.danger{color:var(--dsw-alias-state-error-primary)}
.iw-error-action.danger:hover{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent)}
.iw-error-action.danger-confirm{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 82%,#000);border-color:transparent;color:#fff;font-weight:600}

/* ---------- empty state ---------- */
.iw-empty{display:flex;flex-direction:column;align-items:center;gap:9px;padding:40px 24px;text-align:center}
.iw-empty-icon{display:flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:16px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.iw-empty-title{font-size:14px;font-weight:600}
.iw-empty-desc{font-size:12px;color:var(--dsw-alias-label-secondary);max-width:380px;line-height:1.7}

/* ---------- buttons / inputs ---------- */
.iw-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s}
.iw-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}
.iw-btn:disabled{opacity:.45;cursor:default}
.iw-btn-primary{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 60%,transparent);color:var(--dsw-alias-brand-primary);font-weight:600}
.iw-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 28%,transparent)}
.iw-btn-ghost{background:transparent;border-color:transparent}
.iw-btn-ghost:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.iw-btn-danger{background:transparent;border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);color:var(--dsw-alias-state-error-primary)}
.iw-btn-danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.iw-btn-danger-solid{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 82%,#000);border-color:transparent;color:#fff;font-weight:600}
.iw-btn-sm{height:26px;padding:0 9px;font-size:12px}
.iw-btn-text{white-space:nowrap}
.iw-spin{display:inline-block;flex:0 0 auto;border:2px solid color-mix(in srgb,var(--dsw-alias-label-secondary) 35%,transparent);border-top-color:currentColor;border-radius:50%;animation:iwSpin .8s linear infinite}
.iw-input{width:100%;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:inherit;font:inherit;font-size:13px;outline:none}
.iw-input:focus{border-color:var(--dsw-alias-border-l2)}
.iw-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.iw-field-label{font-size:11.5px;color:var(--dsw-alias-label-secondary);font-weight:500}
.iw-field-hint{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary);opacity:.9}

/* ---------- toasts ---------- */
.iw-toasts{position:absolute;top:14px;right:16px;z-index:500;display:flex;flex-direction:column;gap:8px;max-width:390px;pointer-events:none}
.iw-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,.16);animation:iwToastIn .16s ease-out}
.iw-toast-error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);color:var(--dsw-alias-state-error-primary)}
.iw-toast-success{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent);color:var(--dsw-alias-state-success-primary)}
.iw-toast svg{flex:0 0 auto;margin-top:1px}
.iw-toast-text{flex:1 1 auto;min-width:0;line-height:1.55;word-break:break-word;color:var(--dsw-alias-label-primary)}
.iw-toast-error .iw-toast-text,.iw-toast-success .iw-toast-text{color:inherit}
.iw-toast-x{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.iw-toast-x:hover{background:var(--dsw-alias-bg-layer-2)}
.iw-toast-action{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;height:22px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.iw-toast-action:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}

/* ---------- modal ---------- */
.iw-overlay{position:absolute;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.45)}
.iw-modal{display:flex;flex-direction:column;width:min(640px,100%);max-height:86%;min-height:0;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 24px 64px rgba(0,0,0,.28);overflow:hidden;color:var(--dsw-alias-label-primary)}
.iw-modal-head{display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.iw-modal-titles{flex:1 1 auto;min-width:0}
.iw-modal-title{font-size:14px;font-weight:600}
.iw-modal-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.iw-modal-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:14px}
.iw-modal-foot{flex:0 0 auto;display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}
.iw-modal-foot-row{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;flex-wrap:wrap}
.iw-modal-foot-left,.iw-modal-foot-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.iw-modal-foot-leftcol{display:flex;flex-direction:column;gap:4px;min-width:0}
.iw-foot-hint{font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);font-weight:400;max-width:360px}
.iw-confirm-message{font-size:12.5px;line-height:1.75;word-break:break-word}
.iw-form-error{display:flex;align-items:flex-start;gap:6px;padding:8px 10px;border-radius:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 38%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.55;word-break:break-word}
.iw-test-result{display:flex;align-items:flex-start;gap:6px;padding:8px 10px;border-radius:8px;font-size:12px;line-height:1.55;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.iw-test-result.ok{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent);color:var(--dsw-alias-state-success-primary)}
.iw-test-result.fail{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);color:var(--dsw-alias-state-error-primary)}

/* ---------- settings ---------- */
.iw-settings-section{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base)}
.iw-settings-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.iw-settings-section-title{font-size:12.5px;font-weight:600}
.iw-settings-empty{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.iw-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.iw-model-list{display:flex;flex-direction:column;gap:6px}
.iw-model-row{display:grid;grid-template-columns:minmax(0,1fr) 132px auto;gap:6px;align-items:center}
.iw-proxy-block{display:flex;flex-direction:column;gap:7px;padding-top:10px;border-top:1px dashed var(--dsw-alias-border-l1)}
.iw-proxy-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.iw-proxy-state{font-size:11px;color:var(--dsw-alias-label-secondary)}
.iw-proxy-state.on{color:var(--dsw-alias-state-success-primary)}
.iw-proxy-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.iw-proxy-input{flex:1 1 220px;min-width:0;font-size:12px}
.iw-proxy-candidates{display:flex;flex-direction:column;gap:4px;padding:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.iw-proxy-candidates-title{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.iw-proxy-candidate{display:flex;align-items:center;gap:6px;padding:5px 7px;border:1px solid transparent;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:11.5px;cursor:pointer;text-align:left}
.iw-proxy-candidate:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.iw-proxy-candidate-url{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-proxy-candidate-src{flex:0 0 auto;font-size:10px;color:var(--dsw-alias-label-secondary);opacity:.8}
.iw-onboard-list{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
.iw-onboard-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;font-size:12px;cursor:pointer;text-align:left}
.iw-onboard-item:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.iw-onboard-item.sel{border-color:var(--dsw-alias-brand-primary,#5b6cff);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary,#5b6cff) inset}
.iw-onboard-url{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Consolas,monospace;font-size:11.5px}
.iw-onboard-tags{flex:0 0 auto;display:flex;gap:4px;align-items:center}
.iw-tag{display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);font-size:9.5px;color:var(--dsw-alias-label-secondary);opacity:.9}
.iw-tag.ok{border-color:rgba(52,199,89,.45);color:rgb(52,199,89)}
.iw-tag.warn{border-color:rgba(255,159,10,.45);color:rgb(255,159,10)}
.iw-onboard-empty{padding:12px;border:1px dashed var(--dsw-alias-border-l1);border-radius:8px;font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:10px}
.iw-onboard-note{font-size:10.5px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.iw-check-row{display:flex;align-items:flex-start;gap:8px;margin-top:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;font-size:11.5px}
.iw-check-row input{margin-top:2px}
.iw-check-text{display:flex;flex-direction:column;gap:3px;min-width:0}
.iw-check-text .iw-field-hint{margin:0}
.iw-dir-block{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}
.iw-dir-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.iw-dir-state{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.iw-dir-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.iw-dir-input{flex:1 1 200px;min-width:0;font-size:12px}
.iw-key-row{display:flex;align-items:center;gap:8px;min-width:0}
.iw-key-row .iw-input{flex:1 1 auto;min-width:0}
.iw-key-hint{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--dsw-alias-state-success-primary);flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-key-cleared{font-size:11.5px;color:var(--dsw-alias-state-warn-primary,#b7791f);flex:0 0 auto}
.iw-settings-note{display:flex;align-items:flex-start;gap:7px;padding:10px 12px;border-radius:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 28%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,transparent);font-size:11px;line-height:1.65;color:var(--dsw-alias-label-secondary)}
.iw-settings-note svg{flex:0 0 auto;margin-top:2px}

/* ---------- detail overlay ---------- */
.iw-detail-overlay{background:rgba(0,0,0,.55)}
.iw-detail{display:flex;width:92%;height:86%;max-width:1560px;min-height:0;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);box-shadow:0 28px 72px rgba(0,0,0,.42)}
.iw-detail-info{display:flex;flex-direction:column;flex:0 0 25%;min-width:280px;max-width:390px;min-height:0;border-right:1px solid var(--dsw-alias-border-l1)}
.iw-detail-info-head{display:flex;align-items:center;gap:7px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto;color:var(--dsw-alias-label-secondary)}
.iw-detail-title{flex:1 1 auto;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.iw-detail-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:14px}
.iw-detail-section{display:flex;flex-direction:column;gap:7px;min-width:0}
.iw-detail-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.iw-detail-section-title{font-size:11px;font-weight:600;letter-spacing:.03em;color:var(--dsw-alias-label-secondary)}
.iw-detail-prompt{max-height:200px;overflow-y:auto;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);font-size:12.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word}
.iw-detail-refs{display:grid;grid-template-columns:repeat(auto-fill,minmax(62px,1fr));gap:8px}
.iw-detail-ref{position:relative;padding:0;aspect-ratio:1;overflow:hidden;border:2px solid transparent;border-radius:9px;background:var(--dsw-alias-bg-layer-2);cursor:pointer}
.iw-detail-ref img{width:100%;height:100%;object-fit:cover;display:block}
.iw-detail-ref:hover{border-color:var(--dsw-alias-border-l2)}
.iw-detail-ref.active{border-color:var(--dsw-alias-brand-primary)}
.iw-detail-ref-badge{position:absolute;left:3px;bottom:3px;padding:0 4px;border-radius:4px;background:rgba(0,0,0,.62);color:#fff;font-size:9.5px;line-height:1.5}
.iw-detail-ref-open{position:absolute;top:3px;right:3px;display:flex;align-items:center;justify-content:center;width:17px;height:17px;padding:0;border:0;border-radius:5px;background:rgba(0,0,0,.62);color:#fff;cursor:pointer;opacity:0;transition:opacity .12s}
.iw-detail-ref:hover .iw-detail-ref-open,.iw-detail-ref:focus-within .iw-detail-ref-open{opacity:1}
.iw-detail-mask{display:flex;align-items:center;gap:10px}
.iw-detail-mask-thumb{width:76px;height:76px;flex:0 0 auto;padding:0;border:2px solid transparent;border-radius:9px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);cursor:pointer}
.iw-detail-mask-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.iw-detail-mask-thumb:hover{border-color:var(--dsw-alias-border-l2)}
.iw-detail-mask-thumb.active{border-color:var(--dsw-alias-brand-primary)}
.iw-detail-mask-meta{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.iw-param-table{display:flex;flex-direction:column;gap:1px}
.iw-param-row{display:flex;align-items:flex-start;gap:10px;padding:3px 0;font-size:12px}
.iw-param-key{flex:0 0 64px;color:var(--dsw-alias-label-secondary)}
.iw-param-val{flex:1 1 auto;min-width:0;word-break:break-word}
.iw-detail-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.iw-detail-media{position:relative;flex:1 1 auto;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;background:#0b0b0d;overflow:hidden}
.iw-detail-media .iw-detail-img{max-width:calc(100% - 48px);max-height:calc(100% - 88px);width:auto;height:auto;object-fit:contain;border-radius:6px}
.iw-detail-media .iw-img-fail{color:#cfcfd4;background:rgba(255,255,255,.04);max-width:420px;border-radius:10px;min-height:180px}
.iw-detail-close.iw-icon-btn{position:absolute;top:12px;left:12px;z-index:5;width:30px;height:30px;border-radius:50%;border:1px solid rgba(255,255,255,.28);background:rgba(0,0,0,.5);color:#fff}
.iw-detail-close.iw-icon-btn:hover{background:rgba(0,0,0,.8);color:#fff}
.iw-detail-caption{position:absolute;bottom:14px;left:16px;padding:4px 9px;border-radius:999px;background:rgba(0,0,0,.62);color:#fff;font-size:11.5px;max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-detail-hint{position:absolute;bottom:18px;right:16px;color:rgba(255,255,255,.55);font-size:11px}

/* ---------- composer ---------- */
.iw-composer-dock{flex:0 0 auto;padding:8px 32px 16px}
.iw-composer-wrap{width:100%;max-width:780px;margin:0 auto}
.iw-composer{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-layer-1);transition:border-color .12s,box-shadow .12s}
.iw-composer.focused{border-color:var(--dsw-alias-border-l2);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
.iw-ref-tray{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.iw-ref-chip{position:relative;width:40px;height:40px;border-radius:8px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);flex:0 0 auto}
.iw-ref-chip img{width:100%;height:100%;object-fit:cover;display:block}
.iw-ref-chip .iw-img-fail{font-size:8px;gap:2px;min-height:0}
.iw-ref-chip .iw-img-fail span,.iw-ref-chip .iw-img-fail button{display:none}
.iw-ref-x{position:absolute;top:1px;right:1px;display:flex;align-items:center;justify-content:center;width:15px;height:15px;padding:0;border-radius:50%;border:0;background:rgba(0,0,0,.65);color:#fff;cursor:pointer}
.iw-ref-x:hover{background:var(--dsw-alias-state-error-primary,#c53030)}
.iw-ref-count{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.iw-composer-textarea{width:100%;min-height:26px;max-height:180px;padding:2px 4px;border:0;background:transparent;color:inherit;font:inherit;font-size:14px;line-height:1.65;resize:none;outline:none;overflow-y:auto}
.iw-composer-textarea::placeholder{color:var(--dsw-alias-label-secondary);opacity:.85}
.iw-composer-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.iw-composer-left{display:flex;align-items:center;gap:8px;min-width:0;flex:0 1 auto}
.iw-plus-btn{display:flex;align-items:center;justify-content:center;width:30px;height:30px;flex:0 0 auto;padding:0;border-radius:50%;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.iw-plus-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.iw-plus-btn:disabled{opacity:.5;cursor:default}
.iw-file-input{display:none}
.iw-composer-hint{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.iw-composer-controls{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap;flex:1 1 auto;min-width:0}
.iw-control-warn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px;border-radius:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent);color:var(--dsw-alias-state-warn-primary,#b7791f);font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap}
.iw-select-wrap{position:relative;display:inline-flex;align-items:center;flex:0 0 auto}
.iw-select{appearance:none;-webkit-appearance:none;height:28px;flex:0 1 auto;min-width:0;max-width:150px;padding:0 22px 0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:inherit;font:inherit;font-size:12px;outline:none;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-select:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}
.iw-select:disabled{opacity:.5;cursor:default}
.iw-select-chevron{position:absolute;right:7px;pointer-events:none;color:var(--dsw-alias-label-secondary)}
.iw-select-model{max-width:150px}
.iw-select-ratio{max-width:120px}
.iw-select-quality{max-width:86px}
.iw-select-count{max-width:76px}
.iw-select-resolution{max-width:86px}
/* v1.3: send button is a fixed flex item of .iw-composer-row (always visible,
   never inside the wrapping controls group / never clipped by an ancestor).
   v1.3b: both states render as a complete crisp circle — the disabled state no
   longer fades the whole button (that made it look partial on the dark theme).
   v1.3c: in the dark theme --dsw-alias-brand-primary is WHITE, so the icon must
   use --dsw-alias-bg-base (adaptive dark-on-light / light-on-dark) or the arrow
   would be white-on-white and look missing. */
.iw-send-btn{display:flex;align-items:center;justify-content:center;width:32px;height:32px;flex:0 0 auto;padding:0;margin-left:2px;border:1px solid transparent;border-radius:50%;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.28);transition:filter .12s,background .12s,border-color .12s,box-shadow .12s,color .12s}
.iw-send-btn svg{display:block}
.iw-send-btn:hover:not(:disabled){filter:brightness(.94)}
.iw-send-btn:disabled{cursor:default;opacity:1;filter:none;background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);box-shadow:none}
.iw-progress-line{display:flex;align-items:center;gap:8px;padding:6px 6px 0;font-size:11px;color:var(--dsw-alias-label-secondary);min-width:0}
.iw-progress-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-progress-track{flex:0 0 90px;height:3px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.iw-progress-fill{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary);transition:width .45s}
.iw-progress-cancel{display:inline-flex;align-items:center;gap:3px;flex:0 0 auto;height:20px;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;cursor:pointer}
.iw-progress-cancel:hover{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.iw-composer-tips{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 6px 0;font-size:10.5px;color:var(--dsw-alias-label-secondary);opacity:.85}
.iw-composer-tips-right{flex:0 0 auto;opacity:.9}

/* ---------- v1.2 local ComfyUI workflows ---------- */
.iw-composer-params{display:flex;align-items:center;gap:6px;flex-wrap:wrap;width:100%;min-width:0}
.iw-composer-warn-hint{color:var(--dsw-alias-state-warn-primary);font-size:10.5px;line-height:1.5;background:transparent;border:0;padding:0;font-family:inherit;cursor:pointer;text-align:left}
.iw-composer-warn-hint:hover{text-decoration:underline}
.iw-param-item{display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);max-width:100%;min-width:0}
.iw-param-label{font-size:11px;color:var(--dsw-alias-label-secondary);max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-param-num{width:76px;height:26px;font-size:11.5px;padding:0 6px}
.iw-param-text{width:140px;height:26px;font-size:11.5px}
.iw-param-select{max-width:170px;height:26px;font-size:11.5px}
.iw-param-select .iw-select{max-width:170px;height:26px;font-size:11.5px}
.iw-param-check{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.iw-param-random{font-size:10.5px;gap:3px;margin-left:1px;opacity:.92}
.iw-param-random input{width:12px;height:12px;margin:0}
.iw-comfy-workflow-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.iw-comfy-workflow-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-comfy-param-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:4px 0}
.iw-comfy-editor{display:block;max-height:min(560px,70vh);overflow-y:auto;padding-right:2px}
.iw-comfy-node{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);overflow:hidden;margin-bottom:8px}
.iw-comfy-node:last-child{margin-bottom:0}
.iw-comfy-node-head{display:flex;align-items:center;gap:8px;padding:7px 10px;font-size:12px;font-weight:600;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.iw-comfy-node-id{font-size:11px;font-weight:400;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.iw-comfy-node-inputs{display:flex;flex-direction:column;gap:2px;padding:6px 8px}
.iw-comfy-picker{flex:0 0 auto;display:flex;align-items:stretch;gap:10px;height:min(58vh,540px);min-height:320px}
.iw-comfy-picker-list{flex:0 0 264px;min-width:0;display:flex;flex-direction:column;gap:3px;overflow-y:auto;padding-right:6px;border-right:1px solid var(--dsw-alias-border-l1)}
.iw-comfy-picker-item{display:flex;flex-direction:column;gap:2px;width:100%;padding:6px 8px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.iw-comfy-picker-item:hover{background:var(--dsw-alias-bg-layer-2)}
.iw-comfy-picker-item.active{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.iw-comfy-picker-item-title{display:flex;align-items:baseline;gap:6px;min-width:0;font-weight:600}
.iw-comfy-picker-item-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-comfy-picker-item-id{flex:0 0 auto;font-size:10.5px;font-weight:400;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.iw-comfy-picker-item-meta{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.iw-comfy-picker-badge{flex:0 0 auto;font-size:10px;line-height:1.5;padding:0 5px;border-radius:999px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);color:var(--dsw-alias-brand-primary)}
.iw-comfy-picker-badge.output{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 50%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary)}
.iw-comfy-picker-detail{flex:1 1 auto;min-width:0;display:block;overflow-y:auto;padding-right:4px}
.iw-comfy-detail-head{display:flex;align-items:center;gap:8px;padding-bottom:6px;margin-bottom:4px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;font-weight:600}
.iw-comfy-detail-head .iw-comfy-node-id{font-family:ui-monospace,Consolas,monospace}
.iw-comfy-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.iw-comfy-search{flex:1 1 200px;min-width:160px}
.iw-comfy-prompt-bind{flex:0 1 330px;min-width:210px;max-width:360px}
.iw-comfy-prompt-bind .iw-select{max-width:360px;height:26px;font-size:11.5px}
.iw-comfy-picker-empty{padding:14px 8px;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.iw-comfy-order{display:flex;flex-direction:column;gap:5px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}
.iw-comfy-order-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.iw-comfy-order-title{font-size:12px;font-weight:600}
.iw-comfy-order-list{display:flex;flex-wrap:wrap;gap:5px;min-height:30px}
.iw-comfy-order-item{display:inline-flex;align-items:center;gap:4px;padding:3px 5px 3px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);cursor:grab;user-select:none}
.iw-comfy-order-item.dragging{opacity:.45;cursor:grabbing}
.iw-comfy-order-item.drop-target{outline:2px dashed var(--dsw-alias-brand-primary);outline-offset:1px}
.iw-comfy-order-handle{color:var(--dsw-alias-label-secondary);font-size:10px;letter-spacing:-1px;cursor:grab}
.iw-comfy-order-label{font-size:11.5px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-comfy-order-type{font-size:10px;color:var(--dsw-alias-label-secondary);padding:0 4px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1)}
.iw-comfy-order-btn{width:18px;height:18px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1;cursor:pointer}
.iw-comfy-order-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.iw-comfy-order-btn:disabled{opacity:.35;cursor:default}
.iw-comfy-order-remove:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}
.iw-comfy-input-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:3px 0;font-size:11.5px}
.iw-comfy-input-name{min-width:110px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,Consolas,monospace;font-size:11px}
.iw-comfy-input-row .iw-input{height:26px;font-size:11.5px}
.iw-comfy-input-label{width:130px}
.iw-comfy-input-num{width:74px}
.iw-comfy-input-default{width:110px}
.iw-comfy-options{width:100%;min-height:52px;resize:vertical;font-size:11.5px;line-height:1.5;font-family:inherit}
.iw-comfy-import{display:flex;flex-direction:column;gap:6px}
.iw-comfy-paste{width:100%;min-height:92px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;line-height:1.5}
.iw-comfy-editor-title{font-size:12.5px;font-weight:600}
.iw-comfy-saved-note{font-size:11px;color:var(--dsw-alias-label-secondary)}

/* ---------- boot / error pages ---------- */
.iw-boot{display:flex;flex:1 1 auto;align-items:center;justify-content:center;padding:32px;min-height:0;overflow-y:auto}
.iw-boot-card{display:flex;flex-direction:column;align-items:center;gap:10px;width:min(540px,100%);padding:28px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);text-align:center}
.iw-boot-icon{display:flex;align-items:center;justify-content:center;width:54px;height:54px;border-radius:16px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-brand-primary)}
.iw-boot-icon.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
.iw-boot-title{font-size:16px;font-weight:600}
.iw-boot-row{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.iw-boot-error{width:100%;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.6;word-break:break-word}
.iw-boot-desc{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.iw-boot-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center}

/* ---------- v1.4 cost dashboard ---------- */
.iw-cost-loading{display:flex;align-items:center;gap:8px;padding:12px 0;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.iw-cost-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.iw-cost-card{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base)}
.iw-cost-card-title{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.iw-cost-card-cost{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.iw-cost-card-meta{font-size:11px;color:var(--dsw-alias-label-secondary)}
.iw-cost-card-sub{font-size:10.5px;color:var(--dsw-alias-label-secondary);opacity:.8}
.iw-cost-empty{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px dashed var(--dsw-alias-border-l1);border-radius:9px;color:var(--dsw-alias-label-secondary);font-size:12px}
.iw-cost-section{display:flex;flex-direction:column;gap:8px}
.iw-cost-section-title{font-size:12px;font-weight:600}
.iw-cost-bars{display:flex;align-items:flex-end;gap:6px;height:132px;padding:8px 6px 4px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}
.iw-cost-bar-col{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%}
.iw-cost-bar-track{flex:1 1 auto;width:100%;display:flex;align-items:flex-end;justify-content:center;min-height:0}
.iw-cost-bar{width:72%;max-width:18px;min-height:2px;border-radius:3px 3px 0 0;background:var(--dsw-alias-brand-primary);opacity:.85}
.iw-cost-bar-label{font-size:8.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.iw-cost-table{width:100%;border-collapse:collapse;font-size:11.5px}
.iw-cost-table th{font-weight:600;color:var(--dsw-alias-label-secondary);text-align:left;padding:5px 6px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.iw-cost-table td{padding:4px 6px;border-bottom:1px dashed var(--dsw-alias-border-l1);vertical-align:middle}
.iw-cost-model{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-cost-price{height:26px;width:92px;font-size:11.5px}
.iw-cost-tiers{max-width:190px;font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.iw-cost-price-tiers{display:flex;align-items:center;gap:5px}
.iw-cost-price-tier{display:inline-flex;align-items:center;gap:3px}
.iw-cost-price-tier-label{font-size:9.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.iw-cost-price.iw-cost-price-tier-input{width:62px;height:26px;padding:0 5px;font-size:11px}

/* ---------- v1.4 §C local inpainting / mask editor ---------- */
.iw-inpaint-hint{flex:1 1 100%;font-size:10.5px;line-height:1.5;color:var(--dsw-alias-state-warn-primary,#b7791f)}
.iw-mask-overlay{background:rgba(0,0,0,.62)}
.iw-mask-editor{display:flex;flex-direction:column;width:94%;height:90%;max-width:1500px;min-height:0;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);box-shadow:0 28px 72px rgba(0,0,0,.45)}
.iw-mask-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto;color:var(--dsw-alias-label-secondary)}
.iw-mask-title{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.iw-mask-sub{flex:1 1 auto;min-width:0;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.iw-mask-body{display:flex;flex:1 1 auto;min-height:0;min-width:0}
.iw-mask-stage{position:relative;flex:1 1 auto;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;background:#0b0b0d;overflow:hidden}
.iw-mask-image{max-width:100%;max-height:100%;object-fit:contain;display:block;user-select:none;-webkit-user-drag:none}
.iw-mask-overlay-canvas{position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;touch-action:none}
.iw-mask-side{flex:0 0 280px;min-width:230px;border-left:1px solid var(--dsw-alias-border-l1);padding:12px;display:flex;flex-direction:column;gap:12px;overflow-y:auto;min-height:0}
.iw-mask-section{display:flex;flex-direction:column;gap:6px}
.iw-mask-tools{display:flex;gap:6px}
.iw-mask-tool{flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:30px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.iw-mask-tool.active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
.iw-mask-range{width:100%;accent-color:var(--dsw-alias-brand-primary)}
.iw-mask-prompt{resize:vertical;min-height:90px;line-height:1.6}
.iw-mask-tip{font-size:10.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.iw-mask-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1);flex:0 0 auto;flex-wrap:wrap}
.iw-mask-status{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.iw-mask-status.ready{color:var(--dsw-alias-state-success-primary)}
.iw-mask-status.warn{color:var(--dsw-alias-state-warn-primary,#b7791f)}
.iw-mask-foot-actions{display:flex;align-items:center;gap:8px}
@media (max-width:900px){.iw-mask-side{flex-basis:220px;min-width:200px}}

@keyframes iwSpin{to{transform:rotate(360deg)}}
@keyframes iwShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
@keyframes iwToastIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
@media (max-width:1040px){
  .iw-sidebar{width:236px;flex-basis:236px}
  .iw-canvas{padding:16px 20px 8px}
  .iw-composer-dock{padding:8px 20px 14px}
}
/* v2.1: activity tabs, workspace home, workflow board */
.iw-hidden{display:none !important}
.iw-workspace-view{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;min-width:0}
.iw-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:2px 10px 10px}
.iw-tab{display:inline-flex;align-items:center;justify-content:flex-start;gap:6px;height:27px;min-width:0;padding:0 9px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap}
.iw-tab-label{overflow:hidden;text-overflow:ellipsis}
.iw-tab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.iw-tab.active{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);font-weight:600}
.iw-tab-count{min-width:14px;height:14px;padding:0 4px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent);color:var(--dsw-alias-brand-primary);font-size:9.5px;display:inline-flex;align-items:center;justify-content:center}
.iw-side-tabinfo{padding:12px;display:flex;flex-direction:column;gap:6px}
.iw-side-tabinfo-title{font-size:12.5px;font-weight:600}
.iw-side-tabinfo-desc{font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.iw-side-tabinfo-badge{align-self:flex-start;margin-top:2px;padding:1px 7px;border-radius:999px;border:1px dashed var(--dsw-alias-border-l2);font-size:10px;color:var(--dsw-alias-label-secondary)}
.iw-canvas-home{grid-column:1/-1;display:flex;align-items:center;justify-content:center;min-height:clamp(320px,58vh,620px);padding:8px 0}
.iw-home{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;width:100%;max-width:760px;padding:24px 16px;text-align:center}
.iw-home-greet{font-size:19px;font-weight:600;letter-spacing:.2px}
.iw-home-actions{display:flex;gap:12px}
.iw-home-action{display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 22px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px;cursor:pointer;transition:all .12s ease}
.iw-home-action:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.iw-home-action.primary{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);color:var(--dsw-alias-brand-primary)}
.iw-home-action.primary:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
.iw-home-action.active{box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,transparent)}
.iw-home-categories{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.iw-home-category{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.iw-home-category.ready{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.iw-home-category.ready:hover{background:var(--dsw-alias-bg-layer-2)}
.iw-home-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary);opacity:.85}
.iw-board{flex:1 1 auto;overflow:auto;padding:20px 24px 28px;display:flex;flex-direction:column;gap:22px}
.iw-board-head{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap}
.iw-board-title{font-size:16px;font-weight:600}
.iw-board-sub{flex:1 1 auto;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.iw-board-group{display:flex;flex-direction:column;gap:10px}
.iw-board-group-head{display:flex;align-items:center;gap:8px}
.iw-board-group-title{font-size:12.5px;font-weight:600}
.iw-board-group-count{font-size:11px;color:var(--dsw-alias-label-secondary)}
.iw-workflow-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
.iw-workflow-card{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.iw-workflow-card:hover{border-color:var(--dsw-alias-border-l2)}
.iw-workflow-card-head{display:flex;align-items:center;gap:8px;min-width:0}
.iw-workflow-card-name{flex:1 1 auto;font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-workflow-card-meta{font-size:11px;color:var(--dsw-alias-label-secondary)}
.iw-workflow-card-actions{display:flex;gap:6px;flex-wrap:wrap}
.iw-main-empty{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:48px 20px;color:var(--dsw-alias-label-secondary);text-align:center}
.iw-main-empty-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.iw-main-empty-desc{max-width:420px;font-size:11.5px;line-height:1.7}
.iw-comfy-category-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.iw-comfy-category-row .iw-param-select{min-width:120px}
.iw-comfy-category-row .iw-input{flex:1 1 180px}

/* v2.2: template tab + composer @ picker */
.iw-composer{position:relative}
.iw-composer-link{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 7px;border-radius:999px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
.iw-composer-link:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.iw-at-menu{position:absolute;left:12px;right:12px;bottom:calc(100% + 8px);z-index:40;display:flex;flex-direction:column;gap:2px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 32px rgba(0,0,0,.28);max-height:320px;overflow:auto}
.iw-at-head{display:flex;align-items:center;gap:6px;padding:4px 6px 8px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.iw-at-item{display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.iw-at-item:hover,.iw-at-item.active{background:var(--dsw-alias-bg-layer-2)}
.iw-at-name{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-at-cat{font-size:10px;color:var(--dsw-alias-label-secondary)}
.iw-at-vars{font-size:10px;color:var(--dsw-alias-brand-primary)}
.iw-at-empty{padding:10px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.iw-at-foot{padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1);margin-top:4px}
.iw-at-save{width:100%;padding:6px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;text-align:left;cursor:pointer;border-radius:6px}
.iw-at-save:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.iw-at-var-row{display:flex;align-items:center;gap:8px;padding:2px 4px}
.iw-at-var-key{flex:0 0 88px;font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-at-var-input{flex:1 1 auto;height:26px;font-size:12px}
.iw-at-actions{display:flex;justify-content:flex-end;gap:6px;padding:6px 4px 2px}
.iw-template-side{display:flex;flex-direction:column;gap:8px;padding:0 10px 10px}
.iw-template-search{height:28px;font-size:11.5px}
.iw-template-list{display:flex;flex-direction:column;gap:2px}
.iw-template-item{display:flex;flex-direction:column;gap:2px;width:100%;padding:6px 8px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.iw-template-item:hover{background:var(--dsw-alias-bg-layer-2)}
.iw-template-item.active{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.iw-template-name{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-template-meta{font-size:10px;color:var(--dsw-alias-label-secondary)}
.iw-template-board{flex:1 1 auto;overflow:auto;padding:20px 24px 28px;display:flex;flex-direction:column;gap:16px}
.iw-template-form{display:flex;flex-direction:column;gap:12px;max-width:760px}
.iw-template-content{min-height:150px;resize:vertical;line-height:1.6;font-size:12.5px;width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit}
.iw-template-vars{display:flex;flex-direction:column;gap:6px}
.iw-template-var{display:flex;align-items:center;gap:8px}
.iw-template-var-key{flex:0 0 110px;font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-template-var .iw-input{flex:1 1 auto;height:28px;font-size:12px}
.iw-template-preview{display:flex;flex-direction:column;gap:5px;padding:10px 12px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.iw-template-preview-label{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.iw-template-preview-body{font-size:12.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word}
.iw-template-actions{display:flex;gap:8px;flex-wrap:wrap}

/* v2.3: agent templates */
.iw-at-agent{font-size:10px;color:var(--dsw-alias-brand-primary)}
.iw-composer.iw-agent-mode{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 62%,transparent);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
.iw-agent-panel{position:absolute;left:12px;right:12px;bottom:calc(100% + 8px);z-index:45;display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 32px rgba(0,0,0,.3);max-height:70vh;overflow:auto}
.iw-agent-head{display:flex;align-items:center;gap:6px;font-size:12px}
.iw-agent-name{font-weight:600}
.iw-agent-kind{font-size:10px;color:var(--dsw-alias-brand-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent);border-radius:999px;padding:0 6px}
.iw-agent-x{margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.iw-agent-x:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.iw-agent-text{min-height:64px;font-size:12.5px;resize:vertical}
.iw-agent-image-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.iw-agent-image-name{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.iw-agent-hint{font-size:11px;color:var(--dsw-alias-label-secondary)}
.iw-agent-file{display:none}
.iw-agent-error{font-size:11.5px;color:var(--dsw-alias-state-error-primary)}
.iw-agent-result{display:flex;flex-direction:column;gap:4px}
.iw-agent-result-label{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.iw-agent-result-text{min-height:90px;font-size:12.5px;resize:vertical}
.iw-agent-actions{display:flex;gap:8px;justify-content:flex-end}
.iw-agent-settings{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.iw-agent-settings-head{display:flex;flex-direction:column;gap:2px}
.iw-agent-settings-title{font-size:12.5px;font-weight:600}
.iw-agent-settings-sub{font-size:11px;color:var(--dsw-alias-label-secondary)}
.iw-agent-settings-grid{display:flex;flex-wrap:wrap;gap:8px}
.iw-agent-settings-grid .iw-input{flex:1 1 220px}
.iw-agent-settings-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.iw-agent-settings-msg{font-size:11px;color:var(--dsw-alias-label-secondary)}
.iw-agent-inputs{display:flex;gap:14px;font-size:12px}
.iw-agent-inputs label{display:inline-flex;align-items:center;gap:5px;cursor:pointer}

/* v2.4: agent temporary session drawer */
.iw-agent-drawer{position:absolute;top:0;right:0;bottom:0;width:420px;max-width:46vw;z-index:60;display:flex;flex-direction:column;min-height:0;border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);box-shadow:-12px 0 32px rgba(0,0,0,.28)}
.iw-agent-drawer-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.iw-agent-drawer-title{flex:1 1 auto;display:flex;align-items:center;gap:6px;min-width:0}
.iw-agent-drawer-name{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iw-agent-drawer-badge{flex:0 0 auto;font-size:10px;padding:0 6px;border-radius:999px;border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.iw-agent-drawer-x{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.iw-agent-drawer-x:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.iw-agent-drawer-body{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:12px}
.iw-agent-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;flex:1 1 auto;padding:32px 16px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px}
.iw-agent-empty-sub{font-size:11px;opacity:.85}
.iw-agent-msg{display:flex;flex-direction:column;gap:5px;max-width:100%}
.iw-agent-msg-user{align-items:flex-end}
.iw-agent-msg-bot{align-items:flex-start}
.iw-agent-bubble{max-width:88%;padding:8px 11px;border-radius:12px;font-size:12.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word}
.iw-agent-msg-user .iw-agent-bubble{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 32%,transparent);border-bottom-right-radius:4px}
.iw-agent-msg-bot .iw-agent-bubble{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-bottom-left-radius:4px}
.iw-agent-typing{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:11.5px}
.iw-agent-msg-image{max-width:200px;max-height:150px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1)}
.iw-agent-msg-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.iw-agent-msg-meta{font-size:10px;color:var(--dsw-alias-label-secondary)}
.iw-agent-mini{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;cursor:pointer;padding:1px 5px;border-radius:5px}
.iw-agent-mini:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.iw-agent-error{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 38%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-state-error-primary);font-size:11.5px}
.iw-agent-selection{display:flex;align-items:center;gap:8px;padding:6px 12px;border-top:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent);font-size:11px;color:var(--dsw-alias-label-secondary);flex:0 0 auto}
.iw-agent-compose{flex:0 0 auto;display:flex;flex-direction:column;gap:6px;padding:10px 12px 12px;border-top:1px solid var(--dsw-alias-border-l1)}
.iw-agent-compose-image{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.iw-agent-compose-image img{width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--dsw-alias-border-l1)}
.iw-agent-compose-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px}
.iw-agent-compose-input{min-height:64px;font-size:12.5px;resize:vertical}
.iw-agent-compose-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.iw-agent-compose-spacer{flex:1 1 auto}
.iw-agent-file{display:none}
.iw-agent-mode-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
@media (max-width:1040px){.iw-agent-drawer{width:360px}}

/* v2.5: ComfyUI VRAM indicator */
.iw-vram{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.iw-vram-text{font-variant-numeric:tabular-nums}
.iw-vram-release{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;cursor:pointer;padding:0 2px;border-radius:4px}
.iw-vram-release:hover{color:var(--dsw-alias-state-error-primary)}

/* v2.7: agent chat conversation */
.iw-agent-chat{display:flex;flex-direction:column}
.iw-agent-chat-inner{display:flex;flex-direction:column;gap:10px;max-width:900px;margin:0 auto;width:100%;grid-template-columns:none}
.iw-agent-chat-head{display:flex;align-items:center;gap:8px;padding:2px 2px 6px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.iw-agent-chat-title{font-size:13px;font-weight:600}
.iw-agent-chat-body{display:flex;flex-direction:column;gap:12px;padding:10px 2px;flex:1 1 auto;min-height:0;overflow-y:auto}
.iw-agent-chat .iw-agent-bubble{max-width:78%}
.iw-composer.iw-agent-chat-mode .iw-composer-controls{display:none}
.iw-conv-agent{flex:0 0 auto;font-size:9px;margin-right:3px;filter:saturate(1.2)}

`
