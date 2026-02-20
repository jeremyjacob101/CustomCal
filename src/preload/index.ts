import { contextBridge, ipcRenderer } from 'electron'

type ParsedIcsEvent = {
  summary: string
  description: string
  location: string
  isAllDay: boolean
  startMs: number
  endMs: number
  startYMD: [number, number, number] | null
  endYMD: [number, number, number] | null
}

contextBridge.exposeInMainWorld('electron', {
  process: {
    versions: process.versions
  },
  previewCalendar: (opts: { icsUrl: string }) =>
    ipcRenderer.invoke('calendar:previewIcs', opts) as Promise<{ events: ParsedIcsEvent[] }>,
  importCalendar: (opts: {
    targetCalendarName: string
    container: 'local' | 'icloud'
    events: ParsedIcsEvent[]
  }) => ipcRenderer.invoke('calendar:importIcs', opts) as Promise<{ created: number }>
})
