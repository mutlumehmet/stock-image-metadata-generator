import { FileList } from './FileList';

export function Sidebar() {
  return (
    <aside className="w-[290px] shrink-0 rounded-xl bg-card border border-border p-3 flex flex-col min-h-0">
      <FileList />
    </aside>
  );
}
