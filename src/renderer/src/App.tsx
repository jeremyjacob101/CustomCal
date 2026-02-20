import { useMemo, useState } from 'react'

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

type EventGroup = {
  key: string
  label: string
  events: ParsedIcsEvent[]
}

const oneDayMs = 24 * 60 * 60 * 1000

function groupKeyForSummary(summary: string): string {
  return summary.trim().toLocaleLowerCase()
}

function groupEventsBySummary(events: ParsedIcsEvent[]): EventGroup[] {
  const groups = new Map<string, EventGroup>()

  for (const event of events) {
    const label = event.summary.trim() || '(no title)'
    const key = groupKeyForSummary(label)
    const existing = groups.get(key)

    if (existing) {
      existing.events.push(event)
      continue
    }

    groups.set(key, {
      key,
      label,
      events: [event]
    })
  }

  return Array.from(groups.values())
}

function eventStartTime(event: ParsedIcsEvent): number {
  if (event.isAllDay && event.startYMD) {
    return new Date(event.startYMD[0], event.startYMD[1] - 1, event.startYMD[2]).getTime()
  }
  return event.startMs
}

function formatEventDate(event: ParsedIcsEvent): string {
  if (event.isAllDay && event.startYMD && event.endYMD) {
    const start = new Date(event.startYMD[0], event.startYMD[1] - 1, event.startYMD[2])
    const endExclusive = new Date(event.endYMD[0], event.endYMD[1] - 1, event.endYMD[2])
    const endInclusive = new Date(endExclusive.getTime() - oneDayMs)

    if (start.toDateString() === endInclusive.toDateString()) {
      return `${start.toLocaleDateString()} (all day)`
    }

    return `${start.toLocaleDateString()} - ${endInclusive.toLocaleDateString()} (all day)`
  }

  const start = new Date(event.startMs)
  const end = new Date(event.endMs)
  return `${start.toLocaleString()} - ${end.toLocaleString()}`
}

