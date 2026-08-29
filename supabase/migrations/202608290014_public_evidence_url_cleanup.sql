update event_sources
set public_source_url = null,
    primary_source_confirmed = false
where public_source_url is not null
  and (
    public_source_url like 'https://api.predicthq.com/%'
    or public_source_url ~ '[[:space:]''"{}\[\]]'
  );
