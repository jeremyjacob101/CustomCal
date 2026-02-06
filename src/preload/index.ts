import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  importCalendar: (opts: {
    icsUrl: string;
    targetCalendarName: string;
    container: "local" | "icloud";
  }) => ipcRenderer.invoke("calendar:importIcs", opts)
});
