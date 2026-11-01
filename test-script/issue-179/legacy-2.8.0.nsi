; Recreates the registry a 2.8.0 install left behind (#179), for
; test-script/test_issue_179_nsis_upgrade.sh. Uses Tauri 2.11.4's own
; FileAssociation.nsh and the exact APP_ASSOCIATE call its installer.nsi
; expands to for each association (no "name", so the class is the extension).
Unicode true
!include LogicLib.nsh
!include "FileAssociation.nsh"
!define MAINBINARYNAME "opendraft"
!define PRODUCTNAME "OpenDraft"
Name "OpenDraft 2.8.0 registry state"
OutFile "legacy-2.8.0.exe"
RequestExecutionLevel admin
InstallDir "C:\Program Files\OpenDraft"
SilentInstall silent

!macro Associate2_8_0 EXT DESC
  !insertmacro APP_ASSOCIATE "${EXT}" "${EXT}" "${DESC}" "$INSTDIR\${MAINBINARYNAME}.exe,0" "Open with ${PRODUCTNAME}" "$INSTDIR\${MAINBINARYNAME}.exe $\"%1$\""
!macroend

Section
  SetShellVarContext all
  ; Before OpenDraft: Windows' own .txt, and Final Draft owning .fdx.
  WriteRegStr SHCTX "Software\Classes\.txt" "" "txtfile"
  WriteRegStr SHCTX "Software\Classes\.fdx" "" "FinalDraft.Document"
  WriteRegStr SHCTX "Software\Classes\FinalDraft.Document\shell\open\command" "" '"C:\FinalDraft\FinalDraft.exe" "%1"'

  ; The 2.8.0 install.
  !insertmacro Associate2_8_0 "fdx" "Final Draft Screenplay"
  !insertmacro Associate2_8_0 "fountain" "Fountain Screenplay"
  !insertmacro Associate2_8_0 "fadein" "Fade In Screenplay"
  !insertmacro Associate2_8_0 "highland" "Highland Screenplay"
  !insertmacro Associate2_8_0 "wdz" "WriterDuet Screenplay"
  !insertmacro Associate2_8_0 "celtx" "Celtx Project"
  !insertmacro Associate2_8_0 "osf" "Open Screenplay Format"
  !insertmacro Associate2_8_0 "odraft" "OpenDraft Screenplay"
  !insertmacro Associate2_8_0 "txt" "Text File"
  ; Reinstalling 2.8.0 over itself ran APP_ASSOCIATE again, so .txt's backup
  ; now names OpenDraft's own class and Windows' "txtfile" is lost.
  !insertmacro Associate2_8_0 "txt" "Text File"

  ; Since then another application took the class called "celtx" for itself.
  WriteRegStr SHCTX "Software\Classes\celtx\shell\open\command" "" '"C:\Celtx\Celtx.exe" "%1"'
SectionEnd
