import {
  createWrongQuestion,
  type LearningSubject,
  type WrongQuestion,
} from './learning';
import { studyLessons } from './study-catalog';
import { studySource, type StudyAttempt } from './study';

export type PracticeDifficulty = '基础' | '进阶' | '挑战';
export type PracticeQuestionKind = '填空' | '选择' | '解答' | '作图';

export type PracticeQuestion = {
  id: string;
  kind: PracticeQuestionKind;
  difficulty: PracticeDifficulty;
  knowledgePoint: string;
  prompt: string;
  options?: string[];
  answer: string;
  explanation: string;
  source: string;
  answerLines: number;
};

export type PracticeSheet = {
  methodLessonId?: string;
  week?: number;
  id: string;
  child: 'xiaobao' | 'dabao';
  stage: '初一' | '高二';
  subject: LearningSubject;
  sequence: number;
  title: string;
  subtitle: string;
  chapter: string;
  focus: string[];
  duration: number;
  edition: string;
  curriculumBasis: string;
  curriculumUrl: string;
  questions: PracticeQuestion[];
};

type QuestionSeed = Omit<PracticeQuestion, 'id' | 'source'>;
type SheetSeed = Omit<PracticeSheet, 'questions'> & {
  questions: QuestionSeed[];
};

const juniorCurriculumUrl =
  'https://www.moe.gov.cn/srcsite/A26/s8001/202204/W020220420582346895190.pdf';
const seniorCurriculumUrl =
  'https://www.moe.gov.cn/srcsite/A26/s8001/202006/t20200603_462199.html';

function makeSheet(seed: SheetSeed): PracticeSheet {
  return {
    ...seed,
    questions: seed.questions.map((question, index) => ({
      ...question,
      id: `${seed.id}-q${index + 1}`,
      source: `双宝原创 · ${seed.stage}${seed.subject} · ${seed.id} · 第${index + 1}题`,
    })),
  };
}

