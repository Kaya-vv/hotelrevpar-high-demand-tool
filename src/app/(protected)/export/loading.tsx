import { PageSkeleton } from "@/components/page-skeleton";
import { ExportSkeleton } from "@/features/export/export-skeleton";

export default function ExportLoading() {
  return <PageSkeleton><ExportSkeleton /></PageSkeleton>;
}
