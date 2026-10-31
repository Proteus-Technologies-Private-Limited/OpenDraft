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

!macro NSIS_HOOK_PREINSTALL
!macroend
!macro NSIS_HOOK_POSTINSTALL
  !insertmacro OpenDraftRegisterAlternative fdx
  !insertmacro OpenDraftRegisterAlternative fadein
  !insertmacro OpenDraftRegisterAlternative fountain
  !insertmacro OpenDraftRegisterAlternative osf
  !insertmacro OpenDraftRegisterAlternative highland
  !insertmacro OpenDraftRegisterAlternative wdz
  !insertmacro OpenDraftRegisterAlternative celtx
!macroend
!macro NSIS_HOOK_PREUNINSTALL
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
