/**
 * A workout the coach prescribed, one tap from being a routine.
 *
 * Every name is resolved against the library before the buttons do anything,
 * and each row shows the exercise it landed on, so what gets saved is what is
 * on screen. Updating an existing routine replaces its contents, which is why
 * it goes through a confirmation that lists every change first; saving as a new
 * routine touches nothing that exists and needs no such step.
 */

import { Ionicons } from '@expo/vector-icons';
import { formatDuration, type CoachPlan, type CoachPlanExercise, type WeightUnit } from '@lift/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Divider, PromptModal, Text } from '@/components/ui';
import { showAlert, showConfirm } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { spacing, useColors } from '@/theme';

import {
  applyPlanToRoutine,
  describePlanChanges,
  resolvePlan,
  savePlanAsRoutine,
  type ResolvedPlan,
} from '../plan';

export function PlanCard({ plan }: { plan: CoachPlan }) {
  const colors = useColors();
  const unit = useSettings((state) => state.weightUnit);
  const [resolved, setResolved] = useState<ResolvedPlan | null>(null);
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ routineId: string; label: string } | null>(null);

  // Keyed on the content rather than the object: a reply re-parses on every
  // streamed token after this card, and each parse is a new object with the
  // same plan in it. Resolving again per token would read the catalog per token.
  const key = JSON.stringify(plan);

  useEffect(() => {
    let cancelled = false;
    void resolvePlan(plan)
      .then((result) => {
        if (!cancelled) setResolved(result);
      })
      .catch(() => {
        if (!cancelled) {
          setResolved({
            plan,
            exercises: plan.exercises.map((planned) => ({ planned, exercise: null })),
            target: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is `plan`, by value.
  }, [key]);

  const matched = resolved?.exercises.filter((entry) => entry.exercise !== null).length ?? 0;
  const unmatched = (resolved?.exercises.length ?? 0) - matched;

  const save = async (name: string) => {
    setNaming(false);
    if (!resolved) return;
    setBusy(true);
    try {
      const routineId = await savePlanAsRoutine(resolved, unit, name);
      setSaved({ routineId, label: `Saved as ${name.trim() || plan.title}` });
    } catch (cause) {
      await showAlert('Could not save', cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const update = async () => {
    if (!resolved?.target) return;
    const changes = describePlanChanges(resolved, unit);
    const name = resolved.target.routine.name;

    if (changes.length === 0) {
      await showAlert(`${name} already matches`, 'Nothing in this plan differs from the routine.');
      return;
    }

    const confirmed = await showConfirm({
      title: `Update ${name}?`,
      message: [
        ...changes.map((change) => `• ${change}`),
        unmatched > 0 ? `\n${unmatched} exercise${unmatched === 1 ? '' : 's'} not in your library will be left out.` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      confirmLabel: 'Update',
      tone: 'confirm',
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      const routineId = await applyPlanToRoutine(resolved, unit);
      setSaved({ routineId, label: `Updated ${name}` });
    } catch (cause) {
      await showAlert('Could not update', cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padded={false}>
      <View style={styles.head}>
        <View style={styles.headTitle}>
          <Ionicons name="barbell-outline" size={18} color={colors.accent} />
          <Text variant="bodyMedium" style={styles.flex}>
            {plan.title}
          </Text>
        </View>
        {plan.notes && (
          <Text variant="caption" color="textSecondary">
            {plan.notes}
          </Text>
        )}
      </View>

      <Divider />

      {plan.exercises.map((planned, index) => {
        const exercise = resolved?.exercises[index]?.exercise;
        const missing = resolved !== null && !exercise;

        return (
          <View key={`${planned.exercise}-${index}`} style={styles.exercise}>
            <Text variant="numeric" color="textTertiary" style={styles.index}>
              {index + 1}
            </Text>
            <View style={styles.flex}>
              <Text variant="body" color={missing ? 'textTertiary' : 'text'}>
                {exercise?.name ?? planned.exercise}
              </Text>
              <Text variant="caption" color="textSecondary">
                {describePrescription(planned, unit)}
              </Text>
              {planned.note && (
                <Text variant="caption" color="textTertiary">
                  {planned.note}
                </Text>
              )}
              {missing && (
                <Text variant="caption" color="warning">
                  Not in your library, so it will be left out.
                </Text>
              )}
            </View>
          </View>
        );
      })}

      <Divider />

      <View style={styles.actions}>
        {saved ? (
          <View style={styles.saved}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <Text variant="label" style={styles.flex}>
              {saved.label}
            </Text>
            <Button
              title="Open"
              size="sm"
              variant="ghost"
              onPress={() => router.push({ pathname: '/routine/[id]', params: { id: saved.routineId } })}
            />
          </View>
        ) : (
          <>
            <Button
              title="Save as routine"
              icon="add-circle-outline"
              size="sm"
              loading={busy}
              disabled={!resolved || matched === 0}
              onPress={() => setNaming(true)}
            />
            {resolved?.target && (
              <Button
                title={`Update ${resolved.target.routine.name}`}
                icon="sync-outline"
                size="sm"
                variant="secondary"
                disabled={busy || matched === 0}
                onPress={() => void update()}
              />
            )}
          </>
        )}
      </View>

      <PromptModal
        visible={naming}
        title="Name the routine"
        initialValue={plan.title}
        confirmLabel="Save"
        onCancel={() => setNaming(false)}
        onConfirm={(name) => void save(name)}
      />
    </Card>
  );
}

/** "3 × 8 to 10 · 60 kg · RPE 8 · 2:00 rest". Only what was prescribed. */
function describePrescription(planned: CoachPlanExercise, unit: WeightUnit): string {
  const reps =
    planned.repsLow === null
      ? null
      : planned.repsHigh !== null && planned.repsHigh > planned.repsLow
        ? `${planned.repsLow} to ${planned.repsHigh}`
        : String(planned.repsLow);

  return [
    reps ? `${planned.sets} × ${reps}` : `${planned.sets} ${planned.sets === 1 ? 'set' : 'sets'}`,
    planned.weight !== null ? `${planned.weight} ${unit}` : null,
    planned.rpe !== null ? `RPE ${planned.rpe}` : null,
    planned.restSeconds ? `${formatDuration(planned.restSeconds)} rest` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

const styles = StyleSheet.create({
  head: { padding: spacing.lg, gap: spacing.xs },
  headTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  exercise: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  index: { minWidth: 16, paddingTop: 2 },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.lg },
  saved: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
