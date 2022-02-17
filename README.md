# google-calendar-sync
[![clasp](https://img.shields.io/badge/built%20with-clasp-4285f4.svg)](https://github.com/google/clasp)

Google apps script to sync events of one calendar with another

## Usage
- Create a file `Config.ts` and add a `appConfig` object like the following:
  ```typescript
  const appConfig: Record<string, CalendarSyncConfig> = {
	"christoph.hoesler@gmail.com": {}
  }
  ```
- Run [clasp](https://github.com/google/clasp) to push the code to your project.
- Run `installTriggers` in the UI