export const juniorMathChapterOne: PracticeSheet[] = [
  makeSheet({
    id: 'g7-math-1-01',
    child: 'xiaobao',
    stage: '初一',
    subject: '数学',
    sequence: 1,
    title: '立体图形会分类',
    subtitle: '第 1 练｜从生活物体抽象出几何体',
    chapter: '七年级上册 · 第一章 丰富的图形世界',
    focus: ['常见几何体', '柱体与锥体', '棱柱要素'],
    duration: 25,
    edition: '深圳公开选用目录 · 北师大版体系',
    curriculumBasis: '义务教育数学课程标准（2022年版）· 图形与几何',
    curriculumUrl: juniorCurriculumUrl,
    questions: [
      {
        kind: '填空',
        difficulty: '基础',
        knowledgePoint: '几何体识别',
        answerLines: 2,
        prompt:
          '把下列物体近似看成相应的几何体：足球、易拉罐、魔方、生日帽。依次写出它们最接近的几何体名称。',
        answer: '球、圆柱、正方体、圆锥。',
        explanation:
          '忽略物体的纹理和厚薄，只保留整体形状，这是从实物到几何模型的抽象。',
      },
      {
        kind: '选择',
        difficulty: '基础',
        knowledgePoint: '柱体特征',
        answerLines: 1,
        prompt: '下列说法正确的是（　）。',
        options: [
          'A. 圆柱的两个底面大小不一定相同',
          'B. 棱柱的所有面都是长方形',
          'C. 圆锥只有一个底面',
          'D. 球有一个平面',
        ],
        answer: 'C。',
        explanation:
          '圆锥有一个圆形底面和一个曲面；圆柱两底面相同，棱柱侧面不必都是长方形，球没有平面。',
      },
      {
        kind: '填空',
        difficulty: '基础',
        knowledgePoint: '三棱柱要素',
        answerLines: 2,
        prompt:
          '一个三棱柱有____个面、____条棱、____个顶点，其中侧面有____个。',
        answer: '5，9，6，3。',
        explanation: '两个三角形底面加三个侧面；上下各3条底边，再加3条侧棱。',
      },
      {
        kind: '解答',
        difficulty: '进阶',
        knowledgePoint: '棱柱规律',
        answerLines: 4,
        prompt:
          '观察三棱柱、四棱柱和五棱柱，归纳 n 棱柱的面数、棱数和顶点数，并说明理由。',
        answer: '面数 n+2，棱数 3n，顶点数 2n。',
        explanation:
          '有上下两个底面和 n 个侧面；上下底各 n 条棱并有 n 条侧棱；两个底面各有 n 个顶点。',
      },
      {
        kind: '解答',
        difficulty: '挑战',
        knowledgePoint: '几何模型判断',
        answerLines: 4,
        prompt:
          '某透明包装盒有 8 个顶点、12 条棱、6 个面。它一定是正方体吗？写出判断和一个反例。',
        answer:
          '不一定。长方体也有8个顶点、12条棱、6个面，但各条棱不一定相等。',
        explanation:
          '要判断正方体还需检查六个面是否全为正方形、棱长是否相等，不能只靠数量。',
      },
    ],
  }),
  makeSheet({
    id: 'g7-math-1-02',
    child: 'xiaobao',
    stage: '初一',
    subject: '数学',
    sequence: 2,
    title: '点、线、面在运动',
    subtitle: '第 2 练｜用运动观点理解几何体',
    chapter: '七年级上册 · 第一章 丰富的图形世界',
    focus: ['点线面体', '旋转成体', '棱柱计数'],
    duration: 25,
    edition: '深圳公开选用目录 · 北师大版体系',
    curriculumBasis: '义务教育数学课程标准（2022年版）· 图形与几何',
    curriculumUrl: juniorCurriculumUrl,
    questions: [
      {
        kind: '填空',
        difficulty: '基础',
        knowledgePoint: '点线面体',
        answerLines: 2,
        prompt:
          '一支笔的笔尖在纸上移动可看成“点动成____”；一条直尺沿垂直于自身的方向平移可看成“线动成____”。',
        answer: '线，面。',
        explanation:
          '点的连续运动留下线的轨迹；线沿不与自身重合的方向运动扫出面。',
      },
      {
        kind: '填空',
        difficulty: '基础',
        knowledgePoint: '旋转成体',
        answerLines: 2,
        prompt:
          '一个长方形绕它的一条边旋转一周，形成的几何体是____；直角三角形绕一条直角边旋转一周，形成的几何体是____。',
        answer: '圆柱，圆锥。',
        explanation: '旋转轴所在边保持不动，另一条边扫出曲面。',
      },
      {
        kind: '选择',
        difficulty: '基础',
        knowledgePoint: '面相交成线',
        answerLines: 1,
        prompt: '长方体相邻两个面的交界处可以抽象成（　）。',
        options: ['A. 点', 'B. 线', 'C. 面', 'D. 体'],
        answer: 'B。',
        explanation: '两个面相交形成线，三条棱相交处形成点。',
      },
      {
        kind: '解答',
        difficulty: '进阶',
        knowledgePoint: '六棱柱计数',
        answerLines: 4,
        prompt:
          '不看实物，推算六棱柱有多少个顶点、多少条棱、多少个面，并写出你的计数方法。',
        answer: '12个顶点、18条棱、8个面。',
        explanation: '使用 n 棱柱规律：顶点2n、棱3n、面n+2，令n=6。',
      },
      {
        kind: '解答',
        difficulty: '挑战',
        knowledgePoint: '表面路径',
        answerLines: 4,
        prompt:
          '一只小虫只沿正方体的棱从一个顶点爬到与它相对的顶点，至少要经过几条棱？说明理由。',
        answer: '至少3条棱。',
        explanation:
          '相对顶点在长、宽、高三个方向都不同，每经过一条棱只能改变一个方向，所以至少改变3次。',
      },
    ],
  }),
  makeSheet({
    id: 'g7-math-1-03',
    child: 'xiaobao',
    stage: '初一',
    subject: '数学',
    sequence: 3,
    title: '展开与折叠',
    subtitle: '第 3 练｜在平面和立体之间来回想象',
    chapter: '七年级上册 · 第一章 丰富的图形世界',
    focus: ['正方体展开图', '相对面', '折叠判断'],
    duration: 30,
    edition: '深圳公开选用目录 · 北师大版体系',
    curriculumBasis: '义务教育数学课程标准（2022年版）· 图形与几何',
    curriculumUrl: juniorCurriculumUrl,
    questions: [
      {
        kind: '选择',
        difficulty: '基础',
        knowledgePoint: '正方体展开图',
        answerLines: 1,
        prompt: '正方体展开图一定由几个大小相同的正方形组成？（　）',
        options: ['A. 4个', 'B. 5个', 'C. 6个', 'D. 8个'],
        answer: 'C。',
        explanation: '正方体有6个面，展开后每个面对应一个正方形。',
      },
      {
        kind: '解答',
        difficulty: '基础',
        knowledgePoint: '相对面判断',
        answerLines: 3,
        prompt:
          '一个正方体展开图中，四个正方形从左到右排成一行，第二个正方形的上方标 A、下方标 B。折起后 A 面和 B 面是什么位置关系？',
        answer: 'A面与B面相对。',
        explanation:
          '它们分别绕同一中间面向上、向下折起，最后位于正方体相对的两侧。',
      },
      {
        kind: '填空',
        difficulty: '进阶',
        knowledgePoint: '骰子相对面',
        answerLines: 2,
        prompt:
          '某正方体六个面分别标1至6，且1对6、2对5、3对4。若看到相邻的1、2、3三个面，则与这三个面都相邻的另一个顶点处可看到的三个数是____。',
        answer: '4、5、6。',
        explanation:
          '每个面在相对顶点处换成它的相对面，因此1、2、3分别换为6、5、4。',
      },
      {
        kind: '作图',
        difficulty: '进阶',
        knowledgePoint: '展开图设计',
        answerLines: 5,
        prompt:
          '在答题区画出两种形状不同的正方体展开图，并给每个小正方形编号；标出任意一组相对面。',
        answer:
          '答案不唯一；图形须由6个边相接的正方形组成，能折成正方体，且标注的相对面正确。',
        explanation:
          '画完后可固定一个面作底面，依次想象其余面向上折，检查是否重叠或缺面。',
      },
      {
        kind: '解答',
        difficulty: '挑战',
        knowledgePoint: '折叠排除',
        answerLines: 4,
        prompt:
          '有人把6个正方形排成2行3列的长方形，认为它是正方体展开图。你同意吗？说明理由。',
        answer: '不同意。折叠时会有面重叠，不能围成正方体。',
        explanation:
          '正方体展开图中不能出现完整的2×2小方格，更不可能是2×3长方形。',
      },
    ],
  }),
  makeSheet({
    id: 'g7-math-1-04',
    child: 'xiaobao',
    stage: '初一',
    subject: '数学',
    sequence: 4,
    title: '截一个几何体',
    subtitle: '第 4 练｜先想切法，再判断截面',
    chapter: '七年级上册 · 第一章 丰富的图形世界',
    focus: ['截面形状', '切割方向', '空间想象'],
    duration: 25,
    edition: '深圳公开选用目录 · 北师大版体系',
    curriculumBasis: '义务教育数学课程标准（2022年版）· 图形与几何',
    curriculumUrl: juniorCurriculumUrl,
    questions: [
      {
        kind: '填空',
        difficulty: '基础',
        knowledgePoint: '球的截面',
        answerLines: 2,
        prompt:
          '用一个平面截球，只要截到球体，得到的截面总是____；平面经过球心时截面最____。',
        answer: '圆， 大（面积最大）。',
        explanation:
          '球具有各方向相同的对称性，平面截球得到圆；经过球心时圆半径最大。',
      },
      {
        kind: '选择',
        difficulty: '基础',
        knowledgePoint: '圆柱截面',
        answerLines: 1,
        prompt: '下列哪一种图形不可能是用平面截一个直圆柱得到的截面？（　）',
        options: ['A. 圆', 'B. 长方形', 'C. 椭圆', 'D. 五边形'],
        answer: 'D。',
        explanation:
          '平行底面可得圆，平行轴可得长方形，斜截可得椭圆；圆柱没有能形成五条直边的表面结构。',
      },
      {
        kind: '解答',
        difficulty: '进阶',
        knowledgePoint: '正方体截面',
        answerLines: 4,
        prompt: '用平面截正方体，能否得到三角形截面？若能，描述一种切法。',
        answer:
          '能。用平面截去正方体的一个顶角，使平面分别与从该顶点出发的三条棱相交，可得三角形。',
        explanation: '截面边来自切平面与三个相邻面的交线。',
      },
      {
        kind: '解答',
        difficulty: '进阶',
        knowledgePoint: '截面比较',
        answerLines: 4,
        prompt:
          '分别用垂直于圆柱底面的平面和垂直于圆锥底面的、且经过顶点的平面去截，截面各是什么形状？',
        answer: '圆柱得到长方形；圆锥得到等腰三角形。',
        explanation:
          '截面包含母线；直圆柱的两条母线平行，圆锥的两条母线在顶点相交。',
      },
      {
        kind: '解答',
        difficulty: '挑战',
        knowledgePoint: '最大边数',
        answerLines: 5,
        prompt:
          '一个平面截正方体，截面最多可能是几边形？从“一个面最多提供一条截线”解释。',
        answer: '最多六边形。',
        explanation:
          '正方体有6个面，切平面与每个面至多形成一条截线，故至多6条边；合适的斜切确实可以同时经过6个面。',
      },
    ],
  }),
  makeSheet({
    id: 'g7-math-1-05',
    child: 'xiaobao',
    stage: '初一',
    subject: '数学',
    sequence: 5,
    title: '从三个方向看',
    subtitle: '第 5 练｜把立体信息压到平面上',
    chapter: '七年级上册 · 第一章 丰富的图形世界',
    focus: ['主视图', '左视图', '俯视图'],
    duration: 30,
    edition: '深圳公开选用目录 · 北师大版体系',
    curriculumBasis: '义务教育数学课程标准（2022年版）· 图形与几何',
    curriculumUrl: juniorCurriculumUrl,
    questions: [
      {
        kind: '填空',
        difficulty: '基础',
        knowledgePoint: '观察方向',
        answerLines: 2,
        prompt: '从正面、左面、上面观察一个物体，分别得到____、____、____。',
        answer: '主视图、左视图、俯视图。',
        explanation: '名称直接对应观察方向；画图时只记录看见的轮廓和必要分界。',
      },
      {
        kind: '作图',
        difficulty: '基础',
        knowledgePoint: '单个几何体三视图',
        answerLines: 5,
        prompt: '画出一个直立圆柱从正面、左面、上面看到的形状。',
        answer: '主视图和左视图都是长方形，俯视图是圆。',
        explanation: '观察方向不同，立体的高度、宽度和圆形底面分别被保留下来。',
      },
      {
        kind: '解答',
        difficulty: '进阶',
        knowledgePoint: '小立方块计数',
        answerLines: 4,
        prompt:
          '一个模型底层从左到右放3个小正方体，并在最左边的小正方体上再放1个。从正面看，各列高度从左到右是多少？从左面看有几列、最高几层？',
        answer: '正面列高为2、1、1；左面看只有1列，最高2层。',
        explanation:
          '同一观察方向上前后重合的信息会被压缩，只保留各位置的最大高度。',
      },
      {
        kind: '作图',
        difficulty: '进阶',
        knowledgePoint: '由俯视图标高度',
        answerLines: 5,
        prompt:
          '俯视图是相邻的2×2四个方格，各格内高度依次为：左前2、右前1、左后1、右后3。写出从正面看左右两列的高度和从左面看前后两列的高度。',
        answer: '正面左右列高为2、3；左面前后列高为2、3。',
        explanation: '每一观察列取该方向上所有小方块柱的最大高度。',
      },
      {
        kind: '解答',
        difficulty: '挑战',
        knowledgePoint: '三视图局限',
        answerLines: 4,
        prompt:
          '两个不同的小正方体组合模型，可能有完全相同的主视图吗？说明原因。要更可靠地区分它们还应增加什么信息？',
        answer:
          '可能。主视图会丢失前后位置和深度信息；还应结合左视图、俯视图或各位置高度。',
        explanation: '投影会压缩一个维度，所以单一方向通常不能唯一还原立体。',
      },
    ],
  }),
  makeSheet({
    id: 'g7-math-1-06',
    child: 'xiaobao',
    stage: '初一',
    subject: '数学',
    sequence: 6,
    title: '立体与平面互译',
    subtitle: '第 6 练｜综合展开、截面和视图',
    chapter: '七年级上册 · 第一章 丰富的图形世界',
    focus: ['信息转换', '空间推理', '表达步骤'],
    duration: 30,
    edition: '深圳公开选用目录 · 北师大版体系',
    curriculumBasis: '义务教育数学课程标准（2022年版）· 图形与几何',
    curriculumUrl: juniorCurriculumUrl,
    questions: [
      {
        kind: '选择',
        difficulty: '基础',
        knowledgePoint: '平面图形成体',
        answerLines: 1,
        prompt: '把一个直角梯形绕它的直角腰旋转一周，所得几何体最接近（　）。',
        options: ['A. 圆柱', 'B. 圆锥', 'C. 圆台', 'D. 球'],
        answer: 'C。',
        explanation:
          '两条平行边旋转形成大小不同的两个圆，斜腰扫出侧面，得到圆台。',
      },
      {
        kind: '填空',
        difficulty: '基础',
        knowledgePoint: '棱柱展开',
        answerLines: 2,
        prompt: '五棱柱沿棱展开，展开图由____个五边形和____个侧面图形组成。',
        answer: '2，5。',
        explanation: '两个底面保持为五边形，每一个底边对应一个侧面。',
      },
      {
        kind: '解答',
        difficulty: '进阶',
        knowledgePoint: '几何体判断',
        answerLines: 4,
        prompt:
          '某几何体从正面和左面看都是长方形，从上面看是圆。它最可能是什么？能否据此断定唯一？',
        answer:
          '最可能是直立圆柱，但不能绝对断定唯一；一些特殊组合体也可能有相同轮廓。',
        explanation:
          '三视图能强烈限制形状，但只给外轮廓、不给尺寸和虚线时仍可能存在多解。',
      },
      {
        kind: '作图',
        difficulty: '进阶',
        knowledgePoint: '模型设计',
        answerLines: 5,
        prompt:
          '用不超过5个同样大小的小正方体设计一个模型，使主视图有3列且列高为1、2、1。画出一种摆法，并写出用了几个小正方体。',
        answer: '答案不唯一；最少可用4个：底层横排3个，在中间上方再放1个。',
        explanation:
          '先按每列最高层数满足正面轮廓，再决定前后位置；最简模型取每列恰好达到所需高度。',
      },
      {
        kind: '解答',
        difficulty: '挑战',
        knowledgePoint: '多表征推理',
        answerLines: 5,
        prompt:
          '一个正方体纸盒的展开图上有一条连续路径，折叠后路径要从一个面跨过一条棱到相邻面。设计时最需要检查哪两件事？',
        answer:
          '检查两个面折后是否相邻；检查路径在公共棱两侧的端点位置能否重合。',
        explanation:
          '“面相邻”只是第一层条件，跨棱位置还必须对应，否则折起后路径会断开。',
      },
    ],
  }),
  makeSheet({
    id: 'g7-math-1-07',
    child: 'xiaobao',
    stage: '初一',
    subject: '数学',
    sequence: 7,
    title: '第一章基础综合',
    subtitle: '第 7 练｜一次检查概念、计数与作图',
    chapter: '七年级上册 · 第一章 丰富的图形世界',
    focus: ['基础综合', '易错辨析', '规范表达'],
    duration: 35,
    edition: '深圳公开选用目录 · 北师大版体系',
    curriculumBasis: '义务教育数学课程标准（2022年版）· 图形与几何',
    curriculumUrl: juniorCurriculumUrl,
    questions: [
      {
        kind: '填空',
        difficulty: '基础',
        knowledgePoint: '几何体要素',
        answerLines: 2,
        prompt: '一个八棱柱有____个面、____条棱、____个顶点。',
        answer: '10，24，16。',
        explanation: 'n棱柱的面、棱、顶点分别为n+2、3n、2n。',
      },
      {
        kind: '选择',
        difficulty: '基础',
        knowledgePoint: '截面辨析',
        answerLines: 1,
        prompt: '用平面截下列几何体，截面一定是圆的是（　）。',
        options: ['A. 球', 'B. 圆柱', 'C. 圆锥', 'D. 正方体'],
        answer: 'A。',
        explanation:
          '平面只要与球相交，交集边界就是圆；其他几何体的截面取决于切割方向。',
      },
      {
        kind: '解答',
        difficulty: '进阶',
        knowledgePoint: '展开图相对面',
        answerLines: 4,
        prompt:
          '在正方体展开图中，若面“理”与面“想”相对，面“求”与面“真”相对，剩下“知”“行”两面是什么关系？',
        answer: '“知”与“行”相对。',
        explanation:
          '正方体的6个面恰好分成3组相对面，已知两组后剩余两面构成第三组。',
      },
      {
        kind: '作图',
        difficulty: '进阶',
        knowledgePoint: '三视图',
        answerLines: 5,
        prompt:
          '底层有前后相邻的2个小正方体，后面的正方体上再叠1个。分别画主视图（从前向后看）和左视图。',
        answer: '主视图为1列2层；左视图为前后2列，列高依次1、2。',
        explanation:
          '正面观察时前后位置重叠，取最大高度；左面观察能保留前后两列。',
      },
      {
        kind: '解答',
        difficulty: '挑战',
        knowledgePoint: '欧拉关系初探',
        answerLines: 5,
        prompt:
          '三棱柱有6个顶点、9条棱、5个面；四棱柱有8个顶点、12条棱、6个面。分别计算“顶点数－棱数＋面数”，你发现什么？再验证五棱柱。',
        answer: '结果都为2；五棱柱为10－15＋7＝2。',
        explanation:
          '凸多面体常满足V－E＋F＝2。本题重在从计数数据中发现稳定关系。',
      },
    ],
  }),
  makeSheet({
    id: 'g7-math-1-08',
    child: 'xiaobao',
    stage: '初一',
    subject: '数学',
    sequence: 8,
    title: '第一章思维提升',
    subtitle: '第 8 练｜用理由说服别人',
    chapter: '七年级上册 · 第一章 丰富的图形世界',
    focus: ['空间想象', '最少与最多', '开放探究'],
    duration: 40,
    edition: '深圳公开选用目录 · 北师大版体系',
    curriculumBasis: '义务教育数学课程标准（2022年版）· 图形与几何',
    curriculumUrl: juniorCurriculumUrl,
    questions: [
      {
        kind: '解答',
        difficulty: '进阶',
        knowledgePoint: '表面涂色',
        answerLines: 4,
        prompt:
          '把一个大正方体的6个面全部涂色，再切成27个相同小正方体。恰有2个面涂色的小正方体有多少个？',
        answer: '12个。',
        explanation:
          '3×3×3时，每条棱中间有1个恰好两面涂色的小正方体，共12条棱。',
      },
      {
        kind: '解答',
        difficulty: '进阶',
        knowledgePoint: '展开图路径',
        answerLines: 5,
        prompt:
          '一只蚂蚁从正方体一个顶点沿表面走到相对顶点。把经过的两个相邻面展开成长方形，若棱长为1，写出这条路线的最短长度。',
        answer: '√5。',
        explanation:
          '两个相邻面展开成2×1长方形，相对顶点对应长方形对角线，长度√(2²+1²)=√5。',
      },
      {
        kind: '解答',
        difficulty: '挑战',
        knowledgePoint: '小立方块最少数',
        answerLines: 5,
        prompt:
          '某模型的主视图列高为2、1，左视图列高也为2、1。这个模型最少需要几个小正方体？描述一种摆法。',
        answer: '最少3个。',
        explanation:
          '在俯视2×2位置中，让一个角柱高2，再在与它错开的另一个行列位置放高1，即可同时满足两幅视图。',
      },
      {
        kind: '解答',
        difficulty: '挑战',
        knowledgePoint: '截面边数推理',
        answerLines: 5,
        prompt:
          '为什么平面截四面体最多得到四边形，而截正方体最多能得到六边形？请用“面数”作解释。',
        answer:
          '截面的一条边来自切平面与原几何体一个面的交线；四面体4个面所以最多4边，正方体6个面所以最多6边。',
        explanation:
          '同一个平面与一个平面至多交成一条直线，因此原几何体的每个面至多贡献一条截面边。',
      },
      {
        kind: '解答',
        difficulty: '挑战',
        knowledgePoint: '反例意识',
        answerLines: 5,
        prompt:
          '同学说：“主视图、左视图、俯视图相同的两个物体一定完全相同。”请判断并说明怎样寻找反例。',
        answer:
          '错误。可从小正方体组合入手，在不改变三个方向最大轮廓的位置增加或移去被遮挡的小方块，得到不同模型。',
        explanation:
          '三视图仍可能丢失内部或遮挡信息；用反例检验“一定”类结论是重要的数学习惯。',
      },
    ],
  }),
];

