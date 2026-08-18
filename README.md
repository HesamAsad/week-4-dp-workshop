# COMP90073 Workshop Week 4 — K-Anonymity & Differential Privacy

An interactive tutorial on Incognito and differential privacy, grounded in COMP90073 Lectures 4, 5 and 6 and the Week 4 workshop questions.

**Live tutorial:** https://hesamasad.github.io/week-4-dp-workshop/

The Reveal.js deck runs 36 slides in four parts — one per thing you have to get right — with a 60-second lecture recap opening each part, facilitator notes, two concept checks, and nine browser-based labs.

## The four parts

| Part | The obligation | Worksheet | Labs |
|---|---|---|---|
| 1 | a table you generalise | Q1 | running Incognito · the released table and its cost |
| 2 | a guarantee you claim | Q2, Q5, Q6 | what ε buys · breaking a mechanism · randomised response |
| 3 | noise you calibrate | Q3, Q4, Q7 | sensitivity of sum and average · pricing the clipping bound |
| 4 | a budget you spend | Q8, Q9 | composition and repetition · the membership-advantage bound |

## What the labs do

- **Lab 1 — Incognito (Q1).** Steps through the real algorithm on the worksheet's twelve rows: candidate generation by the subset property, a bottom-up sweep inside each phase, and rollup pruning on every success. Every `k=` figure is counted from the data. It reaches the worksheet's own answer — the minimal 3-anonymous generalisations are `⟨P0,A2,I1⟩` and `⟨P2,A0,I1⟩` — after 14 scans, with 14 nodes ruled in for free and 13 of the 18 full-domain nodes never generated at all.
- **Lab 2 — the released table.** Both minimal answers side by side, with class sizes, lecture 4's `1 − 1/|cell|` information-loss penalty, and per-class diversity of the loan column. The `30*` class turns out to be homogeneous, so week 3's homogeneity attack still works — which is the bridge into part 2.
- **Lab 3 — what ε forbids (Q5).** Converts ε into the quantity students can actually judge: how far a stated prior belief may legitimately move. At ε = 1 a 50% belief lands in 26.9%–73.1%; at ε = 50 the band covers the axis, which is the worksheet's point made quantitative rather than asserted.
- **Lab 4 — a mechanism that is not DP (Q6).** Pick which record the neighbouring dataset drops; the witness output follows it, and the ratio is infinite because one dataset can produce an output the other cannot. Toggling to a Laplace count on the same pair shows the ratio capped at `e^ε` — the difference is support, not scale.
- **Lab 5 — randomised response (Q2).** The ratio `(1+p)/(1−p)` with a solver that lands on `p = 3/4` for `ε = ln 7`, plus the unbiased estimator `x̂ = (Z/n − ½(1−p))/p` and its exact interval, so the privacy–utility trade is visible rather than described. `p = 0.5` reproduces lecture 6's `ln 3`.
- **Lab 6 — sensitivity (Q3, Q4).** Sum versus average, with the neighbouring distribution drawn alongside so `Δf` is literally the gap between the two curves. The underlying sample is held fixed across toggles, so the two queries are directly comparable: sliding `n` leaves a sum's absolute noise untouched and shrinks an average's like `1/n`, while the *relative* error is identical for both — an average is the sum over `n`, and the noise is divided by `n` too. The Q4 toggle doubles `Δf` to `2h` while only one record changed.
- **Lab 7 — clipping (Q7).** 500 synthetic long-tailed incomes. Refusing to clip makes the sensitivity the richest person's income and the noise dwarfs the answer; the total-error curve against `C` is U-shaped with a genuine optimum, trading clipping bias against `C/(nε)` noise.
- **Lab 8 — the budget (Q9).** Sequential composition as an accounting unit, and the comparison that matters: asking the same query `k` times under a fixed budget makes the answer *worse*, because per-answer noise grows like `k` while averaging removes only `√k`. That is exactly the week 3 repetition attack failing.
- **Lab 9 — DP versus membership inference (Q8).** Yeom et al.'s `e^ε − 1` bound against the advantage week 3's threshold attack achieved undefended — 73% accuracy at the best threshold, so advantage `2(0.73) − 1 = 0.46`. The bound only beats that below `ε = ln(1.46) ≈ 0.38` and is vacuous above `ε = ln 2` — so the worksheet's answer is right in form, and the lab is explicit that the practical robustness of DP-SGD is a separate, empirical claim.

All examples use synthetic data except the Question 1 table, which is the worksheet's own. Everything executes locally in the browser. No server or build step is required, and nothing is collected.

## Run locally

Open `index.html` directly, or serve the directory:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000.

## Presentation controls

- `←` / `→` or `Space`: navigate
- `S`: facilitator notes (each lab has a suggested sequence to run in front of the class)
- `O`: slide overview
- `F`: fullscreen
- `B`: pause/black screen

## Deployment

GitHub Actions publishes the repository root to GitHub Pages after each push to `main`.

Reveal.js is included under its MIT licence in `reveal/LICENSE`.
