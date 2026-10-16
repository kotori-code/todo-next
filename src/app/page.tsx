import { Suspense } from "react";
import TodoApp from "@/components/TodoApp";

export default function Home() {
  // ?l= はブラウザ側で読むので、読み終わるまでは読み込み中を出す
  return (
    <Suspense fallback={<p className="py-24 text-center text-slate-600 dark:text-slate-300">読み込み中…</p>}>
      <TodoApp lineAddUrl={process.env.NEXT_PUBLIC_LINE_ADD_URL || null} />
    </Suspense>
  );
}
