import { notFound } from 'next/navigation';
import { PrintableWorksheet } from '@/app/components/printable-worksheet';
import { juniorPracticeSheets } from '@/lib/practice';

export default async function XiaobaoWorksheetPage({
  params,
}: {
  params: Promise<{ sheetId: string }>;
}) {
  const { sheetId } = await params;
  const index = juniorPracticeSheets.findIndex((sheet) => sheet.id === sheetId);
  if (index < 0) notFound();
  const sheet = juniorPracticeSheets[index];
  return (
    <PrintableWorksheet
      sheet={sheet}
      hubHref="/xiaobao/practice"
      previousHref={
        index > 0
          ? `/xiaobao/practice/${juniorPracticeSheets[index - 1].id}`
          : undefined
      }
      nextHref={
        index < juniorPracticeSheets.length - 1
          ? `/xiaobao/practice/${juniorPracticeSheets[index + 1].id}`
          : undefined
      }
    />
  );
}
