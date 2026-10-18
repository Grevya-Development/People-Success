"use client";

import { useRef, useState, useTransition } from "react";
import { Controller, useFieldArray, useWatch, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { Pencil, Plus, Route, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, SwitchField, TextField, TextareaField, type Option } from "@/components/forms/fields";
import { MultiSelectField } from "@/app/(app)/performance/_components/multi-select";
import { COURSE_FORMATS, COURSE_FORMAT_LABELS, courseSchema, learningAssignmentSchema, learningPathSchema } from "@/lib/validation/talent";
import { createAssignmentAction, saveCourseAction, savePathAction, uploadCourseMaterialAction } from "../actions";

const newId = () => Math.random().toString(36).slice(2, 10);

type QuizQuestion = { id: string; prompt: string; options: string[]; answer: number };
export type CourseFormValues = {
  id?: string | null;
  title: string;
  description: string | null;
  format: (typeof COURSE_FORMATS)[number];
  provider: string | null;
  url: string | null;
  durationMinutes: number | null;
  skills: string[];
  isMandatory: boolean;
  certificateValidityMonths: number | null;
  quiz: { passMark: number; questions: QuizQuestion[] } | null;
  isActive: boolean;
};

const EMPTY_COURSE: CourseFormValues = {
  title: "",
  description: null,
  format: "link",
  provider: null,
  url: null,
  durationMinutes: null,
  skills: [],
  isMandatory: false,
  certificateValidityMonths: null,
  quiz: null,
  isActive: true,
};

export function CourseDialog({ values }: { values?: CourseFormValues }) {
  const editing = !!values?.id;
  return (
    <FormDialog
      wide
      trigger={
        editing ? (
          <Button variant="outline" size="sm">
            <Pencil /> Edit course
          </Button>
        ) : (
          <Button size="sm">
            <Plus /> New course
          </Button>
        )
      }
      title={editing ? "Edit course" : "New course"}
      description="Quizzes are scored on the server. Passing completes the course and issues a certificate."
      schema={courseSchema}
      defaultValues={(values ?? EMPTY_COURSE) as never}
      action={saveCourseAction}
      submitLabel={editing ? "Save course" : "Create course"}
      successMessage={editing ? "Course updated" : "Course created"}
    >
      {(form) => <CourseFields form={form as unknown as UseFormReturn<CourseFormValues>} />}
    </FormDialog>
  );
}

function SkillsInput({ form }: { form: UseFormReturn<CourseFormValues> }) {
  return (
    <Controller
      control={form.control}
      name="skills"
      render={({ field }) => <SkillsText value={field.value ?? []} onChange={field.onChange} />}
    />
  );
}

function SkillsText({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  return (
    <Field>
      <FieldLabel htmlFor="course-skills">Skills</FieldLabel>
      <Input
        id="course-skills"
        value={text}
        placeholder="Excel, Negotiation"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange([...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))])}
      />
      <FieldDescription>Comma separated. Added to the learner&apos;s profile on completion.</FieldDescription>
    </Field>
  );
}

function CourseFields({ form }: { form: UseFormReturn<CourseFormValues> }) {
  const c = form.control;
  const quiz = useWatch({ control: c, name: "quiz" });
  return (
    <>
      <TextField control={c} name="title" label="Title" required />
      <TextareaField control={c} name="description" label="Description" rows={3} />
      <div className="grid gap-5 sm:grid-cols-3">
        <SelectField control={c} name="format" label="Format" options={COURSE_FORMATS.map((f) => ({ value: f, label: COURSE_FORMAT_LABELS[f] }))} />
        <TextField control={c} name="durationMinutes" label="Duration (minutes)" type="number" inputMode="numeric" />
        <TextField control={c} name="provider" label="Provider" placeholder="Internal, Coursera…" />
      </div>
      <TextField control={c} name="url" label="Link" type="url" placeholder="https://" description="Required for link, video and external courses. Upload documents after saving." />
      <SkillsInput form={form} />
      <div className="grid gap-5 sm:grid-cols-2">
        <SwitchField control={c} name="isMandatory" label="Mandatory" description="Shown first in the catalog." />
        <TextField control={c} name="certificateValidityMonths" label="Certificate valid for (months)" type="number" description="Leave empty for no expiry. Expired learners are re-enrolled by active assignments." />
      </div>
      <SwitchField control={c} name="isActive" label="Active" description="Inactive courses are hidden from learners." />
      <FieldSet>
        <div className="flex items-center justify-between gap-2">
          <FieldLegend variant="label">Quiz</FieldLegend>
          {quiz ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => form.setValue("quiz", null)}>
              Remove quiz
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => form.setValue("quiz", { passMark: 70, questions: [{ id: newId(), prompt: "", options: ["", ""], answer: 0 }] })}>
              <Plus /> Add quiz
            </Button>
          )}
        </div>
        {quiz ? <QuizEditor form={form} /> : <p className="text-xs text-muted-foreground">Without a quiz, learners complete the course by marking it done.</p>}
      </FieldSet>
    </>
  );
}

