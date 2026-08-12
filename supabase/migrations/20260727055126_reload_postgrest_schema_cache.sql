-- Reload PostgREST's schema cache after the hosted api schema becomes exposed.
notify pgrst, 'reload schema';
