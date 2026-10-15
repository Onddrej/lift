import { Ionicons } from '@expo/vector-icons';
import {
  buildTrainingReport,
  formatPeriod,
  formatTonnage,
  groupThousands,
  lastDaysWindow,
  percentChange,
  reportTitle,
  toUnit,
  type TrainingReport,
} from '@lift/shared/report';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { LiftMark } from '@/components/brand/lift-mark';
import { Button, Card, ListRow, Reveal, Screen, SegmentedControl, Text, useScrollEdge } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { exportReportPdf } from '@/features/report/export';
import { latestBodyweightKg, loadReportWorkouts } from '@/features/report/repository';
import { useSession } from '@/features/sync/auth-client';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { showAlert } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { easing, font, radius, spacing, STAGGER_MAX_MS, STAGGER_STEP_MS, timing } from '@/theme';

/**
 * The report's own colours, the same in both themes.
 *
 * This screen previews a document, and the document is ink and lime whatever
 * the phone is set to: the preview should look like the file it will send,
 * not like the screen around it.
 */
const INK = '#0C0C0F';
const CARD = '#17171C';
const LINE = '#26262D';
const TEXT = '#F5F5F7';
const MUTED = '#A1A1AC';
const DIM = '#6B6B76';
const LIME = '#D2F34B';
const LIME_SOFT = '#7E9230';
const LIME_INK = '#12180A';

type Span = '7' | '30' | '90';

const SPANS: readonly { value: Span; label: string }[] = [
  { value: '7', label: 'Week' },
  { value: '30', label: 'Month' },
  { value: '90', label: '3 months' },
];

/**
 * A training report: the window's numbers as a designed page, and the button
 * that turns it into a PDF.
 *
 * The page on screen is a preview of the file, drawn from the same report
 * object the PDF renderer reads. The bot sends the same page every Monday.
 */
export default function ReportScreen() {
  const scrollEdge = useScrollEdge();
  const unit = useSettings((state) => state.weightUnit);
  const { data: session } = useSession();
  const [span, setSpan] = useState<Span>('7');
  const [report, setReport] = useState<TrainingReport | null>(null);
  const [exporting, setExporting] = useState(false);

  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const now = Date.now();
        // Ends at tomorrow's midnight so today's session is in it: a report
        // asked for on the evening of a workout should include that workout.
        const { from, to } = lastDaysWindow(now + 24 * 60 * 60 * 1000, Number(span));
        const [workouts, bodyweightKg] = await Promise.all([loadReportWorkouts(to), latestBodyweightKg()]);
        const next = buildTrainingReport({
          workouts,
          from,
          to,
          unit,
          athlete: session?.user?.name ?? null,
          generatedAt: now,
          ...(bodyweightKg !== undefined ? { bodyweightKg } : {}),
        });
        if (!cancelled) setReport(next);
      })().catch(() => {
        if (!cancelled) setReport(null);
      });
      return () => {
        cancelled = true;
      };
    }, [span, unit, session?.user?.name]),
  );

  const exportPdf = useCallback(async () => {
    if (!report || exporting) return;
    setExporting(true);
    haptics.added();
    try {
      await exportReportPdf(report);
    } catch (cause) {
      void showAlert(
        'Could not make the PDF',
        cause instanceof Error && cause.message ? cause.message : 'The reason was not reported.',
      );
    } finally {
      setExporting(false);
    }
  }, [report, exporting]);

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'Training report' }} />

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        <SegmentedControl
          options={SPANS}
          value={span}
          onChange={(value) => {
            haptics.selection();
            setSpan(value);
          }}
          label="Report length"
        />

        {report && (
          // Keyed on the window so a change of length plays the page in again
          // rather than swapping numbers under a still frame.
          <Reveal key={`${span}-${report.from}`}>
            <Poster report={report} />
          </Reveal>
        )}

        <Reveal index={1} style={styles.actions}>
          <Button
            title={exporting ? 'Making the PDF…' : 'Export PDF'}
            icon="document-text-outline"
            loading={exporting}
            disabled={!report}
            fullWidth
            onPress={() => void exportPdf()}
          />
          <Text variant="caption" color="textTertiary" align="center">
            A one-page PDF with your logo, ready to share or print.
          </Text>
        </Reveal>

        <Reveal index={2}>
          <Card padded={false}>
            <ListRow
              icon="paper-plane-outline"
              tone="accent"
              title="Get this every Monday"
              subtitle="Weekly report and a daily nudge, on Telegram"
              onPress={() => router.push('/settings/telegram')}
            />
          </Card>
        </Reveal>
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// The poster
// ---------------------------------------------------------------------------

