# google-calendar-sync
[![clasp](https://img.shields.io/badge/built%20with-clasp-4285f4.svg)](https://github.com/google/clasp)

Google apps script to sync events of one calendar with another.
Inspired by similar features of tools like [reclaim.ai](https://reclaim.ai/features/calendar-sync) and [clockwise](https://www.getclockwise.com/). 


## Usage
Prerequisite: The calendar you want to sync must be [shared](https://support.google.com/calendar/answer/37082) with your account.

- Copy `Config.ts.sample` to `Config.ts` and adjust the `appConfig`.
- Use [clasp](https://github.com/google/clasp) to push the code to your project.
- Run the `installTriggers` function in the UI

## Credits
The initial version of this project was based on code published by Will Roman for his medium article ["Auto Block Time on Your Work Google Calendar for Your Personal Events"](https://medium.com/@willroman/auto-block-time-on-your-work-google-calendar-for-your-personal-events-2a752ae91dab).
