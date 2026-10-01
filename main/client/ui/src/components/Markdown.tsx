// main/client/ui/src/components/Markdown.tsx
/**
 * Renders a Markdown document as React elements.
 *
 * No `dangerouslySetInnerHTML` anywhere: the parser emits typed tokens and this
 * builds elements from them, so raw HTML inside a document — `<script>`, an
 * `onerror` attribute, anything — comes out as visible text. Injection is
 * impossible by construction rather than by sanitiser, which is the only kind
 * of safety worth relying on for content edited in an admin panel.
 *
 * The href on a link is allowlisted in the parser, not here, so this component
 * has no way to render an unsafe one even if it is called with hand-built
 * tokens.
 *
 * Styling comes from the `.markdown-content` GFM stylesheet in
 * styles/elements.css — the one markdown stylesheet in the design system — so
 * the elements below stay bare and inherit from it.
 */

import { parseMarkdown } from '../utils/markdown';

import type { MarkdownBlock, MarkdownSpan } from '../utils/markdown';
import type { ReactElement, ReactNode } from 'react';

export interface MarkdownProps {
  /** The document body. */
  readonly children: string;
  readonly className?: string;
}

function Spans({ spans }: { spans: readonly MarkdownSpan[] }): ReactElement {
  return (
    <>
      {spans.map((span, index) => {
        const key = `${span.kind}-${String(index)}`;
        switch (span.kind) {
          case 'bold':
            return (
              <strong key={key}>
                <Spans spans={span.spans} />
              </strong>
            );
          case 'italic':
            return (
              <em key={key}>
                <Spans spans={span.spans} />
              </em>
            );
          case 'strike':
            return (
              <del key={key}>
                <Spans spans={span.spans} />
              </del>
            );
          case 'code':
            return <code key={key}>{span.value}</code>;
          case 'link':
            // External links leave the app and must not hand the new tab a
            // handle on this window.
            return span.external ? (
              <a key={key} href={span.href} target="_blank" rel="noreferrer noopener">
                {span.value}
              </a>
            ) : (
              <a key={key} href={span.href}>
                {span.value}
              </a>
            );
          case 'text':
            return <span key={key}>{span.value}</span>;
        }
      })}
    </>
  );
}

function Block({ block }: { block: MarkdownBlock }): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const spans = <Spans spans={block.spans} />;
      switch (block.level) {
        case 1:
          return <h1>{spans}</h1>;
        case 2:
          return <h2>{spans}</h2>;
        case 3:
          return <h3>{spans}</h3>;
        case 4:
          return <h4>{spans}</h4>;
        case 5:
          return <h5>{spans}</h5>;
        default:
          return <h6>{spans}</h6>;
      }
    }
    case 'paragraph':
      return (
        <p>
          <Spans spans={block.spans} />
        </p>
      );
    case 'list':
      return block.ordered ? (
        <ol>
          {block.items.map((item, index) => (
            <li key={`item-${String(index)}`}>
              <Spans spans={item} />
            </li>
          ))}
        </ol>
      ) : (
        <ul>
          {block.items.map((item, index) => (
            <li key={`item-${String(index)}`}>
              <Spans spans={item} />
            </li>
          ))}
        </ul>
      );
    case 'table':
      // `.markdown-content table` is its own scroll container (display: block,
      // overflow: auto), so a wide table scrolls in place rather than pushing
      // the page sideways on a phone.
      return (
        <table>
          <thead>
            <tr>
              {block.head.map((cell, index) => (
                <th key={`h-${String(index)}`} scope="col">
                  <Spans spans={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`r-${String(rowIndex)}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`c-${String(cellIndex)}`}>
                    <Spans spans={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'quote':
      return (
        <blockquote>
          <Spans spans={block.spans} />
        </blockquote>
      );
    case 'code':
      return (
        <pre>
          <code>{block.value}</code>
        </pre>
      );
    case 'rule':
      return <hr />;
  }
}

export function Markdown({ children, className = '' }: MarkdownProps): ReactElement {
  const blocks = parseMarkdown(children);
  return (
    <div className={`markdown-content ${className}`.trim()}>
      {blocks.map((block, index) => (
        <Block key={`${block.kind}-${String(index)}`} block={block} />
      ))}
    </div>
  );
}
