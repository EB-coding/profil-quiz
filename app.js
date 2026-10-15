"use strict";
// ---------- Constantes ----------
const N = ITEMS.length;
const CODE_PREFIX = "PQ1-";
const STORE_KEY = "pq_evals_v1";
const SYNTH_KEY = "pq_synth_v1";
const DERIVED_KEYS = new Set(DERIVED.map(d => d[0]));

const SCALES = {
  A: ["Pas du tout d'accord","Pas d'accord","Plutôt pas d'accord","Neutre","Plutôt d'accord","D'accord","Totalement d'accord"],
  F: ["Jamais","Très rarement","Rarement","Parfois","Souvent","Très souvent","Toujours"],
  B: ["Totalement","Plutôt","Un peu","Entre les deux","Un peu","Plutôt","Totalement"],
};
const CTX = {
  rel:  {q:"Votre relation", o:{ami:"Ami·e proche", groupe:"Ami·e du groupe", couple:"Couple", famille:"Famille", collegue:"Camarade / collègue", autre:"Autre"}},
  dur:  {q:"Depuis combien de temps tu connais cette personne", o:{"1":"Moins d'1 an", "3":"1 à 3 ans", "4":"Plus de 3 ans"}},
  obj:  {q:"Ton objectif", o:{reparer:"Réparer la relation", limites:"Poser des limites et garder la relation", distance:"Prendre de la distance", indecis:"Pas encore décidé"}},
  conf: {q:"La confrontation se ferait", o:{solo:"Seul à seul", groupe:"En groupe", aucune:"Pas de confrontation prévue"}},
  dep:  {q:"Vous partagez un cadre difficile à quitter (groupe d'amis, classe, travail, famille)", o:{oui:"Oui", non:"Non"}},
};

// Ordre de passage : mélangé une fois pour toutes (même ordre pour tout le monde)
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const ORDER = (() => { const r = mulberry32(20261006); const a = [...Array(N).keys()];
  for (let i = a.length-1; i > 0; i--) { const j = Math.floor(r()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; } return a; })();

// ---------- Utilitaires ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = s => String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").trim().toLowerCase();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const fmtDate = ts => new Date(ts).toLocaleDateString("fr-FR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
const md = s => String(s).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>");
const avg = arr => { const xs = arr.filter(x => x != null); return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null; };

function tx(s, who){
  if (!s) return "";
  const f = who.g === "f";
  return s.replace(/\[([^|\]]*)\|([^\]]*)\]/g, (_, m, w) => f ? w : m)
    .replace(/\{P\}/g, esc(who.t || "cette personne"))
    .replace(/\{Il\}/g, f ? "Elle" : "Il").replace(/\{il\}/g, f ? "elle" : "il")
    .replace(/\{le\}/g, f ? "la" : "le").replace(/\{soi\}/g, f ? "elle" : "lui")
    .replace(/\{sil\}/g, f ? "si elle" : "s'il");
}

const LS = {
  get(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch(e){ return false; } },
};
let evals = LS.get(STORE_KEY, {});
function persist(){ LS.set(STORE_KEY, evals); }

function b64e(s){ const b = new TextEncoder().encode(s); let bin = ""; b.forEach(x => bin += String.fromCharCode(x));
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function b64d(s){ s = s.replace(/-/g,"+").replace(/_/g,"/"); while (s.length % 4) s += "=";
  const bin = atob(s); const b = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) b[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(b); }

function padAnswers(a){ a = a || ""; return a.length >= N ? a.slice(0, N) : a + "-".repeat(N - a.length); }
function encodeEval(ev){ return CODE_PREFIX + b64e(JSON.stringify({v:1, m:ev.m, r:ev.r, t:ev.t, g:ev.g, c:ev.c||{}, a:ev.a, d:ev.d})); }
function decodeCode(code){
  try { const o = JSON.parse(b64d(code.slice(CODE_PREFIX.length)));
    if (!o || !o.a || !o.m) return null; o.a = padAnswers(o.a); return o; } catch(e){ return null; }
}
function extractCodes(text){ return (String(text).match(/PQ1-[A-Za-z0-9_-]{20,}/g) || []).map(decodeCode).filter(Boolean); }

async function copyText(t, btn){
  let ok = false;
  try { await navigator.clipboard.writeText(t); ok = true; } catch(e) {
    const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand("copy"); } catch(_){} ta.remove();
  }
  if (btn){ const old = btn.textContent; btn.textContent = ok ? "Copié ✓" : "Copie impossible — sélectionne le texte"; setTimeout(()=>btn.textContent = old, 1800); }
}

// ---------- Réponses & scores ----------
const valAt = (a, i) => { const c = a[i]; return (c >= "0" && c <= "6") ? (+c - 3) : (c === "x" ? "x" : null); };
const answeredCount = a => [...a].filter(c => c !== "-").length;

function computeScores(a){
  const acc = {};
  ITEMS.forEach((it, i) => {
    const v = valAt(a, i); if (typeof v !== "number") return;
    for (const [k, w] of Object.entries(it.w)) {
      const x = ((w > 0 ? v : -v) + 3) / 6;
      (acc[k] ||= {num:0, den:0}); acc[k].num += Math.abs(w) * x; acc[k].den += Math.abs(w);
    }
  });
  const V = {}, C = {};
  for (const k of Object.keys(AXES)) { if (acc[k] && acc[k].den > 0) { V[k] = 100 * acc[k].num / acc[k].den; C[k] = acc[k].den; } else V[k] = null; }
  applyDerived(V);
  return {V, C};
}
function applyDerived(V){
  for (const [k, ws] of DERIVED) {
    let num = 0, den = 0;
    for (const [s, w] of Object.entries(ws)) { if (V[s] == null) continue; num += Math.abs(w) * (w > 0 ? V[s] : 100 - V[s]); den += Math.abs(w); }
    V[k] = den ? num / den : null;
  }
}
function level(v){ if (v == null) return "—"; return v < 20 ? "très faible" : v < 40 ? "faible" : v < 60 ? "moyen" : v < 80 ? "élevé" : "très élevé"; }

// Statut d'un axe : la couleur dépend du sens du score, pas de sa hauteur
function concernOf(k, v){ const p = AXES[k].p; return v == null || p === 0 ? null : (p < 0 ? v : 100 - v); }
function status(k, v){
  if (v == null) return {c:"na", w:"—"};
  if (AXES[k].p === 0) return (v >= 75 || v <= 25) ? {c:"warn", w:"Extrême"} : {c:"desc", w:"Descriptif"};
  const c = concernOf(k, v);
  return c >= 70 ? {c:"bad", w:"Problématique"} : c >= 57 ? {c:"warn", w:"À surveiller"} : c >= 40 ? {c:"mid", w:"Dans la moyenne"} : {c:"ok", w:"Sain"};
}
const isConcern = (k, v) => { const s = status(k, v).c; return s === "bad" || s === "warn"; };
const visibleAxes = () => Object.keys(AXES).filter(k => !AXES[k].hide);

