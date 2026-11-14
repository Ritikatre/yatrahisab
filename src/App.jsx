import { useState, useEffect, useMemo, useRef } from "react";
import { Mic, Camera, Send, Settings, Plus, Trash2, Pencil, Undo2, Copy, Download, Upload, X, Loader2, Search, RotateCcw, Users } from "lucide-react";

/* ───────── helpers ───────── */
const CATS = ["Food", "Hotel", "Travel", "Darshan/Tickets", "Misc"];
const LS = "yatrahisab.v1";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const fmt = (n) => "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const uid = () => Math.random().toString(36).slice(2, 9);
const low = (s) => (s || "").trim().toLowerCase();
const fmtDT = (iso) => {
  const d = new Date(iso);
  return [d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }), d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })];
};

function parseMembers(text) {
  const seen = new Set();
  return text
    .split(/[\n,;]+/)
    .map((s) => s.replace(/^\s*\d+\s*[.)\-:]\s*/, "").trim())
    .filter((s) => s && !seen.has(low(s)) && seen.add(low(s)))
    .map((name) => ({ id: uid(), name }));
}

const TYPE_UI = {
  IN: { l: "AAWAK / IN", c: "bg-green-100 text-green-800", t: "text-green-800", s: "+" },
  OUT: { l: "JAAWAK / OUT", c: "bg-red-100 text-red-800", t: "text-red-800", s: "-" },
  PERSONAL: { l: "PERSONAL / OUT", c: "bg-violet-100 text-violet-800", t: "text-violet-800", s: "-" },
};

/* Devanagari → Hinglish, then phonetic fuzzy name matching */
const pairs = (x) => Object.fromEntries(x.split(" ").map((y) => y.split(":")));
const CONS_M = pairs("क:k ख:kh ग:g घ:gh च:ch छ:chh ज:j झ:jh ट:t ठ:th ड:d ढ:dh ण:n त:t थ:th द:d ध:dh न:n प:p फ:f ब:b भ:bh म:m य:y र:r ल:l व:v श:sh ष:sh स:s ह:h ळ:l");
const VOW_M = pairs("अ:a आ:aa इ:i ई:ee उ:u ऊ:oo ऋ:ri ए:e ऐ:ai ओ:o औ:au ऑ:o");
const MAT_M = pairs("ा:aa ि:i ी:ee ु:u ू:oo े:e ै:ai ो:o ौ:au ॉ:o ृ:ri ं:n ँ:n ः:h");
const HI_WORDS = {
  "ऑनलाइन": "online", "ऑनलाईन": "online", "ओनलाइन": "online", "कैश": "cash", "केश": "cash", "नकद": "cash", "नगद": "cash",
  "रुपये": "", "रुपए": "", "रूपये": "", "रुपया": "", "रु": "", "जमा": "jama", "खर्च": "kharch", "खर्चा": "kharch", "खर्चे": "kharch",
  "दिए": "diye", "दिये": "diye", "दिया": "diya", "होटल": "hotel", "खाना": "khana", "खाने": "khane", "नाश्ता": "nashta", "नाश्ते": "nashte",
  "चाय": "chai", "टिकट": "ticket", "दर्शन": "darshan", "बस": "bus", "टैक्सी": "taxi", "पेट्रोल": "petrol", "डीजल": "diesel",
  "अपने": "apne", "लिए": "liye", "पर्सनल": "personal", "निजी": "niji", "एडवांस": "advance", "अग्रिम": "advance",
  "यूपीआई": "upi", "गूगल": "google", "फोन": "phone", "पे": "pe", "पेटीएम": "paytm", "और": "aur", "ने": "ne", "से": "se",
  "का": "ka", "की": "ki", "में": "me", "हुआ": "hua", "हुए": "hue", "हजार": "hazar", "हज़ार": "hazar", "बिल": "bill",
  "कमरा": "room", "पार्किंग": "parking", "टोल": "toll", "प्रसाद": "prasad", "पूजा": "puja", "आरती": "aarti", "भोजन": "bhojan",
};
const hasDev = (x) => /[\u0900-\u097F]/.test(x || "");

function translit(w) {
  const cs = [...w.normalize("NFC")];
  let o = "";
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c === "्" || c === "़") continue;
    if (CONS_M[c]) {
      o += CONS_M[c];
      let j = i + 1;
      while (cs[j] === "़") j++;
      const n = cs[j];
      const isSign = n && MAT_M[n] && !"ंँः".includes(n);
      if (n && /[\u0900-\u097F]/.test(n) && n !== "्" && !isSign) o += "a";
    } else if (VOW_M[c]) o += VOW_M[c];
    else if (MAT_M[c]) o += MAT_M[c];
    else if (/[०-९]/.test(c)) o += "०१२३४५६७८९".indexOf(c);
    else o += c;
  }
  return o;
}

function toHinglish(text) {
  if (!hasDev(text)) return text;
  return text
    .split(/(\s+)/)
    .map((w) => {
      const core = w.replace(/[,.।!?]+$/, "");
      return (HI_WORDS[core] ?? translit(core)) + w.slice(core.length).replace("।", ".");
    })
    .join("")
    .trim();
}

