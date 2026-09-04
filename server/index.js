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
const SESSION_HOURS = 12;         // default session
const REMEMBER_DAYS = 30;         // "keep me signed in"
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

function issueToken(lifetimeMs) {
  const expiresAt = String(Date.now() + lifetimeMs);
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

const FEATURES = [
  ["◈", "3D hazard twin", "~4,000 real registered slopes (CEDD Catalogue of Slopes) over Hong Kong terrain, coloured by risk band."],
  ["⚗", "Scenario simulation", "Test a storm or an intervention and watch the failure and runout play out."],
  ["◎", "Decision support", "Ranked attention lists, consequence cascades, portfolio optimisation, situation reports."],
];

function loginPage({ error = "", notice = "" } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<meta name="color-scheme" content="dark" />
<title>Sign in · Hong Kong Landslide &amp; Flood Digital Twin</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg:#07090d; --panel:#0c1017; --field:#12171f; --line:#232c3a; --line-soft:#1b2330;
    --t0:#e8edf4; --t1:#aab6c5; --t2:#6d7a8c; --accent:#3d8bfd; --accent-deep:#1d5fd6;
  }
  * { box-sizing:border-box; }
  html, body { height:100%; }
  body { margin:0; background:var(--bg); color:var(--t0);
    font:14px/1.55 Inter,"Segoe UI",system-ui,-apple-system,sans-serif;
    -webkit-font-smoothing:antialiased; }
  .shell { min-height:100%; display:grid; grid-template-columns:1.15fr .85fr; }

  /* ---------- left: brand panel ---------- */
  .hero { position:relative; overflow:hidden; padding:44px 52px 34px;
    display:flex; flex-direction:column; justify-content:space-between;
    background:linear-gradient(150deg,#0d1626 0%,#0a121f 45%,#080c14 100%);
    border-right:1px solid var(--line); }
  .contours { position:absolute; inset:0; opacity:.5; pointer-events:none; }
  .hero-glow { position:absolute; width:760px; height:760px; left:-180px; top:-260px; pointer-events:none;
    background:radial-gradient(circle, rgba(61,139,253,.20), transparent 62%); }
  .hero-inner { position:relative; }
  .brand { display:flex; align-items:center; gap:13px; margin-bottom:38px; }
  .mark { width:40px; height:40px; border-radius:10px; display:grid; place-items:center; flex:none;
    background:linear-gradient(135deg,#2a72e8,#0f3a8a); font-weight:700; font-size:14px; letter-spacing:.5px;
    box-shadow:0 0 0 1px rgba(125,180,255,.25), 0 8px 22px rgba(29,95,214,.35); }
  .brand-name { font-size:13px; font-weight:600; letter-spacing:.02em; }
  .brand-sub { font-size:10.5px; color:var(--t2); letter-spacing:.06em; text-transform:uppercase; margin-top:2px; }
  .hero h1 { margin:0 0 13px; font-size:32px; line-height:1.14; font-weight:650; letter-spacing:-.022em; max-width:15ch; }
  .hero h1 em { font-style:normal; color:#7db4ff; }
  .lede { margin:0 0 28px; max-width:46ch; color:var(--t1); font-size:14.5px; line-height:1.65; }
  .feat { display:flex; gap:14px; padding:13px 0; border-top:1px solid var(--line-soft); max-width:52ch; }
  .feat .ic { width:30px; height:30px; flex:none; border-radius:8px; display:grid; place-items:center;
    background:rgba(61,139,253,.11); color:#7db4ff; font-size:14px; }
  .feat h3 { margin:0 0 2px; font-size:12.5px; font-weight:600; }
  .feat p { margin:0; font-size:12px; color:var(--t2); line-height:1.55; }
  .synth-strip { position:relative; margin-top:26px; display:flex; align-items:flex-start; gap:11px;
    padding:13px 16px; border-radius:10px; max-width:54ch;
    background:rgba(230,193,90,.07); border:1px solid rgba(230,193,90,.24); }
  .synth-strip .warn { color:#e6c15a; font-size:14px; line-height:1.3; }
  .synth-strip p { margin:0; font-size:11.5px; line-height:1.6; color:#cdbb87; }
  .synth-strip b { color:#e6c15a; font-weight:600; }

  /* ---------- right: sign-in panel ---------- */
  .auth { display:flex; align-items:center; justify-content:center; padding:48px 40px; background:var(--bg); }
  .form-wrap { width:100%; max-width:352px; animation:rise .5s cubic-bezier(.2,.7,.3,1) both; }
  @keyframes rise { from { opacity:0; transform:translateY(14px);} to { opacity:1; transform:none;} }
  .auth h2 { margin:0 0 6px; font-size:22px; font-weight:650; letter-spacing:-.02em; }
  .auth .hint { margin:0 0 28px; font-size:13px; color:var(--t2); line-height:1.6; }
  label { display:block; font-size:10.5px; letter-spacing:.09em; text-transform:uppercase;
    color:var(--t2); font-weight:600; margin-bottom:8px; }
  .field { position:relative; }
  input[type=password], input[type=text] { width:100%; background:var(--field);
    border:1px solid var(--line); border-radius:10px; color:var(--t0);
    font:14.5px Inter,sans-serif; padding:13px 46px 13px 15px; outline:none;
    transition:border-color .15s, box-shadow .15s, background .15s; }
  input::placeholder { color:#55606f; }
  input:focus { border-color:#2b5aa8; background:#141b25; box-shadow:0 0 0 4px rgba(61,139,253,.12); }
  .peek { position:absolute; right:6px; top:50%; transform:translateY(-50%);
    width:34px; height:34px; border:none; background:none; color:var(--t2);
    cursor:pointer; border-radius:8px; font-size:15px; display:grid; place-items:center; }
  .peek:hover { color:var(--t0); background:#1a212c; }
  .remember { display:flex; align-items:center; gap:9px; margin:16px 0 22px;
    font-size:12.5px; color:var(--t1); cursor:pointer; user-select:none;
    text-transform:none; letter-spacing:normal; font-weight:400; }
  .remember input { width:15px; height:15px; accent-color:var(--accent); cursor:pointer; }
  .submit { width:100%; border:none; border-radius:10px; color:#fff; cursor:pointer;
    background:linear-gradient(180deg,#2a72e8,#1d5fd6);
    font:600 14px Inter,sans-serif; padding:13px 0;
    display:flex; align-items:center; justify-content:center; gap:9px;
    box-shadow:0 6px 18px rgba(29,95,214,.28); transition:filter .15s, transform .1s; }
  .submit:hover { filter:brightness(1.09); }
  .submit:active { transform:translateY(1px); }
  .submit[aria-busy=true] { pointer-events:none; filter:saturate(.6) brightness(.9); }
  .submit .spin { width:14px; height:14px; border-radius:50%; display:none;
    border:2px solid rgba(255,255,255,.35); border-top-color:#fff; animation:spin .7s linear infinite; }
  .submit[aria-busy=true] .spin { display:block; }
  @keyframes spin { to { transform:rotate(360deg);} }
  .msg { display:flex; align-items:flex-start; gap:9px; margin-bottom:20px;
    border-radius:9px; padding:11px 13px; font-size:12.5px; line-height:1.5; }
  .msg.err { background:rgba(200,30,30,.13); border:1px solid #a83232; color:#ff9a8d;
    animation:shake .32s cubic-bezier(.36,.07,.19,.97); }
  .msg.ok { background:rgba(47,179,107,.1); border:1px solid rgba(47,179,107,.35); color:#5fd7a4; }
  @keyframes shake { 20%{transform:translateX(-5px)} 40%{transform:translateX(5px)}
    60%{transform:translateX(-3px)} 80%{transform:translateX(3px)} }
  .foot { margin-top:28px; padding-top:20px; border-top:1px solid var(--line-soft);
    font-size:11.5px; color:var(--t2); line-height:1.65; }
  .mobile-brand { display:none; }

  /* ---------- responsive ---------- */
  @media (max-height:760px) {
    .hero { padding:32px 46px 26px; }
    .brand { margin-bottom:26px; }
    .hero h1 { font-size:27px; margin-bottom:10px; }
    .lede { margin-bottom:20px; font-size:13.5px; }
    .feat { padding:10px 0; }
    .synth-strip { margin-top:18px; padding:11px 14px; }
    .auth { padding:32px 40px; }
  }
  @media (max-width:980px) {
    .shell { grid-template-columns:1fr; }
    .hero { display:none; }
    .auth { padding:32px 22px; align-items:flex-start; }
    .form-wrap { margin-top:8vh; }
    .mobile-brand { display:flex; align-items:center; gap:12px; margin-bottom:32px; }
    .mobile-brand .mark { width:36px; height:36px; }
  }
</style>
</head>
<body>
<div class="shell">
  <section class="hero">
    <svg class="contours" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke="#3d8bfd" stroke-width="1">
        ${Array.from({ length: 13 }, (_, i) => {
          const k = i * 26;
          return `<path d="M-40,${120 + k} C 130,${40 + k} 250,${250 + k} 400,${170 + k} S 610,${90 + k} 660,${150 + k}" opacity="${(0.16 - i * 0.009).toFixed(3)}"/>`;
        }).join("")}
      </g>
    </svg>
    <div class="hero-glow"></div>

    <div class="hero-inner">
      <div class="brand">
        <div class="mark">HK</div>
        <div>
          <div class="brand-name">Hong Kong Landslide &amp; Flood Digital Twin</div>
          <div class="brand-sub">Simulation-Enabled Decision Support</div>
        </div>
      </div>
      <h1>Watch the hazard <em>before</em> it happens.</h1>
      <p class="lede">
        A live 3D twin of Hong Kong's slopes: observe conditions, understand why a slope is
        risky, simulate the next storm, compare interventions, and decide what to do tonight.
      </p>
      ${FEATURES.map(
        ([icon, title, body]) => `<div class="feat">
        <div class="ic">${icon}</div>
        <div><h3>${title}</h3><p>${body}</p></div>
      </div>`
      ).join("")}
    </div>

    <div class="synth-strip">
      <span class="warn">⚠</span>
      <p><b>Research prototype.</b> Slope polygons and registration details are real open government
      data (CEDD Catalogue of Slopes, DSD flooding blackspots, via CSDI). Every risk score, sensor
      reading, incident and simulation is synthetic — no output is an official warning.</p>
    </div>
  </section>

  <section class="auth">
    <div class="form-wrap">
      <div class="mobile-brand">
        <div class="mark">HK</div>
        <div>
          <div class="brand-name">HK Landslide &amp; Flood Digital Twin</div>
          <div class="brand-sub">Prototype</div>
        </div>
      </div>

      <h2>Sign in</h2>
      <p class="hint">This prototype is private. Enter the access password you were given to open the platform.</p>

      ${error ? `<div class="msg err"><span>✕</span><span>${error}</span></div>` : ""}
      ${notice ? `<div class="msg ok"><span>✓</span><span>${notice}</span></div>` : ""}

      <form method="POST" action="/login" id="f">
        <label for="password">Access password</label>
        <div class="field">
          <input id="password" name="password" type="password" required autofocus
                 autocomplete="current-password" placeholder="Enter password" />
          <button type="button" class="peek" id="peek" aria-label="Show password" title="Show password">◉</button>
        </div>

        <label class="remember" for="remember">
          <input type="checkbox" id="remember" name="remember" value="1" />
          Keep me signed in for ${REMEMBER_DAYS} days
        </label>

        <button type="submit" class="submit" id="go">
          <span class="spin"></span><span>Open the platform</span>
        </button>
      </form>

      <div class="foot">
        Sessions last ${SESSION_HOURS} hours unless you choose to stay signed in.
        Sign out any time at <b>/logout</b>.
      </div>
    </div>
  </section>
</div>
<script>
  var pw = document.getElementById('password'), peek = document.getElementById('peek');
  peek.addEventListener('click', function () {
    var show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    peek.textContent = show ? '◎' : '◉';
    peek.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    pw.focus();
  });
  document.getElementById('f').addEventListener('submit', function () {
    document.getElementById('go').setAttribute('aria-busy', 'true');
  });
</script>
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
  const lifetimeMs = req.body?.remember === "1" ? REMEMBER_DAYS * 86400_000 : SESSION_HOURS * 3600_000;
  setSessionCookie(req, res, issueToken(lifetimeMs), lifetimeMs);
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
