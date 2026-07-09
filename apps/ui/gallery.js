// gallery.js — Holo UI component browser. Three regions: a left rail (search · library · categories),
// a center grid that lets you browse a category's components as live preview cards, and a right detail
// panel that inspects one component (Preview · Code · Import by content address). All driven by
// registry/index.json, so it scales as the catalog grows. Previews load lazily, on scroll (lean).
import * as React from "react";
import { createRoot } from "react-dom/client";
const h = React.createElement;
const root = document.documentElement;

// ── live theme control (drive Holo UI when present, else set tokens directly) ──
const UI = window.HoloUI;
const set = {
  palette: (p) => (UI?.setPalette ? UI.setPalette(p) : root.setAttribute("data-holo-palette", p)),
  presentation: (p) => (UI?.setPresentation ? UI.setPresentation(p) : root.setAttribute("data-holo-presentation", p)),
};
const THEMES = [
  { id: "light", apply: () => { set.palette("light"); set.presentation("standard"); } },
  { id: "dark", apply: () => { set.palette("dark"); set.presentation("standard"); } },
  { id: "immersive", apply: () => { set.palette("dark"); set.presentation("immersive"); } },
];

const pascal = (n) => n.split(/[-_]/).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
const pretty = (n) => n.split(/[-_]/).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
const LIB_LABEL = { shadcn: "shadcn/ui", magicui: "Magic UI", holo: "Holo Primitives", daisyui: "daisyUI" };
const CAT_ORDER = ["Buttons & Actions", "Forms & Inputs", "Navigation", "Overlays", "Feedback", "Data Display", "Layout",
  "Buttons", "Text", "Backgrounds", "Special Effects", "Components", "Device Mocks",
  "Blocks", "Charts · Area", "Charts · Bar", "Charts · Line", "Charts · Pie", "Charts · Radar", "Charts · Radial",
  "Charts · Tooltip", "Examples", "Other"];
const catRank = (c) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? CAT_ORDER.length : i; };

