import { PageSkeleton } from "@/components/page-skeleton";

export default function CalendarLoading() {
  return (
    <PageSkeleton>
      <div className="event-toolbar">
        <span className="skeleton skeleton-toolbar" />
        <span className="skeleton skeleton-toolbar" />
      </div>
      <div className="filter-bar">
        <span className="skeleton skeleton-field" />
        <span className="skeleton skeleton-field" />
      </div>
      <span className="skeleton skeleton-grid" />
    </PageSkeleton>
  );
}
