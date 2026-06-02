import { describe, expect, it } from 'vitest';

import { NotImplementedToolError } from '../src/errors.js';
import { actorScopes } from '../src/tools/actors.js';
import { toolRegistry } from '../src/tools/registry.js';

describe('tool contracts', () => {
  it('exposes a narrow curated tool surface', () => {
    expect(toolRegistry.map((tool) => tool.name)).toEqual([
      'review.get_state',
      'review.list_actions',
      'review.record_event',
      'review.apply_decision'
    ]);
    expect(toolRegistry.map((tool) => tool.name)).not.toContain('github_raw');
  });

  it('publishes actor scope metadata for each tool', () => {
    expect(toolRegistry.find((tool) => tool.name === 'review.get_state')?.actorScopes).toEqual(
      actorScopes
    );
    expect(toolRegistry.find((tool) => tool.name === 'review.list_actions')?.actorScopes).toEqual([
      'agent',
      'operator'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'review.record_event')?.actorScopes).toEqual([
      'event_source'
    ]);
    expect(toolRegistry.find((tool) => tool.name === 'review.apply_decision')?.actorScopes).toEqual([
      'operator'
    ]);
  });

  it('keeps the shaped output schema names explicit', () => {
    expect(toolRegistry.map((tool) => tool.outputSchemaName)).toEqual([
      'review.get_state.output',
      'review.list_actions.output',
      'review.record_event.output',
      'review.apply_decision.output'
    ]);
  });

  it('binds every v1 handler to an explicit not implemented error', async () => {
    await Promise.all(
      toolRegistry.map(async (tool) => {
        await expect(tool.handler({ reviewId: 'review-123' } as never)).rejects.toBeInstanceOf(
          NotImplementedToolError
        );
      })
    );
  });
});
