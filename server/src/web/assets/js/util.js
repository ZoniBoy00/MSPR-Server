/* ---------- helpers ---------- */
export function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

/* the admin token (if the viewer entered one) goes with every request; storage may be blocked */
export function adminToken() { try { return localStorage.getItem("mspr-admin") || ""; } catch (e) { return ""; } }

export function get(path) { var t = adminToken(); return fetch(path, { cache: "no-store", headers: t ? { Authorization: "Bearer " + t } : {} }).then(function (r) { if (!r.ok) throw new Error(path + " " + r.status); return r.json(); }); }

export function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }

export function fmtCs(cs) { if (!(cs > 0)) return "-"; return Math.floor(cs / 6000) + ":" + pad(Math.floor((cs % 6000) / 100), 2) + "." + pad(cs % 100, 2); }

export function ordinal(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

export function ago(t) {
  var d = Math.max(0, Math.floor(Date.now() / 1000 - t));
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d / 60) + " min ago";
  if (d < 86400) return Math.floor(d / 3600) + " h ago";
  return Math.floor(d / 86400) + " d ago";
}

export function when(t) { return '<span title="' + esc(new Date(t * 1000).toLocaleString()) + '">' + esc(ago(t)) + "</span>"; }

export function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

export function fmtMs(ms) { return ms == null ? "" : (ms / 1000).toFixed(2) + " s"; }

export function km(v) { return v == null ? "" : v.toFixed(2) + " km"; }
