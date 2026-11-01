; #179: third-party formats are Open With candidates, never default associations.
!macro OpenDraftRegisterAlternative EXT
  WriteRegStr SHCTX "Software\Classes\OpenDraft.Alternative.${EXT}" "" "${PRODUCTNAME} ${EXT} document"
  WriteRegStr SHCTX "Software\Classes\OpenDraft.Alternative.${EXT}\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "OpenDraft.Alternative.${EXT}" ""
!macroend

!macro OpenDraftUnregisterAlternative EXT
  Push $R8
  ReadRegStr $R8 SHCTX "Software\Classes\OpenDraft.Alternative.${EXT}\shell\open\command" ""
  ${If} $R8 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
    DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "OpenDraft.Alternative.${EXT}"
    DeleteRegKey SHCTX "Software\Classes\OpenDraft.Alternative.${EXT}"
  ${EndIf}
  Pop $R8
!macroend

; #179: OpenDraft 2.8.0 and earlier registered every supported extension with
; Tauri's APP_ASSOCIATE, under a class named after the extension itself (".txt"
; -> class "txt"), making OpenDraft the default and keeping the previous
; default in "<ext>_backup". An update (/UPDATE, the auto-updater's path) or a
; reinstall that keeps the old version never runs the old uninstaller, so those
; registrations outlived the change that stopped making them. This puts the
; previous default back and removes the old class — only where the class's
; open command is still exactly the one that installer wrote for this copy of
; OpenDraft, so another application's class of the same name is left alone.
!macro OpenDraftRemoveLegacyAssociation EXT WINDOWSDEFAULT
  Push $R0
  Push $R1
  Push $R2
  ReadRegStr $R0 SHCTX "Software\Classes\${EXT}\shell\open\command" ""
  ${If} $R0 == '$INSTDIR\${MAINBINARYNAME}.exe $\"%1$\"'
    ReadRegStr $R1 SHCTX "Software\Classes\.${EXT}" ""
    ${If} $R1 == "${EXT}"
      ReadRegStr $R2 SHCTX "Software\Classes\.${EXT}" "${EXT}_backup"
      ; A reinstall over itself backed up OpenDraft's own class, losing the
      ; real previous default; fall back to Windows' own where it has one.
      ${If} $R2 == "${EXT}"
        StrCpy $R2 ""
      ${EndIf}
      ${If} $R2 == ""
        StrCpy $R2 "${WINDOWSDEFAULT}"
      ${EndIf}
      ${If} $R2 == ""
        DeleteRegValue SHCTX "Software\Classes\.${EXT}" ""
      ${Else}
        WriteRegStr SHCTX "Software\Classes\.${EXT}" "" "$R2"
      ${EndIf}
    ${EndIf}
    DeleteRegValue SHCTX "Software\Classes\.${EXT}" "${EXT}_backup"
    DeleteRegKey SHCTX "Software\Classes\${EXT}"
  ${EndIf}
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro OpenDraftRemoveLegacyAssociations
  !insertmacro OpenDraftRemoveLegacyAssociation fdx ""
  !insertmacro OpenDraftRemoveLegacyAssociation fadein ""
  !insertmacro OpenDraftRemoveLegacyAssociation fountain ""
  !insertmacro OpenDraftRemoveLegacyAssociation osf ""
  !insertmacro OpenDraftRemoveLegacyAssociation highland ""
  !insertmacro OpenDraftRemoveLegacyAssociation wdz ""
  !insertmacro OpenDraftRemoveLegacyAssociation celtx ""
  !insertmacro OpenDraftRemoveLegacyAssociation txt "txtfile"
  ; Tell Explorer the associations changed.
  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
!macroend

!macro NSIS_HOOK_PREINSTALL
!macroend
!macro NSIS_HOOK_POSTINSTALL
  !insertmacro OpenDraftRemoveLegacyAssociations
  !insertmacro OpenDraftRegisterAlternative fdx
  !insertmacro OpenDraftRegisterAlternative fadein
  !insertmacro OpenDraftRegisterAlternative fountain
  !insertmacro OpenDraftRegisterAlternative osf
  !insertmacro OpenDraftRegisterAlternative highland
  !insertmacro OpenDraftRegisterAlternative wdz
  !insertmacro OpenDraftRegisterAlternative celtx
!macroend
!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro OpenDraftRemoveLegacyAssociations
  !insertmacro OpenDraftUnregisterAlternative fdx
  !insertmacro OpenDraftUnregisterAlternative fadein
  !insertmacro OpenDraftUnregisterAlternative fountain
  !insertmacro OpenDraftUnregisterAlternative osf
  !insertmacro OpenDraftUnregisterAlternative highland
  !insertmacro OpenDraftUnregisterAlternative wdz
  !insertmacro OpenDraftUnregisterAlternative celtx
!macroend
!macro NSIS_HOOK_POSTUNINSTALL
!macroend
