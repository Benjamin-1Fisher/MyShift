import Workspace from "@/components/workspace";
import ConnectionRequired from "@/components/connection-required";
export default function Page() {
  const configured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  return configured ? <Workspace configured /> : <ConnectionRequired />;
}
