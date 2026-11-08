import { useRef, useState } from "react";
import { api } from "../lib/api";
import { errorMessage, useLoad } from "../lib/hooks";
import { Alert, Btn, Card } from "./ui";

type Kind = "countdown" | "winners";
interface Slot { url: string | null; name: string; size_bytes: number }
const MAX = 4 * 1024 * 1024;

const SLOTS: { kind: Kind; title: string; help: string }[] = [
  { kind: "countdown", title: "Countdown sound", help: "Plays during the 15-second shuffle. Ideally about 15 seconds long; it is cut off when the winners appear." },
  { kind: "winners", title: "Winners announcement sound", help: "Plays the moment the winners appear, over the fireworks." },
];

export function SoundsCard() {
  const sounds = useLoad(() => api<{ sounds: Record<Kind, Slot | null> }>("/sounds").then((r) => r.sounds));
  const [busy, setBusy] = useState<Kind | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function upload(kind: Kind, file: File | undefined) {
    if (!file) return;
    if (file.size > MAX) return setMsg({ kind: "error", text: "That file is larger than 4 MB. Export a shorter or lower-bitrate MP3." });
    setBusy(kind);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const r = await api<{ sounds: Record<Kind, Slot | null> }>(`/sounds/${kind}`, { method: "PUT", body: fd });
      sounds.setData(r.sounds);
      setMsg({ kind: "ok", text: "Sound saved. The projector picks it up automatically." });
    } catch (e) { setMsg({ kind: "error", text: errorMessage(e) }); } finally { setBusy(null); }
  }
  async function remove(kind: Kind) {
    setBusy(kind);
    setMsg(null);
    try {
      const r = await api<{ sounds: Record<Kind, Slot | null> }>(`/sounds/${kind}`, { method: "DELETE" });
      sounds.setData(r.sounds);
      setMsg({ kind: "ok", text: "Removed. The built-in sound will be used." });
    } catch (e) { setMsg({ kind: "error", text: errorMessage(e) }); } finally { setBusy(null); }
  }

  return (
    <Card className="space-y-5">
      <div>
        <h2 className="font-display text-lg font-bold">Sounds</h2>
        <p className="mt-1 text-sm text-white/60">Upload your own audio (MP3, WAV, OGG or M4A, up to 4 MB). Without an upload the projector uses simple built-in sounds.</p>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {sounds.error && <Alert>{sounds.error}</Alert>}
      {SLOTS.map((s) => <SlotRow key={s.kind} {...s} slot={sounds.data?.[s.kind] ?? null} busy={busy === s.kind} onUpload={(f) => upload(s.kind, f)} onRemove={() => remove(s.kind)} />)}
    </Card>
  );
}

function SlotRow({ title, help, slot, busy, onUpload, onRemove }: { title: string; help: string; slot: Slot | null; busy: boolean; onUpload: (f: File | undefined) => void; onRemove: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-xl border border-white/10 bg-ink-900/60 p-4">
      <p className="font-medium">{title}</p>
      <p className="mb-3 text-xs text-white/50">{help}</p>
      {slot ? (
        <>
          <p className="mb-2 text-sm text-gold-400">{slot.name} <span className="text-white/40">· {(slot.size_bytes / 1024).toFixed(0)} KB</span></p>
          {slot.url && <audio controls preload="none" src={slot.url} className="mb-3 w-full" />}
        </>
      ) : (
        <p className="mb-3 text-sm text-white/40">Using the built-in sound.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Btn variant="gold" busy={busy} onClick={() => input.current?.click()}>{slot ? "Replace file" : "Upload file"}</Btn>
        {slot && <Btn busy={busy} onClick={onRemove}>Remove</Btn>}
      </div>
      <input ref={input} type="file" hidden accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/x-m4a,.mp3,.wav,.ogg,.m4a" onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}
