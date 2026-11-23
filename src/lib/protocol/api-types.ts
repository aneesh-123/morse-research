/** Contract between the participant client and the server API (no secrets, no answer keys). */
import type { AudioParams } from './morse';
import type { ConsentDocument } from './consent';
import type { Stage } from './state-machine';
import type { Phase, StudyType } from './types';

export interface ClientTrial {
  position: number;
  trialKey: string;
  phase: Phase;
  phaseIndex: number;
  phaseTotal: number;
  block: number | null;
  blockCount: number | null;
  /** Morse pattern to play; the letter itself is not sent. */
  pattern: string;
  options: string[];
  includeIdk: boolean;
  feedback: boolean;
  replayAllowed: boolean;
  /** Letters (with patterns) introduced right before this trial. */
  introduce: { character: string; pattern: string }[];
}

export interface PhaseProgress { done: number; total: number }

export interface CompletionSummary {
  learning: { correct: number; total: number } | null;
  test: { correct: number; total: number; perCharacter: { character: string; correct: number; total: number }[] };
  durationMinutes: number | null;
  studyType: StudyType;
}

export interface SessionState {
  sessionId: string;
  studyType: StudyType;
  stage: Stage;
  protocolVersion: string;
  audio: AudioParams;
  characters: string[];
  consent: (ConsentDocument & { sha256: string }) | null;
  trial: ClientTrial | null;
  progress: Partial<Record<Phase, PhaseProgress>>;
  completion: CompletionSummary | null;
  /** Retention sessions: hours since the Day-1 session finished. */
  hoursSinceParent: number | null;
  /** For the participant UI: the timing/interruption policy in force. */
  idleThresholdMs: number;
}

export interface LearningFeedback {
  correct: boolean;
  correctCharacter: string;
  correctPattern: string;
  response: string | null;
}

export interface SubmitResult {
  saved: true;
  duplicate: boolean;
  feedback: LearningFeedback | null;
  state: SessionState;
}

export interface ParticipantSessionSummary {
  sessionId: string;
  studyType: StudyType;
  protocolVersion: string;
  stage: Stage;
  status: string;
  createdAt: string;
  completedAt: string | null;
  lastActivityAt: string;
}

export interface ParticipantOverview {
  displayName: string;
  publicCode: string;
  email: string | null;
  emailVerified: boolean;
  emailAvailable: boolean;
  sessions: ParticipantSessionSummary[];
  lastParticipation: string | null;
  incompleteSession: ParticipantSessionSummary | null;
  available: { studyType: StudyType; protocolVersion: string; title: string; minutes: [number, number] }[];
  upcoming: { studyType: StudyType; title: string; availableAt: string }[];
  enrollmentMessage: string | null;
}
