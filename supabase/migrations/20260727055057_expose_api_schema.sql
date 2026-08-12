-- The hosted application uses the bounded `api` schema through PostgREST.
-- Keep the default schemas available while explicitly exposing only this
-- first-party application schema in addition to Supabase's defaults.
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, api';
notify pgrst, 'reload config';
