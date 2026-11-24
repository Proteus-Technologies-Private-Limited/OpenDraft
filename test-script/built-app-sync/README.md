# Built-app cloud sync check

Drives the **production build**, served by the FastAPI backend, through device
project sync (#292) and offline cloud scripts (#291) in headless Chromium.

Only Tauri's IPC is simulated (`window.__TAURI_INTERNALS__`): HTTP goes to the
real backend and SQL to a real SQLite file the script can also edit, standing in
for changes made elsewhere. Data is synthetic and isolated; never point this at a
real account or backend.

```sh
cd frontend && npm run build && cd ..
rm -rf backend/static && cp -R frontend/dist backend/static      # backend/static is gitignored
./venv/bin/python test-script/browser-editing/server.py /tmp/od-state   # new dir; port 8137
./venv/bin/python test-script/built-app-sync/run.py http://127.0.0.1:8137 /tmp/od-state/auth.json
```

`discover.py` lists the IPC commands the app asks for, which is where to start if
a new native call makes the shim fall short. Screenshots go to
`test-script/output/built-app-sync/`.
