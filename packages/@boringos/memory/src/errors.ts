export class MemoryConnectionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "MemoryConnectionError";
  }
}

export class MemoryAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryAuthError";
  }
}
