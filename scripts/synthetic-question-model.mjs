// Explicit local integration fixture. Never import this into production.
if (
  process.env.FAMILY_AI_BASE_URL !== 'https://synthetic-model.invalid/v1' ||
  process.env.FAMILY_AI_API_KEY !== 'synthetic-key-not-a-credential'
)
  throw new Error('Synthetic model requires the isolated test configuration');

globalThis.fetch = async (url, options) => {
  if (
    typeof url !== 'string' ||
    url !== 'https://synthetic-model.invalid/v1/chat/completions'
  )
    throw new Error('Synthetic model refuses all external network requests');
  const request = JSON.parse(options.body);
  const delay = Number(process.env.FAMILY_SYNTHETIC_MODEL_DELAY_MS || 0);
  if (!Number.isInteger(delay) || delay < 0 || delay > 30000)
    throw new Error('Invalid synthetic delay');
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  const guide = request.messages[0].content;
  const contextText = request.messages[1].content[0].text;
  const context = () => JSON.parse(contextText.slice(contextText.indexOf('\n') + 1));
  const reply = questions => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questions }) } }] });
  if (guide.includes('独立的题目核验老师')) return reply(context().map(task => ({ approved: true, reason: '合成核验通过', answer: task.answer, explanation: task.explanation })));
  if (guide.includes('只批改这次新提交的作答')) {
    const input = context(); const correct = input.learnerAnswer.includes(input.referenceAnswer);
    return reply([{ verdict: correct ? 'correct' : 'incorrect', feedback: correct ? '合成核对：代入与计算正确。' : '合成核对：请再检查代入的数值。', nextStep: correct ? '尝试独立复测。' : '先列出已知量，再计算。', evidence: [input.learnerAnswer] }]);
  }
  if (guide.includes('中学生学习辅导老师')) {
    const input = context(), count = input.mode === 'practice' ? 3 : 1;
    return reply(Array.from({ length: count }, (_, i) => {
      const seconds = input.mode === 'retest' ? 10 + input.previousQuestions.length : input.mode === 'challenge' ? 3 : 4 + i;
      return { prompt: `物体以 2 m/s 匀速运动 ${seconds} s，求路程，并写出计算步骤。`, difficulty: input.mode === 'retest' ? '独立迁移' : '基础巩固', knowledgePoints: ['匀速运动'], hints: ['先区分速度、时间和路程。','使用路程等于速度乘时间。','把速度与时间代入，并检查单位。'], answer: `${seconds * 2} m`, explanation: `s=vt=2×${seconds}=${seconds * 2} m。` };
    }));
  }
  if (!guide.includes('单题辅导助手')) throw new Error('Unexpected synthetic model task');
  const corrected = request.messages[1].content[0].text.includes('"correctedPrompt"');
  return Response.json({
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            questions: [
              {
                transcribedPrompt:
                  corrected ? '合成测试题：物体以 2 m/s 匀速运动 4 s，求路程。' : '合成测试题：物体以 2 m/s 匀速运动 3 s，求路程。',
                referenceAnswer: corrected ? '8 m' : '6 m',
                explanation: corrected ? '合成模型：由 s=vt，得到 s=2×4=8 m。请核对原题。' : '合成模型：由 s=vt，得到 s=2×3=6 m。请核对原题。',
                answerEvidence: [],
                errorHypotheses: [],
                uncertainties: ['这是隔离测试响应，不是真实模型解答'],
              },
            ],
          }),
        },
      },
    ],
  });
};