// ---------- Lectures dérivées ----------
function readings(V, who){
  const T = s => tx(s, who), v = k => V[k];
  const R = {};
  // Intention × maladresse
  const it = v("intent"), cl = v("clumsy");
  if (it != null) {
    R.intent = it; R.clumsy = cl;
    const maladroit = cl != null && cl >= 55;
    if (it < 40) { R.zone = maladroit ? "maladroit" : "sain"; }
    else if (it >= 60) { R.zone = maladroit ? "desordonne" : "manip"; }
    else R.zone = maladroit ? "grisM" : "gris";
    R.zoneTxt = {
      sain: "**Bienveillant et plutôt adroit** : pas de volonté de nuire ni de maladresse marquée. Les problèmes sont sans doute ponctuels ou liés à des situations précises.",
      maladroit: "**L'enfer pavé de bonnes intentions** : pas de volonté de nuire, mais des dégâts réels par maladresse, lâcheté ou négligence.",
      manip: "**Malveillance maîtrisée** : les torts sont faits en connaissance de cause. C'est la zone du profil manipulateur.",
      desordonne: "**Malveillance désordonnée** : des intentions peu bienveillantes, mais sans vraie stratégie : les torts sont impulsifs ou brouillons.",
      grisM: "**Zone grise, plutôt maladroite** : un mélange de maladresse et de comportements intéressés ; l'intention n'est ni clairement bonne ni clairement mauvaise.",
      gris: "**Zone grise** : ni clairement bienveillant, ni clairement malveillant. Les faits concrets feront la différence.",
    }[R.zone];
  }
  // Prochaska
  const c = v("consc"), w = v("volont"), a = v("acte");
  if (c != null) {
    if (c < 45) R.stage = "Précontemplation";
    else if ((w ?? 50) < 50) R.stage = "Contemplation";
    else if ((a ?? 50) < 45) R.stage = "Préparation";
    else if ((a ?? 50) < 70) R.stage = "Action";
    else R.stage = "Maintien";
  }
  R.stageTxt = {
    "Précontemplation": "Ne voit pas (ou peu) le problème, ou le place chez les autres.",
    "Contemplation": "Voit qu'il y a un problème mais hésite à changer.",
    "Préparation": "Veut changer mais ne passe pas vraiment à l'acte.",
    "Action": "A commencé à changer concrètement.",
    "Maintien": "A changé et tient dans la durée.",
  }[R.stage] || "";
  // Attachement
  const an = v("attAnx"), av = v("attAvo");
  if (an != null && av != null) R.attach = an < 50 && av < 50 ? "Sécure" : an >= 50 && av < 50 ? "Anxieux (préoccupé)" : an < 50 ? "Évitant (détaché)" : "Craintif (anxieux + évitant)";
  // Karpman
  const kv = [["Victime", v("vic")], ["Persécuteur", v("pers")], ["Sauveur", v("sauv")]].filter(x => x[1] != null).sort((x,y)=>y[1]-x[1]);
  if (kv.length) R.karp = kv[0][1] < 50 ? "Peu pris dans le triangle" : kv[0][0] + (kv[1] && kv[1][1] >= 50 ? " puis " + kv[1][0] : "");
  // AT
  const at = [["Parent critique", v("pc")], ["Parent nourricier", v("pn")], ["Adulte", v("ad")], ["Enfant adapté", v("ea")], ["Enfant libre", v("el")]].filter(x => x[1] != null).sort((x,y)=>y[1]-x[1]);
  if (at.length) R.at = at[0][0];
  // Empathie
  const ec = v("empC"), ea = v("empA");
  if (ec != null && ea != null) {
    if (ec >= 55 && ea <= 45) R.emp = "Empathie « froide » : comprend sans ressentir";
    else if (ec >= 55 && ea >= 55) R.emp = "Empathie complète : comprend et ressent";
    else if (ec < 45 && ea >= 55) R.emp = "Ressent mais décode mal";
    else if (ec < 45 && ea < 45) R.emp = "Faible lecture émotionnelle";
    else R.emp = "Profil d'empathie moyen";
  }
  // Freud
  const ca = v("ca"), mo = v("moi"), su = v("surmoi");
  if (ca != null && mo != null && su != null) {
    R.freud = ca >= 60 && su < 45 ? "Ça dominant : pulsions peu freinées par la morale"
      : su >= 60 && ca < 45 ? "Surmoi dominant : rigidité morale, culpabilité"
      : mo >= 60 ? "Moi solide : bonne régulation"
      : mo < 40 ? "Moi fragile : régulation difficile"
      : "Pas de dominante nette";
  }
  return R;
}
// Axes préoccupants, du plus au moins marqué (hors axes calculés, qui résument les autres)
function concerns(V){
  return visibleAxes().filter(k => !DERIVED_KEYS.has(k) && V[k] != null && isConcern(k, V[k]))
    .sort((a,b) => concernOf(b, V[b]) - concernOf(a, V[a]));
}
function strengths(V, n = 6){
  return visibleAxes().filter(k => !DERIVED_KEYS.has(k) && V[k] != null && AXES[k].p !== 0 && concernOf(k, V[k]) < 35)
    .sort((a,b) => concernOf(a, V[a]) - concernOf(b, V[b])).slice(0, n);
}

// ---------- Recommandations (évaluer quelqu'un / synthèse) ----------
const DODGES = [
  ["deni",   "« Ça s'est pas passé comme ça » / « j'ai jamais dit ça »", "Ne débattez pas du souvenir : appuyez-vous sur des traces (messages, témoins) et sur le fait que plusieurs personnes ont vécu la même chose."],
  ["proj",   "« C'est toi qui… » / « vous aussi vous… »", "« On pourra parler de nous ensuite. Là, on parle de ça. » Notez le reproche pour plus tard, ne basculez pas dessus."],
  ["ratio",  "Une explication logique pour tout", "« Je comprends ta raison. Ça ne change pas l'effet que ça a eu. »"],
  ["bJust",  "« C'était pour ton bien » / « c'était pour rire »", "« L'intention ne change pas l'impact. Est-ce que tu vois l'impact ? »"],
  ["bComp",  "« Y'a pire » / « toi aussi t'as fait… »", "« Peut-être, on pourra en parler. Mais ça n'annule pas ça. »"],
  ["bResp",  "« Tout le monde l'a fait » / « on m'a poussé »", "« Je te parle de ta part à toi. »"],
  ["bMini",  "« C'est pas grave » / « tu exagères »", "« Pour toi peut-être. Pour moi ça l'a été, et c'est de ça qu'on parle. »"],
  ["bBlame", "« T'es trop sensible » / « tu l'as cherché »", "« Ma réaction n'est pas le sujet. Ce qui s'est passé l'est. »"],
  ["darvo",  "Inversion : {il} devient [celui|celle] qui souffre de la discussion", "« Je vois que c'est dur pour toi. On revient quand même à ce qui s'est passé. » Ne vous excusez pas d'avoir soulevé le sujet."],
  ["vic",    "Se plaint, se pose en impuissant[|e]", "Ni sauver (« pardon, laisse tomber ») ni attaquer (« arrête de te victimiser ») : restez factuels — « Qu'est-ce que tu proposes ? »"],
  ["pers",   "Contre-attaque, hausse le ton", "Ne répondez pas à l'attaque par l'attaque. Ralentissez, répétez calmement votre demande, proposez une pause si besoin."],
  ["sauv",   "Rappelle tout ce qu'{il} a fait pour vous", "« Merci pour ça, c'est vrai. Ça ne règle pas ce dont on parle. »"],
  ["yAssuj", "« Oui oui, t'as raison » trop vite, pour clore", "Un oui rapide n'est pas un accord. « Qu'est-ce que tu vas faire concrètement, et quand ? »"],
  ["attAvo", "Fuit : « on en parle plus tard », ne répond plus, s'en va", "Prévenez à l'avance qu'il y a un sujet important (pas de guet-apens) et fixez un moment. Un premier message écrit et posé peut aider, mais la vraie discussion doit avoir lieu en face."],
  ["dbind",  "Réponses floues ou contradictoires", "Reformulez : « donc concrètement, c'est X ou Y ? » et mettez par écrit ce qui est décidé."],
  ["histrio","Dramatise, fait monter l'émotion", "Ne vous laissez pas embarquer : baissez le ton, revenez au fait précis."],
  ["border", "Réaction émotionnelle forte (colère ou effondrement)", "Pause. Aucune décision dans la tempête ; reprenez quand c'est retombé."],
  ["jeux",   "Le scénario habituel se rejoue", "Nommez-le avant qu'il démarre (« d'habitude ça finit comme ça, cette fois on fait autrement ») et fixez un objectif concret à l'échange."],
];

