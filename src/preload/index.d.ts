export {};

declare global {
  interface Window {
    electron: {
      importCalendar(opts: {
        icsUrl: string;
        targetCalendarName: string;
        container: "local" | "icloud" | "ask";
      }): Promise<{ created: number }>;
    };
  }
}
