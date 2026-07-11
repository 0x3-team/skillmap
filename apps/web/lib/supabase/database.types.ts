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
    }
    Views: {
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
      [_ in never]: never
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
