import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zvpyxyhcwxdvlxastjuq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2cHl4eWhjd3hkdmx4YXN0anVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0NzczNjAsImV4cCI6MjA5NzA1MzM2MH0.NeN5QQmPgrR9ot4fjRxZ7kvUKhk20R99cFBPuAoFALs';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
