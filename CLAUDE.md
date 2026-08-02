# CLAUDE.md

Public repo for the Somos Internet candidacy: the app itself (pipeline + web dashboard + pitch deck). Research, docs and session log live in the private repo `somos-knowledge-base/` (nested repo inside this workspace).

## Conventions

- Commits and code in English. User-visible strings in Spanish.
- Never invent data about Somos Internet: every public figure comes from a source cited in `somos-knowledge-base/` or is marked "sin verificar".
- Commit with `git add -A` + `git commit -m "type: ..."` in the correct repo. **Push is human-only — never run `git push`.**
- Read `somos-knowledge-base/docs/memoria.md` at the start of a new session; log doc-affecting changes there (Sesión N entry).

## Work cycle

Global SDD loop applies (see `~/.claude/CLAUDE.md`): Specify → Plan → Tasks → Implement → Verify. Nothing is "done" without Verify.

- **Verify gate before committing code:** `npm run run-all` and `npm test` must pass (unit + fuzz + invariants). If the change has no test coverage, write the test first. Verify over real HTTP when applicable (local server + curl).
- If verification can't run, report "work in progress", not "done".
- Product decisions (backlog ICE scoring, funnel model) are spec'd in `somos-knowledge-base/descubrimientos/` before being implemented here.