function buildRecs(V, ctx, who){
  const T = s => md(tx(s, who));
  const R = readings(V, who);
  const has = (k, th = 60) => V[k] != null && V[k] >= th;
  const low = (k, th = 40) => V[k] != null && V[k] <= th;
  const S = [];

  const see = [];
  if (R.zoneTxt) see.push(`Intention : ${R.zoneTxt}`);
  if (R.stage) see.push(`Stade de changement : **${R.stage}**. ${R.stageTxt}`);
  if (V.D != null) see.push(V.D >= 65 ? "Noyau sombre (facteur D) **élevé** : {P} sert régulièrement son intérêt aux dépens des autres, en se justifiant."
    : V.D >= 50 ? "Noyau sombre (facteur D) **modéré** : des comportements égoïstes ou manipulateurs ponctuels, pas un fonctionnement de fond."
    : "Noyau sombre (facteur D) **faible** : la malveillance de fond n'est pas ce qui ressort.");
  if (low("H")) see.push("Honnêteté-Humilité **basse** : la sincérité et le besoin de paraître sont des points centraux.");
  if (R.emp) see.push(`Empathie : **${R.emp}**.`);
  if (R.karp) see.push(`Triangle de Karpman : **${R.karp}**.`);
  if (R.attach) see.push(`Attachement : **${R.attach}**.`);
  S.push({h:"Ce qui ressort", items:see});

  const st = [];
  st.push({
    "Précontemplation": "**{P} ne voit probablement pas le problème** (ou le place chez les autres). Objectif réaliste du premier échange : pas des aveux, mais semer le doute. Montrez l'écart entre l'image qu'{il} a de {soi} et ce que vous observez, posez des questions plutôt que des accusations (« comment tu expliques que plusieurs personnes, chacune de son côté, aient remarqué ça ? »), et laissez-lui du temps.",
    "Contemplation": "**{P} voit qu'il y a un problème mais hésite.** Aidez-{le} à trancher en {le} faisant formuler {soi}-même ce que ça coûte (à {soi} et aux autres) — on croit davantage ce qu'on dit soi-même. Terminez par « qu'est-ce que tu comptes faire ? » plutôt que par vos solutions.",
    "Préparation": "**{P} veut changer mais ne passe pas à l'acte.** Transformez les bonnes intentions en engagements concrets, observables et datés (« la prochaine fois que X, tu fais Y »).",
    "Action": "**{P} a commencé à changer.** Reconnaissez-le explicitement : c'est ce qui rend le changement durable. Une confrontation lourde serait contre-productive ; gardez des attentes claires.",
    "Maintien": "**{P} a changé et tient.** Reconnaissez-le explicitement ; restez sur des points précis s'il en reste.",
  }[R.stage] || "Commencez par les faits : ils détermineront la suite.");
  const it = V.intent;
  if (it != null && it < 55) st.push("Intention plutôt bonne : le levier principal est de **sécuriser** et de **rendre l'impact visible**. Dites clairement que c'est le comportement qui pose problème, pas sa place parmi vous. Plus {il} se sent menacé[|e], plus {il} fuira ou mentira.");
  if (it != null && it >= 50) st.push("Intention discutable : le levier principal, ce sont **les conséquences**, pas les sentiments. Annoncez ce que vous ferez ou ne ferez plus si ça continue, et tenez-le. Jugez sur les actes, pas sur les excuses.");
  if (has("clumsy")) st.push("Beaucoup de dégâts par maladresse ou manque de courage : demandez des engagements **petits, concrets et datés**, et rendez la franchise facile (« tu peux nous dire non, on préfère ça à un oui qui ne tient pas »).");
  if (has("D", 65)) st.push("Avec un noyau sombre élevé, ne misez pas sur des remords ni sur un changement obtenu par la seule discussion. Priorités : protéger vos limites, garder une trace des faits (dates, messages), décider ensemble des conséquences. Évitez d'exposer vos vulnérabilités pendant l'échange : elles pourraient être réutilisées.");
  if (low("surmoi")) st.push("Faible culpabilité ressentie : culpabiliser ne sera pas un levier. Parlez d'enjeux concrets (confiance perdue, place dans le groupe, ce que ça lui coûte personnellement).");
  if (has("surmoi") && has("yHonte")) st.push("Forte exigence envers {soi} et honte : un reproche peut être vécu comme un écrasement, qui se retourne en colère ou en fuite. Dosez, et laissez une porte de sortie honorable.");
  if (has("narcV") || has("yHonte")) st.push("Ego fragile : se faire confronter devant d'autres = humiliation = contre-attaque quasi garantie. Privilégiez un cadre sans public et laissez-lui une façon de reconnaître sans perdre la face (« je ne pense pas que tu l'aies fait pour nuire, mais… »)." + (ctx.conf === "groupe" ? " En groupe, c'est d'autant plus important : pas de spectateurs extérieurs, et pas de ton de tribunal." : ""));
  if (has("narcG")) st.push("Grandiosité : attendez-vous à ce qu'{il} minimise votre parole ou se place au-dessus du débat. Restez sur les faits, n'entrez pas dans un concours de qui a raison.");
  if (R.emp && R.emp.startsWith("Empathie « froide »")) st.push("Empathie froide : ne comptez pas sur l'émotion pour {le} faire bouger, et méfiez-vous des excuses parfaitement calibrées. Exigez du concret.");
  else if (has("empA")) st.push("{P} est sensible à la peine des autres : exprimer simplement l'impact (« quand X, j'ai ressenti Y ») peut avoir plus d'effet que n'importe quel argument.");
  S.push({h:"Stratégie générale", items:st});

  const cx = [];
  if (ctx.conf === "groupe") cx.push("**En groupe**, le risque est qu'{il} vous perçoive comme un tribunal (vous = Persécuteurs) et se mette en Victime. Désignez une personne qui ouvre et cadre l'échange ; chacun apporte ensuite un ou deux faits vécus, pas plus ; une seule personne recadre si ça dérape. Ne parlez pas tous en même temps et ne surenchérissez pas.");
  if (ctx.conf === "solo") cx.push("**Seul à seul** : choisissez un moment calme, sans public, avec du temps devant vous. Préparez 2 ou 3 faits précis plutôt qu'une liste.");
  if (ctx.conf === "aucune") cx.push("Pas de confrontation prévue : ces résultats servent alors à décider de votre position (limites, distance) et à vous protéger.");
  if (ctx.obj === "reparer") cx.push("**Objectif : réparer.** Structure de la communication non violente (CNV) : Observation (fait précis, sans jugement) → Sentiment (ce que ça vous a fait) → Besoin → Demande concrète.");
  if (ctx.obj === "limites") cx.push("**Objectif : poser des limites.** Formulez-les en « si… alors… » (« si X se reproduit, alors on fera Y ») et tenez-les, sinon elles perdent toute valeur.");
  if (ctx.obj === "distance") cx.push("**Objectif : prendre de la distance.** Pas besoin d'obtenir son accord ni des aveux. Expliquez une fois, brièvement, puis réduisez l'investissement (réponses courtes et neutres, technique de la « pierre grise »). Ne vous justifiez pas en boucle.");
  if (ctx.obj === "indecis") cx.push("**Objectif pas encore fixé** : décidez-le avant la confrontation. Chercher des aveux, un changement ou une distance ne se prépare pas de la même façon.");
  if (ctx.dep === "oui") cx.push("Vous partagez un cadre difficile à quitter : préparez l'après (comment vous vous comporterez au quotidien, et ce qui se passe si rien ne change).");
  if (ctx.rel === "couple" && (has("pers") || has("D") || has("sad"))) cx.push("Dans un couple, si vous observez du contrôle, de l'intimidation ou des menaces, ce n'est plus une question de communication : parlez-en à quelqu'un d'extérieur (en France, le 3919 est gratuit et anonyme).");
  if (cx.length) S.push({h:"Selon votre situation", items:cx});

  const dg = DODGES.filter(([k]) => V[k] != null && V[k] >= 58).sort((x,y) => V[y[0]] - V[x[0]]).slice(0, 8)
    .map(([k, say, rep]) => `<span class="dodge">${tx(say, who)}</span> → ${md(tx(rep, who))}`);
  S.push({h:"Ses esquives probables, et quoi répondre", items: dg.length ? dg : ["Pas d'esquive dominante détectée."], raw:true});

  const pd = [
    "Parlez de **comportements précis et datés**, pas d'étiquettes (« manipulateur », « pervers ») : une étiquette se conteste, un fait beaucoup moins.",
    "Une chose à la fois. Pour chaque fait : ce qui s'est passé → l'impact → ce que vous demandez.",
    "Restez factuels et calmes (état « Adulte ») : ni procureurs, ni en train de vous excuser d'en parler.",
  ];
  if (has("attAnx")) pd.push("{P} a peur du rejet : rassurez sur la relation tout en restant fermes sur le comportement (« on tient à toi, et c'est justement pour ça qu'on en parle »).");
  pd.push("Terminez par une **demande concrète et vérifiable**.");
  S.push({h:"Pendant l'échange", items:pd});

  const ap = ["Convenez d'un moment pour refaire le point (dans 2 à 4 semaines)."];
  if (low("acte", 45) || has("incoh")) ap.push("Les promesses passées n'ont pas tenu : jugez **uniquement sur les actes**. Une excuse sans changement, c'est que rien n'a changé.");
  if (has("D") || (it != null && it >= 60)) ap.push("Si rien ne change, appliquez les conséquences annoncées. Un changement de façade (très gentil[|le] pendant quelques jours) est fréquent : regardez la durée.");
  if (it != null && it < 45) ap.push("Valorisez les progrès réels : pour quelqu'un qui agit par peur ou maladresse, la sécurité renforce le changement.");
  ap.push("Un vrai changement se voit dans la durée : moins d'esquives, reconnaissance spontanée, cohérence entre ce qu'{il} dit et ce qu'{il} fait.");
  S.push({h:"Après", items:ap});

  return S.map(s => ({h:s.h, items:s.items.map(x => s.raw ? x : T(x))}));
}

