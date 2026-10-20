# @citisen/dsh-plugin-dev

Development kit for [DeepSeek Harness](https://github.com/deepseek-ai) (`dsh`)
plugins: a small CLI for the parts that must be deterministic, and a bundled
agent skill for the judgment in between.

Most dsh plugin failures are not code failures. They are **composition** failures
(a row that does not resolve, a patch that replaces a whole `config`, a provider
id that collides) or **client half** failures (a bundle that never mounts). None
of those show up in a unit test, and all of them cost an afternoon when the only
feedback is a broken app.

```sh
dsh-plugin-dev doctor                              # what this machine can test
dsh-plugin-dev compose --profile desktop --json    # the tree the launcher would mount
dsh-plugin-dev shadow  --from desktop --hold       # boot a throwaway copy, print url + token
dsh-plugin-dev shot    --url "$URL" --out shot.png # render it, capture console errors
dsh-plugin-dev snapshot save --profile desktop     # something to go back to
```

## Why a package and not a script

`dsh` is an order of magnitude easier to develop against when the loop is:
compose → diff → boot → look. That loop is four commands, and each of them is
fiddly in a way that should be solved once:

- the desktop profile is **refused** by the CLI ("managed exclusively by the
  Electron application"), so every check needs a copy;
- the GUI answers **401 without its token**, and readiness is a `303` token
  exchange, not a `200`;
- `chrome --headless --screenshot` **hangs forever** on the SPA;
- a `link:` dependency that a package manager replaces can delete the linked
  worktree, `.git` included.

The commands encode those; the skill explains when to use which, and why.

## Install

As a bundle, so the agent gets the skill (recommended):

```sh
dsh plugin --profile desktop add @citisen/dsh-plugin-dev
```

The package registers a skill provider, so `dsh-plugin-dev` appears in the agent
catalog. No other profile row is touched, and disabling the bundle removes it
again.

Standalone, for the CLI without the skill:

```sh
npx @citisen/dsh-plugin-dev doctor
# or
npm i -g @citisen/dsh-plugin-dev
```

## Commands

| Command | What it does |
| --- | --- |
| `doctor` | Detects the launcher and its version, lists profiles, checks whether the chosen profile composes, finds a Chromium |
| `compose` | Composes a profile through the real launcher. `--save` records a baseline, `--check` exits 1 on drift, `--json` lists entries and duplicate ids |
| `shadow` | Copies a profile (files copied, `node_modules` linked), boots it on an OS-assigned port, waits for the URL, probes it, prints url/token/log |
| `shot` | Renders a URL in headless Chromium over CDP: PNG, DOM stats, console errors and uncaught exceptions. `--fail-on-console-error` makes them fatal |
| `snapshot` | Saves, lists and restores the three files that decide a profile's composition. `restore` snapshots the current state first |

Common flags: `--dsh <path>`, `--json`, `--help`.

## Requirements

- `dsh` — the desktop application (the bundled CLI is found automatically), the
  published CLI on `PATH`, or `--dsh <path>` / `$DSH_CLI`.
- Node 20+ for the CLI.
- Chromium, Chrome or Edge for `shot` (found automatically; `--browser <path>` or
  `CHROME_PATH` otherwise).
- Windows, macOS and Linux. The desktop app is optional: any `dsh` works.

## How it works

Nothing is reimplemented. `compose` runs `dsh --profile <p> --dump-config` and
diffs that text; `shadow` runs `dsh --profile <copy> --no-open --port 0` and reads
the URL the launcher prints; `shot` drives the browser over the DevTools protocol
and nothing else. When the launcher refuses the desktop profile, `compose` and
`shadow` build a temporary copy under another name — the same workaround a person
would do by hand.

The host half is deliberately trivial: it reads `skills/dsh-plugin-dev/SKILL.md`
and registers one skill provider. It cannot fail a profile boot.

## Version support

Tested with `dsh 0.2.1-rc.2` on Windows 11 (Electron 44 / Node 24.21). The kit
shells out to the launcher, so a version that changes `--dump-config`, the
`dsh web:` boot line, or the desktop-profile policy will surface as a loud error
from `doctor` rather than a silent wrong answer. Please open an issue with the
`doctor --json` output.

## Contributing

The trap list is the product. See [CONTRIBUTING.md](CONTRIBUTING.md) — the short
version is: a step becomes a script on its second manual repetition, and a bug
report becomes an entry in
[`skills/dsh-plugin-dev/references/traps.md`](skills/dsh-plugin-dev/references/traps.md).

## License

MIT
