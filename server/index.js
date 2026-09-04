// Password gate + static host for the built twin (dist/).
//
// The password is checked on the SERVER: the browser never receives the app bundle
// until a valid session cookie is presented, so the gate cannot be bypassed by
// reading the client JavaScript. Sessions are stateless, signed HMAC cookies.
//
// Required environment:
//   APP_PASSWORD    the shared password (no default — the server refuses to start without it)
//   SESSION_SECRET  HMAC key for session cookies (generated per boot if unset; set it in
//                   production so sessions survive restarts)
//   PORT            listen port (Render provides this)

import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");

const PASSWORD = process.env.APP_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const PORT = Number(process.env.PORT) || 10000;

const COOKIE_NAME = "hkdt_session";
const SESSION_HOURS = 12;
const MAX_ATTEMPTS = 10;          // per IP
const ATTEMPT_WINDOW_MS = 15 * 60_000;

// Fail closed: never serve the platform without a password configured.
if (!PASSWORD) {
  console.error("APP_PASSWORD is not set — refusing to start an unprotected server.");
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.warn("SESSION_SECRET not set — using a per-boot random key; sessions will end on restart.");
}
if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error(`No build found at ${DIST}. Run "npm run build" first.`);
  process.exit(1);
}

// ---------- session tokens ----------

const sign = (value) => crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");

function issueToken() {
  const expiresAt = String(Date.now() + SESSION_HOURS * 3600_000);
  return `${expiresAt}.${sign(expiresAt)}`;
}

function tokenValid(token) {
  if (typeof token !== "string") return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const expiresAt = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(expiresAt);
  if (mac.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  return Number(expiresAt) > Date.now();
}

/** Constant-time password check; hashing first so length is not leaked by timing. */
function passwordOk(given) {
  const a = crypto.createHash("sha256").update(String(given ?? "")).digest();
  const b = crypto.createHash("sha256").update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

// ---------- brute-force throttle (in-memory, per instance) ----------

const attempts = new Map(); // ip -> { count, resetAt }

function throttled(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() > rec.resetAt) return false;
  return rec.count >= MAX_ATTEMPTS;
}

function recordFailure(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: Date.now() + ATTEMPT_WINDOW_MS });
  } else {
    rec.count++;
  }
}

// keep the map from growing without bound
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of attempts) if (now > rec.resetAt) attempts.delete(ip);
}, ATTEMPT_WINDOW_MS).unref();

// ---------- login page ----------

