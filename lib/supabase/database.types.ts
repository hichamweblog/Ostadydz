export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type SimpleTable<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };

export interface Database {
  public: {
    Tables: {
      memoranda_files: {
        Row: {
          id: string;
          workspace_id: string;
          owner_id: string | null;
          unit_id: string | null;
          unit_key: string | null;
          file_name: string;
          storage_path: string;
          file_size: number;
          checksum: string;
          mime_type: string;
          is_bundled: boolean;
          revision: number;
          sync_revision: number;
          sync_updated_at: string;
          sync_device_id: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['memoranda_files']['Row'], 'id' | 'workspace_id' | 'revision' | 'created_at' | 'updated_at' | 'sync_revision' | 'sync_updated_at' | 'sync_device_id'> & {
          id?: string;
          workspace_id?: string;
          revision?: number;
          sync_revision?: number;
          sync_updated_at?: string;
          sync_device_id?: string | null;
        };
        Update: Partial<Database['public']['Tables']['memoranda_files']['Insert']>;
        Relationships: [];
      };
      app_settings: {
        Row: {
          id: string;
          workspace_id: string;
          owner_id: string;
          settings: Json;
          revision: number;
          updated_by: string | null;
          updated_by_device: string | null;
          sync_revision: number;
          sync_updated_at: string;
          sync_device_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['app_settings']['Row'], 'id' | 'workspace_id' | 'created_at' | 'updated_at' | 'revision' | 'updated_by_device' | 'sync_revision' | 'sync_updated_at' | 'sync_device_id'> & {
          id?: string;
          workspace_id?: string;
          revision?: number;
          updated_by_device?: string | null;
          sync_revision?: number;
          sync_updated_at?: string;
          sync_device_id?: string | null;
        };
        Update: Partial<Database['public']['Tables']['app_settings']['Insert']>;
        Relationships: [];
      };
      sync_conflicts: {
        Row: {
          id: string;
          owner_id: string;
          entity_type: string;
          entity_id: string | null;
          local_revision: number;
          remote_revision: number;
          local_device_id: string | null;
          remote_device_id: string | null;
          resolution: 'last-write-wins';
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['sync_conflicts']['Row'], 'id' | 'created_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['sync_conflicts']['Insert']>;
        Relationships: [];
      };
      sync_tombstones: {
        Row: {
          owner_id: string;
          entity_type: string;
          entity_id: string;
          deleted_at: string;
          revision: number;
          device_id: string | null;
        };
        Insert: Database['public']['Tables']['sync_tombstones']['Row'];
        Update: Partial<Database['public']['Tables']['sync_tombstones']['Insert']>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          title: string | null;
          avatar_url: string | null;
          avatar_storage_key: string | null;
          school_name: string | null;
          state_name: string | null;
          academic_year: string | null;
          hijri_year: string | null;
          first_name_ar: string | null;
          last_name_ar: string | null;
          first_name_en: string | null;
          last_name_en: string | null;
          email: string | null;
          phone: string | null;
          first_appointment_date: string | null;
          experience_years: number | null;
          birth_date: string | null;
          birth_place: string | null;
          family_status: string | null;
          gender: 'M' | 'F' | null;
          sync_revision: number;
          sync_updated_at: string;
          sync_device_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'sync_revision' | 'sync_updated_at' | 'sync_device_id'> & { id: string; sync_revision?: number; sync_updated_at?: string; sync_device_id?: string | null };
        Update: Partial<Database['public']['Tables']['profiles']['Row']>;
        Relationships: [];
      };
      workspaces: SimpleTable<{
        id: string;
        owner_id: string;
        name: string;
        created_at: string;
        updated_at: string;
      }>;
      sync_operations: SimpleTable<{
        workspace_id: string;
        owner_id: string;
        operation_id: string;
        applied_at: string;
      }>;
      classes: {
        Row: {
          id: string;
          workspace_id: string;
          owner_id: string;
          name: string;
          level: string | null;
          section: string | null;
          weekly_hours: number;
          academic_year: string | null;
          notes: string | null;
          room_number: string | null;
          color: string | null;
          revision: number;
          created_at: string;
          updated_at: string;
          sync_revision: number;
          sync_updated_at: string;
          sync_device_id: string | null;
        };
        Insert: Omit<Database['public']['Tables']['classes']['Row'], 'id' | 'workspace_id' | 'revision' | 'created_at' | 'updated_at' | 'sync_revision' | 'sync_updated_at' | 'sync_device_id'> & {
          id?: string;
          workspace_id?: string;
          revision?: number;
          sync_revision?: number;
          sync_updated_at?: string;
          sync_device_id?: string | null;
        };
        Update: Partial<Database['public']['Tables']['classes']['Insert']>;
        Relationships: [];
      };
      students: {
        Row: {
          id: string;
          workspace_id: string;
          owner_id: string;
          class_id: string;
          external_id: string | null;
          full_name: string;
          normalized_name: string;
          number_in_list: number;
          reg_number: string | null;
          registration_number: string | null;
          is_repeater: boolean;
          guardian_phone: string | null;
          gender: string | null;
          birth_date: string | null;
          notes: string | null;
          revision: number;
          created_at: string;
          updated_at: string;
          sync_revision: number;
          sync_updated_at: string;
          sync_device_id: string | null;
        };
        Insert: Omit<Database['public']['Tables']['students']['Row'], 'id' | 'workspace_id' | 'revision' | 'normalized_name' | 'created_at' | 'updated_at' | 'sync_revision' | 'sync_updated_at' | 'sync_device_id'> & {
          id?: string;
          workspace_id?: string;
          revision?: number;
          sync_revision?: number;
          sync_updated_at?: string;
          sync_device_id?: string | null;
        };
        Update: Partial<Database['public']['Tables']['students']['Insert']>;
        Relationships: [];
      };
      grades: {
        Row: {
          id: string;
          workspace_id: string;
          owner_id: string;
          student_id: string;
          class_id: string;
          trimester: 1 | 2 | 3;
          continuous_eval: number | null;
          behavior_score: number | null;
          attendance_score: number | null;
          notebook_score: number | null;
          participation_score: number | null;
          quiz: number | null;
          exam: number | null;
          calculated_average: number | null;
          estimation: string | null;
          guidance: string | null;
          remarks: string | null;
          follow_up_notes: string | null;
          revision: number;
          created_at: string;
          updated_at: string;
          sync_revision: number;
          sync_updated_at: string;
          sync_device_id: string | null;
        };
        Insert: Omit<Database['public']['Tables']['grades']['Row'], 'id' | 'workspace_id' | 'revision' | 'created_at' | 'updated_at' | 'sync_revision' | 'sync_updated_at' | 'sync_device_id'> & {
          id?: string;
          workspace_id?: string;
          revision?: number;
          sync_revision?: number;
          sync_updated_at?: string;
          sync_device_id?: string | null;
        };
        Update: Partial<Database['public']['Tables']['grades']['Insert']>;
        Relationships: [];
      };
      sessions: SimpleTable<{
        id: string;
        workspace_id: string;
        owner_id: string;
        class_id: string;
        session_date: string;
        start_time: string | null;
        end_time: string | null;
        trimester: number | null;
        topic: string | null;
        summary: string | null;
        assignments: string | null;
        teacher_notes: string | null;
        revision: number;
        updated_by: string | null;
        sync_revision: number;
        sync_updated_at: string;
        sync_device_id: string | null;
        created_at: string;
        updated_at: string;
      }>;
      attendance: SimpleTable<{ id: string; workspace_id: string; owner_id: string; session_id: string; student_id: string; status: string; note: string | null; revision: number; updated_by: string | null; created_at: string; updated_at: string }>;
      session_behaviors: SimpleTable<{ id: string; workspace_id: string; owner_id: string; session_id: string; student_id: string; behavior: string; rating: number | null; note: string | null; revision: number; updated_by: string | null; created_at: string; updated_at: string }>;
      timetable_slots: SimpleTable<{ id: string; workspace_id: string; owner_id: string; class_id: string; weekday: number; start_time: string; end_time: string; room: string | null; notes: string | null; revision: number; updated_by: string | null; created_at: string; updated_at: string }>;
      curriculum_units: SimpleTable<{ id: string; workspace_id: string; owner_id: string; title: string; code: string | null; level: string | null; position: number; description: string | null; metadata: Json; revision: number; updated_by: string | null; created_at: string; updated_at: string }>;
      custom_units: SimpleTable<{ id: string; workspace_id: string; owner_id: string; title: string; level: string | null; position: number; metadata: Json; revision: number; updated_by: string | null; created_at: string; updated_at: string }>;
      dashboard_tasks: SimpleTable<{ id: string; workspace_id: string; owner_id: string; task_id: string; text: string; done: boolean; revision: number; updated_by: string | null; created_at: string; updated_at: string }>;
      lesson_progress: SimpleTable<{ id: string; workspace_id: string; owner_id: string; class_id: string; unit_id: string | null; unit_key: string | null; status: string; completed_at: string | null; notes: string | null; revision: number; updated_by: string | null; created_at: string; updated_at: string }>;
      lesson_plans: SimpleTable<{ id: string; workspace_id: string; owner_id: string; class_id: string | null; unit_id: string | null; title: string; content: Json; lesson_date: string | null; revision: number; updated_by: string | null; created_at: string; updated_at: string }>;
    };
    Views: Record<string, never>;
    Functions: {
      reset_workspace: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      claim_sync_operation: {
        Args: {
          p_workspace_id: string;
          p_owner_id: string;
          p_operation_id: string;
        };
        Returns: boolean;
      };
      import_roster_batch: {
        Args: {
          p_classes: Json;
          p_students: Json;
        };
        Returns: void;
      };
      clear_roster_data: {
        Args: Record<string, never>;
        Returns: void;
      };
      upsert_grade: {
        Args: {
          p_student_id: string;
          p_class_id: string;
          p_trimester: number;
          p_values: Json;
          p_revision?: number | null;
        };
        Returns: Database['public']['Tables']['grades']['Row'];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
