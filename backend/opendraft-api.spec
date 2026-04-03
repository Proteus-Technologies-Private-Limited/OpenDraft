# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the OpenDraft API sidecar binary."""

import os
import sys

block_cipher = None
IS_WINDOWS = sys.platform == 'win32'
ROOT = os.path.abspath(os.path.dirname(SPEC))

a = Analysis(
    [os.path.join(ROOT, 'desktop_entry.py')],
    pathex=[ROOT],
    binaries=[],
    datas=[
        # Bundle the built frontend (must run build.sh first)
        (os.path.join(ROOT, 'static'), 'static'),
    ],
    hiddenimports=[
        # FastAPI / Starlette internals
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        # App modules
        'app',
        'app.main',
        'app.config',
        'app.api',
        'app.api.auth',
        'app.api.scripts',
        'app.api.export',
        'app.api.projects',
        'app.api.versions',
        'app.api.assets',
        'app.models',
        'app.models.script',
        'app.schemas',
        'app.schemas.project',
        'app.schemas.script',
        'app.schemas.version',
        'app.services',
        'app.services.project_service',
        'app.services.script_service',
        'app.services.asset_service',
        'app.services.git_service',
        # Database / ORM
        'sqlalchemy.dialects.sqlite',
        # Crypto
        'passlib.handlers.bcrypt',
        'bcrypt',
        # Multipart uploads
        'multipart',
        # File handling
        'lxml',
        'lxml._elementpath',
        'screenplain',
        'fitz',
        # Git (pure Python)
        'dulwich',
        'dulwich.repo',
        'dulwich.objects',
        'dulwich.porcelain',
        'dulwich.diff_tree',
        'dulwich.patch',
        'dulwich.object_store',
        'dulwich.pack',
        'dulwich.index',
        'dulwich.walk',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

if IS_WINDOWS:
    # ── Windows: onedir mode ──────────────────────────────────────────────
    # Onefile mode extracts DLLs to %TEMP% on every launch, which Windows
    # Defender frequently blocks ("Invalid access to memory location").
    # Onedir keeps all files in the install directory — no temp extraction.
    #
    # IMPORTANT: strip=False and upx=False are critical on Windows.
    # The CI runner's `strip` is MinGW-based and corrupts MSVC-compiled DLLs
    # (python312.dll, vcruntime140.dll), causing LoadLibrary to fail with
    # "Invalid access to memory location". UPX can trigger similar issues.
    # contents_directory='.' flattens the layout so python312.dll is next to
    # the bootloader, avoiding DLL search path issues.
    exe = EXE(
        pyz,
        a.scripts,
        [],
        exclude_binaries=True,
        name='opendraft-api',
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=False,
        console=True,
        target_arch=None,
        contents_directory='.',
    )

    coll = COLLECT(
        exe,
        a.binaries,
        a.zipfiles,
        a.datas,
        strip=False,
        upx=False,
        name='opendraft-api',
    )
else:
    # ── macOS / Linux: onefile mode ───────────────────────────────────────
    # Single self-contained binary, simpler to bundle as Tauri sidecar.
    exe = EXE(
        pyz,
        a.scripts,
        a.binaries,
        a.zipfiles,
        a.datas,
        [],
        name='opendraft-api',
        debug=False,
        bootloader_ignore_signals=False,
        strip=True,
        upx=True,
        console=True,
        target_arch=None,
        codesign_identity=os.environ.get('CODESIGN_IDENTITY', None),
    )
