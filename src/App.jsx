import { useState, useEffect, useMemo, useRef, createContext, useContext } from "react";
import { Mic, Camera, Send, Settings, Plus, Trash2, Pencil, Undo2, Copy, Download, Upload, X, Loader2, Search, RotateCcw, Users, Calculator } from "lucide-react";

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
  "कमरा": "room", "पार्किंग": "parking", "टोल": "toll", "प्रसाद": "prasad", "पूजा": "puja", "आरती": "aarti", "भोजन": "bhojan", "सबने": "sabne", "सभी": "sabhi", "सब": "sab", "सबको": "sab",
};
const hasDev = (x) => /[\u0900-\u0D7F]/.test(x || "");

function translit(w) {
  const cs = [...w.normalize("NFC").replace(/[\u0980-\u0D7F]/g, (ch) => String.fromCharCode(0x900 + (ch.charCodeAt(0) & 0x7f)))]; // Bengali…Malayalam share Devanagari's layout
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

const STOP = /^(ne|aur|and|se|ka|ki|me|ko|cash|online|upi|diye|diya|jama|kharch|kharcha|hua|hue|hotel|bill|bus|taxi|room|food|chai|khana|nashta|nashte|apne|liye|personal|niji|advance|ticket|darshan|rs|rupaye|rupees|paid|spent|for|of|the|gpay|paytm|bank|hazar|pe|me|sab|sabne|sabhi|everyone|everybody|all|gave|each|members?)$/;
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

const LANGS = [["en", "English", "en-IN", "EN"], ["hi", "हिन्दी", "hi-IN", "हि"], ["bn", "বাংলা", "bn-IN", "বা"], ["mr", "मराठी", "mr-IN", "मरा"], ["te", "తెలుగు", "te-IN", "తె"], ["ta", "தமிழ்", "ta-IN", "த"], ["gu", "ગુજરાતી", "gu-IN", "ગુ"], ["ur", "اردو", "ur-IN", "اُر"], ["kn", "ಕನ್ನಡ", "kn-IN", "ಕ"], ["or", "ଓଡ଼ିଆ", "or-IN", "ଓ"], ["ml", "മലയാളം", "ml-IN", "മ"], ["pa", "ਪੰਜਾਬੀ", "pa-IN", "ਪੰ"]];
const VOICE_OF = Object.fromEntries(LANGS.map(([c, , v]) => [c, v]));
const TYPE_TK = { IN: "tIn", OUT: "tOut", PERSONAL: "tPers" };
// Strings are pipe-separated in KEYS order. English has every key; other languages may stop early (missing keys fall back to English).
const KEYS = "tabM tabP tabX tabR cIn cOut cNet cPh cash online hand bank member target paid share status extra due settled date type desc cat mode amount all cashOnly onlineOnly search tIn tOut tPers save add manual newTrip tripName start perTarget pasteList generate settings apiKey saveKey exportB importB delTrip reset copyWa copied waCat waDues waClear heard created ph noMem eNoSR eNoHttps eNoSpeech eNoKey eNoParse eOffline eBadKey eQuota eBlocked eNoMember".split(" ");
const TR = {
  en: "Members|Passbook|Personal|Reports|Collected (Aawak)|Spent (Jaawak)|Net remaining|Per-head spend|Cash|Online|Cash in hand|Bank|Member|Target|Total paid|Per-head|Status|Extra|Due|Settled|Date / Time|Type|Description|Category|Mode|Amount|All|Cash only|Online only|Search|COLLECTED|SPENT|PERSONAL|Save|Add|Manual entry|New trip sheet|Trip name|Start date|Per-person target (₹)|Paste member list from WhatsApp|Generate Trip Sheet|Settings|Google Gemini API key|Save key|Export backup|Import backup|Delete this trip|Reset all|Copy WhatsApp summary|Copied!|Category-wise spend|Pending dues|All settled|Understood as|Entries created|Type or speak: Suresh 3000 cash|member?|Voice input is not supported in this browser. Use Chrome.|Mic needs HTTPS or localhost.|Didn't hear anything. Speak close to the mic and try again.|Add a Gemini API key in Settings to scan bills.|Couldn't understand. Try: “Ramesh gave 5000 online”.|No internet. Offline works only in Demo Mode (no API key).|Gemini API key is invalid or blocked. Check Settings.|Gemini quota exhausted. Try again later.|Microphone is blocked. Tap the 🔒 icon → Site settings → Microphone → Allow, then reload.|No matching member found for: {n}. Entry not added.",
  hi: "सदस्य|पासबुक|निजी|रिपोर्ट|आवक (जमा)|जावक (खर्च)|शेष राशि|प्रति व्यक्ति खर्च|नकद|ऑनलाइन|हाथ में नकद|बैंक|सदस्य|लक्ष्य|कुल भुगतान|प्रति व्यक्ति|स्थिति|अतिरिक्त|बाकी|बराबर|तारीख / समय|प्रकार|विवरण|श्रेणी|माध्यम|राशि|सभी|सिर्फ नकद|सिर्फ ऑनलाइन|खोजें|आवक|जावक|निजी|सेव करें|जोड़ें|हाथ से एंट्री|नई यात्रा शीट|यात्रा का नाम|शुरू की तारीख|प्रति व्यक्ति लक्ष्य (₹)|WhatsApp से सदस्यों की सूची पेस्ट करें|यात्रा शीट बनाएं|सेटिंग्स|Google Gemini API कुंजी|कुंजी सेव करें|बैकअप निकालें|बैकअप डालें|यह यात्रा हटाएं|सब कुछ रीसेट करें|WhatsApp सारांश कॉपी करें|कॉपी हो गया!|श्रेणी अनुसार खर्च|बकाया राशि|सबका हिसाब बराबर|समझा गया|एंट्री बन गईं|बोलें या लिखें: सुरेश 3000 नकद|सदस्य?|इस ब्राउज़र में वॉइस सपोर्ट नहीं है। Chrome इस्तेमाल करें।|माइक के लिए HTTPS या localhost चाहिए।|कुछ सुनाई नहीं दिया। माइक के पास बोलकर दोबारा कोशिश करें।|बिल स्कैन के लिए सेटिंग्स में Gemini API कुंजी डालें।|समझ नहीं आया। ऐसे बोलें: “रमेश ने 5000 ऑनलाइन दिए”।|इंटरनेट नहीं है। ऑफ़लाइन में सिर्फ डेमो मोड (बिना API कुंजी) चलता है।|Gemini API कुंजी गलत या ब्लॉक है। सेटिंग्स जाँचें।|Gemini की सीमा पूरी हो गई। थोड़ी देर बाद कोशिश करें।|माइक ब्लॉक है। 🔒 आइकन → Site settings → Microphone → Allow करें, फिर रीलोड करें।|इन नामों का कोई सदस्य नहीं मिला: {n}। एंट्री नहीं जोड़ी गई।",
  bn: "সদস্য|পাসবুক|ব্যক্তিগত|রিপোর্ট|আওয়াক (জমা)|জাওয়াক (খরচ)|অবশিষ্ট|জনপ্রতি খরচ|নগদ|অনলাইন|হাতে নগদ|ব্যাংক|সদস্য|লক্ষ্য|মোট দেওয়া|জনপ্রতি|অবস্থা|অতিরিক্ত|বাকি|মিটে গেছে|তারিখ / সময়|ধরন|বিবরণ|বিভাগ|মাধ্যম|পরিমাণ|সব|শুধু নগদ|শুধু অনলাইন|খুঁজুন|জমা|খরচ|ব্যক্তিগত|সেভ করুন|যোগ করুন|হাতে এন্ট্রি|নতুন ট্রিপ শিট|ট্রিপের নাম|শুরুর তারিখ|জনপ্রতি লক্ষ্য (₹)|WhatsApp থেকে সদস্যদের তালিকা পেস্ট করুন|ট্রিপ শিট তৈরি করুন|সেটিংস|Google Gemini API কী|কী সেভ করুন|ব্যাকআপ এক্সপোর্ট|ব্যাকআপ ইমপোর্ট|এই ট্রিপ মুছুন|সব রিসেট|WhatsApp সারাংশ কপি করুন|কপি হয়েছে!|বিভাগ অনুযায়ী খরচ|বাকি পাওনা|সবার হিসাব মিটেছে|যা বুঝেছি|এন্ট্রি তৈরি হয়েছে|বলুন বা লিখুন: সুরেশ ৩০০০ নগদ|সদস্য?",
  mr: "सदस्य|पासबुक|वैयक्तिक|अहवाल|आवक (जमा)|जावक (खर्च)|शिल्लक|दर डोई खर्च|रोख|ऑनलाइन|हातातील रोख|बँक|सदस्य|लक्ष्य|एकूण भरले|दर डोई|स्थिती|जास्त|बाकी|बरोबर|तारीख / वेळ|प्रकार|तपशील|वर्ग|पद्धत|रक्कम|सर्व|फक्त रोख|फक्त ऑनलाइन|शोधा|आवक|जावक|वैयक्तिक|सेव्ह करा|जोडा|हाताने नोंद|नवीन सहल शीट|सहलीचे नाव|सुरुवातीची तारीख|प्रति व्यक्ती लक्ष्य (₹)|WhatsApp वरून सदस्यांची यादी पेस्ट करा|सहल शीट तयार करा|सेटिंग्ज|Google Gemini API की|की सेव्ह करा|बॅकअप एक्सपोर्ट|बॅकअप इम्पोर्ट|ही सहल हटवा|सर्व रीसेट|WhatsApp सारांश कॉपी करा|कॉपी झाले!|वर्गानुसार खर्च|थकबाकी|सर्वांचा हिशोब बरोबर|समजले|नोंदी तयार झाल्या|बोला किंवा लिहा: सुरेश 3000 रोख|सदस्य?",
  te: "సభ్యులు|పాస్‌బుక్|వ్యక్తిగతం|నివేదికలు|ఆవక్ (వసూలు)|జావక్ (ఖర్చు)|మిగిలినది|ఒక్కొక్కరికి ఖర్చు|నగదు|ఆన్‌లైన్|చేతిలో నగదు|బ్యాంక్|సభ్యుడు|లక్ష్యం|మొత్తం చెల్లింపు|ఒక్కొక్కరికి|స్థితి|అదనం|బాకీ|సరిపోయింది|తేదీ / సమయం|రకం|వివరణ|వర్గం|పద్ధతి|మొత్తం|అన్నీ|నగదు మాత్రమే|ఆన్‌లైన్ మాత్రమే|వెతకండి|వసూలు|ఖర్చు|వ్యక్తిగతం|సేవ్ చేయండి|జోడించండి|మాన్యువల్ ఎంట్రీ|కొత్త ట్రిప్ షీట్|ట్రిప్ పేరు|ప్రారంభ తేదీ|ఒక్కొక్కరికి లక్ష్యం (₹)|WhatsApp నుండి సభ్యుల జాబితా పేస్ట్ చేయండి|ట్రిప్ షీట్ సృష్టించండి|సెట్టింగ్స్|Google Gemini API కీ|కీ సేవ్ చేయండి|బ్యాకప్ ఎగుమతి|బ్యాకప్ దిగుమతి|ఈ ట్రిప్ తొలగించండి|అన్నీ రీసెట్|WhatsApp సారాంశం కాపీ చేయండి|కాపీ అయింది!|వర్గాల వారీ ఖర్చు|బాకీలు|అందరి లెక్క సరిపోయింది|అర్థమైంది|ఎంట్రీలు సృష్టించబడ్డాయి|చెప్పండి లేదా రాయండి: సురేష్ 3000 నగదు|సభ్యుడు?",
  ta: "உறுப்பினர்கள்|பாஸ்புக்|தனிப்பட்டது|அறிக்கைகள்|வரவு (ஆவக்)|செலவு (ஜாவக்)|மீதம்|ஒருவருக்கு செலவு|ரொக்கம்|ஆன்லைன்|கையில் ரொக்கம்|வங்கி|உறுப்பினர்|இலக்கு|மொத்தம் செலுத்தியது|ஒருவருக்கு|நிலை|கூடுதல்|பாக்கி|சரியாக உள்ளது|தேதி / நேரம்|வகை|விவரம்|பிரிவு|முறை|தொகை|அனைத்தும்|ரொக்கம் மட்டும்|ஆன்லைன் மட்டும்|தேடு|வரவு|செலவு|தனிப்பட்டது|சேமி|சேர்|கைமுறை பதிவு|புதிய பயண தாள்|பயணத்தின் பெயர்|தொடக்க தேதி|ஒருவருக்கு இலக்கு (₹)|WhatsApp இலிருந்து உறுப்பினர் பட்டியலை ஒட்டவும்|பயண தாளை உருவாக்கு|அமைப்புகள்|Google Gemini API விசை|விசையை சேமி|காப்புப்பிரதி ஏற்று|காப்புப்பிரதி இறக்கு|இந்த பயணத்தை நீக்கு|அனைத்தையும் மீட்டமை|WhatsApp சுருக்கத்தை நகலெடு|நகலெடுக்கப்பட்டது!|பிரிவு வாரி செலவு|நிலுவைத் தொகை|அனைவரின் கணக்கும் சரி|புரிந்தது|பதிவுகள் உருவாக்கப்பட்டன|பேசவும் அல்லது எழுதவும்: சுரேஷ் 3000 ரொக்கம்|உறுப்பினர்?",
  gu: "સભ્યો|પાસબુક|અંગત|રિપોર્ટ|આવક (જમા)|જાવક (ખર્ચ)|બાકી રકમ|માથાદીઠ ખર્ચ|રોકડ|ઓનલાઇન|હાથમાં રોકડ|બેંક|સભ્ય|લક્ષ્ય|કુલ ચૂકવ્યું|માથાદીઠ|સ્થિતિ|વધારાના|બાકી|સરભર|તારીખ / સમય|પ્રકાર|વિગત|શ્રેણી|રીત|રકમ|બધા|ફક્ત રોકડ|ફક્ત ઓનલાઇન|શોધો|આવક|જાવક|અંગત|સેવ કરો|ઉમેરો|જાતે એન્ટ્રી|નવી યાત્રા શીટ|યાત્રાનું નામ|શરૂઆતની તારીખ|માથાદીઠ લક્ષ્ય (₹)|WhatsApp પરથી સભ્યોની યાદી પેસ્ટ કરો|યાત્રા શીટ બનાવો|સેટિંગ્સ|Google Gemini API કી|કી સેવ કરો|બેકઅપ એક્સપોર્ટ|બેકઅપ ઇમ્પોર્ટ|આ યાત્રા કાઢી નાખો|બધું રીસેટ|WhatsApp સારાંશ કોપી કરો|કોપી થયું!|શ્રેણી મુજબ ખર્ચ|બાકી લેણાં|બધાનો હિસાબ સરભર|સમજાયું|એન્ટ્રી બની ગઈ|બોલો અથવા લખો: સુરેશ 3000 રોકડ|સભ્ય?",
  ur: "ممبران|پاس بک|ذاتی|رپورٹس|آمد (جمع)|خرچ (جاوک)|بقیہ رقم|فی کس خرچ|نقد|آن لائن|ہاتھ میں نقد|بینک|ممبر|ہدف|کل ادا شدہ|فی کس|حالت|زائد|باقی|برابر|تاریخ / وقت|قسم|تفصیل|زمرہ|طریقہ|رقم|سب|صرف نقد|صرف آن لائن|تلاش|آمد|خرچ|ذاتی|محفوظ کریں|شامل کریں|دستی اندراج|نئی ٹرپ شیٹ|ٹرپ کا نام|شروع کی تاریخ|فی کس ہدف (₹)|WhatsApp سے ممبروں کی فہرست پیسٹ کریں|ٹرپ شیٹ بنائیں|سیٹنگز|Google Gemini API کی|کی محفوظ کریں|بیک اپ ایکسپورٹ|بیک اپ امپورٹ|یہ ٹرپ حذف کریں|سب ری سیٹ|WhatsApp خلاصہ کاپی کریں|کاپی ہو گیا!|زمرے کے مطابق خرچ|بقایا جات|سب کا حساب برابر|سمجھ گیا|اندراجات بن گئے|بولیں یا لکھیں: سریش 3000 نقد|ممبر؟",
  kn: "ಸದಸ್ಯರು|ಪಾಸ್‌ಬುಕ್|ವೈಯಕ್ತಿಕ|ವರದಿಗಳು|ಆವಕ್ (ಜಮೆ)|ಜಾವಕ್ (ಖರ್ಚು)|ಉಳಿದ ಮೊತ್ತ|ಒಬ್ಬರಿಗೆ ಖರ್ಚು|ನಗದು|ಆನ್‌ಲೈನ್|ಕೈಯಲ್ಲಿ ನಗದು|ಬ್ಯಾಂಕ್|ಸದಸ್ಯ|ಗುರಿ|ಒಟ್ಟು ಪಾವತಿ|ಒಬ್ಬರಿಗೆ|ಸ್ಥಿತಿ|ಹೆಚ್ಚುವರಿ|ಬಾಕಿ|ಸರಿಯಾಗಿದೆ|ದಿನಾಂಕ / ಸಮಯ|ವಿಧ|ವಿವರ|ವರ್ಗ|ವಿಧಾನ|ಮೊತ್ತ|ಎಲ್ಲಾ|ನಗದು ಮಾತ್ರ|ಆನ್‌ಲೈನ್ ಮಾತ್ರ|ಹುಡುಕಿ|ಜಮೆ|ಖರ್ಚು|ವೈಯಕ್ತಿಕ|ಸೇವ್ ಮಾಡಿ|ಸೇರಿಸಿ|ಕೈಯಾರೆ ನಮೂದು|ಹೊಸ ಪ್ರವಾಸ ಶೀಟ್|ಪ್ರವಾಸದ ಹೆಸರು|ಪ್ರಾರಂಭ ದಿನಾಂಕ|ಒಬ್ಬರಿಗೆ ಗುರಿ (₹)|WhatsApp ನಿಂದ ಸದಸ್ಯರ ಪಟ್ಟಿ ಪೇಸ್ಟ್ ಮಾಡಿ|ಪ್ರವಾಸ ಶೀಟ್ ರಚಿಸಿ|ಸೆಟ್ಟಿಂಗ್ಸ್|Google Gemini API ಕೀ|ಕೀ ಸೇವ್ ಮಾಡಿ|ಬ್ಯಾಕಪ್ ಎಕ್ಸ್‌ಪೋರ್ಟ್|ಬ್ಯಾಕಪ್ ಇಂಪೋರ್ಟ್|ಈ ಪ್ರವಾಸ ಅಳಿಸಿ|ಎಲ್ಲಾ ರೀಸೆಟ್|WhatsApp ಸಾರಾಂಶ ನಕಲಿಸಿ|ನಕಲಾಯಿತು!|ವರ್ಗವಾರು ಖರ್ಚು|ಬಾಕಿ ಮೊತ್ತ|ಎಲ್ಲರ ಲೆಕ್ಕ ಸರಿಯಾಗಿದೆ|ಅರ್ಥವಾಯಿತು|ನಮೂದುಗಳು ರಚಿಸಲಾಗಿದೆ|ಹೇಳಿ ಅಥವಾ ಬರೆಯಿರಿ: ಸುರೇಶ್ 3000 ನಗದು|ಸದಸ್ಯ?",
  or: "ସଦସ୍ୟ|ପାସବୁକ୍|ବ୍ୟକ୍ତିଗତ|ରିପୋର୍ଟ|ଆବକ୍ (ଜମା)|ଯାବକ୍ (ଖର୍ଚ୍ଚ)|ବାକି ରାଶି|ପ୍ରତି ଜଣକ ଖର୍ଚ୍ଚ|ନଗଦ|ଅନଲାଇନ୍|ହାତରେ ନଗଦ|ବ୍ୟାଙ୍କ|ସଦସ୍ୟ|ଲକ୍ଷ୍ୟ|ମୋଟ ଦେୟ|ପ୍ରତି ଜଣକ|ସ୍ଥିତି|ଅତିରିକ୍ତ|ବାକି|ସମାନ|ତାରିଖ / ସମୟ|ପ୍ରକାର|ବିବରଣୀ|ବର୍ଗ|ପଦ୍ଧତି|ରାଶି|ସବୁ|କେବଳ ନଗଦ|କେବଳ ଅନଲାଇନ୍|ଖୋଜନ୍ତୁ|ଜମା|ଖର୍ଚ୍ଚ|ବ୍ୟକ୍ତିଗତ|ସେଭ୍ କରନ୍ତୁ|ଯୋଡ଼ନ୍ତୁ|ହାତରେ ଏଣ୍ଟ୍ରି|ନୂଆ ଯାତ୍ରା ସିଟ୍|ଯାତ୍ରାର ନାମ|ଆରମ୍ଭ ତାରିଖ|ପ୍ରତି ଜଣକ ଲକ୍ଷ୍ୟ (₹)|WhatsApp ରୁ ସଦସ୍ୟ ତାଲିକା ପେଷ୍ଟ କରନ୍ତୁ|ଯାତ୍ରା ସିଟ୍ ତିଆରି କରନ୍ତୁ|ସେଟିଂସ୍|Google Gemini API କି|କି ସେଭ୍ କରନ୍ତୁ|ବ୍ୟାକଅପ୍ ଏକ୍ସପୋର୍ଟ|ବ୍ୟାକଅପ୍ ଇମ୍ପୋର୍ଟ|ଏହି ଯାତ୍ରା ଡିଲିଟ୍ କରନ୍ତୁ|ସବୁ ରିସେଟ୍|WhatsApp ସାରାଂଶ କପି କରନ୍ତୁ|କପି ହେଲା!|ବର୍ଗ ଅନୁସାରେ ଖର୍ଚ୍ଚ|ବାକି ଦେୟ|ସମସ୍ତଙ୍କ ହିସାବ ସମାନ|ବୁଝିଲି|ଏଣ୍ଟ୍ରି ତିଆରି ହେଲା|କୁହନ୍ତୁ କିମ୍ବା ଲେଖନ୍ତୁ: ସୁରେଶ 3000 ନଗଦ|ସଦସ୍ୟ?",
  ml: "അംഗങ്ങൾ|പാസ്ബുക്ക്|വ്യക്തിഗതം|റിപ്പോർട്ടുകൾ|ആവക് (പിരിവ്)|ജാവക് (ചെലവ്)|ബാക്കി തുക|ഒരാൾക്ക് ചെലവ്|പണം|ഓൺലൈൻ|കയ്യിലെ പണം|ബാങ്ക്|അംഗം|ലക്ഷ്യം|ആകെ അടച്ചത്|ഒരാൾക്ക്|നില|അധികം|ബാക്കി|തുല്യം|തീയതി / സമയം|തരം|വിവരണം|വിഭാഗം|രീതി|തുക|എല്ലാം|പണം മാത്രം|ഓൺലൈൻ മാത്രം|തിരയുക|പിരിവ്|ചെലവ്|വ്യക്തിഗതം|സേവ് ചെയ്യുക|ചേർക്കുക|സ്വന്തം എൻട്രി|പുതിയ യാത്രാ ഷീറ്റ്|യാത്രയുടെ പേര്|തുടക്ക തീയതി|ഒരാൾക്ക് ലക്ഷ്യം (₹)|WhatsApp-ൽ നിന്ന് അംഗങ്ങളുടെ പട്ടിക പേസ്റ്റ് ചെയ്യുക|യാത്രാ ഷീറ്റ് ഉണ്ടാക്കുക|ക്രമീകരണങ്ങൾ|Google Gemini API കീ|കീ സേവ് ചെയ്യുക|ബാക്കപ്പ് എക്സ്പോർട്ട്|ബാക്കപ്പ് ഇമ്പോർട്ട്|ഈ യാത്ര ഇല്ലാതാക്കുക|എല്ലാം റീസെറ്റ്|WhatsApp സംഗ്രഹം പകർത്തുക|പകർത്തി!|വിഭാഗം തിരിച്ചുള്ള ചെലവ്|കുടിശ്ശിക|എല്ലാവരുടെയും കണക്ക് തുല്യം|മനസ്സിലായി|എൻട്രികൾ ഉണ്ടാക്കി|പറയൂ അല്ലെങ്കിൽ എഴുതൂ: സുരേഷ് 3000 പണം|അംഗം?",
  pa: "ਮੈਂਬਰ|ਪਾਸਬੁੱਕ|ਨਿੱਜੀ|ਰਿਪੋਰਟਾਂ|ਆਮਦ (ਜਮ੍ਹਾਂ)|ਜਾਵਕ (ਖਰਚ)|ਬਾਕੀ ਰਕਮ|ਪ੍ਰਤੀ ਵਿਅਕਤੀ ਖਰਚ|ਨਕਦ|ਆਨਲਾਈਨ|ਹੱਥ ਵਿੱਚ ਨਕਦ|ਬੈਂਕ|ਮੈਂਬਰ|ਟੀਚਾ|ਕੁੱਲ ਭੁਗਤਾਨ|ਪ੍ਰਤੀ ਵਿਅਕਤੀ|ਸਥਿਤੀ|ਵਾਧੂ|ਬਾਕੀ|ਬਰਾਬਰ|ਤਾਰੀਖ਼ / ਸਮਾਂ|ਕਿਸਮ|ਵੇਰਵਾ|ਸ਼੍ਰੇਣੀ|ਤਰੀਕਾ|ਰਕਮ|ਸਭ|ਸਿਰਫ਼ ਨਕਦ|ਸਿਰਫ਼ ਆਨਲਾਈਨ|ਖੋਜੋ|ਆਮਦ|ਖਰਚ|ਨਿੱਜੀ|ਸੇਵ ਕਰੋ|ਜੋੜੋ|ਹੱਥੀਂ ਐਂਟਰੀ|ਨਵੀਂ ਯਾਤਰਾ ਸ਼ੀਟ|ਯਾਤਰਾ ਦਾ ਨਾਮ|ਸ਼ੁਰੂ ਦੀ ਤਾਰੀਖ਼|ਪ੍ਰਤੀ ਵਿਅਕਤੀ ਟੀਚਾ (₹)|WhatsApp ਤੋਂ ਮੈਂਬਰਾਂ ਦੀ ਸੂਚੀ ਪੇਸਟ ਕਰੋ|ਯਾਤਰਾ ਸ਼ੀਟ ਬਣਾਓ|ਸੈਟਿੰਗਾਂ|Google Gemini API ਕੁੰਜੀ|ਕੁੰਜੀ ਸੇਵ ਕਰੋ|ਬੈਕਅੱਪ ਐਕਸਪੋਰਟ|ਬੈਕਅੱਪ ਇੰਪੋਰਟ|ਇਹ ਯਾਤਰਾ ਮਿਟਾਓ|ਸਭ ਰੀਸੈੱਟ|WhatsApp ਸਾਰ ਕਾਪੀ ਕਰੋ|ਕਾਪੀ ਹੋ ਗਿਆ!|ਸ਼੍ਰੇਣੀ ਅਨੁਸਾਰ ਖਰਚ|ਬਕਾਇਆ|ਸਭ ਦਾ ਹਿਸਾਬ ਬਰਾਬਰ|ਸਮਝ ਗਿਆ|ਐਂਟਰੀਆਂ ਬਣ ਗਈਆਂ|ਬੋਲੋ ਜਾਂ ਲਿਖੋ: ਸੁਰੇਸ਼ 3000 ਨਕਦ|ਮੈਂਬਰ?",
};
const DICT = Object.fromEntries(Object.entries(TR).map(([l, v]) => [l, Object.fromEntries(v.split("|").map((x, i) => [KEYS[i], x]))]));
const LangCtx = createContext("en");
const mkT = (l) => (k) => DICT[l]?.[k] ?? DICT.en[k] ?? k;
const useT = () => mkT(useContext(LangCtx));

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
    const personal = !!mem && /apne liye|personal|niji|own use|khud (?:ke|ka)/i.test(p);
    const isOut = mem
      ? /kharch|kharcha|spent|expense|bill/i.test(p) && !/diye|diya|jama/i.test(p)
      : !/jama|received|collected|mila|diye|diya|gave|contributed|deposit/i.test(p);
    const everyone = !mem && /\b(?:sab|sabne|sabhi|everyone|everybody|all members?|each member)\b/i.test(p);
    const type = personal ? "PERSONAL" : everyone && !/kharch|kharcha|spent|expense|bill/i.test(p) ? "IN" : isOut ? "OUT" : "IN";
    out.push({
      type,
      member: type === "OUT" ? "" : mem || "",
      everyone,
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
Input can be in any Indian language or script (Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Urdu, Kannada, Odia, Malayalam, Punjabi) or English/Hinglish.
If the text says ALL / EVERYONE / EACH member paid or gave the same amount (sab ne, sabhi ne, everyone, all members), return ONE IN object with everyone=true and member="" — do not list members yourself.
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
            everyone: { type: "BOOLEAN" },
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
    throw new Error("eOffline");
  }
  if (!r.ok) {
    if (r.status === 400 || r.status === 403) throw new Error("eBadKey");
    if (r.status === 429) throw new Error("eQuota");
    throw new Error(`Gemini error (${r.status}). Try again.`);
  }
  const j = await r.json();
  const t = j.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  try { return JSON.parse(t.replace(/```json|```/g, "").trim()); } catch { throw new Error("Could not read the AI response. Try again."); }
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
    img.onerror = () => rej(new Error("Could not open the photo."));
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
  const T = useT();
  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <h1 className="text-2xl font-extrabold text-indigo-950">{T("newTrip")}</h1>
      <input className={inp} placeholder={T("tripName") + " — Vaishno Devi Yatra 2026"} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-medium">{T("start")}<input type="date" className={inp} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="text-sm font-medium">{T("perTarget")}<input type="number" className={inp} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></label>
      </div>
      <label className="block text-sm font-medium">
        {T("pasteList")}
        <textarea rows={8} className={inp} value={f.list} onChange={(e) => setF({ ...f, list: e.target.value })} placeholder={"1. Ramesh Sharma\n2. Suresh Patel\n3. Mohan"} />
      </label>
      <p className="text-sm text-slate-600">{members.length} {T("tabM")}</p>
      <div className="flex gap-2">
        <button disabled={!f.name.trim() || !members.length} className={`${btn} flex-1 bg-indigo-950 text-white disabled:opacity-40`} onClick={() => onCreate({ id: uid(), name: f.name.trim(), date: f.date, target: Number(f.target) || 0, members, tx: [] })}>{T("generate")}</button>
        {onCancel && <button className={`${btn} border-2 border-slate-300`} onClick={onCancel} aria-label="Cancel"><X size={16} /></button>}
      </div>
    </div>
  );
}