// ── curated previews for the common shadcn primitives; everything else mounts generically ──
const row = { display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", justifyContent: "center" };
const rowMid = { display: "inline-flex", gap: "0.5rem", alignItems: "center" };
const col = { display: "flex", flexDirection: "column", gap: "0.6rem" };
const btn = (m) => m.Button || "button";
const EX = {
  button: (m) => h("div", { style: row }, ["default", "secondary", "outline", "ghost", "destructive"].map((v) =>
    h(m.Button, { key: v, variant: v }, pretty(v)))),
  badge: (m) => h("div", { style: row }, ["default", "secondary", "outline", "destructive"].map((v) =>
    h(m.Badge, { key: v, variant: v }, pretty(v)))),
  input: (m) => h(m.Input, { placeholder: "Type here…", style: { width: "18rem" } }),
  textarea: (m) => h(m.Textarea, { placeholder: "Write something…", rows: 4, style: { width: "20rem" } }),
  label: (m) => h("div", { style: col }, h(m.Label, null, "Email"), m.__input && h(m.__input, {})),
  checkbox: (m) => h("label", { style: rowMid }, h(m.Checkbox, { defaultChecked: true }), " Accept terms"),
  switch: (m) => h("label", { style: rowMid }, h(m.Switch, { defaultChecked: true }), " Wireless"),
  slider: (m) => h(m.Slider, { defaultValue: [50], max: 100, step: 1, style: { width: "18rem" } }),
  progress: (m) => h(m.Progress, { value: 62, style: { width: "18rem" } }),
  skeleton: (m) => h("div", { style: col }, h(m.Skeleton, { style: { width: "14rem", height: "1.2rem" } }),
    h(m.Skeleton, { style: { width: "10rem", height: "1.2rem" } })),
  separator: (m) => h("div", { style: { width: "16rem" } }, "Above", h(m.Separator, { style: { margin: "12px 0" } }), "Below"),
  avatar: (m) => h(m.Avatar, null, h(m.AvatarFallback, null, "HO")),
  card: (m) => h(m.Card, { style: { width: "18rem" } },
    h(m.CardHeader, null, h(m.CardTitle, null, "Surface"), h(m.CardDescription, null, "A bounded region of meaning.")),
    h(m.CardContent, null, "Content follows the theme."),
    m.CardFooter && h(m.CardFooter, null, "Footer")),
  tabs: (m) => h(m.Tabs, { defaultValue: "a", style: { width: "20rem" } },
    h(m.TabsList, null, h(m.TabsTrigger, { value: "a" }, "Overview"), h(m.TabsTrigger, { value: "b" }, "Detail")),
    h(m.TabsContent, { value: "a" }, "A calm summary."), h(m.TabsContent, { value: "b" }, "The fuller story.")),
  accordion: (m) => h(m.Accordion, { type: "single", collapsible: true, style: { width: "20rem" } },
    h(m.AccordionItem, { value: "1" }, h(m.AccordionTrigger, null, "What is this?"), h(m.AccordionContent, null, "A content-addressed component."))),
  alert: (m) => h(m.Alert, { style: { width: "22rem" } }, h(m.AlertTitle, null, "Heads up"), h(m.AlertDescription, null, "Calm, useful, never loud.")),
  dialog: (m) => h(m.Dialog, null, h(m.DialogTrigger, { asChild: true }, h(btn(m), null, "Open dialog")),
    h(m.DialogContent, null, h(m.DialogHeader, null, h(m.DialogTitle, null, "Confirm"), h(m.DialogDescription, null, "A focused, dismissible moment.")))),
  "alert-dialog": (m) => h(m.AlertDialog, null, h(m.AlertDialogTrigger, { asChild: true }, h("button", { className: "px-4 py-2 rounded-md border" }, "Delete")),
    h(m.AlertDialogContent, null, h(m.AlertDialogHeader, null, h(m.AlertDialogTitle, null, "Are you sure?"), h(m.AlertDialogDescription, null, "This cannot be undone.")),
      h(m.AlertDialogFooter, null, h(m.AlertDialogCancel, null, "Cancel"), h(m.AlertDialogAction, null, "Continue")))),
  tooltip: (m) => h(m.TooltipProvider, null, h(m.Tooltip, null, h(m.TooltipTrigger, { asChild: true }, h("button", { className: "px-4 py-2 rounded-md border" }, "Hover me")),
    h(m.TooltipContent, null, "A quiet hint."))),
  popover: (m) => h(m.Popover, null, h(m.PopoverTrigger, { asChild: true }, h("button", { className: "px-4 py-2 rounded-md border" }, "Open")),
    h(m.PopoverContent, null, "Popover content lives here.")),
  "hover-card": (m) => h(m.HoverCard, null, h(m.HoverCardTrigger, { asChild: true }, h("button", { className: "px-4 py-2 rounded-md border" }, "Hover")),
    h(m.HoverCardContent, null, "Revealed on hover.")),
  select: (m) => h(m.Select, null, h(m.SelectTrigger, { style: { width: "14rem" } }, h(m.SelectValue, { placeholder: "Pick one" })),
    h(m.SelectContent, null, ["One", "Two", "Three"].map((o) => h(m.SelectItem, { key: o, value: o }, o)))),
  "radio-group": (m) => h(m.RadioGroup, { defaultValue: "a" }, ["a", "b"].map((v) =>
    h("label", { key: v, style: rowMid }, h(m.RadioGroupItem, { value: v }), " Option ", v.toUpperCase()))),
  table: (m) => h(m.Table, { style: { width: "24rem" } }, h(m.TableHeader, null, h(m.TableRow, null, h(m.TableHead, null, "Name"), h(m.TableHead, null, "κ"))),
    h(m.TableBody, null, [["button", "cc36…"], ["card", "c48d…"]].map((r) => h(m.TableRow, { key: r[0] }, h(m.TableCell, null, r[0]), h(m.TableCell, null, r[1]))))),
  breadcrumb: (m) => h(m.Breadcrumb, null, h(m.BreadcrumbList, null,
    h(m.BreadcrumbItem, null, h(m.BreadcrumbLink, { href: "#" }, "Home")), h(m.BreadcrumbSeparator, null),
    h(m.BreadcrumbItem, null, h(m.BreadcrumbPage, null, "Components")))),
  "dropdown-menu": (m) => h(m.DropdownMenu, null, h(m.DropdownMenuTrigger, { asChild: true }, h("button", { className: "px-4 py-2 rounded-md border" }, "Menu")),
    h(m.DropdownMenuContent, null, h(m.DropdownMenuLabel, null, "Actions"), h(m.DropdownMenuSeparator, null),
      ["Edit", "Share", "Delete"].map((o) => h(m.DropdownMenuItem, { key: o }, o)))),
  toggle: (m) => h(m.Toggle, null, "Bold"),
  "toggle-group": (m) => h(m.ToggleGroup, { type: "single", defaultValue: "b" },
    ["a", "b", "c"].map((v) => h(m.ToggleGroupItem, { key: v, value: v }, v.toUpperCase()))),
  "button-group": (m) => h(m.ButtonGroup, null, ["One", "Two", "Three"].map((t) =>
    h("button", { key: t, className: "px-3 py-2 border" }, t))),
  kbd: (m) => h(m.Kbd, null, "⌘ K"),
  spinner: (m) => h(m.Spinner, null),
  "aspect-ratio": (m) => h("div", { style: { width: "16rem" } }, h(m.AspectRatio, { ratio: 16 / 9 },
    h("div", { style: { width: "100%", height: "100%", background: "var(--holo-surface-2)", borderRadius: "var(--holo-radius)", display: "grid", placeItems: "center" } }, "16 : 9"))),
};

// ── daisyUI previews ──────────────────────────────────────────────────────────────────────────────
// daisyUI components are CSS class layers (not React modules), so they can't be import()'d like the
// shadcn/Magic UI modules — they're rendered as canonical class-based markup against the vendored
// daisyui.css. Layout/sizing uses inline styles (no Tailwind utility runtime); the component identity
// comes entirely from daisyUI's own classes + its --color-* theme vars. Keyed by the bare component
// name (the registry name minus the "daisyui-" prefix). Anything unmapped falls back to its base class.
const DAISY_HTML = {
  button: `<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;justify-content:center">
    <button class="btn">Button</button><button class="btn btn-primary">Primary</button>
    <button class="btn btn-secondary">Secondary</button><button class="btn btn-accent">Accent</button>
    <button class="btn btn-outline">Outline</button><button class="btn btn-ghost">Ghost</button></div>`,
  badge: `<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;justify-content:center">
    <span class="badge">Badge</span><span class="badge badge-primary">Primary</span>
    <span class="badge badge-secondary">Secondary</span><span class="badge badge-accent">Accent</span>
    <span class="badge badge-outline">Outline</span></div>`,
  alert: `<div class="alert alert-info" style="max-width:24rem"><span>New software update available.</span></div>`,
  card: `<div class="card" style="width:18rem;background:var(--color-base-100);box-shadow:0 1px 4px rgba(0,0,0,.25)">
    <div class="card-body"><h2 class="card-title">Surface</h2><p>A bounded region of meaning.</p>
    <div class="card-actions" style="justify-content:flex-end"><button class="btn btn-primary btn-sm">Action</button></div></div></div>`,
  input: `<input class="input" placeholder="Type here…" style="width:18rem" />`,
  textarea: `<textarea class="textarea" placeholder="Write something…" style="width:18rem" rows="3"></textarea>`,
  select: `<select class="select" style="width:14rem"><option disabled selected>Pick one</option><option>One</option><option>Two</option></select>`,
  "file-input": `<input type="file" class="file-input" style="width:16rem" />`,
  fileinput: `<input type="file" class="file-input" style="width:16rem" />`,
  checkbox: `<div style="display:flex;gap:.6rem;align-items:center"><input type="checkbox" class="checkbox" checked />
    <input type="checkbox" class="checkbox checkbox-primary" checked /><input type="checkbox" class="checkbox checkbox-secondary" /></div>`,
  radio: `<div style="display:flex;gap:.6rem;align-items:center"><input type="radio" name="dr" class="radio" checked />
    <input type="radio" name="dr" class="radio radio-primary" /><input type="radio" name="dr" class="radio radio-secondary" /></div>`,
  toggle: `<div style="display:flex;gap:.6rem;align-items:center"><input type="checkbox" class="toggle" checked />
    <input type="checkbox" class="toggle toggle-primary" checked /><input type="checkbox" class="toggle toggle-accent" /></div>`,
  range: `<input type="range" min="0" max="100" value="55" class="range range-primary" style="width:16rem" />`,
  progress: `<progress class="progress progress-primary" value="62" max="100" style="width:16rem"></progress>`,
  radialprogress: `<div class="radial-progress" style="--value:70;color:var(--color-primary)" role="progressbar">70%</div>`,
  loading: `<div style="display:flex;gap:1rem;align-items:center">
    <span class="loading loading-spinner loading-md"></span><span class="loading loading-dots loading-md"></span>
    <span class="loading loading-ring loading-md"></span><span class="loading loading-bars loading-md"></span></div>`,
  skeleton: `<div style="display:flex;flex-direction:column;gap:.5rem">
    <div class="skeleton" style="width:14rem;height:1.2rem"></div><div class="skeleton" style="width:10rem;height:1.2rem"></div></div>`,
  kbd: `<div style="display:flex;gap:.3rem;align-items:center"><kbd class="kbd">⌘</kbd><kbd class="kbd">K</kbd></div>`,
  link: `<a class="link link-primary">A quiet, content-addressed link</a>`,
  avatar: `<div class="avatar avatar-placeholder"><div style="width:3.5rem;height:3.5rem;border-radius:9999px;background:var(--color-neutral);color:var(--color-neutral-content);display:grid;place-items:center">HO</div></div>`,
  badgeicon: ``,
  breadcrumbs: `<div class="breadcrumbs" style="font-size:.9rem"><ul><li><a>Home</a></li><li><a>Components</a></li><li>daisyUI</li></ul></div>`,
  tab: `<div class="tabs tabs-box"><a class="tab">Overview</a><a class="tab tab-active">Detail</a><a class="tab">Settings</a></div>`,
  table: `<table class="table" style="width:22rem"><thead><tr><th>Name</th><th>κ</th></tr></thead>
    <tbody><tr><td>button</td><td>cc36…</td></tr><tr><td>card</td><td>c48d…</td></tr></tbody></table>`,
  menu: `<ul class="menu" style="background:var(--color-base-200);border-radius:.6rem;width:14rem">
    <li><a>Overview</a></li><li><a class="menu-active">Components</a></li><li><a>Appearance</a></li></ul>`,
  steps: `<ul class="steps"><li class="step step-primary">Register</li><li class="step step-primary">Choose</li><li class="step">Pay</li><li class="step">Ship</li></ul>`,
  stat: `<div class="stats" style="box-shadow:0 1px 4px rgba(0,0,0,.25)"><div class="stat"><div class="stat-title">Downloads</div>
    <div class="stat-value">31K</div><div class="stat-desc">↗︎ 12% this week</div></div></div>`,
  status: `<div style="display:flex;gap:.5rem;align-items:center"><span class="status status-success"></span> Online
    <span class="status status-warning" style="margin-left:1rem"></span> Idle</div>`,
  navbar: `<div class="navbar" style="background:var(--color-base-200);border-radius:.6rem;width:20rem">
    <div style="flex:1"><a class="btn btn-ghost">daisyUI</a></div><button class="btn btn-sm btn-primary">Login</button></div>`,
  tooltip: `<div class="tooltip tooltip-open tooltip-primary" data-tip="A quiet hint"><button class="btn">Hover me</button></div>`,
  modal: `<div class="modal-box" style="position:relative;max-width:18rem;box-shadow:0 4px 20px rgba(0,0,0,.35)">
    <h3 style="font-weight:600;font-size:1.05rem">Confirm</h3><p style="padding:.4rem 0">A focused, dismissible moment.</p>
    <div class="modal-action"><button class="btn btn-sm">Cancel</button><button class="btn btn-sm btn-primary">Continue</button></div></div>`,
  dropdown: `<div class="dropdown dropdown-open"><button class="btn">Menu ▾</button>
    <ul class="dropdown-content menu" style="position:relative;margin-top:.4rem;background:var(--color-base-200);border-radius:.6rem;width:11rem;box-shadow:0 4px 16px rgba(0,0,0,.3)">
    <li><a>Edit</a></li><li><a>Share</a></li><li><a>Delete</a></li></ul></div>`,
  indicator: `<div class="indicator"><span class="indicator-item badge badge-primary">9</span><button class="btn">Inbox</button></div>`,
  chat: `<div style="width:18rem"><div class="chat chat-start"><div class="chat-bubble">Is this content-addressed?</div></div>
    <div class="chat chat-end"><div class="chat-bubble chat-bubble-primary">Byte-for-byte.</div></div></div>`,
  collapse: `<div class="collapse" style="background:var(--color-base-200);width:18rem"><input type="checkbox" checked />
    <div class="collapse-title" style="font-weight:600">Click to toggle</div><div class="collapse-content"><p>Hidden, then revealed.</p></div></div>`,
  divider: `<div style="width:16rem"><span>Above</span><div class="divider">OR</div><span>Below</span></div>`,
  swap: `<label class="swap swap-rotate"><input type="checkbox" /><div class="swap-on">ON</div><div class="swap-off">OFF</div></label>`,
  rating: `<div class="rating">${[0,1,2,3,4].map((i)=>`<input type="radio" name="drt" class="mask mask-star-2" style="background:#f5b301" ${i===2?"checked":""} />`).join("")}</div>`,
  mask: `<div style="display:flex;gap:.6rem">
    <div class="mask mask-squircle" style="width:4rem;height:4rem;background:var(--color-primary)"></div>
    <div class="mask mask-hexagon" style="width:4rem;height:4rem;background:var(--color-secondary)"></div>
    <div class="mask mask-heart" style="width:4rem;height:4rem;background:var(--color-accent)"></div></div>`,
  carousel: `<div class="carousel" style="width:16rem;gap:.5rem">
    <div class="carousel-item"><div style="width:8rem;height:6rem;background:var(--color-primary);border-radius:.5rem"></div></div>
    <div class="carousel-item"><div style="width:8rem;height:6rem;background:var(--color-secondary);border-radius:.5rem"></div></div>
    <div class="carousel-item"><div style="width:8rem;height:6rem;background:var(--color-accent);border-radius:.5rem"></div></div></div>`,
  stack: `<div class="stack" style="width:8rem;height:5rem">
    <div style="background:var(--color-primary);color:#fff;border-radius:.5rem;display:grid;place-items:center">1</div>
    <div style="background:var(--color-secondary);border-radius:.5rem"></div><div style="background:var(--color-accent);border-radius:.5rem"></div></div>`,
  list: `<ul class="list" style="background:var(--color-base-200);border-radius:.6rem;width:18rem">
    <li class="list-row"><div>01</div><div class="list-col-grow">Content-addressed</div></li>
    <li class="list-row"><div>02</div><div class="list-col-grow">Self-verifying</div></li></ul>`,
  hero: `<div class="hero" style="background:var(--color-base-200);border-radius:.6rem;width:20rem">
    <div class="hero-content" style="text-align:center"><div><h1 style="font-size:1.4rem;font-weight:700">Hello there</h1>
    <p style="padding:.5rem 0">One system, one set of controls.</p><button class="btn btn-primary btn-sm">Get Started</button></div></div></div>`,
  footer: `<footer class="footer" style="background:var(--color-base-200);padding:1rem;border-radius:.6rem;width:18rem">
    <nav><h6 class="footer-title">Services</h6><a class="link link-hover">Branding</a><a class="link link-hover">Design</a></nav></footer>`,
  fieldset: `<fieldset class="fieldset" style="width:16rem;background:var(--color-base-200);border-radius:.6rem;padding:1rem">
    <legend class="fieldset-legend">Page title</legend><input class="input" placeholder="My awesome page" /><p class="label">Optional</p></fieldset>`,
  countdown: `<span class="countdown" style="font-size:2.2rem;font-variant-numeric:tabular-nums"><span style="--value:42">42</span></span>`,
  mockup: `<div class="mockup-window" style="border:1px solid var(--color-base-300);width:18rem;background:var(--color-base-100)">
    <div style="padding:1.5rem;background:var(--color-base-200);text-align:center">Hello, Hologram!</div></div>`,
  dock: `<div class="dock" style="position:relative;width:18rem;border-radius:.6rem">
    <button class="dock-active"><span class="dock-label">Home</span></button><button><span class="dock-label">Search</span></button>
    <button><span class="dock-label">Settings</span></button></div>`,
  fab: `<div class="fab" style="position:relative"><div tabindex="0" role="button" class="btn btn-circle btn-lg btn-primary" style="font-size:1.4rem">+</div></div>`,
  filter: `<form class="filter"><input class="btn btn-square" type="reset" value="×" /><input class="btn" type="radio" name="dfilter" aria-label="All" />
    <input class="btn" type="radio" name="dfilter" aria-label="New" /><input class="btn" type="radio" name="dfilter" aria-label="Top" /></form>`,
  validator: `<form class="validator" style="width:16rem"><input class="input" type="email" required placeholder="email@site.com" />
    <p class="validator-hint">Enter a valid email address</p></form>`,
  toast: `<div class="toast" style="position:relative"><div class="alert alert-success"><span>Message sent.</span></div></div>`,
  diff: `<figure class="diff" style="width:16rem;height:7rem" tabindex="0"><div class="diff-item-1" role="img">
    <div style="background:var(--color-primary);color:var(--color-primary-content);display:grid;place-items:center;font-weight:700">BEFORE</div></div>
    <div class="diff-item-2" role="img"><div style="background:var(--color-base-300);display:grid;place-items:center;font-weight:700">AFTER</div></div>
    <div class="diff-resizer"></div></figure>`,
  timeline: `<ul class="timeline"><li><div class="timeline-start">2024</div><div class="timeline-middle">●</div>
    <div class="timeline-end timeline-box">Encoded</div><hr/></li><li><hr/><div class="timeline-start">2026</div>
    <div class="timeline-middle">●</div><div class="timeline-end timeline-box">Standardized</div></li></ul>`,
  textrotate: `<span class="text-rotate" style="font-size:1.6rem;font-weight:700;color:var(--color-primary)">daisyUI</span>`,
  // the full daisyui.css bundle object — a small composite, since it's "import the whole library".
  daisyui: `<div style="display:flex;flex-direction:column;gap:.6rem;align-items:center">
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center">
    <button class="btn btn-primary btn-sm">Primary</button><span class="badge badge-secondary">Badge</span>
    <input type="checkbox" class="toggle toggle-accent" checked /></div>
    <progress class="progress progress-primary" value="64" max="100" style="width:14rem"></progress></div>`,
};
// the bare component name (e.g. "button" from "daisyui-button"); base class for unmapped fallbacks.
const daisyName = (n) => n.replace(/^daisyui-/, "");
const DAISY_FALLBACK_CLASS = { calendar: "card", hover3d: "card", hovergallery: "card", label: "label" };
function daisyHTML(name) {
  const base = daisyName(name);
  if (DAISY_HTML[base] != null && DAISY_HTML[base] !== "") return DAISY_HTML[base];
  return `<div class="${DAISY_FALLBACK_CLASS[base] || base}" style="padding:.6rem 1rem">${pretty(base)}</div>`;
}
// display name: daisyUI rows read better without the namespacing prefix (the library chip carries it).
const dispName = (comp) => comp && comp.library === "daisyui" ? pretty(daisyName(comp.name)) : pretty(comp.name);

// ── daisyUI is rendered inside a Shadow DOM ───────────────────────────────────────────────────────
// daisyUI and the gallery's own chrome both use generic class names (.card, .btn-primary, …), and
// daisyUI wraps every rule in @layer while the gallery's chrome CSS is unlayered — so unscoped, the
// gallery would override daisyUI. A shadow root with the vendored daisyui.css as a single shared
// adopted stylesheet isolates each preview completely: daisyUI renders exactly as authored, the 969KB
// sheet is parsed once, and daisyUI's [data-theme=…] selectors (not :root) set the --color-* vars on
// the inner wrapper so light/dark tracks the OS mode.
let _daisySheet;
function daisySheet() {
  if (!_daisySheet) _daisySheet = fetch("./vendor/daisyui/daisyui.css").then((r) => r.text()).then((css) => {
    const s = new CSSStyleSheet(); s.replaceSync(css); return s;
  });
  return _daisySheet;
}
function DaisyPreview({ name, dark }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const host = ref.current; if (!host) return; let alive = true;
    const sr = host.shadowRoot || host.attachShadow({ mode: "open" });
    daisySheet().then((sheet) => {
      if (!alive) return;
      try { sr.adoptedStyleSheets = [sheet]; } catch (e) {}
      sr.innerHTML = `<div data-theme="${dark ? "dark" : "light"}" style="display:grid;place-items:center;gap:.6rem;color:var(--color-base-content)">${daisyHTML(name)}</div>`;
    });
    return () => { alive = false; };
  }, [name, dark]);
  return h("div", { ref });
}
// the copy-paste import for a component. daisyUI is a CSS layer (side-effect import + class), shadcn/Magic
// UI are ES modules with named/default exports — both addressed by the same holo://κ specifier.
function importSnippet(comp) {
  // the single-library standard: a stable holo://ui/<name> specifier the global import map resolves to
  // the component's κ on the OS content route — streamable from any app/tab. (Raw κ shown in the rows.)
  if (comp.library === "daisyui")
    return `import { adoptDaisy } from "holo://ui/runtime";\nawait adoptDaisy(shadowRoot, "${daisyName(comp.name)}");\n\n<button class="btn btn-primary">…</button>`;
  const names = (comp.exports || []).filter((e) => /^[A-Z]/.test(e) && !/Variants$/.test(e));
  return comp.renderExport === "default"
    ? `import ${pascal(comp.name)} from "holo://ui/${comp.name}";`
    : `import { ${names.join(", ")} } from "holo://ui/${comp.name}";`;
}

