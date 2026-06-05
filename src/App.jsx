import { useState, useEffect, useCallback } from "react";

// ─── COLOURS ─────────────────────────────────────────────────────────────────
const C = {
  bg: "#f0f4ff", surface: "#ffffff", surfaceAlt: "#f8faff",
  border: "#dde6ff", borderStrong: "#b8ccff",
  primary: "#1a56db", primaryDark: "#1648c0", primaryLight: "#e8eeff", primaryMid: "#c7d7ff",
  accent: "#0ea5e9", text: "#0f172a", textMid: "#334155", textSoft: "#64748b", textFaint: "#94a3b8",
  safe: "#16a34a", safeBg: "#f0fdf4", safeBorder: "#bbf7d0",
  med: "#d97706", medBg: "#fffbeb", medBorder: "#fde68a",
  risky: "#dc2626", riskyBg: "#fef2f2", riskyBorder: "#fecaca",
  success: "#16a34a", successBg: "#f0fdf4", warn: "#d97706", warnBg: "#fffbeb",
};

// ─── BACKEND (localStorage) ───────────────────────────────────────────────────
const DB = {
  getUsers: () => JSON.parse(localStorage.getItem("sfb_users") || "{}"),
  saveUsers: (u) => localStorage.setItem("sfb_users", JSON.stringify(u)),
  getSession: () => localStorage.getItem("sfb_session"),
  setSession: (email) => localStorage.setItem("sfb_session", email),
  clearSession: () => localStorage.removeItem("sfb_session"),
  getUserData: (email) => JSON.parse(localStorage.getItem(`sfb_data_${email}`) || '{"bets":[],"slips":[]}'),
  saveUserData: (email, data) => localStorage.setItem(`sfb_data_${email}`, JSON.stringify(data)),

  register: (name, email, password) => {
    const users = DB.getUsers();
    if (users[email]) return { ok: false, msg: "Email already registered." };
    users[email] = { name, email, password: btoa(password), joined: Date.now() };
    DB.saveUsers(users);
    DB.setSession(email);
    return { ok: true };
  },
  login: (email, password) => {
    const users = DB.getUsers();
    if (!users[email]) return { ok: false, msg: "No account found with that email." };
    if (users[email].password !== btoa(password)) return { ok: false, msg: "Incorrect password." };
    DB.setSession(email);
    return { ok: true, user: users[email] };
  },
  currentUser: () => {
    const email = DB.getSession();
    if (!email) return null;
    const users = DB.getUsers();
    return users[email] || null;
  },
};

// ─── PARSER ───────────────────────────────────────────────────────────────────
function parseSlip(raw) {
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const selections = [];
  const oddPat = /^\d+(\.\d{1,3})?$/;
  const matchPat = /\bvs?\.?\s/i;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (matchPat.test(line)) {
      let odd = null, market = "";
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const n = lines[j];
        if (oddPat.test(n) && parseFloat(n) > 1.01 && parseFloat(n) < 500) {
          odd = parseFloat(n); if (j > i + 1) market = lines[j - 1];
          i = j + 1; break;
        }
        if (matchPat.test(n)) break;
      }
      if (odd) { selections.push({ match: line, market, odd, id: selections.length }); continue; }
    }
    const inlineOdds = line.match(/(\d+\.\d{1,3})/g);
    if (inlineOdds && matchPat.test(line)) {
      const odd = parseFloat(inlineOdds[inlineOdds.length - 1]);
      if (odd > 1.01 && odd < 500) {
        const match = line.replace(/\d+\.\d{1,3}/g, "").replace(/\s{2,}/g, " ").trim();
        selections.push({ match, market: "", odd, id: selections.length }); i++; continue;
      }
    }
    if (oddPat.test(line)) {
      const odd = parseFloat(line);
      if (odd > 1.01 && odd < 500 && selections.length > 0 && !selections[selections.length - 1].odd)
        selections[selections.length - 1].odd = odd;
    }
    i++;
  }
  if (!selections.length) {
    lines.forEach((line, idx) => {
      const m = line.match(/(\d+\.\d{1,3})/);
      if (m) {
        const odd = parseFloat(m[1]);
        if (odd > 1.01 && odd < 500) {
          const match = line.replace(m[1], "").replace(/[|\-–]/g, "").trim() || `Selection ${idx + 1}`;
          selections.push({ match, market: "", odd, id: selections.length });
        }
      }
    });
  }
  return selections;
}

function filterToTarget(selections, target, mode) {
  let pool = [...selections];
  if (mode === "safe") pool = pool.filter(s => s.odd <= 1.65);
  else if (mode === "balanced") pool = pool.filter(s => s.odd <= 2.5);
  if (pool.length < 2) pool = [...selections];
  let best = null, bestDiff = Infinity;
  const tryBuild = (sorted) => {
    let combo = [], product = 1;
    for (const s of sorted) { if (product * s.odd <= target * 1.2) { combo.push(s); product *= s.odd; } }
    const diff = Math.abs(product - target);
    if (combo.length >= 2 && diff < bestDiff) { bestDiff = diff; best = { combo, totalOdds: product }; }
  };
  tryBuild([...pool].sort((a, b) => a.odd - b.odd));
  tryBuild([...pool].sort((a, b) => b.odd - a.odd));
  return best || { combo: pool.slice(0, 3), totalOdds: pool.slice(0, 3).reduce((a, s) => a * s.odd, 1) };
}

function generateCode(combo, totalOdds, mode, target) {
  const payload = { v: 1, t: Math.round(target), m: mode[0], o: parseFloat(totalOdds.toFixed(2)), g: combo.map(s => ({ n: s.match, k: s.market || "", d: s.odd })) };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const body = b64.toUpperCase().slice(0, 18).padEnd(18, "0");
  const shortCode = `SPFT-${body.slice(0,6)}-${body.slice(6,12)}-${body.slice(12,18)}`;
  try { sessionStorage.setItem(`fc_${shortCode}`, JSON.stringify(payload)); } catch (_) {}
  return { shortCode, fullCode: b64, payload };
}

function decodeCode(code) {
  const stored = sessionStorage.getItem(`fc_${code}`);
  if (stored) { try { return JSON.parse(stored); } catch (_) {} }
  try {
    const padded = code.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    return JSON.parse(decodeURIComponent(escape(atob(padded + pad))));
  } catch (_) {}
  return null;
}

const oddColor = o => o <= 1.5 ? C.safe : o <= 2.2 ? C.med : C.risky;
const oddBg    = o => o <= 1.5 ? C.safeBg : o <= 2.2 ? C.medBg : C.riskyBg;
const oddBorder= o => o <= 1.5 ? C.safeBorder : o <= 2.2 ? C.medBorder : C.riskyBorder;
const riskLabel= o => o <= 1.5 ? "SAFE" : o <= 2.2 ? "MED" : "RISKY";
const totalOdds= sels => sels.reduce((a, s) => a * s.odd, 1);
const fmt = n => n?.toLocaleString(undefined, { maximumFractionDigits: 2 });

