import ical from 'node-ical'
import { execFile } from 'node:child_process'
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
  container: 'local' | 'icloud' | 'ask'
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

  const payloadB64 = Buffer.from(
    JSON.stringify({
      calendarName: opts.targetCalendarName,
      events,
      container: opts.container
    }),
    'utf8'
  ).toString('base64')

  const jxa = `
ObjC.import('Foundation');

function b64decode(s) {
  var ns = $.NSString.alloc.initWithUTF8String(s);
  var data = $.NSData.alloc.initWithBase64EncodedStringOptions(ns, 0);
  return $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
}

var payload = JSON.parse(b64decode("${payloadB64}"));
var Calendar = Application("Calendar");
var System = Application.currentApplication();
System.includeStandardAdditions = true;

function sourceName(source) {
  try { if (source.name) return source.name(); } catch (err) {}
  try { if (source.title) return source.title(); } catch (err) {}
  return null;
}

function findSourceByMatch(matchFn) {
  var sources = Calendar.sources();
  for (var i = 0; i < sources.length; i++) {
    var name = sourceName(sources[i]);
    if (name && matchFn(name.toLowerCase())) {
      return sources[i];
    }
  }
  return null;
}

function chooseSourceInteractive() {
  var sources = Calendar.sources();
  var names = sources.map(function(source) {
    return sourceName(source) || 'Unknown';
  });
  var choice = System.chooseFromList(names, {
    withPrompt: 'Choose a Calendar account to import into:',
    defaultItems: [names[0]]
  });
  if (!choice) {
    throw new Error('Import canceled: no calendar account selected.');
  }
  var selectedName = choice[0];
  for (var i = 0; i < sources.length; i++) {
    if ((sourceName(sources[i]) || 'Unknown') === selectedName) {
      return sources[i];
    }
  }
  return null;
}

var targetSource = null;
if (payload.container === 'ask') {
  targetSource = chooseSourceInteractive();
} else if (payload.container === 'icloud') {
  targetSource = findSourceByMatch(function(name) { return name.indexOf('icloud') !== -1; });
} else {
  targetSource = findSourceByMatch(function(name) {
    return name.indexOf('on my mac') !== -1 || name.indexOf('local') !== -1;
  });
}

if (!targetSource) {
  var available = Calendar.sources().map(function(source) { return sourceName(source) || 'Unknown'; });
  throw new Error('No matching Calendar account found for "' + payload.container + '". Available sources: ' + available.join(', '));
}

// Find or create calendar
var matches = Calendar.calendars.whose({ name: payload.calendarName, source: targetSource });
var cal = (matches.length > 0)
  ? matches[0]
  : Calendar.Calendar({ name: payload.calendarName, source: targetSource }).make();

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

  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', jxa])

  return JSON.parse(stdout.trim()) as { created: number }
}
