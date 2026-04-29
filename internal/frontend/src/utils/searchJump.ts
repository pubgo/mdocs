const SEARCH_TARGET_SELECTOR = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "li",
  "blockquote",
  "pre",
  "code",
  "td",
  "th",
].join(",");

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function findByNeedle(root: HTMLElement, needle: string): HTMLElement | null {
  if (!needle) return null;

  const candidates = root.querySelectorAll<HTMLElement>(SEARCH_TARGET_SELECTOR);
  for (const candidate of candidates) {
    if (normalizeText(candidate.textContent ?? "").includes(needle)) {
      return candidate;
    }
  }

  return null;
}

export function findBestSearchTarget(
  root: HTMLElement,
  lineText: string,
  query: string,
): HTMLElement | null {
  const normalizedLine = normalizeText(lineText);
  const normalizedQuery = normalizeText(query);

  const byLine = findByNeedle(root, normalizedLine);
  if (byLine) return byLine;

  const byQuery = findByNeedle(root, normalizedQuery);
  if (byQuery) return byQuery;

  if (!normalizedQuery) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (normalizeText(node.textContent ?? "").includes(normalizedQuery)) {
      if (node.parentElement instanceof HTMLElement) {
        return node.parentElement;
      }
      return null;
    }
    node = walker.nextNode();
  }

  return null;
}