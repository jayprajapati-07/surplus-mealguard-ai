import { createClient } from '@supabase/supabase-js';

// Optional Supabase client. Uses environment variables only — no hardcoded
// production credentials, so builds never silently point at the wrong project.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const supabase =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
