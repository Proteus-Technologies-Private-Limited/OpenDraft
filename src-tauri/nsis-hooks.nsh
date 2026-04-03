; OpenDraft NSIS Installer Hooks
; Automatically handles prerequisites and security configuration
; so end users don't need to do anything manually.

!macro NSIS_HOOK_PREINSTALL
  ; ── Add Windows Defender exclusion BEFORE files are copied ──
  ; This prevents Defender from quarantining sidecar DLLs during installation.
  ; Use PowerShell Add-MpPreference (the officially supported API) because
  ; direct registry writes are blocked by Tamper Protection on modern Windows.
  ; We write a temp .ps1 script to avoid NSIS/PowerShell quoting issues.
  DetailPrint "Configuring Windows Defender exclusion..."
  FileOpen $R0 "$TEMP\od_defender_setup.ps1" w
  FileWrite $R0 "try { Add-MpPreference -ExclusionPath '$INSTDIR' -ErrorAction Stop } catch {}$\r$\n"
  FileWrite $R0 "try { $$p = Join-Path $$env:LOCALAPPDATA 'com.proteus.opendraft\sidecar'; Add-MpPreference -ExclusionPath $$p -ErrorAction Stop } catch {}$\r$\n"
  FileClose $R0
  ExecWait 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$TEMP\od_defender_setup.ps1"' $R0
  DetailPrint "Defender exclusion result: $R0"
  Delete "$TEMP\od_defender_setup.ps1"
  ; Fallback: also try the registry approach for older Windows versions
  ExecWait 'reg add "HKLM\SOFTWARE\Microsoft\Windows Defender\Exclusions\Paths" /v "$INSTDIR" /t REG_DWORD /d 0 /f' $R0
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; ── Install Visual C++ 2015-2022 Redistributable (x64) if needed ──
  ; Python 3.12 requires this runtime. Without it, python312.dll fails to load.
  ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" "Installed"
  ${If} $R0 != "1"
    IfFileExists "$INSTDIR\vc_redist.x64.exe" 0 vcredist_done
      DetailPrint "Installing Microsoft Visual C++ Redistributable..."
      ExecWait '"$INSTDIR\vc_redist.x64.exe" /install /quiet /norestart' $R1
      DetailPrint "Visual C++ Redistributable installed (exit code: $R1)"
    vcredist_done:
  ${Else}
    DetailPrint "Visual C++ Redistributable already installed."
  ${EndIf}

  ; Clean up — remove the redistributable from the install directory
  Delete "$INSTDIR\vc_redist.x64.exe"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Remove Windows Defender exclusions and AppData sidecar copy on uninstall
  FileOpen $R0 "$TEMP\od_defender_cleanup.ps1" w
  FileWrite $R0 "Remove-MpPreference -ExclusionPath '$INSTDIR' -ErrorAction SilentlyContinue$\r$\n"
  FileWrite $R0 "$$p = Join-Path $$env:LOCALAPPDATA 'com.proteus.opendraft'$\r$\n"
  FileWrite $R0 "Remove-MpPreference -ExclusionPath (Join-Path $$p 'sidecar') -ErrorAction SilentlyContinue$\r$\n"
  FileWrite $R0 "Remove-Item $$p -Recurse -Force -ErrorAction SilentlyContinue$\r$\n"
  FileClose $R0
  ExecWait 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$TEMP\od_defender_cleanup.ps1"'
  Delete "$TEMP\od_defender_cleanup.ps1"
  ExecWait 'reg delete "HKLM\SOFTWARE\Microsoft\Windows Defender\Exclusions\Paths" /v "$INSTDIR" /f' $R0
!macroend
