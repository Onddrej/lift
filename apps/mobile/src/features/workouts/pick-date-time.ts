/**
 * Asks for a date, then a time, with the system pickers.
 *
 * Android only: there the pickers are dialogs the platform owns and opens on
 * request, so two calls in a row are the whole control. On iOS the same library
 * is a view that has to be laid out on screen, which is a different component
 * for a platform this fork does not ship; `DATE_TIME_PICKER_SUPPORTED` keeps the
 * calling row read-only there and on the web.
 */

import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform } from 'react-native';

export const DATE_TIME_PICKER_SUPPORTED = Platform.OS === 'android';

function ask(mode: 'date' | 'time', value: Date, maximumDate?: Date): Promise<Date | null> {
  return new Promise((resolve) => {
    DateTimePickerAndroid.open({
      value,
      mode,
      is24Hour: true,
      maximumDate,
      onChange: (event, picked) => resolve(event.type === 'set' && picked ? picked : null),
    });
  });
}

/**
 * The chosen moment, or null if either dialog was dismissed. Never later than
 * `latest`: a session cannot have started in the future.
 */
export async function pickDateTime(initial: Date, latest: Date): Promise<Date | null> {
  const day = await ask('date', initial, latest);
  if (!day) return null;

  // The time dialog opens on the original time of day, on the day just chosen.
  const seeded = new Date(day);
  seeded.setHours(initial.getHours(), initial.getMinutes(), 0, 0);

  const time = await ask('time', seeded);
  if (!time) return null;

  const result = new Date(day);
  result.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return result.getTime() > latest.getTime() ? latest : result;
}
