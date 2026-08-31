import { notFound } from 'next/navigation';
import { PrintableWorksheet } from '@/app/components/printable-worksheet';
import { seniorGradeTwoStarters } from '@/lib/practice';

export default async function DabaoWorksheetPage({
  params,
}: {
  params: Promise<{ sheetId: string }>;
}) {
  const { sheetId } = await params;
  const index = seniorGradeTwoStarters.findIndex(
    (sheet) => sheet.id === sheetId,
  );
  if (index < 0) notFound();
  const sheet = seniorGradeTwoStarters[index];
  return (
    <PrintableWorksheet
      sheet={sheet}
      hubHref="/dabao/practice"
      previousHref={
        index > 0
          ? `/dabao/practice/${seniorGradeTwoStarters[index - 1].id}`
          : undefined
      }
      nextHref={
        index < seniorGradeTwoStarters.length - 1
          ? `/dabao/practice/${seniorGradeTwoStarters[index + 1].id}`
          : undefined
      }
    />
  );
}
