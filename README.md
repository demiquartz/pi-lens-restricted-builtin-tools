# pi-lens-restricted-builtin-tools extension

A pi extension that registers restricted versions of the built-in `write`, `read`, and `edit` tools (shadowing the built-ins) to complement [pi-lens](https://github.com/apmantza/pi-lens). It keeps file operations safe and confines each tool to the domain pi-lens does not cover. **It requires pi-lens**: `read`/`edit` reject the formats pi-lens handles, so without pi-lens there is no way to read or edit those files.

## Why

`pi-lens` owns code read/edit (`read_symbol`, `module_report`, `ast_grep_replace`), but it needs an anchor point to edit — a file that does not exist yet, or an empty file, gives it nothing to anchor on. `write` therefore accepts **any format**: it is the only way to create new files and bootstrap empty ones. It can only overwrite files with fewer than 64 lines (a simple proxy for "fits in the context"), because regenerating a larger file in one pass would exceed the context and cause omission damage; larger files must be edited incrementally. `read`/`edit` reject the formats pi-lens supports, so code reading and editing goes through pi-lens rather than a low-friction text fallback.

## Tools

| Tool | Scope | Notes |
|------|-------|-------|
| `write` | Any format | Creates new files, or overwrites existing files with fewer than 64 lines (the bootstrap path; larger files are edited incrementally) |
| `read` | Non-lens formats only | Reads prose/config; rejects tree-sitter languages (use `read_symbol`/`module_report`) |
| `edit` | Non-lens formats only | Exact text replacement; rejects ast-grep languages (use `ast_grep_replace`) |

## Safety

All tools are confined to the workspace — these guarantees hold only while `bash` is disabled (i.e. running with `--no-builtin-tools`); running with `bash` available (e.g. via `--exclude-tools`) is outside these guarantees.

| Behavior | Result |
|----------|--------|
| Absolute path (`/tmp/foo.txt`) | Fails (relative paths only) |
| `~`-prefixed path (`~/foo.txt`) | Fails (relative paths only) |
| `..` segments (`../foo.txt`) | Fails |
| Trailing slash (`foo/`) | Fails (files only) |
| Resolves outside the workspace (including via symlinks) | Fails |

`write` additionally:
- Creates parent directories recursively
- Overwrites an existing file only if it has fewer than 64 lines
- Fails if the path exists as a file with 64+ lines or as a directory — larger files are edited incrementally (`edit` for prose, `ast_grep_replace` for code)

`read`/`edit` additionally:
- Reject files in pi-lens-supported formats (code, JSON, YAML), pointing to pi-lens

`edit` additionally:
- Each `oldText` must match uniquely in the file
- Edits must not overlap

## pi-lens-supported formats (rejected by `read`/`edit`)

`read` and `edit` reject **different** sets, because pi-lens reads and edits via different mechanisms:

- **`read`** rejects the languages pi-lens parses with **tree-sitter** — what `read_symbol`/`module_report` can read. Source: pi-lens's `scripts/download-grammars.ts` grammar set.
- **`edit`** rejects the languages `ast_grep_replace` can edit — what **ast-grep** supports.

The sets differ: ast-grep supports `nix`/`scala`/`haskell` (no tree-sitter grammar in pi-lens, so `read` accepts them) but not `toml`/`vue`/`ocaml`/`cue`/`groovy` (which have tree-sitter grammars, so `edit` accepts them). Every rejected format has a working pi-lens counterpart, so there is no dead end.

**`read` rejects (tree-sitter):**
`sh` `bash` `zsh` `ksh` `c` `h` `cpp` `cc` `cxx` `hpp` `hxx` `cs` `css` `dart` `ex` `exs` `go` `html` `htm` `java` `js` `mjs` `cjs` `jsx` `json` `kt` `kts` `lua` `ml` `mli` `php` `py` `rb` `rs` `swift` `toml` `tsx` `ts` `vue` `yaml` `yml` `zig` `cue` `groovy`

**`edit` rejects (ast-grep):**
`sh` `bash` `zsh` `ksh` `c` `h` `cpp` `cc` `cxx` `hpp` `hxx` `cs` `css` `dart` `ex` `exs` `go` `hs` `html` `htm` `java` `js` `mjs` `cjs` `jsx` `json` `kt` `kts` `lua` `nix` `php` `py` `rb` `rs` `scala` `swift` `tsx` `ts` `yaml` `yml` `zig`

Both lists are snapshots — update them when pi-lens or ast-grep adds a language.

## Installation

Place it in a location where it is discovered automatically:

```bash
# All projects
mkdir -p ~/.pi/agent/extensions && cp /path/to/pi-lens-restricted-builtin-tools/index.ts ~/.pi/agent/extensions/pi-lens-restricted-builtin-tools.ts

# Target project only (run from the project root)
mkdir -p .pi/extensions && cp /path/to/pi-lens-restricted-builtin-tools/index.ts .pi/extensions/pi-lens-restricted-builtin-tools.ts
```

To load it temporarily for testing:

```bash
pi -e /path/to/pi-lens-restricted-builtin-tools/index.ts
```

Run with `pi --no-builtin-tools`. The extension's `write`/`read`/`edit` already shadow the built-ins by name; what the flag actually disables is `bash`, which would otherwise bypass every path, line-count, and format rule via `cat`/`sed`/`tee`. So the flag is **required**, not optional. (pi-lens does not depend on the `bash` tool — it launches its LSP servers and `ast-grep` directly — so disabling it is safe.)

## License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](LICENSE) file for details.
