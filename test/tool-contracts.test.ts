import { describe, expect, it } from 'vitest';

import { actorScopes } from '#root/src/tools/actors.js';
import { toolRegistry } from '#root/src/tools/registry.js';
import {
  getReviewRoundInputSchema,
  getReviewRoundOutputSchema,
  prStatusInputSchema,
  prStatusOutputSchema
} from '#root/src/tools/schemas.js';

describe('tool contracts', () => {
  it('exposes the read-model tool surface', () => {
    expect(toolRegistry.map((tool) => tool.name)).toEqual(['get_review_round', 'pr_status']);
  });

  it('publishes actor scope metadata for each tool', () => {
    expect(toolRegistry.find((tool) => tool.name === 'get_review_round')?.actorScopes).toEqual([
      'agent',
      'event_source'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'pr_status')?.actorScopes).toEqual([
      'agent',
      'operator',
      'event_source'
    ]);
    expect(actorScopes).toContain('event_source');
  });

  it('keeps the shaped output schema names explicit', () => {
    expect(toolRegistry.map((tool) => tool.outputSchemaName)).toEqual([
      'get_review_round.output',
      'pr_status.output'
    ]);
  });

  it('accepts shaped read-model payloads', () => {
    expect(getReviewRoundInputSchema.parse({ pullRequestNumber: 42 })).toEqual({
      pullRequestNumber: 42
    });
    expect(
      getReviewRoundOutputSchema.parse({
        pullRequestNumber: 42,
        includeResolved: false,
        openThreadCount: 1,
        threads: [
          {
            id: 'thread-1',
            state: 'open',
            path: 'src/open.ts',
            line: 12,
            comments: [
              {
                id: 'comment-1',
                body: 'please adjust',
                createdAt: '2026-06-02T12:00:00.000Z',
                author: {
                  login: 'alice',
                  kind: 'human'
                }
              }
            ]
          }
        ],
        summaries: [
          {
            id: 'summary-1',
            body: 'review summary',
            createdAt: '2026-06-02T12:01:00.000Z',
            author: {
              login: 'copilot[bot]',
              kind: 'copilot'
            }
          }
        ]
      })
    ).toEqual({
      pullRequestNumber: 42,
      includeResolved: false,
      openThreadCount: 1,
      threads: [
        {
          id: 'thread-1',
          state: 'open',
          path: 'src/open.ts',
          line: 12,
          comments: [
            {
              id: 'comment-1',
              body: 'please adjust',
              createdAt: '2026-06-02T12:00:00.000Z',
              author: {
                login: 'alice',
                kind: 'human'
              }
            }
          ]
        }
      ],
      summaries: [
        {
          id: 'summary-1',
          body: 'review summary',
          createdAt: '2026-06-02T12:01:00.000Z',
          author: {
            login: 'copilot[bot]',
            kind: 'copilot'
          }
        }
      ]
    });
    expect(prStatusInputSchema.parse({ pullRequestNumber: 42 })).toEqual({
      pullRequestNumber: 42
    });
    expect(
      prStatusOutputSchema.parse({
        pullRequestNumber: 42,
        openThreadCount: 1,
        mergeReady: {
          isReady: true,
          source: 'github_label',
          label: 'merge-ready'
        },
        checks: {
          state: 'passing',
          totalCount: 1,
          failingCount: 0,
          pendingCount: 0,
          contexts: [{ context: 'lint', state: 'success' }]
        }
      })
    ).toEqual({
      pullRequestNumber: 42,
      openThreadCount: 1,
      mergeReady: {
        isReady: true,
        source: 'github_label',
        label: 'merge-ready'
      },
      checks: {
        state: 'passing',
        totalCount: 1,
        failingCount: 0,
        pendingCount: 0,
        contexts: [{ context: 'lint', state: 'success' }]
      }
    });
  });
});
