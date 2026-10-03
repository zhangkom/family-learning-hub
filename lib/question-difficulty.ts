export type DifficultyStars = 1 | 2 | 3 | 4 | 5;
export type QuestionDifficulty = {
  stars: DifficultyStars;
  source: 'user' | 'ai';
  updatedAt: string;
  actorAccountId?: string;
};
export type QuestionDifficultyInput = { studentId: string; revision: number; stars: DifficultyStars };
export function questionDifficultyStars(question: { difficulty?: QuestionDifficulty }): DifficultyStars {
  const stars = question.difficulty?.stars;
  return stars && Number.isInteger(stars) && stars >= 1 && stars <= 5 ? stars : 3;
}
