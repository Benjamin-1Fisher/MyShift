export const DEMO_KEY = "myshift.demo.v1";
export const DEMO_RECEIPTS_KEY = "myshift.synthetic-team.v1";

export function demoResetToken(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const { resetToken } = JSON.parse(raw);
    return typeof resetToken === "string" ? resetToken : undefined;
  } catch {
    return undefined;
  }
}
