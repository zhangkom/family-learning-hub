import type { Metadata } from 'next';
import { ChildDashboard, type ChildPlan } from '@/app/components/child-dashboard';

export const metadata: Metadata = { title: '小宝成长页｜双宝名校计划' };

const plan: ChildPlan = {
  id: 'xiaobao',
  name: '小宝',
  stage: '初中一年级',
  graduation: '当前按 2029 中考建模',
  target: '优质高中 · 为中大打基础',
  targetNote: '初一最值钱的是习惯和基本能力：听课有产出、作业能订正、错题会回炉、运动能坚持。深圳现行新中考方案把实验、体育过程与英语听说都纳入了长期准备。',
  accent: 'teal',
  tasks: [
    { id: 'daily-clear', title: '清空本周课堂遗留问题', detail: '语数英各挑一个真正没弄懂的问题，完成“问清—重做—讲给家人听”。', minutes: 40 },
    { id: 'error-rerun', title: '重做 5 道典型错题', detail: '遮住答案独立做；会做后再换数字、换问法，确认不是记住答案。', minutes: 35 },
    { id: 'reading-listening', title: '完成阅读与英语听说', detail: '中文整本书阅读 30 分钟，英语跟读/复述 15 分钟。', minutes: 45 },
    { id: 'sport', title: '完成 3 次体能小练习', detail: '围绕选定中考体育项目练基础体能；每次 20 分钟并记录感受。', minutes: 60 },
    { id: 'family-review', title: '参加周日家庭复盘', detail: '展示一项进步、一张错题卡，并自己提出下周目标。', minutes: 30 },
  ],
  subjects: [
    { name: '语文', role: '中考 120 分', focus: '重视阅读证据、古诗文积累和表达；从初一开始建立自己的阅读素材库。', routine: '每日阅读 20 分钟 + 每周一段表达', status: '稳住' },
    { name: '数学', role: '中考 100 分', focus: '训练计算准确、概念辨析和步骤表达；错题按知识、方法、习惯分类。', routine: '每日 15 分钟计算/小题 + 周复测', status: '主攻' },
    { name: '英语', role: '中考 100 分（听说 25）', focus: '词汇放在句子中学习，阅读与人机听说同步积累，避免初三突击口语。', routine: '每日 15 分钟听读 + 每周 2 次复述', status: '稳住' },
    { name: '物理与化学', role: '合卷 140 分（含实验 20）', focus: '当前先养成观察、测量、记录和规范表达习惯；后续同步沉淀实验卡。', routine: '每月一个家庭小实验或观察记录', status: '专项' },
    { name: '历史与道法', role: '历史 70 + 道法 50', focus: '历史用时间线和因果链，道法练材料定位；道法开卷也需要知识结构。', routine: '每周一张时间线/思维导图', status: '稳住' },
    { name: '体育与健康', role: '中考 50 分', focus: '过程性评价贯穿初中三年；尽早选主项，兼顾体测、通识和现场考试。', routine: '每周至少 3 次 20–30 分钟训练', status: '主攻' },
    { name: '地理与生物', role: '八下考试，录取参考', focus: '合卷 100 分，成绩不计总分但用于同分比较；生物含实验操作。', routine: '每周各一次图表/概念复习', status: '习惯' },
    { name: '信息科技等', role: '录取参考 / 全面发展', focus: '信息科技、艺术、劳动、综合实践等都属于国家课程，按学校要求完成。', routine: '每学期保留一项作品或项目记录', status: '习惯' },
  ],
  roadmap: [
    { term: '2026 秋—2027 夏 · 初一', title: '建立学习操作系统', outcome: '能自己列周计划、订正、复测；语数英基础稳定，体育形成习惯' },
    { term: '2027 秋—2028 夏 · 初二', title: '新增学科不掉队', outcome: '物理建立模型意识；生地会考前完成两轮复习与实验准备' },
    { term: '2028 暑假', title: '初二升初三衔接', outcome: '补齐数学、英语、物理基础漏洞；提前熟悉化学与中考节奏' },
    { term: '2028 秋—2029 春 · 初三', title: '整合知识与专项能力', outcome: '理化实验、英语听说、体育与文化课按时间表分别达标' },
    { term: '2029 六月 · 中考', title: '稳定发挥与高中衔接', outcome: '依据最新招生政策和学校梯度完成志愿；暑期衔接高中学习方式' },
  ],
  policyTitle: '深圳新中考：630 分 + 多项长期能力',
  policyFacts: [
    '2026 年起深圳中考总分 630：语文 120、数学 100、英语 100、物理与化学合卷 140、历史 70、道德与法治 50、体育与健康 50。',
    '英语听说占英语 25 分；理化实验操作共 20 分；体育由现场统一考试 36 分和过程性评价 14 分构成，不能只在初三突击。',
    '道德与法治为开卷笔试；地理与生物合卷 100 分，在八年级下学期考试，不计总分但用于同分比较。',
    '国家义务教育课程还包含信息科技、艺术、劳动和综合实践活动，网页将它们作为成长档案而非“可忽略副科”。',
  ],
  sources: [
    { label: '深圳 2026 中考工作通知', href: 'https://szeb.sz.gov.cn/szzkw/zkgg/zkxx/content/post_12687196.html' },
    { label: '深圳中考改革实施意见', href: 'https://szeb.sz.gov.cn/szzkw/qt/tzgg/content/post_11214698.html' },
    { label: '义务教育课程方案（2022）', href: 'https://www.moe.gov.cn/srcsite/A26/s8001/202204/W020220420582343217634.pdf' },
    { label: '深圳体育考试规则', href: 'https://szeb.sz.gov.cn/szzkw/zkgg/zkxx/content/post_12216301.html' },
  ],
};

export default function XiaobaoPage() { return <ChildDashboard plan={plan} />; }