function formatGroupDateRange(events: ParsedIcsEvent[]): string {
  if (events.length === 1) {
    return formatEventDate(events[0])
  }

  let minStart = Number.POSITIVE_INFINITY
  let maxStart = Number.NEGATIVE_INFINITY

  for (const event of events) {
    const start = eventStartTime(event)
    if (start < minStart) minStart = start
    if (start > maxStart) maxStart = start
  }

  const minDate = new Date(minStart).toLocaleDateString()
  const maxDate = new Date(maxStart).toLocaleDateString()

  if (minDate === maxDate) {
    return `${events.length} occurrences on ${minDate}`
  }

  return `${events.length} occurrences from ${minDate} to ${maxDate}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function App(): React.JSX.Element {
  const [icsUrl, setIcsUrl] = useState('')
  const [name, setName] = useState('Imported Copy')
  const [container, setContainer] = useState<'local' | 'icloud'>('icloud')
  const [previewEvents, setPreviewEvents] = useState<ParsedIcsEvent[]>([])
  const [selectedGroups, setSelectedGroups] = useState<Record<string, boolean>>({})
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [log, setLog] = useState('')

  async function runPreview(): Promise<void> {
    if (!window.electron) {
      setLog('Preload not working!')
      return
    }

    if (!icsUrl.trim()) {
      setLog('Paste an iCal / webcal URL first.')
      return
    }

    setIsPreviewing(true)
    setLog('Importing link and preparing preview...')

    try {
      const res = await window.electron.previewCalendar({ icsUrl })
      const groups = groupEventsBySummary(res.events)
      const initialSelection: Record<string, boolean> = {}
      for (const group of groups) {
        initialSelection[group.key] = true
      }
      setPreviewEvents(res.events)
      setSelectedGroups(initialSelection)
      if (res.events.length === 0) {
        setLog('No events found in this feed.')
      } else {
        setLog(
          `Preview ready. ${res.events.length} events found. Uncheck any events you do not want, then click "Add to iCalendar".`
        )
      }
    } catch (e: unknown) {
      setLog('Error: ' + errorMessage(e))
      setPreviewEvents([])
      setSelectedGroups({})
    } finally {
      setIsPreviewing(false)
    }
  }

  async function addSelectedEvents(): Promise<void> {
    if (!window.electron) {
      setLog('Preload not working!')
      return
    }

    const events = previewEvents.filter((event) => {
      const key = groupKeyForSummary(event.summary.trim() || '(no title)')
      return selectedGroups[key] ?? false
    })
    if (events.length === 0) {
      setLog('Select at least one event before adding to iCalendar.')
      return
    }

    setIsAdding(true)
    setLog(`Adding ${events.length} events...`)

    try {
      const res = await window.electron.importCalendar({
        targetCalendarName: name,
        container,
        events
      })
      setLog(`Done. Created ${res.created} events in "${name}".`)
    } catch (e: unknown) {
      setLog('Error: ' + errorMessage(e))
    } finally {
      setIsAdding(false)
    }
  }

  function toggleGroup(key: string): void {
    setSelectedGroups((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? false)
    }))
  }

  const eventGroups = useMemo(() => groupEventsBySummary(previewEvents), [previewEvents])
  const hasPreview = eventGroups.length > 0
  const selectedGroupCount = eventGroups.filter(
    (group) => selectedGroups[group.key] ?? false
  ).length
  const selectedEventCount = eventGroups.reduce((count, group) => {
    if (selectedGroups[group.key] ?? false) {
      return count + group.events.length
    }
    return count
  }, 0)
  const statusTone = log.startsWith('Error:')
    ? 'status-error'
    : log.startsWith('Done.')
      ? 'status-success'
      : 'status-info'

  return (
    <div className="overlay-root">
      <div className="modal-shell">
        <div className="tray-app">
          <section className="tray-card">
            <label className="field">
              <span>iCal URL</span>
              <input
                value={icsUrl}
                onChange={(e) => setIcsUrl(e.target.value)}
                placeholder="https://example.com/calendar.ics"
              />
            </label>

            <label className="field">
              <span>New calendar name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>

            <label className="field">
              <span>Destination account</span>
              <select
                value={container}
                onChange={(e) => setContainer(e.target.value as 'local' | 'icloud')}
              >
                <option value="icloud">iCloud</option>
                <option value="local">On My Mac</option>
              </select>
            </label>

            <button
              className="btn btn-primary"
              onClick={runPreview}
              disabled={isPreviewing || isAdding}
            >
              {isPreviewing ? 'Importing...' : 'Import'}
            </button>
          </section>

          <section className="tray-card preview-card">
            <div className="preview-head">
              <div className="preview-title">Events Preview</div>
              <div className="preview-count">
                {hasPreview
                  ? `${selectedGroupCount}/${eventGroups.length} selected (${selectedEventCount}/${previewEvents.length} events)`
                  : 'No preview yet'}
              </div>
            </div>

            {hasPreview ? (
              <div className="preview-tools">
                <button
                  className="btn btn-ghost"
                  onClick={() =>
                    setSelectedGroups(
                      Object.fromEntries(eventGroups.map((group) => [group.key, true]))
                    )
                  }
                  disabled={isAdding || isPreviewing}
                >
                  Select all
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() =>
                    setSelectedGroups(
                      Object.fromEntries(eventGroups.map((group) => [group.key, false]))
                    )
                  }
                  disabled={isAdding || isPreviewing}
                >
                  Clear all
                </button>
              </div>
            ) : null}

            <div className="event-list">
              {hasPreview ? (
                eventGroups.map((group) => (
                  <label key={group.key} className="event-item" title={group.label}>
                    <input
                      type="checkbox"
                      checked={selectedGroups[group.key] ?? false}
                      onChange={() => toggleGroup(group.key)}
                    />
                    <div className="event-content">
                      <div className="event-summary-row">
                        <div className="event-summary">{group.label}</div>
                        {group.events.length > 1 ? (
                          <div className="event-repeat">(x{group.events.length})</div>
                        ) : null}
                      </div>
                      <div className="event-meta">{formatGroupDateRange(group.events)}</div>
                    </div>
                  </label>
                ))
              ) : (
                <div className="empty-state">Import a link to preview events here.</div>
              )}
            </div>

            <button
              className="btn btn-accent"
              onClick={addSelectedEvents}
              disabled={isAdding || isPreviewing || selectedEventCount === 0}
            >
              {isAdding ? 'Adding...' : 'Add Selected to iCalendar'}
            </button>
          </section>

          <div className={`status-line ${statusTone}`}>
            {log || 'Ready to import. Paste a URL and click Import.'}
          </div>
        </div>
      </div>
    </div>
  )
}
