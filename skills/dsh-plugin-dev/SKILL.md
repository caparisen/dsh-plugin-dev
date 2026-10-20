---
name: dsh-plugin-dev
description: Build, verify and debug DeepSeek Harness (dsh) plugin bundles against a real profile — compose the tree, boot a throwaway shadow, check the host half, capture the client half, and roll back a broken profile. Use when adding, changing or troubleshooting a dsh plugin, bundle, profile patch, or client-side plugin.
whenToUse: A dsh plugin or bundle is being created or changed, a profile patch no longer composes, or a client-side plugin does not appear in the UI.
---

# Developing a dsh plugin

`dsh` is a Cordis tree composed from layered patches: bundle patches, then the
profile's own `cordis.patch.yml`, then overlays. Most plugin failures are not
code failures — they are *composition* failures (a row that does not resolve, a
patch that replaces a whole `config`, a provider id that collides) or *client
half* failures (a bundle that never mounts). The commands below turn each of
those into an exit code.

Start with `dsh-plugin-dev doctor`. It reports the launcher and its version, the
profiles on disk, whether the chosen profile can be composed, and the browser a
render check would use.

## Surfaces and gates

| Surface | Gate | Proves |
| --- | --- | --- |
| Package / bundle | `dsh plugin … add` then `doctor` | the package resolves as a bundle and is selected in `dsh.profile.bundles` |
| Composition | `compose --save` / `--check` | the patch layers produce the tree you think, and nothing silently replaced a row |
| Host half | `shadow --from …` | the profile boots, every enabled entry activates, `apply()` ran |
| Client half | `shot --url …` | the browser bundle loads, mounts, renders, and logs no error |
| Recovery | `snapshot save` / `restore` | a broken profile can be put back without the app |

## Decision table

| The change touches | Run |
| --- | --- |
| a `cordis.patch.yml`, a bundle patch, row ids or config | `compose --save` before, `compose --check` after |
| a host plugin's `apply`, `inject`, service registration | `shadow` and read its log |
| a client bundle (`lib/client.js`, UI, styles) | `shadow --hold` + `shot` |
| `package.json` (`dsh.bundle`, `main`, `files`) | `doctor`, then `shadow` |
| install / link mechanics | `doctor` + `shadow` |
| a profile that no longer boots | `snapshot restore` |

## Recipes

### 1. See the composition, and what your patch changed

```sh
dsh-plugin-dev compose --profile <profile> --json
dsh-plugin-dev compose --profile <profile> --save dev/composition.json   # baseline you trust
dsh-plugin-dev compose --profile <profile> --check dev/composition.json  # exit 1 on drift
```

The desktop profile is managed exclusively by the Electron application, so the
CLI refuses it. `compose` detects that refusal and composes a temporary copy
instead; `--json` reports `copiedFrom`. Use `--copy` to force that path.

`--check` is the fastest guard against the classic trap: a patch replaces the
targeted row's **entire** `config`, so `- id: web` with only `fetchProvider` set
deletes `searchProvider`. The diff shows the removed keys.

### 2. Boot a throwaway profile

```sh
dsh-plugin-dev shadow --from <profile> --hold        # prints url + token, ctrl-c cleans up
dsh-plugin-dev shadow --from <profile> --json       # boot, probe, tear down, print result
```

The command copies `package.json`, `cordis.yml` and `cordis.patch.yml`, **links**
the source `node_modules` (no copy), boots on an OS-assigned port, waits for the
launcher's `dsh web: <url>` line, probes the token exchange, and removes the copy
it made. A profile it did not create is never overwritten.

The shadow shares `$DSH_HOME`, so it sees the real sessions and settings. That is
useful for realism and fatal for reproducibility: seed or dismiss first-run
surfaces before you compare screenshots.

### 3. Check the host half

The shadow boot **is** the gate: if `apply()` throws, the entry fails and the log
names it. Read the `log` path printed by `shadow`. A plugin that registers a
provider, tool, command or route should log one line at startup so the gate has
something to show; a startup self-test that exercises its own surface is worth
more than a unit test.

### 4. Render the client half

```sh
dsh-plugin-dev shadow --from <profile> --hold --json   # keep the url
dsh-plugin-dev shot --url "$URL" --out dev/shots/<scene>.png \
  --scheme dark --wait-selector '<css>' --fail-on-console-error --json
```

`shot` drives Chromium over the DevTools protocol. A plain
`chrome --headless --screenshot` **hangs forever** on this app: the shell keeps a
websocket open and Chrome's virtual-time budget never expires. The command waits
for `document.readyState`, a DOM node count, visible text, and an optional
selector, then settles.

`--fail-on-console-error` turns a client plugin that throws during activation
into a failing exit code — the single most valuable check for any UI plugin. The
PNG is an artifact for a human; the console log is the machine-checkable part.

For a visual change, a human must look at the PNG. The tool cannot judge taste,
and a theming change is not done until someone has looked.

### 5. Roll back

```sh
dsh-plugin-dev snapshot save --profile <profile>
dsh-plugin-dev snapshot list --profile <profile>
dsh-plugin-dev snapshot restore --profile <profile> --from <id>
```

`restore` always writes a `prerestore` snapshot first, so a rescue is itself
reversible. It works with the application closed.

## Stop conditions

- Do not promote a patch you have not composed with `--check`.
- Do not edit the profile the application is running: copy → verify → promote.
- Never run `pnpm add`/`install` in a profile whose `link:` dependency points at
  a git worktree; pnpm removes through the link and can delete the target.
- Do not screenshot a profile you have not seeded; first-run modals and the
  user's own sessions are in the picture.
- Do not report success from a PNG alone; check the console log too.

## Traps

The full list, with symptoms and fixes, is in
[references/traps.md](references/traps.md). The three that bite most often:

1. A patch **replaces** the targeted row's whole `config` — restate every key.
2. Provider, tool and command ids are unique per registry; a duplicate fails the
   entry (`WEB_DUPLICATE_PROVIDER`), not the whole app.
3. `lib/client.js` is what the browser loads; if only `src/` changed, the UI is
   stale and nothing tells you.

## Done looks like

1. `compose --check` passes, or the diff is exactly the change you meant.
2. `shadow` boots and its log contains no failed entry.
3. `shot` renders with zero console errors.
4. A human has looked at the PNG if the change is visual.
5. A pre-change `snapshot` exists.