export const seniorGradeTwoStarters: PracticeSheet[] = [
  makeSheet({
    id: 'g11-math-ellipse-01',
    child: 'dabao',
    stage: '高二',
    subject: '数学',
    sequence: 1,
    title: '椭圆：定义先于公式',
    subtitle: '高二周练样板｜典型母题与参数互译',
    chapter: '选择性必修 · 圆锥曲线',
    focus: ['椭圆定义', '标准方程', '离心率', '焦点三角形'],
    duration: 40,
    edition: '按普通高中课程标准建模 · 教材版本可配置',
    curriculumBasis: '普通高中数学课程标准（2017年版2020年修订）',
    curriculumUrl: seniorCurriculumUrl,
    questions: [
      {
        kind: '填空',
        difficulty: '基础',
        knowledgePoint: '椭圆参数',
        answerLines: 2,
        prompt: '椭圆 x²/25＋y²/9＝1 的焦距为____，离心率为____。',
        answer: '8，4/5。',
        explanation: 'a=5，b=3，c=√(a²-b²)=4；焦距为2c=8，e=c/a=4/5。',
      },
      {
        kind: '解答',
        difficulty: '基础',
        knowledgePoint: '由定义求方程',
        answerLines: 4,
        prompt:
          '椭圆两焦点为(－3,0)、(3,0)，椭圆上一点到两焦点距离之和为10，求标准方程。',
        answer: 'x²/25＋y²/16＝1。',
        explanation: '2a=10得a=5，c=3，b²=a²-c²=16，焦点在x轴。',
      },
      {
        kind: '填空',
        difficulty: '进阶',
        knowledgePoint: '焦半径',
        answerLines: 2,
        prompt: '点P在椭圆上，椭圆长轴长为8。若PF₁=3，则PF₂=____。',
        answer: '5。',
        explanation: '椭圆定义给出PF₁+PF₂=2a=8。',
      },
      {
        kind: '解答',
        difficulty: '进阶',
        knowledgePoint: '焦点三角形',
        answerLines: 5,
        prompt:
          '椭圆 x²/9＋y²/5＝1 的焦点为F₁、F₂。点P在椭圆上方，且∠F₁PF₂=60°，求△PF₁F₂的面积。',
        answer: '5√3/3。',
        explanation:
          'PF₁+PF₂=6，F₁F₂=4。设两焦半径乘积为m，由余弦定理16=36-3m，得m=20/3；面积=(1/2)m·sin60°=5√3/3。',
      },
      {
        kind: '解答',
        difficulty: '挑战',
        knowledgePoint: '参数范围',
        answerLines: 5,
        prompt:
          '椭圆 x²/a²＋y²/(a²－4)＝1（a>2）的离心率不大于1/2，求a的取值范围。',
        answer: 'a≥4。',
        explanation: 'c²=a²-(a²-4)=4，所以c=2，e=2/a≤1/2，结合a>2得a≥4。',
      },
    ],
  }),
  makeSheet({
    id: 'g11-physics-electric-01',
    child: 'dabao',
    stage: '高二',
    subject: '物理',
    sequence: 1,
    title: '电场：方向、功与能',
    subtitle: '高二周练样板｜先画受力与路径，再列关系',
    chapter: '必修第三册 · 静电场（人教版）',
    focus: ['电场强度', '电势差', '电场力做功', '带电粒子'],
    duration: 40,
    edition: '按普通高中课程标准建模 · 教材版本可配置',
    curriculumBasis: '普通高中物理课程标准（2017年版）',
    curriculumUrl: seniorCurriculumUrl,
    questions: [
      {
        kind: '填空',
        difficulty: '基础',
        knowledgePoint: '场强定义',
        answerLines: 2,
        prompt:
          '某点放入电荷量为+2.0×10⁻⁸ C的试探电荷，受到水平向右、大小4.0×10⁻⁴ N的电场力。该点场强大小和方向分别是什么？',
        answer: '2.0×10⁴ N/C，水平向右。',
        explanation: 'E=F/q；正试探电荷受力方向与场强方向相同。',
      },
      {
        kind: '解答',
        difficulty: '基础',
        knowledgePoint: '电场力做功',
        answerLines: 4,
        prompt:
          '电荷量q=－3.0×10⁻⁶ C的粒子从A移到B，U_AB=200 V。求电场力做功，并判断电势能变化。',
        answer: 'W_AB=qU_AB=－6.0×10⁻⁴ J；电势能增加6.0×10⁻⁴ J。',
        explanation: 'W=qU，且电场力做功等于电势能减少量，即ΔE_p=－W。',
      },
      {
        kind: '选择',
        difficulty: '进阶',
        knowledgePoint: '等势面',
        answerLines: 1,
        prompt: '关于静电场中的等势面，下列正确的是（　）。',
        options: [
          'A. 电场线沿等势面',
          'B. 沿同一等势面移动电荷，电场力一定做正功',
          'C. 电场线与等势面垂直',
          'D. 电势相等处场强一定相等',
        ],
        answer: 'C。',
        explanation:
          '电场线沿电势降低最快方向，必与等势面垂直；等势面内移动电场力做功为0。',
      },
      {
        kind: '解答',
        difficulty: '进阶',
        knowledgePoint: '匀强电场',
        answerLines: 5,
        prompt:
          '两平行板间距0.020 m，电势差600 V。忽略边缘效应，求场强。电子从静止经这段电势差加速，获得的动能是多少电子伏？',
        answer: 'E=3.0×10⁴ V/m；动能600 eV。',
        explanation: '匀强电场E=U/d；一个电子经过600 V电势差获得600 eV动能。',
      },
      {
        kind: '解答',
        difficulty: '挑战',
        knowledgePoint: '功能关系',
        answerLines: 5,
        prompt:
          '一个带正电小球仅受电场力，从A由静止运动到B，动能增加了1.2×10⁻³ J。A、B两点哪点电势更高？电势能变化多少？',
        answer: 'A点电势更高；电势能减少1.2×10⁻³ J。',
        explanation:
          '仅电场力做功，动能增加说明电场力做正功、势能等量减少；正电荷沿电势降低方向运动。',
      },
    ],
  }),
  makeSheet({
    id: 'g11-chem-equilibrium-01',
    child: 'dabao',
    stage: '高二',
    subject: '化学',
    sequence: 1,
    title: '化学平衡：先看改变了什么',
    subtitle: '高二周练样板｜速率、平衡与证据链',
    chapter: '选择性必修 · 化学反应原理',
    focus: ['反应速率', '平衡移动', '平衡常数', '图像判断'],
    duration: 40,
    edition: '按普通高中课程标准建模 · 教材版本可配置',
    curriculumBasis: '普通高中化学课程标准（2017年版）',
    curriculumUrl: seniorCurriculumUrl,
    questions: [
      {
        kind: '填空',
        difficulty: '基础',
        knowledgePoint: '平均反应速率',
        answerLines: 2,
        prompt:
          '2 L密闭容器中，5 min内某反应物的物质的量由1.2 mol降到0.8 mol。用该反应物浓度变化表示的平均速率是多少？',
        answer: '0.040 mol·L⁻¹·min⁻¹。',
        explanation: '浓度减少量(1.2-0.8)/2=0.20 mol/L，再除以5 min。',
      },
      {
        kind: '选择',
        difficulty: '基础',
        knowledgePoint: '催化剂与平衡',
        answerLines: 1,
        prompt: '可逆反应达到平衡后加入适宜催化剂，下列说法正确的是（　）。',
        options: [
          'A. 正反应速率增大、逆反应速率不变',
          'B. 平衡向正反应方向移动',
          'C. 正逆反应速率均增大，平衡组成不变',
          'D. 平衡常数增大',
        ],
        answer: 'C。',
        explanation:
          '催化剂同时降低正逆反应活化能，只缩短达到平衡的时间，不改变同温度下的平衡常数和组成。',
      },
      {
        kind: '解答',
        difficulty: '进阶',
        knowledgePoint: '浓度与平衡移动',
        answerLines: 5,
        prompt:
          '恒温下反应N₂(g)+3H₂(g)⇌2NH₃(g)已平衡。瞬间加入少量N₂后，正、逆反应速率如何突变？随后平衡向哪边移动？',
        answer:
          '加入瞬间正反应速率增大，逆反应速率不突变；随后向生成NH₃方向移动，直至正逆速率重新相等。',
        explanation:
          '只直接增大N₂浓度，所以先影响正反应速率；系统随后通过正向反应消耗部分新增N₂。',
      },
      {
        kind: '解答',
        difficulty: '进阶',
        knowledgePoint: '平衡常数计算',
        answerLines: 5,
        prompt:
          '恒温下，反应A(g)⇌B(g)在1 L容器中进行。起始A为1.0 mol，平衡时A为0.40 mol，求该温度下K_c。',
        answer: 'K_c=1.5。',
        explanation:
          '平衡时B生成0.60 mol，因体积1 L，K_c=[B]/[A]=0.60/0.40=1.5。',
      },
      {
        kind: '解答',
        difficulty: '挑战',
        knowledgePoint: '温度与平衡',
        answerLines: 5,
        prompt:
          '某放热反应升温后，平衡常数变小。请从“平衡移动”和“正逆反应速率变化”两个层面解释，不能只写一句勒夏特列原理。',
        answer:
          '升温使正逆反应速率都增大，但吸热的逆反应速率增大的相对程度更大，平衡向逆反应方向移动，生成物平衡比例下降，因此K变小。',
        explanation: '完整解释要同时区分速率的瞬时变化和平衡组成的最终变化。',
      },
    ],
  }),
  makeSheet({
    id: 'g11-biology-genetics-01',
    child: 'dabao',
    stage: '高二',
    subject: '生物',
    sequence: 1,
    title: '遗传规律：写清假设再计算',
    subtitle: '高二周练样板｜基因型、概率与实验验证',
    chapter: '必修二衔接 · 遗传与进化',
    focus: ['分离定律', '自由组合', '伴性遗传', '实验设计'],
    duration: 40,
    edition: '按普通高中课程标准建模 · 教材版本可配置',
    curriculumBasis: '普通高中生物学课程标准（2017年版2020年修订）',
    curriculumUrl: seniorCurriculumUrl,
    questions: [
      {
        kind: '填空',
        difficulty: '基础',
        knowledgePoint: '分离定律',
        answerLines: 2,
        prompt:
          '一对相对性状由A/a控制，Aa×Aa后代中显性表型概率为____，杂合子概率为____。',
        answer: '3/4，1/2。',
        explanation: '基因型比例AA:Aa:aa=1:2:1；完全显性时AA与Aa均为显性。',
      },
      {
        kind: '解答',
        difficulty: '基础',
        knowledgePoint: '测交',
        answerLines: 4,
        prompt:
          '某显性表型植株的基因型可能为AA或Aa。设计一次杂交实验判断其基因型，并写出预期结果。',
        answer:
          '与aa隐性纯合子测交；若后代全显性则待测个体更可能为AA，若显性∶隐性约1∶1则为Aa。',
        explanation:
          '隐性亲本只提供a配子，后代表型直接反映待测亲本产生的配子种类。',
      },
      {
        kind: '填空',
        difficulty: '进阶',
        knowledgePoint: '自由组合概率',
        answerLines: 2,
        prompt:
          '两对基因独立遗传且完全显性，AaBb×AaBb后代中基因型为A_bb的概率为____。',
        answer: '3/16。',
        explanation: 'A_概率3/4，bb概率1/4，独立事件相乘得3/16。',
      },
      {
        kind: '解答',
        difficulty: '进阶',
        knowledgePoint: '伴X隐性遗传',
        answerLines: 5,
        prompt:
          '某伴X染色体隐性遗传病，正常女性的父亲患病，她与正常男性婚配。不考虑新突变，儿子患病的概率是多少？',
        answer: '1/2。',
        explanation:
          '该女性从患病父亲获得Xᵃ，自身正常故基因型为XᴬXᵃ；儿子从父亲得Y，从母亲得X，获得Xᵃ概率1/2。',
      },
      {
        kind: '解答',
        difficulty: '挑战',
        knowledgePoint: '统计与实验结论',
        answerLines: 5,
        prompt:
          '某次杂交得到显性78株、隐性22株。同学仅因不是严格3∶1就否定分离定律。指出其推理问题，并说明还需怎样分析。',
        answer:
          '有限样本会有随机偏差，理论比例不要求每次实验完全相等；应提出3∶1的零假设，用更大样本并做卡方检验判断偏差是否超出随机范围。',
        explanation:
          '遗传结论依赖概率模型和统计证据，不能把理论概率误解为小样本中的机械比例。',
      },
    ],
  }),
];