/* ───────── Command bar ───────── */
function CommandBar({ onRun, busy, onErr, demo }) {
  const [text, setText] = useState("");
  const ui = useContext(LangCtx);
  const T = useT();
  const [lang, setLang] = useState(VOICE_OF[ui]);
  useEffect(() => setLang(VOICE_OF[ui]), [ui]);
  const [on, setOn] = useState(false);
  const file = useRef();
  const recRef = useRef();
  const submit = (t = text) => { if (t.trim()) { onRun(t.trim()); setText(""); } };
  const hint = " Meanwhile, use your phone keyboard's 🎤 to dictate into the bar.";
  const fail = (m) => { setOn(false); onErr(T(m) + hint); };
  // Runs when speech recognition says "not allowed": finds out whether the mic itself or the browser's speech service is the problem.
  const diagnose = async (code) => {
    if (/; wv\)|FBAN|FBAV|Instagram|WhatsApp|Telegram/i.test(navigator.userAgent)) return fail(`This is an in-app browser; voice doesn't work here. Open the link in Chrome. (${code})`);
    if (navigator.brave) return fail(`Brave blocks voice typing. Use Chrome. (${code})`);
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true });
      st.getTracks().forEach((x) => x.stop());
      fail(`Mic works, but this browser's speech service is off. Use Chrome; on iPhone turn on Dictation/Siri in Settings. (${code})`);
    } catch (e) {
      fail(
        e.name === "NotReadableError" ? "Mic is in use by another app or tab. Close it and try again."
        : e.name === "NotFoundError" ? "No microphone found on this device."
        : window.self !== window.top ? "This page is inside an iframe/preview, so the mic is blocked. Open it as a standalone page."
        : `${T("eBlocked")} (${e.name})`
      );
    }
  };
  const listen = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return fail("eNoSR");
    if (!window.isSecureContext) return fail("eNoHttps");
    if (on) return recRef.current?.stop();
    const r = new SR();
    recRef.current = r;
    r.lang = lang; r.interimResults = true; r.maxAlternatives = 1;
    r.onstart = () => setOn(true); // only after the browser's "Allow microphone?" popup is accepted
    r.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      if (res.isFinal) submit(res[0].transcript);
      else setText(res[0].transcript); // live text while speaking
    };
    r.onerror = (e) => {
      setOn(false);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") diagnose(e.error);
      else if (e.error === "no-speech") onErr("eNoSpeech");
      else if (e.error === "audio-capture") onErr("Can't capture audio. Is the mic being used by another app?");
      else if (e.error === "language-not-supported") onErr("This browser's voice input doesn't support that language. Pick another voice language.");
      else if (e.error !== "aborted") onErr(`Voice error: ${e.error}`);
    };
    r.onend = () => setOn(false);
    try { r.start(); } catch { setOn(false); onErr("Couldn't start voice input. Try again."); }
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
        <input className="min-w-0 flex-1 rounded-lg bg-white px-3 py-3 text-base text-slate-900 outline-none" placeholder={T("ph")} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <select aria-label="Voice language" className="rounded-lg bg-white/10 px-1 py-2 text-xs font-bold text-white" value={lang} onChange={(e) => setLang(e.target.value)}>{LANGS.map(([c, , v, sh]) => <option key={c} value={v} className="text-slate-900">{sh}</option>)}</select>
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
  const T = useT();
  return (
    <Modal title={T("manual")} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[["IN", T("tIn"), "border-green-700 bg-green-700"], ["OUT", T("tOut"), "border-red-700 bg-red-700"], ["PERSONAL", T("tPers"), "border-violet-700 bg-violet-700"]].map(([v, l, c]) => (
            <button key={v} className={`${btn} border-2 ${t.type === v ? `${c} text-white` : "border-slate-300"}`} onClick={() => setT({ ...t, type: v, cat: v === "IN" ? "Aawak" : v === "PERSONAL" ? "Personal" : "Misc" })}>{l}</button>
          ))}
        </div>
        {t.type !== "OUT" ? (
          <select className={inp} value={t.member} onChange={(e) => set("member", e.target.value)}>
            <option value="">{T("member")}</option>
            {members.map((m) => <option key={m.id}>{m.name}</option>)}
          </select>
        ) : (
          <>
            <input className={inp} placeholder="Vendor (optional)" value={t.member} onChange={(e) => set("member", e.target.value)} />
            <select className={inp} value={t.cat} onChange={(e) => set("cat", e.target.value)}>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
          </>
        )}
        <input className={inp} placeholder={T("desc")} value={t.desc} onChange={(e) => set("desc", e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <input type="number" className={inp} placeholder={T("amount") + " ₹"} value={t.amt || ""} onChange={(e) => set("amt", Number(e.target.value))} />
          <select className={inp} value={t.mode} onChange={(e) => set("mode", e.target.value)}><option value="Cash">{T("cash")}</option><option value="Online">{T("online")}</option></select>
        </div>
        <button disabled={!t.amt || (t.type !== "OUT" && !t.member)} className={`${btn} w-full bg-indigo-950 text-white disabled:opacity-40`} onClick={() => onSave(t)}>{T("save")}</button>
      </div>
    </Modal>
  );
}

