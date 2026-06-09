export const expectedTriagePrompt = {
  instruction:
    'Triage every open review thread into exactly one bucket before acting. Treat summaries as context, not bucketed threads.',
  buckets: [
    {
      name: 'fix',
      description: 'Clear, correct feedback with an implementation path you can apply locally.'
    },
    {
      name: 'discuss',
      description: 'Ambiguous, architectural, disputed, or otherwise requiring operator input.'
    },
    {
      name: 'ignore',
      description: 'Nitpick, style preference, duplicate, or already addressed; resolve only after operator approval.'
    }
  ],
  presentation:
    'Present open threads grouped as Fix, Discuss, and Ignore. Include location, author, fresh marker, short comment summary, and proposed fix or reason.',
  approvalRequired:
    'Stop after presenting triage. Apply fixes, replies, ignores, and resolutions only after operator approval.'
} as const;
