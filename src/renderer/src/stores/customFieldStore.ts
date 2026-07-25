// src/renderer/src/stores/customFieldStore.ts
import { create } from 'zustand'
import type { CustomField, CustomFieldType, ApiResponse } from '../../../shared/types'

interface CustomFieldState {
  fields: CustomField[]
  loading: boolean
  error: string | null

  fetchAll: () => Promise<void>
  create: (label: string, type: CustomFieldType) => Promise<CustomField | null>
  update: (
    fieldKey: string,
    patch: Partial<Pick<CustomField, 'field_label' | 'sort_order'>>
  ) => Promise<boolean>
  remove: (fieldKey: string) => Promise<boolean>
}

function extractError<T>(res: ApiResponse<unknown>): T {
  if (res.success && res.data !== undefined) return res.data as T
  throw new Error(res.error || '未知错误')
}

export const useCustomFieldStore = create<CustomFieldState>((set) => ({
  fields: [],
  loading: false,
  error: null,

  fetchAll: async () => {
    set({ loading: true, error: null })
    try {
      const res = await window.customFieldAPI.list()
      const data = extractError<CustomField[]>(res)
      set({ fields: data, loading: false })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  create: async (label, type) => {
    try {
      const res = await window.customFieldAPI.create(label, type)
      const created = extractError<CustomField>(res)
      set((s) => ({ fields: [...s.fields, created] }))
      return created
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },

  update: async (fieldKey, patch) => {
    try {
      const res = await window.customFieldAPI.update(fieldKey, patch)
      extractError(res)
      set((s) => ({
        fields: s.fields.map((f) =>
          f.field_key === fieldKey ? { ...f, ...patch } : f
        )
      }))
      return true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return false
    }
  },

  remove: async (fieldKey) => {
    try {
      const res = await window.customFieldAPI.delete(fieldKey)
      extractError(res)
      set((s) => ({ fields: s.fields.filter((f) => f.field_key !== fieldKey) }))
      return true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return false
    }
  }
}))