// ---------- Prompt IA ----------
function promptIA({kind, who, ctx, V, raters, range, self, rater}){
  const L = [];
  const subj = kind === "self" ? `moi-même (${who.t})` : `une personne de mon entourage, « ${who.t} » (${who.g === "f" ? "une femme" : "un homme"})`;
  L.push(`Tu es un expert en psychologie des relations (psychométrie, tétrade noire, facteur D, HEXACO, analyse transactionnelle, triangle de Karpman, approche systémique de Palo Alto, mécanismes de défense, désengagement moral de Bandura, DARVO, attachement, thérapie des schémas de Young, modèle de Prochaska). Voici les résultats d'un questionnaire multi-grilles concernant ${subj}.`);
  L.push(`Chaque score va de 0 à 100 (50 = neutre). Ce sont des perceptions issues d'un questionnaire, pas un diagnostic. L'axe « Intention » va de 0 (bonté : torts par maladresse ou lâcheté) à 100 (malveillance : torts intentionnels).`);
  if (kind === "synth") L.push(`Synthèse de ${raters} évaluateur(s) indépendant(s) : moyenne [min–max entre évaluateurs]${self ? ", et l'auto-évaluation de la personne" : ""}.`);
  if (kind === "o" && rater) L.push(`Évaluation faite par ${rater}.`);
  if (ctx && kind !== "self") {
    const cl = Object.entries(CTX).map(([k, d]) => ctx[k] ? `${d.q} : ${d.o[ctx[k]]}` : null).filter(Boolean);
    if (cl.length) L.push("\nContexte :\n- " + cl.join("\n- "));
  }
  L.push("");
  for (const g of GRIDS) {
    L.push(`## ${g.n}`);
    for (const k of g.axes) {
      if (V[k] == null) continue;
      let line = `- ${AXES[k].n} : ${Math.round(V[k])}/100 (${status(k, V[k]).w.toLowerCase()})`;
      if (range && range[k]) line += ` [${Math.round(range[k][0])}–${Math.round(range[k][1])}]`;
      if (self && self[k] != null) line += ` · auto-évaluation : ${Math.round(self[k])}`;
      L.push(line);
    }
  }
  const R = readings(V, who);
  L.push("\n## Lectures dérivées");
  if (R.zone) L.push(`- Carte intention × maladresse : ${R.zoneTxt.replace(/\*\*/g, "")}`);
  if (R.stage) L.push(`- Stade de changement (Prochaska) : ${R.stage}`);
  if (R.attach) L.push(`- Style d'attachement : ${R.attach}`);
  if (R.karp) L.push(`- Karpman : ${R.karp}`);
  if (R.at) L.push(`- État du moi dominant (AT) : ${R.at}`);
  if (R.emp) L.push(`- Empathie : ${R.emp}`);
  if (R.freud) L.push(`- Freud : ${R.freud}`);
  L.push("\nCe que j'attends de toi :");
  if (kind === "self") {
    L.push("1. Une lecture croisée honnête de mon fonctionnement (cohérences et contradictions entre grilles), sans complaisance.");
    L.push("2. Ce qui motive probablement mes comportements problématiques (peur, maladresse, intérêt, besoin de paraître…), avec ton degré de confiance.");
    L.push("3. Un plan concret et progressif pour changer, et comment vérifier que je progresse.");
  } else {
    L.push("1. Une lecture croisée du fonctionnement de cette personne (cohérences et contradictions entre grilles).");
    L.push("2. Tes hypothèses sur ce qui motive ses comportements (maladresse, peur, intérêt, besoin de paraître, plaisir à nuire…), avec ton degré de confiance.");
    if (kind === "synth" && self) L.push("3. Une analyse des écarts entre son auto-évaluation et notre perception, et comment les utiliser pour l'aider à prendre conscience.");
    L.push(`${kind === "synth" && self ? 4 : 3}. Une stratégie de confrontation adaptée à notre objectif et au contexte : déroulé, formulations concrètes, réactions probables et comment y répondre.`);
    L.push(`${kind === "synth" && self ? 5 : 4}. Ce qui doit se passer après : suivi, limites, signes d'un vrai changement vs d'un changement de façade.`);
  }
  L.push("Si des faits concrets te manquent pour être précis, pose-moi d'abord tes questions.");
  return L.join("\n");
}

// ---------- Rendu ----------
let view = {name:"home"};
function go(v){ view = v; render(); window.scrollTo(0, 0); }

function render(){
  const app = $("#app");
  const fn = {home:vHome, setup:vSetup, quiz:vQuiz, review:vReview, results:vResults, import:vImport, synth:vSynth}[view.name] || vHome;
  app.innerHTML = fn();
  if (view.name === "quiz") bindQuizKeys(); else document.onkeydown = null;
}

function inAppBrowserBanner(){
  return /Snapchat|Instagram|FBAN|FBAV|TikTok|musical_ly/i.test(navigator.userAgent)
    ? `<div class="banner">Tu es dans le navigateur intégré d'une appli : tes réponses risquent de ne pas être sauvegardées. Ouvre ce lien dans <strong>Safari ou Chrome</strong> (menu ⋯ → « Ouvrir dans le navigateur »). Dans tous les cas, ton code de résultat reste ta sauvegarde.</div>` : "";
}

function vHome(){
  const list = Object.values(evals).sort((a,b) => b.d - a.d);
  return `${inAppBrowserBanner()}
  <header class="hero"><h1>Profil relationnel</h1>
  <p class="mute">Questionnaire multi-grilles pour comprendre comment fonctionne une personne (ou soi-même) et comment s'y prendre : intention, tétrade noire, facteur D, HEXACO, Karpman, analyse transactionnelle, Freud, empathie, Palo Alto, cluster B, défenses, Bandura, DARVO, attachement, Young, Prochaska.</p></header>
  <div class="grid2">
    <button class="tile" data-act="new" data-m="o"><b>Évaluer quelqu'un</b><span>Tu réponds sur une personne de ton entourage</span></button>
    <button class="tile" data-act="new" data-m="s"><b>M'évaluer moi-même</b><span>Tu réponds sur toi</span></button>
    <button class="tile" data-act="go" data-v="import"><b>Reprendre avec un code</b><span>Retrouver ses réponses sur un autre appareil</span></button>
    <button class="tile" data-act="go" data-v="synth"><b>Synthèse de groupe</b><span>Moyenne de plusieurs évaluations + écarts</span></button>
  </div>
  ${list.length ? `<h2>Mes évaluations</h2><div class="list">${list.map(ev => {
    const n = answeredCount(ev.a), pct = Math.round(100*n/N);
    return `<div class="row"><div class="grow"><b>${ev.m === "s" ? "Moi-même" : esc(ev.t)}</b>
      <div class="mute small">${ev.m === "s" ? "Auto-évaluation" : "Évalué·e par " + esc(ev.r)} · ${pct}% · ${fmtDate(ev.d)}</div>
      <div class="pbar"><i style="width:${pct}%"></i></div></div>
      <div class="rowbtns"><button class="btn sm" data-act="open" data-id="${ev.id}">${n < N ? "Continuer" : "Modifier"}</button>
      <button class="btn sm pri" data-act="res" data-id="${ev.id}">Résultats</button>
      <button class="btn sm ghost" data-act="del" data-id="${ev.id}" title="Supprimer">✕</button></div></div>`;
  }).join("")}</div>` : ""}
  <p class="mute small foot">Tes réponses sont enregistrées uniquement sur cet appareil. Rien n'est envoyé nulle part : pour partager, tu copies ton code.</p>`;
}

