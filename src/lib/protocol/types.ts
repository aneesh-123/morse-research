import type { AudioParams } from './morse';

export type Phase = 'diagnostic' | 'learning' | 'final' | 'retention';

export type StudyType = 'day1_learning' | 'delayed_retention';

export interface RecognitionTestSpec {
  /** Characters tested; each appears `repetitionsPerCharacter` times. */
  characters: string[];
  repetitionsPerCharacter: number;
  includeIdk: boolean;
  feedback: false;
  replayAllowed: false;
  hintsAvailable: false;
}

export interface LearningBlockSpec {
  block: number; // 1-based
  trials: number;
  /** Characters introduced (shown + demonstrated) immediately before this block. */
  introduce: string[];
}

export interface LearningSpec {
  blocks: LearningBlockSpec[];
  /** Extra-trial rule when trials do not divide evenly among the active set. */
  balancing: 'fewest_scheduled_exposures_then_newest';
  includeIdk: false;
  feedback: true;
  replayAllowed: true;
  /** Whether the participant may replay the target after feedback is shown. */
  feedbackReplayAllowed: true;
  hintsAvailable: false;
  /** Fixed schedule: never adapted to performance in this protocol. */
  adaptive: false;
}

export interface RandomizationSpec {
  algorithm: string;
  /** No run of the same target longer than this, across block boundaries, when avoidable. */
  maxRunLength: number;
  /** Rejection-sampling attempts before the deterministic repair pass. */
  maxAttempts: number;
}

export interface TimingPolicy {
  /** Answers are disabled until the first presentation of the signal has finished. */
  answersEnabledAfterSignalEnd: true;
  /** Latency reference point for `rt_ms`. */
  latencyReference: 'end_of_first_playback';
  /** If the page is hidden while the signal plays, the trial restarts when visible again. */
  hiddenDuringPlayback: 'restart_trial';
  /** If the page is hidden after the signal but before an answer, the answer is accepted and flagged. */
  hiddenAfterPlayback: 'accept_and_flag';
  /** If the page is reloaded before an answer is saved, the same trial is presented again and flagged. */
  reloadBeforeAnswer: 'restart_trial_and_flag';
  /** Idle threshold for idle_start / idle_end events, ms. */
  idleThresholdMs: number;
}

interface ProtocolBase {
  version: string;
  studyType: StudyType;
  title: string;
  description: string;
  consentVersion: string;
  characters: string[];
  audio: AudioParams;
  randomization: RandomizationSpec;
  timing: TimingPolicy;
  targetDurationMinutes: [number, number];
}

export interface Day1Protocol extends ProtocolBase {
  studyType: 'day1_learning';
  diagnostic: RecognitionTestSpec & { optional: true };
  learning: LearningSpec;
  final: RecognitionTestSpec;
  estimatorVersion: string;
}

export interface RetentionProtocol extends ProtocolBase {
  studyType: 'delayed_retention';
  /** The Day-1 protocol a participant must have completed. */
  parentProtocolVersion: string;
  /** Earliest time after the parent session's completion, in hours. */
  minHoursAfterParent: number;
  test: RecognitionTestSpec;
}

export type Protocol = Day1Protocol | RetentionProtocol;

/** One scheduled trial; the stored schedule is the single source of truth for a session. */
export interface ScheduledTrial {
  /** Stable identifier: `${phase}-${position}` within a session. */
  trialKey: string;
  /** 1-based position across the whole session. */
  position: number;
  phase: Phase;
  /** 1-based index within the phase. */
  phaseIndex: number;
  block: number | null;
  target: string;
  pattern: string;
  /** Response options in display order (letters only; "I don't know" is separate). */
  options: string[];
  includeIdk: boolean;
  feedback: boolean;
  replayAllowed: boolean;
  /** Characters introduced immediately before this trial (first trial of a learning block). */
  introduceBefore: string[];
  /** Trials of this target scheduled earlier in the session (diagnostic + learning), excluding this one. */
  priorTargetPresentations: number;
}
