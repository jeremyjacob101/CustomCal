export {}

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

declare global {
  interface Window {
    electron: {
      process: {
        versions: NodeJS.ProcessVersions
      }
      previewCalendar(opts: { icsUrl: string }): Promise<{ events: ParsedIcsEvent[] }>
      importCalendar(opts: {
        targetCalendarName: string
        container: 'local' | 'icloud'
        events: ParsedIcsEvent[]
        calendarColorHex: string
      }): Promise<{ created: number }>
    }
  }
}
