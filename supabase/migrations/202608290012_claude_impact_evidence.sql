alter table event_sources
  add column ai_impact_points integer
  check (ai_impact_points is null or ai_impact_points between 0 and 60);
