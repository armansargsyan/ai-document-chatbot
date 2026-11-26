import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import {
  ConversationGoneError,
  type ConversationRecord,
  type ConversationRepository,
  type MessageRecord,
} from './conversation.repository';
import {
  ConversationsService,
  HISTORY_MESSAGES,
  titleFromMessage,
} from './conversations.service';

const UID = 'user-1';
const ID = 'abcdefghij0123456789';
const record: ConversationRecord = {
  title: 'Refunds',
  createdAt: '2026-11-25T10:00:00.000Z',
  updatedAt: '2026-11-25T10:05:00.000Z',
  messageCount: 2,
};

function setup() {
  const repository = {
    newId: vi.fn(() => ID),
    create: vi.fn(async () => undefined),
    createWithMessage: vi.fn(async () => undefined),
    get: vi.fn(async (): Promise<ConversationRecord | null> => record),
    list: vi.fn(async () => []),
    rename: vi.fn(async () => undefined),
    addMessage: vi.fn(async () => 'msg-id'),
    listMessages: vi.fn(async () => []),
    recentMessages: vi.fn(async (): Promise<MessageRecord[]> => []),
    delete: vi.fn(async () => undefined),
  };
  return {
    repository,
    service: new ConversationsService(
      repository as unknown as ConversationRepository,
    ),
  };
}

async function status(promise: Promise<unknown>) {
  const error = await promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (e: unknown) => e,
  );
  return (error as HttpException).getStatus();
}

describe('ConversationsService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('lists the caller’s conversations', async () => {
    await ctx.service.list(UID);
    expect(ctx.repository.list).toHaveBeenCalledWith(UID);
  });

  it('gets a conversation with its messages', async () => {
    const detail = await ctx.service.get(UID, ID);
    expect(detail).toMatchObject({
      id: ID,
      title: 'Refunds',
      messageCount: 2,
      messages: [],
    });
    expect(ctx.repository.get).toHaveBeenCalledWith(UID, ID);
    expect(ctx.repository.listMessages).toHaveBeenCalledWith(UID, ID);
  });

  it.each([
    ['get', (s: ConversationsService) => s.get(UID, ID)],
    ['rename', (s: ConversationsService) => s.rename(UID, ID, 'x')],
    ['remove', (s: ConversationsService) => s.remove(UID, ID)],
    ['history', (s: ConversationsService) => s.history(UID, ID)],
  ])(
    '%s returns 404 for a conversation the caller does not have',
    async (_name, call) => {
      ctx.repository.get.mockResolvedValueOnce(null);
      expect(await status(call(ctx.service))).toBe(404);
      expect(ctx.repository.rename).not.toHaveBeenCalled();
      expect(ctx.repository.delete).not.toHaveBeenCalled();
      expect(ctx.repository.listMessages).not.toHaveBeenCalled();
    },
  );

  it('tags the 404 with a machine-readable code', async () => {
    ctx.repository.get.mockResolvedValueOnce(null);
    const error = await ctx.service.history(UID, ID).catch((e: unknown) => e);
    expect((error as HttpException).getResponse()).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Conversation not found',
      code: 'conversation_not_found',
    });
  });

  it('renames and returns the updated summary', async () => {
    expect(await ctx.service.rename(UID, ID, 'New title')).toMatchObject({
      id: ID,
      title: 'New title',
    });
    expect(ctx.repository.rename).toHaveBeenCalledWith(UID, ID, 'New title');
  });

  it('deletes', async () => {
    await ctx.service.remove(UID, ID);
    expect(ctx.repository.delete).toHaveBeenCalledWith(UID, ID);
  });

  it('returns recent turns as model context', async () => {
    ctx.repository.recentMessages.mockResolvedValueOnce([
      {
        role: 'user',
        content: 'Q1',
        createdAt: 't1',
        modelId: null,
        citations: [],
      },
      {
        role: 'assistant',
        content: 'A1',
        createdAt: 't2',
        modelId: 'gpt-6-luna',
        citations: [],
      },
    ]);
    expect(await ctx.service.history(UID, ID)).toEqual([
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
    ]);
    expect(ctx.repository.recentMessages).toHaveBeenCalledWith(
      UID,
      ID,
      HISTORY_MESSAGES,
    );
  });

  it('creates a titled conversation with its first message atomically', async () => {
    const id = await ctx.service.recordUserMessage(
      UID,
      undefined,
      'How do refunds work?',
    );
    expect(id).toBe(ID);
    expect(ctx.repository.createWithMessage).toHaveBeenCalledWith(
      UID,
      ID,
      expect.objectContaining({ title: 'How do refunds work?' }),
      expect.objectContaining({
        role: 'user',
        content: 'How do refunds work?',
        modelId: null,
      }),
    );
    expect(ctx.repository.create).not.toHaveBeenCalled();
    expect(ctx.repository.addMessage).not.toHaveBeenCalled();
  });

  it('maps a conversation deleted mid-write to 404', async () => {
    ctx.repository.addMessage.mockRejectedValueOnce(
      new ConversationGoneError(),
    );
    expect(await status(ctx.service.recordUserMessage(UID, ID, 'hi'))).toBe(
      404,
    );
    ctx.repository.rename.mockRejectedValueOnce(new ConversationGoneError());
    expect(await status(ctx.service.rename(UID, ID, 'x'))).toBe(404);
  });

  it('appends to an existing conversation without creating one', async () => {
    expect(await ctx.service.recordUserMessage(UID, ID, 'Follow-up')).toBe(ID);
    expect(ctx.repository.create).not.toHaveBeenCalled();
    expect(ctx.repository.addMessage).toHaveBeenCalledOnce();
  });

  it('records the assistant answer with model and citations', async () => {
    const citations = [
      {
        number: 1,
        documentId: 'd',
        documentName: 'D.pdf',
        page: 1,
        snippet: 's',
      },
    ];
    await ctx.service.recordAssistantMessage(UID, ID, {
      content: 'Answer [1]',
      modelId: 'claude-haiku-5-5',
      citations,
    });
    expect(ctx.repository.addMessage).toHaveBeenCalledWith(
      UID,
      ID,
      expect.objectContaining({
        role: 'assistant',
        content: 'Answer [1]',
        modelId: 'claude-haiku-5-5',
        citations,
      }),
    );
  });
});

describe('titleFromMessage', () => {
  it.each([
    ['How do refunds work?', 'How do refunds work?'],
    ['  multi\n\nline   question ', 'multi line question'],
    ['x'.repeat(80), `${'x'.repeat(60)}…`],
    ['   ', 'New conversation'],
    ['😀'.repeat(70), `${'😀'.repeat(60)}…`],
  ])('%j -> %j', (input, expected) => {
    expect(titleFromMessage(input)).toBe(expected);
  });
});
