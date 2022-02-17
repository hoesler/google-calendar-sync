interface CalendarSyncConfig {
  colorId?: string
  titlePrefix?: string
  summary?: string
  copyDescription?: boolean
}

/**
 * https://developers.google.com/calendar/api/v3/reference/events/list
 */
interface EventsListOptions {
  maxResults?: number
  syncToken?: string
  timeMin?: string
  pageToken?: string
}

/**
 * Helper function to get a new Date object relative to the current date.
 * @param {number} daysOffset The number of days in the future for the new date.
 * @param {number} hour The hour of the day for the new date, in the time zone
 *     of the script.
 * @return {Date} The new date.
 */
function getRelativeDate(daysOffset: number, hour: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  date.setHours(hour);
  date.setMinutes(0);
  date.setSeconds(0);
  date.setMilliseconds(0);
  return date;
}

function formatEventDate(date: GoogleAppsScript.Calendar.Schema.EventDateTime): string {
  let timeZone = date.timeZone
  if (!timeZone) {
    timeZone = Calendar.Settings.get('timezone').value
  }

  const locale = Calendar.Settings.get('locale').value

  if (date.date) {
    // All-day event.
    return new Date(date.date).toLocaleString(locale, {timeZone: timeZone});
  } else {
    return new Date(date.dateTime).toLocaleString(locale, {timeZone: timeZone});
  }
}

type EventCallback = (calendarId: string, event: GoogleAppsScript.Calendar.Schema.Event) => void;

function fetchEvents(calendarId: string, callback: EventCallback, fullSync=false) {
  const properties = PropertiesService.getUserProperties();
  const syncTokenKey = 'syncToken/' + calendarId;

  const options: EventsListOptions = {
    maxResults: 100
  };
  const syncToken = properties.getProperty(syncTokenKey);
  if (syncToken && !fullSync) {
    options.syncToken = syncToken;
  } else {
    // Sync events up to thirty days in the past.
    options.timeMin = getRelativeDate(-30, 0).toISOString();
  }

  // Retrieve events one page at a time.
  let pageToken: string;
  let response: GoogleAppsScript.Calendar.Schema.Events;
  do {
    try {
      options.pageToken = pageToken;
      response = Calendar.Events.list(calendarId, options);
      response.items
        .filter(event => event['eventType'] != "outOfOffice")
        .forEach(event => callback(calendarId, event));

      pageToken = response.nextPageToken;
    } catch (e) {
      // Check to see if the sync token was invalidated by the server;
      // if so, perform a full sync instead.
      if (e.message === 'Sync token is no longer valid, a full sync is required.') {
        properties.deleteProperty(syncTokenKey);
        fetchEvents(calendarId, callback, true);
        return;
      } else {
        throw new Error(e.message);
      }
    }
  } while (pageToken);

  properties.setProperty(syncTokenKey, response.nextSyncToken);
}

function copyEvent(event: GoogleAppsScript.Calendar.Schema.Event, calendarId: string): GoogleAppsScript.Calendar.Schema.Event {
  const calendarSyncConfig: CalendarSyncConfig = appConfig[calendarId]

  let summary = event.summary
  if (calendarSyncConfig.summary) {
    summary = calendarSyncConfig.summary
  } else if (calendarSyncConfig.titlePrefix === undefined) {
    summary = '[' + calendarId + '] ' + event.summary;
  } else if (calendarSyncConfig.titlePrefix !== null) {
    summary = calendarSyncConfig.titlePrefix + ' ' + event.summary;
  }

  const eventCopy: GoogleAppsScript.Calendar.Schema.Event = {
    id: event.id,
    iCalUID: event.iCalUID,
    reminders: {
      useDefault: false,
      overrides: []
    },
    colorId: calendarSyncConfig.colorId,
    summary: summary,
    start: event.start,
    end: event.end,
    recurrence: event.recurrence,
    recurringEventId: event.recurringEventId,
    originalStartTime: event.originalStartTime,
    source: {
      title: '[' + calendarId + '] ' + event.summary,
      url: event.htmlLink
    }
  }

  if (calendarSyncConfig.copyDescription) {
    eventCopy.description = event.description
  }

  eventCopy['eventType'] = event['eventType']

  return eventCopy
}

function syncEvent(calendarId: string, event: GoogleAppsScript.Calendar.Schema.Event) {
  const primaryCalId = 'primary';
  let primaryCopy: GoogleAppsScript.Calendar.Schema.Event | null | undefined;
  
  try {
    primaryCopy = Calendar.Events.get(primaryCalId, event.id);
  } catch(e) {
    if (e.message.endsWith('Not Found')) {
      primaryCopy = null;
    } else {
      throw new Error(e.message);
    }
  }

  const isCancelled = event.status == 'cancelled'
  const isInvitation = event.organizer && event.organizer.email != calendarId
  let isAccepted = false
  if (isInvitation) {
    if (event.attendees) {
      const matching = event.attendees.filter(function(attendee) {
        return attendee.self;
      });
      isAccepted = matching.length > 0 && matching[0].responseStatus === 'accepted';
    }
  }

  if (isCancelled || isInvitation && !isAccepted) {
    if (primaryCopy && primaryCopy.status !== 'cancelled') {
      Logger.log('Deleting: %s @ %s', event.summary, formatEventDate(event.start));
      try {
        Calendar.Events.remove(primaryCalId, primaryCopy.id);
      } catch (e) {
        Logger.log('Error attempting to remove event: %s. Skipping.', e.toString());
      }
    }
  }
  else {
    if (primaryCopy) {
      Logger.log('Updating: %s @ %s', event.summary, formatEventDate(event.start));
      const eventCopy = copyEvent(event, calendarId);
      eventCopy.sequence = primaryCopy.sequence;
      try {
        Calendar.Events.update(eventCopy, primaryCalId, primaryCopy.id);
      } catch (e) {
        Logger.log('Error attempting to update event: %s. Skipping.', e.toString());
      }

    } else {
      const eventCopy = copyEvent(event, calendarId);
      Logger.log('Importing: %s @ %s', event.summary, formatEventDate(event.start));
      try {
        Calendar.Events.import(eventCopy, primaryCalId);
      } catch (e) {
        Logger.log('Error attempting to import event: %s. Skipping.', e.toString());
      }
    }
  }
}

interface EventUpdated {
  authMode: GoogleAppsScript.Script.AuthMode
  calendarId: string
  triggerUid: string
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function onCalendarUpdateEvent(event: EventUpdated) {
  fetchEvents(event.calendarId, syncEvent);
}

function installTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const calendarId in appConfig) {
    if (!triggers.some(trigger => trigger.getTriggerSourceId() === calendarId)) {
      Logger.log('Installing trigger for %s', calendarId)
      ScriptApp.newTrigger('onCalendarUpdateEvent')
        .forUserCalendar(calendarId)
        .onEventUpdated()
        .create()
     }
   }
}

function deleteTriggers() {
  Logger.log('Deleting all triggers')
  ScriptApp.getProjectTriggers().forEach(trigger => ScriptApp.deleteTrigger(trigger));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function recreateTriggers() {
  deleteTriggers()
  installTriggers()
}
