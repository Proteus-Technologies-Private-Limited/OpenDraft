# build-plugins/

Release CI checks out add-ons from other repositories here, and every
platform's build compiles them in through `OPENDRAFT_PLUGINS`
(`frontend/vite.plugins.ts`). This covers the desktop apps, Android, iOS, the
Mac App Store and the web app in the Docker image.

- `OD-Sidekick/`: <https://github.com/Proteus-Technologies-Private-Limited/OD-Sidekick>,
  at the commit the release workflow's plan job pins.

Everything here except this file is git-ignored. Nothing in this folder is
built unless `OPENDRAFT_PLUGINS` names it, so local builds are unchanged. To
build the release set locally:

```bash
git clone https://github.com/Proteus-Technologies-Private-Limited/OD-Sidekick build-plugins/OD-Sidekick
cd frontend && OPENDRAFT_PLUGINS=../build-plugins/OD-Sidekick/src/register.ts npm run build
```

`Dockerfile.combined` copies this folder into its frontend build stage, so the
web build sees the same paths. This file keeps the folder in the Docker build
context even when no add-on is checked out.
