export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
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
          provider_defer_count: number
          provider_retry_after_at: string | null
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
          provider_defer_count?: number
          provider_retry_after_at?: string | null
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
          provider_defer_count?: number
          provider_retry_after_at?: string | null
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
      my_devices: {
        Row: {
          connector_version: string | null
          display_name: string | null
          expires_at: string | null
          issued_at: string | null
          last_used_at: string | null
          locale: string | null
          platform: string | null
          public_id: string | null
          revision: number | null
          revoked_at: string | null
          state: string | null
        }
        Relationships: []
      }
      my_import_sessions: {
        Row: {
          accepted_byte_total: number | null
          accepted_file_count: number | null
          created_at: string | null
          expected_byte_total: number | null
          expected_file_count: number | null
          expiry_at: string | null
          public_id: string | null
          revision: number | null
          state: string | null
          updated_at: string | null
          verified_at: string | null
        }
        Relationships: []
      }
      my_managed_skill_files: {
        Row: {
          byte_size: number | null
          created_at: string | null
          executable: boolean | null
          media_type: string | null
          ordinal: number | null
          public_id: string | null
          relative_path: string | null
        }
        Relationships: []
      }
      my_managed_skill_releases: {
        Row: {
          created_at: string | null
          eligibility_reasons: string[] | null
          lifecycle_state: string | null
          public_id: string | null
        }
        Relationships: []
      }
      my_managed_skill_versions: {
        Row: {
          analysis_state: string | null
          created_at: string | null
          provenance_state: string | null
          public_id: string | null
        }
        Relationships: []
      }
      my_managed_skills: {
        Row: {
          created_at: string | null
          description: string | null
          display_name: string | null
          public_id: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      my_route_corrections: {
        Row: {
          alt_release_public_id: string | null
          alt_skill_public_id: string | null
          alt_version_public_id: string | null
          correction_public_id: string | null
          created_at: string | null
          decision_public_id: string | null
          expires_at: string | null
          outcome: string | null
        }
        Relationships: []
      }
      my_route_decisions: {
        Row: {
          confidence: number | null
          created_at: string | null
          decision_expiry_at: string | null
          public_id: string | null
          reason_codes: Json | null
          replay_guaranteed_until: string | null
          result_type: string | null
        }
        Relationships: []
      }
      my_route_selections: {
        Row: {
          confidence: number | null
          created_at: string | null
          decision_public_id: string | null
          ordinal: number | null
          reason_codes: Json | null
          release_public_id: string | null
          role: string | null
          row_kind: string | null
          skill_public_id: string | null
          version_public_id: string | null
        }
        Relationships: []
      }
      my_skill_reports: {
        Row: {
          category: string | null
          created_at: string | null
          disposition_code: string | null
          idempotency_key: string | null
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
          idempotency_key?: string | null
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
          idempotency_key?: string | null
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
      activate_managed_skill_release: {
        Args: {
          expected_revision: number
          idempotency_key: string
          release_public_id: string
          skill_public_id: string
        }
        Returns: {
          result_activation_revision: number
          result_release_public_id: string
          result_skill_public_id: string
          result_state: string
        }[]
      }
      approve_operator_action: {
        Args: {
          p_action_digest: string
          p_action_kind: string
          p_action_payload: Json
          p_operation_id: string
          p_subject_id: string
          p_subject_type: string
        }
        Returns: {
          action_digest: string
          approval_id: string
          approver_id: string
          expires_at: string
        }[]
      }
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
      defer_skill_submission_provider_limit: {
        Args: {
          p_claim_id: string
          p_idempotency_digest: string
          p_retry_after_seconds: number
          p_submission_id: string
          p_worker_version: string
        }
        Returns: {
          attempt_count: number
          provider_defer_count: number
          provider_retry_after_at: string
          submission_id: string
          submission_state: string
        }[]
      }
      delete_my_account: { Args: never; Returns: boolean }
      disposition_skill_report: {
        Args: {
          p_disposition_code: string
          p_idempotency_digest: string
          p_lifecycle_action: string
          p_public_message: string
          p_reason_code: string
          p_report_id: string
        }
        Returns: {
          disposition_code: string
          lifecycle_action: string
          report_id: string
          report_state: string
          skill_id: string
          version_id: string
          version_quarantined: boolean
          version_revoked: boolean
        }[]
      }
      export_my_managed_skill_vault: { Args: never; Returns: Json }
      get_skill_submission_operator_detail: {
        Args: { p_submission_id: string }
        Returns: {
          attempt_count: number
          audit_receipt: Json
          audit_state: string
          authority_confirmed: boolean
          claim_expired: boolean
          claim_expires_at: string
          claimed_at: string
          collision_reviews: Json
          collision_reviews_truncated: boolean
          completed_at: string
          created_at: string
          current_worker_version: string
          dead_letter_ready: boolean
          grade_receipt: Json
          grade_state: string
          last_transition_digest: string
          license_evidence_receipt: Json
          observed_at: string
          public_status_message: string
          publication_digest: string
          publication_review_ready: boolean
          publisher_authorizations: Json
          publisher_authorizations_truncated: boolean
          remediation_code: string
          repository_url: string
          result_skill_id: string
          result_version_id: string
          retry_eligible: boolean
          review_case: Json
          review_state: string
          source_commit: string
          source_path: string
          submission_id: string
          submission_policy_version: string
          submission_state: string
          submitter_license_claim: string
          transition_events: Json
          transition_events_truncated: boolean
          untrusted_processing_accepted: boolean
          updated_at: string
          version_label: string
          worker_runs: Json
        }[]
      }
      get_skill_submission_queue_summary: {
        Args: never
        Returns: {
          accepted_count: number
          changes_requested_count: number
          dead_letter_ready_count: number
          expired_processing_count: number
          failed_count: number
          observed_at: string
          oldest_accepted_at: string
          oldest_processing_claim_expires_at: string
          oldest_queued_at: string
          oldest_remediation_at: string
          processing_count: number
          queued_count: number
          retryable_count: number
        }[]
      }
      list_skill_report_queue: {
        Args: {
          p_after_created_at?: string
          p_after_report_id?: string
          p_limit?: number
        }
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
      list_skill_submission_operator_queue: {
        Args: {
          p_after_submission_id?: string
          p_after_updated_at?: string
          p_limit?: number
          p_state?: string
        }
        Returns: {
          attempt_count: number
          audit_state: string
          claim_expired: boolean
          claim_expires_at: string
          claimed_at: string
          completed_at: string
          created_at: string
          current_worker_version: string
          dead_letter_ready: boolean
          grade_state: string
          observed_at: string
          public_status_message: string
          publication_review_ready: boolean
          remediation_code: string
          repository_url: string
          result_skill_id: string
          result_version_id: string
          retry_eligible: boolean
          review_state: string
          source_commit: string
          source_path: string
          submission_id: string
          submission_state: string
          submitter_license_claim: string
          updated_at: string
          version_label: string
        }[]
      }
      peek_skill_submission_candidate: {
        Args: { p_submission_id?: string }
        Returns: {
          attempt_number: number
          license_claim: string
          repository_url: string
          source_commit: string
          source_path: string
          submission_id: string
          version_label: string
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
      record_skill_submission_license_evidence: {
        Args: {
          p_audit_receipt_digest: string
          p_claim_id: string
          p_evidence: Json
          p_idempotency_digest: string
          p_review_evidence_digest: string
          p_review_reference: string
          p_spdx_expression: string
          p_submission_id: string
          p_worker_version: string
        }
        Returns: {
          audit_receipt_digest: string
          license_evidence_receipt_id: string
        }[]
      }
      record_skill_submission_publisher_authorization: {
        Args: {
          p_authorization_basis: string
          p_decision: string
          p_evidence_digest: string
          p_evidence_reference: string
          p_expires_at: string
          p_idempotency_digest: string
          p_publisher_handle: string
          p_submission_id: string
        }
        Returns: {
          authorization_decision: string
          authorization_expires_at: string
          authorization_receipt_id: string
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
          p_target_publisher_id: string
          p_target_skill_id: string
          p_target_version_id: string
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
  private: {
    Tables: {
      account_deletion_receipts: {
        Row: {
          acknowledgements: Json
          attempt_count: number
          backup_physical_ageout_deadline: string | null
          barrier_committed_at: string | null
          barrier_initiated_at: string
          cleanup_started_at: string | null
          completed_at: string | null
          del_: string
          expiry_at: string | null
          id: string
          owner_completed_count: number
          proof_digest: string | null
          queued_at: string | null
          schema_version: string
          state: string
        }
        Insert: {
          acknowledgements?: Json
          attempt_count?: number
          backup_physical_ageout_deadline?: string | null
          barrier_committed_at?: string | null
          barrier_initiated_at?: string
          cleanup_started_at?: string | null
          completed_at?: string | null
          del_?: string
          expiry_at?: string | null
          id: string
          owner_completed_count?: number
          proof_digest?: string | null
          queued_at?: string | null
          schema_version?: string
          state?: string
        }
        Update: {
          acknowledgements?: Json
          attempt_count?: number
          backup_physical_ageout_deadline?: string | null
          barrier_committed_at?: string | null
          barrier_initiated_at?: string
          cleanup_started_at?: string | null
          completed_at?: string | null
          del_?: string
          expiry_at?: string | null
          id?: string
          owner_completed_count?: number
          proof_digest?: string | null
          queued_at?: string | null
          schema_version?: string
          state?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          actor_user_id: string | null
          approver_operator_id: string | null
          created_at: string
          event_type: string
          executor_operator_id: string | null
          id: string
          idempotency_digest: string | null
          operator_approval_id: string | null
          operator_attribution_required: boolean
          payload: Json
          subject_id: string
          subject_type: string
        }
        Insert: {
          actor_user_id?: string | null
          approver_operator_id?: string | null
          created_at?: string
          event_type: string
          executor_operator_id?: string | null
          id?: string
          idempotency_digest?: string | null
          operator_approval_id?: string | null
          operator_attribution_required?: boolean
          payload?: Json
          subject_id: string
          subject_type: string
        }
        Update: {
          actor_user_id?: string | null
          approver_operator_id?: string | null
          created_at?: string
          event_type?: string
          executor_operator_id?: string | null
          id?: string
          idempotency_digest?: string | null
          operator_approval_id?: string | null
          operator_attribution_required?: boolean
          payload?: Json
          subject_id?: string
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_approver_operator_id_fkey"
            columns: ["approver_operator_id"]
            isOneToOne: false
            referencedRelation: "operator_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_executor_operator_id_fkey"
            columns: ["executor_operator_id"]
            isOneToOne: false
            referencedRelation: "operator_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_operator_approval_id_fkey"
            columns: ["operator_approval_id"]
            isOneToOne: false
            referencedRelation: "operator_action_approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      device_tokens: {
        Row: {
          account_id: string
          credential_digest: string
          device_id: string
          expires_at: string | null
          generation: number
          id: string
          issued_at: string
          key_version: number
          last_used_at: string | null
          replaced_by_token_id: string | null
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          account_id: string
          credential_digest: string
          device_id: string
          expires_at?: string | null
          generation: number
          id?: string
          issued_at?: string
          key_version: number
          last_used_at?: string | null
          replaced_by_token_id?: string | null
          revoked_at?: string | null
          scopes: string[]
        }
        Update: {
          account_id?: string
          credential_digest?: string
          device_id?: string
          expires_at?: string | null
          generation?: number
          id?: string
          issued_at?: string
          key_version?: number
          last_used_at?: string | null
          replaced_by_token_id?: string | null
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "device_tokens_binding_fkey"
            columns: ["account_id", "device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "device_tokens_replaced_by_fkey"
            columns: ["replaced_by_token_id"]
            isOneToOne: false
            referencedRelation: "device_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          account_id: string
          connector_version: string
          display_name: string | null
          expires_at: string | null
          id: string
          issued_at: string
          last_used_at: string | null
          locale: string | null
          platform: string
          public_id: string
          revision: number
          revoked_at: string | null
          state: string
        }
        Insert: {
          account_id: string
          connector_version: string
          display_name?: string | null
          expires_at?: string | null
          id?: string
          issued_at?: string
          last_used_at?: string | null
          locale?: string | null
          platform: string
          public_id?: string
          revision?: number
          revoked_at?: string | null
          state?: string
        }
        Update: {
          account_id?: string
          connector_version?: string
          display_name?: string | null
          expires_at?: string | null
          id?: string
          issued_at?: string
          last_used_at?: string | null
          locale?: string | null
          platform?: string
          public_id?: string
          revision?: number
          revoked_at?: string | null
          state?: string
        }
        Relationships: []
      }
      import_file_receipts: {
        Row: {
          accepted_at: string
          accepted_byte_size: number
          account_id: string
          device_id: string
          file_digest: string
          file_id: string
          id: string
          managed_skill_id: string
          media_type: string | null
          ordinal: number
          relative_path: string
          session_id: string
          version_id: string
        }
        Insert: {
          accepted_at?: string
          accepted_byte_size: number
          account_id: string
          device_id: string
          file_digest: string
          file_id: string
          id?: string
          managed_skill_id: string
          media_type?: string | null
          ordinal: number
          relative_path: string
          session_id: string
          version_id: string
        }
        Update: {
          accepted_at?: string
          accepted_byte_size?: number
          account_id?: string
          device_id?: string
          file_digest?: string
          file_id?: string
          id?: string
          managed_skill_id?: string
          media_type?: string | null
          ordinal?: number
          relative_path?: string
          session_id?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_file_receipts_file_fkey"
            columns: ["account_id", "managed_skill_id", "version_id", "file_id"]
            isOneToOne: false
            referencedRelation: "managed_skill_files"
            referencedColumns: [
              "account_id",
              "managed_skill_id",
              "version_id",
              "id",
            ]
          },
          {
            foreignKeyName: "import_file_receipts_session_fkey"
            columns: ["account_id", "device_id", "session_id"]
            isOneToOne: false
            referencedRelation: "import_sessions"
            referencedColumns: ["account_id", "device_id", "id"]
          },
        ]
      }
      import_sessions: {
        Row: {
          accepted_byte_total: number
          accepted_file_count: number
          account_id: string
          content_digest: string
          created_at: string
          device_id: string
          expected_byte_total: number
          expected_file_count: number
          expiry_at: string
          id: string
          idempotency_key: string
          imp_: string
          managed_skill_id: string
          manifest_digest: string
          manifest_schema_version: string
          revision: number
          state: string
          updated_at: string
          verification_digest: string | null
          verified_at: string | null
          version_id: string
        }
        Insert: {
          accepted_byte_total?: number
          accepted_file_count?: number
          account_id: string
          content_digest: string
          created_at?: string
          device_id: string
          expected_byte_total: number
          expected_file_count: number
          expiry_at?: string
          id?: string
          idempotency_key: string
          imp_?: string
          managed_skill_id: string
          manifest_digest: string
          manifest_schema_version: string
          revision?: number
          state?: string
          updated_at?: string
          verification_digest?: string | null
          verified_at?: string | null
          version_id: string
        }
        Update: {
          accepted_byte_total?: number
          accepted_file_count?: number
          account_id?: string
          content_digest?: string
          created_at?: string
          device_id?: string
          expected_byte_total?: number
          expected_file_count?: number
          expiry_at?: string
          id?: string
          idempotency_key?: string
          imp_?: string
          managed_skill_id?: string
          manifest_digest?: string
          manifest_schema_version?: string
          revision?: number
          state?: string
          updated_at?: string
          verification_digest?: string | null
          verified_at?: string | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_sessions_device_fkey"
            columns: ["account_id", "device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "import_sessions_version_fkey"
            columns: ["account_id", "managed_skill_id", "version_id"]
            isOneToOne: false
            referencedRelation: "managed_skill_versions"
            referencedColumns: ["account_id", "managed_skill_id", "id"]
          },
        ]
      }
      managed_skill_activation_receipts: {
        Row: {
          account_id: string
          committed_at: string
          id: string
          idempotency_key: string
          request_expected_revision: number
          request_release_public_id: string
          request_skill_public_id: string
          result_activation_revision: number
          result_release_public_id: string
          result_skill_public_id: string
          result_state: string
        }
        Insert: {
          account_id: string
          committed_at?: string
          id?: string
          idempotency_key: string
          request_expected_revision: number
          request_release_public_id: string
          request_skill_public_id: string
          result_activation_revision: number
          result_release_public_id: string
          result_skill_public_id: string
          result_state: string
        }
        Update: {
          account_id?: string
          committed_at?: string
          id?: string
          idempotency_key?: string
          request_expected_revision?: number
          request_release_public_id?: string
          request_skill_public_id?: string
          result_activation_revision?: number
          result_release_public_id?: string
          result_skill_public_id?: string
          result_state?: string
        }
        Relationships: []
      }
      managed_skill_files: {
        Row: {
          account_id: string
          byte_size: number
          created_at: string
          executable: boolean
          file_digest: string
          id: string
          managed_skill_id: string
          media_type: string
          ordinal: number
          public_id: string
          relative_path: string
          storage_key: string
          version_id: string
        }
        Insert: {
          account_id: string
          byte_size: number
          created_at?: string
          executable: boolean
          file_digest: string
          id?: string
          managed_skill_id: string
          media_type: string
          ordinal: number
          public_id?: string
          relative_path: string
          storage_key: string
          version_id: string
        }
        Update: {
          account_id?: string
          byte_size?: number
          created_at?: string
          executable?: boolean
          file_digest?: string
          id?: string
          managed_skill_id?: string
          media_type?: string
          ordinal?: number
          public_id?: string
          relative_path?: string
          storage_key?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "managed_skill_files_skill_fkey"
            columns: ["account_id", "managed_skill_id"]
            isOneToOne: false
            referencedRelation: "managed_skills"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "managed_skill_files_version_fkey"
            columns: ["account_id", "managed_skill_id", "version_id"]
            isOneToOne: false
            referencedRelation: "managed_skill_versions"
            referencedColumns: ["account_id", "managed_skill_id", "id"]
          },
        ]
      }
      managed_skill_releases: {
        Row: {
          account_id: string
          activated_at: string | null
          created_at: string
          eligibility_reasons: string[]
          id: string
          lifecycle_state: string
          managed_skill_id: string
          public_id: string
          revoked_at: string | null
          version_id: string
        }
        Insert: {
          account_id: string
          activated_at?: string | null
          created_at?: string
          eligibility_reasons?: string[]
          id?: string
          lifecycle_state: string
          managed_skill_id: string
          public_id?: string
          revoked_at?: string | null
          version_id: string
        }
        Update: {
          account_id?: string
          activated_at?: string | null
          created_at?: string
          eligibility_reasons?: string[]
          id?: string
          lifecycle_state?: string
          managed_skill_id?: string
          public_id?: string
          revoked_at?: string | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "managed_skill_releases_skill_fkey"
            columns: ["account_id", "managed_skill_id"]
            isOneToOne: false
            referencedRelation: "managed_skills"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "managed_skill_releases_version_fkey"
            columns: ["account_id", "managed_skill_id", "version_id"]
            isOneToOne: true
            referencedRelation: "managed_skill_versions"
            referencedColumns: ["account_id", "managed_skill_id", "id"]
          },
        ]
      }
      managed_skill_versions: {
        Row: {
          account_id: string
          analysis_state: string
          canonical_metadata: Json
          content_digest: string
          created_at: string
          id: string
          managed_skill_id: string
          manifest_digest: string
          manifest_projection: string
          manifest_schema_version: string
          provenance_state: string
          public_id: string
          source: Json
        }
        Insert: {
          account_id: string
          analysis_state?: string
          canonical_metadata: Json
          content_digest: string
          created_at?: string
          id?: string
          managed_skill_id: string
          manifest_digest: string
          manifest_projection: string
          manifest_schema_version: string
          provenance_state: string
          public_id?: string
          source: Json
        }
        Update: {
          account_id?: string
          analysis_state?: string
          canonical_metadata?: Json
          content_digest?: string
          created_at?: string
          id?: string
          managed_skill_id?: string
          manifest_digest?: string
          manifest_projection?: string
          manifest_schema_version?: string
          provenance_state?: string
          public_id?: string
          source?: Json
        }
        Relationships: [
          {
            foreignKeyName: "managed_skill_versions_skill_fkey"
            columns: ["account_id", "managed_skill_id"]
            isOneToOne: false
            referencedRelation: "managed_skills"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      managed_skills: {
        Row: {
          account_id: string
          activation_revision: number
          active_release_id: string | null
          created_at: string
          description: string | null
          display_name: string
          id: string
          public_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          activation_revision?: number
          active_release_id?: string | null
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          public_id?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          activation_revision?: number
          active_release_id?: string | null
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          public_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "managed_skills_active_release_fkey"
            columns: ["account_id", "id", "active_release_id"]
            isOneToOne: false
            referencedRelation: "managed_skill_releases"
            referencedColumns: ["account_id", "managed_skill_id", "id"]
          },
        ]
      }
      operator_action_approvals: {
        Row: {
          action_digest: string
          action_kind: string
          action_payload: Json
          approver_operator_id: string
          created_at: string
          expires_at: string
          id: string
          operation_id: string
          public_id: string
          subject_id: string
          subject_type: string
        }
        Insert: {
          action_digest: string
          action_kind: string
          action_payload: Json
          approver_operator_id: string
          created_at: string
          expires_at: string
          id?: string
          operation_id: string
          public_id?: string
          subject_id: string
          subject_type: string
        }
        Update: {
          action_digest?: string
          action_kind?: string
          action_payload?: Json
          approver_operator_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          operation_id?: string
          public_id?: string
          subject_id?: string
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_action_approvals_approver_operator_id_fkey"
            columns: ["approver_operator_id"]
            isOneToOne: false
            referencedRelation: "operator_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_action_executions: {
        Row: {
          action_digest: string
          approval_id: string
          executed_at: string
          executor_operator_id: string
          id: string
          public_id: string
        }
        Insert: {
          action_digest: string
          approval_id: string
          executed_at?: string
          executor_operator_id: string
          id?: string
          public_id?: string
        }
        Update: {
          action_digest?: string
          approval_id?: string
          executed_at?: string
          executor_operator_id?: string
          id?: string
          public_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_action_executions_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: true
            referencedRelation: "operator_action_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_action_executions_executor_operator_id_fkey"
            columns: ["executor_operator_id"]
            isOneToOne: false
            referencedRelation: "operator_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_principals: {
        Row: {
          authority_role: string
          created_at: string
          credential_digest: string
          handle: string
          id: string
          public_id: string
          revoked_at: string | null
        }
        Insert: {
          authority_role: string
          created_at?: string
          credential_digest: string
          handle: string
          id?: string
          public_id?: string
          revoked_at?: string | null
        }
        Update: {
          authority_role?: string
          created_at?: string
          credential_digest?: string
          handle?: string
          id?: string
          public_id?: string
          revoked_at?: string | null
        }
        Relationships: []
      }
      publisher_authorization_revocation_tombstones: {
        Row: {
          created_at: string
          evidence_digest: string
          evidence_reference: string
          id: string
          idempotency_digest: string
          public_id: string
          publisher_handle: string
          repository_url: string
          revocation_receipt_public_id: string
          source_commit: string
          source_path: string
        }
        Insert: {
          created_at?: string
          evidence_digest: string
          evidence_reference: string
          id?: string
          idempotency_digest: string
          public_id?: string
          publisher_handle: string
          repository_url: string
          revocation_receipt_public_id: string
          source_commit: string
          source_path: string
        }
        Update: {
          created_at?: string
          evidence_digest?: string
          evidence_reference?: string
          id?: string
          idempotency_digest?: string
          public_id?: string
          publisher_handle?: string
          repository_url?: string
          revocation_receipt_public_id?: string
          source_commit?: string
          source_path?: string
        }
        Relationships: []
      }
      publisher_members: {
        Row: {
          created_at: string
          publisher_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          publisher_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          publisher_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publisher_members_publisher_id_fkey"
            columns: ["publisher_id"]
            isOneToOne: false
            referencedRelation: "publishers"
            referencedColumns: ["id"]
          },
        ]
      }
      publishers: {
        Row: {
          catalog_state: string
          created_at: string
          display_name: string
          handle: string
          id: string
          public_id: string
          revoked_at: string | null
          updated_at: string
          verification_state: string
        }
        Insert: {
          catalog_state?: string
          created_at?: string
          display_name: string
          handle: string
          id?: string
          public_id: string
          revoked_at?: string | null
          updated_at?: string
          verification_state?: string
        }
        Update: {
          catalog_state?: string
          created_at?: string
          display_name?: string
          handle?: string
          id?: string
          public_id?: string
          revoked_at?: string | null
          updated_at?: string
          verification_state?: string
        }
        Relationships: []
      }
      review_cases: {
        Row: {
          audit_receipt_id: string | null
          collision_evidence: Json
          collision_evidence_digest: string
          created_at: string
          grade_receipt_id: string | null
          id: string
          idempotency_digest: string
          public_id: string
          public_message: string | null
          reason_codes: string[]
          state: string
          submission_id: string
        }
        Insert: {
          audit_receipt_id?: string | null
          collision_evidence: Json
          collision_evidence_digest: string
          created_at?: string
          grade_receipt_id?: string | null
          id?: string
          idempotency_digest: string
          public_id?: string
          public_message?: string | null
          reason_codes?: string[]
          state: string
          submission_id: string
        }
        Update: {
          audit_receipt_id?: string | null
          collision_evidence?: Json
          collision_evidence_digest?: string
          created_at?: string
          grade_receipt_id?: string | null
          id?: string
          idempotency_digest?: string
          public_id?: string
          public_message?: string | null
          reason_codes?: string[]
          state?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_cases_audit_receipt_id_submission_id_fkey"
            columns: ["audit_receipt_id", "submission_id"]
            isOneToOne: false
            referencedRelation: "skill_audit_receipts"
            referencedColumns: ["id", "submission_id"]
          },
          {
            foreignKeyName: "review_cases_grade_receipt_id_submission_id_fkey"
            columns: ["grade_receipt_id", "submission_id"]
            isOneToOne: false
            referencedRelation: "skill_grade_receipts"
            referencedColumns: ["id", "submission_id"]
          },
        ]
      }
      route_corrections: {
        Row: {
          account_id: string
          alt_managed_skill_id: string | null
          alt_release_id: string | null
          alt_version_id: string | null
          created_at: string
          decision_id: string
          device_id: string
          expires_at: string
          id: string
          idempotency_key: string
          outcome: string
          rtc_: string
        }
        Insert: {
          account_id: string
          alt_managed_skill_id?: string | null
          alt_release_id?: string | null
          alt_version_id?: string | null
          created_at?: string
          decision_id: string
          device_id: string
          expires_at?: string
          id?: string
          idempotency_key: string
          outcome: string
          rtc_?: string
        }
        Update: {
          account_id?: string
          alt_managed_skill_id?: string | null
          alt_release_id?: string | null
          alt_version_id?: string | null
          created_at?: string
          decision_id?: string
          device_id?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          outcome?: string
          rtc_?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_corrections_decision_fkey"
            columns: ["account_id", "device_id", "decision_id"]
            isOneToOne: false
            referencedRelation: "route_decisions"
            referencedColumns: ["account_id", "device_id", "id"]
          },
          {
            foreignKeyName: "route_corrections_release_fkey"
            columns: [
              "account_id",
              "alt_managed_skill_id",
              "alt_version_id",
              "alt_release_id",
            ]
            isOneToOne: false
            referencedRelation: "managed_skill_releases"
            referencedColumns: [
              "account_id",
              "managed_skill_id",
              "version_id",
              "id",
            ]
          },
        ]
      }
      route_decision_selections: {
        Row: {
          account_id: string
          confidence: number
          created_at: string
          decision_id: string
          device_id: string
          id: string
          managed_skill_id: string
          ordinal: number
          reason_codes: Json
          release_id: string
          role: string | null
          row_kind: string
          version_id: string
        }
        Insert: {
          account_id: string
          confidence: number
          created_at?: string
          decision_id: string
          device_id: string
          id?: string
          managed_skill_id: string
          ordinal: number
          reason_codes: Json
          release_id: string
          role?: string | null
          row_kind: string
          version_id: string
        }
        Update: {
          account_id?: string
          confidence?: number
          created_at?: string
          decision_id?: string
          device_id?: string
          id?: string
          managed_skill_id?: string
          ordinal?: number
          reason_codes?: Json
          release_id?: string
          role?: string | null
          row_kind?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_decision_selections_decision_fkey"
            columns: ["account_id", "device_id", "decision_id"]
            isOneToOne: false
            referencedRelation: "route_decisions"
            referencedColumns: ["account_id", "device_id", "id"]
          },
          {
            foreignKeyName: "route_decision_selections_release_fkey"
            columns: [
              "account_id",
              "managed_skill_id",
              "version_id",
              "release_id",
            ]
            isOneToOne: false
            referencedRelation: "managed_skill_releases"
            referencedColumns: [
              "account_id",
              "managed_skill_id",
              "version_id",
              "id",
            ]
          },
        ]
      }
      route_decisions: {
        Row: {
          account_id: string
          account_revision: string
          audience_revision: string
          confidence: number
          created_at: string
          deadline_ms: number
          decision_expiry_at: string
          device_auth_binding_revision: string
          device_id: string
          elapsed_ms: number
          eligibility_revision: string
          id: string
          reason_codes: Json
          replay_guaranteed_until: string
          request_fingerprint: string
          request_id: string
          result_type: string
          routing_policy_revision: string
          rtd_: string
          segment_binding_ms: number
          segment_eligibility_ms: number
          segment_ranking_ms: number
        }
        Insert: {
          account_id: string
          account_revision: string
          audience_revision: string
          confidence: number
          created_at?: string
          deadline_ms: number
          decision_expiry_at: string
          device_auth_binding_revision: string
          device_id: string
          elapsed_ms: number
          eligibility_revision: string
          id?: string
          reason_codes: Json
          replay_guaranteed_until: string
          request_fingerprint: string
          request_id: string
          result_type: string
          routing_policy_revision: string
          rtd_?: string
          segment_binding_ms: number
          segment_eligibility_ms: number
          segment_ranking_ms: number
        }
        Update: {
          account_id?: string
          account_revision?: string
          audience_revision?: string
          confidence?: number
          created_at?: string
          deadline_ms?: number
          decision_expiry_at?: string
          device_auth_binding_revision?: string
          device_id?: string
          elapsed_ms?: number
          eligibility_revision?: string
          id?: string
          reason_codes?: Json
          replay_guaranteed_until?: string
          request_fingerprint?: string
          request_id?: string
          result_type?: string
          routing_policy_revision?: string
          rtd_?: string
          segment_binding_ms?: number
          segment_eligibility_ms?: number
          segment_ranking_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "route_decisions_device_fkey"
            columns: ["account_id", "device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      skill_audit_receipts: {
        Row: {
          created_at: string
          finding_counts: Json
          host_profile_version: string
          id: string
          license_state: string
          network_indicators: boolean
          normalized_content_digest: string
          permission_scripts: boolean
          policy_version: string
          private_evidence_digest: string
          public_checks: Json
          public_id: string
          reason_codes: string[]
          receipt_digest: string
          source_content_digest: string
          spdx_expression: string | null
          state: string
          submission_id: string
          tool_indicators: boolean
          worker_version: string
        }
        Insert: {
          created_at?: string
          finding_counts: Json
          host_profile_version: string
          id?: string
          license_state?: string
          network_indicators?: boolean
          normalized_content_digest: string
          permission_scripts?: boolean
          policy_version: string
          private_evidence_digest: string
          public_checks: Json
          public_id?: string
          reason_codes?: string[]
          receipt_digest: string
          source_content_digest: string
          spdx_expression?: string | null
          state: string
          submission_id: string
          tool_indicators?: boolean
          worker_version: string
        }
        Update: {
          created_at?: string
          finding_counts?: Json
          host_profile_version?: string
          id?: string
          license_state?: string
          network_indicators?: boolean
          normalized_content_digest?: string
          permission_scripts?: boolean
          policy_version?: string
          private_evidence_digest?: string
          public_checks?: Json
          public_id?: string
          reason_codes?: string[]
          receipt_digest?: string
          source_content_digest?: string
          spdx_expression?: string | null
          state?: string
          submission_id?: string
          tool_indicators?: boolean
          worker_version?: string
        }
        Relationships: []
      }
      skill_grade_receipts: {
        Row: {
          audit_receipt_digest: string
          audit_receipt_id: string
          band: string | null
          compatibility_evidence_digest: string | null
          confidence: number | null
          created_at: string
          dimensions: Json
          evaluation_suite_digest: string | null
          evaluator_version: string
          hard_gates: Json
          host_profile_version: string
          id: string
          normalized_content_digest: string
          public_id: string
          reason_codes: string[]
          receipt_digest: string
          rubric_version: string
          state: string
          submission_id: string
          total_score: number | null
        }
        Insert: {
          audit_receipt_digest: string
          audit_receipt_id: string
          band?: string | null
          compatibility_evidence_digest?: string | null
          confidence?: number | null
          created_at?: string
          dimensions: Json
          evaluation_suite_digest?: string | null
          evaluator_version: string
          hard_gates: Json
          host_profile_version: string
          id?: string
          normalized_content_digest: string
          public_id?: string
          reason_codes: string[]
          receipt_digest: string
          rubric_version: string
          state: string
          submission_id: string
          total_score?: number | null
        }
        Update: {
          audit_receipt_digest?: string
          audit_receipt_id?: string
          band?: string | null
          compatibility_evidence_digest?: string | null
          confidence?: number | null
          created_at?: string
          dimensions?: Json
          evaluation_suite_digest?: string | null
          evaluator_version?: string
          hard_gates?: Json
          host_profile_version?: string
          id?: string
          normalized_content_digest?: string
          public_id?: string
          reason_codes?: string[]
          receipt_digest?: string
          rubric_version?: string
          state?: string
          submission_id?: string
          total_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "skill_grade_receipts_audit_receipt_id_submission_id_fkey"
            columns: ["audit_receipt_id", "submission_id"]
            isOneToOne: false
            referencedRelation: "skill_audit_receipts"
            referencedColumns: ["id", "submission_id"]
          },
        ]
      }
      skill_relationships: {
        Row: {
          created_at: string
          evidence_state: string
          id: string
          reason: string
          relationship_type: string
          source_version_id: string
          target_skill_id: string
        }
        Insert: {
          created_at?: string
          evidence_state?: string
          id?: string
          reason: string
          relationship_type: string
          source_version_id: string
          target_skill_id: string
        }
        Update: {
          created_at?: string
          evidence_state?: string
          id?: string
          reason?: string
          relationship_type?: string
          source_version_id?: string
          target_skill_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_relationships_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "skill_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_relationships_target_skill_id_fkey"
            columns: ["target_skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_vault_incomplete_upload_cleanup: {
        Row: {
          attempt_count: number
          available_at: string
          bucket_id: string
          claimed_at: string | null
          cleanup_reason: string
          completed_at: string | null
          created_at: string
          id: string
          object_name: string
          state: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          bucket_id: string
          claimed_at?: string | null
          cleanup_reason: string
          completed_at?: string | null
          created_at?: string
          id?: string
          object_name: string
          state?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          bucket_id?: string
          claimed_at?: string | null
          cleanup_reason?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          object_name?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      skill_vault_storage_deletion_jobs: {
        Row: {
          attempt_count: number
          bucket_id: string
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          deletion_receipt_id: string
          error_code: string | null
          id: string
          next_attempt_at: string
          object_name: string
          state: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          bucket_id: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          deletion_receipt_id: string
          error_code?: string | null
          id?: string
          next_attempt_at?: string
          object_name: string
          state?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          bucket_id?: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          deletion_receipt_id?: string
          error_code?: string | null
          id?: string
          next_attempt_at?: string
          object_name?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_vault_storage_deletion_jobs_deletion_receipt_id_fkey"
            columns: ["deletion_receipt_id"]
            isOneToOne: false
            referencedRelation: "account_deletion_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_versions: {
        Row: {
          artifact_availability: string
          compatibility_evidence_digest: string | null
          compatibility_profile_version: string | null
          compatibility_state: string
          created_at: string
          entrypoint_content_digest: string
          evidence_audit_state: string
          evidence_compatibility_state: string
          evidence_provenance_state: string
          grade_band: string | null
          grade_confidence: number | null
          grade_host_profile_version: string | null
          grade_invalidated_at: string | null
          grade_reason_codes: string[]
          grade_receipt_digest: string | null
          grade_receipt_id: string | null
          grade_rubric_version: string | null
          grade_state: string
          graded_at: string | null
          id: string
          license_files: string[]
          license_state: string
          manifest_digest: string | null
          normalized_artifact_digest: string | null
          permission_network: string[]
          permission_scripts: boolean
          permission_tools: string[]
          public_id: string
          publication_state: string
          published_at: string | null
          quarantined_at: string | null
          raw_snapshot_digest: string | null
          redistribution_state: string
          revoked_at: string | null
          skill_id: string
          source_commit: string
          source_path: string
          source_submission_id: string | null
          spdx_expression: string | null
          submission_audit_receipt_digest: string | null
          submission_audit_receipt_id: string | null
          submission_audit_receipt_public_id: string | null
          submission_grade_receipt_id: string | null
          version_label: string
        }
        Insert: {
          artifact_availability?: string
          compatibility_evidence_digest?: string | null
          compatibility_profile_version?: string | null
          compatibility_state?: string
          created_at?: string
          entrypoint_content_digest: string
          evidence_audit_state?: string
          evidence_compatibility_state?: string
          evidence_provenance_state?: string
          grade_band?: string | null
          grade_confidence?: number | null
          grade_host_profile_version?: string | null
          grade_invalidated_at?: string | null
          grade_reason_codes?: string[]
          grade_receipt_digest?: string | null
          grade_receipt_id?: string | null
          grade_rubric_version?: string | null
          grade_state?: string
          graded_at?: string | null
          id?: string
          license_files?: string[]
          license_state: string
          manifest_digest?: string | null
          normalized_artifact_digest?: string | null
          permission_network?: string[]
          permission_scripts?: boolean
          permission_tools?: string[]
          public_id: string
          publication_state?: string
          published_at?: string | null
          quarantined_at?: string | null
          raw_snapshot_digest?: string | null
          redistribution_state: string
          revoked_at?: string | null
          skill_id: string
          source_commit: string
          source_path: string
          source_submission_id?: string | null
          spdx_expression?: string | null
          submission_audit_receipt_digest?: string | null
          submission_audit_receipt_id?: string | null
          submission_audit_receipt_public_id?: string | null
          submission_grade_receipt_id?: string | null
          version_label: string
        }
        Update: {
          artifact_availability?: string
          compatibility_evidence_digest?: string | null
          compatibility_profile_version?: string | null
          compatibility_state?: string
          created_at?: string
          entrypoint_content_digest?: string
          evidence_audit_state?: string
          evidence_compatibility_state?: string
          evidence_provenance_state?: string
          grade_band?: string | null
          grade_confidence?: number | null
          grade_host_profile_version?: string | null
          grade_invalidated_at?: string | null
          grade_reason_codes?: string[]
          grade_receipt_digest?: string | null
          grade_receipt_id?: string | null
          grade_rubric_version?: string | null
          grade_state?: string
          graded_at?: string | null
          id?: string
          license_files?: string[]
          license_state?: string
          manifest_digest?: string | null
          normalized_artifact_digest?: string | null
          permission_network?: string[]
          permission_scripts?: boolean
          permission_tools?: string[]
          public_id?: string
          publication_state?: string
          published_at?: string | null
          quarantined_at?: string | null
          raw_snapshot_digest?: string | null
          redistribution_state?: string
          revoked_at?: string | null
          skill_id?: string
          source_commit?: string
          source_path?: string
          source_submission_id?: string | null
          spdx_expression?: string | null
          submission_audit_receipt_digest?: string | null
          submission_audit_receipt_id?: string | null
          submission_audit_receipt_public_id?: string | null
          submission_grade_receipt_id?: string | null
          version_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_versions_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_versions_submission_audit_fkey"
            columns: ["submission_audit_receipt_id", "source_submission_id"]
            isOneToOne: false
            referencedRelation: "skill_audit_receipts"
            referencedColumns: ["id", "submission_id"]
          },
          {
            foreignKeyName: "skill_versions_submission_grade_fkey"
            columns: ["submission_grade_receipt_id", "source_submission_id"]
            isOneToOne: false
            referencedRelation: "skill_grade_receipts"
            referencedColumns: ["id", "submission_id"]
          },
        ]
      }
      skills: {
        Row: {
          capabilities: string[]
          created_at: string
          current_version_id: string | null
          description: string
          display_name: string
          id: string
          lifecycle_state: string
          public_id: string
          publisher_id: string
          revoked_at: string | null
          search_document: unknown
          slug: string
          source_repository_id: string
          summary: string
          updated_at: string
          visibility_state: string
        }
        Insert: {
          capabilities?: string[]
          created_at?: string
          current_version_id?: string | null
          description: string
          display_name: string
          id?: string
          lifecycle_state?: string
          public_id: string
          publisher_id: string
          revoked_at?: string | null
          search_document?: unknown
          slug: string
          source_repository_id: string
          summary: string
          updated_at?: string
          visibility_state?: string
        }
        Update: {
          capabilities?: string[]
          created_at?: string
          current_version_id?: string | null
          description?: string
          display_name?: string
          id?: string
          lifecycle_state?: string
          public_id?: string
          publisher_id?: string
          revoked_at?: string | null
          search_document?: unknown
          slug?: string
          source_repository_id?: string
          summary?: string
          updated_at?: string
          visibility_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "skills_current_version_belongs_to_skill"
            columns: ["id", "current_version_id"]
            isOneToOne: false
            referencedRelation: "skill_versions"
            referencedColumns: ["skill_id", "id"]
          },
          {
            foreignKeyName: "skills_publisher_id_fkey"
            columns: ["publisher_id"]
            isOneToOne: false
            referencedRelation: "publishers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skills_source_repository_id_fkey"
            columns: ["source_repository_id"]
            isOneToOne: false
            referencedRelation: "source_repositories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skills_source_repository_id_publisher_id_fkey"
            columns: ["source_repository_id", "publisher_id"]
            isOneToOne: false
            referencedRelation: "source_repositories"
            referencedColumns: ["id", "publisher_id"]
          },
        ]
      }
      source_repositories: {
        Row: {
          catalog_state: string
          created_at: string
          id: string
          publisher_id: string
          repository_url: string
          revoked_at: string | null
          updated_at: string
        }
        Insert: {
          catalog_state?: string
          created_at?: string
          id?: string
          publisher_id: string
          repository_url: string
          revoked_at?: string | null
          updated_at?: string
        }
        Update: {
          catalog_state?: string
          created_at?: string
          id?: string
          publisher_id?: string
          repository_url?: string
          revoked_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_repositories_publisher_id_fkey"
            columns: ["publisher_id"]
            isOneToOne: false
            referencedRelation: "publishers"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_collision_reviews: {
        Row: {
          audit_receipt_id: string
          authority_version: number
          created_at: string
          disposition: string
          id: string
          idempotency_digest: string
          public_id: string
          reason_code: string
          review_case_id: string
          review_subject_digest: string
          submission_id: string
          target_publisher_id: string | null
          target_skill_id: string | null
          target_version_id: string | null
        }
        Insert: {
          audit_receipt_id: string
          authority_version?: number
          created_at?: string
          disposition: string
          id?: string
          idempotency_digest: string
          public_id?: string
          reason_code: string
          review_case_id: string
          review_subject_digest: string
          submission_id: string
          target_publisher_id?: string | null
          target_skill_id?: string | null
          target_version_id?: string | null
        }
        Update: {
          audit_receipt_id?: string
          authority_version?: number
          created_at?: string
          disposition?: string
          id?: string
          idempotency_digest?: string
          public_id?: string
          reason_code?: string
          review_case_id?: string
          review_subject_digest?: string
          submission_id?: string
          target_publisher_id?: string | null
          target_skill_id?: string | null
          target_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submission_collision_reviews_audit_receipt_id_submission_i_fkey"
            columns: ["audit_receipt_id", "submission_id"]
            isOneToOne: false
            referencedRelation: "skill_audit_receipts"
            referencedColumns: ["id", "submission_id"]
          },
          {
            foreignKeyName: "submission_collision_reviews_review_case_id_submission_id_fkey"
            columns: ["review_case_id", "submission_id"]
            isOneToOne: false
            referencedRelation: "review_cases"
            referencedColumns: ["id", "submission_id"]
          },
          {
            foreignKeyName: "submission_collision_reviews_target_publisher_id_fkey"
            columns: ["target_publisher_id"]
            isOneToOne: false
            referencedRelation: "publishers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_collision_reviews_target_skill_id_fkey"
            columns: ["target_skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_collision_reviews_target_version_id_fkey"
            columns: ["target_version_id"]
            isOneToOne: false
            referencedRelation: "skill_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_collision_reviews_target_version_skill_fkey"
            columns: ["target_skill_id", "target_version_id"]
            isOneToOne: false
            referencedRelation: "skill_versions"
            referencedColumns: ["skill_id", "id"]
          },
        ]
      }
      submission_events: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          created_at: string
          from_state: string | null
          id: string
          public_id: string
          submission_id: string
          to_state: string
          transition_digest: string | null
        }
        Insert: {
          actor_type: string
          actor_user_id?: string | null
          created_at?: string
          from_state?: string | null
          id?: string
          public_id?: string
          submission_id: string
          to_state: string
          transition_digest?: string | null
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          from_state?: string | null
          id?: string
          public_id?: string
          submission_id?: string
          to_state?: string
          transition_digest?: string | null
        }
        Relationships: []
      }
      submission_license_evidence_receipts: {
        Row: {
          audit_receipt_digest: string
          claim_id: string
          created_at: string
          evidence: Json
          id: string
          idempotency_digest: string
          public_id: string
          repository_url: string
          review_evidence_digest: string
          review_reference: string
          source_commit: string
          source_path: string
          spdx_expression: string
          submission_id: string
          worker_version: string
        }
        Insert: {
          audit_receipt_digest: string
          claim_id: string
          created_at?: string
          evidence: Json
          id?: string
          idempotency_digest: string
          public_id?: string
          repository_url: string
          review_evidence_digest: string
          review_reference: string
          source_commit: string
          source_path: string
          spdx_expression: string
          submission_id: string
          worker_version: string
        }
        Update: {
          audit_receipt_digest?: string
          claim_id?: string
          created_at?: string
          evidence?: Json
          id?: string
          idempotency_digest?: string
          public_id?: string
          repository_url?: string
          review_evidence_digest?: string
          review_reference?: string
          source_commit?: string
          source_path?: string
          spdx_expression?: string
          submission_id?: string
          worker_version?: string
        }
        Relationships: []
      }
      submission_publisher_authorization_receipts: {
        Row: {
          authorization_basis: string | null
          created_at: string
          decision: string
          evidence_digest: string
          evidence_reference: string
          expires_at: string | null
          id: string
          idempotency_digest: string
          public_id: string
          publisher_handle: string
          receipt_sequence: number
          repository_url: string
          source_commit: string
          source_path: string
          submission_id: string
        }
        Insert: {
          authorization_basis?: string | null
          created_at?: string
          decision: string
          evidence_digest: string
          evidence_reference: string
          expires_at?: string | null
          id?: string
          idempotency_digest: string
          public_id?: string
          publisher_handle: string
          receipt_sequence?: never
          repository_url: string
          source_commit: string
          source_path: string
          submission_id: string
        }
        Update: {
          authorization_basis?: string | null
          created_at?: string
          decision?: string
          evidence_digest?: string
          evidence_reference?: string
          expires_at?: string | null
          id?: string
          idempotency_digest?: string
          public_id?: string
          publisher_handle?: string
          receipt_sequence?: never
          repository_url?: string
          source_commit?: string
          source_path?: string
          submission_id?: string
        }
        Relationships: []
      }
      worker_runs: {
        Row: {
          attempt_number: number
          completed_at: string
          created_at: string
          disposition_state: string
          error_code: string | null
          id: string
          input_digest: string
          outcome: string
          public_error_message: string | null
          public_id: string
          result_digest: string | null
          started_at: string
          submission_id: string
          worker_version: string
        }
        Insert: {
          attempt_number: number
          completed_at: string
          created_at?: string
          disposition_state: string
          error_code?: string | null
          id: string
          input_digest: string
          outcome: string
          public_error_message?: string | null
          public_id?: string
          result_digest?: string | null
          started_at: string
          submission_id: string
          worker_version: string
        }
        Update: {
          attempt_number?: number
          completed_at?: string
          created_at?: string
          disposition_state?: string
          error_code?: string | null
          id?: string
          input_digest?: string
          outcome?: string
          public_error_message?: string | null
          public_id?: string
          result_digest?: string | null
          started_at?: string
          submission_id?: string
          worker_version?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_import_file: {
        Args: {
          p_account_id: string
          p_device_id: string
          p_file_id: string
          p_session_id: string
        }
        Returns: undefined
      }
      acknowledge_account_deletion_owner: {
        Args: {
          p_count_bucket: string
          p_deletion_request_id: string
          p_owner: string
          p_status: string
        }
        Returns: {
          completed: boolean
          deletion_request_id: string
          owner_completed_count: number
          proof_digest: string
          state: string
        }[]
      }
      activate_managed_skill_release: {
        Args: {
          expected_revision: number
          idempotency_key: string
          release_public_id: string
          skill_public_id: string
        }
        Returns: {
          result_activation_revision: number
          result_release_public_id: string
          result_skill_public_id: string
          result_state: string
        }[]
      }
      append_operator_audit_event: {
        Args: {
          event_type_value: string
          idempotency_digest_value: string
          payload_value: Json
          subject_id_value: string
          subject_type_value: string
        }
        Returns: undefined
      }
      assert_current_submission_evidence_authority: {
        Args: { p_submission_id: string }
        Returns: undefined
      }
      assert_device_token_replacement_chain: {
        Args: {
          p_account_id: string
          p_device_id: string
          p_source_token_id: string
          p_target_token_id: string
        }
        Returns: undefined
      }
      assert_route_decision_lineage_valid: {
        Args: {
          p_account_id: string
          p_decision_id: string
          p_device_id: string
        }
        Returns: undefined
      }
      authorize_device_token: {
        Args: {
          p_account_id: string
          p_credential_digest: string
          p_key_version: number
        }
        Returns: string
      }
      begin_import_session: {
        Args: {
          p_account_id: string
          p_content_digest: string
          p_device_id: string
          p_expected_byte_total: number
          p_expected_file_count: number
          p_expiry_at?: string
          p_idempotency_key: string
          p_managed_skill_id: string
          p_manifest_digest: string
          p_manifest_schema_version: string
          p_version_id: string
        }
        Returns: string
      }
      begin_operator_execution: {
        Args: {
          expected_action_digest: string
          expected_action_kind: string
          expected_action_payload: Json
          expected_subject_id: string
          expected_subject_type: string
        }
        Returns: string
      }
      claim_skill_submission_provider_aware_unchecked: {
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
      claim_skill_vault_incomplete_upload_cleanup: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          bucket_id: string
          claimed_at: string
          cleanup_reason: string
          job_id: string
          object_name: string
        }[]
      }
      claim_skill_vault_storage_deletion_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          bucket_id: string
          claimed_at: string
          deletion_receipt_id: string
          job_id: string
          object_name: string
        }[]
      }
      collision_evidence_digest: { Args: { value: Json }; Returns: string }
      collision_subject_has_matches: { Args: { value: Json }; Returns: boolean }
      collision_subject_has_target: {
        Args: {
          target_skill_public_id: string
          target_version_public_id: string
          value: Json
        }
        Returns: boolean
      }
      collision_subject_is_complete: { Args: { value: Json }; Returns: boolean }
      complete_operator_execution: {
        Args: { approval_id_value: string; expected_action_digest: string }
        Returns: undefined
      }
      complete_skill_submission_evidence_unchecked: {
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
      complete_skill_vault_incomplete_upload_cleanup: {
        Args: { p_job_id: string }
        Returns: {
          completed_at: string
          job_id: string
          state: string
        }[]
      }
      complete_skill_vault_storage_deletion_job: {
        Args: { p_job_id: string }
        Returns: {
          completed_at: string
          job_id: string
          state: string
        }[]
      }
      compute_deletion_proof_digest: {
        Args: {
          p_acks: Json
          p_backup_physical_ageout_deadline: string
          p_barrier_committed_at: string
          p_completed_at: string
          p_del_: string
        }
        Returns: string
      }
      control_catalog_lifecycle_unchecked: {
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
      create_managed_skill: {
        Args: { p_description: string; p_display_name: string }
        Returns: {
          created_at: string
          description: string
          display_name: string
          public_id: string
        }[]
      }
      current_request_role: { Args: never; Returns: string }
      current_request_uid: { Args: never; Returns: string }
      device_scopes_are_canonical: {
        Args: { value: string[] }
        Returns: boolean
      }
      disposition_skill_report_unchecked: {
        Args: {
          p_disposition_code: string
          p_idempotency_digest: string
          p_lifecycle_action: string
          p_public_message: string
          p_reason_code: string
          p_report_id: string
        }
        Returns: {
          disposition_code: string
          lifecycle_action: string
          report_id: string
          report_state: string
          skill_id: string
          version_id: string
          version_quarantined: boolean
          version_revoked: boolean
        }[]
      }
      enqueue_skill_vault_incomplete_upload_cleanup: {
        Args: {
          p_bucket_id: string
          p_cleanup_reason: string
          p_object_name: string
        }
        Returns: {
          bucket_id: string
          cleanup_reason: string
          job_id: string
          object_name: string
          state: string
        }[]
      }
      expire_import_session: {
        Args: {
          p_account_id: string
          p_device_id: string
          p_session_id: string
        }
        Returns: boolean
      }
      fail_skill_vault_storage_deletion_job: {
        Args: {
          p_error_code: string
          p_job_id: string
          p_requeue_after_seconds?: number
        }
        Returns: {
          job_id: string
          next_attempt_at: string
          state: string
        }[]
      }
      finalize_import_session: {
        Args: {
          p_account_id: string
          p_device_id: string
          p_session_id: string
        }
        Returns: string
      }
      grade_allows_missing_compatibility: {
        Args: {
          compatibility_digest: string
          grade_state: string
          hard_gate_rows: Json
        }
        Returns: boolean
      }
      import_session_has_exact_parity: {
        Args: { p_account_id: string; p_session_id: string }
        Returns: boolean
      }
      import_session_verification_digest: {
        Args: { p_account_id: string; p_session_id: string }
        Returns: string
      }
      issue_device: {
        Args: {
          p_account_id: string
          p_connector_version: string
          p_display_name: string
          p_locale?: string
          p_platform: string
        }
        Returns: string
      }
      issue_device_token: {
        Args: {
          p_account_id: string
          p_credential_digest: string
          p_device_id: string
          p_expires_at?: string
          p_key_version: number
          p_scopes: string[]
        }
        Returns: string
      }
      jsonb_exact_keys: {
        Args: { required_keys: string[]; value: Json }
        Returns: boolean
      }
      jsonb_text_array: { Args: { value: Json }; Returns: string[] }
      lock_exact_source_authority: {
        Args: {
          expected_commit: string
          expected_repository_url: string
          expected_source_path: string
        }
        Returns: undefined
      }
      m1_11_deletion_acknowledged_count: {
        Args: { p_acks: Json }
        Returns: number
      }
      m1_11_deletion_acknowledgements_valid: {
        Args: { p_acks: Json }
        Returns: boolean
      }
      m1_11_deletion_acknowledgements_within_window: {
        Args: {
          p_acks: Json
          p_barrier_committed_at: string
          p_completed_at: string
        }
        Returns: boolean
      }
      m1_11_deletion_owner_position: {
        Args: { p_owner: string }
        Returns: number
      }
      m1_11_deletion_owner_registry: { Args: never; Returns: string[] }
      managed_skill_release_reason_codes_are_canonical: {
        Args: { value: string[] }
        Returns: boolean
      }
      my_owner_devices: {
        Args: never
        Returns: {
          h_connector_version: string
          h_display_name: string
          h_expires_at: string
          h_issued_at: string
          h_last_used_at: string
          h_locale: string
          h_platform: string
          h_public_id: string
          h_revision: number
          h_revoked_at: string
          h_state: string
        }[]
      }
      my_owner_import_sessions: {
        Args: never
        Returns: {
          h_accepted_byte_total: number
          h_accepted_file_count: number
          h_created_at: string
          h_expected_byte_total: number
          h_expected_file_count: number
          h_expiry_at: string
          h_public_id: string
          h_revision: number
          h_state: string
          h_updated_at: string
          h_verified_at: string
        }[]
      }
      my_owner_managed_skill_files: {
        Args: never
        Returns: {
          h_byte_size: number
          h_created_at: string
          h_executable: boolean
          h_media_type: string
          h_ordinal: number
          h_public_id: string
          h_relative_path: string
        }[]
      }
      my_owner_managed_skill_releases: {
        Args: never
        Returns: {
          h_created_at: string
          h_eligibility_reasons: string[]
          h_lifecycle_state: string
          h_public_id: string
        }[]
      }
      my_owner_managed_skill_versions: {
        Args: never
        Returns: {
          h_analysis_state: string
          h_created_at: string
          h_provenance_state: string
          h_public_id: string
        }[]
      }
      my_owner_managed_skills: {
        Args: never
        Returns: {
          h_created_at: string
          h_description: string
          h_display_name: string
          h_public_id: string
          h_updated_at: string
        }[]
      }
      my_route_corrections: {
        Args: never
        Returns: {
          id_alt_release_public_id: string
          id_alt_skill_public_id: string
          id_alt_version_public_id: string
          id_created_at: string
          id_decision_public_id: string
          id_expires_at: string
          id_outcome: string
          id_public_id: string
        }[]
      }
      my_route_decisions: {
        Args: never
        Returns: {
          r_confidence: number
          r_created_at: string
          r_decision_expiry_at: string
          r_public_id: string
          r_reason_codes: Json
          r_replay_guaranteed_until: string
          r_result_type: string
        }[]
      }
      my_route_selections: {
        Args: never
        Returns: {
          s_confidence: number
          s_created_at: string
          s_ordinal: number
          s_public_decision_id: string
          s_reason_codes: Json
          s_release_public_id: string
          s_role: string
          s_row_kind: string
          s_skill_public_id: string
          s_version_public_id: string
        }[]
      }
      normalize_device_scopes: { Args: { value: string[] }; Returns: string[] }
      normalize_reason_codes: { Args: { value: Json }; Returns: Json }
      operator_action_subject_is_valid: {
        Args: { action_kind: string; subject_id: string; subject_type: string }
        Returns: boolean
      }
      operator_request_header: {
        Args: { header_name: string }
        Returns: string
      }
      perform_vault_deletion_barrier: {
        Args: never
        Returns: {
          queued_object_count: number
          receipt_del_: string
          state_: string
        }[]
      }
      prepare_skill_vault_delete: {
        Args: { p_expires_at: string; p_file_public_id: string }
        Returns: {
          bucket_id: string
          content_type: string
          declared_size: number
          expires_at: string
          file_public_id: string
          object_name: string
          purpose: string
          version_public_id: string
        }[]
      }
      prepare_skill_vault_read: {
        Args: { p_expires_at: string; p_file_public_id: string }
        Returns: {
          bucket_id: string
          content_type: string
          declared_size: number
          expires_at: string
          file_public_id: string
          object_name: string
          purpose: string
          version_public_id: string
        }[]
      }
      prepare_skill_vault_upload: {
        Args: { p_expires_at: string; p_file_public_id: string }
        Returns: {
          bucket_id: string
          content_type: string
          declared_size: number
          expires_at: string
          file_public_id: string
          object_name: string
          purpose: string
          version_public_id: string
        }[]
      }
      publish_skill_submission_dual_control_unchecked: {
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
      publish_skill_submission_unchecked: {
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
      reason_codes_are_canonical: { Args: { value: Json }; Returns: boolean }
      receipt_backed_version_is_restorable: {
        Args: { version_uuid: string }
        Returns: boolean
      }
      record_route_correction: {
        Args: {
          p_account_id: string
          p_alt_managed_skill_id: string
          p_alt_release_id: string
          p_alt_version_id: string
          p_decision_id: string
          p_device_id: string
          p_expires_at?: string
          p_idempotency_key: string
          p_outcome: string
        }
        Returns: string
      }
      record_route_decision: {
        Args: {
          p_account_id: string
          p_account_revision: string
          p_audience_revision: string
          p_confidence: number
          p_deadline_ms: number
          p_device_auth_binding_revision: string
          p_device_id: string
          p_elapsed_ms: number
          p_eligibility_revision: string
          p_reason_codes: Json
          p_request_fingerprint: string
          p_request_id: string
          p_result_type: string
          p_routing_policy_revision: string
          p_segment_binding_ms: number
          p_segment_eligibility_ms: number
          p_segment_ranking_ms: number
          p_selections: Json
        }
        Returns: string
      }
      record_skill_submission_publisher_authorization_unchecked: {
        Args: {
          p_authorization_basis: string
          p_decision: string
          p_evidence_digest: string
          p_evidence_reference: string
          p_expires_at: string
          p_idempotency_digest: string
          p_publisher_handle: string
          p_submission_id: string
        }
        Returns: {
          authorization_decision: string
          authorization_expires_at: string
          authorization_receipt_id: string
        }[]
      }
      register_my_device: {
        Args: {
          p_connector_version: string
          p_display_name: string
          p_locale?: string
          p_platform: string
        }
        Returns: {
          issued_at: string
          public_id: string
          revision: number
          state: string
        }[]
      }
      require_operator_principal: {
        Args: { required_role: string }
        Returns: {
          authority_role: string
          created_at: string
          credential_digest: string
          handle: string
          id: string
          public_id: string
          revoked_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "operator_principals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_device_context: {
        Args: {
          p_account_id: string
          p_credential_digest: string
          p_expected_device_revision: number
          p_expected_token_generation: number
          p_key_version: number
          p_required_scope?: string
        }
        Returns: {
          device_id: string
          token_id: string
        }[]
      }
      resume_import_session: {
        Args: {
          p_account_id: string
          p_device_id: string
          p_session_id: string
        }
        Returns: Json
      }
      review_skill_submission_collisions_unchecked: {
        Args: {
          p_disposition: string
          p_idempotency_digest: string
          p_reason_code: string
          p_submission_id: string
          p_target_publisher_id: string
          p_target_skill_id: string
          p_target_version_id: string
        }
        Returns: {
          collision_review_id: string
          disposition: string
          review_subject_digest: string
        }[]
      }
      revision_grammar_ok: { Args: { value: string }; Returns: boolean }
      revoke_device_token: {
        Args: { p_account_id: string; p_token_id: string }
        Returns: boolean
      }
      revoke_my_device: {
        Args: { p_device_public_id: string; p_expected_revision: number }
        Returns: {
          public_id: string
          revision: number
          revoked_at: string
          state: string
        }[]
      }
      rotate_device_token: {
        Args: {
          p_account_id: string
          p_new_credential_digest: string
          p_new_expires_at?: string
          p_new_key_version: number
          p_new_scopes: string[]
          p_old_token_id: string
        }
        Returns: string
      }
      rotate_my_device: {
        Args: { p_device_public_id: string; p_expected_revision: number }
        Returns: {
          public_id: string
          revision: number
          state: string
        }[]
      }
      route_decision_authority_current: {
        Args: {
          p_account_id: string
          p_decision_id: string
          p_device_id: string
        }
        Returns: boolean
      }
      route_selection_authority_current: {
        Args: { p_account_id: string; p_selections: Json }
        Returns: undefined
      }
      safe_public_message: {
        Args: { maximum_length: number; value: string }
        Returns: boolean
      }
      skill_submission_collision_evidence: {
        Args: { audit_uuid?: string; submission_uuid: string }
        Returns: Json
      }
      skill_submission_collision_review_subject: {
        Args: { submission_uuid: string }
        Returns: Json
      }
      skill_vault_storage_object_binding_is_valid: {
        Args: {
          p_bucket_id: string
          p_metadata: Json
          p_object_name: string
          p_owner: string
          p_owner_id: string
          p_user_metadata: Json
        }
        Returns: boolean
      }
      submit_my_route_correction: {
        Args: {
          p_alt_release_public_id: string
          p_alt_skill_public_id: string
          p_alt_version_public_id: string
          p_expires_at?: string
          p_idempotency_key: string
          p_outcome: string
          p_rtd: string
        }
        Returns: Json
      }
      supported_submission_evidence_authority: {
        Args: {
          audit_host_profile_version: string
          audit_policy_version: string
          audit_worker_version: string
          claim_worker_version: string
          grade_evaluator_version: string
          grade_host_profile_version: string
          grade_rubric_version: string
          worker_run_version: string
        }
        Returns: boolean
      }
      update_managed_skill_metadata: {
        Args: {
          p_description: string
          p_display_name: string
          p_skill_public_id: string
        }
        Returns: {
          description: string
          display_name: string
          public_id: string
          updated_at: string
        }[]
      }
      valid_public_alpha_spdx: { Args: { value: string }; Returns: boolean }
      valid_relative_paths: {
        Args: { maximum_items: number; value: string[] }
        Returns: boolean
      }
      valid_submission_audit_receipt: {
        Args: { expected_worker: string; value: Json }
        Returns: boolean
      }
      valid_submission_audit_receipt_unversioned: {
        Args: { expected_worker: string; value: Json }
        Returns: boolean
      }
      valid_submission_grade_receipt: {
        Args: { audit_value: Json; value: Json }
        Returns: boolean
      }
      valid_submission_grade_receipt_unversioned: {
        Args: { audit_value: Json; value: Json }
        Returns: boolean
      }
      valid_submission_license_evidence: {
        Args: {
          expected_commit: string
          expected_repository_url: string
          expected_source_path: string
          value: Json
        }
        Returns: boolean
      }
      valid_text_array: {
        Args: {
          item_pattern?: string
          maximum_item_length: number
          maximum_items: number
          value: string[]
        }
        Returns: boolean
      }
      version_has_current_publisher_authorization: {
        Args: { version_uuid: string }
        Returns: boolean
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
  private: {
    Enums: {},
  },
} as const