function chips(name, opts, cur){
  return `<div class="chips">${Object.entries(opts).map(([k, l]) => `<label class="chip"><input type="radio" name="${name}" value="${k}" ${cur===k?"checked":""}><span>${l}</span></label>`).join("")}</div>`;
}
function vSetup(){
  const m = view.m, self = m === "s";
  return `<button class="back" data-act="go" data-v="home">← Accueil</button>
  <h1>${self ? "M'évaluer moi-même" : "Évaluer quelqu'un"}</h1>
  <form id="setup" class="card form">
    <label>${self ? "Ton prénom" : "Ton prénom (évaluateur)"}<input name="r" required maxlength="40" autocomplete="given-name"></label>
    ${self ? `<div class="fl">Tu es${chips("g", {m:"Un homme", f:"Une femme"}, "m")}</div>` :
    `<label>Prénom ou surnom de la personne évaluée<input name="t" required maxlength="40"></label>
     <div class="fl">On parle de cette personne au${chips("g", {m:"masculin (il)", f:"féminin (elle)"}, "m")}</div>
     ${Object.entries(CTX).map(([k, d]) => `<div class="fl">${d.q}${chips(k, d.o, null)}</div>`).join("")}`}
    <button class="btn pri big" type="submit">Commencer</button>
    <p class="mute small">${N} questions (20 à 30 min). Tu peux t'arrêter et reprendre quand tu veux : tout est sauvegardé.</p>
  </form>`;
}

function curEval(){ return evals[view.id]; }
function firstUnanswered(ev){ const i = ORDER.findIndex(ix => ev.a[ix] === "-"); return i < 0 ? 0 : i; }

function poles(it, ev){ const self = ev.m === "s"; return [tx(self && it.ls ? it.ls : it.l, ev), tx(self && it.rs ? it.rs : it.r, ev)]; }
// Libellé d'un cran : court (sous le rond) et complet (liste sur mobile)
function optLabel(it, x, ev){
  const w = SCALES[it.f][x + 3];
  if (it.f !== "B" || x === 0) return {short:w, long:w};
  const [lL, lR] = poles(it, ev);
  return {short:w, long:`${w} : ${x < 0 ? lL : lR}`};
}

function vQuiz(){
  const ev = curEval(); if (!ev) return vHome();
  const qi = Math.max(0, Math.min(N-1, view.qi ?? 0)); view.qi = qi;
  const ix = ORDER[qi], it = ITEMS[ix], v = valAt(ev.a, ix);
  const n = answeredCount(ev.a), self = ev.m === "s";
  const text = tx(self ? it.s : it.o, ev);
  const sizes = [44,36,30,24,30,36,44];
  const [lL, lR] = it.f === "B" ? poles(it, ev) : ["", ""];
  return `${inAppBrowserBanner()}
  <div class="qtop"><button class="back" data-act="go" data-v="home">← Accueil</button>
    <span class="mute small">${self ? "Auto-évaluation" : "Évaluation de " + esc(ev.t)}</span></div>
  <div class="pbar big"><i style="width:${100*n/N}%"></i></div>
  <div class="mute small center">Question ${qi+1} / ${N} · ${n} réponse${n>1?"s":""}</div>
  ${qi === 0 && n === 0 ? `<div class="hint">${self ? "Réponds le plus honnêtement possible : personne d'autre que toi ne voit tes réponses tant que tu ne partages pas ton code." : "Réponds selon ce que tu as <b>observé</b>, pas selon ce que tu supposes. Si tu n'as jamais pu en juger : « Je ne peux pas juger »."}</div>` : ""}
  <div class="card q">
    <p class="stmt">${text}</p>
    ${it.f === "B" ? `<div class="poles"><span>← ${lL}</span><span>${lR} →</span></div>` : ""}
    <div class="scale">
      ${[-3,-2,-1,0,1,2,3].map((x, i) => { const L = optLabel(it, x, ev);
        return `<button class="opt ${v===x?"on":""}" data-act="ans" data-v="${x}"><span class="dw"><i class="dot" style="--s:${sizes[i]}px"></i></span><span class="lab"><span class="ls">${esc(L.short)}</span><span class="ll">${L.long}</span></span></button>`; }).join("")}
    </div>
  </div>
  <div class="qnav">
    <button class="btn" data-act="prev" ${qi===0?"disabled":""}>← Préc.</button>
    <button class="btn ghost ${v==="x"?"on":""}" data-act="ans" data-v="x">${self ? "Passer" : "Je ne peux pas juger"}</button>
    <button class="btn" data-act="next" ${qi===N-1?"disabled":""}>Suiv. →</button>
  </div>
  <div class="qlinks"><button class="link" data-act="review" data-id="${ev.id}">Revoir toutes mes réponses</button>
  <button class="link" data-act="res" data-id="${ev.id}">Voir les résultats${n < N ? " (provisoires)" : ""}</button></div>`;
}
function bindQuizKeys(){
  document.onkeydown = e => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (e.key >= "1" && e.key <= "7") answer(String(+e.key - 4));
    else if (e.key === "0" || e.key === "x") answer("x");
    else if (e.key === "ArrowLeft") { view.qi--; render(); }
    else if (e.key === "ArrowRight") { view.qi++; render(); }
  };
}
let advTimer = null;
function answer(val){
  const ev = curEval(); const ix = ORDER[view.qi];
  const ch = val === "x" ? "x" : String(+val + 3);
  ev.a = ev.a.slice(0, ix) + ch + ev.a.slice(ix + 1); ev.d = Date.now(); persist(); render();
  clearTimeout(advTimer);
  advTimer = setTimeout(() => {
    if (view.name !== "quiz") return;
    const next = ORDER.findIndex((x, i) => i > view.qi && ev.a[x] === "-");
    if (next >= 0) { view.qi = next; render(); }
    else { const any = ORDER.findIndex(x => ev.a[x] === "-");
      if (any >= 0) { view.qi = any; render(); } else go({name:"results", id:ev.id}); }
  }, 260);
}

function answerWord(it, v, ev){
  if (v === "x") return ev.m === "s" ? "Passée" : "Je ne peux pas juger";
  if (typeof v !== "number") return "Pas encore répondu";
  return optLabel(it, v, ev).long;
}
function vReview(){
  const ev = curEval(); if (!ev) return vHome(); const self = ev.m === "s";
  return `<button class="back" data-act="res" data-id="${ev.id}">← Résultats</button>
  <h1>Mes réponses</h1><p class="mute small">Touche un rond pour modifier une réponse (de gauche à droite : du moins au plus). Les résultats se mettent à jour automatiquement. « ? » = ${self ? "passer" : "je ne peux pas juger"}.</p>
  <div class="rev">${ORDER.map((ix, qi) => { const it = ITEMS[ix], v = valAt(ev.a, ix);
    return `<div class="ritem" id="r${ix}"><div class="small"><span class="mute">${qi+1}.</span> ${tx(self ? it.s : it.o, ev)}</div>
    <div class="mini">${[-3,-2,-1,0,1,2,3].map(x => `<button class="md ${v===x?"on":""}" data-act="rev" data-ix="${ix}" data-v="${x}" title="${esc(optLabel(it,x,ev).long)}" aria-label="${esc(optLabel(it,x,ev).long)}"></button>`).join("")}
    <button class="md q ${v==="x"?"on":""}" data-act="rev" data-ix="${ix}" data-v="x">?</button></div>
    <div class="aw small">${answerWord(it, v, ev)}</div></div>`; }).join("")}</div>
  <button class="btn pri big" data-act="res" data-id="${ev.id}">Voir les résultats</button>`;
}

// ---------- Résultats : composants ----------
const LEGEND = `<div class="legend">
  <span><i class="sw ok"></i>Sain</span><span><i class="sw mid"></i>Dans la moyenne</span><span><i class="sw warn"></i>À surveiller</span><span><i class="sw bad"></i>Problématique</span><span><i class="sw desc"></i>Descriptif (ni bon ni mauvais)</span><span><i class="sw unsure"></i>Incertain</span></div>
  <p class="small mute">La couleur dépend de ce que le score <b>veut dire</b>, pas de sa hauteur. Sur les axes marqués <b class="up">↑</b>, plus c'est haut, mieux c'est (ex. : sincérité basse = problématique). Sur les autres, plus c'est haut, plus c'est préoccupant. « Incertain » = peu de réponses sur cet axe${""}, ou évaluateurs en désaccord.</p>`;

function badge(k, v){ const s = status(k, v); return `<span class="badge ${s.c}">${s.w}</span>`; }