function loginPage({ error = "", notice = "" } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Hong Kong Landslide &amp; Flood Digital Twin</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  :root { --bg:#07090d; --panel:#0c1017; --line:#232c3a; --t0:#e8edf4; --t1:#aab6c5; --t2:#6d7a8c; --accent:#3d8bfd; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--t0);
    font:14px/1.5 Inter,"Segoe UI",system-ui,sans-serif; -webkit-font-smoothing:antialiased;
    display:grid; place-items:center; padding:24px; }
  .glow { position:fixed; inset:0; pointer-events:none;
    background:radial-gradient(700px 380px at 50% -8%, rgba(61,139,253,.16), transparent 70%); }
  .card { position:relative; width:100%; max-width:400px; background:var(--panel);
    border:1px solid var(--line); border-radius:14px; padding:30px 28px;
    box-shadow:0 22px 60px rgba(0,0,0,.55); animation:rise .45s ease both; }
  @keyframes rise { from { opacity:0; transform:translateY(10px);} to { opacity:1; transform:none;} }
  .brand { display:flex; align-items:center; gap:11px; margin-bottom:22px; }
  .mark { width:36px; height:36px; border-radius:8px; display:grid; place-items:center;
    background:linear-gradient(135deg,#1d5fd6,#0f3a8a); font-weight:700; font-size:13px; letter-spacing:.5px; }
  h1 { margin:0; font-size:14.5px; font-weight:600; letter-spacing:-.01em; }
  .sub { font-size:11px; color:var(--t2); margin-top:2px; }
  label { display:block; font-size:10.5px; letter-spacing:1px; text-transform:uppercase;
    color:var(--t2); font-weight:600; margin-bottom:7px; }
  input { width:100%; background:#12171f; border:1px solid var(--line); border-radius:9px;
    color:var(--t0); font:14px Inter,sans-serif; padding:12px 14px; outline:none;
    transition:border-color .15s, box-shadow .15s; }
  input:focus { border-color:#2b5aa8; box-shadow:0 0 0 4px rgba(61,139,253,.12); }
  button { width:100%; margin-top:14px; background:#1d5fd6; border:none; border-radius:9px;
    color:#fff; font:600 13.5px Inter,sans-serif; padding:12px 0; cursor:pointer;
    transition:background .15s, transform .1s; }
  button:hover { background:#2a6ce2; }
  button:active { transform:translateY(1px); }
  .err { margin-top:14px; background:rgba(200,30,30,.14); border:1px solid #a83232; color:#ff9a8d;
    border-radius:8px; padding:9px 12px; font-size:12px; animation:shake .3s ease; }
  @keyframes shake { 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }
  .ok { margin-top:14px; background:rgba(47,179,107,.12); border:1px solid #2fb36b55; color:#43d19a;
    border-radius:8px; padding:9px 12px; font-size:12px; }
  .synth { margin-top:22px; padding-top:16px; border-top:1px solid #1b2330;
    font-size:10.5px; line-height:1.6; color:var(--t2); }
  .synth b { color:#e6c15a; }
</style>
</head>
<body>
  <div class="glow"></div>
  <form class="card" method="POST" action="/login" autocomplete="off">
    <div class="brand">
      <div class="mark">HK</div>
      <div>
        <h1>Hong Kong Landslide &amp; Flood Digital Twin</h1>
        <div class="sub">Simulation-Enabled Decision Support · Prototype</div>
      </div>
    </div>
    <label for="password">Access password</label>
    <input id="password" name="password" type="password" required autofocus placeholder="Enter password" />
    <button type="submit">Open the platform</button>
    ${error ? `<div class="err">${error}</div>` : ""}
    ${notice ? `<div class="ok">${notice}</div>` : ""}
    <div class="synth">
      <b>Synthetic data prototype.</b> All slopes, sensors, risks and simulations are generated.
      Nothing here represents real Hong Kong government data or official warnings.
    </div>
  </form>
</body>
</html>`;
}

// ---------- app ----------

const app = express();
app.set("trust proxy", 1); // Render terminates TLS upstream
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false, limit: "8kb" }));

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  next();
});

const setSessionCookie = (req, res, token, maxAgeMs) =>
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    maxAge: maxAgeMs,
    path: "/",
  });

app.get("/login", (req, res) => {
  if (tokenValid(readCookie(req, COOKIE_NAME))) return res.redirect("/");
  res.type("html").send(loginPage({ notice: req.query.out !== undefined ? "You have been signed out." : "" }));
});

app.post("/login", (req, res) => {
  const ip = req.ip ?? "unknown";
  if (throttled(ip)) {
    return res
      .status(429)
      .type("html")
      .send(loginPage({ error: "Too many attempts. Wait 15 minutes and try again." }));
  }
  if (!passwordOk(req.body?.password)) {
    recordFailure(ip);
    return res.status(401).type("html").send(loginPage({ error: "Incorrect password." }));
  }
  attempts.delete(ip);
  setSessionCookie(req, res, issueToken(), SESSION_HOURS * 3600_000);
  res.redirect("/");
});

app.get("/logout", (req, res) => {
  setSessionCookie(req, res, "", 0);
  res.redirect("/login?out");
});

// Everything below this line requires a valid session.
app.use((req, res, next) => {
  if (tokenValid(readCookie(req, COOKIE_NAME))) return next();
  const wantsHtml = (req.headers.accept ?? "").includes("text/html");
  if (wantsHtml) return res.redirect("/login");
  res.status(401).type("txt").send("Authentication required");
});

app.use(
  express.static(DIST, {
    setHeaders(res, filePath) {
      // hashed asset filenames may be cached hard; index.html must not be
      res.setHeader("Cache-Control", filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable");
    },
  })
);

// SPA fallback
app.use((_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(DIST, "index.html"));
});

app.listen(PORT, () => {
  console.log(`HK Hazard Digital Twin — password-protected on port ${PORT}`);
});
