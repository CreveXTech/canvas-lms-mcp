import { stripHtmlOrNull } from "../html.js";
import {
  count,
  courseInput,
  flag,
  id,
  points,
  quizId,
  registerReadOnlyTool,
  text,
  timestamp,
  z,
  type ToolGroup,
} from "./common.js";

interface CanvasQuiz {
  id: number;
  title: string;
  description: string | null;
  due_at: string | null;
  lock_at: string | null;
  unlock_at: string | null;
  points_possible: number | null;
  quiz_type: string;
  time_limit: number | null;
  allowed_attempts: number | null;
  question_count: number;
  show_correct_answers: boolean;
  published: boolean;
  html_url: string;
}

const quizFields = {
  id,
  title: text,
  due_at: timestamp,
  lock_at: timestamp,
  unlock_at: timestamp,
  points_possible: points,
  quiz_type: text,
  time_limit: count,
  allowed_attempts: count,
  question_count: count,
  published: flag,
  html_url: text,
};

export const quizTools: ToolGroup = (server, canvas) => {
  registerReadOnlyTool(
    server,
    "list_quizzes",
    {
      title: "List Quizzes",
      description: "List quizzes for a course",
      inputSchema: courseInput,
      outputSchema: { quizzes: z.array(z.object(quizFields)) },
    },
    async ({ course_id }) => {
      const quizzes = await canvas.list<CanvasQuiz>(
        `/courses/${course_id}/quizzes`,
      );

      return {
        quizzes: quizzes.map((q) => ({
          id: q.id,
          title: q.title,
          due_at: q.due_at,
          lock_at: q.lock_at,
          unlock_at: q.unlock_at,
          points_possible: q.points_possible,
          quiz_type: q.quiz_type,
          time_limit: q.time_limit,
          allowed_attempts: q.allowed_attempts,
          question_count: q.question_count,
          published: q.published,
          html_url: q.html_url,
        })),
      };
    },
  );

  registerReadOnlyTool(
    server,
    "get_quiz",
    {
      title: "Get Quiz",
      description:
        "Get full details for a quiz including description and questions (if available)",
      inputSchema: { ...courseInput, quiz_id: quizId },
      outputSchema: {
        ...quizFields,
        description: text,
        show_correct_answers: flag,
        questions: z.array(
          z.object({
            id,
            name: text,
            type: text,
            points,
            text,
          }),
        ),
        questions_available: z
          .boolean()
          .describe(
            "False when Canvas withheld the questions, e.g. the quiz is locked or not yet open",
          ),
      },
    },
    async ({ course_id, quiz_id }) => {
      const quiz = await canvas.get<CanvasQuiz>(
        `/courses/${course_id}/quizzes/${quiz_id}`,
      );

      interface Question {
        id: number;
        question_name: string;
        question_type: string;
        points_possible: number;
        question_text: string | null;
      }

      // Questions are commonly restricted until the quiz opens; a failure here
      // should not cost the caller the rest of the quiz metadata.
      let questions: Question[] = [];
      let questionsAvailable = true;
      try {
        questions = await canvas.list<Question>(
          `/courses/${course_id}/quizzes/${quiz_id}/questions`,
        );
      } catch {
        questionsAvailable = false;
      }

      return {
        id: quiz.id,
        title: quiz.title,
        description: stripHtmlOrNull(quiz.description),
        due_at: quiz.due_at,
        lock_at: quiz.lock_at,
        unlock_at: quiz.unlock_at,
        points_possible: quiz.points_possible,
        quiz_type: quiz.quiz_type,
        time_limit: quiz.time_limit,
        allowed_attempts: quiz.allowed_attempts,
        question_count: quiz.question_count,
        show_correct_answers: quiz.show_correct_answers,
        published: quiz.published,
        html_url: quiz.html_url,
        questions_available: questionsAvailable,
        questions: questions.map((q) => ({
          id: q.id,
          name: q.question_name,
          type: q.question_type,
          points: q.points_possible,
          text: stripHtmlOrNull(q.question_text),
        })),
      };
    },
  );
};
