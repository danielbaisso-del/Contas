import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { AssistantPlace } from "@/domain/assistant";

export function PlaceLink({ place }: { place: AssistantPlace }) {
  return (
    <Link className="mt-3 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white" to={place.to}>
      {place.label}
      <ArrowRight size={16} />
    </Link>
  );
}
