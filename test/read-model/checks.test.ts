import { describe, expect, it } from 'vitest';

import { summarizeChecks } from '#root/src/tools/read-model/checks.js';

describe('read model checks', () => {
  it('collapses combined status into a tool-friendly summary', () => {
    expect(
      summarizeChecks({
        state: 'failure',
        statuses: [
          { context: 'lint', state: 'success' },
          { context: 'tests', state: 'failure' },
          { context: 'docs', state: 'pending' }
        ]
      })
    ).toEqual({
      state: 'failing',
      totalCount: 3,
      failingCount: 1,
      pendingCount: 1,
      contexts: [
        { context: 'lint', state: 'success' },
        { context: 'tests', state: 'failure' },
        { context: 'docs', state: 'pending' }
      ]
    });
  });
});
