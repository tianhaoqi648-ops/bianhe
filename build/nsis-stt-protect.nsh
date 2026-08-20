; =============================================================================
; nsis-stt-protect.nsh
; 目的：在 升级 / 重装 / 卸载重装 时，保护安装目录内的 stt 数据目录
;       （含 whisper/funasr 转写模型 + ffmpeg 转码器）不被删除。
;
; 实现原理（基于 electron-builder 24 的 NSIS 卸载模板 uninstaller.nsh）：
;   默认情况下，卸载节会执行 `RMDir /r $INSTDIR`（并在升级时先把整个
;   $INSTDIR 原子改名到 $PLUGINSDIR\old-install 再删除），这会连带清空
;   $INSTDIR\stt。electron-builder 提供了可选的 `customRemoveFiles` 宏：
;   只要定义了该宏，electron-builder 生成的卸载节就会【完全跳过默认删除
;   逻辑】，改用本宏来完成文件清理。我们据此实现“删除 $INSTDIR 下除 stt
;   以外的所有内容”，从而保护 stt 目录在升级 / 卸载重装时被保留。
;
; 局限（请知悉）：NSIS 卸载默认用 RMDir /r 整目录清空，属于 electron-builder
;   内部行为；本方案通过官方提供的 customRemoveFiles 钩子将其替换，是在不改
;   业务代码前提下能落地的【最可靠】做法（customUnInstall 宏在 RMDir /r
;   之后才执行，无法救回已被删除的 stt）。代价是自定义删除逻辑对“空的非
;   stt 子目录”可能清理不彻底（残留空目录，无碍功能）；且更新时不再使用
;   默认的原子改名备份机制（因应用会先被 electron-updater 关闭，风险可控）。
; =============================================================================

; ---------------------------------------------------------------------------
; 卸载清理：删除 $INSTDIR 下除 stt 外的所有文件与子目录
; 说明：customRemoveFiles 是在卸载节（un.install Section）内联执行的，
;       因此这里放进一个可调用的函数即可。
; ---------------------------------------------------------------------------
Function sttProtectRemoveInstallDir
  ; 保护的目标目录名（安装目录下的 stt 数据目录：模型 + ffmpeg）
  StrCpy $3 "stt"

  ClearErrors
  FindFirst $0 $1 "$INSTDIR\*"
  loop:
    StrCmp $1 "" done
    ; 跳过系统和当前目录项
    StrCmp $1 "." next
    StrCmp $1 ".." next
    ; 着重保护 stt 目录（含其全部内容）
    StrCmp $1 $3 next

    StrCpy $2 "$INSTDIR\$1"
    ; 若是目录（非空）则递归删除，否则按文件删除
    IfFileExists "$2\*" 0 isFile
      RMDir /r "$2"
      Goto next
    isFile:
      Delete "$2"
  next:
    FindNext $0 $1
    Goto loop

  done:
    FindClose $0
FunctionEnd

; ---------------------------------------------------------------------------
; electron-builder 卸载钩子：替换默认的 `RMDir /r "$INSTDIR"`
; ---------------------------------------------------------------------------
!macro customRemoveFiles
  DetailPrint "SRVHUB-NSIS: 保留安装目录内 stt 数据目录（模型 + ffmpeg），其余内容将被清除..."
  Call sttProtectRemoveInstallDir
  DetailPrint "SRVHUB-NSIS: stt 目录已保留（$INSTDIR\stt）"
!macroend