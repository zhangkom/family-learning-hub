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
  if (!request.messages?.[0]?.content?.includes('单题辅导助手'))
    throw new Error('This fixture supports selected-question tutoring only');
  return Response.json({
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            questions: [
              {
                transcribedPrompt:
                  '合成测试题：物体以 2 m/s 匀速运动 3 s，求路程。',
                referenceAnswer: '6 m',
                explanation: '合成模型：由 s=vt，得到 s=2×3=6 m。请核对原题。',
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
