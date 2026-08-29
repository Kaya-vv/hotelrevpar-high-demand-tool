alter table hotels
  alter column enabled_sources set default array['rijksoverheid', 'openholidays', 'ticketmaster', 'predicthq', 'claude', 'uefa'];

alter table collection_areas
  alter column enabled_sources set default array['rijksoverheid', 'openholidays', 'ticketmaster', 'predicthq', 'claude', 'uefa'];

update hotels
set enabled_sources = array_append(enabled_sources, 'uefa')
where not enabled_sources @> array['uefa'];

update collection_areas
set enabled_sources = array_append(enabled_sources, 'uefa')
where not enabled_sources @> array['uefa'];