function axisBody(k, V, opt){
  const a = AXES[k], E = EXPLAIN[k] || {}, v = V[k], who = opt.who, self = opt.mode === "self";
  const high = v >= 50, conc = isConcern(k, v);
  let h = `<div class="axd"><p><b>C'est quoi :</b> ${a.d}</p>`;
  if (E.ex) h += `<p><b>Exemple typique :</b> ${E.ex}</p>`;
  if (E.hi) h += `<p class="${high ? "cur" : ""}"><b>Score élevé :</b> ${E.hi}</p><p class="${!high ? "cur" : ""}"><b>Score bas :</b> ${E.lo}</p>`;
  if (E.why) h += `<p><b>${self ? "Pourquoi on fait ça" : "Pourquoi ça arrive"} :</b> ${E.why}</p>`;
  if (self && conc) {
    if (E.cost) h += `<p><b>Ce que ça coûte :</b> ${E.cost}</p>`;
    if (E.self) h += `<p><b>Pistes pour toi :</b></p><ul>${E.self.map(x => `<li>${x}</li>`).join("")}</ul>`;
  }
  if (!self && conc && E.face) h += `<p><b>Face à ça :</b> ${md(tx(E.face, who))}</p>`;
  const rg = opt.range && opt.range[k], sf = opt.self && opt.self[k];
  if (rg) h += `<p class="mute">Entre évaluateurs : de ${Math.round(rg[0])} à ${Math.round(rg[1])}.</p>`;
  if (sf != null) h += `<p class="mute">Auto-évaluation : ${Math.round(sf)} (écart ${Math.round(sf - v) > 0 ? "+" : ""}${Math.round(sf - v)} avec votre moyenne).</p>`;
  return h + `</div>`;
}
function axisRow(k, V, opt = {}){
  const v = V[k]; const a = AXES[k];
  if (v == null) return `<div class="ax na"><div class="axh"><span>${a.n}</span><span class="mute small">pas assez de réponses</span></div></div>`;
  const rg = opt.range && opt.range[k], sf = opt.self && opt.self[k];
  const unsure = (opt.conf && opt.conf[k] != null && opt.conf[k] < 1.5) || (rg && rg[1] - rg[0] >= 30);
  const s = status(k, v);
  return `<details class="ax"><summary><div class="axh"><span class="an">${a.n}${a.p > 0 ? ' <b class="up" title="Plus c\'est haut, mieux c\'est">↑</b>' : ""}</span>
    <span class="val">${Math.round(v)} ${badge(k, v)}${unsure ? ' <span class="badge unsure">Incertain</span>' : ""}</span></div>
    <div class="bar ${unsure ? "is-unsure" : ""}"><i class="f-${s.c}" style="width:${v}%"></i>
      ${rg ? `<em class="rg" style="left:${rg[0]}%;width:${Math.max(1, rg[1]-rg[0])}%"></em>` : ""}
      ${sf != null ? `<b class="sf" style="left:${sf}%" title="Auto-évaluation : ${Math.round(sf)}"></b>` : ""}</div></summary>
    ${axisBody(k, V, opt)}</details>`;
}
function gridCards(V, opt){
  const R = readings(V, opt.who);
  const verdict = {karp:R.karp && "Rôle dominant : " + R.karp, at:R.at && "État dominant : " + R.at, freud:R.freud, emp:R.emp,
    att:R.attach && "Style : " + R.attach, proch:R.stage && R.stage + " — " + R.stageTxt, intent:R.zoneTxt && md(R.zoneTxt)};
  return GRIDS.map(g => `<section class="card grid"><h3>${g.n}</h3><p class="small">${g.i}</p>
    <details class="more"><summary>Comprendre cette grille</summary><div class="small">${md(GRID_MORE[g.id] || "")}</div></details>
    ${verdict[g.id] ? `<div class="verdict">${verdict[g.id]}</div>` : ""}
    ${g.axes.map(k => axisRow(k, V, opt)).join("")}</section>`).join("");
}

// Curseur bonté ↔ malveillance + carte intention × maladresse
function intentCard(V, who, selfV){
  const R = readings(V, who); if (R.intent == null) return "";
  const x = R.intent, y = R.clumsy ?? 50;
  const sx = selfV && selfV.intent != null ? selfV.intent : null, sy = selfV ? (selfV.clumsy ?? 50) : null;
  return `<section class="card intent"><h2>Intention : bonté ↔ malveillance</h2>
    <div class="axh small"><span>Bonté<br><span class="mute">l'enfer est pavé de bonnes intentions</span></span><span style="text-align:right">Malveillance<br><span class="mute">intérêt, manipulation, plaisir à nuire</span></span></div>
    <div class="bip-bar"><b style="left:${x}%"></b>${sx != null ? `<s style="left:${sx}%" title="Auto-évaluation"></s>` : ""}</div>
    <p class="center small mute">${Math.round(x)} / 100${sx != null ? ` · auto-évaluation : ${Math.round(sx)}` : ""}</p>
    <div class="mapwrap"><svg viewBox="0 0 220 220" class="map" role="img" aria-label="Carte intention et maladresse">
      <rect x="10" y="10" width="100" height="100" class="q-yel"/><rect x="110" y="10" width="100" height="100" class="q-ora"/>
      <rect x="10" y="110" width="100" height="100" class="q-grn"/><rect x="110" y="110" width="100" height="100" class="q-red"/>
      <text x="60" y="56" class="ql">Bonnes intentions,</text><text x="60" y="68" class="ql">maladroit</text>
      <text x="160" y="56" class="ql">Malveillant</text><text x="160" y="68" class="ql">désordonné</text>
      <text x="60" y="156" class="ql">Bienveillant</text><text x="60" y="168" class="ql">et adroit</text>
      <text x="160" y="156" class="ql">Malveillant</text><text x="160" y="168" class="ql">maîtrisé</text>
      ${sx != null ? `<circle cx="${10 + sx*2}" cy="${210 - sy*2}" r="7" class="pt-self"/>` : ""}
      <circle cx="${10 + x*2}" cy="${210 - y*2}" r="7" class="pt"/>
    </svg>
    <div class="maplegend small"><p><b>Horizontal</b> : bonté → malveillance.<br><b>Vertical</b> : maladresse / manque de courage (en haut = beaucoup).</p>
    <p>● ${selfV ? "votre moyenne" : "position estimée"}${sx != null ? "<br>○ auto-évaluation" : ""}</p></div></div>
    <p>${md(R.zoneTxt)}</p>
    <details class="more"><summary>Comprendre cet axe</summary><div class="small">${md(GRID_MORE.intent)}</div></details>
  </section>`;
}
function summaryCard(V, who, title){
  const R = readings(V, who);
  const sig = concerns(V).slice(0, 6);
  return `<section class="card sum"><h2>${title}</h2>
    <div class="kv">
      ${V.D != null ? `<div><span>Facteur D (noyau sombre)</span><b>${Math.round(V.D)} ${badge("D", V.D)}</b></div>` : ""}
      ${V.H != null ? `<div><span>Honnêteté-Humilité ↑</span><b>${Math.round(V.H)} ${badge("H", V.H)}</b></div>` : ""}
      ${R.stage ? `<div><span>Stade de changement</span><b>${R.stage}</b></div>` : ""}
      ${R.karp ? `<div><span>Karpman</span><b>${R.karp}</b></div>` : ""}
      ${R.attach ? `<div><span>Attachement</span><b>${R.attach}</b></div>` : ""}
      ${R.emp ? `<div><span>Empathie</span><b>${R.emp}</b></div>` : ""}
    </div>
    ${sig.length ? `<h4>Signaux les plus marqués</h4><ul class="sig">${sig.map(k => `<li><b>${AXES[k].n}</b> ${Math.round(V[k])} ${badge(k, V[k])}</li>`).join("")}</ul>` : `<p class="mute small">Aucun signal préoccupant.</p>`}
  </section>`;
}
function recsCard(V, ctx, who){
  return `<section class="card recs"><h2>Pistes pour gérer la situation</h2>
    ${buildRecs(V, ctx || {}, who).map(s => `<h4>${s.h}</h4><ul>${s.items.map(x => `<li>${x}</li>`).join("")}</ul>`).join("")}</section>`;
}
// Cartes détaillées des axes préoccupants (vigilance pour soi, compréhension pour les autres)
function concernCards(V, mode, who, title, intro){
  const ks = concerns(V);
  if (!ks.length) return `<section class="card"><h2>${title}</h2><p class="mute small">Aucun axe préoccupant.</p></section>`;
  return `<section class="card"><h2>${title}</h2><p class="small mute">${intro}</p>
    ${ks.map((k, i) => `<details class="concern" ${i < 3 ? "open" : ""}><summary><span class="an">${AXES[k].n}</span><span class="val">${Math.round(V[k])} ${badge(k, V[k])}</span></summary>
      ${axisBody(k, V, {mode, who})}</details>`).join("")}</section>`;
}
function strengthsCard(V, self){
  const ks = strengths(V);
  if (!ks.length) return "";
  return `<section class="card"><h2>${self ? "Tes points forts" : "Ses points forts"}</h2>
    <p class="small mute">${self ? "Ce sur quoi tu peux t'appuyer." : "À reconnaître explicitement pendant l'échange : ça rend le reste plus audible."}</p>
    <ul class="sig">${ks.map(k => { const E = EXPLAIN[k] || {}; return `<li><b>${AXES[k].n}</b> ${Math.round(V[k])} ${badge(k, V[k])}<br><span class="small">${AXES[k].p > 0 ? E.hi || "" : E.lo || ""}</span></li>`; }).join("")}</ul></section>`;
}
function selfGuide(){
  return `<section class="card"><h2>Comment lire ton profil</h2><ul class="small">
    <li>Chaque axe va de 0 à 100. La <b>couleur</b> dit si c'est sain, dans la moyenne, à surveiller ou problématique.</li>
    <li>Une auto-évaluation a une limite connue : on se juge sur ses <b>intentions</b>, les autres nous jugent sur nos <b>actes</b>. C'est normal, et c'est pour ça que la comparaison avec le regard des autres est la partie la plus instructive.</li>
    <li>Les points de vigilance ne sont pas des défauts définitifs : ce sont des habitudes, et les habitudes se changent.</li>
    <li>Touche un axe dans le détail par grille pour voir ce qu'il veut dire, avec un exemple et des pistes.</li></ul></section>`;
}
function selfPlan(V){
  const R = readings(V, {}); const ks = concerns(V).slice(0, 2).map(k => AXES[k].n);
  const stage = {
    "Précontemplation": "Ton profil suggère que tu vois peu de problèmes chez toi. Si ton entourage te dit le contraire, c'est justement le signe d'un angle mort : la comparaison avec leur évaluation sera précieuse.",
    "Contemplation": "Tu vois qu'il y a des choses à changer mais tu hésites. Écris noir sur blanc ce que tes comportements te coûtent (amis, confiance, opportunités) et ce que tu gagnerais à changer.",
    "Préparation": "Tu veux changer : il manque un plan concret. Les étapes ci-dessous sont faites pour ça.",
    "Action": "Tu as déjà commencé à changer : continue, et demande des retours pour vérifier que ça se voit de l'extérieur.",
    "Maintien": "Tu tiens tes changements dans la durée : garde un œil sur les rechutes, qui sont normales.",
  }[R.stage];
  return `<section class="card recs"><h2>Plan d'action</h2>${stage ? `<p class="small">${stage}</p>` : ""}<ol class="small">
    <li>Choisis <b>un ou deux points</b> maximum${ks.length ? ` (ici, les plus marqués : <b>${ks.join("</b> et <b>")}</b>)` : ""}.</li>
    <li>Transforme-les en un <b>comportement observable</b> : pas « être plus fiable », mais « je ne dis oui que si je peux le faire, sinon je dis « je te redis » ».</li>
    <li>Parles-en à <b>une personne de confiance</b> et demande-lui de te signaler quand tu retombes dedans.</li>
    <li>Fais le point dans <b>deux semaines</b> : qu'est-ce qui a marché, qu'est-ce qui a coincé ?</li>
    <li>Refais ce test dans <b>un à deux mois</b> et compare.</li>
    <li>Le plus instructif : demande à <b>2 ou 3 proches</b> de t'évaluer avec « Évaluer quelqu'un », puis compare dans la Synthèse. L'écart entre ton image et la leur, ce sont tes angles morts.</li></ol></section>`;
}
const LIMIT_NOTE = `<p class="mute small foot">Ce profil reflète une perception, pas un diagnostic. Il prend toute sa valeur quand on croise plusieurs évaluations indépendantes et l'auto-évaluation (Synthèse de groupe), puis qu'on le confronte aux faits.</p>`;

