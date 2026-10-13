import { useId } from 'react';
import type { Interaction, QuestionAnswer } from '../../shared/types';

type Question = NonNullable<Interaction['questions']>[number];
export type TypedQuestionAnswers = Record<string, QuestionAnswer>;

export function hasQuestionAnswer(question: Question, answer?: QuestionAnswer) {
  if (!answer) return false;
  if (answer.selected.some((option) => !question.options.includes(option))) return false;
  if (!question.multiple && answer.selected.length > 1) return false;
  return answer.selected.length > 0 || (question.allowFreeText !== false && !!answer.text.trim());
}

export function questionAnswersValid(questions: Question[], answers: TypedQuestionAnswers) {
  return questions.every((question) => hasQuestionAnswer(question, answers[question.id]));
}

export function QuestionFields({
  questions,
  answers,
  onChange,
  disabled = false,
}: {
  questions: Question[];
  answers: TypedQuestionAnswers;
  onChange: (answers: TypedQuestionAnswers) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return questions.map((question, index) => {
    const answer = answers[question.id] ?? { selected: [], text: '' };
    const update = (next: QuestionAnswer) => onChange({ ...answers, [question.id]: next });
    return (
      <fieldset key={question.id} className="questionField" disabled={disabled}>
        <legend>{question.prompt}</legend>
        {question.multiple && question.options.length > 0 && (
          <p className="muted small">Choose one or more options.</p>
        )}
        <div className="questionOptions">
          {question.options.map((option) => (
            <label className="questionOption" key={option}>
              <input
                type={question.multiple ? 'checkbox' : 'radio'}
                name={`${id}-${index}`}
                checked={answer.selected.includes(option)}
                onChange={(event) =>
                  update({
                    selected: question.multiple
                      ? event.target.checked
                        ? [...answer.selected, option]
                        : answer.selected.filter((value) => value !== option)
                      : [option],
                    text: question.multiple ? answer.text : '',
                  })
                }
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
        {question.allowFreeText !== false && (
          <label>
            {question.options.length ? 'Other answer' : 'Your answer'}
            <input
              value={answer.text}
              onChange={(event) =>
                update({
                  selected: question.multiple ? answer.selected : [],
                  text: event.target.value,
                })
              }
            />
          </label>
        )}
      </fieldset>
    );
  });
}