const STOP = /^(ne|aur|and|se|ka|ki|me|ko|cash|online|upi|diye|diya|jama|kharch|kharcha|hua|hue|hotel|bill|bus|taxi|room|food|chai|khana|nashta|nashte|apne|liye|personal|niji|advance|ticket|darshan|rs|rupaye|rupees|paid|spent|for|of|the|gpay|paytm|bank|hazar|pe|me)$/;
const phon = (x) => {
  const t = low(toHinglish(x)).replace(/[^a-z]/g, "").replace(/ph/g, "f").replace(/w/g, "v").replace(/[zx]/g, "j").replace(/([kgbdtpjcs])h/g, "$1");
  return (t[0] || "") + t.slice(1).replace(/[aeiouy]/g, "").replace(/(.)\1+/g, "$1");
};
const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
/* Finds the member whose name sounds closest to any word in `text` (Hindi or Hinglish spelling variants OK). */
function findMember(text, names) {
  const tp = low(toHinglish(text || "")).split(/[^a-z]+/).filter((w) => w.length >= 2 && !STOP.test(w)).map(phon).filter((p) => p.length >= 2);
  let best = null;
  for (const n of names) {
    let hit = 0, dist = 9;
    n.split(/\s+/).filter((x) => x.length >= 2).map(phon).forEach((pp) => {
      const b = Math.min(9, ...tp.map((p) => lev(p, pp)));
      if (b <= (pp.length >= 4 ? 1 : 0)) { hit++; dist = Math.min(dist, b); }
    });
    if (hit && (!best || hit > best.hit || (hit === best.hit && dist < best.dist))) best = { n, hit, dist };
  }
  return best?.n || "";
}

function useStore() {
  const empty = { trips: [], active: null, key: "" };
  const [s, setS] = useState(() => { try { return JSON.parse(localStorage.getItem(LS)) || empty; } catch { return empty; } });
  useEffect(() => { try { localStorage.setItem(LS, JSON.stringify(s)); } catch {} }, [s]);
  return [s, setS];
}

/* ───────── AI: demo parser + Gemini ───────── */
const MODE_RX = /online|upi|gpay|google ?p[ae]y?|phone ?p[ae]y?|paytm|bank|neft|imps/i;
const CAT_RX = [
  ["Hotel", /hotel|room|dharamshala|lodge|stay|advance/i],
  ["Food", /khana|khane|nashta|nashte|chai|lunch|dinner|breakfast|food|dhaba|restaurant|bhojan|prasad/i],
  ["Travel", /bus|taxi|cab|petrol|diesel|fuel|toll|train|travel|gaadi|parking/i],
  ["Darshan/Tickets", /darshan|ticket|entry|pooja|puja|helicopter|pass|aarti/i],
  ["Misc", /./],
];

function demoParse(text, names) {
  const parts = toHinglish(text).split(/\s+(?:aur|and|&)\s+|[;\n]+/i).map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const m = p.match(/(\d[\d,]*(?:\.\d+)?)\s*(k\b|hazar|hazaar)?/i);
    if (!m) continue;
    let amount = parseFloat(m[1].replace(/,/g, ""));
    if (m[2]) amount *= 1000;
    const mem = findMember(p, names);
    const personal = !!mem && /apne liye|personal|niji|khud (?:ke|ka)/i.test(p);
    const isOut = mem
      ? /kharch|kharcha|spent|expense|bill/i.test(p) && !/diye|diya|jama/i.test(p)
      : !/jama|received|collected|mila|diye|diya/i.test(p);
    const type = personal ? "PERSONAL" : isOut ? "OUT" : "IN";
    out.push({
      type,
      member: type === "OUT" ? "" : mem || "",
      description: p,
      category: type === "IN" ? "Aawak" : type === "PERSONAL" ? "Personal" : CAT_RX.find(([, rx]) => rx.test(p))[0],
      mode: MODE_RX.test(p) ? "Online" : "Cash",
      amount,
      date: "",
    });
  }
  return out;
}

async function gemini(key, parts, names) {
  const today = new Date().toISOString().slice(0, 10);
  const sys = `You parse Indian group-trip ledger entries written in Hinglish, Hindi or English. Return ONLY a JSON array, one object per transaction (split multi-entry sentences).
AAWAK = money received from a member -> type "IN". JAAWAK = shared group expense -> type "OUT". PERSONAL = an expense for ONE member's own use (apne liye, personal, niji, shopping for himself/herself) -> type "PERSONAL", category "Personal"; never put these in OUT.
member: for IN and PERSONAL, the closest exact name from ${JSON.stringify(names)}. Input may be Devanagari or Hinglish with spelling variations (Ramesh / Rameesh / रमेश): match phonetically. For OUT, vendor name or "".
mode: "Cash" or "Online" (UPI/GPay/PhonePe/bank = Online; default Cash).
category: for OUT one of ${CATS.join(", ")}; for IN use "Aawak".
amount: number in INR. description: short. date: YYYY-MM-DD if printed on a receipt, else "". Today is ${today}.`;
  const body = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0,
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            type: { type: "STRING", enum: ["IN", "OUT", "PERSONAL"] },
            member: { type: "STRING" },
            description: { type: "STRING" },
            category: { type: "STRING" },
            mode: { type: "STRING", enum: ["Cash", "Online"] },
            amount: { type: "NUMBER" },
            date: { type: "STRING" },
          },
          required: ["type", "amount", "mode", "description", "category"],
        },
      },
    },
  };
  let r;
  try {
    r = await fetch(GEMINI, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Internet nahi hai. Offline me sirf Demo Mode (bina API key) chalta hai.");
  }
  if (!r.ok) {
    if (r.status === 400 || r.status === 403) throw new Error("Gemini API key galat ya blocked hai. Settings me check karein.");
    if (r.status === 429) throw new Error("Gemini quota khatam ho gaya. Thodi der baad try karein.");
    throw new Error(`Gemini error (${r.status}). Dobara try karein.`);
  }
  const j = await r.json();
  const t = j.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  try { return JSON.parse(t.replace(/```json|```/g, "").trim()); } catch { throw new Error("AI ka jawab samajh nahi aaya. Dobara try karein."); }
}

