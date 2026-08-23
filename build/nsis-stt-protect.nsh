; =============================================================================
; nsis-stt-protect.nsh
; 目的：在 升级 / 重装 / 卸载重装 时，保护安装目录内的 stt 数据目录
;       （含 whisper/funasr 转写模型 + ffmpeg 转码器）不被删除。
;
; 实现原理（基于 electron-builder 24 的 NSIS 卸载模板 uninstaller.nsh）：
;   默认情况下，卸载节会执行 `RMDir /r $INSTDIR`（并在升级时先把整个
;   $INSTDIR 原子改名到 $PLUGINSDIR\old-install 再删除），这会连带清空
;   $INSTDIR\stt。electron-builder 提供了可选的 `customRemoveFiles` 宏：
;   只要定义了该宏，electron-builder 生成的卸载节(un.install Section)就会
;   【完全跳过默认删除逻辑】，改为执行本宏。
;
;   注意：`!insertmacro customRemoveFiles` 是在【卸载 Section un.install】内
;   联展开的，属于卸载上下文。因此宏体内的代码必须能直接在卸载 Section 中
;   编译执行，不能 `Call` 一个仅用于安装态的普通 Function（那会导致
;   "Error in macro customRemoveFiles" 编译失败）。这里把所有逻辑【内联】到
;   宏体内，只使用 NSIS 基础指令（FindFirst/FindNext/RMDir/Delete/StrCmp 等）。
;
; 局限（请知悉）：
;   - 对“空的非 stt 子目录”可能清理不彻底（残留空目录，无碍功能）。
;   - 更新时不再使用 electron-builder 默认的原子改名备份机制。
;     （因应用会被 electron-updater 先退出再升级，风险可控。）
; =============================================================================

; ---------------------------------------------------------------------------
; 卸载清理钩子（由 electron-builder 的 uninstaller.nsh 在 un.install 内联）
; 逻辑：遍历 $INSTDIR 顶层，删除除 stt 外的所有文件与子目录；stt 及其全部
;       内容被保留。
; ---------------------------------------------------------------------------
!macro customRemoveFiles
  DetailPrint "辩盒: 保留安装目录内 stt 与 recordings 数据目录（模型/ffmpeg + 录音），其余内容将被清除..."
  ; $0 = 查找句柄, $1 = 当前文件名, $2 = 完整路径, $3 = 保护目录1(stt), $4 = 保护目录2(recordings)
  StrCpy $3 "stt"
  StrCpy $4 "recordings"
  ClearErrors
  FindFirst $0 $1 "$INSTDIR\*"
  customRemoveFilesLoop:
    StrCmp $1 "" customRemoveFilesDone
    StrCmp $1 "." customRemoveFilesNext
    StrCmp $1 ".." customRemoveFilesNext
    StrCmp $1 $3 customRemoveFilesNext
    StrCmp $1 $4 customRemoveFilesNext
    StrCpy $2 "$INSTDIR\$1"
    IfFileExists "$2\*" 0 customRemoveFilesIsFile
      RMDir /r "$2"
      Goto customRemoveFilesNext
    customRemoveFilesIsFile:
      Delete "$2"
    customRemoveFilesNext:
    FindNext $0 $1
    Goto customRemoveFilesLoop
  customRemoveFilesDone:
    FindClose $0
  DetailPrint "辩盒: stt 与 recordings 目录已保留（$INSTDIR\stt、$INSTDIR\recordings）"
!macroend