// ── error boundary so one component can't crash the browser ──
class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidUpdate(prev) { if (prev.k !== this.props.k && this.state.err) this.setState({ err: null }); }
  render() { return this.state.err ? h("div", { className: "fallback" }, this.props.mini ? "No preview" : "This component needs a usage example to preview — open the Code tab to see how it's used.") : this.props.children; }
}

function pickMain(mod, name) {
  const want = pascal(name);
  if (mod[want]) return mod[want];
  const named = Object.keys(mod).filter((k) => /^[A-Z]/.test(k) && !/Variants$/.test(k));
  return named.length ? mod[named[0]] : null;
}

function Preview({ comp, mini }) {
  const name = comp.name;
  const daisy = comp.library === "daisyui";
  const [mod, setMod] = React.useState(null);
  const [missing, setMissing] = React.useState(false);
  React.useEffect(() => {
    if (daisy) return;                                              // CSS class layer — nothing to import()
    let ok = true; setMod(null); setMissing(false);
    // import by CONTENT ADDRESS — the holo:// specifier resolves through the injected import map (+ SRI).
    import(comp.holo).then((m) => ok && setMod(m)).catch(() => ok && setMissing(true));
    return () => { ok = false; };
  }, [comp.holo, daisy]);
  // daisyUI components are CSS class layers — render canonical markup against daisyui.css, isolated in a
  // shadow root (see DaisyPreview) so the gallery's own chrome CSS can't bleed in. No import().
  if (daisy)
    return h("div", { className: "daisy-stage" + (mini ? " mini" : "") }, h(DaisyPreview, { name, dark: isDarkMode() }));
  if (missing) return h("div", { className: "fallback" }, mini ? "Unavailable" : "Module unavailable.");
  if (!mod) return h("div", { className: "fallback" }, mini ? "" : "Loading…");
  let el;
  try {
    // composed elements (blocks · charts · examples) are self-contained — render the entry verbatim.
    if (comp.tier && comp.tier !== "component") {
      const Entry = comp.renderExport === "default" ? mod.default : (mod[comp.renderExport] || mod.default || pickMain(mod, name));
      el = Entry ? h(Entry, {}) : null;
    } else if (EX[name]) el = EX[name](mod);
    else {
      const M = pickMain(mod, name);
      const label = pretty(name);
      const props = { text: label, words: [label, "Holo", "UI"], texts: [label, "Holo", "UI"], value: 72 };
      el = M ? h(M, props, label) : null;
    }
  } catch (e) { el = null; }
  if (!el) return h("div", { className: "fallback" }, mini ? "No preview" : "This component needs a usage example to preview — open the Code tab to see how it's used.");
  return h(Boundary, { k: name, mini }, el);
}