export const methodPracticeSheets: PracticeSheet[] = studyLessons.map(
  (lesson, index) => ({
    id: `method-${lesson.id}`,
    methodLessonId: lesson.id,
    week: lesson.week,
    child: lesson.child,
    stage: lesson.child === 'xiaobao' ? '初一' : '高二',
    subject: lesson.subject,
    sequence: index + 1,
    title: lesson.title,
    subtitle: `第${lesson.week}周 · 方法配套练习 · 先写依据再选答案`,
    chapter: lesson.chapter,
    focus: [lesson.objective],
    duration: lesson.minutes,
    edition: '按知识点编排；出版社、教材版次与章节顺序以孩子学校课本为准',
    curriculumBasis: `${lesson.subject}基础方法与变式练习`,
    curriculumUrl: lesson.reference.url,
    questions: lesson.questions.map((question, i) => ({
      id: question.id,
      kind: '选择',
      difficulty: i < 2 ? '基础' : '进阶',
      knowledgePoint: lesson.title,
      prompt: question.prompt,
      options: question.options.map(
        (option, n) => `${String.fromCharCode(65 + n)}. ${option}`,
      ),
      answer: `${String.fromCharCode(65 + question.correct)}. ${question.options[question.correct]}`,
      explanation: question.explanation,
      source: studySource(lesson, question),
      answerLines: 4,
    })),
  }),
);

