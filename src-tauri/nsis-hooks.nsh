; OpenDraft NSIS Installer Hooks
; Handles security configuration for Windows installation.

!macro NSIS_HOOK_PREINSTALL
  ; ── Add Windows Defender exclusion BEFORE files are copied ──
  ; Prevents false-positive detections during installation.
  DetailPrint "Configuring Windows Defender exclusion..."
  FileOpen $R0 "$TEMP\od_defender_setup.ps1" w
  FileWrite $R0 "try { Add-MpPreference -ExclusionPath '$INSTDIR' -ErrorAction Stop } catch {}$\r$\n"
  FileClose $R0
  ExecWait 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$TEMP\od_defender_setup.ps1"' $R0
  DetailPrint "Defender exclusion result: $R0"
  Delete "$TEMP\od_defender_setup.ps1"
  ; Fallback: also try the registry approach for older Windows versions
  ExecWait 'reg add "HKLM\SOFTWARE\Microsoft\Windows Defender\Exclusions\Paths" /v "$INSTDIR" /t REG_DWORD /d 0 /f' $R0
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Remove Windows Defender exclusion on uninstall
  FileOpen $R0 "$TEMP\od_defender_cleanup.ps1" w
  FileWrite $R0 "Remove-MpPreference -ExclusionPath '$INSTDIR' -ErrorAction SilentlyContinue$\r$\n"
  FileWrite $R0 "$$p = Join-Path $$env:LOCALAPPDATA 'com.proteus.opendraft'$\r$\n"
  FileWrite $R0 "Remove-Item $$p -Recurse -Force -ErrorAction SilentlyContinue$\r$\n"
  FileClose $R0
  ExecWait 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$TEMP\od_defender_cleanup.ps1"'
  Delete "$TEMP\od_defender_cleanup.ps1"
  ExecWait 'reg delete "HKLM\SOFTWARE\Microsoft\Windows Defender\Exclusions\Paths" /v "$INSTDIR" /f' $R0
!macroend
