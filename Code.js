/**
 * Helper function to get a new Date object relative to the current date.
 * @param {number} daysOffset The number of days in the future for the new date.
 * @param {number} hour The hour of the day for the new date, in the time zone
 *     of the script.
 * @return {Date} The new date.
 */
function getRelativeDate(daysOffset, hour) {
  var date = new Date();
  date.setDate(date.getDate() + daysOffset);
  date.setHours(hour);
  date.setMinutes(0);
  date.setSeconds(0);
  date.setMilliseconds(0);
  return date;
}

function fetchEvents(calendarId, callback, fullSync=false) {
  var properties = PropertiesService.getUserProperties();
  var syncTokenKey = 'syncToken/' + calendarId;
  var options = {
    maxResults: 100
  };
  var syncToken = properties.getProperty(syncTokenKey);
  if (syncToken && !fullSync) {
    options.syncToken = syncToken;
  } else {
    // Sync events up to thirty days in the past.
    options.timeMin = getRelativeDate(-30, 0).toISOString();
  }

  // Retrieve events one page at a time.
  var pageToken;
  var response;
  do {
    try {
      options.pageToken = pageToken;
      response = Calendar.Events.list(calendarId, options);
      response.items.filter(function(event) {
        // If the event was created by someone other than the user, only include
        // it if the user has marked it as 'accepted'.
        if (event.organizer && event.organizer.email != calendarId) {
          if (!event.attendees) {
            return false;
          }
          var matching = event.attendees.filter(function(attendee) {
            return attendee.self;
          });
          return matching.length > 0 && matching[0].responseStatus == 'accepted';
        }
        return true;
      }).forEach(function(event) {
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

function createPrivateCopy(event, calendarId, organizerId) {
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
  event.colorId = 9;
  return event;
}

function syncEvent(calendarId, event) {
  var primaryCalId = 'primary';
  var primaryCopy;
  
  try {
    primaryCopy = Calendar.Events.get(primaryCalId, event.id);
  } catch(e) {
    if (e.message.endsWith('Not Found')) {
      primaryCopy = null;
    } else {
      throw new Error(e.message);
    }
  }

  if (event.status === 'cancelled') {
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
      var eventCopy = createPrivateCopy(event, calendarId, primaryCalId);
      eventCopy.sequence = primaryCopy.sequence;
      try {
        Calendar.Events.update(eventCopy, primaryCalId, primaryCopy.id);
      } catch (e) {
        Logger.log('Error attempting to update event: %s. Skipping.', e.toString());
      }

    } else {
      var eventCopy = createPrivateCopy(event, calendarId, primaryCalId);
      Logger.log('Importing: %s @ %s', eventCopy.summary, primaryCopy.start);
      try {
        Calendar.Events.import(eventCopy, primaryCalId);
      } catch (e) {
        Logger.log('Error attempting to import event: %s. Skipping.', e.toString());
      }
    }
  }
}

function main() {
  var calendarId="supplemental_calendar_id";
  fetchEvents(calendarId, syncEvent);
}
