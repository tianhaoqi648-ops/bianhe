// src/main/ipc/custom-field.ipc.ts
import { ipcMain } from 'electron'
import { customFieldService } from '../services/custom-field-service'
import { IPC_CHANNELS, type ApiResponse, type CustomField, type CustomFieldType } from '../../shared/types'

function wrap<T>(fn: () => T): ApiResponse<T> {
  try {
    return { success: true, data: fn() }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function registerCustomFieldIpc(): void {
  ipcMain.handle(IPC_CHANNELS.CUSTOM_FIELD_LIST, () =>
    wrap(() => customFieldService.listAll())
  )

  ipcMain.handle(
    IPC_CHANNELS.CUSTOM_FIELD_CREATE,
    (_e, label: string, type: CustomFieldType) =>
      wrap(() => customFieldService.createField(label, type))
  )

  ipcMain.handle(
    IPC_CHANNELS.CUSTOM_FIELD_UPDATE,
    (
      _e,
      fieldKey: string,
      patch: Partial<Pick<CustomField, 'field_label' | 'sort_order'>>
    ) => wrap(() => customFieldService.updateField(fieldKey, patch))
  )

  ipcMain.handle(IPC_CHANNELS.CUSTOM_FIELD_DELETE, (_e, fieldKey: string) =>
    wrap(() => customFieldService.deleteField(fieldKey))
  )
}
