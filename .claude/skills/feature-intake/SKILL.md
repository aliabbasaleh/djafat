---
name: feature-intake
description: Validate a manually written DJAFAT feature (docs/features/FEAT-NNN-*/feature.md) and its screenshots before any spec is written — required fields, acceptance criteria, visual references, repository context, missing information. Use at the start of work on a feature or when the user asks to check/review a feature document.
---

# Feature intake

## Inputs

`docs/features/FEAT-NNN-<slug>/feature.md` (+ `assets/`), the repository.

## Steps

1. Run `pnpm check:specs`. Fix nothing in the feature's _content_; report
   structural errors to the human (the feature is theirs). You may fix pure
   formatting (table alignment, front-matter syntax) and say so.
2. Read `README.md` rules, and the docs of the touched modules
   (`docs/NN-*.md`, e.g. docs/22 cart/order, docs/24 payment, docs/19 auth).
3. Locate the current behaviour in code (`file:line`) for each acceptance
   criterion. Note what already exists, partially exists, or is absent.
4. Visual references (`ui: yes`):
   - Open each local image with the Read tool. If you cannot (missing file,
     unsupported format, model without vision), record it as
     **"non inspectée — handoff humain requis"** with what a human must check.
     Never describe an image you did not open.
   - Check each reference's nature (actuel / attendu / inspiration) and
     authority: only an "attendu" can be "faisant-foi".
   - A screenshot never defines a business rule, permission or interaction
     on its own: if it seems to, list it as an open question.
5. List missing information as questions — do not invent product decisions.
6. Write an "Intake" row and notes in `progress.md` (create it from
   `docs/features/_templates/progress.md` if absent).

## Output

Intake notes in `progress.md`: existing code per criterion, images inspected /
not inspected, gaps and questions.

## Blocking

`pnpm check:specs` errors in the feature itself; `ui: yes` change/bugfix with
no current + expected references; acceptance criteria that are not verifiable
("rapide", "intuitif") — ask the human to restate them.

## Success

`pnpm check:specs` passes for the feature; every AC is mapped to existing code
or marked as new; every image is either inspected or explicitly handed off.
