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
  comments: ReadonlyArray<ReadModelThreadComment>;
}>;

export type ReadModelSummaryComment = Readonly<{
  id: string;
  body: string;
  createdAt: string;
  author: ReadModelEntity;
}>;

export type ReviewRound = Readonly<{
  pullRequestNumber: number;
  includeResolved: boolean;
  openThreadCount: number;
  threads: ReadonlyArray<ReadModelReviewThread>;
  summaries: ReadonlyArray<ReadModelSummaryComment>;
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
  contexts: ReadonlyArray<ReadModelCheckContext>;
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
