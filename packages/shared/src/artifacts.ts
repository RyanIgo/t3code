/**
 * Fleet fork: artifacts are pages agents publish to the fleet hub (a test sheet, or their own
 * HTML) that people fill in from a chat, the Review window, a phone or a teammate's browser.
 * Agents publish with fleet/skills/t3-artifacts/artifact.mjs; the hub stores the results. The
 * deploy builds the hub's page shells from here, so they match T3's theme.
 */
import { injectHtmlRenderBootstrap } from "./htmlRender.ts";

export interface ArtifactLink {
  readonly id: string;
  /** The page on the hub, e.g. https://hub.example.ts.net/a/0123456789ab. */
  readonly url: string;
  readonly title: string;
}

const ARTIFACT_URL = /https:\/\/[a-z0-9.-]+\.ts\.net\/a\/[a-f0-9]{12}(?![\w/])/gi;
const MARKDOWN_LINK = /\[([^\]\n]{1,200})\]\((https:\/\/[^)\s]+)\)/g;

/**
 * Hub artifact links in a message, each once, in order. Only https pages at /a/<id> on a
 * tailnet (.ts.net) host count; the frame that shows them is sandboxed either way.
 */
export function extractArtifactLinks(text: string): ArtifactLink[] {
  const titles = new Map<string, string>();
  for (const [, label, url] of text.matchAll(MARKDOWN_LINK)) {
    if (label && url) titles.set(url.toLowerCase(), label.trim());
  }
  const links: ArtifactLink[] = [];
  const seen = new Set<string>();
  for (const [match] of text.matchAll(ARTIFACT_URL)) {
    const url = match.toLowerCase();
    const id = url.slice(-12);
    if (seen.has(id)) continue;
    seen.add(id);
    links.push({ id, url, title: titles.get(url) ?? "Artifact" });
  }
  return links;
}

/** The theme `<style>` and bootstrap `<script>` html_render pages get, for the hub to inject. */
export function artifactThemeHead(): string {
  const page = injectHtmlRenderBootstrap("<head></head>");
  return page.slice(page.indexOf("<head>") + 6, page.lastIndexOf("</head>"));
}

/**
 * The test sheet page: one row per check with Pass / Fail / Skip / Blocked and a note, saved to
 * the hub as people go, and a Submit. Title, intro and rows come from the hub when it serves it.
 */
export function artifactSheetHtml(): string {
  return injectHtmlRenderBootstrap(`<!doctype html><html><head><title>Test sheet</title>
<style>${SHEET_CSS}</style></head><body>
<header><h1 id="title"></h1><p class="intro" id="intro"></p><p class="tally" id="tally"></p></header>
<main id="rows"></main>
<footer><button type="button" id="submit">Submit results</button><span id="sent" role="status"></span></footer>
<script>${SHEET_SCRIPT}</script></body></html>`);
}

const SHEET_CSS = `
body{padding:14px 16px 18px;max-width:960px}
h1{font-size:16px;margin:0 0 4px}
.intro{margin:0 0 6px;color:var(--muted-foreground);white-space:pre-wrap}
.intro:empty{display:none}
.tally{margin:0 0 12px;color:var(--muted-foreground);font-size:12px}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted-foreground);margin:16px 0 6px}
.row{border:1px solid var(--border);border-radius:var(--radius,8px);background:var(--card);padding:10px 12px;margin-bottom:8px}
.row[data-status=pass]{border-color:var(--success)}
.row[data-status=fail]{border-color:var(--destructive)}
.row[data-status=blocked]{border-color:var(--warning)}
.top{display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap}
.what{flex:1 1 260px;min-width:0}
.title{font-weight:600}
.detail{margin-top:2px;color:var(--muted-foreground);white-space:pre-wrap}
.choices{display:flex;gap:4px;flex-wrap:wrap}
.choices button,footer button{font:inherit;font-size:12px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--foreground);padding:3px 9px;cursor:pointer}
.choices button[aria-pressed=true]{font-weight:600}
.choices button[data-v=pass][aria-pressed=true]{background:var(--success);border-color:var(--success);color:#fff}
.choices button[data-v=fail][aria-pressed=true]{background:var(--destructive);border-color:var(--destructive);color:#fff}
.choices button[data-v=skip][aria-pressed=true]{background:var(--foreground);border-color:var(--foreground);color:var(--background)}
.choices button[data-v=blocked][aria-pressed=true]{background:var(--warning);border-color:var(--warning);color:#000}
textarea{display:block;box-sizing:border-box;width:100%;margin-top:8px;font:inherit;font-size:13px;color:var(--foreground);background:var(--background);border:1px solid var(--border);border-radius:6px;padding:6px 8px;min-height:34px;resize:vertical}
.by{margin-top:4px;font-size:11px;color:var(--muted-foreground)}
footer{display:flex;gap:10px;align-items:center;margin-top:12px}
footer button{background:var(--primary);border-color:var(--primary);color:var(--primary-foreground);padding:6px 14px;font-size:13px}
footer button:disabled{opacity:.6;cursor:default}
#sent{font-size:12px;color:var(--muted-foreground)}`;

