import type { Metadata } from 'next';
import { ChildDashboard, type ChildPlan } from '@/app/components/child-dashboard';

export const metadata: Metadata = { title: '大宝成长页｜双宝名校计划' };

const plan: ChildPlan = {
  id: 'dabao',
  name: '大宝',
  stage: '高中二年级',
  graduation: '当前按 2028 届建模',
  target: '中山大学 · 专业待探索',
  targetNote: '高二的核心不是提前进入高三题海，而是确定选科与专业方向、补齐核心知识网络，并让错题能够真正回炉。毕业年份请按学校实际学籍确认。',
  accent: 'coral',
  tasks: [
    { id: 'score-audit', title: '做一次全科成绩盘点', detail: '录入最近三次大考：分数、校排名/年级排名、失分题型和考试状态。', minutes: 35 },
    { id: 'error-loop', title: '重做 6 道高价值错题', detail: '优先数学与选考科目；每题只记录错因、关键转折和一道变式。', minutes: 45 },
    { id: 'english-input', title: '完成英语“读 + 听说”组合', detail: '精读一篇文章并做 15 分钟听说，记录三个可复用表达。', minutes: 35 },
    { id: 'family-review', title: '参加周日家庭复盘', detail: '只回答三问：本周进步、最大卡点、下周最重要的三件事。', minutes: 30 },
  ],
  subjects: [
    { name: '语文', role: '统一高考科目', focus: '建立现代文、古诗文、写作三类证据库；作文按审题—结构—素材复盘。', routine: '每周 1 次阅读复盘 + 1 个作文片段', status: '稳住' },
    { name: '数学', role: '统一高考科目', focus: '按函数、几何、概率统计等模块追踪“不会、会而错、来不及”三类错因。', routine: '隔天 20 分钟小题包 + 周末变式', status: '主攻' },
    { name: '英语', role: '统一高考科目（含听说）', focus: '阅读、写作、听说并行，避免只背单词；把词汇放回语境复现。', routine: '每日 20 分钟输入 + 每周 2 次听说', status: '稳住' },
    { name: '首选科目', role: '物理 / 历史二选一', focus: '依据已选科建立章节知识图谱；成绩之外同步记录兴趣与专业限制。', routine: '每周 2 个薄弱模型 + 1 次限时', status: '主攻' },
    { name: '再选科目', role: '政地化生四选二', focus: '用等级赋分思维关注排名与稳定性，检查目标专业的选考要求。', routine: '每科每周一次知识网络自测', status: '稳住' },
    { name: '综合素质', role: '毕业与长期发展', focus: '保留研究性学习、劳动、志愿服务和真实兴趣项目成果。', routine: '每月整理一次成长档案', status: '习惯' },
  ],
  roadmap: [
    { term: '2026 秋 · 高二上', title: '完成基线诊断', outcome: '三次考试数据齐全；确定 2 门主攻学科和统一错因标签' },
    { term: '2027 春 · 高二下', title: '形成学科知识网络', outcome: '主要模块一轮打通；高频错因连续两次复测达标' },
    { term: '2027 暑假', title: '一轮复习衔接', outcome: '核心基础无大洞；能独立制定并完成 6 周计划' },
    { term: '2027 秋—2028 春 · 高三', title: '从模块走向整卷', outcome: '成绩与年级/省排位进入目标区间，考试策略稳定' },
    { term: '2028 六月 · 高考', title: '稳定发挥与志愿决策', outcome: '按专业兴趣、选考要求和近三年位次完成梯度志愿' },
  ],
  policyTitle: '广东高中：课程 + “3+1+2”升学结构',
  policyFacts: [
    '广东普通高中课程包含语文、数学、外语、思想政治、历史、地理、物理、化学、生物学、技术、艺术、体育与健康、综合实践活动、劳动及校本课程。',
    '高考采用“3+1+2”：语文、数学、外语 + 物理/历史二选一 + 思政、地理、化学、生物学四选二；英语考生需参加听说考试。',
    '2025 年广东普通类投档中，中大物理类各专业组最低分 628–651、最低排位 10616–3575；历史类 623–627、最低排位 1590–1317。规划应优先看专业组与排位，不只盯总分。',
    '不少理工医专业要求同时选考物理和化学，最终必须按当年、当专业的招生要求核对。',
  ],
  sources: [
    { label: '广东高中课程实施方案', href: 'https://edu.gd.gov.cn/gkmlpt/content/3/3429/post_3429549.html' },
    { label: '广东 2025 物理类投档表', href: 'https://eea.gd.gov.cn/attachment/0/585/585886/4746786.pdf' },
    { label: '广东 2025 历史类投档表', href: 'https://eea.gd.gov.cn/attachment/0/585/585885/4746781.pdf' },
    { label: '中大强基计划选科示例', href: 'https://gaokao.chsi.com.cn/gkxx/qjjh/202504/20250418/2293376933.html' },
  ],
};

export default function DabaoPage() { return <ChildDashboard plan={plan} />; }
