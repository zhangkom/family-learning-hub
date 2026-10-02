import { scanSubjects } from './scans';
export type AbilityDimension = { id: string; label: string; description: string };
export type AbilityEvidence = {
  sessionId: string; taskId: string; attemptId: string; scanId: string; questionId: string;
  mode: 'practice' | 'challenge';
  verdict: 'correct' | 'partial' | 'incorrect'; helped: false; prompt: string; answer: string;
};
export type AbilityAxis = {
  subject: string; id: string; label: string; score: number | null; evidenceCount: number; sourceCount: number;
  confidence: 'insufficient' | 'limited' | 'supported'; summary: string; evidence: AbilityEvidence[];
  grade: string; gradeFocus: string;
};
const dimension = (id: string, label: string, description: string): AbilityDimension => ({ id, label, description });
export const abilityDimensions: Record<string, AbilityDimension[]> = {
  数学: [dimension('concept', '概念理解', '数学概念、性质与适用条件'), dimension('calculation', '运算能力', '代数运算、数值计算与单位'), dimension('reasoning', '逻辑推理', '论证、推导与条件关系'), dimension('spatial', '图形空间', '几何关系、图形变换与空间想象'), dimension('modeling', '建模应用', '从情境建立方程、函数或几何模型'), dimension('transfer', '综合迁移', '多知识点联系与新条件下的方法迁移')],
  语文: [dimension('accumulation', '语言积累', '字词、文言实词虚词、句式与文化常识'), dimension('context', '语境理解', '联系上下文理解词句、断句和文言翻译'), dimension('text_analysis', '文本分析', '梳理内容、结构、论证与人物形象'), dimension('appreciation', '鉴赏评价', '结合文本证据分析表达手法、情感与观点'), dimension('expression', '表达组织', '准确概括、组织依据与形成连贯表达'), dimension('transfer', '综合迁移', '跨文本比较、语言知识迁移与新情境运用')],
  英语: [dimension('vocabulary', '词汇运用', '词义、搭配与语境运用'), dimension('grammar', '语法结构', '句法、时态与结构关系'), dimension('reading', '阅读理解', '信息定位、主旨与推断'), dimension('expression', '书面表达', '内容组织、表达与衔接'), dimension('context', '语境分析', '交际情境、篇章逻辑与文化信息'), dimension('transfer', '综合运用', '跨情境整合语言知识完成任务')],
  地理: [dimension('concept', '地理概念', '地理过程、规律及条件'), dimension('map', '图表判读', '地图、统计图与空间信息'), dimension('spatial', '区域认知', '区域特征、尺度和位置联系'), dimension('reasoning', '综合分析', '多要素关系与因果推理'), dimension('human_environment', '人地关系', '人类活动、环境影响与协调'), dimension('application', '实践应用', '地理资料解释与真实问题方案')],
  物理: [dimension('concept', '物理观念', '物理量、规律与适用条件'), dimension('modeling', '模型建构', '对象、过程和理想模型'), dimension('reasoning', '科学推理', '证据、规律与定量或定性推导'), dimension('calculation', '定量计算', '关系式、单位与数量计算'), dimension('experiment', '实验探究', '变量、操作、测量与误差'), dimension('transfer', '综合应用', '多过程联系和新情境应用')],
  化学: [dimension('concept', '化学观念', '物质组成、性质和变化'), dimension('representation', '符号表征', '化学用语及宏观微观对应'), dimension('reasoning', '变化推理', '反应规律、证据与物质转化'), dimension('calculation', '定量计算', '守恒、计量与浓度计算'), dimension('experiment', '实验探究', '方案、操作、现象与证据'), dimension('application', '综合应用', '物质分析和真实情境问题')],
  生物: [dimension('concept', '生命观念', '结构功能、物质能量与生命系统'), dimension('process', '过程机制', '生理、遗传与生态过程'), dimension('reasoning', '科学推理', '证据、逻辑及模型解释'), dimension('experiment', '实验探究', '假设、变量、实验和结论'), dimension('data', '图表分析', '生物图示、数据与统计关系'), dimension('application', '综合应用', '健康、生态及技术情境应用')],
};
export const abilityGrades = ['初一', '初二', '初三', '高一', '高二', '高三'] as const;
export type AbilityGrade = typeof abilityGrades[number];
// These are reference learning emphases, not a claim that every textbook uses
// the same order. The student's actual confirmed material remains authoritative.
export const abilityGradeFocus: Record<string, Record<AbilityGrade, string>> = {
  数学: { 初一: '数与式、方程及基础几何', 初二: '代数关系、几何推理与数据分析', 初三: '函数、相似圆及综合应用', 高一: '集合、函数与基本数学模型', 高二: '几何代数联系、概率与综合推理', 高三: '核心方法整合与复杂条件迁移' },
  语文: { 初一: '字词积累、基本文意与叙事表达', 初二: '文言词句、文本结构与说明论述', 初三: '古今文本比较、证据分析与完整表达', 高一: '文言实词虚词、句式翻译与文本分析', 高二: '古文语境推断、文学鉴赏与论证表达', 高三: '古文阅读整合、跨文本迁移与综合写作' },
  英语: { 初一: '基础词句、日常情境与短文信息', 初二: '语法联系、篇章理解与基本表达', 初三: '语篇整合、推断与完整写作', 高一: '主题语境、阅读策略与表达组织', 高二: '复杂语篇、论证关系与语言准确性', 高三: '综合理解、信息整合与独立表达' },
  地理: { 初一: '地图基础、自然地理与世界区域', 初二: '中国区域、地理联系与图表分析', 初三: '已有课程的区域联系与综合实践', 高一: '自然和人文过程的基本规律', 高二: '区域问题、多要素联系与资料解释', 高三: '跨尺度整合与综合情境应用' },
  物理: { 初一: '按实际课程记录科学观察与基础量', 初二: '基础物理量、现象规律与实验方法', 初三: '多过程联系、电学及定量应用', 高一: '运动、受力与守恒模型', 高二: '电磁等过程的规律、模型和实验', 高三: '综合模型、定量推理与实验整合' },
  化学: { 初一: '按实际课程记录物质观察与实验基础', 初二: '按实际课程记录物质性质与变化', 初三: '物质性质、化学用语与基本反应', 高一: '物质结构、反应和计量基础', 高二: '反应原理、物质结构及综合实验', 高三: '物质转化、信息推理与实验整合' },
  生物: { 初一: '生命系统、结构功能与观察实验', 初二: '生理遗传、生态联系与实验解释', 初三: '已有课程生命系统的联系与应用', 高一: '细胞、物质能量及基本过程', 高二: '遗传、调节与生态的机制分析', 高三: '生命过程整合与实验数据推理' },
};
export function normalizedAbilityGrade(grade?: string): AbilityGrade | undefined {
  const value = (grade || '').trim();
  const aliases: Record<string, AbilityGrade> = { 七年级: '初一', 八年级: '初二', 九年级: '初三', '7年级': '初一', '8年级': '初二', '9年级': '初三', '10年级': '高一', '11年级': '高二', '12年级': '高三' };
  return abilityGrades.find(g => value.includes(g)) || Object.entries(aliases).find(([alias]) => value.startsWith(alias))?.[1];
}
export function abilityProfile(subject: string, grade?: string) {
  const normalized = normalizedAbilityGrade(grade);
  return { subject, grade: grade?.trim() || '未设置年级', gradeFocus: normalized ? abilityGradeFocus[subject]?.[normalized] || '结合实际课程与错题材料' : '结合实际课程与错题材料，年级目标待核对', dimensions: abilityDimensions[subject] || [] };
}
export const abilitySubjects = [...scanSubjects];