function vResults(){
  const ev = curEval(); if (!ev) return vHome();
  const {V, C} = computeScores(ev.a); const n = answeredCount(ev.a); const self = ev.m === "s";
  const who = {t: ev.t, g: ev.g}; const code = encodeEval(ev);
  view.prompt = promptIA({kind: self ? "self" : "o", who, ctx: ev.c, V, rater: ev.r});
  const mode = self ? "self" : "other";
  return `<button class="back" data-act="go" data-v="home">← Accueil</button>
  <h1>${self ? "Mon profil" : "Profil de " + esc(ev.t)}</h1>
  <p class="mute small">${self ? "Auto-évaluation" : "Évalué·e par " + esc(ev.r)} · ${n}/${N} réponses${n < N ? " · <b>résultats provisoires</b>" : ""}</p>
  ${n < N*0.3 ? `<div class="banner">Moins de 30 % des questions sont répondues : les résultats ne sont pas encore fiables.</div>` : ""}
  <section class="card code"><h3>Ton code</h3>
    <p class="small mute">Il contient toutes tes réponses. Colle-le dans le groupe pour la synthèse. Il te sert aussi de sauvegarde : « Reprendre avec un code » te les rend. Si tu modifies tes réponses, recopie le nouveau code.</p>
    <textarea readonly rows="3" onclick="this.select()">${code}</textarea>
    <div class="btns"><button class="btn pri" data-act="copy" data-what="code">Copier mon code</button>
    <button class="btn" data-act="copy" data-what="prompt">Copier le prompt pour une IA</button></div></section>
  <div class="btns"><button class="btn" data-act="review" data-id="${ev.id}">Modifier mes réponses</button>
    ${n < N ? `<button class="btn" data-act="open" data-id="${ev.id}">Continuer le questionnaire</button>` : ""}</div>
  ${self ? selfGuide() : ""}
  ${intentCard(V, who)}
  ${summaryCard(V, who, "En bref")}
  ${self
    ? concernCards(V, mode, who, "Tes points de vigilance", "Du plus marqué au moins marqué. Pour chacun : ce que c'est, un exemple, pourquoi on fait ça, ce que ça coûte, et des pistes concrètes.") + strengthsCard(V, true) + selfPlan(V)
    : recsCard(V, ev.c, who) + concernCards(V, mode, who, "Comprendre ses comportements", "Les axes préoccupants, du plus au moins marqué : ce que c'est, un exemple typique, pourquoi ça arrive, et comment y faire face.") + strengthsCard(V, false)}
  <h2>Détail par grille</h2>${LEGEND}
  ${gridCards(V, {who, conf:C, mode})}
  ${LIMIT_NOTE}`;
}

function vImport(){
  return `<button class="back" data-act="go" data-v="home">← Accueil</button>
  <h1>Reprendre avec un code</h1>
  <div class="card form"><label>Colle ton code<textarea id="imp" rows="5" placeholder="PQ1-…"></textarea></label>
  <button class="btn pri big" data-act="doimport">Reprendre mes réponses</button><p id="impmsg" class="small"></p></div>`;
}

