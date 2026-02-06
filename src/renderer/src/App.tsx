import { useState } from 'react'

export default function App() {
  const [icsUrl, setIcsUrl] = useState('')
  const [name, setName] = useState('Imported Copy')
  const [log, setLog] = useState('')

  async function runImport() {
    if (!window.electron) {
      setLog('Preload not working!')
      return
    }

    setLog('Importing...')

    try {
      const res = await window.electron.importCalendar({
        icsUrl,
        targetCalendarName: name,
        container: 'local'
      })

      setLog(`Done. Created ${res.created} events in "${name}".`)
    } catch (e: any) {
      setLog('Error: ' + (e?.message ?? String(e)))
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Calendar Cloner (MVP)</h2>

      <div>
        <div>Paste your iCal / webcal URL:</div>
        <input
          style={{ width: '100%' }}
          value={icsUrl}
          onChange={(e) => setIcsUrl(e.target.value)}
        />
      </div>

      <div style={{ marginTop: 8 }}>
        <div>New calendar name:</div>
        <input style={{ width: '100%' }} value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <button style={{ marginTop: 12 }} onClick={runImport}>
        Import to Calendar.app
      </button>

      <pre style={{ marginTop: 12 }}>{log}</pre>
    </div>
  )
}
