import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Pause, Play, ArrowLeft } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type VerbType = "ar" | "er" | "ir";
type VerbCategory = "regular" | "cambios" | "acentos" | "raros";
type FeedbackState = "correct" | "incorrect" | null;
type EndScreen = "blue" | "green" | "yellow" | "black";
type Tense = "present" | "past";
type TenseSetting = "presente" | "ambos" | "preterito";
// How a past verb's reference endings are displayed
type PastRef = "strong" | "strongJ" | "opaque";

interface Verb {
  infinitive: string;
  type: VerbType;
  category: VerbCategory;             // present-tense classification
  conjugations?: Record<string, string>;  // present irregular forms
  pastCategory: VerbCategory;        // preterite classification (never "acentos")
  past?: Record<string, string>;     // preterite forms (else computed from endings)
  pastRef?: PastRef;                  // reference-box override for preterite
}

interface SubjectGroup {
  pronoun: string;
  variants: string[];
  referenceLabel: string;
}

interface RetryItem {
  verb: Verb;
  pronoun: string;
  displayLabel: string;
  tense: Tense;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function c(yo: string, tu: string, el: string, nos: string, ell: string): Record<string, string> {
  return { yo, "tú": tu, "él/ella": el, nosotros: nos, ellos: ell };
}

function conjugate(verb: Verb, pronoun: string): string {
  if (verb.conjugations) return verb.conjugations[pronoun] ?? "";
  const stem = verb.infinitive.slice(0, -2);
  return stem + ENDINGS[verb.type][pronoun];
}

function conjugatePast(verb: Verb, pronoun: string): string {
  if (verb.past) return verb.past[pronoun] ?? "";
  const stem = verb.infinitive.slice(0, -2);
  const endings = verb.type === "ar" ? PAST_ENDINGS.ar : PAST_ENDINGS.erir;
  return stem + endings[pronoun];
}

function conjForm(verb: Verb, pronoun: string, tense: Tense): string {
  return tense === "present" ? conjugate(verb, pronoun) : conjugatePast(verb, pronoun);
}

// Returns the per-pronoun ending map to show in the reference card,
// or null when the verb is fully opaque (show "¿?").
function getRefEndings(verb: Verb, tense: Tense): Record<string, string> | null {
  if (tense === "present") {
    if (verb.category === "raros") return null;
    return ENDINGS[verb.type];
  }
  if (verb.pastRef === "opaque") return null;
  if (verb.pastRef === "strong") return PAST_ENDINGS.strong;
  if (verb.pastRef === "strongJ") return PAST_ENDINGS.strongJ;
  return verb.type === "ar" ? PAST_ENDINGS.ar : PAST_ENDINGS.erir;
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function getEndScreen(score: number, total: number): EndScreen {
  if (total === 0) return "black";
  const pct = score / total;
  if (pct === 1 && total >= 30) return "blue";
  if (pct >= 0.9 && score >= 20) return "green";
  if (pct >= 0.5) return "yellow";
  return "black";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_SECONDS = 5 * 60;
const LOCK_AT = 270;
const CORRECT_DELAY = 500;
const INCORRECT_DELAY = 2500;
const SUPER_THRESHOLD = 100;
const RECENT_CORRECT_MAX = 8;

const CORRECT_EMOJIS = ["👍","🥰","😊","🎉","😁","🚀","💪","🤸","👑","😃","😀","😄","🙂","😇","💯","🔥"];

const ENDINGS: Record<VerbType, Record<string, string>> = {
  ar: { yo: "o", tú: "as", "él/ella": "a", nosotros: "amos", ellos: "an" },
  er: { yo: "o", tú: "es", "él/ella": "e", nosotros: "emos", ellos: "en" },
  ir: { yo: "o", tú: "es", "él/ella": "e", nosotros: "imos", ellos: "en" },
};

// Preterite (simple past) ending sets
const PAST_ENDINGS: Record<"ar" | "erir" | "strong" | "strongJ", Record<string, string>> = {
  ar:      { yo: "é",  tú: "aste",  "él/ella": "ó",  nosotros: "amos",  ellos: "aron" },
  erir:    { yo: "í",  tú: "iste",  "él/ella": "ió", nosotros: "imos",  ellos: "ieron" },
  strong:  { yo: "e",  tú: "iste",  "él/ella": "o",  nosotros: "imos",  ellos: "ieron" },
  strongJ: { yo: "e",  tú: "iste",  "él/ella": "o",  nosotros: "imos",  ellos: "eron" },
};

const SUBJECT_GROUPS: SubjectGroup[] = [
  { pronoun: "yo",       variants: ["yo"],                                       referenceLabel: "yo" },
  { pronoun: "tú",       variants: ["tú"],                                       referenceLabel: "tú" },
  { pronoun: "él/ella",  variants: ["él", "ella", "usted", "mi amigo"],          referenceLabel: "él / ella" },
  { pronoun: "nosotros", variants: ["nosotros", "nosotras", "tú y yo"],          referenceLabel: "nosotros" },
  { pronoun: "ellos",    variants: ["ellos", "ellas", "ustedes", "Bob y Pedro"], referenceLabel: "ellos / ellas" },
];

// Cycling labels for reverse-mode buttons — cycles between questions
const REV_LABELS: Record<string, string[]> = {
  "yo":       ["yo"],
  "tú":       ["tú"],
  "él/ella":  ["ella", "él", "usted"],
  "nosotros": ["nosotros", "nosotras", "tú y yo"],
  "ellos":    ["ellos", "ellas", "ustedes"],
};

function getRevLabel(pronoun: string, cycles: Record<string, number>): string {
  const labels = REV_LABELS[pronoun];
  if (!labels || labels.length <= 1) return labels?.[0] ?? pronoun;
  return labels[(cycles[pronoun] ?? 0) % labels.length];
}

// Per-subject color palette for reverse-mode buttons (idle state)
const REV_BTN_COLORS: Record<string, { idle: string; dimmed: string }> = {
  "yo":       { idle: "bg-rose-100   border-rose-300   text-rose-700   hover:bg-rose-200   hover:border-rose-400",   dimmed: "bg-rose-50   border-rose-200   text-rose-300" },
  "tú":       { idle: "bg-amber-100  border-amber-300  text-amber-700  hover:bg-amber-200  hover:border-amber-400",  dimmed: "bg-amber-50  border-amber-200  text-amber-300" },
  "él/ella":  { idle: "bg-violet-100 border-violet-300 text-violet-700 hover:bg-violet-200 hover:border-violet-400", dimmed: "bg-violet-50 border-violet-200 text-violet-300" },
  "nosotros": { idle: "bg-emerald-100 border-emerald-300 text-emerald-700 hover:bg-emerald-200 hover:border-emerald-400", dimmed: "bg-emerald-50 border-emerald-200 text-emerald-300" },
  "ellos":    { idle: "bg-sky-100    border-sky-300    text-sky-700    hover:bg-sky-200    hover:border-sky-400",    dimmed: "bg-sky-50    border-sky-200    text-sky-300" },
};

// ─── Verb list ────────────────────────────────────────────────────────────────

const VERBS: Verb[] = [
  // ── REGULAR -AR ──────────────────────────────────────────────────────────
  { infinitive: "hablar",    type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "estudiar",  type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "trabajar",  type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "caminar",   type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "bailar",    type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "cantar",    type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "escuchar",  type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "mirar",     type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "tomar",     type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "llegar",    type: "ar", category: "regular", pastCategory: "cambios", past: c("llegué","llegaste","llegó","llegamos","llegaron") },
  { infinitive: "usar",      type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "ayudar",    type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "comprar",   type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "preparar",  type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "necesitar", type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "agarrar",   type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "pasar",     type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "practicar", type: "ar", category: "regular", pastCategory: "cambios", past: c("practiqué","practicaste","practicó","practicamos","practicaron") },
  { infinitive: "terminar",  type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "ganar",     type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "empujar",   type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "acabar",    type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "esperar",   type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "ocupar",    type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "sumar",     type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "sacar",     type: "ar", category: "regular", pastCategory: "cambios", past: c("saqué","sacaste","sacó","sacamos","sacaron") },
  { infinitive: "buscar",    type: "ar", category: "regular", pastCategory: "cambios", past: c("busqué","buscaste","buscó","buscamos","buscaron") },
  { infinitive: "restar",    type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "regresar",  type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "echar",     type: "ar", category: "regular", pastCategory: "regular" },
  { infinitive: "intentar",  type: "ar", category: "regular", pastCategory: "regular" },
  // ── REGULAR -ER ──────────────────────────────────────────────────────────
  { infinitive: "comer",      type: "er", category: "regular", pastCategory: "regular" },
  { infinitive: "beber",      type: "er", category: "regular", pastCategory: "regular" },
  { infinitive: "correr",     type: "er", category: "regular", pastCategory: "regular" },
  { infinitive: "leer",       type: "er", category: "regular", pastCategory: "cambios", past: c("leí","leíste","leyó","leímos","leyeron"), pastRef: "opaque" },
  { infinitive: "vender",     type: "er", category: "regular", pastCategory: "regular" },
  { infinitive: "aprender",   type: "er", category: "regular", pastCategory: "regular" },
  { infinitive: "comprender", type: "er", category: "regular", pastCategory: "regular" },
  { infinitive: "responder",  type: "er", category: "regular", pastCategory: "regular" },
  { infinitive: "meter",      type: "er", category: "regular", pastCategory: "regular" },
  { infinitive: "prometer",   type: "er", category: "regular", pastCategory: "regular" },
  { infinitive: "repeler",    type: "er", category: "regular", pastCategory: "regular" },
  { infinitive: "esconder",   type: "er", category: "regular", pastCategory: "regular" },
  // ── REGULAR -IR ──────────────────────────────────────────────────────────
  { infinitive: "vivir",      type: "ir", category: "regular", pastCategory: "regular" },
  { infinitive: "escribir",   type: "ir", category: "regular", pastCategory: "regular" },
  { infinitive: "abrir",      type: "ir", category: "regular", pastCategory: "regular" },
  { infinitive: "subir",      type: "ir", category: "regular", pastCategory: "regular" },
  { infinitive: "recibir",    type: "ir", category: "regular", pastCategory: "regular" },
  { infinitive: "decidir",    type: "ir", category: "regular", pastCategory: "regular" },
  { infinitive: "dividir",    type: "ir", category: "regular", pastCategory: "regular" },
  { infinitive: "partir",     type: "ir", category: "regular", pastCategory: "regular" },
  { infinitive: "existir",    type: "ir", category: "regular", pastCategory: "regular" },
  { infinitive: "discutir",   type: "ir", category: "regular", pastCategory: "regular" },
  { infinitive: "sobrevivir", type: "ir", category: "regular", pastCategory: "regular" },
  { infinitive: "presumir",   type: "ir", category: "regular", pastCategory: "regular" },
  { infinitive: "repartir",   type: "ir", category: "regular", pastCategory: "regular" },
  { infinitive: "compartir",  type: "ir", category: "regular", pastCategory: "regular" },
  // ── CAMBIOS (present) ──────────────────────────────────────────────────────
  { infinitive: "dormir",    type: "ir", category: "cambios", conjugations: c("duermo","duermes","duerme","dormimos","duermen"), pastCategory: "cambios", past: c("dormí","dormiste","durmió","dormimos","durmieron") },
  { infinitive: "pedir",     type: "ir", category: "cambios", conjugations: c("pido","pides","pide","pedimos","piden"), pastCategory: "cambios", past: c("pedí","pediste","pidió","pedimos","pidieron") },
  { infinitive: "rendir",    type: "ir", category: "cambios", conjugations: c("rindo","rindes","rinde","rendimos","rinden"), pastCategory: "cambios", past: c("rendí","rendiste","rindió","rendimos","rindieron") },
  { infinitive: "convertir", type: "ir", category: "cambios", conjugations: c("convierto","conviertes","convierte","convertimos","convierten"), pastCategory: "cambios", past: c("convertí","convertiste","convirtió","convertimos","convirtieron") },
  { infinitive: "preferir",  type: "ir", category: "cambios", conjugations: c("prefiero","prefieres","prefiere","preferimos","prefieren"), pastCategory: "cambios", past: c("preferí","preferiste","prefirió","preferimos","prefirieron") },
  { infinitive: "repetir",   type: "ir", category: "cambios", conjugations: c("repito","repites","repite","repetimos","repiten"), pastCategory: "cambios", past: c("repetí","repetiste","repitió","repetimos","repitieron") },
  { infinitive: "sentir",    type: "ir", category: "cambios", conjugations: c("siento","sientes","siente","sentimos","sienten"), pastCategory: "cambios", past: c("sentí","sentiste","sintió","sentimos","sintieron") },
  { infinitive: "pensar",    type: "ar", category: "cambios", conjugations: c("pienso","piensas","piensa","pensamos","piensan"), pastCategory: "regular" },
  { infinitive: "cerrar",    type: "ar", category: "cambios", conjugations: c("cierro","cierras","cierra","cerramos","cierran"), pastCategory: "regular" },
  { infinitive: "empezar",   type: "ar", category: "cambios", conjugations: c("empiezo","empiezas","empieza","empezamos","empiezan"), pastCategory: "cambios", past: c("empecé","empezaste","empezó","empezamos","empezaron") },
  { infinitive: "mostrar",   type: "ar", category: "cambios", conjugations: c("muestro","muestras","muestra","mostramos","muestran"), pastCategory: "regular" },
  { infinitive: "recordar",  type: "ar", category: "cambios", conjugations: c("recuerdo","recuerdas","recuerda","recordamos","recuerdan"), pastCategory: "regular" },
  { infinitive: "encontrar", type: "ar", category: "cambios", conjugations: c("encuentro","encuentras","encuentra","encontramos","encuentran"), pastCategory: "regular" },
  { infinitive: "contar",    type: "ar", category: "cambios", conjugations: c("cuento","cuentas","cuenta","contamos","cuentan"), pastCategory: "regular" },
  { infinitive: "sentar",    type: "ar", category: "cambios", conjugations: c("siento","sientas","sienta","sentamos","sientan"), pastCategory: "regular" },
  { infinitive: "querer",    type: "er", category: "cambios", conjugations: c("quiero","quieres","quiere","queremos","quieren"), pastCategory: "raros", past: c("quise","quisiste","quiso","quisimos","quisieron"), pastRef: "strong" },
  { infinitive: "poder",     type: "er", category: "cambios", conjugations: c("puedo","puedes","puede","podemos","pueden"), pastCategory: "raros", past: c("pude","pudiste","pudo","pudimos","pudieron"), pastRef: "strong" },
  { infinitive: "morder",    type: "er", category: "cambios", conjugations: c("muerdo","muerdes","muerde","mordemos","muerden"), pastCategory: "regular" },
  { infinitive: "mover",     type: "er", category: "cambios", conjugations: c("muevo","mueves","mueve","movemos","mueven"), pastCategory: "regular" },
  { infinitive: "soler",     type: "er", category: "cambios", conjugations: c("suelo","sueles","suele","solemos","suelen"), pastCategory: "regular" },
  { infinitive: "entender",  type: "er", category: "cambios", conjugations: c("entiendo","entiendes","entiende","entendemos","entienden"), pastCategory: "regular" },
  { infinitive: "perder",    type: "er", category: "cambios", conjugations: c("pierdo","pierdes","pierde","perdemos","pierden"), pastCategory: "regular" },
  { infinitive: "volver",    type: "er", category: "cambios", conjugations: c("vuelvo","vuelves","vuelve","volvemos","vuelven"), pastCategory: "regular" },
  { infinitive: "encender",  type: "er", category: "cambios", conjugations: c("enciendo","enciendes","enciende","encendemos","encienden"), pastCategory: "regular" },
  { infinitive: "inferir",   type: "ir", category: "cambios", conjugations: c("infiero","infieres","infiere","inferimos","infieren"), pastCategory: "cambios", past: c("inferí","inferiste","infirió","inferimos","infirieron") },
  // ── ACENTOS Y MÁS (present only — redistributed in preterite) ──────────────
  { infinitive: "continuar", type: "ar", category: "acentos", conjugations: c("continúo","continúas","continúa","continuamos","continúan"), pastCategory: "regular" },
  { infinitive: "reír",      type: "ir", category: "acentos", conjugations: c("río","ríes","ríe","reímos","ríen"), pastCategory: "cambios", past: c("reí","reíste","rió","reímos","rieron"), pastRef: "opaque" },
  { infinitive: "sonreír",   type: "ir", category: "acentos", conjugations: c("sonrío","sonríes","sonríe","sonreímos","sonríen"), pastCategory: "cambios", past: c("sonreí","sonreíste","sonrió","sonreímos","sonrieron"), pastRef: "opaque" },
  { infinitive: "escoger",   type: "er", category: "acentos", conjugations: c("escojo","escoges","escoge","escogemos","escogen"), pastCategory: "regular" },
  { infinitive: "seguir",    type: "ir", category: "acentos", conjugations: c("sigo","sigues","sigue","seguimos","siguen"), pastCategory: "cambios", past: c("seguí","seguiste","siguió","seguimos","siguieron") },
  { infinitive: "recoger",   type: "er", category: "acentos", conjugations: c("recojo","recoges","recoge","recogemos","recogen"), pastCategory: "regular" },
  { infinitive: "guiar",     type: "ar", category: "acentos", conjugations: c("guío","guías","guía","guiamos","guían"), pastCategory: "regular" },
  { infinitive: "variar",    type: "ar", category: "acentos", conjugations: c("varío","varías","varía","variamos","varían"), pastCategory: "regular" },
  { infinitive: "conseguir", type: "ir", category: "acentos", conjugations: c("consigo","consigues","consigue","conseguimos","consiguen"), pastCategory: "cambios", past: c("conseguí","conseguiste","consiguió","conseguimos","consiguieron") },
  { infinitive: "traer",     type: "er", category: "acentos", conjugations: c("traigo","traes","trae","traemos","traen"), pastCategory: "raros", past: c("traje","trajiste","trajo","trajimos","trajeron"), pastRef: "strongJ" },
  { infinitive: "atraer",    type: "er", category: "acentos", conjugations: c("atraigo","atraes","atrae","atraemos","atraen"), pastCategory: "raros", past: c("atraje","atrajiste","atrajo","atrajimos","atrajeron"), pastRef: "strongJ" },
  { infinitive: "conocer",   type: "er", category: "acentos", conjugations: c("conozco","conoces","conoce","conocemos","conocen"), pastCategory: "regular" },
  { infinitive: "traducir",  type: "ir", category: "acentos", conjugations: c("traduzco","traduces","traduce","traducimos","traducen"), pastCategory: "raros", past: c("traduje","tradujiste","tradujo","tradujimos","tradujeron"), pastRef: "strongJ" },
  { infinitive: "incluir",   type: "ir", category: "acentos", conjugations: c("incluyo","incluyes","incluye","incluimos","incluyen"), pastCategory: "cambios", past: c("incluí","incluiste","incluyó","incluimos","incluyeron"), pastRef: "opaque" },
  { infinitive: "destruir",  type: "ir", category: "acentos", conjugations: c("destruyo","destruyes","destruye","destruimos","destruyen"), pastCategory: "cambios", past: c("destruí","destruiste","destruyó","destruimos","destruyeron"), pastRef: "opaque" },
  { infinitive: "soñar",     type: "ar", category: "acentos", conjugations: c("sueño","sueñas","sueña","soñamos","sueñan"), pastCategory: "regular" },
  { infinitive: "corregir",  type: "ir", category: "acentos", conjugations: c("corrijo","corriges","corrige","corregimos","corrigen"), pastCategory: "cambios", past: c("corregí","corregiste","corrigió","corregimos","corrigieron") },
  // ── RAROS (present) ────────────────────────────────────────────────────────
  { infinitive: "poner",    type: "er", category: "raros", conjugations: c("pongo","pones","pone","ponemos","ponen"), pastCategory: "raros", past: c("puse","pusiste","puso","pusimos","pusieron"), pastRef: "strong" },
  { infinitive: "salir",    type: "ir", category: "raros", conjugations: c("salgo","sales","sale","salimos","salen"), pastCategory: "regular" },
  { infinitive: "decir",    type: "ir", category: "raros", conjugations: c("digo","dices","dice","decimos","dicen"), pastCategory: "raros", past: c("dije","dijiste","dijo","dijimos","dijeron"), pastRef: "strongJ" },
  { infinitive: "tener",    type: "er", category: "raros", conjugations: c("tengo","tienes","tiene","tenemos","tienen"), pastCategory: "raros", past: c("tuve","tuviste","tuvo","tuvimos","tuvieron"), pastRef: "strong" },
  { infinitive: "hacer",    type: "er", category: "raros", conjugations: c("hago","haces","hace","hacemos","hacen"), pastCategory: "raros", past: c("hice","hiciste","hizo","hicimos","hicieron"), pastRef: "strong" },
  { infinitive: "venir",    type: "ir", category: "raros", conjugations: c("vengo","vienes","viene","venimos","vienen"), pastCategory: "raros", past: c("vine","viniste","vino","vinimos","vinieron"), pastRef: "strong" },
  { infinitive: "ir",       type: "ir", category: "raros", conjugations: c("voy","vas","va","vamos","van"), pastCategory: "raros", past: c("fui","fuiste","fue","fuimos","fueron"), pastRef: "opaque" },
  { infinitive: "estar",    type: "ar", category: "raros", conjugations: c("estoy","estás","está","estamos","están"), pastCategory: "raros", past: c("estuve","estuviste","estuvo","estuvimos","estuvieron"), pastRef: "strong" },
  { infinitive: "ser",      type: "er", category: "raros", conjugations: c("soy","eres","es","somos","son"), pastCategory: "raros", past: c("fui","fuiste","fue","fuimos","fueron"), pastRef: "opaque" },
  { infinitive: "dar",      type: "ar", category: "raros", conjugations: c("doy","das","da","damos","dan"), pastCategory: "raros", past: c("di","diste","dio","dimos","dieron"), pastRef: "opaque" },
  { infinitive: "saber",    type: "er", category: "raros", conjugations: c("sé","sabes","sabe","sabemos","saben"), pastCategory: "raros", past: c("supe","supiste","supo","supimos","supieron"), pastRef: "strong" },
  { infinitive: "ver",      type: "er", category: "raros", conjugations: c("veo","ves","ve","vemos","ven"), pastCategory: "raros", past: c("vi","viste","vio","vimos","vieron"), pastRef: "opaque" },
  { infinitive: "mantener", type: "er", category: "raros", conjugations: c("mantengo","mantienes","mantiene","mantenemos","mantienen"), pastCategory: "raros", past: c("mantuve","mantuviste","mantuvo","mantuvimos","mantuvieron"), pastRef: "strong" },
  { infinitive: "detener",  type: "er", category: "raros", conjugations: c("detengo","detienes","detiene","detenemos","detienen"), pastCategory: "raros", past: c("detuve","detuviste","detuvo","detuvimos","detuvieron"), pastRef: "strong" },
  { infinitive: "predecir", type: "ir", category: "raros", conjugations: c("predigo","predices","predice","predecimos","predicen"), pastCategory: "raros", past: c("predije","predijiste","predijo","predijimos","predijeron"), pastRef: "strongJ" },
  { infinitive: "oler",     type: "er", category: "raros", conjugations: c("huelo","hueles","huele","olemos","huelen"), pastCategory: "regular" },
];

// ─── Category metadata ────────────────────────────────────────────────────────

const CATEGORY_INFO: Array<{
  id: VerbCategory; label: string; switchOnBg: string;
  dot: string; textColor: string; pillBg: string;
}> = [
  { id: "regular", label: "Regular",       switchOnBg: "bg-pink-500",   dot: "bg-pink-500",   textColor: "text-pink-600",   pillBg: "bg-pink-100 text-pink-700" },
  { id: "cambios", label: "Cambios",       switchOnBg: "bg-amber-700",  dot: "bg-amber-700",  textColor: "text-amber-700",  pillBg: "bg-amber-100 text-amber-800" },
  { id: "acentos", label: "Acentos y más", switchOnBg: "bg-violet-600", dot: "bg-violet-600", textColor: "text-violet-600", pillBg: "bg-violet-100 text-violet-700" },
  { id: "raros",   label: "Raros",         switchOnBg: "bg-red-600",    dot: "bg-red-600",    textColor: "text-red-600",    pillBg: "bg-red-100 text-red-700" },
];

const TENSE_OPTIONS: Array<{ id: TenseSetting; label: string }> = [
  { id: "presente",  label: "Presente" },
  { id: "ambos",     label: "Ambos" },
  { id: "preterito", label: "Pretérito" },
];

// ─── Theme system ─────────────────────────────────────────────────────────────

interface Theme {
  headerBg: string;
  headerHex: string;
  buttonBg: string;
  inputFocus: string;
  refHighlightBg: string;
  refHighlightBorder: string;
  refText: string;
  statBorder: string;
  streakText: string;
  bgStyle: string;
}

const THEMES: Record<VerbCategory, Theme> = {
  regular: {
    headerBg:           "bg-pink-500",
    headerHex:          "#ec4899",
    buttonBg:           "bg-pink-500 hover:bg-pink-600 active:bg-pink-700",
    inputFocus:         "focus:border-pink-500",
    refHighlightBg:     "bg-pink-100 dark:bg-pink-900/40",
    refHighlightBorder: "border-pink-300 dark:border-pink-700",
    refText:            "text-pink-600 dark:text-pink-400",
    statBorder:         "border-pink-300 dark:border-pink-700",
    streakText:         "text-pink-600 dark:text-pink-400",
    bgStyle:            "linear-gradient(135deg,#fdf2f8 0%,#ffffff 50%,#fff1f2 100%)",
  },
  cambios: {
    headerBg:           "bg-amber-700",
    headerHex:          "#b45309",
    buttonBg:           "bg-amber-700 hover:bg-amber-800 active:bg-amber-900",
    inputFocus:         "focus:border-amber-600",
    refHighlightBg:     "bg-amber-100 dark:bg-amber-900/40",
    refHighlightBorder: "border-amber-500 dark:border-amber-700",
    refText:            "text-amber-700 dark:text-amber-400",
    statBorder:         "border-amber-500 dark:border-amber-700",
    streakText:         "text-amber-700 dark:text-amber-400",
    bgStyle:            "linear-gradient(135deg,#fffbeb 0%,#ffffff 50%,#fef3c7 100%)",
  },
  acentos: {
    headerBg:           "bg-violet-600",
    headerHex:          "#7c3aed",
    buttonBg:           "bg-violet-600 hover:bg-violet-700 active:bg-violet-800",
    inputFocus:         "focus:border-violet-500",
    refHighlightBg:     "bg-violet-100 dark:bg-violet-900/40",
    refHighlightBorder: "border-violet-300 dark:border-violet-700",
    refText:            "text-violet-600 dark:text-violet-400",
    statBorder:         "border-violet-300 dark:border-violet-700",
    streakText:         "text-violet-600 dark:text-violet-400",
    bgStyle:            "linear-gradient(135deg,#f5f3ff 0%,#ffffff 50%,#eef2ff 100%)",
  },
  raros: {
    headerBg:           "bg-red-600",
    headerHex:          "#dc2626",
    buttonBg:           "bg-red-600 hover:bg-red-700 active:bg-red-800",
    inputFocus:         "focus:border-red-500",
    refHighlightBg:     "bg-red-100 dark:bg-red-900/40",
    refHighlightBorder: "border-red-300 dark:border-red-700",
    refText:            "text-red-600 dark:text-red-400",
    statBorder:         "border-red-300 dark:border-red-700",
    streakText:         "text-red-600 dark:text-red-400",
    bgStyle:            "linear-gradient(135deg,#fef2f2 0%,#ffffff 50%,#fff7ed 100%)",
  },
};

// ─── Main Quiz Component ──────────────────────────────────────────────────────

export default function Quiz() {
  const [activeCategories, setActiveCategories] = useState<VerbCategory[]>(["regular"]);
  const [sessionCategories, setSessionCategories] = useState<VerbCategory[] | null>(null);
  const activeCategoriesRef = useRef<VerbCategory[]>(["regular"]);
  const sessionLockedRef = useRef(false);

  const [verb, setVerb] = useState<Verb>(() => randomItem(VERBS.filter(v => v.category === "regular")));
  const [subject, setSubject] = useState<{ group: SubjectGroup; displayLabel: string }>(() => ({
    group: SUBJECT_GROUPS[0], displayLabel: "yo",
  }));
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [correctEmoji, setCorrectEmoji] = useState("");
  const [score, setScore] = useState(0);
  const [total, setTotal] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TOTAL_SECONDS);
  const [timerStarted, setTimerStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [paused, setPaused] = useState(false);
  const [superchampion, setSuperchampion] = useState(false);
  const [secondsUsed, setSecondsUsed] = useState(0);
  const [showVerbList, setShowVerbList] = useState(false);
  const [refPulse, setRefPulse] = useState(0);
  const [milestone50, setMilestone50] = useState(false);
  const [showSigue, setShowSigue] = useState(false);

  // Al Revés mode
  const [reverseMode, setReverseMode] = useState(false);
  const [revCycles, setRevCycles] = useState<Record<string, number>>({ "él/ella": 0, "nosotros": 0, "ellos": 0 });
  const [wrongClick, setWrongClick] = useState<string | null>(null);

  // Tense system
  const [tenseSetting, setTenseSetting] = useState<TenseSetting>("presente");
  const [sessionTense, setSessionTense] = useState<TenseSetting | null>(null);
  const [questionTense, setQuestionTense] = useState<Tense>("present");
  const tenseSettingRef = useRef<TenseSetting>("presente");
  const questionTenseRef = useRef<Tense>("present");
  useEffect(() => { tenseSettingRef.current = tenseSetting; }, [tenseSetting]);

  const inputRef = useRef<HTMLInputElement>(null);
  const answerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackPendingRef = useRef(false);
  const autoPausedRef = useRef(false);

  // Repeat-avoidance refs
  const recentCorrectRef = useRef<string[]>([]);
  const retryQueueRef = useRef<RetryItem[]>([]);
  const skipBeforeRetryRef = useRef(0);
  const isRetryRef = useRef(false);

  const categoriesLocked = timerStarted && timeLeft <= LOCK_AT;

  // Keep activeCategoriesRef in sync
  useEffect(() => { activeCategoriesRef.current = activeCategories; }, [activeCategories]);

  // ── nextQuestion ─────────────────────────────────────────────────────────

  const nextQuestion = useCallback(() => {
    feedbackPendingRef.current = false;

    let nextVerb: Verb;
    let nextGroup: SubjectGroup;
    let nextLabel: string;
    let nextTense: Tense;

    const setting = tenseSettingRef.current;
    const tenses: Tense[] =
      setting === "presente" ? ["present"] :
      setting === "preterito" ? ["past"] :
      ["present", "past"];

    const retry = retryQueueRef.current[0];
    // Only surface a queued retry if its tense is allowed by the current setting;
    // otherwise it stays at the front of the queue until the tense matches again.
    const useRetry = !!retry && skipBeforeRetryRef.current === 0 && tenses.includes(retry.tense);

    if (useRetry) {
      nextVerb = retry.verb;
      nextGroup = SUBJECT_GROUPS.find(g => g.pronoun === retry.pronoun) ?? SUBJECT_GROUPS[0];
      nextLabel = retry.displayLabel;
      nextTense = retry.tense;
      isRetryRef.current = true;
    } else {
      if (skipBeforeRetryRef.current > 0) skipBeforeRetryRef.current--;
      isRetryRef.current = false;

      const cats = activeCategoriesRef.current;
      const catOf = (v: Verb, t: Tense) => (t === "present" ? v.category : v.pastCategory);
      const recent = recentCorrectRef.current;
      const retryKeys = retryQueueRef.current.map(r => `${r.verb.infinitive}::${r.pronoun}::${r.tense}`);

      type Combo = { verb: Verb; group: SubjectGroup; label: string; tense: Tense };
      const buildCombos = (filterRecentRetry: boolean): Combo[] => {
        const out: Combo[] = [];
        for (const t of tenses) {
          for (const v of VERBS) {
            if (!cats.includes(catOf(v, t))) continue;
            for (const g of SUBJECT_GROUPS) {
              const key = `${v.infinitive}::${g.pronoun}::${t}`;
              if (filterRecentRetry && (recent.includes(key) || retryKeys.includes(key))) continue;
              out.push({ verb: v, group: g, label: randomItem(g.variants), tense: t });
            }
          }
        }
        return out;
      };

      const combos = buildCombos(true);
      const fallback1 = combos.length > 0 ? combos : buildCombos(false);
      // Guaranteed-non-empty fallback: ignore category filter entirely
      const fallback2 = fallback1.length > 0 ? fallback1 : tenses.flatMap(t =>
        VERBS.flatMap(v => SUBJECT_GROUPS.map(g => ({ verb: v, group: g, label: randomItem(g.variants), tense: t }))));

      const chosen = randomItem(fallback2);
      nextVerb = chosen.verb;
      nextGroup = chosen.group;
      nextLabel = chosen.label;
      nextTense = chosen.tense;
    }

    questionTenseRef.current = nextTense;
    setQuestionTense(nextTense);
    setVerb(nextVerb);
    setSubject({ group: nextGroup, displayLabel: nextLabel });
    setAnswer("");
    setFeedback(null);
    setCorrectAnswer("");
    setCorrectEmoji("");
    setWrongClick(null);

    // Advance reverse-mode button label cycles
    setRevCycles(prev => ({
      "él/ella":  ((prev["él/ella"]  ?? 0) + 1) % REV_LABELS["él/ella"].length,
      "nosotros": ((prev["nosotros"] ?? 0) + 1) % REV_LABELS["nosotros"].length,
      "ellos":    ((prev["ellos"]    ?? 0) + 1) % REV_LABELS["ellos"].length,
    }));

    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  // Initial question
  useEffect(() => {
    nextQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer — only runs after first answer
  useEffect(() => {
    if (!timerStarted || finished || paused || showVerbList) return;
    if (timeLeft <= 0) { setFinished(true); return; }
    const id = setInterval(() => {
      setTimeLeft(t => {
        const next = t - 1;
        if (!sessionLockedRef.current && next <= LOCK_AT) {
          sessionLockedRef.current = true;
          setSessionCategories([...activeCategoriesRef.current]);
          setSessionTense(tenseSettingRef.current);
        }
        if (next <= 0) { clearInterval(id); setFinished(true); return 0; }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timerStarted, finished, paused, showVerbList]);

  // Cleanup
  useEffect(() => {
    return () => { if (answerTimeoutRef.current) clearTimeout(answerTimeoutRef.current); };
  }, []);

  // ── Shared answer logic ───────────────────────────────────────────────────

  const processAnswer = useCallback((isCorrect: boolean, qKey: string, correctDisplay: string) => {
    setTotal(t => t + 1);
    setCorrectAnswer(correctDisplay);
    feedbackPendingRef.current = true;

    if (isCorrect) {
      const newScore = score + 1;
      const newTotal = total + 1;
      setScore(s => s + 1);
      setStreak(s => { const n = s + 1; setBestStreak(b => Math.max(b, n)); return n; });
      setCorrectEmoji(randomItem(CORRECT_EMOJIS));
      setFeedback("correct");

      recentCorrectRef.current = [qKey, ...recentCorrectRef.current.filter(k => k !== qKey)].slice(0, RECENT_CORRECT_MAX);
      if (isRetryRef.current) { retryQueueRef.current = retryQueueRef.current.slice(1); }

      if (newScore === 50 && newTotal === 50 && !milestone50) {
        setMilestone50(true);
        setShowSigue(true);
        setTimeout(() => setShowSigue(false), 1600);
      }

      if (newScore >= SUPER_THRESHOLD && newTotal === newScore) {
        setSecondsUsed(TOTAL_SECONDS - timeLeft + 1);
        answerTimeoutRef.current = setTimeout(() => { setSuperchampion(true); setFinished(true); }, CORRECT_DELAY);
        return;
      }
      answerTimeoutRef.current = setTimeout(nextQuestion, CORRECT_DELAY);
    } else {
      setStreak(0);
      setFeedback("incorrect");
      setRefPulse(p => p + 1);

      if (isRetryRef.current) {
        skipBeforeRetryRef.current = 1;
      } else {
        const qt = questionTenseRef.current;
        const alreadyQueued = retryQueueRef.current.some(
          r => r.verb.infinitive === verb.infinitive && r.pronoun === subject.group.pronoun && r.tense === qt
        );
        if (!alreadyQueued) {
          retryQueueRef.current = [...retryQueueRef.current, { verb, pronoun: subject.group.pronoun, displayLabel: subject.displayLabel, tense: qt }];
        }
        skipBeforeRetryRef.current = Math.max(skipBeforeRetryRef.current, 1);
      }
      answerTimeoutRef.current = setTimeout(nextQuestion, INCORRECT_DELAY);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, total, milestone50, timeLeft, verb, subject, nextQuestion]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const doPause = () => {
    if (answerTimeoutRef.current) { clearTimeout(answerTimeoutRef.current); answerTimeoutRef.current = null; }
    setPaused(true);
  };

  const doResume = () => {
    setPaused(false);
    if (feedbackPendingRef.current) { nextQuestion(); } else { setTimeout(() => inputRef.current?.focus(), 30); }
  };

  const handlePause = () => { paused ? doResume() : doPause(); };

  const handleShowVerbList = () => {
    if (!paused) { doPause(); autoPausedRef.current = true; } else { autoPausedRef.current = false; }
    setShowVerbList(true);
  };

  const handleHideVerbList = () => {
    setShowVerbList(false);
    if (autoPausedRef.current) { autoPausedRef.current = false; doResume(); }
  };

  const toggleCategory = (cat: VerbCategory) => {
    if (categoriesLocked) return;
    // Acentos has no distinct preterite category — disable it in pretérito-only mode
    if (cat === "acentos" && tenseSetting === "preterito") return;
    setActiveCategories(prev => {
      if (prev.includes(cat)) {
        const next = prev.filter(c => c !== cat);
        return next.length === 0 ? ["regular"] : next;
      }
      return [...prev, cat];
    });
  };

  const handleSetTense = (next: TenseSetting) => {
    if (categoriesLocked || next === tenseSetting) return;
    // Entering pretérito-only: strip "acentos" since it has no past category
    if (next === "preterito") {
      const stripped = activeCategoriesRef.current.filter(c => c !== "acentos");
      const effective: VerbCategory[] = stripped.length === 0 ? ["regular"] : stripped;
      // Sync the ref immediately so the next question respects the stripped categories
      // (the state effect that normally syncs the ref runs only after re-render).
      activeCategoriesRef.current = effective;
      setActiveCategories(effective);
    }
    if (answerTimeoutRef.current) { clearTimeout(answerTimeoutRef.current); answerTimeoutRef.current = null; }
    feedbackPendingRef.current = false;
    tenseSettingRef.current = next;
    setTenseSetting(next);
    nextQuestion();
  };

  const handleToggleReverse = () => {
    if (answerTimeoutRef.current) { clearTimeout(answerTimeoutRef.current); answerTimeoutRef.current = null; }
    feedbackPendingRef.current = false;
    setReverseMode(prev => !prev);
    nextQuestion();
  };

  // Forward mode submit
  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (feedback !== null || !answer.trim() || finished || paused || showVerbList) return;
    if (!timerStarted) setTimerStarted(true);

    const expected = conjForm(verb, subject.group.pronoun, questionTense);
    const isCorrect = answer.trim().toLowerCase() === expected;
    const qKey = `${verb.infinitive}::${subject.group.pronoun}::${questionTense}`;
    processAnswer(isCorrect, qKey, expected);
  };

  // Reverse mode button click
  const handleReverseClick = (clickedPronoun: string) => {
    if (feedback !== null || finished || paused || showVerbList) return;
    if (!timerStarted) setTimerStarted(true);

    const isCorrect = clickedPronoun === subject.group.pronoun;
    const qKey = `${verb.infinitive}::${subject.group.pronoun}::${questionTense}`;
    const correctDisplay = getRevLabel(subject.group.pronoun, revCycles);

    if (!isCorrect) setWrongClick(clickedPronoun);
    processAnswer(isCorrect, qKey, correctDisplay);
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
  const timerWarning = timeLeft <= 20 ? "text-red-600" : timeLeft <= 60 ? "text-amber-600" : "text-gray-700 dark:text-gray-200";
  const isPast = questionTense === "past";
  const activeCategory = isPast ? verb.pastCategory : verb.category;
  const theme = THEMES[activeCategory];
  const refEndings = getRefEndings(verb, questionTense);
  const hideHelpers = score >= 10 && total > 0 && score === total;
  const showQuestionMark = refEndings === null;
  const refTypeLabel = isPast
    ? (verb.pastRef === "strong" || verb.pastRef === "strongJ" ? "Pretérito fuerte" : `Pretérito -${verb.type.toUpperCase()}`)
    : `Terminaciones -${verb.type.toUpperCase()}`;
  const conjugatedForm = conjForm(verb, subject.group.pronoun, questionTense);
  const invertStyle = reverseMode ? { filter: "invert(1)" } : undefined;

  if (finished) {
    return (
      <EndScreenView
        score={score} total={total} bestStreak={bestStreak}
        superchampion={superchampion} secondsUsed={secondsUsed}
        sessionCategories={sessionCategories ?? activeCategories}
        reverseMode={reverseMode}
        tenseSetting={sessionTense ?? tenseSetting}
      />
    );
  }

  return (
    <div
      className="min-h-screen flex items-start justify-center px-4 pt-8 pb-6 transition-all duration-500"
      style={{ background: theme.bgStyle, ...invertStyle }}
    >
      <div className="flex gap-5 items-start w-full" style={{ maxWidth: "800px" }}>

        {/* ── Main quiz column ── */}
        <div className="flex-1 min-w-0">

          {/* Header */}
          <div className="text-center mb-5">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
              {reverseMode ? "Al Revés — " : "Práctica de "}
              <button
                onClick={handleShowVerbList}
                className={`${theme.streakText} hover:underline underline-offset-2 cursor-pointer bg-transparent border-none p-0 font-bold text-3xl`}
                title="Ver lista de verbos"
              >
                Verbos
              </button>
            </h1>
            <div className="flex items-center justify-center gap-3 mt-2">
              <motion.span
                key={timeLeft}
                className={`text-2xl font-mono font-bold tabular-nums ${timerWarning}`}
                animate={timerStarted && timeLeft <= 10 ? { scale: [1, 1.15, 1] } : {}}
                transition={{ duration: 0.3 }}
              >
                {!timerStarted ? "5:00" : paused ? "— pausa —" : formatTime(timeLeft)}
              </motion.span>
              <button
                onClick={handlePause}
                title={paused ? "Continuar" : "Pausar"}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                {paused ? <Play size={18} /> : <Pause size={18} />}
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatCard label="Puntuación" value={`${score}/${total}`} />
            <StatCard
              label="Exactitud"
              value={total > 0 ? `${percentage}%` : "—"}
              color={percentage >= 80 ? "green" : percentage >= 60 ? "amber" : total > 0 ? "red" : undefined}
            />
            <StatCard label="Racha" value={`${streak}`} highlight={streak >= 3} highlightBorderClass={theme.statBorder} />
          </div>

          {/* Question card */}
          <motion.div
            animate={milestone50 ? {
              boxShadow: ["0 0 0px 0px rgba(234,179,8,0)", "0 0 24px 8px rgba(234,179,8,0.6)", "0 0 8px 2px rgba(234,179,8,0.25)"],
            } : {}}
            transition={{ duration: 0.8, times: [0, 0.3, 1] }}
            className={`relative bg-white dark:bg-gray-900 rounded-2xl shadow-lg overflow-hidden transition-all duration-500 ${
              milestone50
                ? "border-2 border-yellow-400 shadow-yellow-200"
                : "border border-gray-100 dark:border-gray-800"
            }`}
          >
            {/* Card header */}
            <div
              className={`${isPast ? "" : theme.headerBg} px-6 py-5 text-white relative transition-colors duration-300`}
              style={isPast ? {
                backgroundColor: theme.headerHex,
                backgroundImage: `repeating-linear-gradient(45deg, rgba(0,0,0,0.32) 0px, rgba(0,0,0,0.32) 12px, transparent 12px, transparent 24px)`,
              } : undefined}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium uppercase tracking-widest opacity-70">
                  {reverseMode ? "Identifica" : "Conjuga"}
                </span>
                <div className="flex items-center gap-2">
                  {isPast ? (
                    <span className="text-[10px] font-extrabold uppercase tracking-widest bg-black/80 text-white px-2 py-0.5 rounded-full">
                      Pasado
                    </span>
                  ) : (
                    <span className="text-[10px] font-extrabold uppercase tracking-widest bg-white/25 text-white px-2 py-0.5 rounded-full">
                      Presente
                    </span>
                  )}
                  <span className="text-xs font-bold opacity-50 uppercase tracking-widest">
                    -{verb.type.toUpperCase()}
                  </span>
                </div>
              </div>
              {reverseMode ? (
                <>
                  <div className="text-lg font-semibold opacity-75 mb-1">{verb.infinitive}</div>
                  <div className="text-5xl font-bold leading-tight">{conjugatedForm}</div>
                </>
              ) : (
                <>
                  <div className="text-lg font-semibold opacity-85 mb-1">{subject.displayLabel}</div>
                  <div className="text-5xl font-bold leading-tight">{verb.infinitive}</div>
                </>
              )}

              {/* Correct emoji overlay */}
              <AnimatePresence>
                {feedback === "correct" && correctEmoji && (
                  <motion.span
                    key={correctEmoji + total}
                    initial={{ scale: 0.3, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 1.3, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="absolute right-6 bottom-4 text-6xl select-none pointer-events-none"
                    style={{ filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.3))" }}
                  >
                    {correctEmoji}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            {/* Card body */}
            {reverseMode ? (
              /* ── Reverse mode: 5 subject buttons ── */
              <div className="p-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 text-center mb-4">
                  ¿Quién lo hace?
                </p>
                <div className="grid grid-cols-5 gap-2">
                  {SUBJECT_GROUPS.map(g => {
                    const cycleLabel = getRevLabel(g.pronoun, revCycles);
                    const isCorrectGroup = g.pronoun === subject.group.pronoun;
                    const isWrongClicked = g.pronoun === wrongClick;

                    const colors = REV_BTN_COLORS[g.pronoun];
                    let btnClass: string;
                    if (feedback === null) {
                      btnClass = `${colors.idle} border-2 cursor-pointer active:scale-95`;
                    } else if (isCorrectGroup) {
                      btnClass = "bg-green-500 border-2 border-green-600 text-white scale-105 shadow-md";
                    } else if (isWrongClicked) {
                      btnClass = "bg-red-400 border-2 border-red-500 text-white";
                    } else {
                      btnClass = `${colors.dimmed} border-2`;
                    }

                    return (
                      <button
                        key={g.pronoun}
                        disabled={feedback !== null || paused}
                        onClick={() => handleReverseClick(g.pronoun)}
                        className={`py-4 rounded-xl font-bold text-sm transition-all duration-200 select-none ${btnClass}`}
                      >
                        {cycleLabel}
                      </button>
                    );
                  })}
                </div>

                {/* Incorrect feedback */}
                <AnimatePresence mode="wait">
                  {feedback === "incorrect" && (
                    <motion.div
                      key="incorrect-rev"
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.12 }}
                      className="mt-4 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800"
                    >
                      La respuesta correcta es <span className="font-bold">{correctAnswer}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              /* ── Forward mode: text input ── */
              <form onSubmit={handleSubmit} className="p-6">
                <div className="flex items-center gap-3">
                  <span
                    className="text-xl font-bold text-gray-500 dark:text-gray-400 whitespace-nowrap shrink-0 select-none"
                    aria-hidden="true"
                  >
                    {subject.displayLabel}
                  </span>
                  <div className="relative flex-1">
                    <input
                      ref={inputRef}
                      type="text"
                      value={answer}
                      onChange={e => setAnswer(e.target.value)}
                      placeholder="conjuga..."
                      disabled={feedback !== null || paused}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      className={`w-full px-4 py-3 text-xl rounded-xl border-2 transition-colors outline-none pr-10
                        border-gray-200 dark:border-gray-700
                        bg-gray-50 dark:bg-gray-800
                        text-gray-900 dark:text-white
                        placeholder:text-gray-400 dark:placeholder:text-gray-500
                        ${theme.inputFocus}
                        disabled:opacity-60 disabled:cursor-not-allowed`}
                    />
                    <AnimatePresence>
                      {feedback === "incorrect" && (
                        <motion.span
                          initial={{ scale: 0.5, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.5, opacity: 0 }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-lg text-red-500"
                        >
                          ✗
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <AnimatePresence mode="wait">
                  {feedback === "incorrect" && (
                    <motion.div
                      key="incorrect-fwd"
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.12 }}
                      className="mt-3 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800"
                    >
                      La respuesta correcta es <span className="font-bold">{correctAnswer}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  type="submit"
                  disabled={!answer.trim() || feedback !== null || paused}
                  className={`mt-4 w-full py-3 px-6 rounded-xl font-semibold text-white
                    ${theme.buttonBg}
                    disabled:opacity-40 disabled:cursor-not-allowed
                    transition-all duration-150 shadow-sm`}
                >
                  Enviar
                </button>
              </form>
            )}

            {/* ¡Sigue! milestone flash */}
            <AnimatePresence>
              {showSigue && (
                <motion.div
                  key="sigue"
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.2 }}
                  transition={{ duration: 0.22 }}
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                  style={{ zIndex: 20 }}
                >
                  <span
                    className="text-5xl font-extrabold text-yellow-500 drop-shadow-lg select-none"
                    style={{ textShadow: "0 0 24px rgba(234,179,8,0.7), 0 2px 8px rgba(0,0,0,0.2)" }}
                  >
                    ¡Sigue!
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Best streak */}
          {bestStreak >= 3 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`mt-3 text-center text-sm font-medium ${theme.streakText}`}
            >
              Mejor racha: {bestStreak} seguidas
            </motion.div>
          )}

          {/* Reference card — hidden in reverse mode */}
          {!reverseMode && (
            <div className="mt-4 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
              {showQuestionMark || !refEndings ? (
                <div className="flex flex-col items-center justify-center py-3 gap-1">
                  <span className="text-3xl font-bold text-gray-300 dark:text-gray-600 tracking-widest select-none">¿?</span>
                  <span className="text-xs text-gray-300 dark:text-gray-600 font-medium">Este verbo es irregular</span>
                </div>
              ) : (
                <motion.div animate={{ opacity: hideHelpers ? 0 : 1 }} transition={{ duration: 1.2 }}>
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3">
                    {refTypeLabel}
                  </h2>
                  <div className="grid grid-cols-5 gap-1.5">
                    {SUBJECT_GROUPS.map(g => {
                      const isActive = g.pronoun === subject.group.pronoun;
                      return (
                        <motion.div
                          key={g.pronoun}
                          animate={feedback === "incorrect" && isActive
                            ? { backgroundColor: ["#ffffff", "#fef2f2", "#fde8e8", "#fef2f2", "#ffffff"] }
                            : { backgroundColor: "#ffffff00" }
                          }
                          transition={{ duration: 1.2, times: [0, 0.25, 0.5, 0.75, 1], repeat: feedback === "incorrect" && isActive ? 1 : 0 }}
                          className={`text-center p-2 rounded-lg ${
                            isActive && feedback === null
                              ? `${theme.refHighlightBg} border ${theme.refHighlightBorder}`
                              : "bg-gray-50 dark:bg-gray-800/50"
                          }`}
                        >
                          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{g.referenceLabel}</div>
                          <div className={`text-sm font-bold mt-0.5 ${theme.refText}`}>-{refEndings[g.pronoun]}</div>
                        </motion.div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </div>
          )}

          {/* Copyright */}
          <div className="mt-4 text-center text-xs text-gray-300 dark:text-gray-600 select-none">
            © Matthew Yeager, 2026
          </div>
        </div>

        {/* ── Category switches panel ── */}
        <div className="w-40 shrink-0">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 sticky top-8">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-4">
              Categorías
            </h3>
            {CATEGORY_INFO.map(cat => (
              <SwitchRow
                key={cat.id}
                label={cat.label}
                checked={activeCategories.includes(cat.id)}
                disabled={categoriesLocked}
                switchOnBg={cat.switchOnBg}
                onChange={() => toggleCategory(cat.id)}
              />
            ))}
            {categoriesLocked && (
              <p className="text-xs text-gray-400 dark:text-gray-600 mt-3 text-center leading-tight">
                Bloqueadas a los 4:30
              </p>
            )}

            {/* Divider */}
            <div className="border-t border-gray-100 dark:border-gray-800 mt-4 pt-4">
              <SwitchRow
                label="Al revés"
                checked={reverseMode}
                disabled={false}
                switchOnBg="bg-gray-900"
                onChange={handleToggleReverse}
              />
            </div>

            {/* Tense selector */}
            <div className="border-t border-gray-100 dark:border-gray-800 mt-4 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3">
                Tiempo
              </h3>
              <div className="flex flex-col gap-1.5">
                {TENSE_OPTIONS.map(opt => {
                  const active = tenseSetting === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => handleSetTense(opt.id)}
                      disabled={categoriesLocked}
                      className={`w-full py-2 px-3 rounded-lg text-sm font-semibold text-left transition-all duration-150 border ${
                        active
                          ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100"
                          : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {categoriesLocked && (
                <p className="text-xs text-gray-400 dark:text-gray-600 mt-3 text-center leading-tight">
                  Bloqueado a los 4:30
                </p>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* ── Verb list overlay ── */}
      <AnimatePresence>
        {showVerbList && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-white dark:bg-gray-950 overflow-y-auto"
            style={invertStyle}
          >
            <div className="max-w-2xl mx-auto px-6 py-8">
              <div className="flex items-center gap-4 mb-8">
                <button
                  onClick={handleHideVerbList}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium text-sm"
                >
                  <ArrowLeft size={16} /> Volver
                </button>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Lista de Verbos</h2>
              </div>

              {CATEGORY_INFO.map(cat => {
                const isActive = activeCategories.includes(cat.id);
                const catVerbs = VERBS
                  .filter(v => v.category === cat.id)
                  .sort((a, b) => a.infinitive.localeCompare(b.infinitive));
                return (
                  <div key={cat.id} className={`mb-8 transition-opacity ${isActive ? "opacity-100" : "opacity-35"}`}>
                    <h3 className={`text-sm font-bold uppercase tracking-widest mb-3 ${cat.textColor}`}>
                      {cat.label}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {catVerbs.map(v => (
                        <span
                          key={v.infinitive}
                          className={`px-3 py-1 rounded-full text-sm font-medium ${cat.pillBg}`}
                        >
                          {v.infinitive}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Switch Row ───────────────────────────────────────────────────────────────

function SwitchRow({ label, checked, disabled, switchOnBg, onChange }: {
  label: string; checked: boolean; disabled: boolean; switchOnBg: string; onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3 last:mb-0">
      <span className={`text-xs font-medium leading-tight ${disabled ? "text-gray-300 dark:text-gray-600" : "text-gray-600 dark:text-gray-300"}`}>
        {label}
      </span>
      <button
        type="button" role="switch" aria-checked={checked}
        onClick={disabled ? undefined : onChange}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200
          ${checked ? switchOnBg : "bg-gray-200 dark:bg-gray-700"}
          ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200
          ${checked ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
      </button>
    </div>
  );
}

// ─── Supercampeón Screen ──────────────────────────────────────────────────────

const SUPER_LETTERS = "SUPERCAMPEÓN".split("");

function SuperchampionScreen({ score, secondsUsed, bestStreak, sessionCategories, reverseMode, tenseSetting }: {
  score: number; secondsUsed: number; bestStreak: number;
  sessionCategories: VerbCategory[]; reverseMode: boolean; tenseSetting: TenseSetting;
}) {
  const catLabels = sessionCategories.map(c => CATEGORY_INFO.find(ci => ci.id === c)?.label ?? c);
  const tenseLabel = TENSE_OPTIONS.find(t => t.id === tenseSetting)?.label ?? "Presente";
  const mins = Math.floor(secondsUsed / 60);
  const secs = secondsUsed % 60;
  const timeStr = mins > 0 ? `${mins} min ${secs} seg` : `${secs} segundos`;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="min-h-screen flex flex-col items-center justify-center p-8 overflow-hidden"
      style={{
        background: "linear-gradient(270deg,#ff0000,#ff8800,#ffff00,#00cc00,#0066ff,#8800ff,#ff0000)",
        backgroundSize: "600% 600%",
        animation: "rainbowShift 4s ease infinite",
        ...(reverseMode ? { filter: "invert(1)" } : {}),
      }}
    >
      <style>{`
        @keyframes rainbowShift { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
        @keyframes letterFloat  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
      `}</style>
      <motion.div
        initial={{ scale: 0, rotate: -10 }} animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 180, damping: 14, delay: 0.1 }}
        className="text-center"
      >
        {/* AL REVÉS badge */}
        {reverseMode && (
          <motion.div initial={{ y: -16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.05 }}
            className="mb-5 flex justify-center">
            <span className="inline-flex items-center gap-2 bg-white text-black font-black text-xl uppercase tracking-[0.18em] px-7 py-2.5 rounded-2xl border-4 border-black/15 shadow-2xl">
              ↔ Al revés
            </span>
          </motion.div>
        )}

        <div className="flex justify-center gap-0.5 mb-4">
          {SUPER_LETTERS.map((letter, i) => (
            <span key={i} className="text-5xl font-black text-white drop-shadow-lg select-none"
              style={{ animation: `letterFloat 1.2s ease-in-out ${i * 0.08}s infinite`, textShadow: "0 3px 12px rgba(0,0,0,0.4)" }}>
              {letter}
            </span>
          ))}
        </div>
        <motion.p initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5 }}
          className="text-2xl font-bold text-white mb-1" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
          ¡100 respuestas correctas!
        </motion.p>
        <motion.p initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.65 }}
          className="text-lg text-white/90 mb-8" style={{ textShadow: "0 2px 6px rgba(0,0,0,0.3)" }}>
          ¡Sin ningún error en {timeStr}!
        </motion.p>
        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.8 }}
          className="rounded-2xl p-6 mb-4 bg-white/25 backdrop-blur-sm">
          <div className="grid grid-cols-3 gap-6 text-center text-white">
            <div><div className="text-4xl font-bold">{score}</div><div className="text-sm mt-1 opacity-80">correctas</div></div>
            <div><div className="text-4xl font-bold">100%</div><div className="text-sm mt-1 opacity-80">exactitud</div></div>
            <div><div className="text-4xl font-bold">{bestStreak}</div><div className="text-sm mt-1 opacity-80">racha máx</div></div>
          </div>
        </motion.div>

        {/* Tense + category pills */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.95 }}
          className="flex flex-col items-center gap-2 mb-8">
          <span className="text-xs px-3 py-1 rounded-full font-bold uppercase tracking-widest bg-white/30 text-white border border-white/40">
            ⏱ {tenseLabel}
          </span>
          <div className="flex flex-wrap justify-center gap-1.5">
            {catLabels.map(label => (
              <span key={label} className="text-xs px-2.5 py-1 rounded-full font-medium bg-white/20 text-white opacity-80">{label}</span>
            ))}
          </div>
        </motion.div>

        <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}
          onClick={() => window.location.reload()}
          className="px-8 py-3 rounded-xl font-bold text-lg bg-white text-gray-900 hover:bg-gray-100 transition-all active:scale-95">
          Intentar de nuevo
        </motion.button>
      </motion.div>
    </motion.div>
  );
}

// ─── End Screen ───────────────────────────────────────────────────────────────

function EndScreenView({ score, total, bestStreak, superchampion, secondsUsed, sessionCategories, reverseMode, tenseSetting }: {
  score: number; total: number; bestStreak: number;
  superchampion: boolean; secondsUsed: number;
  sessionCategories: VerbCategory[]; reverseMode: boolean; tenseSetting: TenseSetting;
}) {
  if (superchampion) {
    return <SuperchampionScreen score={score} secondsUsed={secondsUsed} bestStreak={bestStreak} sessionCategories={sessionCategories} reverseMode={reverseMode} tenseSetting={tenseSetting} />;
  }
  const endScreen = getEndScreen(score, total);
  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
  const configs = {
    blue:   { bg: "bg-blue-600",   text: "text-white",    glassBg: "bg-white/20", btnCls: "bg-white text-gray-900 hover:bg-gray-100", heading: "¡¡FELICIDADES!!", sub: "¡Eres un campeón de verbos!" },
    green:  { bg: "bg-green-500",  text: "text-white",    glassBg: "bg-white/20", btnCls: "bg-white text-gray-900 hover:bg-gray-100", heading: "¡MUY BIEN!",       sub: "¡Eso no está mal!" },
    yellow: { bg: "bg-yellow-400", text: "text-gray-900", glassBg: "bg-black/10", btnCls: "bg-gray-900 text-yellow-400 hover:bg-gray-800", heading: "¡No hiciste mal!", sub: "Sigue intentando" },
    black:  { bg: "bg-black",      text: "text-white",    glassBg: "bg-white/10", btnCls: "bg-white text-black hover:bg-gray-100",    heading: "No te rindas",   sub: "sigue, tú vas a ganar." },
  };
  const cfg = configs[endScreen];
  const catLabels = sessionCategories.map(c => CATEGORY_INFO.find(ci => ci.id === c)?.label ?? c);
  const tenseLabel = TENSE_OPTIONS.find(t => t.id === tenseSetting)?.label ?? "Presente";

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className={`min-h-screen flex flex-col items-center justify-center ${cfg.bg} ${cfg.text} p-8`}
      style={reverseMode ? { filter: "invert(1)" } : undefined}
    >
      <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 18 }} className="text-center max-w-md">

        {/* AL REVÉS badge — shown prominently before the heading */}
        {reverseMode && (
          <motion.div initial={{ y: -16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.12 }}
            className="mb-6 flex justify-center">
            <span className="inline-flex items-center gap-2 bg-white text-black font-black text-xl uppercase tracking-[0.18em] px-7 py-2.5 rounded-2xl border-4 border-black/15 shadow-2xl">
              ↔ Al revés
            </span>
          </motion.div>
        )}

        <motion.h1 initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}
          className="text-5xl font-extrabold tracking-tight mb-3 leading-tight">{cfg.heading}</motion.h1>
        <motion.p initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.35 }}
          className="text-2xl font-semibold mb-10 opacity-90">{cfg.sub}</motion.p>
        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5 }}
          className={`rounded-2xl p-6 mb-4 ${cfg.glassBg}`}>
          <div className="grid grid-cols-3 gap-6 text-center">
            <div><div className="text-4xl font-bold">{score}</div><div className="text-sm mt-1 opacity-80">correctas</div></div>
            <div><div className="text-4xl font-bold">{total}</div><div className="text-sm mt-1 opacity-80">preguntas</div></div>
            <div><div className="text-4xl font-bold">{percentage}%</div><div className="text-sm mt-1 opacity-80">exactitud</div></div>
          </div>
          {bestStreak >= 3 && <div className="mt-4 text-sm opacity-70">Mejor racha: {bestStreak} seguidas</div>}
        </motion.div>

        {/* Tense pill + category pills */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65 }}
          className="flex flex-col items-center gap-2 mb-8">
          <span className={`text-xs px-3 py-1 rounded-full font-bold uppercase tracking-widest border ${cfg.glassBg} opacity-90`}>
            ⏱ {tenseLabel}
          </span>
          <div className="flex flex-wrap justify-center gap-1.5">
            {catLabels.map(label => (
              <span key={label} className={`text-xs px-2.5 py-1 rounded-full font-medium ${cfg.glassBg} opacity-70`}>{label}</span>
            ))}
          </div>
        </motion.div>

        <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.75 }}
          onClick={() => window.location.reload()}
          className={`px-8 py-3 rounded-xl font-bold text-lg transition-all active:scale-95 ${cfg.btnCls}`}>
          Intentar de nuevo
        </motion.button>
      </motion.div>
    </motion.div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, highlight, highlightBorderClass }: {
  label: string; value: string; color?: "green" | "amber" | "red";
  highlight?: boolean; highlightBorderClass?: string;
}) {
  const colorMap = { green: "text-emerald-600", amber: "text-amber-600", red: "text-red-500" };
  return (
    <div className={`bg-white dark:bg-gray-900 rounded-xl border px-3 py-3 text-center transition-all ${
      highlight && highlightBorderClass ? `${highlightBorderClass} shadow-sm` : "border-gray-100 dark:border-gray-800"
    }`}>
      <div className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide font-medium">{label}</div>
      <div className={`text-xl font-bold mt-0.5 ${color ? colorMap[color] : "text-gray-800 dark:text-white"}`}>{value}</div>
    </div>
  );
}