// ---------- Synthèse ----------
function vSynth(){
  const saved = LS.get(SYNTH_KEY, "");
  const codes = extractCodes(saved);
  const latest = {};
  codes.forEach(o => { const key = norm(o.t) + "|" + o.m + "|" + norm(o.r); if (!latest[key] || latest[key].d < o.d) latest[key] = o; });
  const all = Object.values(latest);
  const targets = [...new Set(all.map(o => norm(o.t)))];
  const sel = view.target && targets.includes(view.target) ? view.target : targets[0];
  let body = "";
  if (sel) {
    const group = all.filter(o => norm(o.t) === sel);
    const raters = group.filter(o => o.m === "o"), selfE = group.filter(o => o.m === "s").sort((a,b)=>b.d-a.d)[0];
    const who = {t: (raters[0] || selfE).t, g: (raters[0] || selfE).g};
    const Vs = raters.map(o => computeScores(o.a).V);
    const selfV = selfE ? computeScores(selfE.a).V : null;
    const lui = who.g === "f" ? "elle" : "lui";
    body += `<div class="card"><h3>Codes pris en compte pour ${esc(who.t)}</h3><ul class="small">${group.sort((a,b)=>a.m.localeCompare(b.m)).map(o => `<li>${o.m === "s" ? "<b>Auto-évaluation</b>" : esc(o.r)} · ${Math.round(100*answeredCount(o.a)/N)}% · ${fmtDate(o.d)}</li>`).join("")}</ul></div>`;
    if (!Vs.length) {
      body += selfV ? `<p class="mute">Seule l'auto-évaluation est présente. Ajoute les codes des évaluateurs pour comparer.</p>${intentCard(selfV, who)}${summaryCard(selfV, who, "Auto-évaluation")}<h2>Détail par grille</h2>${LEGEND}${gridCards(selfV, {who, mode:"other"})}` : "";
    } else {
      const M = {}, range = {};
      Object.keys(AXES).forEach(k => { const xs = Vs.map(V => V[k]).filter(x => x != null);
        M[k] = xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null; if (xs.length > 1) range[k] = [Math.min(...xs), Math.max(...xs)]; });
      const ctx = {}; Object.keys(CTX).forEach(k => { const cnt = {}; raters.forEach(o => { const x = o.c && o.c[k]; if (x) cnt[x] = (cnt[x]||0)+1; });
        const best = Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0]; if (best) ctx[k] = best[0]; });
      view.prompt = promptIA({kind:"synth", who, ctx, V:M, raters:raters.length, range, self:selfV});
      const spreads = visibleAxes().filter(k => range[k]).map(k => range[k][1]-range[k][0]); const ms = avg(spreads);
      const agree = ms == null ? "" : ms < 15 ? "fort" : ms < 25 ? "correct" : "faible";
      let gaps = "";
      if (selfV) {
        const gl = visibleAxes().filter(k => M[k] != null && selfV[k] != null).map(k => ({k, d: selfV[k] - M[k]}))
          .filter(x => Math.abs(x.d) >= 15).sort((a,b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 10);
        gaps = `<section class="card"><h2>Écarts : ce qu'${who.g === "f" ? "elle" : "il"} pense de ${lui} vs ce que vous observez</h2>
          <p class="small mute">Les plus grands écarts entre l'auto-évaluation et votre moyenne (fenêtre de Johari : ses « angles morts »). C'est souvent le support le plus parlant pour la discussion.</p>
          ${gl.length ? `<ul class="gaps">${gl.map(({k, d}) => `<li><b>${AXES[k].n}</b> : vous ${Math.round(M[k])} ${badge(k, M[k])} · ${lui} ${Math.round(selfV[k])} ${badge(k, selfV[k])} <span class="mute">(écart ${d > 0 ? "+" : ""}${Math.round(d)})</span></li>`).join("")}</ul>` : `<p class="small">Pas d'écart important : sa perception est proche de la vôtre.</p>`}</section>`;
      }
      body += `<div class="card"><p class="small">${raters.length} évaluateur${raters.length>1?"s":""}${agree ? ` · accord entre vous : <b>${agree}</b> (écart moyen ${Math.round(ms)} pts)` : ""}${selfV ? " · auto-évaluation incluse" : ""}</p>
        <p class="small mute">Sur chaque barre : remplissage = votre moyenne · zone encadrée = du plus bas au plus haut entre évaluateurs${selfV ? " · trait noir = son auto-évaluation" : ""}.</p>
        <div class="btns"><button class="btn" data-act="copy" data-what="prompt">Copier le prompt pour une IA</button></div></div>
        ${intentCard(M, who, selfV)}${gaps}${summaryCard(M, who, "En bref (moyenne du groupe)")}${recsCard(M, ctx, who)}
        ${concernCards(M, "other", who, "Comprendre ses comportements", "Les axes préoccupants selon votre moyenne : ce que c'est, un exemple typique, pourquoi ça arrive, et comment y faire face.")}${strengthsCard(M, false)}
        <h2>Détail par grille</h2>${LEGEND}${gridCards(M, {who, range, self:selfV, mode:"other"})}${LIMIT_NOTE}`;
    }
  }
  return `<button class="back" data-act="go" data-v="home">← Accueil</button>
  <h1>Synthèse de groupe</h1>
  <div class="card form"><label>Colle ici les codes de chacun (dans n'importe quel ordre, le texte autour est ignoré)
  <textarea id="syn" rows="6" placeholder="PQ1-…&#10;PQ1-…">${esc(saved)}</textarea></label>
  <div class="btns"><button class="btn pri" data-act="synth">Analyser</button>
  <button class="btn" data-act="addmine">Ajouter mes propres évaluations</button>
  <button class="btn ghost" data-act="synclear">Vider</button></div>
  <p class="small mute">${codes.length} code${codes.length>1?"s":""} détecté${codes.length>1?"s":""}. Si quelqu'un a envoyé plusieurs codes, seul le plus récent compte.</p></div>
  ${targets.length > 1 ? `<div class="chips">${targets.map(t => `<button class="chip-b ${t===sel?"on":""}" data-act="target" data-t="${esc(t)}">${esc(all.find(o=>norm(o.t)===t).t)}</button>`).join("")}</div>` : ""}
  ${body}`;
}

// ---------- Événements ----------
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act;
  if (act === "go") go({name:b.dataset.v});
  else if (act === "new") go({name:"setup", m:b.dataset.m});
  else if (act === "open") { const ev = evals[b.dataset.id]; go({name:"quiz", id:ev.id, qi:firstUnanswered(ev)}); }
  else if (act === "res") go({name:"results", id:b.dataset.id});
  else if (act === "review") go({name:"review", id:b.dataset.id});
  else if (act === "del") { const ev = evals[b.dataset.id];
    if (confirm(`Supprimer l'évaluation « ${ev.m === "s" ? "Moi-même" : ev.t} » de cet appareil ? Pense à copier ton code avant si tu veux la garder.`)) { delete evals[ev.id]; persist(); render(); } }
  else if (act === "ans") answer(b.dataset.v);
  else if (act === "prev") { view.qi--; render(); }
  else if (act === "next") { view.qi++; render(); }
  else if (act === "rev") {
    const ev = curEval(), ix = +b.dataset.ix, val = b.dataset.v;
    const ch = val === "x" ? "x" : String(+val + 3);
    ev.a = ev.a.slice(0, ix) + (ev.a[ix] === ch ? "-" : ch) + ev.a.slice(ix + 1); ev.d = Date.now(); persist();
    const nv = valAt(ev.a, ix);
    document.querySelectorAll(`#r${ix} .md`).forEach(d => d.classList.toggle("on", d.dataset.v === "x" ? nv === "x" : nv === +d.dataset.v));
    const aw = document.querySelector(`#r${ix} .aw`); if (aw) aw.textContent = answerWord(ITEMS[ix], nv, ev);
  }
  else if (act === "copy") { const ev = curEval();
    copyText(b.dataset.what === "code" ? encodeEval(ev) : view.prompt, b); }
  else if (act === "doimport") {
    const o = extractCodes($("#imp").value)[0];
    if (!o) { $("#impmsg").textContent = "Code invalide. Vérifie que tu as copié le code en entier."; return; }
    const ex = Object.values(evals).find(x => x.m === o.m && norm(x.r) === norm(o.r) && norm(x.t) === norm(o.t));
    const id = ex ? ex.id : uid();
    evals[id] = {id, m:o.m, r:o.r, t:o.t, g:o.g, c:o.c||{}, a:o.a, d:o.d || Date.now()}; persist();
    go({name:"results", id});
  }
  else if (act === "synth") { LS.set(SYNTH_KEY, $("#syn").value); render(); }
  else if (act === "addmine") { const cur = $("#syn").value; const mine = Object.values(evals).map(encodeEval).join("\n");
    LS.set(SYNTH_KEY, (cur ? cur + "\n" : "") + mine); render(); }
  else if (act === "synclear") { LS.set(SYNTH_KEY, ""); render(); }
  else if (act === "target") { view.target = b.dataset.t; render(); }
});

document.addEventListener("submit", e => {
  if (e.target.id !== "setup") return; e.preventDefault();
  const fd = new FormData(e.target); const m = view.m;
  const r = (fd.get("r") || "").trim();
  const ev = {id:uid(), m, r, t: m === "s" ? r : (fd.get("t") || "").trim(), g: fd.get("g") || "m", c:{}, a:"-".repeat(N), d:Date.now()};
  if (m === "o") Object.keys(CTX).forEach(k => { const x = fd.get(k); if (x) ev.c[k] = x; });
  evals[ev.id] = ev; persist(); go({name:"quiz", id:ev.id, qi:0});
});

// Migration : compléter les anciennes évaluations si des questions ont été ajoutées
Object.values(evals).forEach(ev => ev.a = padAnswers(ev.a));
render();