const SAMPLE = `Arsenal v Chelsea\n1X2 | Home Win\n1.85\n\nManchester City v Liverpool\nBoth Teams to Score | Yes\n1.72\n\nReal Madrid v Barcelona\n1X2 | Home Win\n1.55\n\nBayern Munich v Dortmund\nOver/Under | Over 2.5\n1.45\n\nPSG v Lyon\n1X2 | Home Win\n1.40\n\nJuventus v Inter Milan\nBTTS | No\n2.10\n\nAtletico Madrid v Sevilla\n1X2 | Home Win\n1.70\n\nTottenham v West Ham\n1X2 | Home Win\n1.90\n\nNapoli v Roma\nOver 1.5\n1.35\n\nAjax v PSV\n1X2 | Home Win\n1.60`;

// ─── SPLASH SCREEN ───────────────────────────────────────────────────────────
function SplashScreen() {
  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#1a56db 0%,#1e40af 60%,#1e3a8a 100%)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:"'Inter','Segoe UI',sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&display=swap');@keyframes pop{0%{transform:scale(.5);opacity:0}70%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}@keyframes fadeSlide{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse2{0%,100%{opacity:1}50%{opacity:.4}}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ animation:"pop .6s cubic-bezier(.34,1.56,.64,1) forwards", fontSize:"72px", marginBottom:"20px" }}>🎯</div>
      <div style={{ animation:"fadeSlide .5s ease .4s both", fontFamily:"'Space Grotesk',sans-serif", fontSize:"32px", fontWeight:"700", color:"#fff", letterSpacing:"1px" }}>PascalFilterBot</div>
      <div style={{ animation:"fadeSlide .5s ease .6s both", display:"inline-block", background:"rgba(255,255,255,.15)", border:"1px solid rgba(255,255,255,.3)", borderRadius:"24px", padding:"6px 22px", marginTop:"12px" }}>
        <span style={{ fontSize:"15px", color:"#fff", fontWeight:"700", letterSpacing:"5px" }}>✦ PASFILT ✦</span>
      </div>
      <div style={{ animation:"fadeSlide .5s ease .8s both", fontSize:"12px", color:"rgba(255,255,255,.5)", marginTop:"10px", letterSpacing:"1px" }}>Smart odds filtering for smarter bets</div>
      <div style={{ marginTop:"48px", animation:"fadeSlide .5s ease 1s both", display:"flex", flexDirection:"column", alignItems:"center", gap:"10px" }}>
        <div style={{ width:"36px", height:"36px", border:"3px solid rgba(255,255,255,.2)", borderTop:"3px solid #fff", borderRadius:"50%", animation:"spin .8s linear infinite" }}/>
        <div style={{ fontSize:"11px", color:"rgba(255,255,255,.4)", animation:"pulse2 1.4s ease infinite", letterSpacing:"2px" }}>LOADING...</div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [authPage, setAuthPage] = useState("login");
  const [page, setPage] = useState("filter");
  const [splash, setSplash] = useState(true);

  useEffect(() => {
    const u = DB.currentUser();
    if (u) setUser(u);
    setTimeout(() => setSplash(false), 2600);
  }, []);

  const logout = () => { DB.clearSession(); setUser(null); setPage("filter"); };

  if (splash) return <SplashScreen />;
  if (!user) return <AuthScreen authPage={authPage} setAuthPage={setAuthPage} onAuth={setUser} />;

  return (
    <MainApp user={user} onLogout={logout} page={page} setPage={setPage} />
  );
}

// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────
function AuthScreen({ authPage, setAuthPage, onAuth }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const submit = () => {
    setError("");
    if (!email || !password) { setError("Please fill in all fields."); return; }
    if (authPage === "register") {
      if (!name) { setError("Please enter your name."); return; }
      if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
      if (password !== confirm) { setError("Passwords do not match."); return; }
    }
    setLoading(true);
    setTimeout(() => {
      const res = authPage === "register"
        ? DB.register(name, email, password)
        : DB.login(email, password);
      setLoading(false);
      if (!res.ok) { setError(res.msg); return; }
      onAuth(DB.currentUser());
    }, 600);
  };

  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(135deg, #1a56db 0%, #1e40af 60%, #1e3a8a 100%)`, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px", fontFamily: "'Inter','Segoe UI',sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@600;700&display=swap');*{box-sizing:border-box}input{outline:none}.btn{transition:all .18s;cursor:pointer;font-family:inherit}.btn:hover{filter:brightness(.93);transform:translateY(-1px)}.btn:active{transform:translateY(0)}input:focus{border-color:${C.primary}!important;box-shadow:0 0 0 3px rgba(26,86,219,.13)!important}@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}.fu{animation:fadeUp .35s ease forwards}`}</style>

      <div className="fu" style={{ width: "100%", maxWidth: "420px" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div style={{ width: "64px", height: "64px", background: "rgba(255,255,255,.15)", borderRadius: "18px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "30px", margin: "0 auto 14px", boxShadow: "0 4px 20px rgba(0,0,0,.2)" }}>🎯</div>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "28px", fontWeight: "700", color: "#fff", letterSpacing: ".5px" }}>PascalFilterBot</div>
          <div style={{ display: "inline-block", background: "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.25)", borderRadius: "20px", padding: "4px 16px", marginTop: "8px" }}>
            <span style={{ fontSize: "13px", color: "#fff", fontWeight: "600", letterSpacing: "3px" }}>✦ PASFILT ✦</span>
          </div>
          <div style={{ fontSize: "12px", color: "rgba(255,255,255,.55)", marginTop: "8px" }}>Smart odds filtering for smarter bets</div>
        </div>

        {/* Card */}
        <div style={{ background: "#fff", borderRadius: "16px", padding: "28px 24px", boxShadow: "0 20px 60px rgba(0,0,0,.2)" }}>
          {/* Tabs */}
          <div style={{ display: "flex", background: C.bg, borderRadius: "10px", padding: "4px", marginBottom: "24px" }}>
            {[["login","Sign In"],["register","Sign Up"]].map(([k,l]) => (
              <button key={k} className="btn" onClick={() => { setAuthPage(k); setError(""); }} style={{ flex: 1, padding: "9px", background: authPage === k ? "#fff" : "transparent", border: "none", borderRadius: "7px", fontSize: "13px", fontWeight: "600", color: authPage === k ? C.primary : C.textSoft, boxShadow: authPage === k ? "0 1px 4px rgba(26,86,219,.12)" : "none" }}>
                {l}
              </button>
            ))}
          </div>

          {authPage === "register" && (
            <Field label="Full Name">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" style={inputStyle()} />
            </Field>
          )}
          <Field label="Email Address">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" style={inputStyle()} />
          </Field>
          <Field label="Password">
            <div style={{ position: "relative" }}>
              <input type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={{ ...inputStyle(), paddingRight: "40px" }} />
              <button onClick={() => setShowPass(v => !v)} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: "14px", color: C.textFaint }}>
                {showPass ? "🙈" : "👁️"}
              </button>
            </div>
          </Field>
          {authPage === "register" && (
            <Field label="Confirm Password">
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" style={inputStyle()} />
            </Field>
          )}

          {error && <div style={{ padding: "10px 14px", background: C.riskyBg, border: `1px solid ${C.riskyBorder}`, borderRadius: "8px", fontSize: "12px", color: C.risky, marginBottom: "14px" }}>⚠️ {error}</div>}

          <button className="btn" onClick={submit} disabled={loading} style={{ width: "100%", padding: "13px", background: `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`, border: "none", borderRadius: "9px", color: "#fff", fontSize: "14px", fontWeight: "700", letterSpacing: ".3px" }}>
            {loading ? "⏳ Please wait..." : authPage === "login" ? "Sign In →" : "Create Account →"}
          </button>

          <div style={{ textAlign: "center", marginTop: "16px", fontSize: "12px", color: C.textSoft }}>
            {authPage === "login" ? "Don't have an account? " : "Already have an account? "}
            <button onClick={() => { setAuthPage(authPage === "login" ? "register" : "login"); setError(""); }} style={{ background: "none", border: "none", color: C.primary, fontWeight: "600", cursor: "pointer", fontSize: "12px", fontFamily: "inherit" }}>
              {authPage === "login" ? "Sign Up" : "Sign In"}
            </button>
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: "16px", fontSize: "11px", color: "rgba(255,255,255,.4)" }}>
          ⚠️ Gamble responsibly · 18+ only
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
function MainApp({ user, onLogout, page, setPage }) {
  const [userData, setUserData] = useState(() => DB.getUserData(user.email));

  const saveData = useCallback((data) => {
    setUserData(data);
    DB.saveUserData(user.email, data);
  }, [user.email]);

  const addSlip = (slip) => {
    const updated = { ...userData, slips: [slip, ...(userData.slips || [])].slice(0, 50) };
    saveData(updated);
  };

  const addBet = (bet) => {
    const updated = { ...userData, bets: [bet, ...(userData.bets || [])] };
    saveData(updated);
  };

  const updateBet = (id, changes) => {
    const updated = { ...userData, bets: userData.bets.map(b => b.id === id ? { ...b, ...changes } : b) };
    saveData(updated);
  };

  const deleteBet = (id) => {
    const updated = { ...userData, bets: userData.bets.filter(b => b.id !== id) };
    saveData(updated);
  };

  const NAV = [
    { key: "filter", icon: "🎯", label: "Filter" },
    { key: "tracker", icon: "📝", label: "Tracker" },
    { key: "dashboard", icon: "📊", label: "Stats" },
    { key: "history", icon: "📜", label: "History" },
    { key: "redeem", icon: "🔑", label: "Redeem" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Inter','Segoe UI',sans-serif", color: C.text, paddingBottom: "80px" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@600;700&display=swap');*{box-sizing:border-box}input,textarea{outline:none}.btn{transition:all .18s;cursor:pointer;font-family:inherit}.btn:hover{filter:brightness(.94);transform:translateY(-1px)}.btn:active{transform:translateY(0)}input:focus,textarea:focus{border-color:${C.primary}!important;box-shadow:0 0 0 3px rgba(26,86,219,.1)!important}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:${C.primaryMid};border-radius:3px}@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}.fu{animation:fadeUp .3s ease forwards}@keyframes spin{to{transform:rotate(360deg)}}.spin{animation:spin .7s linear infinite;display:inline-block}`}</style>

      {/* HEADER */}
      <div style={{ background: `linear-gradient(135deg, ${C.primary}, #1e40af)`, boxShadow: "0 2px 16px rgba(26,86,219,.25)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: "680px", margin: "0 auto", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "22px" }}>🎯</span>
            <div>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "16px", fontWeight: "700", color: "#fff" }}>PascalFilterBot</div>
              <div style={{ fontSize: "10px", color: "rgba(255,255,255,.6)" }}>Welcome, {user.name.split(" ")[0]}</div>
            </div>
          </div>
          <button className="btn" onClick={onLogout} style={{ background: "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.25)", color: "#fff", padding: "7px 14px", borderRadius: "7px", fontSize: "12px", fontWeight: "500" }}>
            Sign Out
          </button>
        </div>
      </div>

      {/* PAGE */}
      <div style={{ maxWidth: "680px", margin: "0 auto", padding: "20px 16px" }}>
        {page === "filter" && <FilterPage onSlipSaved={addSlip} />}
        {page === "tracker" && <TrackerPage bets={userData.bets} onAdd={addBet} onUpdate={updateBet} onDelete={deleteBet} />}
        {page === "dashboard" && <DashboardPage bets={userData.bets} user={user} />}
        {page === "history" && <HistoryPage slips={userData.slips} />}
        {page === "redeem" && <RedeemPage />}
      </div>

      {/* BOTTOM NAV */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: `1.5px solid ${C.border}`, display: "flex", zIndex: 100, boxShadow: "0 -4px 20px rgba(26,86,219,.1)" }}>
        {NAV.map(n => (
          <button key={n.key} className="btn" onClick={() => setPage(n.key)} style={{ flex: 1, padding: "10px 4px 8px", background: "transparent", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
            <span style={{ fontSize: "18px", filter: page === n.key ? "none" : "grayscale(1) opacity(.5)" }}>{n.icon}</span>
            <span style={{ fontSize: "9px", fontWeight: "600", color: page === n.key ? C.primary : C.textFaint, letterSpacing: ".5px" }}>{n.label}</span>
            {page === n.key && <span style={{ width: "20px", height: "2px", background: C.primary, borderRadius: "1px" }} />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── FILTER PAGE ──────────────────────────────────────────────────────────────
function FilterPage({ onSlipSaved }) {
  const [raw, setRaw] = useState("");
  const [selections, setSelections] = useState([]);
  const [parsed, setParsed] = useState(false);
  const [parseError, setParseError] = useState("");
  const [target, setTarget] = useState(1000);
  const [customTarget, setCustomTarget] = useState("");
  const [mode, setMode] = useState("balanced");
  const [stake, setStake] = useState("");
  const [result, setResult] = useState(null);
  const [bookingCode, setBookingCode] = useState(null);
  const [step, setStep] = useState(1);
  const [animating, setAnimating] = useState(false);
  const [copied, setCopied] = useState("");

  const effectiveTarget = customTarget ? parseFloat(customTarget) : target;
  const activeSels = selections.filter(s => s.active);
  const inputTotal = totalOdds(activeSels);
  const potWin = result && stake ? (parseFloat(stake) * result.totalOdds).toFixed(2) : null;

  const handleParse = () => {
    setParseError("");
    const sels = parseSlip(raw);
    if (!sels.length) { setParseError("No selections detected. Copy the full bet slip from Sportybet."); return; }
    setSelections(sels.map(s => ({ ...s, active: true })));
    setParsed(true); setResult(null); setBookingCode(null); setStep(2);
  };

  const toggleSel = id => { setSelections(p => p.map(s => s.id === id ? { ...s, active: !s.active } : s)); setResult(null); };

  const handleFilter = () => {
    if (activeSels.length < 2) return;
    setAnimating(true);
    setTimeout(() => {
      const res = filterToTarget(activeSels, effectiveTarget, mode);
      const bc = generateCode(res.combo, res.totalOdds, mode, effectiveTarget);
      setResult(res); setBookingCode(bc); setStep(3);
      onSlipSaved({ id: Date.now(), code: bc.shortCode, games: res.combo.length, odds: res.totalOdds, mode, target: effectiveTarget, stake: parseFloat(stake) || 0, date: new Date().toLocaleDateString() });
      setAnimating(false);
    }, 700);
  };

  const handleCopy = (text, key) => { navigator.clipboard.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(""), 2000); }); };
  const reset = () => { setRaw(""); setSelections([]); setParsed(false); setResult(null); setBookingCode(null); setStep(1); setParseError(""); };

  return (
    <div className="fu">
      {/* Steps */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "20px" }}>
        {[{n:1,l:"Paste"},{n:2,l:"Review"},{n:3,l:"Code"}].map((s, i) => (
          <div key={s.n} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
              <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: step >= s.n ? C.primary : "#fff", border: `2px solid ${step >= s.n ? C.primary : C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "700", color: step >= s.n ? "#fff" : C.textFaint, transition: "all .3s" }}>
                {step > s.n ? "✓" : s.n}
              </div>
              <span style={{ fontSize: "9px", fontWeight: "600", color: step >= s.n ? C.primary : C.textFaint }}>{s.l}</span>
            </div>
            {i < 2 && <div style={{ width: "56px", height: "2px", background: step > s.n ? C.primary : C.border, margin: "0 8px", marginBottom: "16px", borderRadius: "1px", transition: "background .3s" }} />}
          </div>
        ))}
      </div>

      {step === 1 && <>
        <Card>
          <SL>Paste Your Sportybet Slip</SL>
          <p style={{ fontSize: "12px", color: C.textSoft, marginBottom: "10px", lineHeight: "1.7" }}>Open Sportybet → Bet Slip → long-press → <b>Select All</b> → <b>Copy</b> → paste below.</p>
          <textarea value={raw} onChange={e => { setRaw(e.target.value); setParseError(""); }} placeholder={"Arsenal v Chelsea\n1X2 | Home Win\n1.85\n\nMan City v Liverpool\nOver 2.5\n1.72\n..."} style={{ width: "100%", minHeight: "180px", background: C.surfaceAlt, border: `1.5px solid ${C.border}`, borderRadius: "8px", color: C.text, padding: "12px", fontSize: "13px", fontFamily: "inherit", resize: "vertical", lineHeight: "1.7" }} />
          {parseError && <Alert type="error">{parseError}</Alert>}
          <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
            <Btn primary onClick={handleParse}>🔍 Parse Slip →</Btn>
            <Btn onClick={() => { setRaw(SAMPLE); setParseError(""); }}>Load Sample</Btn>
          </div>
        </Card>
        <Card style={{ marginTop: "12px", background: C.primaryLight, border: `1px solid ${C.primaryMid}` }}>
          <SL color={C.primary}>How It Works</SL>
          {[["1","Paste Sportybet slip — any copied format"],["2","Bot auto-detects matches, markets & odds"],["3","Set target odds (e.g. reduce 10,000x → 1,000x)"],["4","Filter & generate a shareable booking code"],["5","Slip auto-saved to History"]].map(([n, t]) => (
            <div key={n} style={{ display: "flex", gap: "10px", alignItems: "flex-start", marginBottom: "8px" }}>
              <div style={{ minWidth: "20px", height: "20px", borderRadius: "50%", background: C.primary, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "#fff", fontWeight: "700", flexShrink: 0 }}>{n}</div>
              <div style={{ fontSize: "12px", color: C.textMid, lineHeight: "1.6", paddingTop: "2px" }}>{t}</div>
            </div>
          ))}
        </Card>
      </>}

      {step === 2 && parsed && <>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "14px" }}>
          {[{l:"Selections",v:activeSels.length,c:C.primary,e:"📋"},{l:"Total Odds",v:inputTotal>1?inputTotal.toLocaleString(undefined,{maximumFractionDigits:0})+"x":"—",c:C.med,e:"📊"},{l:"Avg Odd",v:activeSels.length?(activeSels.reduce((a,s)=>a+s.odd,0)/activeSels.length).toFixed(2):"—",c:C.accent,e:"📈"}].map(s=>(
            <div key={s.l} style={{ background:"#fff",border:`1.5px solid ${C.border}`,borderRadius:"10px",padding:"12px 8px",textAlign:"center",boxShadow:"0 1px 4px rgba(26,86,219,.06)" }}>
              <div style={{ fontSize:"16px",marginBottom:"4px" }}>{s.e}</div>
              <div style={{ fontSize:"9px",color:C.textFaint,letterSpacing:"1px",marginBottom:"2px",textTransform:"uppercase" }}>{s.l}</div>
              <div style={{ fontSize:"18px",color:s.c,fontWeight:"700",fontFamily:"'Space Grotesk',sans-serif" }}>{s.v}</div>
            </div>
          ))}
        </div>

        <Card>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px" }}>
            <SL>Detected Selections</SL>
            <span style={{ fontSize:"10px",color:C.textFaint }}>tap to toggle</span>
          </div>
          <div style={{ display:"grid",gap:"6px",maxHeight:"260px",overflowY:"auto" }}>
            {selections.map(s => (
              <div key={s.id} onClick={() => toggleSel(s.id)} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",background:s.active?C.surfaceAlt:"#fafafa",border:`1.5px solid ${s.active?C.borderStrong:C.border}`,borderRadius:"8px",cursor:"pointer",opacity:s.active?1:.45,transition:"all .15s" }}>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontSize:"12px",fontWeight:"500",color:C.text }}><span style={{ color:s.active?C.primary:C.textFaint,marginRight:"6px" }}>{s.active?"●":"○"}</span>{s.match}</div>
                  {s.market && <div style={{ fontSize:"10px",color:C.textFaint,marginLeft:"14px" }}>{s.market}</div>}
                </div>
                <div style={{ display:"flex",flexDirection:"column",alignItems:"flex-end",marginLeft:"10px",gap:"3px" }}>
                  <span style={{ fontSize:"14px",fontWeight:"700",color:oddColor(s.odd) }}>{s.odd}x</span>
                  <span style={{ fontSize:"8px",fontWeight:"700",color:oddColor(s.odd),background:oddBg(s.odd),border:`1px solid ${oddBorder(s.odd)}`,padding:"1px 5px",borderRadius:"3px",letterSpacing:"1px" }}>{riskLabel(s.odd)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card style={{ marginTop:"12px" }}>
          <SL>Filter Settings</SL>
          <FL>Target Odds</FL>
          <div style={{ display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"8px" }}>
            {[50,200,500,1000,5000].map(t=>(
              <button key={t} className="btn" onClick={()=>{setTarget(t);setCustomTarget("")}} style={{ padding:"6px 12px",background:target===t&&!customTarget?C.primary:"#fff",border:`1.5px solid ${target===t&&!customTarget?C.primary:C.border}`,color:target===t&&!customTarget?"#fff":C.textMid,borderRadius:"7px",fontSize:"12px",fontWeight:"600",fontFamily:"inherit" }}>
                {t>=1000?`${t/1000}K`:t}
              </button>
            ))}
            <input type="number" placeholder="Custom" value={customTarget} onChange={e=>setCustomTarget(e.target.value)} style={{ width:"80px",background:"#fff",border:`1.5px solid ${customTarget?C.primary:C.border}`,color:C.text,padding:"6px 10px",borderRadius:"7px",fontSize:"12px",fontFamily:"inherit" }}/>
          </div>
          <div style={{ fontSize:"12px",color:C.textSoft,marginBottom:"14px" }}>
            Filtering <b style={{ color:C.med }}>{inputTotal.toLocaleString(undefined,{maximumFractionDigits:0})}x</b> → <b style={{ color:C.primary }}>{effectiveTarget?.toLocaleString()}x</b>
          </div>

          <FL>Safety Mode</FL>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginBottom:"14px" }}>
            {[{k:"safe",i:"🛡️",l:"Safe",d:"≤ 1.65"},{k:"balanced",i:"⚖️",l:"Balanced",d:"≤ 2.50"},{k:"value",i:"💎",l:"Value",d:"All"}].map(m=>(
              <button key={m.k} className="btn" onClick={()=>setMode(m.k)} style={{ padding:"11px 6px",background:mode===m.k?C.primaryLight:"#fff",border:`1.5px solid ${mode===m.k?C.primary:C.border}`,borderRadius:"9px",fontSize:"11px",fontFamily:"inherit",textAlign:"center",lineHeight:"1.5" }}>
                <div style={{ fontSize:"18px",marginBottom:"4px" }}>{m.i}</div>
                <div style={{ fontWeight:"700",color:mode===m.k?C.primary:C.textMid }}>{m.l}</div>
                <div style={{ fontSize:"10px",color:C.textFaint }}>{m.d}</div>
              </button>
            ))}
          </div>

          <FL>Stake <span style={{ color:C.textFaint,fontWeight:"400" }}>(optional)</span></FL>
          <input type="number" placeholder="e.g. 500" value={stake} onChange={e=>setStake(e.target.value)} style={{ background:"#fff",border:`1.5px solid ${C.border}`,color:C.text,padding:"9px 13px",borderRadius:"8px",fontSize:"14px",fontFamily:"inherit",width:"150px",marginBottom:"16px" }}/>

          <div style={{ display:"flex",gap:"10px" }}>
            <Btn primary onClick={handleFilter} disabled={activeSels.length<2||animating}>
              {animating?<><span className="spin">⚙</span> Generating...</>:"🎯 Filter & Get Code →"}
            </Btn>
            <Btn onClick={reset}>← Back</Btn>
          </div>
        </Card>
      </>}

      {step === 3 && result && bookingCode && <>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"14px" }}>
          {[{l:"Input Odds",v:`${inputTotal.toLocaleString(undefined,{maximumFractionDigits:0})}x`,c:C.med},{l:"Filtered Odds",v:`${result.totalOdds.toFixed(2)}x`,c:C.primary}].map(s=>(
            <div key={s.l} style={{ background:"#fff",border:`1.5px solid ${C.border}`,borderRadius:"12px",padding:"14px",textAlign:"center",boxShadow:"0 2px 8px rgba(26,86,219,.07)" }}>
              <div style={{ fontSize:"10px",color:C.textFaint,textTransform:"uppercase",letterSpacing:"1px",marginBottom:"4px" }}>{s.l}</div>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:"28px",fontWeight:"700",color:s.c }}>{s.v}</div>
            </div>
          ))}
        </div>

        {potWin && <div style={{ background:`linear-gradient(135deg,${C.primaryLight},#e0f2fe)`,border:`1.5px solid ${C.primaryMid}`,borderRadius:"12px",padding:"14px",marginBottom:"14px",textAlign:"center" }}>
          <div style={{ fontSize:"11px",color:C.primary,fontWeight:"600",letterSpacing:"1px" }}>POTENTIAL RETURN @ {parseFloat(stake).toLocaleString()} stake</div>
          <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:"30px",fontWeight:"700",color:C.primary }}>{fmt(parseFloat(potWin))}</div>
        </div>}

        {/* Booking code card */}
        <div style={{ background:`linear-gradient(135deg,${C.primary},#1e40af)`,borderRadius:"14px",padding:"22px",marginBottom:"14px",boxShadow:"0 6px 24px rgba(26,86,219,.3)" }}>
          <div style={{ textAlign:"center",marginBottom:"12px" }}>
            <span style={{ fontSize:"11px",color:"rgba(255,255,255,.7)",letterSpacing:"2px",fontWeight:"600" }}>🎟️ YOUR FILTER BOOKING CODE</span>
            <div style={{ fontSize:"11px",color:"rgba(255,255,255,.5)",marginTop:"3px" }}>{result.combo.length} games · {result.totalOdds.toFixed(2)}x · {mode}</div>
          </div>
          <div onClick={()=>handleCopy(bookingCode.shortCode,"short")} style={{ background:"rgba(255,255,255,.12)",border:"1.5px dashed rgba(255,255,255,.4)",borderRadius:"10px",padding:"16px",textAlign:"center",cursor:"pointer",marginBottom:"12px" }}>
            <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:"22px",fontWeight:"700",color:"#fff",letterSpacing:"4px",wordBreak:"break-all" }}>{bookingCode.shortCode}</div>
            <div style={{ fontSize:"10px",color:"rgba(255,255,255,.5)",marginTop:"5px" }}>👆 Tap to copy</div>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px" }}>
            <button className="btn" onClick={()=>handleCopy(bookingCode.shortCode,"short")} style={{ background:"#fff",border:"none",color:C.primary,padding:"11px",borderRadius:"8px",fontSize:"12px",fontWeight:"700",fontFamily:"inherit" }}>
              {copied==="short"?"✓ Copied!":"📋 Copy Code"}
            </button>
            <button className="btn" onClick={()=>handleCopy(`🎯 PascalFilterBot\n${bookingCode.shortCode}\n${result.combo.length} games · ${result.totalOdds.toFixed(2)}x\n\n${result.combo.map((s,i)=>`${i+1}. ${s.match} @ ${s.odd}x`).join("\n")}`, "share")} style={{ background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",color:"#fff",padding:"11px",borderRadius:"8px",fontSize:"12px",fontWeight:"600",fontFamily:"inherit" }}>
              {copied==="share"?"✓ Copied!":"📤 Share"}
            </button>
          </div>
        </div>

        <Card>
          <SL>{result.combo.length} Filtered Games</SL>
          <div style={{ display:"grid",gap:"7px" }}>
            {result.combo.map((s,i)=>(
              <div key={s.id} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 13px",background:C.surfaceAlt,border:`1.5px solid ${C.border}`,borderRadius:"8px" }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:"12px",fontWeight:"500",color:C.text }}><span style={{ color:C.textFaint,marginRight:"7px",fontSize:"11px" }}>{i+1}.</span>{s.match}</div>
                  {s.market&&<div style={{ fontSize:"10px",color:C.textFaint,marginLeft:"17px",marginTop:"1px" }}>{s.market}</div>}
                </div>
                <div style={{ display:"flex",flexDirection:"column",alignItems:"flex-end",marginLeft:"10px",gap:"3px" }}>
                  <span style={{ fontSize:"16px",fontWeight:"700",color:oddColor(s.odd) }}>{s.odd}x</span>
                  <span style={{ fontSize:"8px",fontWeight:"700",color:oddColor(s.odd),background:oddBg(s.odd),border:`1px solid ${oddBorder(s.odd)}`,padding:"1px 5px",borderRadius:"3px",letterSpacing:"1px" }}>{riskLabel(s.odd)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div style={{ display:"flex",gap:"10px",marginTop:"12px" }}>
          <Btn onClick={()=>{setStep(2);setResult(null);setBookingCode(null);}}>← Adjust</Btn>
          <Btn onClick={reset}>New Slip</Btn>
        </div>
        <div style={{ marginTop:"12px",padding:"10px 13px",background:C.warnBg,border:`1px solid ${C.medBorder}`,borderRadius:"8px",fontSize:"11px",color:C.med,lineHeight:"1.6" }}>
          ⚠️ Not an official Sportybet booking code. Add these games manually. Gamble responsibly.
        </div>
      </>}
    </div>
  );
}

// ─── BET TRACKER PAGE ─────────────────────────────────────────────────────────
function TrackerPage({ bets, onAdd, onUpdate, onDelete }) {
  const [form, setForm] = useState({ match: "", odds: "", stake: "", type: "single" });
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("all");

  const submit = () => {
    if (!form.match || !form.odds || !form.stake) return;
    onAdd({ id: Date.now(), match: form.match, odds: parseFloat(form.odds), stake: parseFloat(form.stake), type: form.type, status: "pending", date: new Date().toLocaleDateString(), potential: (parseFloat(form.odds) * parseFloat(form.stake)).toFixed(2) });
    setForm({ match: "", odds: "", stake: "", type: "single" }); setShowForm(false);
  };

  const filtered = bets.filter(b => filter === "all" ? true : b.status === filter);

  return (
    <div className="fu">
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px" }}>
        <div>
          <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:"18px",fontWeight:"700",color:C.text }}>Bet Tracker</div>
          <div style={{ fontSize:"11px",color:C.textSoft }}>{bets.length} bets logged</div>
        </div>
        <Btn primary onClick={()=>setShowForm(v=>!v)}>+ Log Bet</Btn>
      </div>

      {showForm && <Card style={{ marginBottom:"14px",border:`1.5px solid ${C.primary}` }}>
        <SL>Log New Bet</SL>
        <Field label="Match / Selection"><input value={form.match} onChange={e=>setForm(f=>({...f,match:e.target.value}))} placeholder="Man City v Arsenal" style={inputStyle()} /></Field>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px" }}>
          <Field label="Odds"><input type="number" value={form.odds} onChange={e=>setForm(f=>({...f,odds:e.target.value}))} placeholder="2.10" style={inputStyle()} /></Field>
          <Field label="Stake"><input type="number" value={form.stake} onChange={e=>setForm(f=>({...f,stake:e.target.value}))} placeholder="500" style={inputStyle()} /></Field>
        </div>
        <Field label="Type">
          <div style={{ display:"flex",gap:"7px" }}>
            {["single","accumulator","system"].map(t=>(
              <button key={t} className="btn" onClick={()=>setForm(f=>({...f,type:t}))} style={{ padding:"7px 12px",background:form.type===t?C.primary:"#fff",border:`1.5px solid ${form.type===t?C.primary:C.border}`,color:form.type===t?"#fff":C.textMid,borderRadius:"7px",fontSize:"11px",fontWeight:"600",fontFamily:"inherit",textTransform:"capitalize" }}>{t}</button>
            ))}
          </div>
        </Field>
        {form.odds && form.stake && <div style={{ padding:"9px 13px",background:C.primaryLight,border:`1px solid ${C.primaryMid}`,borderRadius:"7px",fontSize:"12px",color:C.primary,marginBottom:"10px" }}>
          Potential win: <b>{fmt(parseFloat(form.odds)*parseFloat(form.stake))}</b>
        </div>}
        <div style={{ display:"flex",gap:"10px" }}>
          <Btn primary onClick={submit}>Save Bet</Btn>
          <Btn onClick={()=>setShowForm(false)}>Cancel</Btn>
        </div>
      </Card>}

      {/* Filter */}
      <div style={{ display:"flex",gap:"6px",marginBottom:"14px",flexWrap:"wrap" }}>
        {["all","pending","won","lost"].map(f=>(
          <button key={f} className="btn" onClick={()=>setFilter(f)} style={{ padding:"6px 14px",background:filter===f?C.primary:"#fff",border:`1.5px solid ${filter===f?C.primary:C.border}`,color:filter===f?"#fff":C.textMid,borderRadius:"20px",fontSize:"11px",fontWeight:"600",fontFamily:"inherit",textTransform:"capitalize" }}>{f}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card style={{ textAlign:"center",padding:"40px 20px" }}>
          <div style={{ fontSize:"36px",marginBottom:"10px" }}>📝</div>
          <div style={{ color:C.textSoft,fontSize:"13px" }}>No bets logged yet. Click "Log Bet" to start tracking.</div>
        </Card>
      ) : (
        <div style={{ display:"grid",gap:"8px" }}>
          {filtered.map(b=>(
            <div key={b.id} style={{ background:"#fff",border:`1.5px solid ${C.border}`,borderRadius:"10px",padding:"14px",boxShadow:"0 1px 4px rgba(26,86,219,.05)" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"8px" }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:"13px",fontWeight:"600",color:C.text,marginBottom:"2px" }}>{b.match}</div>
                  <div style={{ fontSize:"10px",color:C.textFaint }}>{b.date} · <span style={{ textTransform:"capitalize" }}>{b.type}</span></div>
                </div>
                <span style={{ fontSize:"9px",fontWeight:"700",letterSpacing:"1px",padding:"3px 8px",borderRadius:"5px",background:b.status==="won"?C.safeBg:b.status==="lost"?C.riskyBg:C.primaryLight,color:b.status==="won"?C.safe:b.status==="lost"?C.risky:C.primary,border:`1px solid ${b.status==="won"?C.safeBorder:b.status==="lost"?C.riskyBorder:C.primaryMid}` }}>
                  {b.status.toUpperCase()}
                </span>
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginBottom:"10px" }}>
                {[{l:"Odds",v:`${b.odds}x`},{l:"Stake",v:fmt(b.stake)},{l:"Potential",v:fmt(b.potential)}].map(s=>(
                  <div key={s.l} style={{ background:C.surfaceAlt,borderRadius:"6px",padding:"7px 10px",textAlign:"center" }}>
                    <div style={{ fontSize:"9px",color:C.textFaint,marginBottom:"2px" }}>{s.l}</div>
                    <div style={{ fontSize:"13px",fontWeight:"700",color:C.textMid }}>{s.v}</div>
                  </div>
                ))}
              </div>
              {b.status === "pending" && (
                <div style={{ display:"flex",gap:"7px" }}>
                  <button className="btn" onClick={()=>onUpdate(b.id,{status:"won"})} style={{ flex:1,padding:"8px",background:C.safeBg,border:`1px solid ${C.safeBorder}`,color:C.safe,borderRadius:"7px",fontSize:"11px",fontWeight:"700",fontFamily:"inherit" }}>✅ Won</button>
                  <button className="btn" onClick={()=>onUpdate(b.id,{status:"lost"})} style={{ flex:1,padding:"8px",background:C.riskyBg,border:`1px solid ${C.riskyBorder}`,color:C.risky,borderRadius:"7px",fontSize:"11px",fontWeight:"700",fontFamily:"inherit" }}>❌ Lost</button>
                  <button className="btn" onClick={()=>onDelete(b.id)} style={{ padding:"8px 12px",background:"#fff",border:`1px solid ${C.border}`,color:C.textFaint,borderRadius:"7px",fontSize:"11px",fontFamily:"inherit" }}>🗑</button>
                </div>
              )}
              {b.status !== "pending" && (
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                  <div style={{ fontSize:"12px",color:b.status==="won"?C.safe:C.risky,fontWeight:"600" }}>
                    {b.status==="won"?`🎉 +${fmt(b.potential - b.stake)} profit`:`😔 -${fmt(b.stake)} lost`}
                  </div>
                  <button className="btn" onClick={()=>onDelete(b.id)} style={{ background:"none",border:"none",color:C.textFaint,fontSize:"12px",cursor:"pointer" }}>🗑</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DASHBOARD PAGE ───────────────────────────────────────────────────────────
function DashboardPage({ bets, user }) {
  const won = bets.filter(b => b.status === "won");
  const lost = bets.filter(b => b.status === "lost");
  const pending = bets.filter(b => b.status === "pending");
  const totalStaked = bets.filter(b=>b.status!=="pending").reduce((a,b)=>a+b.stake,0);
  const totalWon = won.reduce((a,b)=>a+parseFloat(b.potential),0);
  const profit = totalWon - totalStaked;
  const roi = totalStaked > 0 ? ((profit/totalStaked)*100).toFixed(1) : 0;
  const winRate = (won.length + lost.length) > 0 ? ((won.length/(won.length+lost.length))*100).toFixed(0) : 0;

  // Streak
  const settled = bets.filter(b=>b.status!=="pending").slice(0,10);
  let streak = 0, streakType = "";
  for (const b of settled) { if (!streakType) { streakType = b.status; streak = 1; } else if (b.status === streakType) streak++; else break; }

  const STATS = [
    { icon:"🎯",label:"Total Bets",value:bets.length,color:C.primary },
    { icon:"✅",label:"Won",value:won.length,color:C.safe },
    { icon:"❌",label:"Lost",value:lost.length,color:C.risky },
    { icon:"⏳",label:"Pending",value:pending.length,color:C.med },
    { icon:"💰",label:"Total Staked",value:totalStaked>0?fmt(totalStaked):"—",color:C.textMid },
    { icon:"📈",label:"Net P&L",value:totalStaked>0?(profit>=0?"+":"")+fmt(profit):"—",color:profit>=0?C.safe:C.risky },
    { icon:"🏆",label:"Win Rate",value:winRate+"%",color:parseInt(winRate)>=50?C.safe:C.risky },
    { icon:"📊",label:"ROI",value:roi+"%",color:parseFloat(roi)>=0?C.safe:C.risky },
  ];

  return (
    <div className="fu">
      <div style={{ marginBottom:"16px" }}>
        <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:"18px",fontWeight:"700",color:C.text }}>Stats Dashboard</div>
        <div style={{ fontSize:"11px",color:C.textSoft }}>Your betting performance overview</div>
      </div>

      {/* Welcome card */}
      <div style={{ background:`linear-gradient(135deg,${C.primary},#1e40af)`,borderRadius:"14px",padding:"18px",marginBottom:"16px",display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:"0 4px 16px rgba(26,86,219,.25)" }}>
        <div>
          <div style={{ fontSize:"12px",color:"rgba(255,255,255,.6)",marginBottom:"3px" }}>Welcome back,</div>
          <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:"20px",fontWeight:"700",color:"#fff" }}>{user.name}</div>
          <div style={{ fontSize:"11px",color:"rgba(255,255,255,.5)",marginTop:"3px" }}>Member since {new Date(user.joined).toLocaleDateString()}</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:"11px",color:"rgba(255,255,255,.6)" }}>Current streak</div>
          <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:"22px",fontWeight:"700",color:streakType==="won"?"#86efac":streakType==="lost"?"#fca5a5":"#fff" }}>
            {streak>0?`${streakType==="won"?"🔥":"💔"} ${streak}`:"—"}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"16px" }}>
        {STATS.map(s=>(
          <div key={s.label} style={{ background:"#fff",border:`1.5px solid ${C.border}`,borderRadius:"10px",padding:"14px",boxShadow:"0 1px 4px rgba(26,86,219,.05)" }}>
            <div style={{ display:"flex",alignItems:"center",gap:"7px",marginBottom:"6px" }}>
              <span style={{ fontSize:"18px" }}>{s.icon}</span>
              <span style={{ fontSize:"10px",color:C.textFaint,letterSpacing:".5px",textTransform:"uppercase" }}>{s.label}</span>
            </div>
            <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:"22px",fontWeight:"700",color:s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Visual bar */}
      {(won.length + lost.length) > 0 && <Card style={{ marginBottom:"14px" }}>
        <SL>Win / Loss Ratio</SL>
        <div style={{ height:"10px",background:C.riskyBg,borderRadius:"5px",overflow:"hidden",marginBottom:"8px" }}>
          <div style={{ height:"100%",width:`${winRate}%`,background:`linear-gradient(90deg,${C.safe},#4ade80)`,borderRadius:"5px",transition:"width .5s" }}/>
        </div>
        <div style={{ display:"flex",justifyContent:"space-between",fontSize:"11px",color:C.textSoft }}>
          <span style={{ color:C.safe }}>✅ {won.length} won ({winRate}%)</span>
          <span style={{ color:C.risky }}>❌ {lost.length} lost</span>
        </div>
      </Card>}

      {bets.length === 0 && <Card style={{ textAlign:"center",padding:"40px 20px" }}>
        <div style={{ fontSize:"36px",marginBottom:"10px" }}>📊</div>
        <div style={{ color:C.textSoft,fontSize:"13px" }}>No data yet. Log bets in the Tracker to see your stats.</div>
      </Card>}
    </div>
  );
}

// ─── HISTORY PAGE ─────────────────────────────────────────────────────────────
function HistoryPage({ slips }) {
  const [copied, setCopied] = useState("");
  const copy = (text, key) => { navigator.clipboard.writeText(text).then(()=>{ setCopied(key); setTimeout(()=>setCopied(""),2000); }); };

  return (
    <div className="fu">
      <div style={{ marginBottom:"16px" }}>
        <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:"18px",fontWeight:"700",color:C.text }}>Slip History</div>
        <div style={{ fontSize:"11px",color:C.textSoft }}>{slips.length} saved slips</div>
      </div>

      {slips.length === 0 ? (
        <Card style={{ textAlign:"center",padding:"40px 20px" }}>
          <div style={{ fontSize:"36px",marginBottom:"10px" }}>📜</div>
          <div style={{ color:C.textSoft,fontSize:"13px" }}>No slips saved yet. Filter a slip to see it here automatically.</div>
        </Card>
      ) : (
        <div style={{ display:"grid",gap:"10px" }}>
          {slips.map((s,i)=>(
            <div key={s.id} style={{ background:"#fff",border:`1.5px solid ${C.border}`,borderRadius:"11px",padding:"14px",boxShadow:"0 1px 4px rgba(26,86,219,.05)" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"10px" }}>
                <div>
                  <div style={{ fontSize:"11px",color:C.textFaint,marginBottom:"3px" }}>#{slips.length - i} · {s.date}</div>
                  <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:"16px",fontWeight:"700",color:C.primary }}>{s.odds.toFixed(2)}x odds</div>
                  <div style={{ fontSize:"11px",color:C.textSoft }}>{s.games} games · {s.mode} · target {s.target?.toLocaleString()}x</div>
                </div>
                {s.stake>0&&<div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:"9px",color:C.textFaint }}>Stake</div>
                  <div style={{ fontSize:"14px",fontWeight:"700",color:C.textMid }}>{fmt(s.stake)}</div>
                </div>}
              </div>
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",background:C.primaryLight,border:`1px solid ${C.primaryMid}`,borderRadius:"7px",padding:"9px 12px" }}>
                <div style={{ fontSize:"12px",fontWeight:"700",color:C.primary,letterSpacing:"1px",fontFamily:"'Space Grotesk',sans-serif" }}>{s.code}</div>
                <button className="btn" onClick={()=>copy(s.code,s.id)} style={{ background:C.primary,border:"none",color:"#fff",padding:"5px 12px",borderRadius:"5px",fontSize:"10px",fontWeight:"700",fontFamily:"inherit" }}>
                  {copied===s.id?"✓":"Copy"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── REDEEM PAGE ──────────────────────────────────────────────────────────────
function RedeemPage() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const handle = () => {
    setError(""); setResult(null);
    const data = decodeCode(input.trim());
    if (!data) { setError("Invalid or expired code. Make sure you copied it fully."); return; }
    setResult(data);
  };

  return (
    <div className="fu">
      <div style={{ marginBottom:"16px" }}>
        <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:"18px",fontWeight:"700",color:C.text }}>Redeem Code</div>
        <div style={{ fontSize:"11px",color:C.textSoft }}>Decode a filter code shared with you</div>
      </div>

      <Card>
        <SL>Enter Filter Code</SL>
        <p style={{ fontSize:"12px",color:C.textSoft,marginBottom:"10px",lineHeight:"1.7" }}>
          Paste a code like <code style={{ background:C.primaryLight,color:C.primary,padding:"1px 5px",borderRadius:"4px",fontSize:"11px" }}>SPFT-XXXXXX-XXXXXX-XXXXXX</code> or full decode key.
        </p>
        <input value={input} onChange={e=>{setInput(e.target.value);setError("");setResult(null);}} placeholder="SPFT-ABC123-DEF456-GHI789" style={{ ...inputStyle(),letterSpacing:"1.5px",marginBottom:"10px" }} />
        {error && <Alert type="error">{error}</Alert>}
        <Btn primary onClick={handle}>🔑 Decode →</Btn>
      </Card>

      {result && <div style={{ marginTop:"14px" }}>
        <div style={{ background:`linear-gradient(135deg,${C.primary},#1e40af)`,borderRadius:"14px",padding:"20px",boxShadow:"0 4px 16px rgba(26,86,219,.25)" }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px" }}>
            <div>
              <div style={{ fontSize:"11px",color:"rgba(255,255,255,.6)",letterSpacing:"2px" }}>DECODED SLIP</div>
              <div style={{ fontSize:"14px",color:"#fff",fontWeight:"600",marginTop:"3px" }}>{result.g?.length} games · <span style={{ color:"#93c5fd" }}>{result.o}x</span></div>
              <div style={{ fontSize:"11px",color:"rgba(255,255,255,.5)",marginTop:"1px" }}>{result.m==="s"?"Safe":result.m==="b"?"Balanced":"Value"} mode</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:"9px",color:"rgba(255,255,255,.5)" }}>TARGET</div>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:"20px",fontWeight:"700",color:"#fbbf24" }}>{result.t?.toLocaleString()}x</div>
            </div>
          </div>
          <div style={{ display:"grid",gap:"7px" }}>
            {result.g?.map((g,i)=>(
              <div key={i} style={{ background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.15)",borderRadius:"8px",padding:"11px 13px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:"12px",fontWeight:"500",color:"#fff" }}><span style={{ color:"rgba(255,255,255,.4)",marginRight:"7px" }}>{i+1}.</span>{g.n}</div>
                  {g.k&&<div style={{ fontSize:"10px",color:"rgba(255,255,255,.4)",marginLeft:"17px",marginTop:"1px" }}>{g.k}</div>}
                </div>
                <div style={{ display:"flex",flexDirection:"column",alignItems:"flex-end",marginLeft:"10px",gap:"2px" }}>
                  <span style={{ fontSize:"15px",fontWeight:"700",color:"#fff" }}>{g.d}x</span>
                  <span style={{ fontSize:"8px",fontWeight:"700",color:oddColor(g.d),background:oddBg(g.d),padding:"1px 5px",borderRadius:"3px",letterSpacing:"1px" }}>{riskLabel(g.d)}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop:"12px",background:"rgba(0,0,0,.15)",borderRadius:"7px",padding:"10px 12px",fontSize:"11px",color:"rgba(255,255,255,.5)",lineHeight:"1.7" }}>
            📌 Open Sportybet, search each match and add the selection manually, then place your bet.
          </div>
        </div>
      </div>}

      {!result && !error && <Card style={{ marginTop:"12px",background:C.primaryLight,border:`1px solid ${C.primaryMid}` }}>
        <SL color={C.primary}>How Codes Work</SL>
        {[["Generate","Filter a slip in the Filter tab → get a booking code"],["Share","Send via WhatsApp or Telegram"],["Redeem","Paste the code here to see all filtered games"],["Bet","Add games manually on Sportybet and place your bet"]].map(([h,t])=>(
          <div key={h} style={{ display:"flex",gap:"10px",alignItems:"flex-start",marginBottom:"10px" }}>
            <div style={{ minWidth:"20px",height:"20px",borderRadius:"50%",background:C.primary,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",color:"#fff",fontWeight:"700",flexShrink:0 }}>→</div>
            <div>
              <div style={{ fontSize:"12px",fontWeight:"600",color:C.primary }}>{h}</div>
              <div style={{ fontSize:"11px",color:C.textMid,lineHeight:"1.5" }}>{t}</div>
            </div>
          </div>
        ))}
      </Card>}
    </div>
  );
}

// ─── SHARED UI ────────────────────────────────────────────────────────────────
function Card({ children, style }) { return <div style={{ background:"#fff",border:`1.5px solid ${C.border}`,borderRadius:"12px",padding:"16px",boxShadow:"0 1px 6px rgba(26,86,219,.05)",...style }}>{children}</div>; }
function SL({ children, color }) { return <div style={{ fontSize:"10px",fontWeight:"700",color:color||C.primary,letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:"10px" }}>{children}</div>; }
function FL({ children }) { return <div style={{ fontSize:"12px",fontWeight:"600",color:C.textMid,marginBottom:"7px" }}>{children}</div>; }
function Field({ label, children }) { return <div style={{ marginBottom:"12px" }}><FL>{label}</FL>{children}</div>; }
function Btn({ children, primary, onClick, disabled }) {
  return <button className="btn" onClick={onClick} disabled={disabled} style={{ background:primary?`linear-gradient(135deg,${C.primary},${C.primaryDark})`:"#fff",border:`1.5px solid ${primary?C.primary:C.border}`,color:primary?"#fff":C.textMid,padding:"11px 20px",borderRadius:"8px",fontSize:"13px",fontWeight:"600",letterSpacing:".2px",opacity:disabled?.5:1 }}>{children}</button>;
}
function Alert({ children, type }) { return <div style={{ padding:"9px 12px",background:type==="error"?C.riskyBg:C.successBg,border:`1px solid ${type==="error"?C.riskyBorder:C.safeBorder}`,borderRadius:"7px",fontSize:"12px",color:type==="error"?C.risky:C.safe,marginBottom:"10px" }}>⚠️ {children}</div>; }
function inputStyle() { return { width:"100%",background:"#fff",border:`1.5px solid ${C.border}`,color:C.text,padding:"10px 13px",borderRadius:"8px",fontSize:"13px",fontFamily:"inherit" }; }
