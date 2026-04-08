export interface QueueAdapter<T = unknown> {
  readonly name: string;
  enqueue(job: T): Promise<string>;
  process(handler: (job: T) => Promise<void>): void;
  close(): Promise<void>;
}
