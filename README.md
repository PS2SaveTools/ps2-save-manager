# PS2 Save Manager

PS2 Save Manager is a Dockerised web-based tool for managing and converting
PS2 save files across the multitude of formats available.

A large number of the tools published on [PS2 Save Tools](https://www.ps2savetools.com)
during the PS2 era are Windows-based and some require compatibility settings
before they will run. This project provides a web-based utility that can run
wherever Docker is available and offers the core capabilities of PS2 Save
Builder and PSV Exporter.

Its source code is public and a ready-made container image is also available:
`ghcr.io/ps2savetools/ps2savemanager:latest`.

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
docker pull ghcr.io/ps2savetools/ps2savemanager:latest
docker run --rm -p 8080:80 ghcr.io/ps2savetools/ps2savemanager:latest
```

Open `http://localhost:8080` after starting the container.

## Licence

The application source is available under the [MIT Licence](LICENSE).
