# External Review Loop (codex as adversarial reviewer)

Use OpenAI's `codex` CLI as an independent reviewer of your own work before a human sees it. The loop: review → triage → fix fair findings → commit → re-review, until clean.

## Invocation

```bash
codex review --base main 2>&1 | tail -120     # review branch vs base (the default move)
codex review --base origin/main ...           # when local main may be stale
codex review --uncommitted ...                # working-tree changes, pre-commit
codex review --commit <sha> ...               # single commit
codex review <PR-number>                      # codex reads the PR description for intent
```

- Steer with a positional prompt: `codex review --base main "Focus on X, Y. Report only issues genuinely worth fixing."` For long briefs use `"$(cat /tmp/review-prompt.md)"` or stdin via `-` (with `--title` for display context). A good brief states the feature context, prioritized focus areas (security first), what to skip (style/lint), and a mandated output format ("P0/P1/P2 punch list, file:line per finding").
- Reviews take minutes. Run in the background redirecting to a file (`codex review --base main > /tmp/review-r1.txt 2>&1`), then read the file when the process exits.
- **Exit code is 0 even with findings** — judge clean/dirty from the text, not `$?`.
- Print `git branch --show-current` and `git rev-parse --short HEAD` around the review so it's unambiguous which state was reviewed — stale-state false positives (reviewing before a push/amend landed) are the most common confusion.
- Older CLI versions reject `--base` combined with a prompt (`cannot be used with '[PROMPT]'`); pass the prompt alone, use stdin `-`, or upgrade.

## The loop

1. Commit and push the work, then run the review.
2. **Triage every finding before touching code.** Codex emits `[P1]/[P2]/[P3] — file:line` with rationale. Verify each at the cited location, then classify: fair (fix it), stale (already fixed, or presupposes old state — say so), or judgment call (present to the user with a recommendation). Never silently drop a finding — rebut it explicitly.
3. Fix the fair ones; keep provenance in the commit message: `(codex review, P2)` or `fix: address codex review round 3`.
4. Push and re-review. Small PRs converge in 1–3 rounds; large or security-sensitive features can take 6+.
5. **Brief later rounds.** List prior findings and their fixes ("don't re-flag these"), point fresh eyes at not-yet-audited surfaces, and demand a verdict: "P0/P1 only, skip nitpicks — or say plainly: no issues, ship it."
6. Once correctness is clean, optionally flip the lens for one final pass: "Do NOT look for bugs — those have been reviewed exhaustively. Review ONLY for over-engineering and simplification opportunities." Present those findings; don't auto-implement them.

## Conventions

- Record the outcome in the PR body's verification section: `codex review --base main: clean (after iterating on N findings — ...)`.
- Findings that arrive after the PR merged go in a **follow-up PR** referencing the original — never amend a merged branch.
- The user arbitrates dismissals of borderline findings.
- To run the loop unattended, set a session goal (Stop hook), e.g.: "run `codex review` on this PR and fix any finding you judge important. Repeat until there are no findings that need to be addressed." **Phrase the escape clause carefully** — state explicitly whose judgment ends the loop ("findings *the assistant* deems dismissible"). An ambiguous "or you think they don't need addressing" can wedge the hook: the checker may read "you" as the user, so the agent's own dismissal never satisfies the goal.

## Sibling pattern: plan review

The same adversarial-reviewer move works pre-code: pipe a written plan to `codex exec -` with a critique prompt ("review this plan — focus on bloat and YAGNI"). Useful before large implementations; findings adjust the plan, not the code.
