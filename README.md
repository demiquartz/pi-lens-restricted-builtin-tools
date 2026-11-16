# pi-lens-restricted-builtin-tools extension

A pi extension that registers restricted versions of the built-in `write`, `read`, and `edit` tools (shadowing the built-ins) to complement [pi-lens](https://github.com/). It keeps file operations safe and confines each tool to the domain pi-lens does not cover.

## Why

`pi-lens` owns code read/edit (`read_symbol`, `module_report`, `ast_grep_replace`), but it needs an anchor point to edit — a file that does not exist yet, or an empty file, gives it nothing to anchor on. `write` therefore accepts **any format**: it is the only way to create new files and bootstrap empty ones. It can only overwrite files with fewer than 64 lines (a simple proxy for "fits in the context"), because regenerating a larger file in one pass would exceed the context and cause omission damage; larger files must be edited incrementally. `read`/`edit` reject the formats pi-lens supports, so code reading and editing goes through pi-lens rather than a low-friction text fallback.

## Tools

| Tool | Scope | Notes |
|------|-------|-------|
| `write` | Any format | Creates new files, or overwrites existing files with fewer than 64 lines (the bootstrap path; larger files are edited incrementally) |
| `read` | Non-lens formats only | Reads prose/config; rejects code/JSON/YAML (use `read_symbol`/`module_report`) |
| `edit` | Non-lens formats only | Exact text replacement; rejects code/JSON/YAML (use `ast_grep_replace`) |

## Safety

All tools are confined to the workspace.

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

`sh` `bash` `zsh` `ksh` `c` `h` `cpp` `cc` `cxx` `hpp` `hxx` `cs` `css` `ex` `exs` `go` `hs` `html` `htm` `java` `js` `mjs` `cjs` `json` `kt` `kts` `lua` `nix` `php` `py` `rb` `rs` `scala` `swift` `tsx` `ts` `yaml` `yml`

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

Run with `pi --no-builtin-tools` so the built-in `write`/`read`/`edit` are disabled and these restricted tools (plus pi-lens) are the only file-operation paths.

## License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](LICENSE) file for details.
