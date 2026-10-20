# Trap list

Each entry is a failure that costs time because the symptom does not name the
cause. Add one when it bites you: symptom first, so it can be found by search.

## The desktop profile cannot be composed or booted by the CLI

**Symptom** `error: profile "desktop" is managed exclusively by the Electron application`

**Why** The desktop profile is application-owned; the launcher refuses to touch it
outside the app, and that refusal is not a configuration error.

**Do instead** `compose` copies it automatically; otherwise `shadow --from desktop`
builds a copy under another name. `dsh plugin --profile desktop …` (package
management) is still allowed.

## A patch replaces the whole `config` of its row

**Symptom** A setting you never touched disappears after adding an override.

**Why** Patch entries replace the targeted row's entire `config`; they do not
merge key by key.

**Do instead** Restate every key the row owns. `compose --check` shows the removed
keys as `-` lines.

## Duplicate provider / tool / command ids fail the entry, not the app

**Symptom** `WEB_DUPLICATE_PROVIDER`, or a tool that suddenly reports
`WEB_PROVIDER_CONFIGURED_MISSING`, while the rest of the UI works.

**Why** Each registry rejects a duplicate id; the entry that registered second
fails, and the web service keeps its configured id, which may now point at
nothing.

**Do instead** Keep one owner per id. When replacing a built-in provider, disable
its row and register the same id from your bundle, or register a new id and pin
the consuming config to it.

## Enabled entry that never activates is a boot failure

**Symptom** `Failed to load plugins` / `N entries did not activate` /
`<plugin>: pending (waiting for service: …)` and the app refuses to start.

**Why** Fail-loud boot is deliberate: an enabled row that stays pending is treated
as a startup failure, unlike a row that is simply disabled.

**Do instead** Fix the injected service name, or disable the row from the profile
patch. Hot reload is gentler than a cold boot — a failed replacement rolls back.

## HMR does not watch source by default

**Symptom** You edit the plugin, nothing changes, no error.

**Why** The base `hmr` row ships `root: []`; module watching is opt-in, so only
profile configuration reloads.

**Do instead** In the profile patch:

```yaml
- id: hmr
  config:
    root: ["."]
```

## `lib/client.js` is what the browser loads

**Symptom** The UI still shows the old behaviour after a source edit; no error
anywhere.

**Why** Client bundles are built artifacts. Only `lib/` is served; a stale bundle
silently renders the previous version.

**Do instead** Rebuild the client half, then reload the window. Assert the
bundle's mtime or hash before capturing a screenshot.

## The GUI answers 401 without its token

**Symptom** A direct request to the served URL returns 401; a browser opened
without the token shows nothing useful.

**Why** The launcher prints `dsh web: http://127.0.0.1:<port>/?token=…`; the token
is exchanged for an auth cookie (303 + `Set-Cookie`).

**Do instead** Take the whole URL from the boot line. Readiness means "the
listener answered the token exchange" (status < 400), not "200".

## `chrome --headless --screenshot` never returns

**Symptom** The command hangs indefinitely on a dsh GUI URL.

**Why** The shell keeps a websocket open; Chrome's virtual-time budget never
expires, so the screenshot never triggers.

**Do instead** Drive CDP (`Page.captureScreenshot`) with an explicit readiness
predicate, as `shot` does.

## Screenshots are not reproducible without seeding state

**Symptom** Every capture differs: a welcome modal, a different session list, a
different palette.

**Why** The shadow shares `$DSH_HOME` (sessions, settings), and the browser starts
with an empty profile (first-run surfaces). `prefers-color-scheme` also leaks in
from the host.

**Do instead** Seed or dismiss first-run surfaces with scripted steps, force the
scheme (`Emulation.setEmulatedMedia`), pin the viewport, and use a persistent
browser profile directory for repeatable shots.

## pnpm removes through a `link:` dependency

**Symptom** Files inside the linked package directory disappear — including
`.git` — when the dependency is replaced or reinstalled.

**Why** A `link:` dependency is a directory junction/symlink into your working
tree; replacing it removes what it points at.

**Do instead** Link by hand (`mklink /J`, `ln -s`) and add the bundle entry
yourself, or install a published version. Never let a package manager replace a
link whose target is a git worktree.

## A cross-drive `link:` resolves to a non-existent path on Windows

**Symptom** The bundle is installed but never loads; reconciliation says the
package does not declare `dsh.bundle`.

**Why** pnpm can record a relative link that does not resolve across drives.

**Do instead** Create the junction yourself and add the bundle name to
`dsh.profile.bundles`.

## `dsh plugin add` reconciles bundles only for real bundles

**Symptom** The package is in `dependencies` but its row never appears.

**Why** Only packages declaring `dsh.bundle.patch` are appended to
`dsh.profile.bundles`.

**Do instead** Declare `dsh.bundle.patch` in `package.json`, or add the bundle name
by hand.

## A skill must be discovered, not merely shipped

**Symptom** A package ships `SKILL.md` but the agent never sees the skill.

**Why** Discovery scans `<projectRoot>/.dsh/skills`, `<projectRoot>/.agents/skills`,
`$DSH_HOME/skills`, `~/.agents/skills`, one level deep — nested `**/SKILL.md` is
ignored. Installed packages are not scanned.

**Do instead** Register a provider from the package (`ctx.skills.registerProvider`)
as this package does, or place the bundle directly under a scanned root.
