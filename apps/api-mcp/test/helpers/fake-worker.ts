import type { WorkerTranscript } from "../../src/worker/transcript-schema.js";
import type { MediaWorker, WorkerRequest } from "../../src/worker/types.js";
import { transcriptFixture } from "./fixtures.js";

export type WorkerBehaviour = (request: WorkerRequest, call: number) => Promise<WorkerTranscript>;

/** Records every request and answers with a scripted behaviour. Never spawns Python. */
export class FakeWorker implements MediaWorker {
  readonly requests: WorkerRequest[] = [];

  constructor(private behaviour: WorkerBehaviour = async () => transcriptFixture()) {}

  setBehaviour(behaviour: WorkerBehaviour): void {
    this.behaviour = behaviour;
  }

  transcribe(request: WorkerRequest): Promise<WorkerTranscript> {
    this.requests.push(request);
    return this.behaviour(request, this.requests.length - 1);
  }
}

export function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
