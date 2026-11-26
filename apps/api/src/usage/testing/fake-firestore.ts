import type { Firestore } from 'firebase-admin/firestore';

/**
 * In-memory stand-in for the slice of Firestore that `UsageRepository` uses:
 * document get/set/create, collection `count()`, and `runTransaction` with
 * optimistic concurrency (a transaction whose reads changed before commit is
 * retried, like Firestore). Reads yield to the event loop, so concurrent
 * transactions really interleave. Test-only.
 */
export class FakeFirestore {
  readonly docs = new Map<string, Record<string, unknown>>();
  private readonly versions = new Map<string, number>();
  private nextId = 0;
  /** Transactions that had to retry because of a conflicting commit. */
  retries = 0;
  /** When set, the next commit throws this (e.g. Firestore unavailable). */
  failNextCommit: Error | null = null;

  asFirestore(): Firestore {
    return this as unknown as Firestore;
  }

  collection(path: string): FakeCollection {
    return new FakeCollection(this, path);
  }

  /** Path of every direct child doc of a collection. */
  childrenOf(collectionPath: string): string[] {
    const prefix = `${collectionPath}/`;
    return [...this.docs.keys()].filter(
      (key) =>
        key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
    );
  }

  version(key: string): number {
    return this.versions.get(key) ?? 0;
  }

  bump(key: string): void {
    this.versions.set(key, this.version(key) + 1);
  }

  newId(): string {
    return `fakeid${String(this.nextId++).padStart(14, '0')}`;
  }

  async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 25; attempt++) {
      const tx = new FakeTransaction(this);
      const result = await fn(tx);
      if (this.failNextCommit) {
        const error = this.failNextCommit;
        this.failNextCommit = null;
        throw error;
      }
      if (tx.commit()) return result;
      this.retries++;
    }
    throw new Error('Too much contention');
  }
}

class FakeCollection {
  constructor(
    private readonly db: FakeFirestore,
    readonly path: string,
  ) {}

  doc(id: string = this.db.newId()): FakeDoc {
    return new FakeDoc(this.db, `${this.path}/${id}`);
  }

  count(): FakeCount {
    return new FakeCount(this.db, this.path);
  }
}

class FakeDoc {
  constructor(
    private readonly db: FakeFirestore,
    readonly path: string,
  ) {}

  get id(): string {
    return this.path.split('/').pop() as string;
  }

  collection(name: string): FakeCollection {
    return new FakeCollection(this.db, `${this.path}/${name}`);
  }

  async get() {
    await tick();
    const data = this.db.docs.get(this.path);
    return { exists: data !== undefined, data: () => data && { ...data } };
  }

  async create(data: Record<string, unknown>): Promise<void> {
    if (this.db.docs.has(this.path)) throw new Error('ALREADY_EXISTS');
    this.db.docs.set(this.path, { ...data });
    this.db.bump(this.path);
    this.db.bump(parentOf(this.path));
  }
}

class FakeCount {
  constructor(
    private readonly db: FakeFirestore,
    readonly collectionPath: string,
  ) {}

  async get() {
    await tick();
    const count = this.db.childrenOf(this.collectionPath).length;
    return { data: () => ({ count }) };
  }
}

class FakeTransaction {
  private readonly reads = new Map<string, number>();
  private readonly writes: (() => void)[] = [];
  private readonly touched: string[] = [];

  constructor(private readonly db: FakeFirestore) {}

  async get(ref: FakeDoc | FakeCount) {
    const key = ref instanceof FakeDoc ? ref.path : ref.collectionPath;
    this.reads.set(key, this.db.version(key));
    return ref.get();
  }

  set(
    ref: FakeDoc,
    data: Record<string, unknown>,
    options?: { merge?: boolean },
  ): this {
    this.writes.push(() => {
      const existing = options?.merge ? this.db.docs.get(ref.path) : undefined;
      this.db.docs.set(ref.path, { ...existing, ...data });
    });
    this.touched.push(ref.path);
    return this;
  }

  create(ref: FakeDoc, data: Record<string, unknown>): this {
    this.writes.push(() => {
      if (this.db.docs.has(ref.path)) throw new Error('ALREADY_EXISTS');
      this.db.docs.set(ref.path, { ...data });
    });
    this.touched.push(ref.path, parentOf(ref.path));
    return this;
  }

  /** Applies the writes unless something this transaction read has changed. */
  commit(): boolean {
    for (const [key, version] of this.reads) {
      if (this.db.version(key) !== version) return false;
    }
    for (const write of this.writes) write();
    for (const key of new Set(this.touched)) this.db.bump(key);
    return true;
  }
}

function parentOf(path: string): string {
  return path.split('/').slice(0, -1).join('/');
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