function toTx(i) {
  let ts = new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(i.date || "")) {
    const d = new Date(`${i.date}T${new Date().toTimeString().slice(0, 8)}`);
    if (!isNaN(d)) ts = d.toISOString();
  }
  const type = ["IN", "PERSONAL"].includes(i.type) ? i.type : "OUT";
  return { id: uid(), ts, type, member: i.member || "", desc: i.description || "", cat: type === "IN" ? "Aawak" : type === "PERSONAL" ? "Personal" : CATS.includes(i.category) ? i.category : "Misc", mode: i.mode === "Online" ? "Online" : "Cash", amt: Number(i.amount) || 0 };
}

function shrinkImage(file, max = 1280) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = img.width * k; c.height = img.height * k;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL("image/jpeg", 0.8).split(",")[1]);
    };
    img.onerror = () => rej(new Error("Photo khul nahi paayi."));
    img.src = URL.createObjectURL(file);
  });
}

/* ───────── small UI bits ───────── */
const btn = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition active:scale-95";
const inp = "w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-indigo-700 focus:outline-none";

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close"><X /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ───────── Setup ───────── */
function Setup({ onCreate, onCancel }) {
  const [f, setF] = useState({ name: "", date: new Date().toISOString().slice(0, 10), target: 5000, list: "" });
  const members = useMemo(() => parseMembers(f.list), [f.list]);
  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <h1 className="text-2xl font-extrabold text-indigo-950">Naya Yatra Sheet</h1>
      <input className={inp} placeholder="Trip name, e.g. Vaishno Devi Yatra 2026" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-medium">Start date<input type="date" className={inp} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="text-sm font-medium">Per-person target (₹)<input type="number" className={inp} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></label>
      </div>
      <label className="block text-sm font-medium">
        WhatsApp se member list paste karein (1. Ramesh / comma / har line me ek naam)
        <textarea rows={8} className={inp} value={f.list} onChange={(e) => setF({ ...f, list: e.target.value })} placeholder={"1. Ramesh Sharma\n2. Suresh Patel\n3. Mohan"} />
      </label>
      <p className="text-sm text-slate-600">{members.length} members mile</p>
      <div className="flex gap-2">
        <button disabled={!f.name.trim() || !members.length} className={`${btn} flex-1 bg-indigo-950 text-white disabled:opacity-40`} onClick={() => onCreate({ id: uid(), name: f.name.trim(), date: f.date, target: Number(f.target) || 0, members, tx: [] })}>Generate Trip Sheet</button>
        {onCancel && <button className={`${btn} border-2 border-slate-300`} onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

/* ───────── Command bar ───────── */
function CommandBar({ onRun, busy, onErr, demo }) {
  const [text, setText] = useState("");
  const [lang, setLang] = useState("hi-IN");
  const [on, setOn] = useState(false);
  const file = useRef();
  const recRef = useRef();
  const submit = (t = text) => { if (t.trim()) { onRun(t.trim()); setText(""); } };
  const hint = " Tab tak phone keyboard ke 🎤 se bolkar bar me likh sakte hain (Hindi bhi chalegi).";
  const fail = (m) => { setOn(false); onErr(m + hint); };
  // Runs when speech recognition says "not allowed": finds out whether the mic itself or the browser's speech service is the problem.
  const diagnose = async (code) => {
    if (/; wv\)|FBAN|FBAV|Instagram|WhatsApp|Telegram/i.test(navigator.userAgent)) return fail(`Ye in-app browser hai, isme voice kaam nahi karta. Link ko Chrome me kholein. (${code})`);
    if (navigator.brave) return fail(`Brave me voice typing band hota hai. Chrome use karein. (${code})`);
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true });
      st.getTracks().forEach((x) => x.stop());
      fail(`Mic chal raha hai, par is browser ki speech service band hai. Chrome use karein; iPhone par Settings me Dictation/Siri on karein. (${code})`);
    } catch (e) {
      fail(
        e.name === "NotReadableError" ? "Mic kisi aur app ya tab me use ho raha hai. Use band karke dobara dabayein."
        : e.name === "NotFoundError" ? "Is device me mic nahi mila."
        : window.self !== window.top ? "Ye page iframe/preview me khula hai, isliye mic block hai. Page ko naye tab me (full window) kholein."
        : `Mic blocked hai. 🔒 icon → Site settings → Microphone → Allow karein, phir page reload karein. (${e.name})`
      );
    }
  };
  const listen = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return fail("Is browser me voice support nahi hai. Chrome use karein.");
    if (!window.isSecureContext) return fail("Mic ke liye HTTPS ya localhost chahiye.");
    if (on) return recRef.current?.stop();
    const r = new SR();
    recRef.current = r;
    r.lang = lang; r.interimResults = true; r.maxAlternatives = 1;
    r.onstart = () => setOn(true); // popup "Allow" hone ke baad hi ye chalta hai
    r.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      if (res.isFinal) submit(res[0].transcript); // final text → entry banta hai
      else setText(res[0].transcript); // bolte waqt bar me live text dikhta hai
    };
    r.onerror = (e) => {
      setOn(false);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") diagnose(e.error);
      else if (e.error === "no-speech") onErr("Kuch sunai nahi diya. Mic ke paas bolkar dobara dabayein.");
      else if (e.error === "audio-capture") onErr("Mic se awaaz nahi aa rahi. Kya mic kisi aur app me chal raha hai?");
      else if (e.error === "language-not-supported") onErr("Ye bhasha is browser me supported nahi. हि/EN toggle badal kar dekhein.");
      else if (e.error !== "aborted") onErr(`Voice error: ${e.error}`);
    };
    r.onend = () => setOn(false);
    try { r.start(); } catch { setOn(false); onErr("Voice shuru nahi hua, dobara dabayein."); }
  };
  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    try { onRun(text.trim(), await shrinkImage(f)); setText(""); } catch (x) { onErr(x.message); }
  };
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t-4 border-amber-400 bg-indigo-950 p-3">
      <div className="mx-auto flex max-w-3xl items-center gap-2">
        <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
        <button aria-label="Scan bill" className={`${btn} bg-white/10 text-white`} onClick={() => file.current.click()}><Camera size={20} /></button>
        <input className="min-w-0 flex-1 rounded-lg bg-white px-3 py-3 text-base text-slate-900 outline-none" placeholder={demo ? "Demo: Ramesh ne 5000 online diye" : "Bolo ya likho: Suresh 3000 cash jama"} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <button className={`${btn} text-xs ${on ? "bg-red-500" : "bg-white/10"} text-white`} onClick={() => setLang(lang === "hi-IN" ? "en-IN" : "hi-IN")} aria-label="Voice language">{lang === "hi-IN" ? "हि" : "EN"}</button>
        <button aria-label="Voice" className={`${btn} ${on ? "animate-pulse bg-red-500" : "bg-white/10"} text-white`} onClick={listen}><Mic size={20} /></button>
        <button aria-label="Send" disabled={busy} className={`${btn} bg-amber-400 text-indigo-950`} onClick={() => submit()}>{busy ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}</button>
      </div>
    </div>
  );
}

