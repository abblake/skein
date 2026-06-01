// === PAI Data Types (read-only) ===

export interface WorkSession {
  prd?: string;
  task: string;
  sessionName: string;
  sessionUUID: string;
  phase: string;
  progress: string;
  effort: string;
  mode: string;
  started: string;
  updatedAt: string;
  criteria?: Criterion[];
}

export interface Criterion {
  id: string;
  description: string;
  type: "criterion" | "anti-criterion";
  status: "pending" | "completed";
}

export interface WorkJson {
  sessions: Record<string, WorkSession>;
}

export interface PrdFrontmatter {
  task: string;
  slug: string;
  effort: string;
  phase: string;
  progress: string;
  mode: string;
  started: string;
  updated: string;
  iteration?: number;
}

export interface Prd {
  frontmatter: PrdFrontmatter;
  context?: string;
  criteria?: string;
  decisions?: string;
  verification?: string;
  raw: string;
}

export interface Reflection {
  timestamp: string;
  effort_level: string;
  task_description: string;
  criteria_count: number;
  criteria_passed: number;
  criteria_failed: number;
  prd_id: string;
  implied_sentiment: number;
  reflection_q1: string;
  reflection_q2: string;
  reflection_q3: string;
  within_budget: boolean;
}

// === Skein Data Types (read-write) ===

export interface Project {
  id: string;
  name: string;
  directory: string;
  category?: "paper" | "analysis" | "teaching" | "tool" | "other";
  lastActive?: string;
  pinned?: boolean;
  archived?: boolean;
}

export interface ProjectRegistry {
  projects: Project[];
}

export interface SessionDigest {
  session_id: string;
  project: string;
  timestamp: string;
  duration_minutes?: number;
  explored: string;
  discovered: string;
  decided: string;
  threads: ThreadItem[];
}

export interface ThreadItem {
  id: string;
  type: "question" | "hypothesis" | "todo";
  text: string;
  sourceSession: string;
  sourceDate: string;
  status: "open" | "resolved" | "stale";
  resolvedIn?: string;
  resolvedDate?: string;
}

export interface LiveState {
  lastScan: string;
  activeSessions: ActiveSession[];
}

export interface ActiveSession {
  sessionUUID: string;
  projectDirectory: string;
  projectId: string;
  currentActivity: string;
  recentTools: string[];
  updatedAt: string;
}

// UI types moved to App.tsx
