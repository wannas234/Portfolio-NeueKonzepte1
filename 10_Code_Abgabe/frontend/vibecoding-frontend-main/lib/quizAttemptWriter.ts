// Serializes writes and retains the exact failed request for an idempotent retry.
export type AttemptState = {
  id: string;
  revision: number;
  answers: (number | null)[];
  submittedAt: string | null;
  score: number | null;
  quizId: string;
};
export type AttemptWrite = {
  attemptId: string;
  answers: (number | null)[];
  expectedRevision: number;
  submit: boolean;
};
export class QuizAttemptWriter {
  private desired: (number | null)[];
  private pending: AttemptWrite | null = null;
  private running: Promise<void> | null = null;
  private finish = false;
  error: unknown = null;
  saved: AttemptState;
  private write: (input: AttemptWrite) => Promise<AttemptState>;
  private changed: () => void;
  constructor(
    saved: AttemptState,
    write: (input: AttemptWrite) => Promise<AttemptState>,
    changed: () => void = () => {},
  ) {
    this.saved = saved;
    this.write = write;
    this.changed = changed;
    this.desired = [...saved.answers];
  }
  get answers() {
    return [...this.desired];
  }
  get busy() {
    return this.running !== null;
  }
  get dirty() {
    return (
      this.pending !== null ||
      JSON.stringify(this.desired) !== JSON.stringify(this.saved.answers)
    );
  }
  answer(index: number, option: number) {
    if (this.saved.submittedAt || this.finish) return;
    this.desired[index] = option;
    this.changed();
    if (!this.error) void this.flush().catch(() => {});
  }
  async submit() {
    this.finish = true;
    await this.flush();
    return this.saved;
  }
  async retry() {
    this.error = null;
    await this.flush();
  }
  private flush(): Promise<void> {
    if (this.running) return this.running;
    const work = async () => {
      while (!this.saved.submittedAt && (this.dirty || this.finish)) {
        const request = this.pending ?? {
          attemptId: this.saved.id,
          answers: [...this.desired],
          expectedRevision: this.saved.revision,
          submit: this.finish,
        };
        this.pending = request;
        this.saved = await this.write(request);
        this.pending = null;
        this.changed();
      }
    };
    this.running = Promise.resolve()
      .then(work)
      .catch((error) => {
        this.error = error;
        throw error;
      })
      .finally(() => {
        this.running = null;
        this.changed();
      });
    this.changed();
    return this.running;
  }
}
