// src/main/ipc/custom-field.ipc.ts
import { ipcMain } from 'electron'
import { customFieldService } from '../services/custom-field-service'
import { IPC_CHANNELS, type CustomField, type CustomFieldType } from '../../shared/types'
import { withUndoLog } from '../services/undo-service'
import { wrap, wrapWithUndo } from './utils'

/**
 * P2-23：参数校验辅助函数。
 * 校验失败时抛出友好错误，由 wrap/wrapWithUndo 捕获并转为 ApiResponse.error 返回前端。
 */
function assertParam(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

/** 校验非空字符串 */
function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  assertParam(typeof value === 'string' && value.length > 0, `参数 ${name} 必须为非空字符串`)
}

export function registerCustomFieldIpc(): void {
  ipcMain.handle(IPC_CHANNELS.CUSTOM_FIELD_LIST, () =>
    wrap(() => customFieldService.listAll())
  )

  ipcMain.handle(
    IPC_CHANNELS.CUSTOM_FIELD_CREATE,
    (_e, label: string, type: CustomFieldType) =>
      wrapWithUndo(() => {
        assertNonEmptyString(label, 'label')
        assertParam(
          ['text', 'number', 'tags', 'select'].includes(type),
          '参数 type 必须为 text/number/tags/select 之一'
        )
        return withUndoLog({
          storeName: 'customField',
          action: 'create',
          targetType: 'customField',
          targetId: null,
          label: `创建自定义字段 ${label}`,
          getBefore: () => null,
          execute: () => customFieldService.createField(label, type),
          getAfter: (result) => result
        })
      })
  )

  ipcMain.handle(
    IPC_CHANNELS.CUSTOM_FIELD_UPDATE,
    (
      _e,
      fieldKey: string,
      patch: Partial<Pick<CustomField, 'field_label' | 'sort_order'>>
    ) =>
      wrapWithUndo(() => {
        assertNonEmptyString(fieldKey, 'fieldKey')
        return withUndoLog({
          storeName: 'customField',
          action: 'update',
          targetType: 'customField',
          targetId: fieldKey,
          label: `更新自定义字段 ${fieldKey}`,
          getBefore: () =>
            customFieldService.listAll().find((f) => f.field_key === fieldKey) ?? null,
          execute: () => customFieldService.updateField(fieldKey, patch),
          getAfter: () =>
            customFieldService.listAll().find((f) => f.field_key === fieldKey) ?? null
        })
      })
  )

  ipcMain.handle(IPC_CHANNELS.CUSTOM_FIELD_DELETE, (_e, fieldKey: string) =>
    wrapWithUndo(() => {
      assertNonEmptyString(fieldKey, 'fieldKey')
      const before =
        customFieldService.listAll().find((f) => f.field_key === fieldKey) ?? null
      return withUndoLog({
        storeName: 'customField',
        action: 'delete',
        targetType: 'customField',
        targetId: fieldKey,
        label: `删除自定义字段 ${fieldKey}`,
        getBefore: () => before,
        execute: () => customFieldService.deleteField(fieldKey),
        getAfter: () => null
      })
    })
  )
}