// ── a browse card: mounts its live preview lazily — on scroll (IntersectionObserver) in real browsers,
// with a staggered timer fallback so it mounts everywhere (some embedded/headless views never fire IO). ──
function Card({ comp, active, index, onOpen }) {
  const ref = React.useRef(null);
  const [seen, setSeen] = React.useState(false);
  React.useEffect(() => {
    if (seen) return;
    const el = ref.current;
    let io;
    if (el && "IntersectionObserver" in window) {
      io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "300px" });
      io.observe(el);
    }
    const t = setTimeout(() => setSeen(true), 160 + index * 45);   // ordered fill-in; also the IO safety net
    return () => { io && io.disconnect(); clearTimeout(t); };
  }, [seen, index]);
  const open = () => onOpen(comp);
  return h("div", { ref, className: "card" + (active ? " on" : ""), role: "button", tabIndex: 0, onClick: open,
      onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } } },
    h("div", { className: "card-stage" }, seen ? h(Preview, { comp, mini: true }) : null),
    h("div", { className: "card-foot" },
      h("span", { className: "card-name" }, dispName(comp)),
      h("span", { className: "tier-chip" }, comp.library === "daisyui" ? "daisyui" : comp.tier)));
}

function Code({ comp }) {
  const [src, setSrc] = React.useState("Loading…");
  // daisyUI's verbatim source is the vendored CSS layer; shadcn/Magic UI source is the registry .tsx.
  const url = comp.library === "daisyui"
    ? (comp.name === "daisyui" ? `./vendor/daisyui/daisyui.css` : `./vendor/daisyui/components/${daisyName(comp.name)}.css`)
    : `./registry/src/${comp.name}.tsx`;
  React.useEffect(() => { let ok = true; setSrc("Loading…"); fetch(url).then((r) => r.text()).then((t) => ok && setSrc(t)).catch(() => ok && setSrc("Source unavailable.")); return () => { ok = false; }; }, [url]);
  return h("pre", { className: "code" }, src);
}