/* ───────── Entry form (add / edit) ───────── */
function EntryModal({ init, members, onSave, onClose }) {
  const [t, setT] = useState(init);
  const set = (k, v) => setT({ ...t, [k]: v });
  return (
    <Modal title={init.id ? "Entry edit karein" : "Naya entry"} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[["IN", "Aawak", "border-green-700 bg-green-700"], ["OUT", "Jaawak", "border-red-700 bg-red-700"], ["PERSONAL", "Personal", "border-violet-700 bg-violet-700"]].map(([v, l, c]) => (
            <button key={v} className={`${btn} border-2 ${t.type === v ? `${c} text-white` : "border-slate-300"}`} onClick={() => setT({ ...t, type: v, cat: v === "IN" ? "Aawak" : v === "PERSONAL" ? "Personal" : "Misc" })}>{l}</button>
          ))}
        </div>
        {t.type !== "OUT" ? (
          <select className={inp} value={t.member} onChange={(e) => set("member", e.target.value)}>
            <option value="">Member chunein</option>
            {members.map((m) => <option key={m.id}>{m.name}</option>)}
          </select>
        ) : (
          <>
            <input className={inp} placeholder="Vendor (optional)" value={t.member} onChange={(e) => set("member", e.target.value)} />
            <select className={inp} value={t.cat} onChange={(e) => set("cat", e.target.value)}>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
          </>
        )}
        <input className={inp} placeholder="Description" value={t.desc} onChange={(e) => set("desc", e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <input type="number" className={inp} placeholder="Amount ₹" value={t.amt || ""} onChange={(e) => set("amt", Number(e.target.value))} />
          <select className={inp} value={t.mode} onChange={(e) => set("mode", e.target.value)}><option>Cash</option><option>Online</option></select>
        </div>
        <button disabled={!t.amt || (t.type !== "OUT" && !t.member)} className={`${btn} w-full bg-indigo-950 text-white disabled:opacity-40`} onClick={() => onSave(t)}>Save karein</button>
      </div>
    </Modal>
  );
}

/* ───────── Settings ───────── */
function SettingsModal({ store, setStore, trip, onClose }) {
  const [key, setKey] = useState(store.key);
  const imp = useRef();
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ trips: store.trips, active: store.active }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "yatrahisab-backup.json"; a.click();
  };
  const importJson = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!Array.isArray(d.trips)) throw 0;
      setStore((s) => ({ ...s, trips: d.trips, active: d.active || d.trips[0]?.id || null })); onClose();
    } catch { alert("Ye valid backup file nahi hai."); }
  };
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">Google Gemini API key</label>
          <input type="password" className={inp} placeholder="AIza…" value={key} onChange={(e) => setKey(e.target.value)} />
          <p className="mt-1 text-xs text-slate-600">Key sirf is phone/browser ke localStorage me rehti hai. Khaali chhodne par Demo Mode chalega (bill scan band).</p>
          <button className={`${btn} mt-2 bg-indigo-950 text-white`} onClick={() => { setStore((s) => ({ ...s, key: key.trim() })); onClose(); }}>Key save karein</button>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t pt-4">
          <button className={`${btn} border-2 border-slate-300`} onClick={exportJson}><Download size={16} />Backup export</button>
          <button className={`${btn} border-2 border-slate-300`} onClick={() => imp.current.click()}><Upload size={16} />Backup import</button>
          <input ref={imp} type="file" accept="application/json" hidden onChange={importJson} />
          {trip && <button className={`${btn} border-2 border-red-700 text-red-700`} onClick={() => { if (confirm(`"${trip.name}" delete karein?`)) { setStore((s) => { const trips = s.trips.filter((t) => t.id !== trip.id); return { ...s, trips, active: trips[0]?.id || null }; }); onClose(); } }}><Trash2 size={16} />Ye trip delete</button>}
          <button className={`${btn} border-2 border-red-700 text-red-700`} onClick={() => { if (confirm("Saara data hamesha ke liye mitayein?")) { setStore({ trips: [], active: null, key: "" }); onClose(); } }}><RotateCcw size={16} />Reset all</button>
        </div>
      </div>
    </Modal>
  );
}

