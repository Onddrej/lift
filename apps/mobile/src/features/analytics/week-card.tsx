/**
 * This week, one tile per day, filled on the days that were trained.
 *
 * The first thing on Home. The month grid further down answers "how has the
 * month gone"; this answers the question asked on the way to the gym, "have I
 * been this week, and how often", and it answers it without a scroll.
 *
 * Today is outlined, days still ahead are drawn as empty frames so a Monday
 * does not read as six missed sessions, and the whole card opens the calendar.
 */

import { dayKey } from '@lift/shared';
import { useMemo } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Card, Text } from '@/components/ui';
import { useSettings } from '@/store/settings';
import { radius, spacing, stroke, useColors } from '@/theme';

import { startOfDay, type WorkoutCalendar } from './calendar';

export interface WeekCardProps {
  calendar: WorkoutCalendar;
  today: Date;
  onPress: () => void;
  style?: ViewStyle;
}

export function WeekCard({ calendar, today, onPress, style }: WeekCardProps) {
  const colors = useColors();
  const firstDayOfWeek = useSettings((state) => state.firstDayOfWeek);

  const { days, sessions, range } = useMemo(() => {
    const midnight = startOfDay(today);
    const start = new Date(midnight);
    start.setDate(midnight.getDate() - ((midnight.getDay() - firstDayOfWeek + 7) % 7));

    const week = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const entry = calendar.days.get(dayKey(date));
      return {
        date,
        key: dayKey(date),
        workouts: entry?.workouts.length ?? 0,
        isToday: date.getTime() === midnight.getTime(),
        isFuture: date.getTime() > midnight.getTime(),
      };
    });

    const end = week[6]!.date;
    const short = (date: Date) => `${date.getDate()}. ${date.getMonth() + 1}.`;

    return {
      days: week,
      sessions: week.reduce((total, day) => total + day.workouts, 0),
      range: `${short(start)} – ${short(end)}`,
    };
  }, [calendar, today, firstDayOfWeek]);

  const count = `${sessions} ${sessions === 1 ? 'workout' : 'workouts'}`;

  return (
    <Card
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`This week, ${count}. Open calendar`}
      style={[styles.card, style]}
    >
      <View style={styles.row}>
        <Text variant="overline" color="textTertiary">
          This week
        </Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      </View>

      <View style={styles.row}>
        <Text variant="bodyMedium">{count}</Text>
        <Text variant="label" color="textTertiary">
          {range}
        </Text>
      </View>

      <View style={styles.days}>
        {days.map((day) => {
          const trained = day.workouts > 0;
          const weekday = day.date.toLocaleDateString(undefined, { weekday: 'short' });

          return (
            <View
              key={day.key}
              accessible
              accessibilityLabel={`${day.date.toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}${trained ? ', trained' : ''}${day.isToday ? ', today' : ''}`}
              style={[
                styles.day,
                trained
                  ? { backgroundColor: colors.accent }
                  : day.isFuture
                    ? { borderWidth: stroke.outline, borderColor: colors.surfaceMuted }
                    : { backgroundColor: colors.surfaceMuted },
                day.isToday && { borderWidth: 2, borderColor: colors.text },
              ]}
            >
              <Text
                variant="label"
                style={{ color: trained ? colors.textOnAccent : colors.textTertiary }}
                numberOfLines={1}
              >
                {weekday.slice(0, 2)}
              </Text>
              <Text
                variant="bodyMedium"
                style={{
                  color: trained
                    ? colors.textOnAccent
                    : day.isFuture
                      ? colors.textTertiary
                      : colors.text,
                }}
              >
                {day.date.getDate()}
              </Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  days: { flexDirection: 'row', gap: spacing.xs + 2, marginTop: spacing.sm },
  day: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingTop: spacing.sm - 1,
    paddingBottom: spacing.sm,
    borderRadius: radius.md,
  },
});
