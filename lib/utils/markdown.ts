export function compactMarkdown(input: string, maxLength = 12000) {
  return input.replace(/\n{3,}/g, "\n\n").trim().slice(0, maxLength);
}
