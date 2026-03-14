# Skill Authoring Notes

Skills in this folder are operational workflow definitions, not passive prose.

## Minimum Structure

Every skill should include YAML frontmatter with at least:

- `name`
- `description`
- `argument-hint`
- `user-invocable`

Descriptions should use explicit trigger language such as `Use when...` so discovery remains reliable.

## Safety Rules

- Do not require a clean working tree as a default precondition. Record the baseline and avoid unrelated edits instead.
- Do not require commits, pushes, review replies, or conversation resolution unless the invoking task explicitly authorizes remote GitHub mutations.
- Keep validation scoped to the touched subsystem.
- Prefer structured outputs over vague summaries.

## Repository Expectations

- Respect repository instructions in `.github/copilot-instructions.md` and `AGENTS.md`.
- Treat Android as the primary real-device path unless the task says otherwise.
- When a workflow leaves unresolved items behind, document them explicitly instead of implying completion.
