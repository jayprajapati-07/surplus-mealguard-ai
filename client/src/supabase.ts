import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? 'https://xewlimzaswophixqwogi.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_gEDnnWdnBAbokI1-LA_TCg_MR6uPfKT';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
