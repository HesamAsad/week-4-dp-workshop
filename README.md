# COMP90073 Workshop Week 4 — K-Anonymity & Differential Privacy

An interactive tutorial on Incognito and differential privacy, grounded in COMP90073 Lectures 4, 5 and 6, the Week 3 privacy workshop, and the Week 4 tutorial questions and answers.

**Live tutorial:** https://hesamasad.github.io/week-4-dp-workshop/

The Reveal.js deck runs 47 slides in the worksheet's exact Question 1 → Question 9 order. A short k-anonymity recap defines the guarantee, unpacks its formula, and explains generalisation, suppression, monotonicity, and the homogeneity limitation before Question 1. Other prerequisite visuals appear inside the question that first needs them: the DP definition before Question 2, sensitivity before Question 3, post-processing before Question 8, and composition last in optional Question 9. A persistent question marker keeps the current worksheet number visible.

For a 55-minute class, shorten or skip an interactive exploration rather than jumping ahead to a later worksheet question.

## Question-by-question sequence

| Question | Core task | Interactive check |
|---|---|---|
| 1 | apply Incognito to obtain a table that is 3-anonymous with respect to the supplied quasi-identifiers | run the lattice and compare the two minimal releases |
| 2 | solve randomised response for `p` when `ε = ln 7` | turn the privacy dial |
| 3 | calibrate Laplace noise for a sum and an average | compare sensitivities and distributions |
| 4 | recompute sensitivity when one value can reach `2h` | one-wide-value concept check |
| 5 | explain why `ε = 50` is weak | inspect the permitted belief update |
| 6 | disprove privacy for a mechanism that returns a real record | choose the witness output |
| 7 | handle an unbounded income domain | explore clipping bias versus noise |
| 8 | connect DP training to membership inference | inspect when the advantage bound is binding |
| 9 | prove sequential composition | split a fixed budget across repeated releases |

## What the labs do

- **Question 1 lab A — Incognito.** Steps through the real algorithm on the worksheet's twelve rows and reaches the worksheet's two minimal 3-anonymous generalisations.
- **Question 1 lab B — released tables.** Compares the two minimal answers, their information loss, and the remaining homogeneity leak.
- **Question 2 lab — randomised response.** Solves `p = 3/4` for `ε = ln 7` and exposes the privacy–utility trade.
- **Question 3 lab — sensitivity.** Compares sum and average queries; the Question 4 toggle then doubles `Δf` to `2h`.
- **Question 5 lab — what ε forbids.** Turns ε into a permitted belief update, showing why `ε = 50` is extremely permissive.
- **Question 6 lab — a non-DP mechanism.** Lets students choose the neighbouring record and see the positive-versus-zero witness probability.
- **Question 7 lab — clipping.** Prices the trade between clipping bias and `C/(nε)` noise on synthetic incomes.
- **Question 8 lab — membership inference.** Compares the formal membership-advantage bound with Week 3's undefended attack.
- **Question 9 lab — composition.** Splits one fixed budget across repeated releases and shows the accounting consequence.

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