export const juniorPracticeSheets = [
  ...methodPracticeSheets.filter((s) => s.child === 'xiaobao'),
  ...juniorMathChapterOne,
];
export const seniorPracticeSheets = [
  ...methodPracticeSheets.filter((s) => s.child === 'dabao'),
  ...seniorGradeTwoStarters,
];

export const allPracticeSheets = [
  ...methodPracticeSheets,
  ...juniorMathChapterOne,
  ...seniorGradeTwoStarters,
];

export function findPracticeSheet(id: string) {
  return allPracticeSheets.find((sheet) => sheet.id === id);
}

export function buildWrongQuestionFromPractice(
  sheet: PracticeSheet,
  question: PracticeQuestion,
  learnerAnswer: string,
  now = new Date(),
): WrongQuestion {
  return createWrongQuestion({
    questionId: question.id,
    subject: sheet.subject,
    knowledgePoint: question.knowledgePoint,
    prompt: question.prompt,
    answer: question.answer,
    learnerAnswer,
    source: question.source,
    now,
  });
}

export function mergePracticeWrongQuestions(
  current: WrongQuestion[],
  sheet: PracticeSheet,
  selectedQuestionIds: string[],
  now = new Date(),
) {
  const selected = new Set(selectedQuestionIds);
  const existing = new Set(current.map((entry) => entry.questionId));
  const entries = sheet.questions
    .filter((question) => selected.has(question.id))
    .filter((question) => !sheet.methodLessonId || !existing.has(question.id))
    .map((question) =>
      buildWrongQuestionFromPractice(
        sheet,
        question,
        '纸笔作答，家长批改标记为错题',
        now,
      ),
    );
  const replaced = new Set(entries.map((entry) => entry.questionId));
  return [
    ...entries,
    ...current.filter((entry) => !replaced.has(entry.questionId)),
  ];
}

