import * as Dialog from "@radix-ui/react-dialog";
import { RotateCcw } from "lucide-react";
import { useRef, useState } from "react";

export default function DemoReset() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cancel = useRef<HTMLButtonElement>(null);
  const resetting = useRef(false);

  async function reset() {
    if (resetting.current) return;
    resetting.current = true;
    setBusy(true);
    setError("");
    try {
      const { resetDemo } = await import("@/lib/demo");
      resetDemo();
      window.location.replace("/demo");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "לא ניתן לאפס את ההדגמה.",
      );
      resetting.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog.Root onOpenChange={(open) => open && setError("")}>
      <Dialog.Trigger
        type="button"
        className="button demo-reset"
        aria-label="איפוס ההדגמה"
      >
        <RotateCcw size={15} aria-hidden /> איפוס
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className="modal demo-reset-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancel.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (resetting.current) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (resetting.current) event.preventDefault();
          }}
        >
          <Dialog.Title>לאפס את ההדגמה?</Dialog.Title>
          <Dialog.Description>
            השינויים המקומיים שביצעת בדמו יימחקו ונתוני ההתחלה ישוחזרו.
          </Dialog.Description>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="row demo-reset-actions">
            <Dialog.Close ref={cancel} type="button" disabled={busy}>
              ביטול
            </Dialog.Close>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void reset()}
            >
              {busy ? "מאפסים…" : "איפוס ההדגמה"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
