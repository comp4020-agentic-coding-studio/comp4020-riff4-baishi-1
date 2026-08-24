# You are riffing on someone else's prototype

This repo is a copy of [`comp4020-crit4-baishi`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-baishi) at
`bc3f6761` --- baishi's crit agent's shipped prototype for `04-instrument`.
The copy is yours; their repo is untouched and off limits.

**The brief is to take this somewhere it hasn't been.** Not to restart it, not
to polish it, and not to finish the agent's to-do list. Read how they directed
the agent, find the thing the prototype implies but doesn't do, and build
that. You have the session's half-hour, so pick something you can get live.

**Nothing here is marked.** No cutoff, no reflection, no `PROCESS.md` entry,
no crit sweep, no repo of your own on the line. That is the point --- the
interesting move is the one you wouldn't risk in your own graded repo.

**What you show at the share-back** is the live site plus
`git diff riff-start`. Push early and keep `main` green.

**The agent's own spec tests are `spec/crit-4.test.ts`.** They encode the crit brief,
not yours, and they gate the deploy --- a red check means no live site to show
at the share-back. If your riff moves past that brief, change them or delete
them; keep `spec/invariants.test.ts` green, since that one is true of any good
site.

Everything below this line was written for that crit submission. The marks,
the cutoff, the private-repo phase, the weekly `start` skill and the
reflection are all done, and none of it governs what you do here. Read it for
how they worked, not for what you owe.

---

# COMP4020 prototype

Your starter repo for a COMP4020 prototype: a static site in HTML/CSS/TypeScript
that builds to plain HTML/CSS/JS and deploys to GitHub Pages. The deployed site
is what gets marked, not this repo.

The
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec, and this repo's name tells you
which deliverable applies. Read both before you plan or build.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- Run `pnpm check` before you push.
- Open the page in a browser and look at it. The rendered page is the truth;
  your mental model of it isn't.
- When a check fails, read its output before you change anything.
- Never commit a red state.

## The link-preview card

`public/card.png` (1200x630) is the image a shared link shows; `index.html`'s
head points at it. Replace it and the `description` meta, and copy the head
block into any new page. The card URL resolves against the page that names it,
like any link --- `./card.png` is wrong one directory down, and nothing in CI
checks it, so look at the deployed head when you add pages.

## The checks

`pnpm check` runs them (`pnpm check:evidence` is the extra gate before you
ship); CI runs the same plus links, secrets and the deploy. Read the failure.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for.

## This file is yours

A starting point, not a rulebook. As you learn what your prototype needs --- a
convention the work has to hold to, a sensor that keeps catching you out (a
linter, say), a fact about the stack that is easy to get wrong --- write it down
here and wire it into `check`. Growing this file is the work.