// Plain ES5-ish so it runs in any frame; talks to the hub through `window.t3artifact`.
const SHEET_SCRIPT = `(function(){var a=window.t3artifact,rows=a.rows||[],V=[["pass","Pass"],["fail","Fail"],["skip","Skip"],["blocked","Blocked"]],main=document.getElementById("rows");
document.title=a.title;document.getElementById("title").textContent=a.title;document.getElementById("intro").textContent=a.intro||"";
function st(id){var s=a.state&&a.state.rows;return(s&&s[id])||{};}
function tally(){var c={pass:0,fail:0,skip:0,blocked:0},d=0;rows.forEach(function(r){var s=st(r.id).status;if(s){c[s]++;d++;}});document.getElementById("tally").textContent=d+" of "+rows.length+" done · "+c.pass+" passed · "+c.fail+" failed"+(c.blocked?" · "+c.blocked+" blocked":"")+(c.skip?" · "+c.skip+" skipped":"");}
function when(t){try{return new Date(t).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}catch(e){return"";}}
function render(){var focus=document.activeElement&&document.activeElement.dataset.row,group=null;main.textContent="";rows.forEach(function(r){if(r.group&&r.group!==group){group=r.group;var h=document.createElement("h2");h.textContent=group;main.appendChild(h);}var s=st(r.id),el=document.createElement("section");el.className="row";if(s.status)el.dataset.status=s.status;
var top=document.createElement("div");top.className="top";var what=document.createElement("div");what.className="what";var t=document.createElement("div");t.className="title";t.textContent=r.title;what.appendChild(t);if(r.detail){var d=document.createElement("div");d.className="detail";d.textContent=r.detail;what.appendChild(d);}top.appendChild(what);
var ch=document.createElement("div");ch.className="choices";ch.setAttribute("role","group");ch.setAttribute("aria-label","Result for "+r.title);V.forEach(function(v){var b=document.createElement("button");b.type="button";b.dataset.v=v[0];b.textContent=(s.status===v[0]?"✓ ":"")+v[1];b.setAttribute("aria-pressed",String(s.status===v[0]));b.onclick=function(){var p={};p[r.id]={status:s.status===v[0]?null:v[0]};save(p);};ch.appendChild(b);});top.appendChild(ch);el.appendChild(top);
var n=document.createElement("textarea");n.placeholder="Note (what you saw, steps, links)";n.value=s.note||"";n.dataset.row=r.id;n.setAttribute("aria-label","Note for "+r.title);n.onchange=function(){var p={};p[r.id]={note:n.value};save(p);};el.appendChild(n);
if(s.by){var by=document.createElement("div");by.className="by";by.textContent=s.by+" · "+when(s.at);el.appendChild(by);}main.appendChild(el);});
if(focus){var f=main.querySelector('textarea[data-row="'+focus.replace(/"/g,"")+'"]');if(f)f.focus();}tally();}
function save(p){a.save({rows:p}).then(render,function(){document.getElementById("sent").textContent="Couldn't save. Check your connection and try again.";});}
a.onChange(function(){if(!(document.activeElement&&document.activeElement.tagName==="TEXTAREA"))render();});
document.getElementById("submit").onclick=function(){var b=this,c={pass:[],fail:[],skip:[],blocked:[],open:[]};rows.forEach(function(r){var s=st(r.id);(c[s.status]||c.open).push(r.id);});b.disabled=true;
var text="Results for "+a.title+": "+c.pass.length+" passed, "+c.fail.length+" failed"+(c.blocked.length?", "+c.blocked.length+" blocked":"")+(c.open.length?", "+c.open.length+" not done":"")+".";
a.submit(text,{artifact:a.id,failed:c.fail,blocked:c.blocked,notDone:c.open}).then(function(r){document.getElementById("sent").textContent=r.chat?"Sent to the agent.":"Saved. Tell the agent in its chat, or it will see this next time it checks.";b.disabled=false;},function(){document.getElementById("sent").textContent="Couldn't submit. Try again.";b.disabled=false;});};
render();})();`;
