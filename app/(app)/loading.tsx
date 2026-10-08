import { RouteLoading } from "@/components/ui/brand-loader";

// Fallback for any app/(app)/ segment without its own loading.tsx. Every
// route's loading state is the same branded mark (components/ui/
// brand-loader.tsx), rendered inside <main> so the Sidebar/TopNav stay
// interactive while a page streams in.
export default function AppLoading() {
  return <RouteLoading />;
}
