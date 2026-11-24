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
<header><div class="in-t3" id="in-t3" hidden><span>Test this in T3: the app in T3's browser beside the sheet, the chat that built it, and its terminal on that machine.</span><a id="test-page" href="#">Open the Test page →</a></div><h1 id="title"></h1>
<section class="app" id="app" hidden><div class="app-line"><span class="label">App</span><a id="app-link" href="#"></a></div>
<div class="app-line" id="start-line" hidden><span class="label" id="start-label">If it doesn't load, start it:</span><code id="start"></code><button type="button" id="copy">Copy</button></div></section>
<details class="intro-box" id="intro-box" open><summary>About this test</summary><p class="intro" id="intro"></p></details><p class="tally" id="tally"></p>
<div class="retests" id="retests" hidden><span><b id="retest-count"></b> fixed by the chat and ready to re-test.</span><label><input type="checkbox" id="only-retests"> Show only these</label></div></header>
<main id="rows"></main>
<footer id="foot"><div class="foot-line"><div class="sum" id="sum"></div><button type="button" class="quiet" id="next" title="Next unchecked">Next ↓</button></div>
<div class="foot-line"><button type="button" id="submit">Send results</button><span id="sent" role="status"></span><details id="note-box"><summary>Note for the chat</summary><textarea id="overall" aria-label="Note for the chat" placeholder="Anything about the whole test: what to change, what worked, what to look at next."></textarea></details></div></footer>
<script>${SHEET_SCRIPT}</script></body></html>`);
}

const SHEET_CSS = `
body{padding:14px 16px 18px;max-width:960px}
h1{font-size:16px;margin:0 0 4px}
.intro{margin:0 0 6px;color:var(--muted-foreground);white-space:pre-wrap}
.intro:empty{display:none}.intro-box>summary{cursor:pointer;color:var(--muted-foreground);font-size:12px;margin-bottom:4px}
.hosted #title,.hosted #app{display:none}
.tally{margin:0 0 12px;color:var(--muted-foreground);font-size:12px}
.app{border:1px solid var(--border);border-radius:var(--radius,8px);background:var(--card);padding:8px 12px;margin:6px 0 8px;display:flex;flex-direction:column;gap:6px}
.app[hidden],.app-line[hidden]{display:none}
.app-line{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;min-width:0}
.label{font-size:12px;color:var(--muted-foreground)}
.app a{font-weight:600;word-break:break-all}
a{color:var(--primary)}
code{font-size:12px;background:var(--code-background,var(--muted));color:var(--code-foreground,var(--foreground));padding:2px 6px;border-radius:4px;word-break:break-all;user-select:all}
#copy{font:inherit;font-size:12px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--foreground);padding:1px 8px;cursor:pointer}
.links{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:4px;font-size:13px}
.links a{word-break:break-all}
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
.shots{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.shots img{max-height:96px;max-width:160px;border:1px solid var(--border);border-radius:6px;display:block}
textarea{display:block;box-sizing:border-box;width:100%;margin-top:8px;font:inherit;font-size:13px;color:var(--foreground);background:var(--background);border:1px solid var(--border);border-radius:6px;padding:6px 8px;min-height:34px;resize:vertical}
.by{margin-top:4px;font-size:11px;color:var(--muted-foreground)}
footer{position:sticky;bottom:0;display:flex;flex-direction:column;gap:5px;margin:12px -16px -18px;padding:6px 12px 8px;background:var(--background);border-top:1px solid var(--border)}
.foot-line{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.sum{flex:1;min-width:0;font-size:12px;color:var(--muted-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sum b{font-weight:600}.sum .fail{color:var(--destructive)}.sum .retest{color:var(--primary)}
.chip{font-size:12px;border-radius:999px;padding:2px 9px;background:var(--muted);color:var(--foreground)}
.chip.pass{background:color-mix(in srgb,var(--success) 15%,transparent)}
.chip.fail{background:color-mix(in srgb,var(--destructive) 15%,transparent)}
.chip.blocked{background:color-mix(in srgb,var(--warning) 20%,transparent)}
.chip.retest{background:color-mix(in srgb,var(--primary) 15%,transparent)}
footer #submit{font:inherit;font-size:13px;font-weight:600;border:1px solid var(--primary);border-radius:6px;background:var(--primary);color:var(--primary-foreground);padding:5px 12px;cursor:pointer}
footer #submit:disabled{opacity:.6;cursor:default}
footer .quiet{font:inherit;font-size:12px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--foreground);padding:3px 9px;cursor:pointer}
#note-box summary{cursor:pointer;font-size:12px;color:var(--muted-foreground)}
#note-box textarea{min-height:56px}#note-box[open]{flex-basis:100%;order:3}
#sent{font-size:12px;color:var(--muted-foreground);flex:1}
#sent.ok{color:var(--foreground)}
.retests{display:flex;gap:10px;align-items:center;flex-wrap:wrap;border:1px solid var(--primary);border-radius:var(--radius,8px);background:color-mix(in srgb,var(--primary) 8%,transparent);padding:8px 12px;margin:0 0 10px;font-size:13px}
.retests[hidden]{display:none}
.retests label{display:flex;gap:6px;align-items:center;cursor:pointer;margin-left:auto}
.badge{display:inline-block;margin-left:6px;font-size:11px;font-weight:600;border-radius:4px;padding:0 6px;background:var(--primary);color:var(--primary-foreground);vertical-align:1px}
.fixed{margin-top:6px;font-size:13px;border-left:3px solid var(--primary);padding:2px 0 2px 8px;white-space:pre-wrap}
.before{margin-top:4px;font-size:12px;color:var(--muted-foreground)}
.row.flash{outline:2px solid var(--primary)}
.in-t3{display:flex;gap:10px;align-items:center;flex-wrap:wrap;border:1px solid var(--border);border-radius:var(--radius,8px);background:var(--card);padding:8px 12px;margin:0 0 10px;font-size:13px}
.in-t3[hidden]{display:none}
.in-t3 span{flex:1 1 280px;color:var(--muted-foreground)}
.in-t3 a{font-weight:600;white-space:nowrap}`;

// Plain ES5-ish so it runs in any frame; talks to the hub through `window.t3artifact`. A host page
// that says it opens links (the Board's Test page) gets each link click, to show in its browser.
const SHEET_SCRIPT = `(function(){var a=window.t3artifact,rows=a.rows||[],V=[["pass","Pass"],["fail","Fail"],["skip","Skip"],["blocked","Blocked"]],main=document.getElementById("rows");
var hostOpens=false;addEventListener("message",function(e){if(e.source===parent&&e.data&&e.data.type==="t3-host:opens-links"){hostOpens=true;document.body.classList.add("hosted");document.getElementById("intro-box").open=false;}});
document.addEventListener("click",function(e){if(!hostOpens||window.parent===window)return;var x=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!x||!/^https?:/.test(x.getAttribute("href")||""))return;e.preventDefault();parent.postMessage({type:"t3-page:open",url:x.href},"*");},true);
document.title=a.title;document.getElementById("title").textContent=a.title;document.getElementById("intro").textContent=a.intro||"";if(!a.intro)document.getElementById("intro-box").hidden=true;
function short(u){try{var x=new URL(u);var t=x.host+(x.pathname==="/"?"":x.pathname)+x.search+x.hash;return t.length>90?t.slice(0,87)+"…":t;}catch(e){return u;}}
if(a.app){document.getElementById("app").hidden=false;var al=document.getElementById("app-link");al.href=a.app.url;al.target="_blank";al.rel="noopener";al.textContent=short(a.app.url);
if(a.app.start){document.getElementById("start-line").hidden=false;document.getElementById("start").textContent=a.app.start;if(a.app.machine)document.getElementById("start-label").textContent="If it doesn't load, start it on "+a.app.machine+":";
document.getElementById("copy").onclick=function(){var b=this,c=document.getElementById("start");function sel(){var r=document.createRange();r.selectNodeContents(c);var w=getSelection();w.removeAllRanges();w.addRange(r);b.textContent="Selected: press Ctrl+C";}
try{navigator.clipboard.writeText(a.app.start).then(function(){b.textContent="Copied";},sel);}catch(e){sel();}};}}
function linkify(el,text){var re=/https?:\\/\\/[^\\s<>"')\\]]+/g,i=0,m;while((m=re.exec(text))){if(m.index>i)el.appendChild(document.createTextNode(text.slice(i,m.index)));var x=document.createElement("a");x.href=m[0];x.target="_blank";x.rel="noopener";x.textContent=short(m[0]);el.appendChild(x);i=m.index+m[0].length;}if(i<text.length)el.appendChild(document.createTextNode(text.slice(i)));}
function st(id){var s=a.state&&a.state.rows;return(s&&s[id])||{};}
var hosted=window.parent!==window,onlyRetests=null;
// Opened on its own (a link from a chat): point to the Board's Test page, where T3 hosts it with a terminal and browser.
if(!hosted&&/^https?:/.test(location.protocol+"//")){var tp=document.getElementById("test-page");tp.href=location.origin+"/board#desk=test&sheet="+encodeURIComponent(a.id);document.getElementById("in-t3").hidden=false;}
function retestsLeft(){return rows.filter(function(r){return r.retest&&!st(r.id).status;}).length;}
function tally(){var c={pass:0,fail:0,skip:0,blocked:0},d=0;rows.forEach(function(r){var s=st(r.id).status;if(s){c[s]++;d++;}});var open=rows.length-d,rl=retestsLeft();
document.getElementById("tally").textContent=d+" of "+rows.length+" done · "+c.pass+" passed · "+c.fail+" failed"+(c.blocked?" · "+c.blocked+" blocked":"")+(c.skip?" · "+c.skip+" skipped":"");
var sum=document.getElementById("sum");sum.textContent="";[["pass",c.pass+" passed"],["fail",c.fail?c.fail+" failed":""],["blocked",c.blocked?c.blocked+" blocked":""],["skip",c.skip?c.skip+" skipped":""],["retest",rl?rl+" to re-test":""],["open",open?open+" left":""]].filter(function(x){return x[1];}).forEach(function(x,i){if(i)sum.appendChild(document.createTextNode(" · "));var e=document.createElement("span");e.className=x[0];e.textContent=x[1];sum.appendChild(e);});
document.getElementById("next").hidden=!open;
document.getElementById("submit").textContent=(hosted?"Send results":"Save results")+(open?" ("+open+" not checked)":"");
var rb=document.getElementById("retests");rb.hidden=!rl;document.getElementById("retest-count").textContent=rl===1?"1 check was":rl+" checks were";}
function when(t){try{return new Date(t).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}catch(e){return"";}}
function render(){var focus=document.activeElement&&document.activeElement.dataset.row,group=null;main.textContent="";if(onlyRetests===null)onlyRetests=retestsLeft()>0;document.getElementById("only-retests").checked=onlyRetests;rows.forEach(function(r){if(onlyRetests&&!r.retest)return;if(r.group&&r.group!==group){group=r.group;var h=document.createElement("h2");h.textContent=group;main.appendChild(h);}var s=st(r.id),el=document.createElement("section");el.className="row";el.dataset.row=r.id;if(s.status)el.dataset.status=s.status;
var top=document.createElement("div");top.className="top";var what=document.createElement("div");what.className="what";var t=document.createElement("div");t.className="title";t.textContent=r.title;if(r.retest){var bg=document.createElement("span");bg.className="badge";bg.textContent=s.status?"Re-tested":"Retest";t.appendChild(bg);}what.appendChild(t);
if(r.retest){var fx=document.createElement("div");fx.className="fixed";linkify(fx,(/^fixed\\b/i.test(r.retest)?"":"Fixed: ")+r.retest);what.appendChild(fx);}
if(s.previous&&s.previous.status){var bf=document.createElement("div");bf.className="before";var pn=(s.previous.note||"").replace(/!\\[[^\\]]*\\]\\([^)]*\\)/g,"[screenshot]").replace(/\\s+/g," ").trim();bf.textContent="Before: "+({pass:"passed",fail:"failed",skip:"skipped",blocked:"blocked"}[s.previous.status]||s.previous.status)+(pn?" · "+(pn.length>160?pn.slice(0,157)+"…":pn):"")+(s.previous.at?" ("+when(s.previous.at)+")":"");what.appendChild(bf);}
if(r.detail){var d=document.createElement("div");d.className="detail";linkify(d,r.detail);what.appendChild(d);}
if(r.links&&r.links.length){var ls=document.createElement("div");ls.className="links";r.links.forEach(function(l){var x=document.createElement("a");x.href=l.url;x.target="_blank";x.rel="noopener";x.textContent=l.label||short(l.url);ls.appendChild(x);});what.appendChild(ls);}top.appendChild(what);
var ch=document.createElement("div");ch.className="choices";ch.setAttribute("role","group");ch.setAttribute("aria-label","Result for "+r.title);V.forEach(function(v){var b=document.createElement("button");b.type="button";b.dataset.v=v[0];b.textContent=(s.status===v[0]?"✓ ":"")+v[1];b.setAttribute("aria-pressed",String(s.status===v[0]));b.onclick=function(){var p={};p[r.id]={status:s.status===v[0]?null:v[0]};save(p);};ch.appendChild(b);});top.appendChild(ch);el.appendChild(top);
var n=document.createElement("textarea");n.placeholder="Note (what you saw, steps, links). Paste or drop a screenshot.";n.value=s.note||"";n.dataset.row=r.id;n.setAttribute("aria-label","Note for "+r.title);n.onchange=function(){var p={};p[r.id]={note:n.value};save(p);};
function attach(files){var imgs=[].slice.call(files||[]).filter(function(f){return /^image\\//.test(f.type);});if(!imgs.length||!a.upload)return false;imgs.forEach(function(f){var mark="[uploading "+(f.name||"screenshot")+"…]";n.value=(n.value?n.value.replace(/\\s*$/,"")+"\\n":"")+mark;a.upload(f).then(function(url){n.value=n.value.replace(mark,"![screenshot]("+url+")");var p={};p[r.id]={note:n.value};save(p);},function(e){n.value=n.value.replace(mark,"");document.getElementById("sent").textContent="Couldn't attach the picture: "+e.message;});});return true;}
n.onpaste=function(e){if(attach(e.clipboardData&&e.clipboardData.files))e.preventDefault();};n.ondragover=function(e){e.preventDefault();};n.ondrop=function(e){if(attach(e.dataTransfer&&e.dataTransfer.files))e.preventDefault();};el.appendChild(n);
var shots=[],re=/!\\[[^\\]]*\\]\\(([^)\\s]+)\\)/g,m;while((m=re.exec(s.note||"")))shots.push(m[1]);if(shots.length){var sh=document.createElement("div");sh.className="shots";shots.forEach(function(u){var x=document.createElement("a");x.href=u;x.target="_blank";x.rel="noopener";var im=document.createElement("img");im.src=u;im.alt="Screenshot";x.appendChild(im);sh.appendChild(x);});el.appendChild(sh);}
if(s.by){var by=document.createElement("div");by.className="by";by.textContent=s.by+" · "+when(s.at);el.appendChild(by);}main.appendChild(el);});
if(focus){var f=main.querySelector('textarea[data-row="'+focus.replace(/"/g,"")+'"]');if(f)f.focus();}tally();}
function save(p){a.save({rows:p}).then(render,function(){document.getElementById("sent").textContent="Couldn't save. Check your connection and try again.";});}
a.onChange(function(){if(!(document.activeElement&&document.activeElement.tagName==="TEXTAREA"))render();});
document.getElementById("only-retests").onchange=function(){onlyRetests=this.checked;render();};
document.getElementById("next").onclick=function(){var x=null;rows.some(function(r){if(!st(r.id).status&&(!onlyRetests||r.retest)){x=main.querySelector('section[data-row="'+r.id.replace(/"/g,"")+'"]');return!!x;}return false;});if(!x&&onlyRetests){onlyRetests=false;render();return this.onclick();}if(x){x.scrollIntoView({behavior:"smooth",block:"center"});x.classList.add("flash");setTimeout(function(){x.classList.remove("flash");},1200);}};
function lastSent(t){var e=document.getElementById("sent");e.className="";e.textContent=t?"Last sent "+when(t)+".":"";}
lastSent(a.submittedAt);
document.getElementById("submit").onclick=function(){var b=this,c={pass:[],fail:[],skip:[],blocked:[],open:[]},retests=[];rows.forEach(function(r){var s=st(r.id);(c[s.status]||c.open).push(r);if(r.retest&&s.previous)retests.push(r.title+": "+(s.status?({pass:"passed now",fail:"still failing",skip:"skipped",blocked:"blocked"}[s.status]):"not re-tested yet"));});b.disabled=true;
function line(r){var n=(st(r.id).note||"").replace(/\\s+/g," ").trim();return"- "+r.title+(n?": "+(n.length>300?n.slice(0,297)+"…":n):"");}
var overall=document.getElementById("overall").value.trim();
var text="Results for "+a.title+": "+c.pass.length+" passed, "+c.fail.length+" failed"+(c.blocked.length?", "+c.blocked.length+" blocked":"")+(c.open.length?", "+c.open.length+" not done":"")+"."+(c.fail.length?"\\n\\nFailed:\\n"+c.fail.map(line).join("\\n"):"")+(c.blocked.length?"\\n\\nBlocked:\\n"+c.blocked.map(line).join("\\n"):"")+(retests.length?"\\n\\nRe-tests:\\n- "+retests.join("\\n- "):"")+(overall?"\\n\\nRigo's note: "+overall:"");
a.submit(text,{artifact:a.id,failed:c.fail.map(function(r){return r.id;}),blocked:c.blocked.map(function(r){return r.id;}),notDone:c.open.map(function(r){return r.id;})}).then(function(r){var e=document.getElementById("sent"),now=new Date().toISOString();e.className="ok";e.textContent=r.chat?"✓ Sent to the chat "+when(now)+". "+(c.fail.length||c.blocked.length?"It fixes what failed and sends those checks back marked Retest: they show here and in Needs you.":"Nothing failed: it ticks the criteria and wraps up."):"✓ Saved "+when(now)+". The chat reads it the next time it checks; to send it now, open this sheet from the Board's Test page.";document.getElementById("overall").value="";b.disabled=false;},function(){var e=document.getElementById("sent");e.className="";e.textContent="Couldn't send. Check your connection and try again.";b.disabled=false;});};
render();})();`;
