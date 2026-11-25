import { Inject, Injectable } from '@nestjs/common';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type {
  Citation,
  ConversationMessage,
  ConversationSummary,
  LlmModelId,
} from '@ai-document-chatbot/shared';
import { FIRESTORE } from '../firebase/firebase.module';

/** Firestore shape of `users/{uid}/conversations/{id}`. */
export interface ConversationRecord {
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/** Firestore shape of `users/{uid}/conversations/{id}/messages/{messageId}`. */
export interface MessageRecord {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  modelId: LlmModelId | null;
  citations: Citation[];
}

const LIST_LIMIT = 100;
/** Upper bound on messages returned for one conversation. */
const MESSAGES_LIMIT = 500;

/** Persistence for conversations; every path is under the owner's `users/{uid}`. */
@Injectable()
export class ConversationRepository {
  constructor(@Inject(FIRESTORE) private readonly db: Firestore) {}

  private conversations(uid: string) {
    return this.db.collection('users').doc(uid).collection('conversations');
  }

  private messages(uid: string, id: string) {
    return this.conversations(uid).doc(id).collection('messages');
  }

  newId(uid: string): string {
    return this.conversations(uid).doc().id;
  }

  /** Creates an empty conversation (used by tests; the app uses createWithMessage). */
  async create(
    uid: string,
    id: string,
    record: ConversationRecord,
  ): Promise<void> {
    await this.conversations(uid).doc(id).create(record);
  }

  /** Creates the conversation together with its first message, atomically. */
  async createWithMessage(
    uid: string,
    id: string,
    record: Omit<ConversationRecord, 'messageCount'>,
    message: MessageRecord,
  ): Promise<void> {
    const batch = this.db.batch();
    batch.create(this.conversations(uid).doc(id), {
      ...record,
      messageCount: 1,
    });
    batch.create(this.messages(uid, id).doc(), message);
    await batch.commit();
  }

  async get(uid: string, id: string): Promise<ConversationRecord | null> {
    const snapshot = await this.conversations(uid).doc(id).get();
    return snapshot.exists ? (snapshot.data() as ConversationRecord) : null;
  }

  async list(uid: string): Promise<ConversationSummary[]> {
    const snapshot = await this.conversations(uid)
      .orderBy('updatedAt', 'desc')
      .limit(LIST_LIMIT)
      .get();
    return snapshot.docs.map((doc) =>
      toSummary(doc.id, doc.data() as ConversationRecord),
    );
  }

  async rename(uid: string, id: string, title: string): Promise<void> {
    await this.conversations(uid)
      .doc(id)
      .update({ title })
      .catch(rethrowIfGone);
  }

  /** Appends a message and bumps the conversation's `updatedAt` / `messageCount` atomically. */
  async addMessage(
    uid: string,
    id: string,
    message: MessageRecord,
  ): Promise<string> {
    const ref = this.messages(uid, id).doc();
    const batch = this.db.batch();
    batch.create(ref, message);
    batch.update(this.conversations(uid).doc(id), {
      updatedAt: message.createdAt,
      messageCount: FieldValue.increment(1),
    });
    await batch.commit().catch(rethrowIfGone);
    return ref.id;
  }

  /** All messages (bounded), oldest first. */
  async listMessages(uid: string, id: string): Promise<ConversationMessage[]> {
    const snapshot = await this.messages(uid, id)
      .orderBy('createdAt', 'asc')
      .limit(MESSAGES_LIMIT)
      .get();
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as MessageRecord),
    }));
  }

  /** The latest `count` messages, oldest first (model context). */
  async recentMessages(
    uid: string,
    id: string,
    count: number,
  ): Promise<MessageRecord[]> {
    const snapshot = await this.messages(uid, id)
      .orderBy('createdAt', 'desc')
      .limit(count)
      .get();
    return snapshot.docs.map((doc) => doc.data() as MessageRecord).reverse();
  }

  /** Deletes the conversation and all of its messages. Idempotent. */
  async delete(uid: string, id: string): Promise<void> {
    await this.db.recursiveDelete(this.conversations(uid).doc(id));
  }
}

/** gRPC NOT_FOUND (e.g. deleted concurrently) becomes a ConversationGoneError. */
export class ConversationGoneError extends Error {
  constructor() {
    super('Conversation no longer exists');
    this.name = 'ConversationGoneError';
  }
}

function rethrowIfGone(error: unknown): never {
  if ((error as { code?: unknown })?.code === 5)
    throw new ConversationGoneError();
  throw error;
}

export function toSummary(
  id: string,
  record: ConversationRecord,
): ConversationSummary {
  return {
    id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messageCount: record.messageCount,
  };
}
