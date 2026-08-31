import type { PracticeSheet } from '@/lib/practice';

export function WorksheetPaper({ sheet }: { sheet: PracticeSheet }) {
  return (
    <article className="worksheet-paper mx-auto bg-white">
      <header className="worksheet-heading">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="worksheet-brand">双宝名校计划 · 原创强化训练</p>
            <h1>{sheet.title}</h1>
            <p>{sheet.subtitle}</p>
          </div>
          <div className="worksheet-seal">
            {sheet.stage}
            <br />
            {sheet.subject}
          </div>
        </div>
        <div className="worksheet-meta">
          <span>姓名：____________</span>
          <span>日期：____________</span>
          <span>用时：______ 分</span>
          <span>得分：______</span>
        </div>
        <div className="worksheet-focus">
          <strong>本页目标：</strong>
          {sheet.focus.join(' · ')}　　<strong>建议：</strong>
          先独立完成，再检查步骤。
        </div>
      </header>

      <ol className="worksheet-questions">
        {sheet.questions.map((question, index) => (
          <li key={question.id} className="worksheet-question">
            <div className="worksheet-question-line">
              <span className="worksheet-number">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p>
                  <span className="worksheet-kind">
                    {question.kind} · {question.difficulty}
                  </span>
                  {question.prompt}
                </p>
                {question.options && (
                  <div className="worksheet-options">
                    {question.options.map((option) => (
                      <span key={option}>{option}</span>
                    ))}
                  </div>
                )}
              </div>
              <span className="worksheet-mark">批改　□ 对　□ 错</span>
            </div>
            <div
              className="worksheet-answer-space"
              aria-label={`第${index + 1}题答题区`}
            >
              {Array.from({ length: question.answerLines }, (_, line) => (
                <span key={line} />
              ))}
            </div>
          </li>
        ))}
      </ol>

      <footer className="worksheet-footer">
        <span>{sheet.chapter}</span>
        <span>页码 ID：{sheet.id}</span>
        <span>题目为双宝学习平台原创</span>
      </footer>
    </article>
  );
}