/* ───────── Tabs ───────── */
function MembersTab({ trip, sum, upd, addEntry }) {
  const [nm, setNm] = useState("");
  const rows = trip.members.map((m) => {
    const mine = trip.tx.filter((t) => t.type === "IN" && low(t.member) === low(m.name));
    const on = mine.filter((t) => t.mode === "Online").reduce((a, t) => a + t.amt, 0);
    const ca = mine.filter((t) => t.mode === "Cash").reduce((a, t) => a + t.amt, 0);
    const pe = trip.tx.filter((t) => t.type === "PERSONAL" && low(t.member) === low(m.name)).reduce((a, t) => a + t.amt, 0);
    return { m, on, ca, pe, paid: on + ca, diff: on + ca - sum.perHead - pe };
  });
  return (
    <div>
      <div className="overflow-x-auto rounded-xl border-2 border-slate-200 bg-white">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="bg-slate-100 font-semibold"><tr>{["Member", "Target", "Online", "Cash", "Total Paid", "Per-Head", "Personal", "Status", ""].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map(({ m, on, ca, pe, paid, diff }) => {
              const d = Math.round(diff);
              return (
                <tr key={m.id} className="border-t">
                  <td className="px-3 py-2 font-semibold">{m.name}</td>
                  <td className="px-3 py-2">{fmt(trip.target)}</td>
                  <td className="px-3 py-2">{fmt(on)}</td>
                  <td className="px-3 py-2">{fmt(ca)}</td>
                  <td className="px-3 py-2 font-bold">{fmt(paid)}</td>
                  <td className="px-3 py-2">{fmt(sum.perHead)}</td>
                  <td className="px-3 py-2 text-violet-800">{pe ? fmt(pe) : "—"}</td>
                  <td className="px-3 py-2">
                    {d > 0 ? <span className="rounded bg-green-100 px-2 py-1 font-bold text-green-800">+{fmt(d)} Jama / Extra</span>
                      : d < 0 ? <span className="rounded bg-red-100 px-2 py-1 font-bold text-red-800">-{fmt(-d)} Baaki / Due</span>
                      : <span className="rounded bg-slate-200 px-2 py-1 font-bold text-slate-700">Settled</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <button aria-label="Add entry" className="mr-2 text-indigo-800" onClick={() => addEntry(m.name)}><Plus size={18} /></button>
                    <button aria-label="Remove member" className="text-slate-400" onClick={() => confirm(`${m.name} ko hatayein?`) && upd((t) => ({ ...t, members: t.members.filter((x) => x.id !== m.id) }))}><Trash2 size={16} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const add = parseMembers(nm).filter((x) => !trip.members.some((y) => low(y.name) === low(x.name))); if (add.length) upd((t) => ({ ...t, members: [...t.members, ...add] })); setNm(""); }}>
        <input className={inp} placeholder="Naya member (ya kai naam comma se)" value={nm} onChange={(e) => setNm(e.target.value)} />
        <button className={`${btn} bg-indigo-950 text-white`}><Users size={16} />Add</button>
      </form>
    </div>
  );
}

function Passbook({ trip, edit, del }) {
  const [f, setF] = useState("all");
  const [q, setQ] = useState("");
  const filters = [["all", "All"], ["IN", "Aawak (In)"], ["OUT", "Jaawak (Out)"], ["PERSONAL", "Personal"], ["Cash", "Cash Only"], ["Online", "Online Only"]];
  const rows = trip.tx
    .filter((t) => f === "all" || t.type === f || t.mode === f)
    .filter((t) => !q || low(`${t.member} ${t.desc} ${t.cat}`).includes(low(q)))
    .sort((a, b) => b.ts.localeCompare(a.ts));
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {filters.map(([v, l]) => <button key={v} onClick={() => setF(v)} className={`${btn} border-2 ${f === v ? "border-indigo-950 bg-indigo-950 text-white" : "border-slate-300 bg-white"}`}>{l}</button>)}
      </div>
      <div className="relative mb-3"><Search size={18} className="absolute left-3 top-3 text-slate-500" /><input className={`${inp} pl-10`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="overflow-x-auto rounded-xl border-2 border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-100 font-semibold"><tr>{["Date / Time", "Type", "Member / Vendor", "Description", "Category", "Mode", "Amount", ""].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((t) => {
              const [d, tm] = fmtDT(t.ts);
              return (
                <tr key={t.id} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2">{d}<br /><span className="text-xs text-slate-500">{tm}</span></td>
                  <td className="px-3 py-2"><span className={`rounded px-2 py-1 text-xs font-bold ${TYPE_UI[t.type].c}`}>{TYPE_UI[t.type].l}</span></td>
                  <td className="px-3 py-2 font-semibold">{t.member || "—"}</td>
                  <td className="px-3 py-2">{t.desc}</td>
                  <td className="px-3 py-2"><span className="rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">{t.cat}</span></td>
                  <td className="px-3 py-2">{t.mode}</td>
                  <td className={`whitespace-nowrap px-3 py-2 font-bold ${TYPE_UI[t.type].t}`}>{TYPE_UI[t.type].s}{fmt(t.amt)}</td>
                  <td className="whitespace-nowrap px-3 py-2"><button aria-label="Edit" className="mr-2" onClick={() => edit(t)}><Pencil size={16} /></button><button aria-label="Delete" onClick={() => del(t.id)}><Trash2 size={16} /></button></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">Abhi koi entry nahi. Neeche command bar se shuru karein.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PersonalTab({ trip, edit, del, add }) {
  const list = trip.tx.filter((t) => t.type === "PERSONAL").sort((a, b) => b.ts.localeCompare(a.ts));
  const by = {};
  list.forEach((t) => { (by[t.member] = by[t.member] || []).push(t); });
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Personal kharcha group Jaawak aur per-head me nahi judta. Ye sirf us member ke Hisab me kat-ta hai (pool se nikla maana gaya).</p>
      <button className={`${btn} border-2 border-violet-700 text-violet-800`} onClick={add}><Plus size={16} />Personal entry</button>
      {!list.length && <p className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">Koi personal kharcha nahi. Bolein: “Ramesh ne apne liye 500 ka saman liya”.</p>}
      {Object.entries(by).map(([name, rows]) => (
        <div key={name} className="rounded-xl border-2 border-violet-200 bg-white">
          <div className="flex justify-between bg-violet-50 px-3 py-2 font-bold text-violet-900"><span>{name}</span><span>{fmt(rows.reduce((a, t) => a + t.amt, 0))}</span></div>
          {rows.map((t) => {
            const [d, tm] = fmtDT(t.ts);
            return (
              <div key={t.id} className="flex items-center gap-2 border-t px-3 py-2 text-sm">
                <span className="flex-1">{t.desc}<span className="block text-xs text-slate-500">{d} {tm} · {t.mode}</span></span>
                <b>{fmt(t.amt)}</b>
                <button aria-label="Edit" onClick={() => edit(t)}><Pencil size={16} /></button>
                <button aria-label="Delete" onClick={() => del(t.id)}><Trash2 size={16} /></button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Reports({ trip, sum }) {
  const [ok, setOk] = useState(false);
  const dues = trip.members.map((m) => ({ n: m.name, d: sum.perHead + trip.tx.filter((t) => t.type === "PERSONAL" && low(t.member) === low(m.name)).reduce((a, t) => a + t.amt, 0) - trip.tx.filter((t) => t.type === "IN" && low(t.member) === low(m.name)).reduce((a, t) => a + t.amt, 0) })).filter((x) => Math.round(x.d) > 0);
  const text = [
    `🙏 *${trip.name}* — Hisab`,
    `💰 Total Aawak: ${fmt(sum.inn)} (Cash ${fmt(sum.cashIn)} | Online ${fmt(sum.onlineIn)})`,
    `🧾 Total Jaawak: ${fmt(sum.out)} (Cash ${fmt(sum.cashOut)} | Online ${fmt(sum.onlineOut)})`,
    `🏦 Bacha hua: ${fmt(sum.net)} — 💵 Cash in hand ${fmt(sum.cashHand)} | 📲 Online ${fmt(sum.bank)}`,
    `👥 Per head kharcha: ${fmt(sum.perHead)} (${trip.members.length} members)`,
    ...(sum.pers ? [`👤 Personal kharcha (alag): ${fmt(sum.pers)}`] : []),
    "", "📊 Category-wise kharcha:", ...(Object.entries(sum.cat).map(([c, v]) => `• ${c}: ${fmt(v)}`)),
    "", dues.length ? "⏳ Baaki (dues):" : "✅ Sabka hisab clear hai", ...dues.map((x) => `• ${x.n}: ${fmt(x.d)}`),
  ].join("\n");
  const csv = () => {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["MEMBER SUMMARY"], ["Member", "Target", "Online", "Cash", "Total Paid", "Per-Head Share", "Personal", "Net"]];
    trip.members.forEach((m) => {
      const mine = trip.tx.filter((t) => t.type === "IN" && low(t.member) === low(m.name));
      const on = mine.filter((t) => t.mode === "Online").reduce((a, t) => a + t.amt, 0), ca = mine.filter((t) => t.mode === "Cash").reduce((a, t) => a + t.amt, 0);
      const pe = trip.tx.filter((t) => t.type === "PERSONAL" && low(t.member) === low(m.name)).reduce((a, t) => a + t.amt, 0);
      rows.push([m.name, trip.target, on, ca, on + ca, sum.perHead.toFixed(2), pe, (on + ca - sum.perHead - pe).toFixed(2)]);
    });
    rows.push([], ["PASSBOOK"], ["Date", "Time", "Type", "Member/Vendor", "Description", "Category", "Mode", "Amount"]);
    [...trip.tx].sort((a, b) => a.ts.localeCompare(b.ts)).forEach((t) => { const [d, tm] = fmtDT(t.ts); rows.push([d, tm, TYPE_UI[t.type].l.split(" ")[0], t.member, t.desc, t.cat, t.mode, t.amt]); });
    const blob = new Blob(["\ufeff" + rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${trip.name.replace(/\W+/g, "_")}.csv`; a.click();
  };
  return (
    <div className="space-y-3">
      <pre className="whitespace-pre-wrap rounded-xl border-2 border-slate-200 bg-white p-4 text-sm">{text}</pre>
      <div className="grid grid-cols-2 gap-2">
        <button className={`${btn} bg-green-700 text-white`} onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1800); } catch { alert("Copy nahi hua. Text select karke copy karein."); } }}><Copy size={16} />{ok ? "Copy ho gaya!" : "WhatsApp summary copy"}</button>
        <button className={`${btn} bg-indigo-950 text-white`} onClick={csv}><Download size={16} />CSV / Excel</button>
      </div>
    </div>
  );
}

/* ───────── App ───────── */
export default function App() {
  const [store, setStore] = useStore();
  const trip = store.trips.find((t) => t.id === store.active);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState("members");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [heard, setHeard] = useState("");
  const upd = (fn) => setStore((s) => ({ ...s, trips: s.trips.map((t) => (t.id === s.active ? fn(t) : t)) }));

  const sum = useMemo(() => {
    if (!trip) return null;
    const z = { cashIn: 0, onlineIn: 0, cashOut: 0, onlineOut: 0, persCash: 0, persOnline: 0, cat: {} };
    trip.tx.forEach((t) => {
      if (t.type === "PERSONAL") { z[t.mode === "Cash" ? "persCash" : "persOnline"] += t.amt; return; }
      z[(t.mode === "Cash" ? "cash" : "online") + (t.type === "IN" ? "In" : "Out")] += t.amt;
      if (t.type === "OUT") z.cat[t.cat] = (z.cat[t.cat] || 0) + t.amt;
    });
    z.inn = z.cashIn + z.onlineIn; z.out = z.cashOut + z.onlineOut; z.pers = z.persCash + z.persOnline;
    z.net = z.inn - z.out - z.pers; z.cashHand = z.cashIn - z.cashOut - z.persCash; z.bank = z.onlineIn - z.onlineOut - z.persOnline;
    z.perHead = z.out / (trip.members.length || 1);
    return z;
  }, [trip]);

  async function run(text, img) {
    setBusy(true); setErr("");
    try {
      const names = trip.members.map((m) => m.name);
      let items;
      const hing = toHinglish(text);
      setHeard(text && hing !== text ? hing : "");
      if (store.key) {
        const parts = img ? [{ inlineData: { mimeType: "image/jpeg", data: img } }, { text: "This is a receipt/bill. Extract it as ONE OUT transaction: total amount, merchant as description, category, date. " + (text || "") }] : [{ text: hing === text ? text : `${hing}\n(original: ${text})` }];
        items = await gemini(store.key, parts, names);
      } else if (img) throw new Error("Bill scan ke liye Settings me Gemini API key daalein.");
      else items = demoParse(hing, names);
      items = items.map((i) => ({ ...i, member: i.type === "OUT" ? i.member : findMember(i.member, names) || i.member }));
      const txs = items.filter((i) => Number(i.amount) > 0).map(toTx);
      if (!txs.length) throw new Error("Samajh nahi aaya. Jaise likhein: “Ramesh ne 5000 online diye”.");
      upd((t) => ({ ...t, tx: [...t.tx, ...txs] }));
      setToast(txs);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const saveTx = (t) => {
    upd((tr) => ({ ...tr, tx: t.id ? tr.tx.map((x) => (x.id === t.id ? t : x)) : [...tr.tx, { ...t, id: uid(), ts: new Date().toISOString() }] }));
    setToast((cur) => cur && cur.map((x) => (x.id === t.id ? t : x)));
    setModal(null);
  };
  const delTx = (id) => { upd((tr) => ({ ...tr, tx: tr.tx.filter((x) => x.id !== id) })); setToast((c) => { const n = c?.filter((x) => x.id !== id); return n?.length ? n : null; }); };
  const blank = (member = "") => ({ type: "IN", member, desc: "", cat: "Aawak", mode: "Cash", amt: 0 });

  if (!trip || creating)
    return <div className="min-h-screen bg-[#FBF7EE] text-slate-900"><Setup onCreate={(t) => { setStore((s) => ({ ...s, trips: [...s.trips, t], active: t.id })); setCreating(false); }} onCancel={trip ? () => setCreating(false) : null} /></div>;

  const cards = [
    ["Total Aawak", sum.inn, `Cash ${fmt(sum.cashIn)} · Online ${fmt(sum.onlineIn)}`, "border-green-700"],
    ["Total Jaawak", sum.out, `Cash ${fmt(sum.cashOut)} · Online ${fmt(sum.onlineOut)}${sum.pers ? ` · Personal alag ${fmt(sum.pers)}` : ""}`, "border-red-700"],
    ["Net Remaining", sum.net, `Cash in hand ${fmt(sum.cashHand)} · Bank ${fmt(sum.bank)}`, "border-indigo-900"],
    ["Per-Head Kharcha", sum.perHead, `${trip.members.length} members`, "border-amber-500"],
  ];

  return (
    <div className="min-h-screen bg-[#FBF7EE] pb-32 text-slate-900">
      <header className="flex items-center gap-2 bg-indigo-950 p-3 text-white">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-amber-300">YatraHisab AI · v4 {!store.key && "· Demo Mode"}</div>
          <select className="w-full truncate bg-transparent text-lg font-bold" value={store.active} onChange={(e) => setStore((s) => ({ ...s, active: e.target.value }))}>
            {store.trips.map((t) => <option key={t.id} value={t.id} className="text-slate-900">{t.name}</option>)}
          </select>
        </div>
        <button className={`${btn} bg-white/10`} onClick={() => setCreating(true)}><Plus size={16} />Trip</button>
        <button aria-label="Settings" className={`${btn} bg-white/10`} onClick={() => setModal({ k: "settings" })}><Settings size={18} /></button>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 p-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cards.map(([l, v, sub, c]) => (
            <div key={l} className={`rounded-xl border-l-8 bg-white p-3 shadow-sm ${c}`}>
              <div className="text-sm font-medium text-slate-600">{l}</div>
              <div className="text-2xl font-extrabold">{fmt(v)}</div>
              <div className="text-xs text-slate-600">{sub}</div>
            </div>
          ))}
        </div>

        <nav className="flex gap-1 rounded-xl bg-slate-200 p-1">
          {[["members", "Member Hisab"], ["passbook", "Passbook"], ["personal", "Personal"], ["reports", "Reports"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`${btn} flex-1 ${tab === k ? "bg-indigo-950 text-white" : "text-slate-700"}`}>{l}</button>
          ))}
        </nav>

        {tab === "members" && <MembersTab trip={trip} sum={sum} upd={upd} addEntry={(n) => setModal({ k: "entry", t: blank(n) })} />}
        {tab === "passbook" && (
          <>
            <button className={`${btn} mb-3 border-2 border-indigo-950`} onClick={() => setModal({ k: "entry", t: { ...blank(), type: "OUT", cat: "Misc" } })}><Plus size={16} />Manual entry</button>
            <Passbook trip={trip} edit={(t) => setModal({ k: "entry", t })} del={delTx} />
          </>
        )}
        {tab === "personal" && <PersonalTab trip={trip} edit={(t) => setModal({ k: "entry", t })} del={delTx} add={() => setModal({ k: "entry", t: { ...blank(), type: "PERSONAL", cat: "Personal" } })} />}
        {tab === "reports" && <Reports trip={trip} sum={sum} />}
      </main>

      {err && (
        <div className="fixed inset-x-3 bottom-24 z-40 mx-auto flex max-w-3xl items-start gap-2 rounded-xl bg-red-700 p-3 text-white">
          <span className="flex-1 text-sm font-medium">{err}</span><button onClick={() => setErr("")}><X size={18} /></button>
        </div>
      )}
      {toast && !err && (
        <div className="fixed inset-x-3 bottom-24 z-40 mx-auto max-w-3xl space-y-2 rounded-xl border-2 border-green-700 bg-white p-3 shadow-lg">
          <div className="flex justify-between text-sm font-bold text-green-800">AI ne ye entries bana diye<button onClick={() => setToast(null)}><X size={18} /></button></div>
          {heard && <div className="text-xs text-slate-600">Hinglish me samjha: “{heard}”</div>}
          {toast.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-sm">
              <span className={`rounded px-2 py-0.5 text-xs font-bold ${TYPE_UI[t.type].c}`}>{TYPE_UI[t.type].l.split(" ")[0]}</span>
              {t.type !== "OUT" && !t.member && <span className="text-xs font-bold text-red-700">member?</span>}
              <span className="min-w-0 flex-1 truncate">{t.member ? `${t.member} · ` : ""}{t.desc} · {t.cat} · {t.mode}</span>
              <b>{fmt(t.amt)}</b>
              <button aria-label="Edit" onClick={() => setModal({ k: "entry", t })}><Pencil size={16} /></button>
              <button aria-label="Undo" onClick={() => delTx(t.id)}><Undo2 size={16} /></button>
            </div>
          ))}
        </div>
      )}

      <CommandBar onRun={run} busy={busy} onErr={setErr} demo={!store.key} />
      {modal?.k === "settings" && <SettingsModal store={store} setStore={setStore} trip={trip} onClose={() => setModal(null)} />}
      {modal?.k === "entry" && <EntryModal init={modal.t} members={trip.members} onSave={saveTx} onClose={() => setModal(null)} />}
    </div>
  );
}
