alter table hotels
  alter column enabled_sources set default array['rijksoverheid', 'openholidays', 'ticketmaster', 'predicthq', 'claude'];

alter table collection_areas
  alter column enabled_sources set default array['rijksoverheid', 'openholidays', 'ticketmaster', 'predicthq', 'claude'];

update hotels
set enabled_sources = array_remove(enabled_sources, 'uefa')
where enabled_sources @> array['uefa'];

update collection_areas
set enabled_sources = array_remove(enabled_sources, 'uefa')
where enabled_sources @> array['uefa'];
