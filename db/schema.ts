import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const wrongQuestions = sqliteTable(
  'wrong_questions',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    child: text('child', { enum: ['xiaobao', 'dabao'] }).notNull(),
    subject: text('subject').notNull(),
    questionId: text('question_id').notNull(),
    knowledgePoint: text('knowledge_point').notNull(),
    prompt: text('prompt').notNull(),
    answer: text('answer').notNull(),
    learnerAnswer: text('learner_answer').notNull(),
    source: text('source').notNull(),
    status: text('status').notNull().default('待重做'),
    reviewDates: text('review_dates', { mode: 'json' }).$type<string[]>().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('wrong_owner_child_created_idx').on(table.ownerId, table.child, table.createdAt),
    uniqueIndex('wrong_owner_child_question_idx').on(table.ownerId, table.child, table.questionId),
  ],
);

export const scanItems = sqliteTable(
  'scan_items',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    child: text('child', { enum: ['xiaobao', 'dabao'] }).notNull(),
    subject: text('subject').notNull(),
    source: text('source').notNull(),
    originalName: text('original_name').notNull(),
    objectKey: text('object_key').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    status: text('status').notNull().default('待讲解'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('scan_owner_child_created_idx').on(table.ownerId, table.child, table.createdAt)],
);
