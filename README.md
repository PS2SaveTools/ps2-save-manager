# PS2 Save Manager

PS2 Save Manager is a Dockerised web-based tool for managing and converting
PS2 save files across the multitude of formats available.

A large number of the tools published on [PS2 Save Tools](https://www.ps2savetools.com)
during the PS2 era are Windows-based and some require compatibility settings
before they will run. This project provides a web-based utility that can run
wherever Docker is available and offers the core capabilities of PS2 Save
Builder and PSV Exporter.

Its source code is public and a ready-made container image is also available:
`ghcr.io/ps2savetools/ps2-save-manager:latest`.

## AI disclaimer

This project was built with AI coding agents used to review existing source
code and documents found at [PS2 Save Tools](https://www.ps2savetools.com), as
well as to compare save files exported from PS2 Save Builder to maximise
compatibility.

## Running from source code

From the repository root:

```bash
docker compose up -d
```

That now installs dependencies in the container if needed and starts the Vite dev server automatically on `http://localhost:5173`.

The container keeps `node_modules` in the named Docker volume mounted at `/workspace/node_modules`.

## Running the Container image

```bash
docker pull ghcr.io/ps2savetools/ps2-save-manager:latest
docker run --rm -p 8080:80 ghcr.io/ps2savetools/ps2-save-manager:latest
```

Open `http://localhost:8080` after starting the container.


## Save file Notes

NPort `.npo` import and export are supported. Root/ID is derived from the NPO
filename, matching the original nPort application; the payload itself does not
store the save-directory name.

X-Port v1 `.xpo`/`.spo` import and export follow the layout documented in the
nPort format documentation. These are distinct from SharkPort `.md` files.
XPO/SPO is covered by structural and cross-format semantic round-trip
regression tests.

AR MAX Power Save `.pws`, SharkPort `.md`, and Xploder `.p2m` import and export
are supported. Their readers are verified against every corresponding golden
archive, and their writers are checked by semantic re-import across all 27
test cases.

## Licence

The application source is available under the [MIT Licence](LICENSE). No game
save data, third-party application source, or private validation corpus is
included in the public repository or container image.
