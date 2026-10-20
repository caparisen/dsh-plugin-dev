# Contributing

This package has one purpose: make the dsh plugin loop short and honest. Keep it
small enough that a stranger can read all of it in an afternoon.

## What belongs here

- A **gate** for a failure mode that a unit test cannot see: composition,
  activation, rendering, install, recovery.
- A **trap** in `skills/dsh-plugin-dev/references/traps.md`, written as symptom →
  why → do instead.
- A **decision** in `SKILL.md` that tells an agent which gate applies.

Not here: a plugin scaffold generator, a mock harness, a dashboard, a bundler.
Those either duplicate the launcher or drift away from it.

## The rule

**A step becomes a script on its second manual repetition, or the first time it
burns someone.** Everything else stays prose in the skill.

The reason is asymmetric: prose is cheap to change and impossible to verify;
scripts are deterministic and can gate CI. Only pay for the script when the step
has already cost you twice.

## Adding a trap

1. Reproduce it once, and note the exact command and the dsh version.
2. Add an entry to `references/traps.md` in this shape:

   ```
   ## <what you see>
   **Symptom** <the error or the silence>
   **Why** <the mechanism, one paragraph>
   **Do instead** <the command or patch that works>
   ```

3. If the trap can be detected, add the detection to a command and a line to
   `SKILL.md`'s decision table. If it cannot be detected, say so.

## Adding a command

- One file in `src/commands/`, exporting `summary` and `main(argv)`.
- Parse `--help` and `--json` in every command.
- Exit `1` for a failed gate, `0` for a clean run; never exit `0` for "unknown".
- Human output goes to stdout, diagnostics to stderr.
- No new dependencies. `node:` builtins only.
- Add the command to `bin/dsh-plugin-dev.mjs` and to the README table.
- A test that does not need `dsh` installed (help, argument errors, pure helpers).

## Review checklist

- [ ] `npm test` passes.
- [ ] `dsh-plugin-dev doctor` still finds a launcher on the reviewer's machine.
- [ ] The new command's failure path prints what to do next, not just what failed.
- [ ] No absolute paths are hard-coded; platform paths are candidates, not
  assumptions.
- [ ] `SKILL.md` stays short — long-tail detail belongs in `references/`.

## Versioning

`0.1.x` while the command set is settling. A change that alters a command's
output shape or exit code is a minor bump; adding a trap is a patch.