function QuizEditor({ form }: { form: UseFormReturn<CourseFormValues> }) {
  const c = form.control;
  const { fields, append, remove } = useFieldArray({ control: c, name: "quiz.questions" as const });
  return (
    <div className="space-y-3">
      <TextField control={c} name="quiz.passMark" label="Pass mark (%)" type="number" className="max-w-40" />
      {fields.map((f, i) => (
        <QuizQuestionEditor key={f.id} form={form} index={i} onRemove={() => remove(i)} canRemove={fields.length > 1} />
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => append({ id: newId(), prompt: "", options: ["", ""], answer: 0 })}>
        <Plus /> Add question
      </Button>
    </div>
  );
}

function QuizQuestionEditor({ form, index, onRemove, canRemove }: { form: UseFormReturn<CourseFormValues>; index: number; onRemove: () => void; canRemove: boolean }) {
  const c = form.control;
  const options = useWatch({ control: c, name: `quiz.questions.${index}.options` as const }) ?? [];
  const answer = useWatch({ control: c, name: `quiz.questions.${index}.answer` as const });
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-end gap-2">
        <TextField control={c} name={`quiz.questions.${index}.prompt`} label={`Question ${index + 1}`} className="flex-1" />
        <Button type="button" variant="ghost" size="icon" aria-label="Remove question" disabled={!canRemove} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Select the correct option.</p>
      {options.map((_, oi) => (
        <div key={oi} className="flex items-center gap-2">
          <input
            type="radio"
            name={`answer-${index}`}
            aria-label={`Option ${oi + 1} is correct`}
            checked={Number(answer) === oi}
            onChange={() => form.setValue(`quiz.questions.${index}.answer`, oi, { shouldDirty: true })}
            className="size-4 accent-foreground"
          />
          <Controller
            control={c}
            name={`quiz.questions.${index}.options.${oi}`}
            render={({ field }) => <Input {...field} value={field.value ?? ""} placeholder={`Option ${oi + 1}`} className="h-8" />}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove option"
            disabled={options.length <= 2}
            onClick={() => {
              const next = options.filter((__, k) => k !== oi);
              form.setValue(`quiz.questions.${index}.options`, next, { shouldDirty: true });
              if (Number(answer) >= next.length) form.setValue(`quiz.questions.${index}.answer`, 0);
            }}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      {options.length < 6 ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => form.setValue(`quiz.questions.${index}.options`, [...options, ""], { shouldDirty: true })}>
          <Plus /> Option
        </Button>
      ) : null}
    </div>
  );
}

export function UploadMaterial({ courseId, current }: { courseId: string; current: string | null }) {
  const ref = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <input
        ref={ref}
        type="file"
        className="sr-only"
        aria-label="Course material file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const fd = new FormData();
          fd.set("courseId", courseId);
          fd.set("file", file);
          start(async () => {
            const res = await uploadCourseMaterialAction(fd);
            if (res.ok) toast.success("Material uploaded");
            else toast.error(res.error.message);
            if (ref.current) ref.current.value = "";
          });
        }}
      />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => ref.current?.click()}>
        {pending ? <Spinner /> : <Upload />} {current ? "Replace material" : "Upload material"}
      </Button>
    </>
  );
}

export function PathDialog({ courses, values }: { courses: Option[]; values?: { id: string; title: string; description: string | null; courseIds: string[]; isActive: boolean } }) {
  const editing = !!values?.id;
  return (
    <FormDialog
      trigger={
        editing ? (
          <Button variant="ghost" size="sm" aria-label={`Edit ${values?.title}`}>
            <Pencil />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Route /> New path
          </Button>
        )
      }
      title={editing ? "Edit learning path" : "New learning path"}
      description="Courses are taken in the order you pick them."
      schema={learningPathSchema}
      defaultValues={(values ?? { title: "", description: null, courseIds: [], isActive: true }) as never}
      action={savePathAction}
      successMessage="Learning path saved"
    >
      {(form) => (
        <>
          <TextField control={form.control} name="title" label="Title" required />
          <TextareaField control={form.control} name="description" label="Description" rows={2} />
          <MultiSelectField control={form.control} name="courseIds" label="Courses" options={courses} placeholder="Choose courses in order" />
          <SwitchField control={form.control} name="isActive" label="Active" />
        </>
      )}
    </FormDialog>
  );
}

export function AssignmentDialog({ courses, paths, departments, designations }: { courses: Option[]; paths: Option[]; departments: Option[]; designations: Option[] }) {
  return (
    <FormDialog
      wide
      trigger={
        <Button size="sm">
          <Plus /> New assignment
        </Button>
      }
      title="Assign learning"
      description="Matching current employees are enrolled now and every day after (no duplicates). New joiner rules also apply when someone is added."
      schema={learningAssignmentSchema}
      defaultValues={{ courseId: courses[0]?.value ?? null, pathId: null, all: false, newJoiners: false, departmentIds: [], designationIds: [], dueInDays: 30 } as never}
      action={createAssignmentAction}
      submitLabel="Create assignment"
      successMessage="Assignment created; enrollments are being created"
    >
      {(form) => (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField control={form.control} name="courseId" label="Course" options={courses} allowNone="—" />
            <SelectField control={form.control} name="pathId" label="Or learning path" options={paths} allowNone="—" />
          </div>
          <SwitchField control={form.control} name="all" label="Everyone" description="All current employees." />
          <SwitchField control={form.control} name="newJoiners" label="New joiners" description="Only people who join from today on." />
          <div className="grid gap-5 sm:grid-cols-2">
            <MultiSelectField control={form.control} name="departmentIds" label="Departments" options={departments} placeholder="Any department" />
            <MultiSelectField control={form.control} name="designationIds" label="Designations" options={designations} placeholder="Any designation" />
          </div>
          <TextField control={form.control} name="dueInDays" label="Due within (days)" type="number" className="max-w-48" />
        </>
      )}
    </FormDialog>
  );
}
