const DEFAULT_MAX_LEN = 2000;

export function chunkText(text: string, maxLen: number = DEFAULT_MAX_LEN): string[] {
  if (text.length <= maxLen) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    const splitIndex = findSplitIndex(remaining, maxLen);
    chunks.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks.filter((c) => c.length > 0);
}

function findSplitIndex(text: string, maxLen: number): number {
  const candidate = text.slice(0, maxLen);

  // Check if splitting would break a code block (odd number of ``` fences)
  const codeBlockSplit = tryCodeBlockSplit(candidate);
  if (codeBlockSplit !== -1) {
    return codeBlockSplit;
  }

  // Try to split at double newline (paragraph boundary)
  const doubleNewline = candidate.lastIndexOf("\n\n");
  if (doubleNewline > maxLen * 0.3) {
    return doubleNewline;
  }

  // Try to split at single newline
  const singleNewline = candidate.lastIndexOf("\n");
  if (singleNewline > maxLen * 0.3) {
    return singleNewline;
  }

  // Hard split at maxLen
  return maxLen;
}

function tryCodeBlockSplit(candidate: string): number {
  const fenceRegex = /```/g;
  const fences: number[] = [];
  let match;
  while ((match = fenceRegex.exec(candidate)) !== null) {
    fences.push(match.index);
  }

  // Even number of fences (or zero) — no broken code block
  if (fences.length % 2 === 0) {
    return -1;
  }

  // Odd number: the last fence opens an unclosed block. Split before it.
  const lastFenceStart = fences[fences.length - 1];

  // Look for a newline before the opening fence
  const newlineBefore = candidate.lastIndexOf("\n", lastFenceStart - 1);
  if (newlineBefore > 0) {
    return newlineBefore;
  }

  // If we can't find a good spot before the fence, split at the fence itself
  return lastFenceStart;
}
