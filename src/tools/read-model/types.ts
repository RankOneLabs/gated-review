export type ReadModelEntityKind = 'coderabbit' | 'copilot' | 'human';

export type ReadModelEntity = Readonly<{
  kind: ReadModelEntityKind;
  login: string;
}>;

export type ReadModelThreadState = 'open' | 'resolved';

export type ReadModelThreadComment = Readonly<{
  id: string;
  body: string;
  createdAt: string;
  author: ReadModelEntity;
}>;

export type ReadModelReviewThread = Readonly<{
  id: string;
  state: ReadModelThreadState;
  path: string | null;
  line: number | null;
  hasFreshComments: boolean;
  comments: ReadModelThreadComment[];
}>;

export type ReadModelSummaryComment = Readonly<{
  id: string;
  body: string;
  createdAt: string;
  author: ReadModelEntity;
}>;

export type ReviewTriageBucketName = 'fix' | 'discuss' | 'ignore';

export type ReviewTriageBucket = Readonly<{
  name: ReviewTriageBucketName;
  description: string;
}>;

export type ReviewTriagePrompt = Readonly<{
  instruction: string;
  buckets: ReviewTriageBucket[];
  presentation: string;
  approvalRequired: string;
}>;

export type ReviewRound = Readonly<{
  pullRequestNumber: number;
  includeResolved: boolean;
  openThreadCount: number;
  freshSince: string | null;
  triagePrompt: ReviewTriagePrompt;
  threads: ReadModelReviewThread[];
  summaries: ReadModelSummaryComment[];
}>;

export type GitHubCheckState = 'success' | 'failure' | 'error' | 'pending';

export type ReadModelCheckContext = Readonly<{
  context: string;
  state: GitHubCheckState;
}>;

export type ReadModelChecksSummary = Readonly<{
  state: 'passing' | 'failing' | 'pending';
  totalCount: number;
  failingCount: number;
  pendingCount: number;
  contexts: ReadModelCheckContext[];
}>;

export type MergeReadyState = Readonly<{
  isReady: boolean;
  source: 'github_label';
  label: 'merge-ready';
}>;

export type PullRequestStatus = Readonly<{
  pullRequestNumber: number;
  openThreadCount: number;
  mergeReady: MergeReadyState;
  checks: ReadModelChecksSummary;
}>;
