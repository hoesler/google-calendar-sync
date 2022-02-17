interface CalendarSyncConfig {
  colorId?: string
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
      response.items.forEach(function(event) {
        callback(calendarId, event);
      });

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

function createPrivateCopy(event: GoogleAppsScript.Calendar.Schema.Event, calendarId: string, organizerId: string) {
  const calendarSyncConfig: CalendarSyncConfig = appConfig[calendarId]

  event.summary = '[' + calendarId + '] ' + event.summary;
  event.attendees = [];
  event.visibility = 'private';
  event.organizer = {
    id: organizerId
  };
  event.reminders = {
    useDefault: false,
    overrides: []
  };
  event.colorId = calendarSyncConfig.colorId;
  return event;
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

  const isCancelled = event.status === 'cancelled'
  const isInvitation = event.organizer && event.organizer.email != calendarId
  let isAccepted = false
  if (isInvitation) {
    if (event.attendees) {
      const matching = event.attendees.filter(function(attendee) {
        return attendee.self;
      });
      isAccepted = matching.length > 0 && matching[0].responseStatus == 'accepted';
    }
  }

  if (isCancelled || isInvitation && !isAccepted) {
    if (primaryCopy) {
      Logger.log('Deleting: %s @ %s', primaryCopy.summary, primaryCopy.start);
      try {
        Calendar.Events.remove(primaryCalId, primaryCopy.id);
      } catch (e) {
        Logger.log('Error attempting to remove event: %s. Skipping.', e.toString());
      }
    }
  }
  else {
    if (primaryCopy) {
      Logger.log('Updating: %s @ %s', primaryCopy.summary, primaryCopy.start);
      const eventCopy = createPrivateCopy(event, calendarId, primaryCalId);
      eventCopy.sequence = primaryCopy.sequence;
      try {
        Calendar.Events.update(eventCopy, primaryCalId, primaryCopy.id);
      } catch (e) {
        Logger.log('Error attempting to update event: %s. Skipping.', e.toString());
      }

    } else {
      const eventCopy = createPrivateCopy(event, calendarId, primaryCalId);
      Logger.log('Importing: %s @ %s', eventCopy.summary, eventCopy.start);
      try {
        Calendar.Events.import(eventCopy, primaryCalId);
      } catch (e) {
        Logger.log('Error attempting to import event: %s. Skipping.', e.toString());
      }
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function main() {
  const calendarId="supplemental_calendar_id";
  fetchEvents(calendarId, syncEvent);
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
