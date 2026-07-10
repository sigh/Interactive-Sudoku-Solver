# data/dev/ — scratch scripts for the Dev tab

Drop a sandbox script (`.js`) or a constraint file (`.iss`) in here and it shows
up in the puzzle selector's **Dev** tab — no `collections.js` entry, no
`name`/`solution`/`constraintTypes`, nothing to wire up. Click it to load into
the grid; click the `</>` icon (`.js` only) to open its source in the sandbox.

The Dev tab is hidden until this directory has at least one such file, so it
stays out of the way when unused.

This is a viewing shortcut for work in progress. When a script graduates to a
real example, move it to [`../scripts/`](../scripts/) and add a
[`../collections.js`](../collections.js) entry with its solution and tags.

Don't name a script with a leading underscore (`_foo.js`) — Jekyll treats
underscore-prefixed files as special and won't serve them.

## How the list is built

The Dev tab fetches `index.json`, which **Jekyll renders at build time** by
listing the `.js`/`.iss` files here. `jekyll serve` regenerates it whenever a
file is added or removed, so the tab stays in sync automatically.

If you serve the site without Jekyll (e.g. `python3 -m http.server`), `index.json`
won't be regenerated. In that case list the files by hand, or generate it:

```sh
ls data/dev/*.{js,iss} 2>/dev/null | xargs -n1 basename \
  | jq -R . | jq -sc . > data/dev/index.json
```

Everything except `index.json` and `README.md` is gitignored, so your scratch
scripts stay local.
