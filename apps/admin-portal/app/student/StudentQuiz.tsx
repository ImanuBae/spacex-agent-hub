"use client";

import { useState, type FormEvent } from "react";

export type QuizQuestion = { prompt: string; choices: string[] };
type Result = { score: number; feedback: { correct: boolean; explanation: string }[] };

export default function StudentQuiz({ course, questions }: { course: string; questions: QuizQuestion[] }) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/student-library?course=" + encodeURIComponent(course), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(answers),
      });
      if (response.status === 401) window.dispatchEvent(new Event("hub:unauthorized"));
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Chấm quiz chưa thành công.");
      setResult(body.data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Chấm quiz chưa thành công.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="sp-practice-quiz" aria-busy={busy} onSubmit={submit}>
    <h3>Quiz tự luyện {questions.length} câu</h3>
    <p className="sp-muted">Kết quả hiện sau khi nộp để bạn ôn lại. Bạn có thể làm lại.</p>
    {questions.map((question, index) => <fieldset key={question.prompt} disabled={busy || Boolean(result)}>
      <legend>{index + 1}. {question.prompt}</legend>
      {question.choices.map((choice, option) => <label key={choice}>
        <input type="radio" name={`answer-${index}`} checked={answers[index] === option}
          onChange={() => setAnswers(previous => previous.map((answer, position) => position === index ? option : answer))} />
        {choice}
      </label>)}
      {result && <p className="sp-quiz-feedback" data-correct={result.feedback[index].correct}>
        <strong>{result.feedback[index].correct ? "Đúng. " : "Chưa đúng. "}</strong>{result.feedback[index].explanation}
      </p>}
    </fieldset>)}
    {error && <p role="alert">{error}</p>}
    {result ? <div className="sp-actions">
      <strong role="status">Đúng {result.score}/{questions.length} câu</strong>
      <button type="button" className="sp-button" onClick={() => { setResult(undefined); setAnswers(questions.map(() => null)); }}>Làm lại</button>
    </div> : <button type="submit" className="sp-button sp-primary" disabled={busy || answers.includes(null)}>
      {busy ? "Đang chấm…" : "Nộp quiz tự luyện"}
    </button>}
  </form>;
}
