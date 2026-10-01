import { BookOpen, ChartNoAxesCombined, Route, Sparkles } from 'lucide-react';

const features = [
  {
    name: '错题本',
    description: '按错题回看与复习',
    icon: BookOpen,
    tone: 'blue',
    planned: true,
  },
  {
    name: '分步辅导',
    description: '循着思路找出卡点',
    icon: Route,
    tone: 'teal',
    planned: true,
  },
  {
    name: '举一反三',
    description: '围绕同类题巩固',
    icon: Sparkles,
    tone: 'violet',
    planned: true,
  },
  {
    name: '学习报告',
    description: '回顾薄弱点与进步',
    icon: ChartNoAxesCombined,
    tone: 'amber',
    planned: true,
  },
] as const;

export function FeatureCatalog({
  onSelect,
  compact = false,
}: {
  onSelect: (feature: string) => void;
  compact?: boolean;
}) {
  return (
    <section
      className={`feature-catalog${compact ? ' feature-catalog-compact' : ''}`}
      aria-label="学习工具"
    >
      <div className="feature-catalog-heading">
        <h2>学习工具</h2>
        <span>从收题开始，逐步学会</span>
      </div>
      <div className="feature-grid">
        {features.map(({ name, description, icon: Icon, tone, planned }) => (
          <button
            type="button"
            className={`feature-card feature-${tone}`}
            key={name}
            onClick={() => onSelect(name)}
            aria-label={`${name}，${planned ? '准备中，' : ''}${description}`}
          >
            <span className="feature-card-top">
              <span className="feature-icon">
                <Icon size={21} strokeWidth={1.8} />
              </span>
              {planned && <span className="feature-status">准备中</span>}
            </span>
            <strong>{name}</strong>
            <small>{description}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
