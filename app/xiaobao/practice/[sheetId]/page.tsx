import { notFound } from 'next/navigation';
import { PrintableWorksheet } from '@/app/components/printable-worksheet';
import { juniorMathChapterOne } from '@/lib/practice';

export default async function XiaobaoWorksheetPage({
  params,
}: {
  params: Promise<{ sheetId: string }>;
}) {
  const { sheetId } = await params;
  const index = juniorMathChapterOne.findIndex((sheet) => sheet.id === sheetId);
  if (index < 0) notFound();
  const sheet = juniorMathChapterOne[index];
  return (
    <PrintableWorksheet
      sheet={sheet}
      hubHref="/xiaobao/practice"
      previousHref={
        index > 0
          ? `/xiaobao/practice/${juniorMathChapterOne[index - 1].id}`
          : undefined
      }
      nextHref={
        index < juniorMathChapterOne.length - 1
          ? `/xiaobao/practice/${juniorMathChapterOne[index + 1].id}`
          : undefined
      }
    />
  );
}
