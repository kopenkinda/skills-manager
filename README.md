# Skills Manager

Native macOS app for inspecting and managing local agent skills.

This is vibecoded slop, but it works for me.

## What It Does

- Shows project, global, and system skills
- Enables/disables writable skills by moving folders in/out of `.disabled`
- Keeps related skill symlinks aligned when toggling
- Deletes writable skills directly from disk and removes related symlinks
- Updates one project/global skill via `pnpx skills update`
- Updates all global skills
- Shows project-vs-global name conflicts, including disabled skills
- Lets disabled conflicting skills be enabled from the Conflicts tab
- Remembers the last 5 opened project folders

## Requirements

- macOS 14+
- Swift 6 toolchain
- `pnpx skills` available for update commands
- If using `fnm`, a default Node version configured

The app tries to run `pnpx` directly, then falls back to:

```sh
fnm exec --using default -- pnpx ...
```

## Run

```sh
swift run NativeSkillsManager
```

## Build

```sh
make build
```

## Create `.app`

```sh
make app
```

Output:

```sh
dist/Skills Manager.app
```

## Package Zip

```sh
make package
```

Output:

```sh
dist/Skills Manager.zip
```

## Install To Applications

```sh
make app-and-copy
```

This quits the running app, replaces `/Applications/Skills Manager.app`, copies with `ditto`, and verifies the code signature.

Install somewhere else:

```sh
make app-and-copy INSTALL_DIR="$HOME/Applications" SUDO=
```

## Clean

```sh
make clean
```

## Caveats

- The app is ad-hoc signed, not notarized.
- Token counts are estimates, not exact `js-tiktoken` counts.
- Delete does not call `skills remove`; it removes the skill folder and related symlinks directly.
- Update depends on `pnpx skills` resolving correctly in a GUI app environment.
- System skills are read-only.
- Conflict detection only checks project-vs-global name collisions.
- Packaging is a simple SwiftPM `.app` bundle, not an Xcode archive.
