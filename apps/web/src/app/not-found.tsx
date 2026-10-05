import { ButtonLink } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";

export default function NotFound() {
  return <EmptyState badge="" title="Page not found" description="That route does not exist in this demo build." action={<ButtonLink href="/" variant="primary">GO HOME</ButtonLink>} />;
}