export function recordWorksheetMistakes(
  attempts: StudyAttempt[],
  sheet: PracticeSheet,
  selectedQuestionIds: string[],
  now = new Date(),
): StudyAttempt[] {
  const lessonId = sheet.methodLessonId;
  if (!lessonId) return attempts;
  const entries: StudyAttempt[] = sheet.questions
    .filter((q) => selectedQuestionIds.includes(q.id))
    .map((q) => ({
      lessonId,
      questionId: q.id,
      answer: '纸笔批改标记为错题；原作答见纸张',
      correct: false,
      assisted: true,
      origin: 'paper',
      mode: 'practice',
      at: now.toISOString(),
    }));
  return [...attempts, ...entries].slice(-5000);
}

export function markPracticeComplete(completed: string[], sheetId: string) {
  return completed.includes(sheetId) ? completed : [...completed, sheetId];
}

export function validatePracticeCatalog(sheets: PracticeSheet[]) {
  const issues: string[] = [];
  const sheetIds = new Set<string>();
  const questionIds = new Set<string>();

  for (const sheet of sheets) {
    if (sheetIds.has(sheet.id)) issues.push(`练习页ID重复：${sheet.id}`);
    sheetIds.add(sheet.id);
    if (sheet.questions.length < (sheet.methodLessonId ? 4 : 5))
      issues.push(`练习页题量不足：${sheet.id}`);
    if (!sheet.curriculumBasis || !sheet.curriculumUrl)
      issues.push(`课程依据缺失：${sheet.id}`);

    for (const question of sheet.questions) {
      if (questionIds.has(question.id))
        issues.push(`题目ID重复：${question.id}`);
      questionIds.add(question.id);
      if (
        !question.prompt ||
        !question.answer ||
        !question.explanation ||
        !question.source
      ) {
        issues.push(`题目信息不完整：${question.id}`);
      }
      if (!question.source.includes('双宝原创'))
        issues.push(`原创标记缺失：${question.id}`);
      if (question.answerLines < 1) issues.push(`答题空间无效：${question.id}`);
    }
  }

  return issues;
}
