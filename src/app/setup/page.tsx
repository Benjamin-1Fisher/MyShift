import Link from "next/link";
import ConnectionRequired from "@/components/connection-required";
export default function SetupPage() {
  return (
    <>
      <div className="setup-nav">
        <Link className="button" href="/">
          חזרה ל־MyShift
        </Link>
        <Link className="button primary" href="/demo">
          כניסה להדגמה
        </Link>
      </div>
      <ConnectionRequired />
    </>
  );
}