function Poster({ report }: { report: TrainingReport }) {
  const { totals, previous, unit } = report;
  const tonnage = formatTonnage(totals.volumeKg, unit);
  const space = tonnage.lastIndexOf(' ');
  const figure = tonnage.slice(0, space);
  const suffix = tonnage.slice(space + 1);

  return (
    <View style={styles.poster}>
      <View style={styles.posterHead}>
        <View style={styles.brand}>
          <LiftMark size={22} color={LIME} background={INK} />
          <Text variant="subheading" style={[styles.wordmark, { color: TEXT }]}>
            LIFT
          </Text>
        </View>
        <View style={styles.period}>
          <Text variant="overline" style={{ color: LIME }}>
            {reportTitle(report.days)}
          </Text>
          <Text variant="caption" style={{ color: TEXT }}>
            {formatPeriod(report.from, report.to)}
          </Text>
        </View>
      </View>

      <View style={styles.hero}>
        <Text variant="overline" style={{ color: MUTED }}>
          Total moved
        </Text>
        <View style={styles.figureRow}>
          <Text style={[styles.figure, { color: TEXT }]} numberOfLines={1} adjustsFontSizeToFit>
            {figure}
          </Text>
          <Text variant="heading" style={{ color: LIME }}>
            {suffix}
          </Text>
        </View>
        <Text variant="body" style={{ color: MUTED }}>
          {totals.sessions === 0
            ? 'A quiet stretch. The next one starts with one session.'
            : `${totals.sessions} ${totals.sessions === 1 ? 'session' : 'sessions'} over ${totals.trainingDays} ${totals.trainingDays === 1 ? 'day' : 'days'} of ${report.days}.`}
        </Text>
      </View>

      <View style={styles.tiles}>
        <Tile label="Sessions" value={`${totals.sessions}`} now={totals.sessions} before={previous.sessions} />
        <Tile label="Sets" value={groupThousands(totals.sets)} now={totals.sets} before={previous.sets} />
        <Tile label="Reps" value={groupThousands(totals.reps)} now={totals.reps} before={previous.reps} />
      </View>

      <Bars report={report} />

      {report.lifts.length > 0 && (
        <View style={styles.block}>
          <Text variant="overline" style={{ color: MUTED }}>
            Top lifts
          </Text>
          {report.lifts.slice(0, 3).map((lift, index) => (
            <View key={lift.name} style={styles.liftRow}>
              <Text variant="label" style={[styles.rank, { color: LIME }]}>
                {String(index + 1).padStart(2, '0')}
              </Text>
              <Text variant="bodyMedium" style={[styles.flex, { color: TEXT }]} numberOfLines={1}>
                {lift.name}
              </Text>
              {lift.bestOneRepMaxKg > 0 && (
                <Text variant="bodyMedium" style={{ color: TEXT }}>
                  {weight(lift.bestOneRepMaxKg, unit)}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}

      {report.records.length > 0 && (
        <View style={styles.records}>
          <Ionicons name="star" size={14} color={LIME_INK} />
          <Text variant="bodyMedium" style={[styles.flex, { color: LIME_INK }]} numberOfLines={2}>
            {report.records.length === 1
              ? `New record on ${report.records[0]!.name}`
              : `${report.records.length} new records, led by ${report.records[0]!.name}`}
          </Text>
        </View>
      )}

      {report.highlights.length > 0 && (
        <View style={styles.block}>
          <Text variant="overline" style={{ color: MUTED }}>
            Coach&apos;s notes
          </Text>
          {report.highlights.map((line) => (
            <View key={line} style={styles.note}>
              <View style={[styles.noteMark, { backgroundColor: LIME }]} />
              <Text variant="caption" style={[styles.flex, { color: TEXT }]}>
                {line}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Tile({ label, value, now, before }: { label: string; value: string; now: number; before: number }) {
  const change = before > 0 ? percentChange(now, before) : null;
  return (
    <View style={[styles.tile, { backgroundColor: CARD }]}>
      <Text variant="overline" style={{ color: MUTED }} numberOfLines={1}>
        {label}
      </Text>
      <Text variant="title" style={{ color: TEXT }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text variant="caption" style={{ color: change === null || change === 0 ? DIM : change > 0 ? LIME : MUTED }}>
        {change === null ? ' ' : change === 0 ? 'same' : `${change > 0 ? '▲' : '▼'} ${Math.abs(change)}%`}
      </Text>
    </View>
  );
}

/** Volume per day or week. The bars rise once, in order, when the page lands. */
function Bars({ report }: { report: TrainingReport }) {
  const max = Math.max(1, ...report.buckets.map((bucket) => bucket.volumeKg));
  const peak = report.buckets.reduce(
    (best, bucket, index) => (bucket.volumeKg > (report.buckets[best]?.volumeKg ?? 0) ? index : best),
    0,
  );
  // Labels thin out when there are too many to read under the bars.
  const every = Math.ceil(report.buckets.length / 8);

  return (
    <View style={[styles.chart, { backgroundColor: CARD }]}>
      <Text variant="overline" style={{ color: MUTED }}>
        Volume {report.days <= 14 ? 'per day' : 'per week'}
      </Text>
      <View style={styles.plot}>
        {report.buckets.map((bucket, index) => (
          <View key={index} style={styles.slot}>
            <Bar
              share={bucket.volumeKg / max}
              color={bucket.volumeKg === 0 ? LINE : index === peak ? LIME : LIME_SOFT}
              index={index}
            />
            <Text variant="caption" style={[styles.barLabel, { color: bucket.volumeKg > 0 ? MUTED : DIM }]} numberOfLines={1}>
              {index % every === 0 ? bucket.label : ' '}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const PLOT_HEIGHT = 96;

function Bar({ share, color, index }: { share: number; color: string; index: number }) {
  const rise = useSharedValue(0);
  useEffect(() => {
    rise.set(
      withDelay(
        Math.min(index * STAGGER_STEP_MS, STAGGER_MAX_MS * 2),
        withTiming(1, { ...timing.content, easing: easing.out }),
      ),
    );
  }, [rise, index]);

  const height = share > 0 ? Math.max(6, share * PLOT_HEIGHT) : 4;
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: rise.get() }] }));

  return (
    <View style={styles.barTrack}>
      <Animated.View
        style={[styles.bar, { height, backgroundColor: color, borderRadius: share > 0 ? radius.sm : 2 }, style]}
      />
    </View>
  );
}

function weight(kg: number, unit: TrainingReport['unit']): string {
  const value = toUnit(kg, unit);
  return `${value >= 100 ? Math.round(value) : Math.round(value * 2) / 2} ${unit}`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.lg },
  poster: {
    backgroundColor: INK,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.xl,
    overflow: 'hidden',
  },
  posterHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wordmark: { letterSpacing: 2.4 },
  period: { alignItems: 'flex-end', gap: 2 },
  hero: { gap: spacing.xs },
  figureRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  figure: { fontSize: 64, lineHeight: 70, letterSpacing: -2, ...font('bold') },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, borderRadius: radius.lg, padding: spacing.md, gap: 2 },
  chart: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  slot: { flex: 1, alignItems: 'center', gap: spacing.xs },
  barTrack: { height: PLOT_HEIGHT, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '70%', maxWidth: 28, transformOrigin: 'bottom' },
  barLabel: { fontSize: 10 },
  block: { gap: spacing.sm },
  liftRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rank: { width: 22 },
  records: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: LIME,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  note: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  noteMark: { width: 5, height: 5, marginTop: 6 },
  actions: { gap: spacing.sm },
});