function Import({ comp }) {
  const kv = (k, v, cls) => h("div", { className: "kv" }, h("span", { className: "k" }, k), h("code", { className: "v " + (cls || "") }, v));
  return h("div", { className: "import" },
    kv("import specifier (holo://)", comp.holo, "kappa"),
    kv("manifest id (did:holo:)", comp.did),
    kv("integrity (SRI)", comp.integrity),
    kv("source κ · module κ", comp.kappa + "  ·  " + comp.moduleKappa),
    h("div", { className: "kv" }, h("span", { className: "k" }, "resolved by"),
      h("code", { className: "v" }, "browser: import map + SRI   ·   native: holo:// re-derive-or-refuse (Law L5)")));
}

function Detail({ comp, onClose }) {
  const [tab, setTab] = React.useState("preview");
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => { setTab("preview"); }, [comp.name]);
  const snippet = importSnippet(comp);
  const copy = () => { navigator.clipboard?.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1400); };
  return h("section", { className: "detail surface" },
    h("div", { className: "detail-head" },
      h("div", { className: "detail-top" },
        h("h2", null, dispName(comp)),
        h("button", { className: "x", onClick: onClose, title: "Close" }, "✕")),
      h("div", { className: "detail-chips" },
        h("span", { className: "chip" }, LIB_LABEL[comp.library] || comp.library),
        h("span", { className: "chip" }, comp.category))),
    h("div", { className: "tabs" }, ["preview", "code", "import"].map((t) =>
      h("button", { key: t, className: tab === t ? "on" : "", onClick: () => setTab(t) }, pretty(t)))),
    h("div", { className: "detail-body" },
      tab === "preview" ? h("div", { className: "stage" }, h(Preview, { comp }))
        : tab === "code" ? h(Code, { comp })
          : h(Import, { comp })),
    h("div", { className: "detail-foot" },
      h("button", { className: "btn-primary", onClick: copy }, copied ? "Copied ✓" : "Copy import")));
}

