// Tells the page which Supabase project to use. The anon key is public by design:
// every table is protected by row level security (see supabase/schema.sql).
// Environment variables SUPABASE_URL / SUPABASE_ANON_KEY override these defaults.
const DEFAULT_URL = "https://oggmosadlkarwlurxdjk.supabase.co";
const DEFAULT_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9nZ21vc2FkbGthcndsdXJ4ZGprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODEyNjQsImV4cCI6MjEwNzY1NzI2NH0.WfxddEbJwtIXlc5ENVM6fLmB46zmgi7eeVk02FWJfQ0";

module.exports = function handler(req, res) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify({
    supabaseUrl: process.env.SUPABASE_URL || DEFAULT_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || DEFAULT_ANON_KEY,
  }));
};
