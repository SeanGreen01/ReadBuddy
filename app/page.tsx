import Reader from "@/components/Reader";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto mb-8 max-w-3xl">
        <h1 className="text-2xl font-semibold text-slate-900">Read Along</h1>
        <p className="mt-1 text-sm text-slate-600">
          A patient reading companion. Read one sentence at a time — it listens,
          and offers gentle, optional help if a word sounds different. You stay
          in control: retry, hear the word, ask for a meaning, or keep going.
        </p>
      </div>
      <Reader />
      <footer className="mx-auto mt-10 max-w-3xl text-xs text-slate-400">
        Prototype for reading practice. A transcript mismatch is a possible
        difference, not proof of a reading error. This does not diagnose
        dyslexia or assess reading ability.
      </footer>
    </main>
  );
}
