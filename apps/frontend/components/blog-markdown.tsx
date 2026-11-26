import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

/**
 * Renders the blog's restricted markdown (see `blog_posts.body`): `## `/`### `
 * headings, `- ` lists, paragraphs, **bold** and [links](https://…). Built
 * as React elements, never as HTML, so a post can't inject markup even if a
 * draft slipped past the checks. Anything else stays plain text.
 */
const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = m.index;
    if (m[1] !== undefined) {
      out.push(<strong key={key}>{m[1]}</strong>);
    } else {
      const [label, url] = [m[2]!, m[3]!];
      if (/^https:\/\//i.test(url)) {
        out.push(
          <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:no-underline">
            {label}
          </a>
        );
      } else if (/^\/[a-z0-9/_-]*$/i.test(url)) {
        out.push(
          <Link key={key} href={url} className="text-primary underline underline-offset-2 hover:no-underline">
            {label}
          </Link>
        );
      } else {
        out.push(label);
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** House style is the spaced en dash; older posts were drafted with the em dash. */
export function normalizeDashes(text: string): string {
  return text.replace(/\s*\u2014\s*/g, ' \u2013 ');
}

function blocksOf(body: string): string[] {
  return normalizeDashes(body.replace(/\r\n/g, '\n'))
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

/** The `## ` headings with the ids BlogMarkdown gives them, for a table of contents. */
export function blogHeadings(body: string): { id: string; title: string }[] {
  return blocksOf(body)
    .filter((b) => b.startsWith('## '))
    .map((b, i) => ({ id: `h${i + 1}`, title: b.slice(3).replace(/\*\*([^*]+)\*\*|\[([^\]]+)\]\([^)]*\)/g, '$1$2') }));
}

export function BlogMarkdown({ body }: { body: string }) {
  const blocks = blocksOf(body);
  let h2 = 0;
  return (
    <div className="space-y-4 text-base leading-7">
      {blocks.map((block, i) => {
        if (block.startsWith('### ')) {
          return (
            <h3 key={i} className="pt-2 text-lg font-bold">
              {inline(block.slice(4))}
            </h3>
          );
        }
        if (block.startsWith('## ')) {
          return (
            <h2 key={i} id={`h${++h2}`} className="scroll-mt-24 pt-4 text-xl font-extrabold tracking-tight">
              {inline(block.slice(3))}
            </h2>
          );
        }
        const lines = block.split('\n');
        if (lines.every((l) => /^\s*- /.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-2 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*- /, ''))}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{inline(lines.join(' '))}</p>;
      })}
    </div>
  );
}