/* ───────── Settings ───────── */
function SettingsModal({ store, setStore, trip, onClose }) {
  const [key, setKey] = useState(store.key);
  const T = useT();
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
    } catch { alert("This is not a valid backup file."); }
  };
  return (
    <Modal title={T("settings")} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">{T("apiKey")}</label>
          <input type="password" className={inp} placeholder="AIza…" value={key} onChange={(e) => setKey(e.target.value)} />
          <p className="mt-1 text-xs text-slate-600">Stored only in this browser's localStorage. Leave empty to use Demo Mode (bill scan disabled).</p>
          <button className={`${btn} mt-2 bg-indigo-950 text-white`} onClick={() => { setStore((s) => ({ ...s, key: key.trim() })); onClose(); }}>{T("saveKey")}</button>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t pt-4">
          <button className={`${btn} border-2 border-slate-300`} onClick={exportJson}><Download size={16} />{T("exportB")}</button>
          <button className={`${btn} border-2 border-slate-300`} onClick={() => imp.current.click()}><Upload size={16} />{T("importB")}</button>
          <input ref={imp} type="file" accept="application/json" hidden onChange={importJson} />
          {trip && <button className={`${btn} border-2 border-red-700 text-red-700`} onClick={() => { if (confirm(`Delete "${trip.name}"?`)) { setStore((s) => { const trips = s.trips.filter((t) => t.id !== trip.id); return { ...s, trips, active: trips[0]?.id || null }; }); onClose(); } }}><Trash2 size={16} />{T("delTrip")}</button>}
          <button className={`${btn} border-2 border-red-700 text-red-700`} onClick={() => { if (confirm("Erase all data permanently?")) { setStore((s) => ({ trips: [], active: null, key: "", lang: s.lang })); onClose(); } }}><RotateCcw size={16} />{T("reset")}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ───────── Tabs ───────── */
function MembersTab({ trip, sum, upd, addEntry }) {
  const [nm, setNm] = useState("");
  const T = useT();
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
          <thead className="bg-slate-100 font-semibold"><tr>{[T("member"), T("target"), T("online"), T("cash"), T("paid"), T("share"), T("tabX"), T("status"), ""].map((h, i) => <th key={i} className="px-3 py-2">{h}</th>)}</tr></thead>
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
                    {d > 0 ? <span className="rounded bg-green-100 px-2 py-1 font-bold text-green-800">+{fmt(d)} {T("extra")}</span>
                      : d < 0 ? <span className="rounded bg-red-100 px-2 py-1 font-bold text-red-800">-{fmt(-d)} {T("due")}</span>
                      : <span className="rounded bg-slate-200 px-2 py-1 font-bold text-slate-700">{T("settled")}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <button aria-label="Add entry" className="mr-2 text-indigo-800" onClick={() => addEntry(m.name)}><Plus size={18} /></button>
                    <button aria-label="Remove member" className="text-slate-400" onClick={() => confirm(`Remove ${m.name}?`) && upd((t) => ({ ...t, members: t.members.filter((x) => x.id !== m.id) }))}><Trash2 size={16} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const add = parseMembers(nm).filter((x) => !trip.members.some((y) => low(y.name) === low(x.name))); if (add.length) upd((t) => ({ ...t, members: [...t.members, ...add] })); setNm(""); }}>
        <input className={inp} placeholder={T("member") + " +"} value={nm} onChange={(e) => setNm(e.target.value)} />
        <button className={`${btn} bg-indigo-950 text-white`}><Users size={16} />{T("add")}</button>
      </form>
    </div>
  );
}

