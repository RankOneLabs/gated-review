export type GraphQLPageInfo = Readonly<{
  hasNextPage: boolean;
  endCursor: string | null;
}>;

export type GraphQLAuthor = Readonly<{
  login: string;
}> | null;

export type GraphQLReviewCommentNode = Readonly<{
  id: string;
  body: string;
  createdAt: string;
  author: GraphQLAuthor;
}>;

export type GraphQLReviewCommentConnection = Readonly<{
  nodes: ReadonlyArray<GraphQLReviewCommentNode>;
  pageInfo: GraphQLPageInfo;
}>;

export type GraphQLReviewThreadNode = Readonly<{
  id: string;
  isResolved: boolean;
  path: string | null;
  line: number | null;
}>;

export type GraphQLReviewThreadConnection = Readonly<{
  nodes: ReadonlyArray<GraphQLReviewThreadNode>;
  pageInfo: GraphQLPageInfo;
}>;

export type GraphQLReviewThreadWithCommentsNode = GraphQLReviewThreadNode & Readonly<{
  comments: GraphQLReviewCommentConnection;
}>;

export type GraphQLReviewThreadWithCommentsConnection = Readonly<{
  nodes: ReadonlyArray<GraphQLReviewThreadWithCommentsNode>;
  pageInfo: GraphQLPageInfo;
}>;

export type GraphQLReviewRoundIssueCommentNode = Readonly<{
  id: string;
  body: string;
  createdAt: string;
  author: GraphQLAuthor;
}>;

export type GraphQLIssueCommentConnection = Readonly<{
  nodes: ReadonlyArray<GraphQLReviewRoundIssueCommentNode>;
  pageInfo: GraphQLPageInfo;
}>;

export type GraphQLLabelNode = Readonly<{
  name: string;
}>;

export type GraphQLLabelConnection = Readonly<{
  nodes: ReadonlyArray<GraphQLLabelNode>;
  pageInfo: GraphQLPageInfo;
}>;

export type GraphQLPrState = 'OPEN' | 'CLOSED' | 'MERGED';

export type GraphQLReviewRoundThreadsQueryData = Readonly<{
  repository: Readonly<{
    pullRequest: Readonly<{
      state: GraphQLPrState;
      reviewThreads: GraphQLReviewThreadConnection;
    }> | null;
  }> | null;
}>;

export type GraphQLReviewRoundSummariesQueryData = Readonly<{
  repository: Readonly<{
    pullRequest: Readonly<{
      comments: GraphQLIssueCommentConnection;
    } | null>;
  }> | null;
}>;

export type GraphQLReviewThreadCommentsQueryData = Readonly<{
  node: Readonly<{
    comments: GraphQLReviewCommentConnection;
  }> | null;
}>;

export type GraphQLPrStatusQueryData = Readonly<{
  repository: Readonly<{
    pullRequest: Readonly<{
      state: GraphQLPrState;
      headRefOid: string;
      reviewThreads: Readonly<{
        nodes: ReadonlyArray<Readonly<{ isResolved: boolean }>>;
        pageInfo: GraphQLPageInfo;
      }>;
    } | null>;
  }> | null;
}>;

export type GraphQLPrStatusLabelsQueryData = Readonly<{
  repository: Readonly<{
    pullRequest: Readonly<{
      labels: GraphQLLabelConnection;
    } | null>;
  }> | null;
}>;

export const reviewRoundThreadsQuery = `
  query ReviewRoundThreadsQuery($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        state
        reviewThreads(first: 100, after: $after) {
          nodes {
            id
            isResolved
            path
            line
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

export const reviewRoundSummariesQuery = `
  query ReviewRoundSummariesQuery($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        comments(first: 100, after: $after) {
          nodes {
            id
            body
            createdAt
            author {
              login
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

export const reviewThreadCommentsQuery = `
  query ReviewThreadCommentsQuery($id: ID!, $after: String) {
    node(id: $id) {
      ... on PullRequestReviewThread {
        comments(first: 100, after: $after) {
          nodes {
            id
            body
            createdAt
            author {
              login
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

export const prStatusQuery = `
  query PrStatusQuery($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        state
        headRefOid
        reviewThreads(first: 100, after: $after) {
          nodes {
            isResolved
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

export const prStatusLabelsQuery = `
  query PrStatusLabelsQuery($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        labels(first: 100, after: $after) {
          nodes {
            name
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;
