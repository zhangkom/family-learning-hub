import type { StudyLesson, StudyQuestion } from '../study';

export const mathReference = {
  title: '数学课标：绝对值、整式与运算',
  url: 'https://www.pep.com.cn/xw/zt/rjwy/yjkb2022/202205/P020220512583134605579.pdf',
};
export const geoReference = {
  title: '地理概念参考：地图与经纬网',
  url: 'https://education.nationalgeographic.org/resource/map/',
};
export const englishReference = {
  title: 'British Council：一般现在时',
  url: 'https://learnenglishteens.britishcouncil.org/grammar/a1-a2-grammar/present-simple',
};
export const seniorReference = {
  title: '国家中小学智慧教育平台（按课本版本选课）',
  url: 'https://basic.smartedu.cn/',
};

type QuestionSeed = [
  prompt: string,
  options: string[],
  correct: number,
  explanation: string,
];
export function lesson(
  seed: Omit<StudyLesson, 'questions' | 'minutes'> & {
    minutes?: number;
    questions: QuestionSeed[];
  },
): StudyLesson {
  return {
    ...seed,
    minutes: seed.minutes ?? 15,
    questions: seed.questions.map(
      ([prompt, options, correct, explanation], i): StudyQuestion => ({
        id: `${seed.id}-q${i + 1}`,
        prompt,
        options,
        correct,
        explanation,
      }),
    ),
  };
}
