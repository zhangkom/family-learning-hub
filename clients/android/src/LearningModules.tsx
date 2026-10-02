import { BookOpenCheck, ChevronRight, GitBranch, Mountain, Network } from 'lucide-react';

export function LearningModules({ onReview, onKnowledge }: { onReview: () => void; onKnowledge: () => void }) {
  return <section className="learning-entry" aria-label="学习栏目">
    <h1>每次回看，都有新的收获。</h1>
    <div className="learning-grid">
      <button className="learning-module module-review" onClick={onReview}>
        <span className="module-top"><BookOpenCheck size={23} /><ChevronRight size={16} /></span>
        <strong>温故知新</strong><small>回看易错 · 巩固薄弱</small>
      </button>
      <article className="learning-module module-practice" aria-label="融会贯通，开发中">
        <span className="module-top"><GitBranch size={23} /><em>开发中</em></span>
        <strong>融会贯通</strong><small>举一反三 · 巩固提升</small>
      </article>
      <button className="learning-module module-knowledge" onClick={onKnowledge}>
        <span className="module-top"><Network size={23} /><ChevronRight size={16} /></span>
        <strong>知识星图</strong><small>串联概念 · 理清脉络</small>
      </button>
      <article className="learning-module module-challenge" aria-label="破茧成蝶，开发中">
        <span className="module-top"><Mountain size={23} /><em>开发中</em></span>
        <strong>破茧成蝶</strong><small>拆解难题 · 逐步攻克</small>
      </article>
    </div>
  </section>;
}
