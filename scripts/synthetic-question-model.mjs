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
  if (guide.includes('薄弱点依据核验老师')) return reply([{ approved: true, rejectionCode: 'none', reason: '隔离合成模型：引用与补强方向一致' }]);
  if (guide.includes('薄弱点分析助手')) {
    const input = context(), bySubject = new Map();
    for (const source of input.sources) { const group = bySubject.get(source.subject) || []; group.push(source); bySubject.set(source.subject, group); }
    const focuses = [...bySubject.values()].filter(group => group.length >= 2).slice(0, 2).map(group => ({
      title: '从题目条件提取已知量并建立关系', subject: group[0].subject, priority: 'medium', basis: 'wrong_question_pattern',
      dimensionId: input.profiles.find(profile => profile.subject === group[0].subject)?.dimensions.find(d => d.id === 'modeling')?.id || input.profiles.find(profile => profile.subject === group[0].subject)?.dimensions[0]?.id,
      knowledgePoints: ['已知条件与数量关系'],
      reason: '这些已收录错题共同要求根据已知条件建立数量关系，建议作为待核对的补强方向。',
      practiceDirection: '逐题列出已知量与目标量，写清关系式；完成后用新的条件独立复测。',
      evidence: group.slice(0, 2).map(source => ({ sourceId: source.id, kind: 'question', quote: source.prompt.slice(0, 100), reason: '题干包含需要整理的已知条件。' })),
    }));
    return reply([{ summary: '基于本次错题样本的 AI 待核对学习建议。', focuses, limitations: ['隔离合成模型响应，只验证流程，不代表真实教学分析。', '错题分布不能证明具体错因，需要结合真实作答继续核对。'] }]);
  }
  if (guide.includes('独立的题目核验老师')) return reply(context().map(task => ({ approved: true, reason: '合成核验通过', answer: task.answer, explanation: task.explanation })));
  if (guide.includes('只批改这次新提交的作答')) {
    const input = context(); const correct = input.learnerAnswer.includes(input.referenceAnswer);
    return reply([{ verdict: correct ? 'correct' : 'incorrect', feedback: correct ? '合成核对：代入与计算正确。' : '合成核对：请再检查代入的数值。', nextStep: correct ? '尝试独立复测。' : '先列出已知量，再计算。', evidence: [input.learnerAnswer] }]);
  }
  if (guide.includes('中学生学习辅导老师')) {
    const input = context(), count = input.mode === 'practice' ? 3 : 1;
    if (input.source.subject === '数学' && input.mode !== 'challenge') {
      // Different original conditions produce distinct independently graded items.
      // This branch is used only by the isolated ability-flow fixture.
      const base = Number(input.source.prompt.match(/\d+/)?.[0] || 1) * 2;
      return reply(Array.from({ length: count }, (_, i) => {
        const length = base + 1 + i + (input.mode === 'retest' ? 20 + input.previousQuestions.length : 0), width = 3 + i;
        return { prompt: `一个长方形长 ${length} 厘米，宽 ${width} 厘米。求面积，并写出计算步骤。`, difficulty: '基础巩固', knowledgePoints: ['长方形面积'],
          hints: ['先区分长、宽与面积。', '使用长方形面积等于长乘宽。', '代入长和宽相乘，并写明面积单位。'],
          answer: `${length * width} 平方厘米`, explanation: `面积=长×宽=${length}×${width}=${length * width} 平方厘米。` };
      }));
    }
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
