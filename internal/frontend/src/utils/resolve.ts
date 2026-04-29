import { isStaticMode, getStaticRawAssetUrl } from "./staticData";

export type LinkResolution =
  | { type: "external" }
  | { type: "hash" }
  | { type: "markdown"; hrefPath: string; anchor: string | null }
  | { type: "file"; rawUrl: string }
  | { type: "passthrough" };

function stripHashAndQuery(href: string): { path: string; anchor: string | null } {
  const hashIndex = href.indexOf("#");
  const anchor = hashIndex >= 0 ? href.slice(hashIndex + 1) : null;
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const queryIndex = withoutHash.indexOf("?");
  const path = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  return { path, anchor };
}

export function resolveLink(href: string | undefined, fileId: string): LinkResolution {
  if (!href || /^(https?:\/\/|mailto:|tel:)/i.test(href)) {
    return { type: "external" };
  }
  if (href.startsWith("#")) {
    return { type: "hash" };
  }
  const { path: hrefPath, anchor } = stripHashAndQuery(href);
  if (/\.mdx?$/i.test(hrefPath)) {
    return { type: "markdown", hrefPath, anchor };
  }
  const basename = hrefPath.split("/").pop() || "";
  if (basename.includes(".")) {
    return { type: "file", rawUrl: `/_/api/files/${fileId}/raw/${href}` };
  }
  return { type: "passthrough" };
}

export function resolveImageSrc(src: string | undefined, fileId: string): string | undefined {
  if (src && !src.startsWith("http://") && !src.startsWith("https://")) {
    if (isStaticMode()) {
      const dataUri = getStaticRawAssetUrl(fileId, src);
      if (dataUri) return dataUri;
    }
    return `/_/api/files/${fileId}/raw/${src}`;
  }
  return src;
}

export function extractLanguage(className: string | undefined): string | null {
  const match = /language-(\w+)/.exec(className || "");
  return match ? match[1] : null;
}
