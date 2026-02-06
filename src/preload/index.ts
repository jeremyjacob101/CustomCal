import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  importCalendar: (opts: {
    icsUrl: string;
    targetCalendarName: string;
    container: "local" | "icloud" | "ask";
  }) => ipcRenderer.invoke("calendar:importIcs", opts)
});
