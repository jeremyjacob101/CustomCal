import ical from 'node-ical'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function normalizeIcsUrl(url: string) {
  return url.replace(/^webcal:\/\//i, 'https://')
}

function ymd(d: Date): [number, number, number] {
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
}

function isAllDayEvent(v: any): boolean {
  // node-ical usually marks all-day DTSTART/DTEND as datetype === 'date'
  if (v?.datetype === 'date') return true

  if (!(v?.start instanceof Date)) return false

  // Heuristic fallback: midnight boundaries + whole-day duration
  const s: Date = v.start
  const e: Date | null = v.end instanceof Date ? v.end : null

  if (!e) return false

  const atMidnight =
    s.getHours() === 0 &&
    s.getMinutes() === 0 &&
    s.getSeconds() === 0 &&
    e.getHours() === 0 &&
    e.getMinutes() === 0 &&
    e.getSeconds() === 0

  const dur = e.getTime() - s.getTime()
  const oneDay = 24 * 60 * 60 * 1000

  return atMidnight && dur >= 0 && dur % oneDay === 0
}

export async function importIcsToCalendar(opts: {
  icsUrl: string
  targetCalendarName: string
  container: 'local' | 'icloud'
}) {
  const url = normalizeIcsUrl(opts.icsUrl)

  const data: Record<string, any> = await (ical.async.fromURL as any)(url, {
    headers: { 'User-Agent': 'CalendarCloner/0.1' }
  })

  const oneDay = 24 * 60 * 60 * 1000

  const events = Object.values(data)
    .filter((v: any) => v?.type === 'VEVENT')
    .map((v: any) => {
      const allDay = isAllDayEvent(v)

      const start: Date = v.start instanceof Date ? v.start : new Date()

      // Fallback end:
      // - all-day: next day
      // - timed: +1 hour
      let end: Date =
        v.end instanceof Date
          ? v.end
          : new Date(start.getTime() + (allDay ? oneDay : 60 * 60 * 1000))

      // Calendar expects all-day DTEND to be exclusive and at least next day
      if (allDay && end.getTime() <= start.getTime()) {
        end = new Date(start.getTime() + oneDay)
      }

      return {
        summary: String(v.summary ?? '(no title)'),
        description: v.description ? String(v.description) : '',
        location: v.location ? String(v.location) : '',

        isAllDay: allDay,

        // Timed events: pass exact timestamps
        startMs: start.getTime(),
        endMs: end.getTime(),

        // All-day events: pass date parts to avoid timezone shifting
        startYMD: allDay ? ymd(start) : null,
        endYMD: allDay ? ymd(end) : null
      }
    })

  const payload = {
    calendarName: opts.targetCalendarName,
    events,
    container: opts.container
  }

  const { stdout } =
    opts.container === 'local'
      ? await runJxaImport(payload)
      : await runSwiftImport(payload)

  return JSON.parse(stdout.trim()) as { created: number }
}

async function runJxaImport(payload: {
  calendarName: string
  events: Array<{
    summary: string
    description: string
    location: string
    isAllDay: boolean
    startMs: number
    endMs: number
    startYMD: [number, number, number] | null
    endYMD: [number, number, number] | null
  }>
  container: 'local' | 'icloud'
}) {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')

  const jxa = `
ObjC.import('Foundation');

function b64decode(s) {
  var ns = $.NSString.alloc.initWithUTF8String(s);
  var data = $.NSData.alloc.initWithBase64EncodedStringOptions(ns, 0);
  return $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
}

var payload = JSON.parse(b64decode("${payloadB64}"));
var Calendar = Application("Calendar");

// Find or create calendar
var matches = Calendar.calendars.whose({ name: payload.calendarName });
var cal = (matches.length > 0)
  ? matches[0]
  : Calendar.Calendar({ name: payload.calendarName }).make();

var created = 0;

payload.events.forEach(function(e) {
  var startDate, endDate;

  if (e.isAllDay && e.startYMD && e.endYMD) {
    // Local dates (no timezone shift) for all-day banners
    startDate = new Date(e.startYMD[0], e.startYMD[1] - 1, e.startYMD[2]);
    endDate   = new Date(e.endYMD[0],   e.endYMD[1] - 1,   e.endYMD[2]);
  } else {
    startDate = new Date(e.startMs);
    endDate   = new Date(e.endMs);
  }

  var ev = Calendar.Event({
    summary: e.summary,
    startDate: startDate,
    endDate: endDate,
    location: e.location,
    description: e.description
  });

  cal.events.push(ev);

  if (e.isAllDay) {
    // Try both property names (varies by macOS scripting dictionary)
    try { ev.allDayEvent = true; } catch (err) {}
    try { ev.alldayEvent = true; } catch (err) {}
  }

  created++;
});

JSON.stringify({ created: created });
`

  return await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', jxa])
}

async function runSwiftImport(payload: {
  calendarName: string
  events: Array<{
    summary: string
    description: string
    location: string
    isAllDay: boolean
    startMs: number
    endMs: number
    startYMD: [number, number, number] | null
    endYMD: [number, number, number] | null
  }>
  container: 'local' | 'icloud'
}) {
  const script = `
import Foundation
import EventKit

struct EventPayload: Codable {
  let summary: String
  let description: String
  let location: String
  let isAllDay: Bool
  let startMs: Double
  let endMs: Double
  let startYMD: [Int]?
  let endYMD: [Int]?
}

struct Payload: Codable {
  let calendarName: String
  let events: [EventPayload]
  let container: String
}

let args = CommandLine.arguments
guard args.count > 1 else {
  fputs("Missing payload path\\n", stderr)
  exit(1)
}

let payloadUrl = URL(fileURLWithPath: args[1])
let payloadData = try Data(contentsOf: payloadUrl)
let payload = try JSONDecoder().decode(Payload.self, from: payloadData)

let store = EKEventStore()
let sema = DispatchSemaphore(value: 0)
var accessGranted = false
var accessError: Error?

store.requestAccess(to: .event) { granted, error in
  accessGranted = granted
  accessError = error
  sema.signal()
}
sema.wait()

if !accessGranted {
  fputs("Calendar access denied: \\(accessError?.localizedDescription ?? "Unknown error")\\n", stderr)
  exit(1)
}

let sources = store.sources
func sourceLabel(_ source: EKSource) -> String {
  return "\\(source.title) (\\(source.sourceType.rawValue))"
}

func pickSource() -> EKSource? {
  switch payload.container.lowercased() {
  case "local":
    if let source = sources.first(where: { $0.sourceType == .local }) {
      return source
    }
    if let source = sources.first(where: {
      let title = $0.title.lowercased()
      return title.contains("on my mac") || title.contains("local") || title == "other"
    }) {
      return source
    }
    return sources.first(where: { $0.sourceType != .calDAV && $0.sourceType != .subscribed })
  case "icloud":
    if let icloud = sources.first(where: { $0.sourceType == .calDAV && $0.title.lowercased().contains("icloud") }) {
      return icloud
    }
    return sources.first(where: { $0.sourceType == .calDAV })
  default:
    return nil
  }
}

guard let source = pickSource() else {
  let available = sources.map(sourceLabel).joined(separator: ", ")
  fputs("No matching calendar source for \\(payload.container). Available: \\(available)\\n", stderr)
  exit(1)
}

let calendars = store.calendars(for: .event)
let targetCalendar = calendars.first(where: { $0.title == payload.calendarName && $0.source.sourceIdentifier == source.sourceIdentifier })
let calendar: EKCalendar
if let existing = targetCalendar {
  calendar = existing
} else {
  let newCalendar = EKCalendar(for: .event, eventStore: store)
  newCalendar.title = payload.calendarName
  newCalendar.source = source
  try store.saveCalendar(newCalendar, commit: true)
  calendar = newCalendar
}

let cal = Calendar.current
var created = 0

for e in payload.events {
  let event = EKEvent(eventStore: store)
  event.calendar = calendar
  event.title = e.summary
  event.location = e.location.isEmpty ? nil : e.location
  event.notes = e.description.isEmpty ? nil : e.description
  if e.isAllDay, let start = e.startYMD, let end = e.endYMD, start.count == 3, end.count == 3 {
    let startComponents = DateComponents(year: start[0], month: start[1], day: start[2])
    let endComponents = DateComponents(year: end[0], month: end[1], day: end[2])
    event.startDate = cal.date(from: startComponents)
    event.endDate = cal.date(from: endComponents)
    event.isAllDay = true
  } else {
    event.startDate = Date(timeIntervalSince1970: e.startMs / 1000.0)
    event.endDate = Date(timeIntervalSince1970: e.endMs / 1000.0)
    event.isAllDay = false
  }
  try store.save(event, span: .thisEvent, commit: false)
  created += 1
}

try store.commit()
let result = ["created": created]
let resultData = try JSONSerialization.data(withJSONObject: result, options: [])
FileHandle.standardOutput.write(resultData)
`

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'CustomCal-'))
  const scriptPath = path.join(tmpDir, 'import.swift')
  const payloadPath = path.join(tmpDir, 'payload.json')

  try {
    await fs.writeFile(scriptPath, script, 'utf8')
    await fs.writeFile(payloadPath, JSON.stringify(payload), 'utf8')
    return await execFileAsync('/usr/bin/swift', [scriptPath, payloadPath])
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}
