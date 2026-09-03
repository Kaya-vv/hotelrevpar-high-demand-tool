alter table hotels
  alter column enabled_sources set default array['rijksoverheid', 'openholidays', 'ticketmaster', 'claude', 'footballdata'];

alter table collection_areas
  alter column enabled_sources set default array['rijksoverheid', 'openholidays', 'ticketmaster', 'claude', 'footballdata'];
