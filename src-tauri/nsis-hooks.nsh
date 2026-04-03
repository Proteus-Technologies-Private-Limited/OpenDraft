; OpenDraft NSIS Installer Hooks
; Automatically handles prerequisites and security configuration
; so end users don't need to do anything manually.

!macro NSIS_HOOK_PREINSTALL
  ; ── Add Windows Defender exclusion BEFORE files are copied ──
  ; This prevents Defender from quarantining sidecar DLLs during installation.
  DetailPrint "Configuring Windows Defender exclusion..."
  ExecWait 'reg add "HKLM\SOFTWARE\Microsoft\Windows Defender\Exclusions\Paths" /v "$INSTDIR" /t REG_DWORD /d 0 /f' $R0
  ${If} $R0 == 0
    DetailPrint "Windows Defender exclusion added for $INSTDIR"
  ${Else}
    DetailPrint "Note: Could not add Defender exclusion (non-critical, code: $R0)"
  ${EndIf}
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
  ; Remove Windows Defender exclusion on uninstall
  ExecWait 'reg delete "HKLM\SOFTWARE\Microsoft\Windows Defender\Exclusions\Paths" /v "$INSTDIR" /f' $R0
!macroend
