import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { useApp } from '../state';
import { isLocalAssetUrl, parseFileReference } from './file-reference';
import { SaveArtifactButton } from '../features/Artifacts';
import { WebSourceInspector } from '../features/WebSources';
import type { SourceCitationAudit } from '../../shared/research';
import { hasExcessiveSourceMarkers } from '../../shared/research';
export function Markdown({
  text,
  artifactOrigin,
  sourceCitations,
}: {
  text: string;
  artifactOrigin?: { conversationId: string; messageId: string; projectId?: string | null };
  sourceCitations?: SourceCitationAudit;
}) {
  const { snapshot, view, projectId, report } = useApp();
  const [source, setSource] = useState<{ sourceId: string; paragraph: number } | null>(null);
  const project = snapshot?.projects.find(
    (item) => item.id === (view?.conversation.projectId ?? projectId),
  );
  const workspace =
    snapshot?.workspaces?.find((item) => item.id === view?.conversation.workspaceId) ?? project;
  if (hasExcessiveSourceMarkers(text))
    return (
      <div className="markdown">
        <p className="muted small">
          Formatting limited because this response contains unusually many source markers. The
          complete text is preserved below.
        </p>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</pre>
      </div>
    );
  return (
    <div className="markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[
          remarkGfm,
          [
            capturedSourceLinks,
            {
              allowed: sourceCitations?.valid.map((citation) => citation.token) ?? [],
              sourceText: text,
            },
          ],
        ]}
        urlTransform={(url, key) =>
          (key === 'src' && isLocalAssetUrl(url)) ||
          (key === 'href' &&
            (/^captured-source:[0-9a-f-]{36}:\d+$/i.test(url) ||
              (workspace?.path && parseFileReference(url, workspace.path))))
            ? url
            : defaultUrlTransform(url)
        }
        components={{
          pre: ({ children }) => <CodeBlock artifactOrigin={artifactOrigin}>{children}</CodeBlock>,
          table: ({ children }) => (
            <div className="markdownTable" role="region" aria-label="Table" tabIndex={0}>
              <table>{children}</table>
            </div>
          ),
          img: ({ src, alt }) =>
            src && isLocalAssetUrl(src) ? (
              <img
                className="messageImage"
                src={src}
                alt={alt || 'Generated image'}
                loading="lazy"
              />
            ) : (
              <span className="muted">[Image: {alt || 'not loaded'}]</span>
            ),
          a: ({ href, children }) => {
            const external = href && /^https?:\/\//i.test(href);
            const citation = href?.match(/^captured-source:([0-9a-f-]{36}):(\d+)$/i);
            const file = href && workspace?.path ? parseFileReference(href, workspace.path) : null;
            if (
              citation &&
              sourceCitations?.valid.some(
                (item) => item.snapshotId === citation[1] && item.paragraph === Number(citation[2]),
              )
            )
              return (
                <button
                  className="textButton"
                  title="Inspect captured source paragraph"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSource({ sourceId: citation[1], paragraph: Number(citation[2]) });
                  }}
                >
                  {children}
                </button>
              );
            if (!external && !file) return <span>{children}</span>;
            return (
              <a
                href={href}
                title={
                  file ? `Open ${file.path}${file.line ? ` at line ${file.line}` : ''}` : undefined
                }
                onClick={(event) => {
                  event.preventDefault();
                  if (external) void window.desktop.openExternal(href!).catch(report);
                  else if (file && workspace)
                    void window.desktop.openFile(workspace.id, file.path, file.line).catch(report);
                }}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
      {source && (
        <WebSourceInspector
          sourceId={source.sourceId}
          paragraph={source.paragraph}
          onClose={() => setSource(null)}
          onError={report}
        />
      )}
    </div>
  );
}

function CodeBlock({
  children,
  artifactOrigin,
}: {
  children: ReactNode;
  artifactOrigin?: { conversationId: string; messageId: string; projectId?: string | null };
}) {
  const report = useApp((state) => state.report);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const code = Children.toArray(children).find((child) => isValidElement(child));
  const props = isValidElement<{ children?: ReactNode; className?: string }>(code)
    ? code.props
    : undefined;
  const text = typeof props?.children === 'string' ? props.children : '';
  const language = props?.className?.match(/language-([^\s]+)/)?.[1];
  useEffect(() => {
    setCopied(false);
    clearTimeout(timer.current);
  }, [text]);
  return (
    <div className="codeBlock">
      <div className="codeBlockToolbar">
        <span>{language || 'Code'}</span>
        <button
          className="textButton"
          aria-label="Copy code"
          disabled={!text}
          onClick={() => {
            setCopied(false);
            void window.desktop
              .copyText(text)
              .then(() => {
                setCopied(true);
                clearTimeout(timer.current);
                timer.current = setTimeout(() => setCopied(false), 2000);
              })
              .catch(report);
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span role="status">{copied ? 'Copied' : 'Copy'}</span>
        </button>
        {artifactOrigin && text && (
          <SaveArtifactButton source={text} language={language} {...artifactOrigin} />
        )}
      </div>
      <pre>{children}</pre>
    </div>
  );
}

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};
function capturedSourceLinks({
  allowed = [],
  sourceText = '',
}: { allowed?: string[]; sourceText?: string } = {}) {
  const accepted = new Set(allowed);
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (
        !node.children ||
        ['code', 'inlineCode', 'link', 'linkReference', 'image', 'imageReference', 'html'].includes(
          node.type,
        )
      )
        return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== 'text' || !child.value) {
          visit(child);
          return [child];
        }
        const start = child.position?.start.offset;
        const end = child.position?.end.offset;
        // Escaped/entity markers stay literal; the audited source list remains inspectable.
        if (
          start === undefined ||
          end === undefined ||
          sourceText.slice(start, end).replace(/\r\n/g, '\n') !== child.value
        )
          return [child];
        const result: MarkdownNode[] = [];
        const pattern =
          /\[\[source:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d+)\]\]/gi;
        let offset = 0;
        for (const match of child.value.matchAll(pattern)) {
          if (!accepted.has(match[0])) continue;
          if (match.index! > offset)
            result.push({ type: 'text', value: child.value.slice(offset, match.index) });
          result.push({
            type: 'link',
            url: `captured-source:${match[1]}:${match[2]}`,
            children: [{ type: 'text', value: `Source ¶${match[2]}` }],
          });
          offset = match.index! + match[0].length;
        }
        if (!result.length) return [child];
        if (offset < child.value.length)
          result.push({ type: 'text', value: child.value.slice(offset) });
        return result;
      });
    };
    visit(tree);
  };
}
