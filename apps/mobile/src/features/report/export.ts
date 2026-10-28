/**
 * Turning a report into a file someone can send.
 *
 * The drawing is `renderReportPdf` in `@lift/shared/report`, plain JavaScript,
 * so this needs no print module and ships in an over-the-air update. What is
 * left here is the platform: where the typeface bytes come from, and how a
 * finished file leaves the app (a share sheet on a phone, a download in a
 * browser).
 */

import { renderReportPdf, reportTitle, type ReportFonts, type TrainingReport } from '@lift/shared/report';
import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

const FONT_MODULES = {
  regular: require('../../../assets/fonts/JetBrainsSans-Regular.ttf'),
  semibold: require('../../../assets/fonts/JetBrainsSans-SemiBold.ttf'),
  bold: require('../../../assets/fonts/JetBrainsSans-Bold.ttf'),
} as const;

let fonts: Promise<ReportFonts> | null = null;

/** The app's own typeface, as bytes for the PDF. Read once per launch. */
function loadFonts(): Promise<ReportFonts> {
  fonts ??= (async () => {
    const read = async (module: number): Promise<Uint8Array> => {
      const asset = await Asset.fromModule(module).downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      if (Platform.OS === 'web') return new Uint8Array(await (await fetch(uri)).arrayBuffer());
      return new File(uri).bytes();
    };
    const [regular, semibold, bold] = await Promise.all([
      read(FONT_MODULES.regular),
      read(FONT_MODULES.semibold),
      read(FONT_MODULES.bold),
    ]);
    return { regular, semibold, bold };
  })();
  // A failed read is not kept: the next export tries again.
  fonts.catch(() => {
    fonts = null;
  });
  return fonts;
}

export function reportFileName(report: TrainingReport): string {
  const end = new Date(report.to - 1).toISOString().slice(0, 10);
  return `lift-${reportTitle(report.days).toLowerCase().replace(/\s+/g, '-')}-${end}.pdf`;
}

/** Draws the report and hands it to the share sheet, or downloads it in a browser. */
export async function exportReportPdf(report: TrainingReport): Promise<void> {
  const bytes = await renderReportPdf(report, await loadFonts());
  const name = reportFileName(report);

  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }

  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: name });
}
