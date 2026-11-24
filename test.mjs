// Tests for the flashcard app. Run: python3 build.py && node test.mjs
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const win = {}; new Function("window", html.match(/<script id="cards">([\s\S]*?)<\/script>/)[1])(win);
const CARDS = win.CARDS;
const FC = new Function("module", html.match(/<script id="core">([\s\S]*?)<\/script>/)[1] + "; return FC;")({});
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? ": " + d : ""}`); };

// 1. cards
const topics = [...new Set(CARDS.map(c => c.topic))];
check("80 cards with unique ids", CARDS.length === 80 && new Set(CARDS.map(c => c.id)).size === 80);
check("four topics, each with 14+ cards", topics.length === 4 && topics.every(t => CARDS.filter(c => c.topic === t).length >= 14), topics.map(t => `${t} ${CARDS.filter(c => c.topic === t).length}`).join(", "));
check("every card has a real question and answer", CARDS.every(c => c.front.length > 10 && c.back.length > 25));
check("no duplicate fronts", new Set(CARDS.map(c => c.front)).size === 80);
// spot-check numbers quoted on cards
const card = s => CARDS.find(c => c.front.includes(s)).back;
check("card numbers are right (WTP $28.07, P(leader) 0.867, break-even 0.625, SD 13.4)",
  card("Willingness to pay").includes((0.80 / 0.0285).toFixed(2)) && card("P(leader)").includes((0.8 + 0.2 / 3).toFixed(3)) &&
  card("Break-even").includes((300 / 480).toFixed(3)) && card("SD of the number").includes(Math.sqrt(2000 * 0.1 * 0.9).toFixed(1)));

// 2. spaced repetition
{
  const s0 = FC.newState(), iv = r => FC.schedule(s0, r, 0).interval;
  check("first-review intervals: again < hard < good < easy", iv("again") < iv("hard") && iv("hard") < iv("good") && iv("good") < iv("easy"), ["again", "hard", "good", "easy"].map(r => FC.label(iv(r))).join(" < "));
  let s = FC.newState(), t = 0; const goods = [];
  for (let i = 0; i < 5; i++) { s = FC.schedule(s, "good", t); goods.push(s.interval); t = s.due; }
  check("repeated 'good' spaces reviews further apart", goods.every((v, i) => !i || v > goods[i - 1]), goods.map(FC.label).join(" → "));
  const lapsed = FC.schedule(s, "again", t);
  check("'again' resets a mature card to 1 minute and lowers ease", lapsed.interval === FC.MIN && lapsed.reps === 0 && lapsed.ease < s.ease && lapsed.lapses === 1);
  let e = FC.newState(); for (let i = 0; i < 20; i++) e = FC.schedule(e, "again", 0);
  check("ease never drops below 1.3", e.ease === 1.3);
  // missed cards come back sooner than known ones
  const deck = CARDS.slice(0, 2), states = {}, now = 1e12;
  states[deck[0].id] = { ...FC.schedule(FC.newState(), "again", now), seen: true };
  states[deck[1].id] = { ...FC.schedule(FC.newState(), "good", now), seen: true };
  const at2 = FC.pickNext(deck, states, now + 2 * FC.MIN, 0), at11 = FC.pickNext(deck, states, now + 11 * FC.MIN, 0);
  check("a missed card is due after 2 minutes; a known one isn't", at2 && at2.card.id === deck[0].id && !at2.isNew);
  check("by 11 minutes both are due, most overdue first", at11 && at11.card.id === deck[0].id);
  check("new cards stop when the daily allowance is used up", FC.pickNext(CARDS, {}, now, 0) === null && FC.pickNext(CARDS, {}, now, 1).isNew);
}

// 3. calculation drills: 300 random instances each, answers recomputed independently from the prompt text
const nums = s => (s.match(/-?\d[\d,]*\.?\d*/g) || []).map(x => Number(x.replace(/,/g, "")));
const indep = {
  ztest: p => { const [xA, nA, xB, nB] = nums(p); const pa = xA / nA, pb = xB / nB, pl = (xA + xB) / (nA + nB); return (pb - pa) / Math.sqrt(pl * (1 - pl) * (1 / nA + 1 / nB)); },
  samplesize: p => { const [a, b] = nums(p).map(v => v / 100); return Math.ceil((1.645 + 0.842) ** 2 * (a * (1 - a) + b * (1 - b)) / (b - a) ** 2 - 1e-9); },
  payback: p => { const [lift, v, m, cost] = nums(p); return cost / (v * lift / 100 * m / 30); },
  ci: p => { const [pa, pb, n] = nums(p); return 100 * 1.96 * Math.sqrt(pa * (1 - pa) / n + pb * (1 - pb) / n); },
  logit: p => { const [va, vb] = nums(p); return Math.exp(va) / (Math.exp(va) + Math.exp(vb) + 1); },
  wtp: p => { const [b, bp] = nums(p); return b / -bp; },
  precision: p => { const [tp, fp, fn] = nums(p); return p.includes("precision") ? tp / (tp + fp) : tp / (tp + fn); },
  breakeven: p => { const [a, b] = nums(p); return a / (a + b); },
  regret: p => { const n = nums(p), r = n.slice(0, 3).map(v => v / 100), [test, T] = n.slice(3, 5), best = Math.max(...r); return T * best - (test / 3 * (r[0] + r[1] + r[2]) + (T - test) * best); },
  epsilon: p => { const [e, K] = nums(p); return 1 - e + e / K; },
  beta: p => { const [, , s, n] = nums(p); return (1 + s) / (2 + n); },
  auc: p => { const [ps, ns] = p.split(";").map(part => nums(part.split("AUC")[0])); let s = 0; for (const a of ps) for (const b of ns) s += a > b ? 1 : a === b ? 0.5 : 0; return s / (ps.length * ns.length); },
};
for (const [k, g] of Object.entries(FC.GEN)) {
  const r = FC.mulberry32(42); let worst = 0, okAll = true;
  for (let i = 0; i < 300; i++) {
    const q = g.make(r), want = indep[k](q.prompt), err = Math.abs(q.answer - want);
    worst = Math.max(worst, err / Math.max(q.tol, 1e-12));
    if (!(err <= q.tol / 4) || !isFinite(q.answer) || !q.steps.length) okAll = false;
    if (FC.check(q, String(q.answer)) !== true || FC.check(q, String(q.answer + 3 * q.tol)) !== false) okAll = false;
  }
  check(`drill '${g.name}': 300 random questions recomputed independently`, okAll, `worst gap ${worst.toFixed(3)} × tolerance`);
}
check("answer parsing accepts '$1,234.5', '45%', ' 3.14 '", FC.check({ answer: 1234.5, tol: 0.1 }, "$1,234.5") && FC.check({ answer: 45, tol: 0.1 }, "45%") && FC.check({ answer: 3.14, tol: 0.01 }, " 3.14 ") && FC.check({ answer: 1, tol: 0.1 }, "") === null);
check("drills cover all four topics", new Set(Object.values(FC.GEN).map(g => g.topic)).size === 4);
console.log(`\n${pass}/${pass + fail} PASS`); process.exit(fail ? 1 : 0);
