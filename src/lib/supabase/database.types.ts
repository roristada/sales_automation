export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      assets: {
        Row: {
          ai_generated: boolean;
          attribution: string | null;
          created_at: string;
          duration_s: number | null;
          height: number | null;
          id: string;
          kind: string;
          license: string;
          mime: string;
          name: string;
          notes: string | null;
          owner_id: string;
          product_id: string | null;
          sha256: string;
          size_bytes: number;
          source: string;
          source_url: string | null;
          storage_key: string;
          updated_at: string;
          width: number | null;
        };
        ComputedFields: never;
        Insert: {
          ai_generated?: boolean;
          attribution?: string | null;
          created_at?: string;
          duration_s?: number | null;
          height?: number | null;
          id?: string;
          kind: string;
          license?: string;
          mime: string;
          name: string;
          notes?: string | null;
          owner_id?: string;
          product_id?: string | null;
          sha256: string;
          size_bytes: number;
          source: string;
          source_url?: string | null;
          storage_key: string;
          updated_at?: string;
          width?: number | null;
        };
        Update: {
          ai_generated?: boolean;
          attribution?: string | null;
          created_at?: string;
          duration_s?: number | null;
          height?: number | null;
          id?: string;
          kind?: string;
          license?: string;
          mime?: string;
          name?: string;
          notes?: string | null;
          owner_id?: string;
          product_id?: string | null;
          sha256?: string;
          size_bytes?: number;
          source?: string;
          source_url?: string | null;
          storage_key?: string;
          updated_at?: string;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "assets_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assets_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "research_products";
            referencedColumns: ["id"];
          },
        ];
      };
      content_projects: {
        Row: {
          created_at: string;
          id: string;
          owner_id: string;
          platform: string;
          product_id: string;
          target_duration_s: number;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          owner_id?: string;
          platform: string;
          product_id: string;
          target_duration_s: number;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          owner_id?: string;
          platform?: string;
          product_id?: string;
          target_duration_s?: number;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_projects_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_projects_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "research_products";
            referencedColumns: ["id"];
          },
        ];
      };
      import_batches: {
        Row: {
          column_mapping: NonNullable<Json>;
          completed_at: string | null;
          created_at: string;
          duplicate_count: number;
          duplicate_mode: string;
          failed_count: number;
          file_name: string;
          id: string;
          inserted_count: number;
          owner_id: string;
          status: string;
          total_rows: number;
          updated_count: number;
        };
        ComputedFields: never;
        Insert: {
          column_mapping?: NonNullable<Json>;
          completed_at?: string | null;
          created_at?: string;
          duplicate_count?: number;
          duplicate_mode: string;
          failed_count?: number;
          file_name: string;
          id?: string;
          inserted_count?: number;
          owner_id?: string;
          status?: string;
          total_rows?: number;
          updated_count?: number;
        };
        Update: {
          column_mapping?: NonNullable<Json>;
          completed_at?: string | null;
          created_at?: string;
          duplicate_count?: number;
          duplicate_mode?: string;
          failed_count?: number;
          file_name?: string;
          id?: string;
          inserted_count?: number;
          owner_id?: string;
          status?: string;
          total_rows?: number;
          updated_count?: number;
        };
        Relationships: [];
      };
      import_row_errors: {
        Row: {
          batch_id: string;
          errors: NonNullable<Json>;
          id: number;
          owner_id: string;
          raw: NonNullable<Json>;
          row_number: number;
        };
        ComputedFields: never;
        Insert: {
          batch_id: string;
          errors: NonNullable<Json>;
          id?: never;
          owner_id?: string;
          raw: NonNullable<Json>;
          row_number: number;
        };
        Update: {
          batch_id?: string;
          errors?: NonNullable<Json>;
          id?: never;
          owner_id?: string;
          raw?: NonNullable<Json>;
          row_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "import_row_errors_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
        ];
      };
      opportunity_scores: {
        Row: {
          computed_at: string;
          confidence: string | null;
          owner_id: string;
          product_id: string;
          result: NonNullable<Json>;
          score: number | null;
          score_version: number;
        };
        ComputedFields: never;
        Insert: {
          computed_at?: string;
          confidence?: string | null;
          owner_id?: string;
          product_id: string;
          result: NonNullable<Json>;
          score?: number | null;
          score_version: number;
        };
        Update: {
          computed_at?: string;
          confidence?: string | null;
          owner_id?: string;
          product_id?: string;
          result?: NonNullable<Json>;
          score?: number | null;
          score_version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "opportunity_scores_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: true;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "opportunity_scores_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: true;
            referencedRelation: "research_products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_facts: {
        Row: {
          created_at: string;
          id: string;
          label: string;
          owner_id: string;
          position: number;
          product_id: string;
          source_url: string | null;
          status: string;
          updated_at: string;
          value: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          label: string;
          owner_id?: string;
          position?: number;
          product_id: string;
          source_url?: string | null;
          status?: string;
          updated_at?: string;
          value: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          label?: string;
          owner_id?: string;
          position?: number;
          product_id?: string;
          source_url?: string | null;
          status?: string;
          updated_at?: string;
          value?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_facts_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_facts_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "research_products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_price_history: {
        Row: {
          commission_amount: number | null;
          commission_rate: number | null;
          id: number;
          owner_id: string;
          price: number | null;
          product_id: string;
          recorded_at: string;
          source: Database["public"]["Enums"]["product_source"];
        };
        ComputedFields: never;
        Insert: {
          commission_amount?: number | null;
          commission_rate?: number | null;
          id?: never;
          owner_id?: string;
          price?: number | null;
          product_id: string;
          recorded_at?: string;
          source: Database["public"]["Enums"]["product_source"];
        };
        Update: {
          commission_amount?: number | null;
          commission_rate?: number | null;
          id?: never;
          owner_id?: string;
          price?: number | null;
          product_id?: string;
          recorded_at?: string;
          source?: Database["public"]["Enums"]["product_source"];
        };
        Relationships: [
          {
            foreignKeyName: "product_price_history_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_price_history_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "research_products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_trend_links: {
        Row: {
          created_at: string;
          keyword: string;
          owner_id: string;
          product_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          keyword: string;
          owner_id?: string;
          product_id: string;
        };
        Update: {
          created_at?: string;
          keyword?: string;
          owner_id?: string;
          product_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_trend_links_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: true;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_trend_links_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: true;
            referencedRelation: "research_products";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          affiliate_url: string | null;
          category: string | null;
          commission_amount: number | null;
          commission_rate: number | null;
          created_at: string;
          currency: string;
          description: string | null;
          id: string;
          image_url: string | null;
          import_batch_id: string | null;
          marketplace: string | null;
          name: string;
          notes: string | null;
          owner_id: string;
          price: number | null;
          product_url: string | null;
          provenance: NonNullable<Json>;
          retrieved_at: string | null;
          source: Database["public"]["Enums"]["product_source"];
          source_product_id: string | null;
          updated_at: string;
          url_key: string | null;
        };
        ComputedFields: never;
        Insert: {
          affiliate_url?: string | null;
          category?: string | null;
          commission_amount?: number | null;
          commission_rate?: number | null;
          created_at?: string;
          currency?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          import_batch_id?: string | null;
          marketplace?: string | null;
          name: string;
          notes?: string | null;
          owner_id?: string;
          price?: number | null;
          product_url?: string | null;
          provenance?: NonNullable<Json>;
          retrieved_at?: string | null;
          source: Database["public"]["Enums"]["product_source"];
          source_product_id?: string | null;
          updated_at?: string;
          url_key?: string | null;
        };
        Update: {
          affiliate_url?: string | null;
          category?: string | null;
          commission_amount?: number | null;
          commission_rate?: number | null;
          created_at?: string;
          currency?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          import_batch_id?: string | null;
          marketplace?: string | null;
          name?: string;
          notes?: string | null;
          owner_id?: string;
          price?: number | null;
          product_url?: string | null;
          provenance?: NonNullable<Json>;
          retrieved_at?: string | null;
          source?: Database["public"]["Enums"]["product_source"];
          source_product_id?: string | null;
          updated_at?: string;
          url_key?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "products_import_batch_fk";
            columns: ["import_batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          display_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      render_jobs: {
        Row: {
          attempt: number;
          created_at: string;
          error_code: string | null;
          error_message: string | null;
          finished_at: string | null;
          id: string;
          locked_at: string | null;
          locked_by: string | null;
          max_attempts: number;
          owner_id: string;
          progress: number;
          settings: NonNullable<Json>;
          stage: string | null;
          started_at: string | null;
          status: string;
          storyboard_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          attempt?: number;
          created_at?: string;
          error_code?: string | null;
          error_message?: string | null;
          finished_at?: string | null;
          id?: string;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          owner_id?: string;
          progress?: number;
          settings?: NonNullable<Json>;
          stage?: string | null;
          started_at?: string | null;
          status?: string;
          storyboard_id: string;
          updated_at?: string;
        };
        Update: {
          attempt?: number;
          created_at?: string;
          error_code?: string | null;
          error_message?: string | null;
          finished_at?: string | null;
          id?: string;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          owner_id?: string;
          progress?: number;
          settings?: NonNullable<Json>;
          stage?: string | null;
          started_at?: string | null;
          status?: string;
          storyboard_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "render_jobs_storyboard_id_fkey";
            columns: ["storyboard_id"];
            isOneToOne: false;
            referencedRelation: "storyboards";
            referencedColumns: ["id"];
          },
        ];
      };
      render_outputs: {
        Row: {
          created_at: string;
          duration_s: number | null;
          id: string;
          job_id: string;
          owner_id: string;
          probe: Json | null;
          report: NonNullable<Json>;
          size_bytes: number | null;
          srt_key: string | null;
          thumbnail_key: string | null;
          video_key: string;
          vtt_key: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          duration_s?: number | null;
          id?: string;
          job_id: string;
          owner_id: string;
          probe?: Json | null;
          report?: NonNullable<Json>;
          size_bytes?: number | null;
          srt_key?: string | null;
          thumbnail_key?: string | null;
          video_key: string;
          vtt_key?: string | null;
        };
        Update: {
          created_at?: string;
          duration_s?: number | null;
          id?: string;
          job_id?: string;
          owner_id?: string;
          probe?: Json | null;
          report?: NonNullable<Json>;
          size_bytes?: number | null;
          srt_key?: string | null;
          thumbnail_key?: string | null;
          video_key?: string;
          vtt_key?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "render_outputs_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: true;
            referencedRelation: "render_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      scene_claims: {
        Row: {
          created_at: string;
          fact_id: string | null;
          id: string;
          owner_id: string;
          product_field: string | null;
          review_status: string;
          scene_id: string;
          text: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          fact_id?: string | null;
          id?: string;
          owner_id?: string;
          product_field?: string | null;
          review_status?: string;
          scene_id: string;
          text: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          fact_id?: string | null;
          id?: string;
          owner_id?: string;
          product_field?: string | null;
          review_status?: string;
          scene_id?: string;
          text?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scene_claims_fact_id_fkey";
            columns: ["fact_id"];
            isOneToOne: false;
            referencedRelation: "product_facts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scene_claims_scene_id_fkey";
            columns: ["scene_id"];
            isOneToOne: false;
            referencedRelation: "storyboard_scenes";
            referencedColumns: ["id"];
          },
        ];
      };
      spending_limits: {
        Row: {
          daily_thb: number | null;
          monthly_thb: number | null;
          owner_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          daily_thb?: number | null;
          monthly_thb?: number | null;
          owner_id?: string;
          updated_at?: string;
        };
        Update: {
          daily_thb?: number | null;
          monthly_thb?: number | null;
          owner_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      storyboard_scenes: {
        Row: {
          asset_id: string | null;
          created_at: string;
          id: string;
          kind: string;
          narration: string;
          on_screen_text: string;
          owner_id: string;
          position: number;
          storyboard_id: string;
          text_origin: string;
          updated_at: string;
          visual_note: string;
        };
        ComputedFields: never;
        Insert: {
          asset_id?: string | null;
          created_at?: string;
          id?: string;
          kind: string;
          narration?: string;
          on_screen_text?: string;
          owner_id?: string;
          position: number;
          storyboard_id: string;
          text_origin?: string;
          updated_at?: string;
          visual_note?: string;
        };
        Update: {
          asset_id?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          narration?: string;
          on_screen_text?: string;
          owner_id?: string;
          position?: number;
          storyboard_id?: string;
          text_origin?: string;
          updated_at?: string;
          visual_note?: string;
        };
        Relationships: [
          {
            foreignKeyName: "storyboard_scenes_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "assets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "storyboard_scenes_storyboard_id_fkey";
            columns: ["storyboard_id"];
            isOneToOne: false;
            referencedRelation: "storyboards";
            referencedColumns: ["id"];
          },
        ];
      };
      storyboards: {
        Row: {
          approved_at: string | null;
          approved_snapshot: Json | null;
          caption: string;
          created_at: string;
          cta: string;
          disclosure: string;
          hook: string;
          id: string;
          owner_id: string;
          project_id: string;
          status: string;
          template_id: string;
          template_version: number;
          updated_at: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          approved_at?: string | null;
          approved_snapshot?: Json | null;
          caption?: string;
          created_at?: string;
          cta?: string;
          disclosure: string;
          hook?: string;
          id?: string;
          owner_id?: string;
          project_id: string;
          status?: string;
          template_id: string;
          template_version: number;
          updated_at?: string;
          version: number;
        };
        Update: {
          approved_at?: string | null;
          approved_snapshot?: Json | null;
          caption?: string;
          created_at?: string;
          cta?: string;
          disclosure?: string;
          hook?: string;
          id?: string;
          owner_id?: string;
          project_id?: string;
          status?: string;
          template_id?: string;
          template_version?: number;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "storyboards_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "content_projects";
            referencedColumns: ["id"];
          },
        ];
      };
      trend_imports: {
        Row: {
          category: string | null;
          created_at: string;
          file_name: string | null;
          granularity: string;
          id: string;
          keywords: string[];
          owner_id: string;
          period_end: string;
          period_start: string;
          point_count: number;
          retrieved_at: string;
          source: Database["public"]["Enums"]["trend_source"];
        };
        ComputedFields: never;
        Insert: {
          category?: string | null;
          created_at?: string;
          file_name?: string | null;
          granularity: string;
          id?: string;
          keywords: string[];
          owner_id?: string;
          period_end: string;
          period_start: string;
          point_count: number;
          retrieved_at: string;
          source: Database["public"]["Enums"]["trend_source"];
        };
        Update: {
          category?: string | null;
          created_at?: string;
          file_name?: string | null;
          granularity?: string;
          id?: string;
          keywords?: string[];
          owner_id?: string;
          period_end?: string;
          period_start?: string;
          point_count?: number;
          retrieved_at?: string;
          source?: Database["public"]["Enums"]["trend_source"];
        };
        Relationships: [];
      };
      trend_observations: {
        Row: {
          below_one: boolean;
          id: number;
          import_id: string;
          keyword: string;
          owner_id: string;
          period_start: string;
          region: string | null;
          value: number;
          value_unit: string;
        };
        ComputedFields: never;
        Insert: {
          below_one?: boolean;
          id?: never;
          import_id: string;
          keyword: string;
          owner_id?: string;
          period_start: string;
          region?: string | null;
          value: number;
          value_unit?: string;
        };
        Update: {
          below_one?: boolean;
          id?: never;
          import_id?: string;
          keyword?: string;
          owner_id?: string;
          period_start?: string;
          region?: string | null;
          value?: number;
          value_unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trend_observations_import_id_fkey";
            columns: ["import_id"];
            isOneToOne: false;
            referencedRelation: "trend_imports";
            referencedColumns: ["id"];
          },
        ];
      };
      usage_events: {
        Row: {
          created_at: string;
          est_cost_thb: number;
          id: number;
          owner_id: string;
          provider: string;
          render_job_id: string | null;
          unit: string;
          units: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          est_cost_thb?: number;
          id?: never;
          owner_id: string;
          provider: string;
          render_job_id?: string | null;
          unit: string;
          units: number;
        };
        Update: {
          created_at?: string;
          est_cost_thb?: number;
          id?: never;
          owner_id?: string;
          provider?: string;
          render_job_id?: string | null;
          unit?: string;
          units?: number;
        };
        Relationships: [
          {
            foreignKeyName: "usage_events_render_job_id_fkey";
            columns: ["render_job_id"];
            isOneToOne: false;
            referencedRelation: "render_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      product_freshness: {
        Row: {
          aging: number | null;
          fresh: number | null;
          newest: string | null;
          oldest: string | null;
          source: Database["public"]["Enums"]["product_source"] | null;
          stale: number | null;
          total: number | null;
          unknown_date: number | null;
        };
        ComputedFields: never;
        Relationships: [];
      };
      research_products: {
        Row: {
          affiliate_url: string | null;
          category: string | null;
          commission_amount: number | null;
          commission_rate: number | null;
          created_at: string | null;
          currency: string | null;
          description: string | null;
          id: string | null;
          image_url: string | null;
          import_batch_id: string | null;
          marketplace: string | null;
          name: string | null;
          notes: string | null;
          opportunity_confidence: string | null;
          opportunity_score: number | null;
          owner_id: string | null;
          price: number | null;
          product_url: string | null;
          provenance: Json | null;
          retrieved_at: string | null;
          score_version: number | null;
          source: Database["public"]["Enums"]["product_source"] | null;
          source_product_id: string | null;
          updated_at: string | null;
          url_key: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "products_import_batch_fk";
            columns: ["import_batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      cancel_render_job: { Args: { job: string }; Returns: boolean };
      claim_render_job: {
        Args: { stale_after?: string; worker: string };
        Returns: {
          attempt: number;
          created_at: string;
          error_code: string | null;
          error_message: string | null;
          finished_at: string | null;
          id: string;
          locked_at: string | null;
          locked_by: string | null;
          max_attempts: number;
          owner_id: string;
          progress: number;
          settings: NonNullable<Json>;
          stage: string | null;
          started_at: string | null;
          status: string;
          storyboard_id: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "render_jobs";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      fail_exhausted_render_jobs: { Args: { stale_after?: string }; Returns: number };
      spend_summary: {
        Args: { owner?: string };
        Returns: {
          month_thb: number;
          today_thb: number;
        }[];
      };
      storyboard_is_approved: { Args: { sb: string }; Returns: boolean };
    };
    Enums: {
      product_source: "manual" | "csv" | "shopee_affiliate" | "tiktok_shop";
      trend_source: "google_trends_csv" | "google_trends_api";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      product_source: ["manual", "csv", "shopee_affiliate", "tiktok_shop"],
      trend_source: ["google_trends_csv", "google_trends_api"],
    },
  },
} as const;