function Passbook({ trip, edit, del }) {
  const [f, setF] = useState("all");
  const [q, setQ] = useState("");
  const T = useT();
  const filters = [["all", T("all")], ["IN", T("cIn")], ["OUT", T("cOut")], ["PERSONAL", T("tabX")], ["Cash", T("cashOnly")], ["Online", T("onlineOnly")]];
  const rows = trip.tx
    .filter((t) => f === "all" || t.type === f || t.mode === f)
    .filter((t) => !q || low(`${t.member} ${t.desc} ${t.cat}`).includes(low(q)))
    .sort((a, b) => b.ts.localeCompare(a.ts));
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {filters.map(([v, l]) => <button key={v} onClick={() => setF(v)} className={`${btn} border-2 ${f === v ? "border-indigo-950 bg-indigo-950 text-white" : "border-slate-300 bg-white"}`}>{l}</button>)}
      </div>
      <div className="relative mb-3"><Search size={18} className="absolute left-3 top-3 text-slate-500" /><input className={`${inp} pl-10`} placeholder={T("search")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="overflow-x-auto rounded-xl border-2 border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-100 font-semibold"><tr>{[T("date"), T("type"), T("member"), T("desc"), T("cat"), T("mode"), T("amount"), ""].map((h, i) => <th key={i} className="px-3 py-2">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((t) => {
              const [d, tm] = fmtDT(t.ts);
              return (
                <tr key={t.id} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2">{d}<br /><span className="text-xs text-slate-500">{tm}</span></td>
                  <td className="px-3 py-2"><span className={`rounded px-2 py-1 text-xs font-bold ${TYPE_UI[t.type].c}`}>{T(TYPE_TK[t.type])}</span></td>
                  <td className="px-3 py-2 font-semibold">{t.member || "—"}</td>
                  <td className="px-3 py-2">{t.desc}</td>
                  <td className="px-3 py-2"><span className="rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">{t.cat}</span></td>
                  <td className="px-3 py-2">{T(t.mode === "Cash" ? "cash" : "online")}</td>
                  <td className={`whitespace-nowrap px-3 py-2 font-bold ${TYPE_UI[t.type].t}`}>{TYPE_UI[t.type].s}{fmt(t.amt)}</td>
                  <td className="whitespace-nowrap px-3 py-2"><button aria-label="Edit" className="mr-2" onClick={() => edit(t)}><Pencil size={16} /></button><button aria-label="Delete" onClick={() => del(t.id)}><Trash2 size={16} /></button></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">{T("ph")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PersonalTab({ trip, edit, del, add }) {
  const T = useT();
  const list = trip.tx.filter((t) => t.type === "PERSONAL").sort((a, b) => b.ts.localeCompare(a.ts));
  const by = {};
  list.forEach((t) => { (by[t.member] = by[t.member] || []).push(t); });
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Personal spends are kept out of group spending and the per-head share. They are charged only to that member (assumed paid from the pool).</p>
      <button className={`${btn} border-2 border-violet-700 text-violet-800`} onClick={add}><Plus size={16} />{T("tabX")}</button>
      {!list.length && <p className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">No personal spends yet. Try: “Ramesh personal 500 cash”.</p>}
      {Object.entries(by).map(([name, rows]) => (
        <div key={name} className="rounded-xl border-2 border-violet-200 bg-white">
          <div className="flex justify-between bg-violet-50 px-3 py-2 font-bold text-violet-900"><span>{name}</span><span>{fmt(rows.reduce((a, t) => a + t.amt, 0))}</span></div>
          {rows.map((t) => {
            const [d, tm] = fmtDT(t.ts);
            return (
              <div key={t.id} className="flex items-center gap-2 border-t px-3 py-2 text-sm">
                <span className="flex-1">{t.desc}<span className="block text-xs text-slate-500">{d} {tm} · {T(t.mode === "Cash" ? "cash" : "online")}</span></span>
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
  const T = useT();
  const dues = trip.members.map((m) => ({ n: m.name, d: sum.perHead + trip.tx.filter((t) => t.type === "PERSONAL" && low(t.member) === low(m.name)).reduce((a, t) => a + t.amt, 0) - trip.tx.filter((t) => t.type === "IN" && low(t.member) === low(m.name)).reduce((a, t) => a + t.amt, 0) })).filter((x) => Math.round(x.d) > 0);
  const text = [
    `🙏 *${trip.name}*`,
    `💰 ${T("cIn")}: ${fmt(sum.inn)} (${T("cash")} ${fmt(sum.cashIn)} | ${T("online")} ${fmt(sum.onlineIn)})`,
    `🧾 ${T("cOut")}: ${fmt(sum.out)} (${T("cash")} ${fmt(sum.cashOut)} | ${T("online")} ${fmt(sum.onlineOut)})`,
    `🏦 ${T("cNet")}: ${fmt(sum.net)} — 💵 ${T("hand")} ${fmt(sum.cashHand)} | 📲 ${T("bank")} ${fmt(sum.bank)}`,
    `👥 ${T("cPh")}: ${fmt(sum.perHead)} (${trip.members.length} ${T("tabM")})`,
    ...(sum.pers ? [`👤 ${T("tabX")}: ${fmt(sum.pers)}`] : []),
    "", `📊 ${T("waCat")}:`, ...Object.entries(sum.cat).map(([c, v]) => `• ${c}: ${fmt(v)}`),
    "", dues.length ? `⏳ ${T("waDues")}:` : `✅ ${T("waClear")}`, ...dues.map((x) => `• ${x.n}: ${fmt(x.d)}`),
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
        <button className={`${btn} bg-green-700 text-white`} onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1800); } catch { alert("Couldn't copy. Select the text and copy it manually."); } }}><Copy size={16} />{ok ? T("copied") : T("copyWa")}</button>
        <button className={`${btn} bg-indigo-950 text-white`} onClick={csv}><Download size={16} />CSV / Excel</button>
      </div>
    </div>
  );
}

/* ───────── Homepage ───────── */
const HOME = {
  en: {
    tag: "Group trip accounts, made simple",
    h1: "Every rupee of your group trip, accounted for.",
    sub: "Collect contributions, track spending and settle dues for yatras, family tours and groups of 15–30+ members. Just type, speak or scan a bill — YatraHisab AI keeps the books.",
    see: "See features",
    chips: ["15–30+ members", "12 Indian languages", "Cash + Online pool", "Data stays on your device"],
    sample: "Sample passbook",
    yours: "Your trips", open: "Open",
    ft: "Everything a trip treasurer needs",
    feats: [
      ["✨", "Smart command bar", "Type naturally in Hinglish, Hindi or any Indian language. One sentence like “Mohan ne 2000 cash diye aur chai me 650 kharch hue” becomes two entries."],
      ["🎙️", "Voice input", "Tap the mic and speak hands-free while travelling. Works in 12 languages on Chrome."],
      ["🧾", "Bill scanner", "Snap a restaurant, fuel or hotel bill. AI reads the total, vendor, date and category for you."],
      ["👥", "Everyone paid? One sentence", "Say “sab ne 500 diye” and ₹500 is credited to every member individually."],
      ["💰", "Aawak–Jaawak pool", "See money collected and spent live, split into Cash in hand and Online / Bank balance."],
      ["📒", "Member hisab", "A ledger for each member: paid online, paid cash, per-head share and who is Extra, Due or Settled."],
      ["👤", "Personal expenses", "Personal spends stay out of group spending and are charged only to that member."],
      ["📲", "WhatsApp & CSV", "One tap copies a neat summary with category-wise spend and pending dues. Export everything to Excel."],
      ["🧮", "Calculator & backups", "Built-in calculator, multiple trips, and JSON backup and restore. Your data stays in your browser."],
    ],
    how: "How it works",
    steps: [
      ["Create your trip", "Name it, set the per-person target and paste the member list straight from WhatsApp."],
      ["Add entries your way", "Type, speak or scan a bill. Confirm, edit or undo in one tap."],
      ["Share the hisab", "Copy the summary to your group, or export a CSV when the yatra ends."],
    ],
    say: "Say it the way you speak",
    sayNote: "One sentence, two entries. Confirm or undo with one tap.",
    about: "About YatraHisab AI",
    aboutP: [
      "Aawak means money coming in (contributions from members) and Jaawak means money going out (group expenses). YatraHisab AI keeps both in one passbook, split by Cash and Online, so the treasurer always knows what is in hand and what each member owes.",
      "Built for pilgrimage yatras, family tours, society and school trips, and tour organisers across India.",
    ],
    faq: [
      ["Do I need an API key?", "No. Demo Mode works instantly for text entries. Add a free Google Gemini key in Settings to unlock bill scanning and understanding of every language."],
      ["Where is my data stored?", "Only in your own browser. Use Settings → Export backup to move it to another device."],
    ],
    ready: "Ready for your next yatra?",
    foot: "Made for Indian group trips 🙏",
  },
  hi: {
    tag: "ग्रुप ट्रिप का हिसाब, आसान तरीके से",
    h1: "आपकी ग्रुप यात्रा का एक-एक रुपया, पूरे हिसाब के साथ।",
    sub: "यात्राओं, पारिवारिक टूर और 15–30+ सदस्यों के ग्रुप के लिए पैसे जमा करें, खर्च देखें और बकाया निपटाएं। बस लिखें, बोलें या बिल की फोटो लें — हिसाब YatraHisab AI रखेगा।",
    see: "खूबियाँ देखें",
    chips: ["15–30+ सदस्य", "12 भारतीय भाषाएँ", "नकद + ऑनलाइन पूल", "डेटा आपके फोन में ही रहता है"],
    sample: "नमूना पासबुक",
    yours: "आपकी यात्राएँ", open: "खोलें",
    ft: "ट्रिप के कैशियर को जो कुछ चाहिए",
    feats: [
      ["✨", "स्मार्ट कमांड बार", "हिंग्लिश, हिंदी या किसी भी भारतीय भाषा में सीधे लिखें। “मोहन ने 2000 कैश दिए और चाय में 650 खर्च हुए” जैसा एक वाक्य दो एंट्री बन जाता है।"],
      ["🎙️", "आवाज़ से एंट्री", "माइक दबाएं और सफर में हाथ लगाए बिना बोलें। Chrome में 12 भाषाओं में चलता है।"],
      ["🧾", "बिल स्कैनर", "रेस्टोरेंट, पेट्रोल या होटल के बिल की फोटो लें। AI कुल रकम, दुकान, तारीख और श्रेणी खुद पढ़ लेता है।"],
      ["👥", "सबने दिया? एक ही वाक्य", "“सबने 500 दिए” बोलें और हर सदस्य के नाम अलग से ₹500 जमा हो जाते हैं।"],
      ["💰", "आवक–जावक पूल", "जमा और खर्च का हिसाब लाइव देखें, हाथ में नकद और ऑनलाइन/बैंक बैलेंस अलग-अलग।"],
      ["📒", "सदस्य का हिसाब", "हर सदस्य की बही: ऑनलाइन, नकद, प्रति व्यक्ति हिस्सा और कौन अतिरिक्त, बाकी या बराबर है।"],
      ["👤", "निजी खर्च", "निजी खर्च ग्रुप के खर्च में नहीं जुड़ते, सिर्फ उसी सदस्य के हिसाब में कटते हैं।"],
      ["📲", "WhatsApp और CSV", "एक टैप में श्रेणी-अनुसार खर्च और बकाया वाला सारांश कॉपी करें। सब कुछ Excel में निकालें।"],
      ["🧮", "कैलकुलेटर और बैकअप", "बिल्ट-इन कैलकुलेटर, कई ट्रिप, और JSON बैकअप व रिस्टोर। आपका डेटा आपके ब्राउज़र में ही रहता है।"],
    ],
    how: "कैसे काम करता है",
    steps: [
      ["अपनी यात्रा बनाएं", "नाम लिखें, प्रति व्यक्ति लक्ष्य तय करें और WhatsApp से सदस्यों की सूची सीधे पेस्ट करें।"],
      ["अपने तरीके से एंट्री करें", "लिखें, बोलें या बिल स्कैन करें। एक टैप में पक्का करें, बदलें या वापस लें।"],
      ["हिसाब शेयर करें", "सारांश ग्रुप में कॉपी करें, या यात्रा खत्म होने पर CSV निकालें।"],
    ],
    say: "जैसे बोलते हैं, वैसे ही कहिए",
    sayNote: "एक वाक्य, दो एंट्री। एक टैप में पक्का करें या वापस लें।",
    about: "YatraHisab AI के बारे में",
    aboutP: [
      "आवक यानी आने वाला पैसा (सदस्यों से जमा) और जावक यानी जाने वाला पैसा (ग्रुप का खर्च)। YatraHisab AI दोनों को एक पासबुक में नकद और ऑनलाइन के हिसाब से रखता है, ताकि कैशियर को हमेशा पता रहे कि हाथ में कितना है और किस पर कितना बाकी है।",
      "तीर्थ यात्राओं, पारिवारिक टूर, सोसाइटी और स्कूल ट्रिप तथा पूरे भारत के टूर ऑर्गनाइज़र के लिए बना है।",
    ],
    faq: [
      ["क्या API कुंजी ज़रूरी है?", "नहीं। डेमो मोड में लिखकर एंट्री तुरंत चलती है। बिल स्कैन और हर भाषा समझने के लिए सेटिंग्स में मुफ़्त Google Gemini कुंजी डालें।"],
      ["मेरा डेटा कहाँ रहता है?", "सिर्फ आपके अपने ब्राउज़र में। दूसरे डिवाइस पर ले जाने के लिए सेटिंग्स → बैकअप निकालें इस्तेमाल करें।"],
    ],
    ready: "अगली यात्रा के लिए तैयार?",
    foot: "भारतीय ग्रुप ट्रिप के लिए बना 🙏",
  },
};

function Home({ lang, onLang, trips, onNew, onOpen }) {
  const T = useT();
  const h = HOME[lang] || HOME.en;
  const cta = (
    <button onClick={onNew} className={`${btn} gap-2 bg-amber-400 px-6 py-3 text-base text-indigo-950 shadow-lg`}><Plus size={18} />{T("newTrip")} →</button>
  );
  const rows = [["Ramesh", "online", "+₹5,000", 1], ["Suresh", "cash", "+₹3,000", 1], ["Mohan", "cash", "+₹2,000", 1], ["Hotel advance", "online", "−₹4,000", 0], ["Chai-nashta", "cash", "−₹650", 0]];
  const sec = "mx-auto max-w-5xl px-4 py-10";
  return (
    <div>
      <header className="bg-indigo-950 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between p-3">
          <span className="text-lg font-extrabold">Yatra<span className="text-amber-400">Hisab</span> AI</span>
          <select aria-label="Language" className="rounded-lg bg-white/10 px-2 py-2 text-sm font-semibold text-white" value={lang} onChange={(e) => onLang(e.target.value)}>
            {LANGS.map(([c, n]) => <option key={c} value={c} className="text-slate-900">{n}</option>)}
          </select>
        </div>
        <div className="mx-auto grid max-w-5xl gap-10 px-4 pb-14 pt-6 md:grid-cols-2 md:items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-amber-300">{h.tag}</p>
            <h1 className="mt-3 text-4xl font-extrabold leading-tight md:text-5xl">{h.h1}</h1>
            <p className="mt-4 text-lg text-indigo-100">{h.sub}</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {cta}
              <a href="#features" className={`${btn} border-2 border-white/40 px-5 py-3 text-base text-white`}>{h.see}</a>
            </div>
            <ul className="mt-6 flex flex-wrap gap-2 text-sm">
              {h.chips.map((c) => <li key={c} className="rounded-full bg-white/10 px-3 py-1 font-semibold">{c}</li>)}
            </ul>
          </div>
          <div aria-hidden="true" className="rotate-1 rounded-2xl border-l-8 border-amber-400 bg-[#FFFBEF] p-4 text-slate-900 shadow-2xl" dir="ltr">
            <div className="mb-1 flex justify-between text-xs font-bold uppercase tracking-wide text-slate-500"><span>{h.sample}</span><span>Vaishno Devi Yatra</span></div>
            {rows.map(([n, m, a, pos]) => (
              <div key={n} className="flex items-center justify-between border-b border-dashed border-slate-300 py-2 text-sm">
                <span><b>{n}</b> <span className="text-xs text-slate-500">{T(m)}</span></span>
                <b className={pos ? "text-green-700" : "text-red-700"}>{a}</b>
              </div>
            ))}
            <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded-lg bg-indigo-950 p-2 text-white">{T("hand")}<br /><b className="text-base text-amber-300">₹4,350</b></div>
              <div className="rounded-lg bg-indigo-950 p-2 text-white">{T("bank")}<br /><b className="text-base text-amber-300">₹1,000</b></div>
            </div>
          </div>
        </div>
      </header>

      {trips.length > 0 && (
        <section className={sec}>
          <h2 className="mb-3 text-xl font-extrabold text-indigo-950">{h.yours}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {trips.map((t) => (
              <button key={t.id} onClick={() => onOpen(t.id)} className="flex items-center justify-between rounded-xl border-2 border-slate-200 bg-white p-4 text-left active:scale-[0.99]">
                <span><b className="block">{t.name}</b><span className="text-sm text-slate-600">{t.members.length} {T("tabM")}</span></span>
                <span className="font-bold text-indigo-900">{h.open} →</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section id="features" className={sec}>
        <h2 className="mb-6 text-2xl font-extrabold text-indigo-950 md:text-3xl">{h.ft}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {h.feats.map(([e, t, d]) => (
            <div key={t} className="rounded-2xl border-2 border-slate-200 bg-white p-5">
              <div className="text-3xl">{e}</div>
              <h3 className="mt-2 text-lg font-bold text-indigo-950">{t}</h3>
              <p className="mt-1 text-slate-700">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white">
        <div className={sec}>
          <h2 className="mb-6 text-2xl font-extrabold text-indigo-950 md:text-3xl">{h.how}</h2>
          <ol className="grid gap-6 md:grid-cols-3">
            {h.steps.map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-400 text-lg font-extrabold text-indigo-950">{i + 1}</span>
                <span><b className="block text-lg text-indigo-950">{t}</b><span className="text-slate-700">{d}</span></span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={sec}>
        <h2 className="mb-1 text-2xl font-extrabold text-indigo-950 md:text-3xl">{h.say}</h2>
        <p className="mb-5 text-slate-600">{h.sayNote}</p>
        <div className="mx-auto max-w-2xl" dir="ltr">
          <div className="ml-auto w-fit max-w-[92%] rounded-2xl rounded-br-sm bg-indigo-950 px-4 py-3 text-white">“Mohan ne 2000 cash diye aur chai-nashte me 650 cash kharch hue”</div>
          <div className="mt-3 space-y-2">
            {[["IN", "green", "Mohan", "+₹2,000"], ["OUT", "red", "Food", "−₹650"]].map(([ty, c, n, a]) => (
              <div key={ty} className={`flex items-center gap-2 rounded-xl border-2 bg-white p-3 text-sm ${c === "green" ? "border-green-700" : "border-red-700"}`}>
                <span className={`rounded px-2 py-0.5 text-xs font-bold ${TYPE_UI[ty].c}`}>{T(TYPE_TK[ty])}</span>
                <span className="flex-1">{n} · {T("cash")}</span><b>{a}</b>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className={`${sec} grid gap-8 md:grid-cols-2`}>
          <div>
            <h2 className="mb-3 text-2xl font-extrabold text-indigo-950">{h.about}</h2>
            {h.aboutP.map((x) => <p key={x} className="mb-3 text-slate-700">{x}</p>)}
          </div>
          <div className="space-y-2">
            {h.faq.map(([q, a]) => (
              <details key={q} className="rounded-xl border-2 border-slate-200 p-4">
                <summary className="cursor-pointer font-bold text-indigo-950">{q}</summary>
                <p className="mt-2 text-slate-700">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-indigo-950 px-4 py-12 text-center text-white">
        <h2 className="mb-5 text-2xl font-extrabold md:text-3xl">{h.ready}</h2>
        {cta}
        <p className="mt-8 text-sm text-indigo-200">{h.foot}</p>
      </section>
    </div>
  );
}

/* ───────── Calculator ───────── */
function calcEval(src) {
  const tk = src.match(/\d*\.?\d+|[+\-×÷()%]/g) || [];
  let i = 0;
  const peek = () => tk[i];
  const expr = () => {
    let l = term();
    while (peek() === "+" || peek() === "-") {
      const op = tk[i++];
      let r = term();
      if (peek() === "%") { i++; r = (l * r) / 100; } // 200 + 10% = 220
      l = op === "+" ? l + r : l - r;
    }
    return l;
  };
  const term = () => {
    let l = unary();
    while (peek() === "×" || peek() === "÷") {
      const op = tk[i++];
      let r = unary();
      if (peek() === "%") { i++; r /= 100; }
      l = op === "×" ? l * r : l / r;
    }
    return l;
  };
  const unary = () => (peek() === "-" ? (i++, -unary()) : peek() === "+" ? (i++, unary()) : prim());
  const prim = () => {
    const t = tk[i++];
    if (t === "(") { const v = expr(); if (peek() === ")") i++; return v; }
    const n = parseFloat(t);
    if (isNaN(n)) throw new Error("bad");
    return n;
  };
  let v = expr();
  if (peek() === "%") { i++; v /= 100; }
  if (i < tk.length || !isFinite(v)) throw new Error("bad");
  return Number(v.toPrecision(12));
}

function CalcPad({ onClose }) {
  const [ex, setEx] = useState("");
  const [done, setDone] = useState(false);
  let res = "";
  try { if (ex) res = calcEval(ex).toLocaleString("en-IN", { maximumFractionDigits: 8 }); } catch {}
  const press = (k) => {
    if (k === "C") { setEx(""); setDone(false); return; }
    if (k === "⌫") { setEx((e) => e.slice(0, -1)); setDone(false); return; }
    if (k === "=") { try { setEx(String(calcEval(ex))); setDone(true); } catch {} return; }
    const isOp = /[+\-×÷]/.test(k);
    setEx((e) => {
      if (done && !isOp && k !== "%") e = ""; // start a fresh number after a result
      if (!e && isOp && k !== "-") return e;
      if (isOp && /[+\-×÷]$/.test(e)) return e.slice(0, -1) + k; // change operator
      if (k === ".") {
        if (/\.\d*$/.test(e)) return e;
        return e + (!e || /[+\-×÷(]$/.test(e) ? "0." : ".");
      }
      return e + k;
    });
    setDone(false);
  };
  const pr = useRef(); pr.current = press;
  useEffect(() => {
    const map = { "*": "×", "/": "÷", Enter: "=", Backspace: "⌫", c: "C", C: "C" };
    const h = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === "Escape") return onClose();
      const k = map[e.key] || e.key;
      if (/^[0-9.+\-×÷%()=⌫C]$/.test(k)) { e.preventDefault(); pr.current(k); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const keys = ["C", "⌫", "%", "÷", "7", "8", "9", "×", "4", "5", "6", "-", "1", "2", "3", "+", "0", "."];
  const cls = (k) => k === "C" ? "bg-red-100 text-red-800" : /[+\-×÷%⌫]/.test(k) ? "bg-amber-100 text-indigo-950" : "bg-slate-100";
  return (
    <div>
      <div className="mb-3 rounded-xl bg-indigo-950 p-3 text-right text-white" dir="ltr">
        <div className="min-h-6 break-all text-sm text-indigo-200">{ex || "0"}</div>
        <div className="min-h-10 break-all text-3xl font-extrabold">{res ? `= ${res}` : "\u00A0"}</div>
      </div>
      <div className="grid grid-cols-4 gap-2" dir="ltr">
        {keys.map((k) => <button key={k} className={`rounded-xl py-4 text-xl font-bold active:scale-95 ${cls(k)}`} onClick={() => press(k)}>{k === "-" ? "−" : k}</button>)}
        <button className="col-span-2 rounded-xl bg-indigo-950 py-4 text-xl font-bold text-white active:scale-95" onClick={() => press("=")}>=</button>
      </div>
    </div>
  );
}

/* ───────── App ───────── */
function AppInner({ store, setStore }) {
  const lang = store.lang || "en";
  const T = mkT(lang);
  const trip = store.trips.find((t) => t.id === store.active);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState("members");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [heard, setHeard] = useState("");
  const [warn, setWarn] = useState("");
  const [home, setHome] = useState(false);
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
    setBusy(true); setErr(""); setWarn("");
    try {
      const names = trip.members.map((m) => m.name);
      let items;
      const hing = toHinglish(text);
      setHeard(text && hing !== text ? hing : "");
      if (store.key) {
        const parts = img ? [{ inlineData: { mimeType: "image/jpeg", data: img } }, { text: "This is a receipt/bill. Extract it as ONE OUT transaction: total amount, merchant as description, category, date. " + (text || "") }] : [{ text: hing === text ? text : `${hing}\n(original: ${text})` }];
        items = await gemini(store.key, parts, names);
      } else if (img) throw new Error("eNoKey");
      else items = demoParse(hing, names);
      items = items.filter((i) => Number(i.amount) > 0).flatMap((i) => (i.everyone && i.type !== "OUT" ? names.map((n) => ({ ...i, member: n, everyone: false, exact: true })) : [i]));
      const good = [], bad = [];
      items.forEach((i) => {
        if (i.type === "OUT") return good.push(i);
        const m = i.exact ? i.member : findMember(i.member, names);
        if (m) good.push({ ...i, member: m }); else bad.push(i.member || i.description);
      });
      const noMember = bad.length ? T("eNoMember").replace("{n}", bad.join(", ")) : "";
      if (!good.length) throw new Error(noMember || "eNoParse");
      const txs = good.map(toTx);
      upd((t) => ({ ...t, tx: [...t.tx, ...txs] }));
      setWarn(noMember);
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

  const wrap = (c) => <div dir={lang === "ur" ? "rtl" : "ltr"} className="min-h-screen bg-[#FBF7EE] text-slate-900">{c}</div>;
  if (creating)
    return wrap(<Setup onCreate={(t) => { setStore((x) => ({ ...x, trips: [...x.trips, t], active: t.id })); setCreating(false); setHome(false); }} onCancel={() => setCreating(false)} />);
  if (!trip || home)
    return wrap(<Home lang={lang} onLang={(l) => setStore((x) => ({ ...x, lang: l }))} trips={store.trips} onNew={() => setCreating(true)} onOpen={(id) => { setStore((x) => ({ ...x, active: id })); setHome(false); }} />);

  const cards = [
    [T("cIn"), sum.inn, `${T("cash")} ${fmt(sum.cashIn)} · ${T("online")} ${fmt(sum.onlineIn)}`, "border-green-700"],
    [T("cOut"), sum.out, `${T("cash")} ${fmt(sum.cashOut)} · ${T("online")} ${fmt(sum.onlineOut)}${sum.pers ? ` · ${T("tabX")} ${fmt(sum.pers)}` : ""}`, "border-red-700"],
    [T("cNet"), sum.net, `${T("hand")} ${fmt(sum.cashHand)} · ${T("bank")} ${fmt(sum.bank)}`, "border-indigo-900"],
    [T("cPh"), sum.perHead, `${trip.members.length} ${T("tabM")}`, "border-amber-500"],
  ];

  return (
    <div dir={lang === "ur" ? "rtl" : "ltr"} className="min-h-screen bg-[#FBF7EE] pb-32 text-slate-900">
      <header className="flex items-center gap-2 bg-indigo-950 p-3 text-white">
        <div className="min-w-0 flex-1">
          <button className="block text-xs text-amber-300" onClick={() => setHome(true)}>🏠 YatraHisab AI · v7 {!store.key && "· Demo Mode"}</button>
          <select className="w-full truncate bg-transparent text-lg font-bold" value={store.active} onChange={(e) => setStore((s) => ({ ...s, active: e.target.value }))}>
            {store.trips.map((t) => <option key={t.id} value={t.id} className="text-slate-900">{t.name}</option>)}
          </select>
        </div>
        <button className={`${btn} bg-white/10`} onClick={() => setCreating(true)}><Plus size={16} />Trip</button>
        <button aria-label="Calculator" className={`${btn} bg-white/10`} onClick={() => setModal({ k: "calc" })}><Calculator size={18} /></button>
        <select aria-label="Language" className="rounded-lg bg-white/10 px-1 py-2 text-sm font-semibold text-white" value={lang} onChange={(e) => setStore((x) => ({ ...x, lang: e.target.value }))}>{LANGS.map(([c, n]) => <option key={c} value={c} className="text-slate-900">{n}</option>)}</select>
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
          {[["members", T("tabM")], ["passbook", T("tabP")], ["personal", T("tabX")], ["reports", T("tabR")]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`${btn} flex-1 ${tab === k ? "bg-indigo-950 text-white" : "text-slate-700"}`}>{l}</button>
          ))}
        </nav>

        {tab === "members" && <MembersTab trip={trip} sum={sum} upd={upd} addEntry={(n) => setModal({ k: "entry", t: blank(n) })} />}
        {tab === "passbook" && (
          <>
            <button className={`${btn} mb-3 border-2 border-indigo-950`} onClick={() => setModal({ k: "entry", t: { ...blank(), type: "OUT", cat: "Misc" } })}><Plus size={16} />{T("manual")}</button>
            <Passbook trip={trip} edit={(t) => setModal({ k: "entry", t })} del={delTx} />
          </>
        )}
        {tab === "personal" && <PersonalTab trip={trip} edit={(t) => setModal({ k: "entry", t })} del={delTx} add={() => setModal({ k: "entry", t: { ...blank(), type: "PERSONAL", cat: "Personal" } })} />}
        {tab === "reports" && <Reports trip={trip} sum={sum} />}
      </main>

      {err && (
        <div className="fixed inset-x-3 bottom-24 z-40 mx-auto flex max-w-3xl items-start gap-2 rounded-xl bg-red-700 p-3 text-white">
          <span className="flex-1 text-sm font-medium">{T(err)}</span><button onClick={() => setErr("")}><X size={18} /></button>
        </div>
      )}
      {toast && !err && (
        <div className="fixed inset-x-3 bottom-24 z-40 mx-auto max-w-3xl space-y-2 rounded-xl border-2 border-green-700 bg-white p-3 shadow-lg">
          <div className="flex justify-between text-sm font-bold text-green-800">{T("created")}<button onClick={() => setToast(null)}><X size={18} /></button></div>
          {heard && <div className="text-xs text-slate-600">{T("heard")}: “{heard}”</div>}
          {warn && <div className="text-xs font-bold text-red-700">{warn}</div>}
          {toast.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-sm">
              <span className={`rounded px-2 py-0.5 text-xs font-bold ${TYPE_UI[t.type].c}`}>{T(TYPE_TK[t.type])}</span>
              {t.type !== "OUT" && !t.member && <span className="text-xs font-bold text-red-700">{T("noMem")}</span>}
              <span className="min-w-0 flex-1 truncate">{t.member ? `${t.member} · ` : ""}{t.desc} · {t.cat} · {T(t.mode === "Cash" ? "cash" : "online")}</span>
              <b>{fmt(t.amt)}</b>
              <button aria-label="Edit" onClick={() => setModal({ k: "entry", t })}><Pencil size={16} /></button>
              <button aria-label="Undo" onClick={() => delTx(t.id)}><Undo2 size={16} /></button>
            </div>
          ))}
        </div>
      )}

      <CommandBar onRun={run} busy={busy} onErr={setErr} demo={!store.key} />
      {modal?.k === "settings" && <SettingsModal store={store} setStore={setStore} trip={trip} onClose={() => setModal(null)} />}
      {modal?.k === "calc" && <Modal title="Calculator" onClose={() => setModal(null)}><CalcPad onClose={() => setModal(null)} /></Modal>}
      {modal?.k === "entry" && <EntryModal init={modal.t} members={trip.members} onSave={saveTx} onClose={() => setModal(null)} />}
    </div>
  );
}

export default function App() {
  const [store, setStore] = useStore();
  return (
    <LangCtx.Provider value={store.lang || "en"}>
      <AppInner store={store} setStore={setStore} />
    </LangCtx.Provider>
  );
}
