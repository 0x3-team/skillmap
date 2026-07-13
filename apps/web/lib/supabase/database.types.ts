export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  api: {
    Tables: {
      profiles: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_skills: {
        Row: {
          created_at: string
          skill_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          skill_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          skill_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_audit_evidence"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "saved_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_grade_evidence"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "saved_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_relationships"
            referencedColumns: ["source_skill_id"]
          },
          {
            foreignKeyName: "saved_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_relationships"
            referencedColumns: ["target_skill_id"]
          },
          {
            foreignKeyName: "saved_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_versions"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "saved_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skills"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "saved_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "saved_skill_catalog"
            referencedColumns: ["skill_id"]
          },
        ]
      }
      skill_reports: {
        Row: {
          category: string
          created_at: string
          disposition_code: string | null
          id: string
          idempotency_key: string
          message: string
          public_id: string
          public_resolution_message: string | null
          reporter_user_id: string
          resolution_digest: string | null
          resolution_reason_code: string | null
          resolved_at: string | null
          skill_id: string
          state: string
          updated_at: string
          version_id: string
        }
        Insert: {
          category: string
          created_at?: string
          disposition_code?: string | null
          id?: string
          idempotency_key: string
          message: string
          public_id?: string
          public_resolution_message?: string | null
          reporter_user_id?: string
          resolution_digest?: string | null
          resolution_reason_code?: string | null
          resolved_at?: string | null
          skill_id: string
          state?: string
          updated_at?: string
          version_id: string
        }
        Update: {
          category?: string
          created_at?: string
          disposition_code?: string | null
          id?: string
          idempotency_key?: string
          message?: string
          public_id?: string
          public_resolution_message?: string | null
          reporter_user_id?: string
          resolution_digest?: string | null
          resolution_reason_code?: string | null
          resolved_at?: string | null
          skill_id?: string
          state?: string
          updated_at?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_reports_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_audit_evidence"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_reports_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_grade_evidence"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_reports_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_relationships"
            referencedColumns: ["source_skill_id"]
          },
          {
            foreignKeyName: "skill_reports_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_relationships"
            referencedColumns: ["target_skill_id"]
          },
          {
            foreignKeyName: "skill_reports_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_versions"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_reports_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skills"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_reports_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "saved_skill_catalog"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_reports_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "catalog_audit_evidence"
            referencedColumns: ["version_id"]
          },
          {
            foreignKeyName: "skill_reports_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "catalog_grade_evidence"
            referencedColumns: ["version_id"]
          },
          {
            foreignKeyName: "skill_reports_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_relationships"
            referencedColumns: ["source_version_id"]
          },
          {
            foreignKeyName: "skill_reports_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_versions"
            referencedColumns: ["version_id"]
          },
          {
            foreignKeyName: "skill_reports_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "catalog_skills"
            referencedColumns: ["version_id"]
          },
          {
            foreignKeyName: "skill_reports_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "saved_skill_catalog"
            referencedColumns: ["version_id"]
          },
        ]
      }
      skill_submissions: {
        Row: {
          active_claim_id: string | null
          attempt_count: number
          audit_receipt_digest: string | null
          audit_receipt_id: string | null
          audit_receipt_public_id: string | null
          audit_state: string
          authority_confirmed: boolean
          claim_expires_at: string | null
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          current_worker_version: string | null
          grade_confidence: number | null
          grade_receipt_digest: string | null
          grade_receipt_id: string | null
          grade_receipt_public_id: string | null
          grade_state: string
          id: string
          idempotency_key: string
          last_transition_digest: string | null
          last_worker_run_id: string | null
          license_claim: string | null
          public_id: string
          public_status_message: string | null
          publication_digest: string | null
          remediation_code: string | null
          repository_url: string
          result_skill_id: string | null
          result_version_id: string | null
          review_case_id: string | null
          review_case_public_id: string | null
          review_state: string
          source_commit: string
          source_path: string
          state: string
          submission_policy_version: string
          submitter_user_id: string
          untrusted_processing_accepted: boolean
          updated_at: string
          version_label: string
        }
        Insert: {
          active_claim_id?: string | null
          attempt_count?: number
          audit_receipt_digest?: string | null
          audit_receipt_id?: string | null
          audit_receipt_public_id?: string | null
          audit_state?: string
          authority_confirmed?: boolean
          claim_expires_at?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          current_worker_version?: string | null
          grade_confidence?: number | null
          grade_receipt_digest?: string | null
          grade_receipt_id?: string | null
          grade_receipt_public_id?: string | null
          grade_state?: string
          id?: string
          idempotency_key: string
          last_transition_digest?: string | null
          last_worker_run_id?: string | null
          license_claim?: string | null
          public_id?: string
          public_status_message?: string | null
          publication_digest?: string | null
          remediation_code?: string | null
          repository_url: string
          result_skill_id?: string | null
          result_version_id?: string | null
          review_case_id?: string | null
          review_case_public_id?: string | null
          review_state?: string
          source_commit: string
          source_path: string
          state?: string
          submission_policy_version?: string
          submitter_user_id?: string
          untrusted_processing_accepted?: boolean
          updated_at?: string
          version_label: string
        }
        Update: {
          active_claim_id?: string | null
          attempt_count?: number
          audit_receipt_digest?: string | null
          audit_receipt_id?: string | null
          audit_receipt_public_id?: string | null
          audit_state?: string
          authority_confirmed?: boolean
          claim_expires_at?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          current_worker_version?: string | null
          grade_confidence?: number | null
          grade_receipt_digest?: string | null
          grade_receipt_id?: string | null
          grade_receipt_public_id?: string | null
          grade_state?: string
          id?: string
          idempotency_key?: string
          last_transition_digest?: string | null
          last_worker_run_id?: string | null
          license_claim?: string | null
          public_id?: string
          public_status_message?: string | null
          publication_digest?: string | null
          remediation_code?: string | null
          repository_url?: string
          result_skill_id?: string | null
          result_version_id?: string | null
          review_case_id?: string | null
          review_case_public_id?: string | null
          review_state?: string
          source_commit?: string
          source_path?: string
          state?: string
          submission_policy_version?: string
          submitter_user_id?: string
          untrusted_processing_accepted?: boolean
          updated_at?: string
          version_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_submissions_result_skill_id_fkey"
            columns: ["result_skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_audit_evidence"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_skill_id_fkey"
            columns: ["result_skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_grade_evidence"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_skill_id_fkey"
            columns: ["result_skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_relationships"
            referencedColumns: ["source_skill_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_skill_id_fkey"
            columns: ["result_skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_relationships"
            referencedColumns: ["target_skill_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_skill_id_fkey"
            columns: ["result_skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_versions"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_skill_id_fkey"
            columns: ["result_skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skills"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_skill_id_fkey"
            columns: ["result_skill_id"]
            isOneToOne: false
            referencedRelation: "saved_skill_catalog"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_version_id_fkey"
            columns: ["result_version_id"]
            isOneToOne: false
            referencedRelation: "catalog_audit_evidence"
            referencedColumns: ["version_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_version_id_fkey"
            columns: ["result_version_id"]
            isOneToOne: false
            referencedRelation: "catalog_grade_evidence"
            referencedColumns: ["version_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_version_id_fkey"
            columns: ["result_version_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_relationships"
            referencedColumns: ["source_version_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_version_id_fkey"
            columns: ["result_version_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_versions"
            referencedColumns: ["version_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_version_id_fkey"
            columns: ["result_version_id"]
            isOneToOne: false
            referencedRelation: "catalog_skills"
            referencedColumns: ["version_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_version_id_fkey"
            columns: ["result_version_id"]
            isOneToOne: false
            referencedRelation: "saved_skill_catalog"
            referencedColumns: ["version_id"]
          },
        ]
      }
    }
    Views: {
      catalog_audit_evidence: {
        Row: {
          audit_receipt_id: string | null
          audited_at: string | null
          checks: Json | null
          finding_counts: Json | null
          host_profile_version: string | null
          license_state: string | null
          network_indicators: boolean | null
          permission_scripts: boolean | null
          policy_version: string | null
          reason_codes: string[] | null
          receipt_digest: string | null
          skill_id: string | null
          source_commit: string | null
          spdx_expression: string | null
          state: string | null
          tool_indicators: boolean | null
          version_id: string | null
          worker_version: string | null
        }
        Relationships: []
      }
      catalog_grade_evidence: {
        Row: {
          audit_receipt_digest: string | null
          audit_receipt_id: string | null
          compatibility_evidence_digest: string | null
          confidence: number | null
          dimensions: Json | null
          evaluation_suite_digest: string | null
          evaluator_version: string | null
          grade_receipt_id: string | null
          graded_at: string | null
          hard_gates: Json | null
          host_profile_version: string | null
          reason_codes: string[] | null
          receipt_digest: string | null
          rubric_version: string | null
          skill_id: string | null
          source_commit: string | null
          state: string | null
          total_score: number | null
          version_id: string | null
        }
        Relationships: []
      }
      catalog_skill_relationships: {
        Row: {
          evidence_state: string | null
          reason: string | null
          relationship_type: string | null
          source_skill_id: string | null
          source_version_id: string | null
          target_skill_id: string | null
        }
        Relationships: []
      }
      catalog_skill_versions: {
        Row: {
          artifact_availability: string | null
          capabilities: string[] | null
          compatibility_evidence_digest: string | null
          compatibility_profile_version: string | null
          compatibility_state: string | null
          description: string | null
          display_name: string | null
          entrypoint_content_digest: string | null
          evidence_audit_state: string | null
          evidence_compatibility_state: string | null
          evidence_provenance_state: string | null
          grade_band: string | null
          grade_confidence: number | null
          grade_host_profile_version: string | null
          grade_invalidated_at: string | null
          grade_reason_codes: string[] | null
          grade_receipt_digest: string | null
          grade_receipt_id: string | null
          grade_rubric_version: string | null
          grade_state: string | null
          graded_at: string | null
          license_files: string[] | null
          license_state: string | null
          lifecycle_state: string | null
          manifest_digest: string | null
          normalized_artifact_digest: string | null
          permission_network: string[] | null
          permission_scripts: boolean | null
          permission_tools: string[] | null
          published_at: string | null
          publisher_display_name: string | null
          publisher_handle: string | null
          publisher_id: string | null
          publisher_verification_state: string | null
          raw_snapshot_digest: string | null
          redistribution_state: string | null
          repository_url: string | null
          search_document: unknown
          skill_id: string | null
          slug: string | null
          source_commit: string | null
          source_path: string | null
          spdx_expression: string | null
          summary: string | null
          updated_at: string | null
          version: string | null
          version_id: string | null
        }
        Relationships: []
      }
      catalog_skills: {
        Row: {
          capabilities: string[] | null
          compatibility_state: string | null
          display_name: string | null
          entrypoint_content_digest: string | null
          grade_band: string | null
          grade_confidence: number | null
          grade_host_profile_version: string | null
          grade_invalidated_at: string | null
          grade_reason_codes: string[] | null
          grade_receipt_digest: string | null
          grade_receipt_id: string | null
          grade_rubric_version: string | null
          grade_state: string | null
          graded_at: string | null
          license_state: string | null
          lifecycle_state: string | null
          published_at: string | null
          publisher_display_name: string | null
          publisher_handle: string | null
          publisher_id: string | null
          publisher_verification_state: string | null
          redistribution_state: string | null
          search_document: unknown
          skill_id: string | null
          slug: string | null
          summary: string | null
          updated_at: string | null
          version: string | null
          version_id: string | null
        }
        Relationships: []
      }
      my_skill_reports: {
        Row: {
          category: string | null
          created_at: string | null
          disposition_code: string | null
          message: string | null
          public_resolution_message: string | null
          report_id: string | null
          resolution_reason_code: string | null
          resolved_at: string | null
          skill_id: string | null
          state: string | null
          updated_at: string | null
          version_id: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          disposition_code?: string | null
          message?: string | null
          public_resolution_message?: string | null
          report_id?: string | null
          resolution_reason_code?: string | null
          resolved_at?: string | null
          skill_id?: string | null
          state?: string | null
          updated_at?: string | null
          version_id?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          disposition_code?: string | null
          message?: string | null
          public_resolution_message?: string | null
          report_id?: string | null
          resolution_reason_code?: string | null
          resolved_at?: string | null
          skill_id?: string | null
          state?: string | null
          updated_at?: string | null
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "skill_reports_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_audit_evidence"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_reports_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_grade_evidence"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_reports_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_relationships"
            referencedColumns: ["source_skill_id"]
          },
          {
            foreignKeyName: "skill_reports_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_relationships"
            referencedColumns: ["target_skill_id"]
          },
          {
            foreignKeyName: "skill_reports_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_versions"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_reports_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skills"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_reports_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "saved_skill_catalog"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_reports_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "catalog_audit_evidence"
            referencedColumns: ["version_id"]
          },
          {
            foreignKeyName: "skill_reports_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "catalog_grade_evidence"
            referencedColumns: ["version_id"]
          },
          {
            foreignKeyName: "skill_reports_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_relationships"
            referencedColumns: ["source_version_id"]
          },
          {
            foreignKeyName: "skill_reports_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_versions"
            referencedColumns: ["version_id"]
          },
          {
            foreignKeyName: "skill_reports_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "catalog_skills"
            referencedColumns: ["version_id"]
          },
          {
            foreignKeyName: "skill_reports_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "saved_skill_catalog"
            referencedColumns: ["version_id"]
          },
        ]
      }
      my_skill_submissions: {
        Row: {
          audit_receipt_digest: string | null
          audit_receipt_public_id: string | null
          audit_state: string | null
          claimed_at: string | null
          completed_at: string | null
          created_at: string | null
          grade_confidence: number | null
          grade_receipt_digest: string | null
          grade_receipt_public_id: string | null
          grade_state: string | null
          license_claim: string | null
          public_status_message: string | null
          remediation_code: string | null
          repository_url: string | null
          result_skill_id: string | null
          result_version_id: string | null
          review_case_public_id: string | null
          review_state: string | null
          source_commit: string | null
          source_path: string | null
          state: string | null
          submission_id: string | null
          submission_policy_version: string | null
          updated_at: string | null
          version_label: string | null
        }
        Insert: {
          audit_receipt_digest?: string | null
          audit_receipt_public_id?: string | null
          audit_state?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          grade_confidence?: number | null
          grade_receipt_digest?: string | null
          grade_receipt_public_id?: string | null
          grade_state?: string | null
          license_claim?: string | null
          public_status_message?: string | null
          remediation_code?: string | null
          repository_url?: string | null
          result_skill_id?: string | null
          result_version_id?: string | null
          review_case_public_id?: string | null
          review_state?: string | null
          source_commit?: string | null
          source_path?: string | null
          state?: string | null
          submission_id?: string | null
          submission_policy_version?: string | null
          updated_at?: string | null
          version_label?: string | null
        }
        Update: {
          audit_receipt_digest?: string | null
          audit_receipt_public_id?: string | null
          audit_state?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          grade_confidence?: number | null
          grade_receipt_digest?: string | null
          grade_receipt_public_id?: string | null
          grade_state?: string | null
          license_claim?: string | null
          public_status_message?: string | null
          remediation_code?: string | null
          repository_url?: string | null
          result_skill_id?: string | null
          result_version_id?: string | null
          review_case_public_id?: string | null
          review_state?: string | null
          source_commit?: string | null
          source_path?: string | null
          state?: string | null
          submission_id?: string | null
          submission_policy_version?: string | null
          updated_at?: string | null
          version_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "skill_submissions_result_skill_id_fkey"
            columns: ["result_skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_audit_evidence"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_skill_id_fkey"
            columns: ["result_skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_grade_evidence"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_skill_id_fkey"
            columns: ["result_skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_relationships"
            referencedColumns: ["source_skill_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_skill_id_fkey"
            columns: ["result_skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_relationships"
            referencedColumns: ["target_skill_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_skill_id_fkey"
            columns: ["result_skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_versions"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_skill_id_fkey"
            columns: ["result_skill_id"]
            isOneToOne: false
            referencedRelation: "catalog_skills"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_skill_id_fkey"
            columns: ["result_skill_id"]
            isOneToOne: false
            referencedRelation: "saved_skill_catalog"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_version_id_fkey"
            columns: ["result_version_id"]
            isOneToOne: false
            referencedRelation: "catalog_audit_evidence"
            referencedColumns: ["version_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_version_id_fkey"
            columns: ["result_version_id"]
            isOneToOne: false
            referencedRelation: "catalog_grade_evidence"
            referencedColumns: ["version_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_version_id_fkey"
            columns: ["result_version_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_relationships"
            referencedColumns: ["source_version_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_version_id_fkey"
            columns: ["result_version_id"]
            isOneToOne: false
            referencedRelation: "catalog_skill_versions"
            referencedColumns: ["version_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_version_id_fkey"
            columns: ["result_version_id"]
            isOneToOne: false
            referencedRelation: "catalog_skills"
            referencedColumns: ["version_id"]
          },
          {
            foreignKeyName: "skill_submissions_result_version_id_fkey"
            columns: ["result_version_id"]
            isOneToOne: false
            referencedRelation: "saved_skill_catalog"
            referencedColumns: ["version_id"]
          },
        ]
      }
      saved_skill_catalog: {
        Row: {
          capabilities: string[] | null
          compatibility_state: string | null
          display_name: string | null
          entrypoint_content_digest: string | null
          grade_band: string | null
          grade_confidence: number | null
          grade_host_profile_version: string | null
          grade_invalidated_at: string | null
          grade_reason_codes: string[] | null
          grade_receipt_digest: string | null
          grade_receipt_id: string | null
          grade_rubric_version: string | null
          grade_state: string | null
          graded_at: string | null
          license_state: string | null
          lifecycle_state: string | null
          published_at: string | null
          publisher_display_name: string | null
          publisher_handle: string | null
          publisher_id: string | null
          publisher_verification_state: string | null
          redistribution_state: string | null
          saved_at: string | null
          search_document: unknown
          skill_id: string | null
          slug: string | null
          summary: string | null
          updated_at: string | null
          version: string | null
          version_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      claim_skill_submission: {
        Args: {
          p_lease_seconds?: number
          p_submission_id?: string
          p_worker_version: string
        }
        Returns: {
          attempt_number: number
          claim_expires_at: string
          claim_id: string
          license_claim: string
          repository_url: string
          source_commit: string
          source_path: string
          submission_id: string
          version_label: string
        }[]
      }
      complete_skill_submission: {
        Args: {
          p_audit_receipt: Json
          p_claim_id: string
          p_disposition: string
          p_grade_receipt: Json
          p_idempotency_digest: string
          p_input_digest: string
          p_public_message: string
          p_reason_codes: string[]
          p_result_digest: string
          p_submission_id: string
          p_worker_version: string
        }
        Returns: {
          audit_receipt_id: string
          grade_receipt_id: string
          review_case_id: string
          submission_id: string
          submission_state: string
        }[]
      }
      control_catalog_lifecycle: {
        Args: {
          p_action: string
          p_idempotency_digest: string
          p_reason_code: string
          p_skill_id: string
          p_version_id: string
        }
        Returns: {
          skill_id: string
          skill_lifecycle_state: string
          skill_revoked: boolean
          version_id: string
          version_quarantined: boolean
          version_revoked: boolean
        }[]
      }
      dead_letter_expired_skill_submission: {
        Args: { p_idempotency_digest: string; p_submission_id: string }
        Returns: {
          attempt_count: number
          submission_id: string
          submission_state: string
        }[]
      }
      delete_my_account: { Args: never; Returns: boolean }
      disposition_skill_report: {
        Args: {
          p_disposition_code: string
          p_idempotency_digest: string
          p_public_message: string
          p_reason_code: string
          p_report_id: string
        }
        Returns: {
          disposition_code: string
          report_id: string
          report_state: string
        }[]
      }
      list_skill_report_queue: {
        Args: { p_limit?: number }
        Returns: {
          category: string
          created_at: string
          message: string
          report_id: string
          skill_id: string
          version_id: string
        }[]
      }
      list_skill_submission_collisions: {
        Args: { p_submission_id: string }
        Returns: {
          collision_found: boolean
          review_subject: Json
          review_subject_digest: string
        }[]
      }
      publish_skill_submission: {
        Args: {
          p_capabilities: string[]
          p_description: string
          p_license_state: string
          p_permission_network: string[]
          p_permission_scripts: boolean
          p_permission_tools: string[]
          p_publication_digest: string
          p_publisher_display_name: string
          p_publisher_handle: string
          p_skill_display_name: string
          p_skill_slug: string
          p_spdx_expression: string
          p_submission_id: string
          p_summary: string
        }
        Returns: {
          publisher_id: string
          skill_id: string
          submission_id: string
          submission_state: string
          version_id: string
        }[]
      }
      renew_skill_submission_claim: {
        Args: {
          p_claim_id: string
          p_lease_seconds?: number
          p_submission_id: string
          p_worker_version: string
        }
        Returns: {
          claim_expires_at: string
          claim_id: string
          submission_id: string
        }[]
      }
      requeue_skill_submission: {
        Args: { p_idempotency_digest: string; p_submission_id: string }
        Returns: {
          attempt_count: number
          submission_id: string
          submission_state: string
        }[]
      }
      review_skill_submission_collisions: {
        Args: {
          p_disposition: string
          p_idempotency_digest: string
          p_reason_code: string
          p_submission_id: string
        }
        Returns: {
          collision_review_id: string
          disposition: string
          review_subject_digest: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  api: {
    Enums: {},
  },
} as const