// ── Appearance — shadcn-create-style control panel: crisp control cards (rail) + live demo (main) ───
const curVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const isDarkMode = () => { const p = document.documentElement.getAttribute("data-holo-palette"); return p === "dark" || (p !== "light" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches); };
const effHex = (name) => {
  let v = curVar(name);
  const ld = /light-dark\(\s*([^,]+),\s*([^)]+)\)/.exec(v); if (ld) v = (isDarkMode() ? ld[2] : ld[1]).trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  const m = /(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(v); return m ? "#" + [1, 2, 3].map((i) => (+m[i]).toString(16).padStart(2, "0")).join("") : "#5b8cff";
};

// the controls — a column of click-to-expand cards, each showing its CURRENT value + a swatch.
function AppearanceControls() {
  const HT = window.HoloTheme;
  const [themes, setThemes] = React.useState([]);
  React.useEffect(() => { if (HT) HT.listThemes().then(setThemes); }, []);
  if (!HT) return h("div", { className: "empty" }, "Theme engine unavailable.");
  const st = HT.get();
  const accentHex = effHex("--holo-accent");
  const radiusPx = parseInt(curVar("--holo-radius")) || 12;
  const fontName = (() => { const ff = st.fontFamily || ""; if (!ff) return "OS default"; const F = HT.FONTS || {}; for (const k in F) if (F[k] === ff) return k; return ff.split(",")[0].replace(/["']/g, ""); })();
  const activeK = HT.activeThemeKappa ? HT.activeThemeKappa() : null;
  const activeName = (themes.find((t) => t.kappa === activeK) || {}).name || (activeK ? "Custom" : "Holo");
  const accOf = (t) => isDarkMode() ? t.accent.dark : t.accent.light;

  const seg = (opts, v0, on) => h("div", { className: "ctl-seg" }, opts.map(([l, v]) =>
    h("button", { key: String(v), className: v0 === v ? "on" : "", onClick: () => on(v) }, l)));
  const row = (label, control) => h("div", { className: "row" }, h("label", { className: "row-label" }, label), control);

  const shuffle = () => { const t = themes[Math.floor(Math.random() * themes.length)]; if (t) HT.setTheme(t.name); };
  const fork = () => HT.exportTheme().then((t) => { if (!t) return; const ext = t.$extensions && t.$extensions["org.hologram.theme"];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(t, null, 2)], { type: "application/json" }));
    a.download = ((ext && ext.name) || "my-theme").toLowerCase().replace(/\s+/g, "-") + ".tokens.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
  const onImport = (e) => { const f = e.target.files && e.target.files[0]; if (!f) return;
    f.text().then((txt) => HT.importTheme(txt).then((r) => { if (!r.ok) alert("Import failed: " + (r.errors || []).join("; ")); })); e.target.value = ""; };

  return h("div", { className: "ctls" },
    row("Theme", h("div", { className: "theme-chips" }, themes.map((t) =>
      h("button", { key: t.kappa, className: "theme-chip" + (t.kappa === activeK ? " on" : ""), onClick: () => HT.setTheme(t.name) },
        h("span", { className: "chip-dot", style: { background: accOf(t) } }), t.name.replace(/^Holo ?/, "") || "Holo")))),
    row("Appearance", seg([["Auto", "auto"], ["Light", "light"], ["Dark", "dark"]], st.palette, (v) => HT.setPalette(v))),
    row("Accent — " + accentHex.toUpperCase(), h("div", { className: "accent-row" },
      h("input", { className: "ap-color", type: "color", value: accentHex, onInput: (e) => HT.setAccent(e.target.value) }),
      h("div", { className: "ctl-swatches" }, themes.map((t) =>
        h("button", { key: t.kappa, className: "ctl-sw", title: t.name, style: { background: accOf(t) }, onClick: () => HT.setAccent(accOf(t)) }))))),
    row("Radius — " + radiusPx + "px", h("input", { className: "ap-range", type: "range", min: "0", max: "24", step: "1", defaultValue: radiusPx, onInput: (e) => HT.setVar("--holo-radius", e.target.value + "px") })),
    row("Typeface", h("select", { className: "ap-select", value: st.fontFamily || "", onChange: (e) => HT.setFontFamily(e.target.value) },
      h("option", { value: "" }, "OS default"), Object.keys(HT.FONTS || {}).map((n) => h("option", { key: n, value: HT.FONTS[n] }, n)))),
    row("Text size — " + Math.round(st.fontScale * 100) + "%", h("input", { className: "ap-range", type: "range", min: "0.85", max: "1.4", step: "0.05", value: st.fontScale, onInput: (e) => HT.setFontScale(e.target.value) })),
    row("Presentation", seg([["Standard", "standard"], ["Immersive", "immersive"]], st.presentation, (v) => HT.setPresentation(v))),
    row("Minimum text size", seg([["Off", 0], ["14", 14], ["16", 16], ["18", 18], ["20", 20]], st.fontMin, (v) => HT.setFontMin(v))),
    row("Apply to apps", seg([["Respect", false], ["Enforce OS", true]], !!st.enforce, (v) => HT.set({ enforce: v }))),
    h("div", { className: "ctl-actions" },
      h("button", { className: "ctl-btn", onClick: shuffle }, "⤮ Shuffle"),
      h("label", { className: "ctl-btn" }, "⤒ Import", h("input", { type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: onImport })),
      h("button", { className: "ctl-btn", onClick: () => HT.setTheme("Holo") }, "↺ Reset")),
    h("button", { className: "btn-primary", onClick: fork }, "⤓ Export theme"));
}

// the demo — real components themed live, in crisp golden-ratio cards (the "see your theme" surface).
function AppearanceDemo({ items }) {
  const get = (n) => items.find((c) => c.name === n);
  const chart = items.find((c) => c.tier === "chart" && /(^|-)bar/.test(c.name)) || items.find((c) => c.tier === "chart");
  const tile = (title, comp, wide) => h("div", { className: "demo-card" + (wide ? " wide" : "") },
    h("div", { className: "demo-title" }, title),
    h("div", { className: "demo-body" }, comp ? h(Preview, { comp }) : h("div", { className: "fallback" }, "—")));
  return h("div", { className: "demo-grid" },
    tile("Activity", chart, true),
    tile("Buttons", get("button")),
    tile("Surface", get("card")),
    tile("Field", get("input")),
    tile("Badges", get("badge")),
    tile("Toggle", get("switch")));
}

function App({ items }) {
  const [q, setQ] = React.useState("");
  const [lib, setLib] = React.useState("all");
  const [cat, setCat] = React.useState(null);
  const [focused, setFocused] = React.useState(null);
  const [theme, setTheme] = React.useState("dark");
  const [mode, setMode] = React.useState(() => location.hash === "#appearance" ? "appearance" : "components");   // "appearance" | "components"
  const goMode = (m) => { setMode(m); try { history.replaceState(null, "", "#" + m); } catch (e) {} };
  // re-render the whole panel whenever the theme engine reports a change (controls ⇄ live demo stay in sync)
  const [, setRev] = React.useState(0);
  React.useEffect(() => { const el = document.documentElement; const on = () => setRev((x) => x + 1); el.addEventListener("holo-theme-change", on); return () => el.removeEventListener("holo-theme-change", on); }, []);

  // library filter → which items are in play
  const byLib = items.filter((c) => lib === "all" || c.library === lib);
  // categories present (ordered), with counts
  const counts = {}; for (const c of byLib) counts[c.category] = (counts[c.category] || 0) + 1;
  const cats = Object.keys(counts).sort((a, b) => (catRank(a) - catRank(b)) || a.localeCompare(b));
  const activeCat = cat && counts[cat] ? cat : cats[0];

  const query = q.trim().toLowerCase();
  const searching = query.length > 0;
  const shown = searching
    ? byLib.filter((c) => c.name.toLowerCase().includes(query) || c.category.toLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name))
    : byLib.filter((c) => c.category === activeCat).sort((a, b) => a.name.localeCompare(b.name));

  const shuffle = () => { const c = items[Math.floor(Math.random() * items.length)]; setQ(""); setLib("all"); setCat(c.category); setFocused(c); };

  const themesMode = mode === "appearance";
  const rail = h("aside", { className: "rail" },
    h("div", { className: "rail-head" }, h("b", null, "Holo UI"), h("span", { className: "count" }, items.length + " elements")),
    h("div", { className: "seg modeseg" }, [["appearance", "Appearance"], ["components", "Components"]].map(([id, lbl]) =>
      h("button", { key: id, className: mode === id ? "on" : "", onClick: () => goMode(id) }, lbl))),
    themesMode && h(AppearanceControls, null),
    !themesMode && h("input", { className: "search", placeholder: "Search components…", value: q, onChange: (e) => setQ(e.target.value) }),
    !themesMode && h("div", { className: "seg" }, [["all", "All"], ["shadcn", "shadcn"], ["magicui", "Magic"], ["daisyui", "daisyUI"], ["holo", "Holo"]].map(([id, lbl]) =>
      h("button", { key: id, className: lib === id ? "on" : "", onClick: () => { setLib(id); setCat(null); } }, lbl))),
    !themesMode && h("div", { className: "rail-label" }, "Categories"),
    !themesMode && h("div", { className: "cats" }, cats.map((c) =>
      h("button", { key: c, className: "cat-row" + (!searching && c === activeCat ? " on" : ""), onClick: () => { setQ(""); setCat(c); } },
        h("span", { className: "cat-name" }, c),
        h("span", { className: "cat-count" }, counts[c])))),
    !themesMode && h("div", { className: "rail-foot" },
      h("div", { className: "seg" }, THEMES.map((t) =>
        h("button", { key: t.id, className: theme === t.id ? "on" : "", onClick: () => { t.apply(); setTheme(t.id); } }, pretty(t.id)))),
      h("button", { className: "shuffle", onClick: shuffle }, "⤮  Surprise me")));

  const main = themesMode
    ? h("section", { className: "main surface" },
        h("div", { className: "main-head compact" }, h("h1", null, "Live preview"),
          h("p", null, "Real components, themed live. ", h("b", null, "Every control on the left applies across the whole OS."))),
        h("div", { className: "grid-scroll" }, h(AppearanceDemo, { items })))
    : h("section", { className: "main surface" },
        h("div", { className: "main-head" },
          h("h1", null, searching ? "Search" : activeCat),
          h("p", null, h("b", null, shown.length), searching ? ` matches for “${q.trim()}”` : ` ${shown.length === 1 ? "component" : "components"} in this category`)),
        h("div", { className: "grid" }, shown.length
          ? shown.map((c, i) => h(Card, { key: c.tier + "/" + c.name, comp: c, index: i, active: focused?.name === c.name, onOpen: setFocused }))
          : h("div", { className: "empty" }, "Nothing here yet.")));

  return h("div", { className: "app" + (themesMode ? " appearance" : (focused ? " has-detail" : "")) },
    rail, main, !themesMode && focused && h(Detail, { comp: focused, onClose: () => setFocused(null) }));
}

(UI && UI.ready ? UI.ready() : Promise.resolve()).finally(async () => {
  let items = [];
  try { const idx = await fetch("./registry/index.json").then((r) => r.json()); items = idx.components; }
  catch (e) { document.getElementById("holo-ui-root").textContent = "Failed to load registry."; return; }
  items.sort((a, b) => a.name.localeCompare(b.name));
  createRoot(document.getElementById("holo-ui-root")).render(h(App, { items }));
});
