# IS Map

Community-powered internet speed testing and mapping, built with React, Leaflet/OpenStreetMap, and Supabase.

## Local setup

```bash
npm install
npm run dev
```

## Enable shared Supabase logging

1. Create a Supabase project.
2. Run every SQL file in `supabase/migrations` in filename order using the Supabase SQL Editor.
3. Copy `.env.example` to `.env.local`.
4. Add the project URL and publishable anon key to `.env.local`.
5. Restart the development server.

Successful tests will then be stored in `public.speed_tests` and appear on every visitor's map. Browser-provided coordinates are stored without rounding so measurements remain accurately positioned.

The second migration adds ISP/location metadata and a database-side submission throttle. Test history remains private in the visitor's browser local storage.

The third migration groups measurements within roughly 150 metres into a 20-minute window while retaining the latest full-precision coordinates. Tests inside that window update a weighted average and the last-tested time; later tests create a new map record.

Without Supabase environment variables, speed testing still works locally, but the shared map remains empty and results are not persisted.
