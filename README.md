# COMP90073 Workshop Week 4 — K-Anonymity & Differential Privacy

An interactive tutorial on Incognito and differential privacy, grounded in COMP90073 Lectures 4, 5 and 6, the Week 3 privacy workshop, and the Week 4 tutorial questions and answers.

**Live tutorial:** https://hesamasad.github.io/week-4-dp-workshop/

The Reveal.js deck runs 44 slides in four parts. Short prerequisite visuals now appear immediately before the ideas that use them: Week 3 record linkage and equivalence classes before Incognito; neighbouring datasets and output distributions before the DP definition; sensitivity before the Laplace mechanism; and composition and post-processing before membership inference. It includes facilitator notes, two concept checks, and nine browser-based labs.

For a 55-minute class, run Labs 1, 3, 6 and 8 live. Treat Labs 2, 4 and 5 as short checks, and Labs 7 and 9 as extensions if time permits.

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
- **Lab 4 — a mechanism that is not DP (Q6).** Pick which record the neighbouring dataset drops; the witness output follows it, and the ratio is infinite because one dataset can produce an output the other cannot. The lab stays focused on constructing this one counterexample; the Laplace repair comes later, after sensitivity has been introduced.
- **Lab 5 — randomised response (Q2).** The ratio `(1+p)/(1−p)` with a solver that lands on `p = 3/4` for `ε = ln 7`, plus the unbiased estimator `x̂ = (Z/n − ½(1−p))/p` and its exact interval, so the privacy–utility trade is visible rather than described. `p = 0.5` reproduces lecture 6's `ln 3`.
- **Lab 6 — sensitivity (Q3, Q4).** Sum versus average, with the neighbouring distribution drawn alongside so `Δf` is literally the gap between the two curves. The underlying sample is held fixed across toggles, so the two queries are directly comparable: sliding `n` leaves a sum's absolute noise untouched and shrinks an average's like `1/n`, while the *relative* error is identical for both — an average is the sum over `n`, and the noise is divided by `n` too. The Q4 toggle doubles `Δf` to `2h` while only one record changed.
- **Lab 7 — clipping (Q7).** 500 synthetic long-tailed incomes. Moving `C` exposes the trade between clipping bias and `C/(nε)` noise; the displayed “best C” is explicitly the minimum simulated RMSE for this sample, not a universal optimum.
- **Lab 8 — the budget (Q9).** Sequential composition as an accounting unit. Under one fixed budget split equally over `k` repetitions, per-answer noise grows like `k` while averaging removes only `√k`, so repetition does not improve accuracy in this setup.
- **Lab 9 — DP versus membership inference (Q8, optional).** Yeom et al.'s `e^ε − 1` bound against the advantage Week 3's threshold attack achieved undefended — 73% accuracy at the best threshold, so advantage `2(0.73) − 1 = 0.46`. It separates the formal bound from any empirical claim about attack performance.

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
