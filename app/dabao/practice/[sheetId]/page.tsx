import { notFound } from 'next/navigation';
import { PrintableWorksheet } from '@/app/components/printable-worksheet';
import { seniorPracticeSheets } from '@/lib/practice';

export default async function DabaoWorksheetPage({
  params,
}: {
  params: Promise<{ sheetId: string }>;
}) {
  const { sheetId } = await params;
  const index = seniorPracticeSheets.findIndex((sheet) => sheet.id === sheetId);
  if (index < 0) notFound();
  const sheet = seniorPracticeSheets[index];
  return (
    <PrintableWorksheet
      sheet={sheet}
      hubHref="/dabao/practice"
      previousHref={
        index > 0
          ? `/dabao/practice/${seniorPracticeSheets[index - 1].id}`
          : undefined
      }
      nextHref={
        index < seniorPracticeSheets.length - 1
          ? `/dabao/practice/${seniorPracticeSheets[index + 1].id}`
          : undefined
      }
    />
  );
}
