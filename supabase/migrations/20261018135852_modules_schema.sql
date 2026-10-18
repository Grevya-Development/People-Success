CREATE TYPE "public"."application_status" AS ENUM('active', 'rejected', 'withdrawn', 'hired');--> statement-breakpoint
CREATE TYPE "public"."interview_status" AS ENUM('scheduled', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('draft', 'pending_approval', 'approved', 'sent', 'accepted', 'declined', 'expired', 'rescinded');--> statement-breakpoint
CREATE TYPE "public"."opening_status" AS ENUM('draft', 'published', 'paused', 'closed');--> statement-breakpoint
CREATE TYPE "public"."recommendation" AS ENUM('strong_yes', 'yes', 'no', 'strong_no');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('submitted', 'in_review', 'interviewing', 'hired', 'rejected', 'duplicate', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."requisition_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'on_hold', 'filled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."reward_status" AS ENUM('not_applicable', 'pending', 'eligible', 'approved', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."stage_kind" AS ENUM('applied', 'screening', 'review', 'assessment', 'interview', 'final', 'offer', 'hired');--> statement-breakpoint
CREATE TYPE "public"."exit_status" AS ENUM('submitted', 'under_review', 'accepted', 'rejected', 'withdrawn', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."exit_type" AS ENUM('resignation', 'termination', 'retirement', 'end_of_contract', 'absconding', 'death', 'mutual_separation');--> statement-breakpoint
CREATE TYPE "public"."plan_kind" AS ENUM('onboarding', 'offboarding');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('not_started', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('not_started', 'draft', 'pending_approval', 'approved', 'paid');--> statement-breakpoint
CREATE TYPE "public"."day_status" AS ENUM('present', 'absent', 'half_day', 'on_leave', 'holiday', 'weekly_off', 'missing_punch', 'not_joined');--> statement-breakpoint
CREATE TYPE "public"."leave_category" AS ENUM('annual', 'earned', 'casual', 'sick', 'comp_off', 'unpaid', 'maternity', 'paternity', 'bereavement', 'marriage', 'custom');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."leave_txn_kind" AS ENUM('opening', 'accrual', 'grant', 'deduction', 'reversal', 'carry_forward', 'expiry', 'encashment', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."punch_kind" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."punch_source" AS ENUM('web', 'mobile', 'biometric', 'import', 'regularization', 'system');--> statement-breakpoint
CREATE TYPE "public"."punch_verification" AS ENUM('self_reported', 'location_verified', 'device_verified', 'approved_correction');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."timesheet_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."component_calc" AS ENUM('fixed', 'percent_of_ctc', 'percent_of_basic', 'percent_of_gross', 'balancing', 'statutory', 'input');--> statement-breakpoint
CREATE TYPE "public"."component_kind" AS ENUM('earning', 'deduction', 'employer_contribution', 'reimbursement', 'statutory_deduction');--> statement-breakpoint
CREATE TYPE "public"."disbursement_status" AS ENUM('pending', 'file_generated', 'submitted', 'paid', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."input_kind" AS ENUM('bonus', 'incentive', 'commission', 'arrear', 'overtime', 'reimbursement', 'deduction', 'recovery', 'referral_reward', 'leave_encashment', 'other_earning');--> statement-breakpoint
CREATE TYPE "public"."loan_status" AS ENUM('active', 'closed', 'written_off');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('open', 'processing', 'locked', 'closed');--> statement-breakpoint
CREATE TYPE "public"."run_employee_status" AS ENUM('ok', 'warning', 'error', 'on_hold', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."run_kind" AS ENUM('regular', 'adjustment', 'off_cycle', 'full_and_final');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('draft', 'calculated', 'pending_approval', 'approved', 'locked', 'disbursed', 'published', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'reimbursed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('enrolled', 'waived', 'ended');--> statement-breakpoint
CREATE TYPE "public"."cycle_status" AS ENUM('draft', 'active', 'calibration', 'closed');--> statement-breakpoint
CREATE TYPE "public"."learning_enrollment_status" AS ENUM('assigned', 'in_progress', 'completed', 'expired', 'waived');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('draft', 'active', 'achieved', 'partially_achieved', 'missed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."review_kind" AS ENUM('self', 'manager', 'peer', 'upward');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('not_started', 'in_progress', 'submitted', 'shared', 'acknowledged');--> statement-breakpoint
CREATE TYPE "public"."survey_status" AS ENUM('draft', 'active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'in_progress', 'waiting_on_employee', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."ai_execution_status" AS ENUM('running', 'waiting_approval', 'succeeded', 'failed', 'cancelled', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('not_configured', 'configured', 'verified', 'error', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."step_run_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'skipped', 'waiting');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_status" AS ENUM('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_stage_id" uuid,
	"to_stage_id" uuid,
	"body" text,
	"metadata" jsonb,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"opening_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"status" "application_status" DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'career_page' NOT NULL,
	"referral_id" uuid,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cover_note" text,
	"ai_summary" jsonb,
	"average_rating" numeric(3, 2),
	"rejection_reason" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"email" text NOT NULL,
	"phone" text,
	"current_company" text,
	"current_title" text,
	"total_experience_months" integer,
	"city" text,
	"linkedin_url" text,
	"source" text DEFAULT 'career_page' NOT NULL,
	"source_detail" text,
	"resume_document_id" uuid,
	"parsed_profile" jsonb,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"consent_at" timestamp with time zone,
	"retain_until" date,
	"employee_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"interview_id" uuid NOT NULL,
	"interviewer_user_id" uuid NOT NULL,
	"recommendation" "recommendation" NOT NULL,
	"overall_rating" smallint NOT NULL,
	"scores" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"strengths" text,
	"concerns" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_panelists" (
	"tenant_id" uuid NOT NULL,
	"interview_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_lead" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"round_name" text NOT NULL,
	"mode" text DEFAULT 'video' NOT NULL,
	"scheduled_start" timestamp with time zone NOT NULL,
	"scheduled_end" timestamp with time zone NOT NULL,
	"location" text,
	"meeting_url" text,
	"scorecard_template_id" uuid,
	"status" "interview_status" DEFAULT 'scheduled' NOT NULL,
	"calendar_event_ids" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_openings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requisition_id" uuid,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"requirements" text,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"experience_min_years" smallint,
	"experience_max_years" smallint,
	"department_id" uuid,
	"location_id" uuid,
	"work_mode" "work_mode" DEFAULT 'onsite' NOT NULL,
	"employment_type" "employment_type" DEFAULT 'full_time' NOT NULL,
	"salary_min_annual" bigint,
	"salary_max_annual" bigint,
	"show_salary" boolean DEFAULT false NOT NULL,
	"openings" integer DEFAULT 1 NOT NULL,
	"status" "opening_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"closes_on" date,
	"hiring_manager_employee_id" uuid,
	"recruiter_user_id" uuid,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_requisitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"department_id" uuid,
	"designation_id" uuid,
	"location_id" uuid,
	"legal_entity_id" uuid,
	"position_id" uuid,
	"headcount" integer DEFAULT 1 NOT NULL,
	"employment_type" "employment_type" DEFAULT 'full_time' NOT NULL,
	"reason" text DEFAULT 'new' NOT NULL,
	"backfill_for_employee_id" uuid,
	"budget_min_annual" bigint,
	"budget_max_annual" bigint,
	"currency" text DEFAULT 'INR' NOT NULL,
	"justification" text,
	"hiring_manager_employee_id" uuid,
	"recruiter_user_id" uuid,
	"target_start_date" date,
	"status" "requisition_status" DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"opening_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "offer_status" DEFAULT 'draft' NOT NULL,
	"designation_id" uuid,
	"department_id" uuid,
	"location_id" uuid,
	"legal_entity_id" uuid NOT NULL,
	"reporting_manager_id" uuid,
	"employment_type" "employment_type" DEFAULT 'full_time' NOT NULL,
	"joining_date" date NOT NULL,
	"annual_ctc" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"probation_months" smallint DEFAULT 6 NOT NULL,
	"notice_period_days" integer DEFAULT 30 NOT NULL,
	"expires_on" date NOT NULL,
	"template_version_id" uuid,
	"document_id" uuid,
	"response_token_hash" text,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"response_note" text,
	"response_ip" text,
	"esign_provider" text,
	"esign_envelope_id" text,
	"esign_status" text,
	"employee_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "stage_kind" NOT NULL,
	"sort_order" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_reward_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"eligible_after_days" integer DEFAULT 90 NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"referrer_employee_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"opening_id" uuid,
	"application_id" uuid,
	"relationship" text,
	"note" text,
	"status" "referral_status" DEFAULT 'submitted' NOT NULL,
	"reward_policy_id" uuid,
	"reward_amount" bigint,
	"reward_status" "reward_status" DEFAULT 'not_applicable' NOT NULL,
	"reward_eligible_on" date,
	"reward_paid_at" timestamp with time zone,
	"payroll_input_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scorecard_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_pool_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exit_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" "exit_type" NOT NULL,
	"status" "exit_status" DEFAULT 'submitted' NOT NULL,
	"submitted_on" date NOT NULL,
	"requested_last_working_date" date,
	"approved_last_working_date" date,
	"notice_period_days" integer NOT NULL,
	"notice_shortfall_days" integer DEFAULT 0 NOT NULL,
	"shortfall_treatment" text DEFAULT 'none' NOT NULL,
	"reason_category" text,
	"reason_detail" text,
	"eligible_for_rehire" boolean,
	"exit_interview" jsonb,
	"settlement_status" "settlement_status" DEFAULT 'not_started' NOT NULL,
	"settlement_run_id" uuid,
	"initiated_by" uuid NOT NULL,
	"approved_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifecycle_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" "plan_kind" NOT NULL,
	"template_id" uuid,
	"exit_case_id" uuid,
	"status" "plan_status" DEFAULT 'not_started' NOT NULL,
	"anchor_date" date NOT NULL,
	"buddy_employee_id" uuid,
	"progress_percent" smallint DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifecycle_template_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_group" text NOT NULL,
	"due_offset_days" integer DEFAULT 0 NOT NULL,
	"kind" text DEFAULT 'checklist' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifecycle_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "plan_kind" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"shift_id" uuid,
	"first_in" timestamp with time zone,
	"last_out" timestamp with time zone,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"early_leave_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"status" "day_status" NOT NULL,
	"payable_fraction" numeric(3, 2) DEFAULT 1 NOT NULL,
	"leave_request_id" uuid,
	"is_regularized" boolean DEFAULT false NOT NULL,
	"locked_by_run_id" uuid,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"kind" "punch_kind" NOT NULL,
	"source" "punch_source" NOT NULL,
	"verification" "punch_verification" DEFAULT 'self_reported' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"accuracy_meters" double precision,
	"device_id" text,
	"external_id" text,
	"ip" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rules" jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holiday_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"year" smallint NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"balance" numeric(7, 2) DEFAULT 0 NOT NULL,
	"pending" numeric(7, 2) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_balances_employee_id_leave_type_id_pk" PRIMARY KEY("employee_id","leave_type_id")
);
--> statement-breakpoint
CREATE TABLE "leave_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rules" jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_session" text DEFAULT 'full' NOT NULL,
	"end_session" text DEFAULT 'full' NOT NULL,
	"hours" numeric(5, 2),
	"days" numeric(6, 2) NOT NULL,
	"reason" text,
	"status" "leave_status" DEFAULT 'pending' NOT NULL,
	"applied_by" uuid NOT NULL,
	"document_id" uuid,
	"policy_version" integer,
	"decided_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"kind" "leave_txn_kind" NOT NULL,
	"days" numeric(7, 2) NOT NULL,
	"effective_on" date NOT NULL,
	"expires_on" date,
	"source_key" text NOT NULL,
	"leave_request_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" "leave_category" NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"unit" text DEFAULT 'day' NOT NULL,
	"allow_half_day" boolean DEFAULT true NOT NULL,
	"allow_negative" boolean DEFAULT false NOT NULL,
	"max_negative_days" numeric(6, 2) DEFAULT 0 NOT NULL,
	"requires_document_after_days" numeric(6, 2),
	"color" text DEFAULT 'blue' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"client" text,
	"cost_center_id" uuid,
	"is_billable" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regularizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"requested_in" timestamp with time zone,
	"requested_out" timestamp with time zone,
	"reason" text NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"break_minutes" smallint DEFAULT 60 NOT NULL,
	"grace_in_minutes" smallint DEFAULT 10 NOT NULL,
	"grace_out_minutes" smallint DEFAULT 10 NOT NULL,
	"half_day_minutes" smallint DEFAULT 240 NOT NULL,
	"full_day_minutes" smallint DEFAULT 480 NOT NULL,
	"weekly_offs" smallint[] DEFAULT '{0,6}'::smallint[] NOT NULL,
	"is_flexible" boolean DEFAULT false NOT NULL,
	"is_night" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheet_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"timesheet_id" uuid NOT NULL,
	"date" date NOT NULL,
	"project_id" uuid,
	"task" text,
	"minutes" integer NOT NULL,
	"is_billable" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" timesheet_status DEFAULT 'draft' NOT NULL,
	"total_minutes" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disbursement_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"format" text NOT NULL,
	"document_id" uuid,
	"total_amount" bigint NOT NULL,
	"count" integer NOT NULL,
	"status" "disbursement_status" DEFAULT 'file_generated' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disbursements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"run_employee_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"batch_id" uuid,
	"amount" bigint NOT NULL,
	"bank_account_last4" text,
	"bank_ifsc" text,
	"status" "disbursement_status" DEFAULT 'pending' NOT NULL,
	"utr" text,
	"failure_reason" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text DEFAULT 'advance' NOT NULL,
	"principal" bigint NOT NULL,
	"monthly_installment" bigint NOT NULL,
	"outstanding" bigint NOT NULL,
	"start_period_year" smallint NOT NULL,
	"start_period_month" smallint NOT NULL,
	"status" "loan_status" DEFAULT 'active' NOT NULL,
	"approved_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_repayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"loan_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "component_kind" NOT NULL,
	"calculation" "component_calc" NOT NULL,
	"value" numeric(14, 4),
	"is_taxable" boolean DEFAULT true NOT NULL,
	"is_part_of_ctc" boolean DEFAULT true NOT NULL,
	"pf_wage" boolean DEFAULT false NOT NULL,
	"esi_wage" boolean DEFAULT false NOT NULL,
	"pt_wage" boolean DEFAULT true NOT NULL,
	"prorate" boolean DEFAULT true NOT NULL,
	"payslip_label" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" "input_kind" NOT NULL,
	"component_code" text NOT NULL,
	"amount" bigint NOT NULL,
	"is_taxable" boolean DEFAULT true NOT NULL,
	"note" text,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_employee_id" uuid NOT NULL,
	"component_code" text NOT NULL,
	"component_name" text NOT NULL,
	"kind" "component_kind" NOT NULL,
	"amount" bigint NOT NULL,
	"is_taxable" boolean DEFAULT true NOT NULL,
	"explanation" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"pay_date" date NOT NULL,
	"input_cutoff_date" date NOT NULL,
	"status" "period_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_run_employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"status" "run_employee_status" DEFAULT 'ok' NOT NULL,
	"calendar_days" smallint NOT NULL,
	"payable_days" numeric(5, 2) NOT NULL,
	"lop_days" numeric(5, 2) DEFAULT 0 NOT NULL,
	"gross_earnings" bigint NOT NULL,
	"total_deductions" bigint NOT NULL,
	"employer_contributions" bigint NOT NULL,
	"net_pay" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"kind" "run_kind" DEFAULT 'regular' NOT NULL,
	"status" "run_status" DEFAULT 'draft' NOT NULL,
	"parent_run_id" uuid,
	"calculation_basis" jsonb,
	"totals" jsonb,
	"snapshot_hash" text,
	"uses_unverified_rules" boolean DEFAULT false NOT NULL,
	"unverified_override_by" uuid,
	"idempotency_key" text,
	"calculated_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_employee_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"document_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"lines" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statutory_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"name" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"version" integer DEFAULT 1 NOT NULL,
	"parameters" jsonb NOT NULL,
	"source_reference" text,
	"notes" text,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"fy_start_year" smallint NOT NULL,
	"regime" text DEFAULT 'new' NOT NULL,
	"declarations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"previous_employer_income" bigint,
	"previous_employer_tds" bigint,
	"status" text DEFAULT 'draft' NOT NULL,
	"verified_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benefit_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"status" "enrollment_status" NOT NULL,
	"coverage" text DEFAULT 'self' NOT NULL,
	"dependent_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benefit_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	"provider" text,
	"eligibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"employer_contribution" bigint DEFAULT 0 NOT NULL,
	"employee_contribution" bigint DEFAULT 0 NOT NULL,
	"deduct_from_salary" boolean DEFAULT false NOT NULL,
	"coverage_options" text[] DEFAULT '{self}'::text[] NOT NULL,
	"enrollment_opens_on" date,
	"enrollment_closes_on" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"max_per_item" bigint,
	"max_per_month" bigint,
	"receipt_required_above" bigint DEFAULT 0 NOT NULL,
	"gl_code" text,
	"is_taxable" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "claim_status" DEFAULT 'draft' NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"reimbursement_method" text DEFAULT 'payroll' NOT NULL,
	"payroll_input_id" uuid,
	"payment_reference" text,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"reimbursed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"spent_on" date NOT NULL,
	"merchant" text,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"receipt_document_id" uuid,
	"policy_violations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "career_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"aspirations" text,
	"target_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"interested_in_mobility" boolean DEFAULT false NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manager_notes" text,
	"reviewed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"format" text DEFAULT 'link' NOT NULL,
	"provider" text,
	"url" text,
	"document_id" uuid,
	"duration_minutes" integer,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_mandatory" boolean DEFAULT false NOT NULL,
	"certificate_validity_months" smallint,
	"quiz" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_action_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"survey_id" uuid,
	"department_id" uuid,
	"owner_employee_id" uuid NOT NULL,
	"focus_area" text NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_employee_id" uuid NOT NULL,
	"to_employee_id" uuid NOT NULL,
	"kind" text DEFAULT 'praise' NOT NULL,
	"body" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"value" numeric(14, 2),
	"progress_percent" smallint NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid,
	"department_id" uuid,
	"cycle_id" uuid,
	"parent_goal_id" uuid,
	"kind" text DEFAULT 'goal' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"metric_unit" text,
	"start_value" numeric(14, 2),
	"target_value" numeric(14, 2),
	"current_value" numeric(14, 2),
	"weight" smallint DEFAULT 0 NOT NULL,
	"progress_percent" smallint DEFAULT 0 NOT NULL,
	"due_on" date,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "improvement_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"manager_employee_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"objectives" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"outcome" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid,
	"path_id" uuid,
	"target" jsonb NOT NULL,
	"due_in_days" smallint DEFAULT 30 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"path_id" uuid,
	"assignment_id" uuid,
	"status" "learning_enrollment_status" DEFAULT 'assigned' NOT NULL,
	"due_on" date,
	"progress_percent" smallint DEFAULT 0 NOT NULL,
	"score" smallint,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_on" date,
	"certificate_document_id" uuid,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_paths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"course_ids" uuid[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "one_on_ones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"manager_employee_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"held_on" date NOT NULL,
	"agenda" text,
	"notes" text,
	"action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotion_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cycle_id" uuid,
	"employee_id" uuid NOT NULL,
	"recommended_by" uuid NOT NULL,
	"to_designation_id" uuid,
	"to_grade_id" uuid,
	"proposed_annual_ctc" bigint,
	"justification" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating_scales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"levels" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recognitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_employee_id" uuid NOT NULL,
	"to_employee_id" uuid NOT NULL,
	"badge" text NOT NULL,
	"message" text NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'annual' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"template_id" uuid NOT NULL,
	"rating_scale_id" uuid NOT NULL,
	"self_due_on" date,
	"peer_due_on" date,
	"manager_due_on" date,
	"calibration_due_on" date,
	"include_peers" boolean DEFAULT false NOT NULL,
	"include_upward" boolean DEFAULT false NOT NULL,
	"participant_conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "cycle_status" DEFAULT 'draft' NOT NULL,
	"launched_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"questions" jsonb NOT NULL,
	"include_goals" boolean DEFAULT true NOT NULL,
	"goals_weight_percent" smallint DEFAULT 50 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"reviewer_employee_id" uuid NOT NULL,
	"kind" "review_kind" NOT NULL,
	"status" "review_status" DEFAULT 'not_started' NOT NULL,
	"responses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overall_rating" numeric(3, 2),
	"calibrated_rating" numeric(3, 2),
	"calibration_note" text,
	"submitted_at" timestamp with time zone,
	"shared_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "succession_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"position_id" uuid,
	"role_title" text NOT NULL,
	"incumbent_employee_id" uuid,
	"criticality" text DEFAULT 'medium' NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"responded_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"employee_id" uuid,
	"department_id" uuid,
	"location_id" uuid,
	"tenure_band" text,
	"answers" jsonb NOT NULL,
	"submitted_on" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surveys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'pulse' NOT NULL,
	"description" text,
	"is_anonymous" boolean DEFAULT true NOT NULL,
	"min_group_size" smallint DEFAULT 5 NOT NULL,
	"questions" jsonb NOT NULL,
	"audience" jsonb DEFAULT '{"all":true}'::jsonb NOT NULL,
	"status" "survey_status" DEFAULT 'draft' NOT NULL,
	"opens_on" date,
	"closes_on" date,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_version" integer DEFAULT 1 NOT NULL,
	"source_title" text NOT NULL,
	"heading" text,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(heading, '') || ' ' || content)) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_role_key" text DEFAULT 'hr_admin' NOT NULL,
	"first_response_hours" smallint DEFAULT 8 NOT NULL,
	"resolution_hours" smallint DEFAULT 48 NOT NULL,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"attachment_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"ai_assisted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"requester_employee_id" uuid,
	"requester_user_id" uuid NOT NULL,
	"category_id" uuid,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"priority" "ticket_priority" DEFAULT 'normal' NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"assignee_user_id" uuid,
	"channel" text DEFAULT 'portal' NOT NULL,
	"first_response_due_at" timestamp with time zone,
	"resolution_due_at" timestamp with time zone,
	"first_responded_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"ai_triage" jsonb,
	"satisfaction" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"instructions" text,
	"model" text,
	"allowed_tools" text[] DEFAULT '{}'::text[] NOT NULL,
	"approval_tools" text[] DEFAULT '{}'::text[] NOT NULL,
	"monthly_budget_usd" integer DEFAULT 25 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_key" text DEFAULT 'helpdesk' NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_key" text NOT NULL,
	"user_id" uuid,
	"conversation_id" uuid,
	"status" "ai_execution_status" DEFAULT 'running' NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"provider" text,
	"model" text,
	"prompt_version" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome" text,
	"execution_id" uuid,
	"ticket_id" uuid,
	"feedback" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"status" text NOT NULL,
	"approved_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"category" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "connection_status" DEFAULT 'not_configured' NOT NULL,
	"credentials_enc" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"webhook_secret_enc" text,
	"last_verified_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid,
	"provider" text NOT NULL,
	"direction" text NOT NULL,
	"event_type" text NOT NULL,
	"external_id" text,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"payload" jsonb,
	"error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"report_key" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule" text,
	"format" text DEFAULT 'csv' NOT NULL,
	"recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger" text NOT NULL,
	"schedule" text,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"is_starter" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"action" text NOT NULL,
	"status" "step_run_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"idempotency_key" text NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "workflow_run_status" DEFAULT 'queued' NOT NULL,
	"trigger_event" jsonb NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_step_index" integer DEFAULT 0 NOT NULL,
	"dedupe_key" text NOT NULL,
	"waiting_until" timestamp with time zone,
	"waiting_for_event" text,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"cancelled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"steps" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_opening_id_job_openings_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."job_openings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_stage_id_recruitment_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."recruitment_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_feedback" ADD CONSTRAINT "interview_feedback_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_feedback" ADD CONSTRAINT "interview_feedback_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_panelists" ADD CONSTRAINT "interview_panelists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_panelists" ADD CONSTRAINT "interview_panelists_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_requisition_id_job_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."job_requisitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_stages" ADD CONSTRAINT "recruitment_stages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_reward_policies" ADD CONSTRAINT "referral_reward_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_opening_id_job_openings_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."job_openings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecard_templates" ADD CONSTRAINT "scorecard_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_pool_members" ADD CONSTRAINT "talent_pool_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_pool_members" ADD CONSTRAINT "talent_pool_members_pool_id_talent_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."talent_pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_pool_members" ADD CONSTRAINT "talent_pool_members_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_pools" ADD CONSTRAINT "talent_pools_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_cases" ADD CONSTRAINT "exit_cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_plans" ADD CONSTRAINT "lifecycle_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_template_tasks" ADD CONSTRAINT "lifecycle_template_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_template_tasks" ADD CONSTRAINT "lifecycle_template_tasks_template_id_lifecycle_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."lifecycle_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_templates" ADD CONSTRAINT "lifecycle_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_calendars" ADD CONSTRAINT "holiday_calendars_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_calendar_id_holiday_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."holiday_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_transactions" ADD CONSTRAINT "leave_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_transactions" ADD CONSTRAINT "leave_transactions_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regularizations" ADD CONSTRAINT "regularizations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_timesheet_id_timesheets_id_fk" FOREIGN KEY ("timesheet_id") REFERENCES "public"."timesheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursement_batches" ADD CONSTRAINT "disbursement_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_loan_id_employee_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."employee_loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_components" ADD CONSTRAINT "pay_components_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_inputs" ADD CONSTRAINT "payroll_inputs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_inputs" ADD CONSTRAINT "payroll_inputs_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_line_items" ADD CONSTRAINT "payroll_line_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_line_items" ADD CONSTRAINT "payroll_line_items_run_employee_id_payroll_run_employees_id_fk" FOREIGN KEY ("run_employee_id") REFERENCES "public"."payroll_run_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_employees" ADD CONSTRAINT "payroll_run_employees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_employees" ADD CONSTRAINT "payroll_run_employees_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_employee_id_payroll_run_employees_id_fk" FOREIGN KEY ("run_employee_id") REFERENCES "public"."payroll_run_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_rule_sets" ADD CONSTRAINT "statutory_rule_sets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_declarations" ADD CONSTRAINT "tax_declarations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_enrollments" ADD CONSTRAINT "benefit_enrollments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_enrollments" ADD CONSTRAINT "benefit_enrollments_plan_id_benefit_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."benefit_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_plans" ADD CONSTRAINT "benefit_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_claim_id_expense_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."expense_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_plans" ADD CONSTRAINT "career_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competencies" ADD CONSTRAINT "competencies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_action_plans" ADD CONSTRAINT "engagement_action_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_notes" ADD CONSTRAINT "feedback_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_plans" ADD CONSTRAINT "improvement_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_assignments" ADD CONSTRAINT "learning_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_enrollments" ADD CONSTRAINT "learning_enrollments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_enrollments" ADD CONSTRAINT "learning_enrollments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_paths" ADD CONSTRAINT "learning_paths_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_on_ones" ADD CONSTRAINT "one_on_ones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_recommendations" ADD CONSTRAINT "promotion_recommendations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_scales" ADD CONSTRAINT "rating_scales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognitions" ADD CONSTRAINT "recognitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cycles" ADD CONSTRAINT "review_cycles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_templates" ADD CONSTRAINT "review_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_cycle_id_review_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "succession_plans" ADD CONSTRAINT "succession_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_participants" ADD CONSTRAINT "survey_participants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_participants" ADD CONSTRAINT "survey_participants_survey_id_surveys_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_survey_id_surveys_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_categories" ADD CONSTRAINT "ticket_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_category_id_ticket_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ticket_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_calls" ADD CONSTRAINT "ai_tool_calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_calls" ADD CONSTRAINT "ai_tool_calls_execution_id_ai_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."ai_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_events_app_idx" ON "application_events" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_candidate_opening_key" ON "applications" USING btree ("opening_id","candidate_id");--> statement-breakpoint
CREATE INDEX "applications_stage_idx" ON "applications" USING btree ("tenant_id","opening_id","stage_id","status");--> statement-breakpoint
CREATE INDEX "applications_candidate_idx" ON "applications" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_email_key" ON "candidates" USING btree ("tenant_id",lower("email"));--> statement-breakpoint
CREATE INDEX "candidates_phone_idx" ON "candidates" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_feedback_key" ON "interview_feedback" USING btree ("interview_id","interviewer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_panelists_key" ON "interview_panelists" USING btree ("interview_id","user_id");--> statement-breakpoint
CREATE INDEX "interview_panelists_user_idx" ON "interview_panelists" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "interviews_application_idx" ON "interviews" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "interviews_start_idx" ON "interviews" USING btree ("tenant_id","scheduled_start");--> statement-breakpoint
CREATE UNIQUE INDEX "job_openings_slug_key" ON "job_openings" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "job_openings_status_idx" ON "job_openings" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "job_requisitions_code_key" ON "job_requisitions" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "job_requisitions_status_idx" ON "job_requisitions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "offers_application_idx" ON "offers" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_one_live_per_application" ON "offers" USING btree ("application_id") WHERE "offers"."status" in ('draft','pending_approval','approved','sent','accepted');--> statement-breakpoint
CREATE UNIQUE INDEX "offers_response_token_key" ON "offers" USING btree ("response_token_hash") WHERE "offers"."response_token_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_stages_name_key" ON "recruitment_stages" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_candidate_opening_key" ON "referrals" USING btree ("tenant_id","candidate_id","opening_id") WHERE "referrals"."status" not in ('duplicate','withdrawn');--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("tenant_id","referrer_employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scorecard_templates_name_key" ON "scorecard_templates" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "talent_pool_members_key" ON "talent_pool_members" USING btree ("pool_id","candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "talent_pools_name_key" ON "talent_pools" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "exit_cases_open_key" ON "exit_cases" USING btree ("employee_id") WHERE "exit_cases"."status" not in ('rejected','withdrawn','completed');--> statement-breakpoint
CREATE INDEX "exit_cases_status_idx" ON "exit_cases" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_plans_open_key" ON "lifecycle_plans" USING btree ("employee_id","kind") WHERE "lifecycle_plans"."status" in ('not_started','in_progress');--> statement-breakpoint
CREATE INDEX "lifecycle_plans_status_idx" ON "lifecycle_plans" USING btree ("tenant_id","kind","status");--> statement-breakpoint
CREATE INDEX "lifecycle_template_tasks_template_idx" ON "lifecycle_template_tasks" USING btree ("template_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_templates_name_key" ON "lifecycle_templates" USING btree ("tenant_id","kind","name");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_days_key" ON "attendance_days" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "attendance_days_tenant_date_idx" ON "attendance_days" USING btree ("tenant_id","date","status");--> statement-breakpoint
CREATE INDEX "attendance_events_employee_idx" ON "attendance_events" USING btree ("employee_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_events_external_key" ON "attendance_events" USING btree ("tenant_id","source","external_id") WHERE "attendance_events"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "holiday_calendars_name_key" ON "holiday_calendars" USING btree ("tenant_id","name","year");--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_calendar_date_key" ON "holidays" USING btree ("calendar_id","date");--> statement-breakpoint
CREATE INDEX "leave_policies_type_idx" ON "leave_policies" USING btree ("tenant_id","leave_type_id");--> statement-breakpoint
CREATE INDEX "leave_requests_employee_idx" ON "leave_requests" USING btree ("employee_id","start_date");--> statement-breakpoint
CREATE INDEX "leave_requests_tenant_dates_idx" ON "leave_requests" USING btree ("tenant_id","start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_transactions_source_key" ON "leave_transactions" USING btree ("employee_id","leave_type_id","source_key");--> statement-breakpoint
CREATE INDEX "leave_transactions_employee_idx" ON "leave_transactions" USING btree ("employee_id","leave_type_id","effective_on");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_code_key" ON "leave_types" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_code_key" ON "projects" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "regularizations_open_key" ON "regularizations" USING btree ("employee_id","date") WHERE "regularizations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "regularizations_tenant_status_idx" ON "regularizations" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "shift_assignments_employee_idx" ON "shift_assignments" USING btree ("employee_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_code_key" ON "shifts" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "timesheet_entries_sheet_idx" ON "timesheet_entries" USING btree ("timesheet_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheets_week_key" ON "timesheets" USING btree ("employee_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "disbursements_run_employee_key" ON "disbursements" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE INDEX "disbursements_batch_idx" ON "disbursements" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "employee_loans_employee_idx" ON "employee_loans" USING btree ("employee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "loan_repayments_run_key" ON "loan_repayments" USING btree ("loan_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_components_code_key" ON "pay_components" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "payroll_inputs_period_idx" ON "payroll_inputs" USING btree ("period_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_inputs_source_key" ON "payroll_inputs" USING btree ("tenant_id","source_type","source_id") WHERE "payroll_inputs"."source_id" is not null;--> statement-breakpoint
CREATE INDEX "payroll_line_items_run_employee_idx" ON "payroll_line_items" USING btree ("run_employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_periods_key" ON "payroll_periods" USING btree ("tenant_id","legal_entity_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_run_employees_key" ON "payroll_run_employees" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_run_employees_employee_idx" ON "payroll_run_employees" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_one_regular_key" ON "payroll_runs" USING btree ("period_id") WHERE "payroll_runs"."kind" = 'regular' and "payroll_runs"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_idempotency_key" ON "payroll_runs" USING btree ("tenant_id","idempotency_key") WHERE "payroll_runs"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "payroll_runs_period_idx" ON "payroll_runs" USING btree ("period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_run_employee_key" ON "payslips" USING btree ("run_employee_id");--> statement-breakpoint
CREATE INDEX "payslips_employee_idx" ON "payslips" USING btree ("employee_id","period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_structures_name_key" ON "salary_structures" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "statutory_rule_sets_version_key" ON "statutory_rule_sets" USING btree ("tenant_id","kind","jurisdiction","effective_from","version");--> statement-breakpoint
CREATE INDEX "statutory_rule_sets_lookup_idx" ON "statutory_rule_sets" USING btree ("tenant_id","kind","jurisdiction","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_declarations_key" ON "tax_declarations" USING btree ("employee_id","fy_start_year");--> statement-breakpoint
CREATE UNIQUE INDEX "benefit_enrollments_open_key" ON "benefit_enrollments" USING btree ("plan_id","employee_id") WHERE "benefit_enrollments"."effective_to" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "benefit_plans_name_key" ON "benefit_plans" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_code_key" ON "expense_categories" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_claims_number_key" ON "expense_claims" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "expense_claims_employee_idx" ON "expense_claims" USING btree ("employee_id","status");--> statement-breakpoint
CREATE INDEX "expense_items_claim_idx" ON "expense_items" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "career_plans_employee_key" ON "career_plans" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competencies_name_key" ON "competencies" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_title_key" ON "courses" USING btree ("tenant_id","title");--> statement-breakpoint
CREATE INDEX "feedback_notes_to_idx" ON "feedback_notes" USING btree ("to_employee_id","created_at");--> statement-breakpoint
CREATE INDEX "goal_checkins_goal_idx" ON "goal_checkins" USING btree ("goal_id","created_at");--> statement-breakpoint
CREATE INDEX "goals_employee_idx" ON "goals" USING btree ("tenant_id","employee_id","cycle_id");--> statement-breakpoint
CREATE INDEX "goals_parent_idx" ON "goals" USING btree ("parent_goal_id");--> statement-breakpoint
CREATE INDEX "improvement_plans_employee_idx" ON "improvement_plans" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_enrollments_open_key" ON "learning_enrollments" USING btree ("employee_id","course_id") WHERE "learning_enrollments"."status" in ('assigned','in_progress');--> statement-breakpoint
CREATE INDEX "learning_enrollments_due_idx" ON "learning_enrollments" USING btree ("tenant_id","status","due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_paths_title_key" ON "learning_paths" USING btree ("tenant_id","title");--> statement-breakpoint
CREATE INDEX "one_on_ones_pair_idx" ON "one_on_ones" USING btree ("manager_employee_id","employee_id","held_on");--> statement-breakpoint
CREATE INDEX "promotion_recommendations_cycle_idx" ON "promotion_recommendations" USING btree ("tenant_id","cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rating_scales_name_key" ON "rating_scales" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "recognitions_tenant_idx" ON "recognitions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "review_cycles_status_idx" ON "review_cycles" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "review_templates_name_key" ON "review_templates" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_key" ON "reviews" USING btree ("cycle_id","employee_id","reviewer_employee_id","kind");--> statement-breakpoint
CREATE INDEX "reviews_reviewer_idx" ON "reviews" USING btree ("tenant_id","reviewer_employee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_participants_key" ON "survey_participants" USING btree ("survey_id","employee_id");--> statement-breakpoint
CREATE INDEX "survey_responses_survey_idx" ON "survey_responses" USING btree ("survey_id");--> statement-breakpoint
CREATE INDEX "surveys_status_idx" ON "surveys" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "kb_articles_status_idx" ON "kb_articles" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_tsv_idx" ON "knowledge_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_source_idx" ON "knowledge_chunks" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_categories_name_key" ON "ticket_categories" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "tickets_queue_idx" ON "tickets" USING btree ("tenant_id","status","assignee_user_id");--> statement-breakpoint
CREATE INDEX "tickets_requester_idx" ON "tickets" USING btree ("requester_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agents_key" ON "ai_agents" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "ai_conversations_user_idx" ON "ai_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_executions_tenant_idx" ON "ai_executions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_executions_agent_idx" ON "ai_executions" USING btree ("tenant_id","agent_key","created_at");--> statement-breakpoint
CREATE INDEX "ai_messages_conversation_idx" ON "ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_tool_calls_execution_idx" ON "ai_tool_calls" USING btree ("execution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_provider_key" ON "integration_connections" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_events_external_key" ON "integration_events" USING btree ("tenant_id","provider","external_id") WHERE "integration_events"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "integration_events_created_idx" ON "integration_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "saved_reports_schedule_idx" ON "saved_reports" USING btree ("next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definitions_key" ON "workflow_definitions" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "workflow_definitions_trigger_idx" ON "workflow_definitions" USING btree ("tenant_id","trigger","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_steps_key" ON "workflow_run_steps" USING btree ("run_id","step_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_steps_idem_key" ON "workflow_run_steps" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_dedupe_key" ON "workflow_runs" USING btree ("definition_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "workflow_runs_status_idx" ON "workflow_runs" USING btree ("tenant_id","status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_key" ON "workflow_versions" USING btree ("definition_id","version");