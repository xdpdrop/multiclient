import { useEffect, useState } from 'react';
import type { Message, ResponseBlock } from '../../shared/types';
import { Markdown } from './Markdown';
import { SourceCitationList } from '../features/SourceCitationList';
import { WebSourceInspector } from '../features/WebSources';
import { useApp } from '../state';

export function MessageContent({
  message,
  projectId,
}: {
  message: Message;
  projectId?: string | null;
}) {
  const report = useApp((state) => state.report);
  const artifactOrigin =
    message.role === 'assistant' && message.status === 'completed'
      ? { conversationId: message.conversationId, messageId: message.id, projectId }
      : undefined;
  const [source, setSource] = useState<{ sourceId: string; paragraph: number } | null>(null);
  const citations = message.sourceCitations && (
    <SourceCitationList
      audit={message.sourceCitations}
      onInspect={(sourceId, paragraph) => setSource({ sourceId, paragraph })}
    />
  );
  const inspector = source && (
    <WebSourceInspector {...source} onClose={() => setSource(null)} onError={report} />
  );
  if (!message.blocks?.length)
    return (
      <>
        <Markdown
          text={message.text}
          artifactOrigin={artifactOrigin}
          sourceCitations={message.sourceCitations}
        />
        {citations}
        {inspector}
      </>
    );
  const hasAnswer = message.blocks.some((block) => block.phase === 'answer' && block.text);
  return (
    <>
      {message.blocks.map((block) =>
        block.phase === 'commentary' ? (
          <ProgressBlock
            key={block.id}
            block={block}
            active={message.status === 'streaming' && !hasAnswer}
          />
        ) : (
          <div key={block.id} className="answerBlock">
            <Markdown
              text={block.text}
              artifactOrigin={artifactOrigin}
              sourceCitations={message.sourceCitations}
            />
          </div>
        ),
      )}
      {citations}
      {inspector}
    </>
  );
}

function ProgressBlock({ block, active }: { block: ResponseBlock; active: boolean }) {
  const [open, setOpen] = useState(active);
  useEffect(() => {
    setOpen(active);
  }, [active]);
  return (
    <details
      className="progressUpdate"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Progress update</summary>
      <Markdown text={block.text} />
    </details>
  );
}
