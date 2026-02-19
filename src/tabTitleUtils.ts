/**
 * Collapse whitespace (newlines, tabs, multiple spaces) into single spaces and trim.
 */
export function collapseWhitespace(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}

/**
 * Normalize a conversation title to match what VSCode shows as a tab label.
 *
 * Claude Code truncates: title.length > 25 ? title.slice(0,24)+"…" : title
 * VSCode tab labels collapse whitespace (newlines, tabs → single space) and trim.
 */
export function normalizeTabTitle(conversationTitle: string): string {
  const cleaned = collapseWhitespace(conversationTitle);
  if (cleaned.length > 25) {
    return cleaned.substring(0, 24) + "…";
  }
  return cleaned;
}
