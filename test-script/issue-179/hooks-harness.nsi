; Runs src-tauri/nsis-hooks.nsh's install or uninstall hooks on their own, as
; Tauri's installer.nsi would (SetShellVarContext all for perMachine, same
; $INSTDIR), for test-script/test_issue_179_nsis_upgrade.sh.
; Build with -DHOOK=POSTINSTALL or -DHOOK=PREUNINSTALL.
Unicode true
!include LogicLib.nsh
!define MAINBINARYNAME "opendraft"
!define PRODUCTNAME "OpenDraft"
!include "nsis-hooks.nsh"
Name "OpenDraft hooks ${HOOK}"
OutFile "hook-${HOOK}.exe"
RequestExecutionLevel admin
InstallDir "C:\Program Files\OpenDraft"
SilentInstall silent
Section
  SetShellVarContext all
  !insertmacro NSIS_HOOK_${HOOK}
SectionEnd
