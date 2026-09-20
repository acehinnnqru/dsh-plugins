# AGENTS.md

For models working in this repo. **Read this page before you touch anything.**

## How to talk to the maintainer

**The maintainer has ADHD. Optimize every reply for that, not for completeness.**

- **Lead with the answer.** First line = what happened or what you need. Detail comes after, if at all.
- **Short by default.** Aim for under ~15 lines. If it needs more, it needed a section — not more prose.
- **Bullets, not paragraphs.** One idea per line. No wall of text.
- **One ask at a time.** A question in the middle of five bullets does not get answered. Put it last, alone.
- **Plain words.** No hedging, no preamble ("I'll now…", "Great question"), no restating the request back.
- **Say what changed, not how you got there.** The diff is the report. Skip the narrative of your dead ends.
- **Never bury a decision.** If you picked between options, say which and why in one line, and flag it clearly.
- **Long task? Show a checklist** and tick items as they land, so progress is visible without reading.
- **Re-state hard constraints at the point of use.** Do not assume the maintainer remembers a constraint from an hour ago.

## Hard rules

1. **Acceptance commands must actually run.** Never write "it should work". Run it once and paste the real output.
2. **A plugin's user-facing UI copy may be Chinese** (its own locale strings) — that is the only Chinese allowed in a committed file.
3. **One change at a time.** Finish it, get it accepted, then start the next one.
4. **Do not call `dsh`.** It is only available in the maintainer's environment, and it needs the DSH checkout + nix devshell. No script may call it — "install it into a profile and start it" is a manual checklist, not automation.
5. **Do not add profile directories to the repo.** `dsh plugin --profile <name>` operates on `$DSH_HOME/profiles/<name>`, which is not in this repo.
6. **Do not rebuild `flake.nix` / `flake.lock`, and do not commit `.envrc`.** The first two pin the toolchain; the last is personal (already covered by the global gitignore).
7. **Write exact dependency versions, never carets.** Every DSH release is a prerelease and `^0.1.5-rc.1` does not actually match `0.1.6-rc.1`; a caret is a single-point pin disguised as a range. See DESIGN.md §3.4.
8. **Split dependencies by "must the identity be shared", not by package name.**
   - Must be unique (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-*`) → `peerDependencies` + `devDependencies`, never in `dependencies`
   - Need not be (`schemastery`, `zod`) → `dependencies`
   `pnpm verify:compat` and `plugin-lint` reject violations.
9. **After changing `package.json`, bring the lockfile along** (run `pnpm install` once). This repo **tracks** its lockfile (`pnpm-lock.yaml` is under version control); change a dependency without updating it and everyone else installs a different tree than you.
10. **Tests go in each package's `tests/`, named `*.spec.ts`** — never next to the source.
11. **The version constant has exactly one home**: `tooling/dsh-compat/src/index.ts`. Upgrading DSH means editing that, then syncing every plugin.

## The shape of this repo

```
flake.nix            toolchain (node 22 + pnpm), do not rebuild
plugins/<name>/      every directory = one installable plugin (the only place that declares dsh.bundle)
packages/<lib>/      internal shared libraries, inlined at build time, never installed on their own
tooling/<tool>/      build and validation tools (dsh-compat version constants, plugin-lint, dsh-client-preset)
scripts/             verify / verify:compat / verify:platform-modules / plugin-lint / new:plugin
templates/plugin/    scaffolding source for `pnpm new:plugin`; never a workspace member
docs/research/       research notes, every claim with its source
```

## How to read the docs

| To learn | Read |
|---|---|
| **Why** it is designed this way | [`DESIGN.md`](./DESIGN.md) |
| Where an upstream contract comes from | [`docs/research/`](./docs/research/) |

**When the docs and the code disagree, the code that runs wins — then go back and fix the doc.**
Never leave a doc that contradicts the code.
