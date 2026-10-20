; Register Limbo as an available PDF reader without writing .pdf's default
; value or Windows' protected UserChoice. These are per-user registrations.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Limbo.PDF" "" "PDF document"
  WriteRegStr HKCU "Software\Classes\Limbo.PDF" "FriendlyTypeName" "PDF document"
  WriteRegStr HKCU "Software\Classes\Limbo.PDF\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr HKCU "Software\Classes\Limbo.PDF\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr HKCU "Software\Classes\.pdf\OpenWithProgids" "Limbo.PDF" ""
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "Limbo"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".pdf" ""
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr HKCU "Software\Limbo\Capabilities" "ApplicationName" "Limbo"
  WriteRegStr HKCU "Software\Limbo\Capabilities" "ApplicationDescription" "A quieter place to read PDFs"
  WriteRegStr HKCU "Software\Limbo\Capabilities\FileAssociations" ".pdf" "Limbo.PDF"
  WriteRegStr HKCU "Software\RegisteredApplications" "Limbo" "Software\Limbo\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "Limbo.PDF"
  DeleteRegKey /ifempty HKCU "Software\Classes\.pdf\OpenWithProgids"
  DeleteRegKey HKCU "Software\Classes\Limbo.PDF"
  DeleteRegKey HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegKey HKCU "Software\Limbo\Capabilities"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Limbo"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
